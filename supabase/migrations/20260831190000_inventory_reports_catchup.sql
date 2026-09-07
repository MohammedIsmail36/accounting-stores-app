-- ============================================================
-- Catch-up migration: inventory analytics RPCs + inventory settings
-- Idempotent. Safe to run on existing production databases.
-- ============================================================

-- 1) Inventory settings columns on company_settings
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS inventory_lead_time_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS inventory_target_cover_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS inventory_slow_days integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS inventory_dead_days integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS inventory_new_days integer NOT NULL DEFAULT 30;

-- 2) Reporting / inventory analytics functions (current definitions)

-- 2a) Drop old versions first (return types may differ on older databases)
DROP FUNCTION IF EXISTS public.get_account_balances(p_date_from date, p_date_to date, p_only_with_activity boolean);
DROP FUNCTION IF EXISTS public.get_account_statement(p_entity_type text, p_entity_id uuid, p_date_from date, p_date_to date, p_limit integer, p_offset integer);
DROP FUNCTION IF EXISTS public.get_inventory_aging(p_as_of date, p_slow_days integer, p_dead_days integer);
DROP FUNCTION IF EXISTS public.get_inventory_kpis(p_date_from date, p_date_to date);
DROP FUNCTION IF EXISTS public.get_inventory_reorder(p_date_from date, p_date_to date, p_lead_time_days integer, p_target_days integer);
DROP FUNCTION IF EXISTS public.get_inventory_valuation(p_as_of date);
DROP FUNCTION IF EXISTS public.get_ledger_active_accounts();
DROP FUNCTION IF EXISTS public.get_ledger_lines(p_account_id uuid, p_date_from date, p_date_to date, p_limit integer, p_offset integer);
DROP FUNCTION IF EXISTS public.inventory_product_state(p_as_of date);
DROP FUNCTION IF EXISTS public.inventory_signed_quantity(p_movement_type text, p_quantity numeric);

CREATE OR REPLACE FUNCTION public.inventory_signed_quantity(p_movement_type text, p_quantity numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_movement_type = 'adjustment' THEN COALESCE(p_quantity, 0)
    WHEN p_movement_type IN ('sale', 'purchase_return') THEN -abs(COALESCE(p_quantity, 0))
    ELSE abs(COALESCE(p_quantity, 0))
  END;
$function$
;

REVOKE ALL ON FUNCTION public.inventory_signed_quantity(p_movement_type text, p_quantity numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_signed_quantity(p_movement_type text, p_quantity numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.inventory_product_state(p_as_of date)
 RETURNS TABLE(product_id uuid, quantity numeric, moves_value numeric, wac numeric, purchased_qty numeric, purchased_cost numeric, sold_qty numeric, sold_cost numeric, last_sale_date date, last_receipt_date date, first_movement_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    m.product_id,
    round(SUM(public.inventory_signed_quantity(m.movement_type::text, m.quantity)), 2),
    round(SUM(
      CASE
        WHEN m.movement_type = 'adjustment'
          THEN sign(COALESCE(m.quantity, 0)) * abs(COALESCE(m.total_cost, 0))
        WHEN m.movement_type IN ('sale', 'purchase_return')
          THEN -abs(COALESCE(m.total_cost, 0))
        ELSE abs(COALESCE(m.total_cost, 0))
      END
    ), 2),
    CASE
      WHEN SUM(CASE WHEN m.movement_type IN ('purchase', 'opening_balance')
                    THEN abs(COALESCE(m.quantity, 0)) ELSE 0 END) > 0
      THEN round(
        SUM(CASE WHEN m.movement_type IN ('purchase', 'opening_balance')
                 THEN abs(COALESCE(m.total_cost, 0)) ELSE 0 END)
        / SUM(CASE WHEN m.movement_type IN ('purchase', 'opening_balance')
                   THEN abs(COALESCE(m.quantity, 0)) ELSE 0 END), 2)
      ELSE NULL
    END,
    round(SUM(CASE WHEN m.movement_type IN ('purchase', 'opening_balance')
                   THEN abs(COALESCE(m.quantity, 0)) ELSE 0 END), 2),
    round(SUM(CASE WHEN m.movement_type IN ('purchase', 'opening_balance')
                   THEN abs(COALESCE(m.total_cost, 0)) ELSE 0 END), 2),
    round(SUM(CASE WHEN m.movement_type = 'sale' THEN abs(COALESCE(m.quantity, 0))
                   WHEN m.movement_type = 'sale_return' THEN -abs(COALESCE(m.quantity, 0))
                   ELSE 0 END), 2),
    round(SUM(CASE WHEN m.movement_type = 'sale' THEN abs(COALESCE(m.total_cost, 0))
                   WHEN m.movement_type = 'sale_return' THEN -abs(COALESCE(m.total_cost, 0))
                   ELSE 0 END), 2),
    MAX(CASE WHEN m.movement_type = 'sale' THEN m.movement_date END),
    MAX(CASE WHEN m.movement_type IN ('purchase', 'opening_balance') THEN m.movement_date END),
    MIN(m.movement_date)
  FROM public.inventory_movements m
  WHERE m.movement_date <= COALESCE(p_as_of, current_date)
  GROUP BY m.product_id;
$function$
;

REVOKE ALL ON FUNCTION public.inventory_product_state(p_as_of date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_product_state(p_as_of date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_account_balances(p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_only_with_activity boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
BEGIN
  WITH agg AS (
    SELECT
      jel.account_id,
      COALESCE(SUM(jel.debit), 0)::numeric  AS debit,
      COALESCE(SUM(jel.credit), 0)::numeric AS credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.status = 'posted'
      AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
      AND (p_date_to   IS NULL OR je.entry_date <= p_date_to)
    GROUP BY jel.account_id
  ),
  joined AS (
    SELECT
      a.id, a.code, a.name, a.account_type,
      COALESCE(g.debit, 0)  AS debit,
      COALESCE(g.credit, 0) AS credit,
      (COALESCE(g.debit, 0) - COALESCE(g.credit, 0)) AS balance
    FROM accounts a
    LEFT JOIN agg g ON g.account_id = a.id
    WHERE a.is_active = true
      AND a.is_parent = false
      AND (NOT p_only_with_activity OR g.account_id IS NOT NULL)
  )
  SELECT jsonb_agg(row_to_json(t) ORDER BY t.code),
         COALESCE(SUM(t.debit), 0),
         COALESCE(SUM(t.credit), 0)
  INTO v_rows, v_total_debit, v_total_credit
  FROM joined t;

  RETURN jsonb_build_object(
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'total_debit', v_total_debit,
    'total_credit', v_total_credit
  );
END;
$function$
;

REVOKE ALL ON FUNCTION public.get_account_balances(p_date_from date, p_date_to date, p_only_with_activity boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_balances(p_date_from date, p_date_to date, p_only_with_activity boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_account_statement(p_entity_type text, p_entity_id uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_lines jsonb;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_total_count int := 0;
  v_opening numeric := 0;
BEGIN
  -- Fetch opening balance for the entity
  IF p_entity_type = 'customer' THEN
    SELECT COALESCE(opening_balance, 0) INTO v_opening FROM customers WHERE id = p_entity_id;
  ELSIF p_entity_type = 'supplier' THEN
    SELECT COALESCE(opening_balance, 0) INTO v_opening FROM suppliers WHERE id = p_entity_id;
  END IF;

  WITH all_lines AS (
    -- Opening balance synthetic line (only if non-zero)
    SELECT
      COALESCE(p_date_from, '1900-01-01'::date) AS line_date,
      'رصيد افتتاحي'::text AS line_type,
      NULL::bigint AS doc_number,
      NULL::integer AS doc_posted_number,
      'posted'::text AS doc_status,
      'opening'::text AS doc_kind,
      'رصيد افتتاحي'::text AS description,
      CASE WHEN p_entity_type = 'customer' AND v_opening <> 0 THEN v_opening ELSE 0 END::numeric AS debit,
      CASE WHEN p_entity_type = 'supplier' AND v_opening <> 0 THEN v_opening ELSE 0 END::numeric AS credit,
      '1900-01-01 00:00:00+00'::timestamptz AS sort_ts
    WHERE v_opening <> 0

    UNION ALL
    SELECT si.invoice_date, 'فاتورة مبيعات', si.invoice_number, si.posted_number, si.status,
      'sales_invoice', 'فاتورة مبيعات', si.total::numeric, 0::numeric, si.created_at
    FROM sales_invoices si
    WHERE p_entity_type = 'customer' AND si.customer_id = p_entity_id AND si.status = 'posted'
      AND (p_date_from IS NULL OR si.invoice_date >= p_date_from)
      AND (p_date_to IS NULL OR si.invoice_date <= p_date_to)
    UNION ALL
    SELECT sr.return_date, 'مرتجع مبيعات', sr.return_number, sr.posted_number, sr.status,
      'sales_return', 'مرتجع مبيعات', 0, sr.total::numeric, sr.created_at
    FROM sales_returns sr
    WHERE p_entity_type = 'customer' AND sr.customer_id = p_entity_id AND sr.status = 'posted'
      AND (p_date_from IS NULL OR sr.return_date >= p_date_from)
      AND (p_date_to IS NULL OR sr.return_date <= p_date_to)
    UNION ALL
    SELECT cp.payment_date,
      CASE WHEN EXISTS (SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id)
        THEN 'رد مبلغ لعميل' ELSE 'سند قبض' END,
      cp.payment_number, cp.posted_number, cp.status, 'customer_payment',
      CASE WHEN EXISTS (SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id)
        THEN 'رد مبلغ مرتجع للعميل' ELSE 'تحصيل من العميل' END,
      CASE WHEN EXISTS (SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id)
        THEN cp.amount::numeric ELSE 0 END,
      CASE WHEN EXISTS (SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id)
        THEN 0 ELSE cp.amount::numeric END,
      cp.created_at
    FROM customer_payments cp
    WHERE p_entity_type = 'customer' AND cp.customer_id = p_entity_id AND cp.status = 'posted'
      AND (p_date_from IS NULL OR cp.payment_date >= p_date_from)
      AND (p_date_to IS NULL OR cp.payment_date <= p_date_to)
    UNION ALL
    SELECT pi.invoice_date, 'فاتورة مشتريات', pi.invoice_number, pi.posted_number, pi.status,
      'purchase_invoice', 'فاتورة مشتريات', 0, pi.total::numeric, pi.created_at
    FROM purchase_invoices pi
    WHERE p_entity_type = 'supplier' AND pi.supplier_id = p_entity_id AND pi.status = 'posted'
      AND (p_date_from IS NULL OR pi.invoice_date >= p_date_from)
      AND (p_date_to IS NULL OR pi.invoice_date <= p_date_to)
    UNION ALL
    SELECT pr.return_date, 'مرتجع مشتريات', pr.return_number, pr.posted_number, pr.status,
      'purchase_return', 'مرتجع مشتريات', pr.total::numeric, 0, pr.created_at
    FROM purchase_returns pr
    WHERE p_entity_type = 'supplier' AND pr.supplier_id = p_entity_id AND pr.status = 'posted'
      AND (p_date_from IS NULL OR pr.return_date >= p_date_from)
      AND (p_date_to IS NULL OR pr.return_date <= p_date_to)
    UNION ALL
    SELECT sp.payment_date,
      CASE WHEN EXISTS (SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id)
        THEN 'مبلغ مسترد من مورد' ELSE 'سند صرف' END,
      sp.payment_number, sp.posted_number, sp.status, 'supplier_payment',
      CASE WHEN EXISTS (SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id)
        THEN 'استلام مبلغ مرتجع من المورد' ELSE 'دفعة للمورد' END,
      CASE WHEN EXISTS (SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id)
        THEN 0 ELSE sp.amount::numeric END,
      CASE WHEN EXISTS (SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id)
        THEN sp.amount::numeric ELSE 0 END,
      sp.created_at
    FROM supplier_payments sp
    WHERE p_entity_type = 'supplier' AND sp.supplier_id = p_entity_id AND sp.status = 'posted'
      AND (p_date_from IS NULL OR sp.payment_date >= p_date_from)
      AND (p_date_to IS NULL OR sp.payment_date <= p_date_to)
  ),
  with_balance AS (
    SELECT
      line_date, line_type, doc_number, doc_posted_number, doc_status, doc_kind,
      description, debit, credit,
      SUM(debit - credit) OVER (ORDER BY sort_ts, line_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance,
      sort_ts
    FROM all_lines
  )
  SELECT
    COALESCE(SUM(debit), 0),
    COALESCE(SUM(credit), 0),
    COUNT(*)::int
  INTO v_total_debit, v_total_credit, v_total_count
  FROM with_balance;

  WITH all_lines AS (
    SELECT
      COALESCE(p_date_from, '1900-01-01'::date) AS line_date,
      'رصيد افتتاحي'::text AS line_type,
      NULL::bigint AS doc_number,
      NULL::integer AS doc_posted_number,
      'posted'::text AS doc_status,
      'opening'::text AS doc_kind,
      'رصيد افتتاحي'::text AS description,
      CASE WHEN p_entity_type = 'customer' AND v_opening <> 0 THEN v_opening ELSE 0 END::numeric AS debit,
      CASE WHEN p_entity_type = 'supplier' AND v_opening <> 0 THEN v_opening ELSE 0 END::numeric AS credit,
      '1900-01-01 00:00:00+00'::timestamptz AS sort_ts
    WHERE v_opening <> 0
    UNION ALL
    SELECT si.invoice_date, 'فاتورة مبيعات', si.invoice_number, si.posted_number, si.status,
      'sales_invoice', 'فاتورة مبيعات', si.total::numeric, 0::numeric, si.created_at
    FROM sales_invoices si
    WHERE p_entity_type = 'customer' AND si.customer_id = p_entity_id AND si.status = 'posted'
      AND (p_date_from IS NULL OR si.invoice_date >= p_date_from)
      AND (p_date_to IS NULL OR si.invoice_date <= p_date_to)
    UNION ALL
    SELECT sr.return_date, 'مرتجع مبيعات', sr.return_number, sr.posted_number, sr.status,
      'sales_return', 'مرتجع مبيعات', 0, sr.total::numeric, sr.created_at
    FROM sales_returns sr
    WHERE p_entity_type = 'customer' AND sr.customer_id = p_entity_id AND sr.status = 'posted'
      AND (p_date_from IS NULL OR sr.return_date >= p_date_from)
      AND (p_date_to IS NULL OR sr.return_date <= p_date_to)
    UNION ALL
    SELECT cp.payment_date,
      CASE WHEN EXISTS (SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id)
        THEN 'رد مبلغ لعميل' ELSE 'سند قبض' END,
      cp.payment_number, cp.posted_number, cp.status, 'customer_payment',
      CASE WHEN EXISTS (SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id)
        THEN 'رد مبلغ مرتجع للعميل' ELSE 'تحصيل من العميل' END,
      CASE WHEN EXISTS (SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id)
        THEN cp.amount::numeric ELSE 0 END,
      CASE WHEN EXISTS (SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id)
        THEN 0 ELSE cp.amount::numeric END,
      cp.created_at
    FROM customer_payments cp
    WHERE p_entity_type = 'customer' AND cp.customer_id = p_entity_id AND cp.status = 'posted'
      AND (p_date_from IS NULL OR cp.payment_date >= p_date_from)
      AND (p_date_to IS NULL OR cp.payment_date <= p_date_to)
    UNION ALL
    SELECT pi.invoice_date, 'فاتورة مشتريات', pi.invoice_number, pi.posted_number, pi.status,
      'purchase_invoice', 'فاتورة مشتريات', 0, pi.total::numeric, pi.created_at
    FROM purchase_invoices pi
    WHERE p_entity_type = 'supplier' AND pi.supplier_id = p_entity_id AND pi.status = 'posted'
      AND (p_date_from IS NULL OR pi.invoice_date >= p_date_from)
      AND (p_date_to IS NULL OR pi.invoice_date <= p_date_to)
    UNION ALL
    SELECT pr.return_date, 'مرتجع مشتريات', pr.return_number, pr.posted_number, pr.status,
      'purchase_return', 'مرتجع مشتريات', pr.total::numeric, 0, pr.created_at
    FROM purchase_returns pr
    WHERE p_entity_type = 'supplier' AND pr.supplier_id = p_entity_id AND pr.status = 'posted'
      AND (p_date_from IS NULL OR pr.return_date >= p_date_from)
      AND (p_date_to IS NULL OR pr.return_date <= p_date_to)
    UNION ALL
    SELECT sp.payment_date,
      CASE WHEN EXISTS (SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id)
        THEN 'مبلغ مسترد من مورد' ELSE 'سند صرف' END,
      sp.payment_number, sp.posted_number, sp.status, 'supplier_payment',
      CASE WHEN EXISTS (SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id)
        THEN 'استلام مبلغ مرتجع من المورد' ELSE 'دفعة للمورد' END,
      CASE WHEN EXISTS (SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id)
        THEN 0 ELSE sp.amount::numeric END,
      CASE WHEN EXISTS (SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id)
        THEN sp.amount::numeric ELSE 0 END,
      sp.created_at
    FROM supplier_payments sp
    WHERE p_entity_type = 'supplier' AND sp.supplier_id = p_entity_id AND sp.status = 'posted'
      AND (p_date_from IS NULL OR sp.payment_date >= p_date_from)
      AND (p_date_to IS NULL OR sp.payment_date <= p_date_to)
  ),
  with_balance AS (
    SELECT
      line_date, line_type, doc_number, doc_posted_number, doc_status, doc_kind,
      description, debit, credit,
      SUM(debit - credit) OVER (ORDER BY sort_ts, line_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance,
      sort_ts
    FROM all_lines
  )
  SELECT jsonb_agg(row_to_json(t))
  INTO v_lines
  FROM (
    SELECT line_date, line_type, doc_number, doc_posted_number, doc_status, doc_kind,
           description, debit, credit, running_balance
    FROM with_balance
    ORDER BY sort_ts, line_date
    OFFSET p_offset LIMIT p_limit
  ) t;

  v_result := jsonb_build_object(
    'lines', COALESCE(v_lines, '[]'::jsonb),
    'total_count', v_total_count,
    'total_debit', v_total_debit,
    'total_credit', v_total_credit,
    'final_balance', v_total_debit - v_total_credit
  );

  RETURN v_result;
END;
$function$
;

REVOKE ALL ON FUNCTION public.get_account_statement(p_entity_type text, p_entity_id uuid, p_date_from date, p_date_to date, p_limit integer, p_offset integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_statement(p_entity_type text, p_entity_id uuid, p_date_from date, p_date_to date, p_limit integer, p_offset integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_inventory_aging(p_as_of date DEFAULT NULL::date, p_slow_days integer DEFAULT NULL::integer, p_dead_days integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_as_of date := COALESCE(p_as_of, current_date);
  v_slow integer;
  v_dead integer;
  v_rows jsonb;
BEGIN
  SELECT COALESCE(p_slow_days, inventory_slow_days, 60),
         COALESCE(p_dead_days, inventory_dead_days, 180)
    INTO v_slow, v_dead
  FROM public.company_settings
  LIMIT 1;

  v_slow := COALESCE(v_slow, COALESCE(p_slow_days, 60));
  v_dead := COALESCE(v_dead, COALESCE(p_dead_days, 180));

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.value DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      p.id AS product_id,
      p.code,
      p.name,
      p.model_number,
      b.name AS brand_name,
      c.name AS category_name,
      s.quantity,
      COALESCE(s.wac, p.purchase_price, 0) AS unit_cost,
      round(s.quantity * COALESCE(s.wac, p.purchase_price, 0), 2) AS value,
      s.last_receipt_date,
      s.last_sale_date,
      (v_as_of - s.last_receipt_date) AS age_days,
      CASE WHEN s.last_sale_date IS NULL THEN NULL ELSE (v_as_of - s.last_sale_date) END AS days_since_sale,
      CASE
        WHEN (v_as_of - s.last_receipt_date) <= 30 THEN '0-30'
        WHEN (v_as_of - s.last_receipt_date) <= 60 THEN '31-60'
        WHEN (v_as_of - s.last_receipt_date) <= 90 THEN '61-90'
        WHEN (v_as_of - s.last_receipt_date) <= 180 THEN '91-180'
        ELSE '180+'
      END AS bucket,
      CASE
        WHEN COALESCE(v_as_of - s.last_sale_date, v_as_of - s.first_movement_date) >= v_dead THEN 'dead'
        WHEN COALESCE(v_as_of - s.last_sale_date, v_as_of - s.first_movement_date) >= v_slow THEN 'slow'
        ELSE 'moving'
      END AS status,
      p.selling_price,
      round(p.selling_price - COALESCE(s.wac, p.purchase_price, 0), 2) AS nrv_margin
    FROM public.inventory_product_state(v_as_of) s
    JOIN public.products p ON p.id = s.product_id
    LEFT JOIN public.product_brands b ON b.id = p.brand_id
    LEFT JOIN public.product_categories c ON c.id = p.category_id
    WHERE s.quantity > 0
  ) x;

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'slow_days', v_slow,
    'dead_days', v_dead,
    'rows', v_rows
  );
END;
$function$
;

REVOKE ALL ON FUNCTION public.get_inventory_aging(p_as_of date, p_slow_days integer, p_dead_days integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_aging(p_as_of date, p_slow_days integer, p_dead_days integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_inventory_kpis(p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_to date := COALESCE(p_date_to, current_date);
  v_from date := COALESCE(p_date_from, date_trunc('year', v_to)::date);
  v_days integer := GREATEST((v_to - v_from) + 1, 1);
  v_open numeric;
  v_close numeric;
  v_cogs numeric;
  v_purchases numeric;
  v_revenue numeric;
  v_avg numeric;
  v_turnover numeric;
  v_rows jsonb;
BEGIN
  SELECT COALESCE(SUM(quantity * COALESCE(wac, 0)), 0) INTO v_open
  FROM public.inventory_product_state(v_from - 1);

  SELECT COALESCE(SUM(quantity * COALESCE(wac, 0)), 0) INTO v_close
  FROM public.inventory_product_state(v_to);

  SELECT
    COALESCE(SUM(CASE WHEN movement_type = 'sale' THEN abs(total_cost)
                      WHEN movement_type = 'sale_return' THEN -abs(total_cost) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type IN ('purchase', 'opening_balance') THEN abs(total_cost)
                      WHEN movement_type = 'purchase_return' THEN -abs(total_cost) ELSE 0 END), 0)
    INTO v_cogs, v_purchases
  FROM public.inventory_movements
  WHERE movement_date BETWEEN v_from AND v_to;

  SELECT COALESCE(SUM(i.net_total), 0) INTO v_revenue
  FROM public.sales_invoice_items i
  JOIN public.sales_invoices inv ON inv.id = i.invoice_id
  WHERE inv.status = 'posted' AND inv.invoice_date BETWEEN v_from AND v_to;

  v_avg := round((v_open + v_close) / 2, 2);
  v_turnover := CASE WHEN v_avg > 0 THEN round(v_cogs / v_avg, 2) ELSE NULL END;

  SELECT COALESCE(jsonb_agg(to_jsonb(z) ORDER BY z.revenue DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      y.*,
      CASE
        WHEN y.total_revenue <= 0 THEN 'C'
        WHEN y.cumulative_share <= 0.80 THEN 'A'
        WHEN y.cumulative_share <= 0.95 THEN 'B'
        ELSE 'C'
      END AS abc_class
    FROM (
      SELECT
        x.*,
        SUM(x.revenue) OVER (ORDER BY x.revenue DESC ROWS UNBOUNDED PRECEDING)
          / NULLIF(SUM(x.revenue) OVER (), 0) AS cumulative_share,
        SUM(x.revenue) OVER () AS total_revenue
      FROM (
        SELECT
          p.id AS product_id,
          p.code,
          p.name,
          p.model_number,
          b.name AS brand_name,
          c.name AS category_name,
          COALESCE(sold.revenue, 0) AS revenue,
          COALESCE(sold.qty, 0) AS sold_qty,
          COALESCE(mv.cogs, 0) AS cogs,
          round(COALESCE(sold.revenue, 0) - COALESCE(mv.cogs, 0), 2) AS gross_profit,
          COALESCE(st.quantity, 0) AS quantity,
          round(COALESCE(st.quantity, 0) * COALESCE(st.wac, p.purchase_price, 0), 2) AS stock_value
        FROM public.products p
        LEFT JOIN public.product_categories c ON c.id = p.category_id
        LEFT JOIN public.product_brands b ON b.id = p.brand_id
        LEFT JOIN public.inventory_product_state(v_to) st ON st.product_id = p.id
        LEFT JOIN (
          SELECT i.product_id,
                 SUM(i.net_total) AS revenue,
                 SUM(i.quantity) AS qty
          FROM public.sales_invoice_items i
          JOIN public.sales_invoices inv ON inv.id = i.invoice_id
          WHERE inv.status = 'posted' AND inv.invoice_date BETWEEN v_from AND v_to
          GROUP BY i.product_id
        ) sold ON sold.product_id = p.id
        LEFT JOIN (
          SELECT m.product_id,
                 SUM(CASE WHEN m.movement_type = 'sale' THEN abs(m.total_cost)
                          WHEN m.movement_type = 'sale_return' THEN -abs(m.total_cost)
                          ELSE 0 END) AS cogs
          FROM public.inventory_movements m
          WHERE m.movement_date BETWEEN v_from AND v_to
            AND m.movement_type IN ('sale', 'sale_return')
          GROUP BY m.product_id
        ) mv ON mv.product_id = p.id
      ) x
    ) y
  ) z;

  RETURN jsonb_build_object(
    'date_from', v_from,
    'date_to', v_to,
    'period_days', v_days,
    'opening_value', round(v_open, 2),
    'closing_value', round(v_close, 2),
    'average_value', v_avg,
    'purchases_value', round(v_purchases, 2),
    'cogs', round(v_cogs, 2),
    'revenue', round(v_revenue, 2),
    'gross_profit', round(v_revenue - v_cogs, 2),
    'turnover', v_turnover,
    'dio', CASE WHEN v_turnover > 0 THEN round(365 / v_turnover, 1) ELSE NULL END,
    'gmroi', CASE WHEN v_avg > 0 THEN round((v_revenue - v_cogs) / v_avg, 2) ELSE NULL END,
    'rows', v_rows
  );
END;
$function$
;

REVOKE ALL ON FUNCTION public.get_inventory_kpis(p_date_from date, p_date_to date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_kpis(p_date_from date, p_date_to date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_inventory_reorder(p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_lead_time_days integer DEFAULT NULL::integer, p_target_days integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_to date := COALESCE(p_date_to, current_date);
  v_from date := COALESCE(p_date_from, v_to - 90);
  v_days integer := GREATEST((v_to - v_from) + 1, 1);
  v_lead integer;
  v_target integer;
  v_rows jsonb;
BEGIN
  SELECT COALESCE(p_lead_time_days, inventory_lead_time_days, 7),
         COALESCE(p_target_days, inventory_target_cover_days, 30)
    INTO v_lead, v_target
  FROM public.company_settings
  LIMIT 1;

  v_lead := COALESCE(v_lead, COALESCE(p_lead_time_days, 7));
  v_target := COALESCE(v_target, COALESCE(p_target_days, 30));

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.shortage_cost DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      p.id AS product_id,
      p.code,
      p.name,
      p.model_number,
      b.name AS brand_name,
      c.name AS category_name,
      COALESCE(s.quantity, 0) AS quantity,
      p.min_stock_level AS safety_stock,
      COALESCE(s.wac, p.purchase_price, 0) AS unit_cost,
      ls.supplier_id AS last_supplier_id,
      ls.supplier_name AS last_supplier_name,
      ls.invoice_date AS last_purchase_date,
      ls.unit_price AS last_purchase_price,
      round(COALESCE(period.net_sold, 0) / v_days::numeric, 3) AS avg_daily_sales,
      COALESCE(period.net_sold, 0) AS period_sold,
      v_lead AS lead_time_days,
      v_target AS target_cover_days,
      round(
        (COALESCE(period.net_sold, 0) / v_days::numeric) * v_lead + COALESCE(p.min_stock_level, 0)
      , 2) AS reorder_point,
      CASE
        WHEN COALESCE(period.net_sold, 0) > 0
        THEN round(COALESCE(s.quantity, 0) / (COALESCE(period.net_sold, 0) / v_days::numeric), 1)
        ELSE NULL
      END AS days_of_cover,
      GREATEST(
        ceil(
          (COALESCE(period.net_sold, 0) / v_days::numeric) * v_target
          + COALESCE(p.min_stock_level, 0)
          - COALESCE(s.quantity, 0)
        ), 0
      ) AS suggested_qty,
      round(
        GREATEST(
          ceil(
            (COALESCE(period.net_sold, 0) / v_days::numeric) * v_target
            + COALESCE(p.min_stock_level, 0)
            - COALESCE(s.quantity, 0)
          ), 0
        ) * COALESCE(s.wac, p.purchase_price, 0)
      , 2) AS shortage_cost
    FROM public.products p
    LEFT JOIN public.inventory_product_state(v_to) s ON s.product_id = p.id
    LEFT JOIN public.product_brands b ON b.id = p.brand_id
    LEFT JOIN public.product_categories c ON c.id = p.category_id
    LEFT JOIN LATERAL (
      SELECT sup.id AS supplier_id, sup.name AS supplier_name, pi.invoice_date, pii.unit_price
      FROM public.purchase_invoice_items pii
      JOIN public.purchase_invoices pi ON pi.id = pii.invoice_id
      LEFT JOIN public.suppliers sup ON sup.id = pi.supplier_id
      WHERE pii.product_id = p.id
        AND pi.status = 'posted'
      ORDER BY pi.invoice_date DESC, pi.posted_number DESC NULLS LAST, pi.created_at DESC
      LIMIT 1
    ) ls ON true
    LEFT JOIN (
      SELECT m.product_id,
             SUM(CASE WHEN m.movement_type = 'sale' THEN abs(m.quantity)
                      WHEN m.movement_type = 'sale_return' THEN -abs(m.quantity)
                      ELSE 0 END) AS net_sold
      FROM public.inventory_movements m
      WHERE m.movement_date BETWEEN v_from AND v_to
        AND m.movement_type IN ('sale', 'sale_return')
      GROUP BY m.product_id
    ) period ON period.product_id = p.id
    WHERE p.is_active
      AND (
        COALESCE(s.quantity, 0) <=
          (COALESCE(period.net_sold, 0) / v_days::numeric) * v_lead + COALESCE(p.min_stock_level, 0)
      )
      AND (COALESCE(period.net_sold, 0) > 0 OR COALESCE(p.min_stock_level, 0) > 0)
  ) x;

  RETURN jsonb_build_object(
    'date_from', v_from,
    'date_to', v_to,
    'period_days', v_days,
    'lead_time_days', v_lead,
    'target_cover_days', v_target,
    'rows', v_rows
  );
END;
$function$
;

REVOKE ALL ON FUNCTION public.get_inventory_reorder(p_date_from date, p_date_to date, p_lead_time_days integer, p_target_days integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_reorder(p_date_from date, p_date_to date, p_lead_time_days integer, p_target_days integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_inventory_valuation(p_as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_as_of date := COALESCE(p_as_of, current_date);
  v_gl numeric;
  v_rows jsonb;
BEGIN
  SELECT COALESCE(SUM(l.debit - l.credit), 0)
    INTO v_gl
  FROM public.journal_entry_lines l
  JOIN public.journal_entries e ON e.id = l.journal_entry_id
  JOIN public.accounts a ON a.id = l.account_id
  WHERE a.code = '1104'
    AND e.status = 'posted'
    AND e.entry_date <= v_as_of;

  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'value')::numeric DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT to_jsonb(x) AS r
    FROM (
      SELECT
        p.id AS product_id,
        p.code,
        p.name,
        p.model_number,
        b.name AS brand_name,
        c.name AS category_name,
        p.is_active,
        COALESCE(s.quantity, 0) AS quantity,
        COALESCE(s.wac, p.purchase_price, 0) AS unit_cost,
        round(COALESCE(s.quantity, 0) * COALESCE(s.wac, p.purchase_price, 0), 2) AS value,
        COALESCE(s.moves_value, 0) AS moves_value,
        ls.supplier_name AS last_supplier_name,
        ls.invoice_date AS last_purchase_date,
        ls.unit_price AS last_purchase_price
      FROM public.products p
      LEFT JOIN public.inventory_product_state(v_as_of) s ON s.product_id = p.id
      LEFT JOIN public.product_brands b ON b.id = p.brand_id
      LEFT JOIN public.product_categories c ON c.id = p.category_id
      LEFT JOIN LATERAL (
        SELECT sup.name AS supplier_name, pi.invoice_date, pii.unit_price
        FROM public.purchase_invoice_items pii
        JOIN public.purchase_invoices pi ON pi.id = pii.invoice_id
        LEFT JOIN public.suppliers sup ON sup.id = pi.supplier_id
        WHERE pii.product_id = p.id
          AND pi.status = 'posted'
          AND pi.invoice_date <= v_as_of
        ORDER BY pi.invoice_date DESC, pi.posted_number DESC NULLS LAST, pi.created_at DESC
        LIMIT 1
      ) ls ON true
      WHERE COALESCE(s.quantity, 0) <> 0 OR COALESCE(s.moves_value, 0) <> 0
    ) x
  ) y;

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'gl_balance', round(v_gl, 2),
    'total_value', (SELECT round(COALESCE(SUM((r->>'value')::numeric), 0), 2) FROM jsonb_array_elements(v_rows) r),
    'total_moves_value', (SELECT round(COALESCE(SUM((r->>'moves_value')::numeric), 0), 2) FROM jsonb_array_elements(v_rows) r),
    'total_quantity', (SELECT round(COALESCE(SUM((r->>'quantity')::numeric), 0), 2) FROM jsonb_array_elements(v_rows) r),
    'rows', v_rows
  );
END;
$function$
;

REVOKE ALL ON FUNCTION public.get_inventory_valuation(p_as_of date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_valuation(p_as_of date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_ledger_active_accounts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  FROM (
    SELECT DISTINCT a.id, a.code, a.name, a.account_type
    FROM accounts a
    JOIN journal_entry_lines jel ON jel.account_id = a.id
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.status = 'posted' AND a.is_active = true
    ORDER BY a.code
  ) t;
$function$
;

REVOKE ALL ON FUNCTION public.get_ledger_active_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ledger_active_accounts() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_ledger_lines(p_account_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lines jsonb;
  v_total_count int := 0;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
BEGIN
  WITH base AS (
    SELECT
      jel.debit::numeric AS debit,
      jel.credit::numeric AS credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.status = 'posted'
      AND (p_account_id IS NULL OR jel.account_id = p_account_id)
      AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
      AND (p_date_to IS NULL OR je.entry_date <= p_date_to)
  )
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(debit), 0),
    COALESCE(SUM(credit), 0)
  INTO v_total_count, v_total_debit, v_total_credit
  FROM base;

  WITH base AS (
    SELECT
      jel.id, jel.journal_entry_id, jel.account_id,
      jel.debit::numeric, jel.credit::numeric, jel.description,
      je.entry_number, je.posted_number AS entry_posted_number,
      je.entry_date, je.description AS entry_description, je.status AS entry_status,
      a.code AS account_code, a.name AS account_name,
      jel.created_at
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE je.status = 'posted'
      AND (p_account_id IS NULL OR jel.account_id = p_account_id)
      AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
      AND (p_date_to IS NULL OR je.entry_date <= p_date_to)
  ),
  ordered AS (
    SELECT
      *,
      CASE WHEN p_account_id IS NOT NULL THEN
        SUM(debit - credit) OVER (
          ORDER BY entry_posted_number NULLS LAST, entry_date, created_at
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
      ELSE 0 END AS running_balance
    FROM base
  )
  SELECT jsonb_agg(row_to_json(t))
  INTO v_lines
  FROM (
    SELECT * FROM ordered
    ORDER BY entry_posted_number NULLS LAST, entry_date, created_at
    OFFSET p_offset LIMIT p_limit
  ) t;

  RETURN jsonb_build_object(
    'lines', COALESCE(v_lines, '[]'::jsonb),
    'total_count', v_total_count,
    'total_debit', v_total_debit,
    'total_credit', v_total_credit,
    'net_balance', v_total_debit - v_total_credit
  );
END;
$function$
;

REVOKE ALL ON FUNCTION public.get_ledger_lines(p_account_id uuid, p_date_from date, p_date_to date, p_limit integer, p_offset integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ledger_lines(p_account_id uuid, p_date_from date, p_date_to date, p_limit integer, p_offset integer) TO authenticated, service_role;
