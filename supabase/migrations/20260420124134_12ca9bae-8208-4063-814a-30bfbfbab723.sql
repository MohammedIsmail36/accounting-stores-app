
-- ============================================
-- Account Statement RPC (Customer/Supplier)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_account_statement(
  p_entity_type text,
  p_entity_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_lines jsonb;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_total_count int := 0;
BEGIN
  -- Build unified statement lines using a CTE with running balance
  WITH all_lines AS (
    -- Customer flows
    SELECT
      si.invoice_date AS line_date,
      'فاتورة مبيعات'::text AS line_type,
      si.invoice_number AS doc_number,
      si.posted_number AS doc_posted_number,
      si.status AS doc_status,
      'sales_invoice'::text AS doc_kind,
      'فاتورة مبيعات'::text AS description,
      si.total::numeric AS debit,
      0::numeric AS credit,
      si.created_at AS sort_ts
    FROM sales_invoices si
    WHERE p_entity_type = 'customer'
      AND si.customer_id = p_entity_id
      AND si.status = 'posted'
      AND (p_date_from IS NULL OR si.invoice_date >= p_date_from)
      AND (p_date_to IS NULL OR si.invoice_date <= p_date_to)

    UNION ALL
    SELECT
      sr.return_date,
      'مرتجع مبيعات',
      sr.return_number,
      sr.posted_number,
      sr.status,
      'sales_return',
      'مرتجع مبيعات',
      0,
      sr.total::numeric,
      sr.created_at
    FROM sales_returns sr
    WHERE p_entity_type = 'customer'
      AND sr.customer_id = p_entity_id
      AND sr.status = 'posted'
      AND (p_date_from IS NULL OR sr.return_date >= p_date_from)
      AND (p_date_to IS NULL OR sr.return_date <= p_date_to)

    UNION ALL
    SELECT
      cp.payment_date,
      CASE WHEN EXISTS (
        SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id
      ) THEN 'رد مبلغ لعميل' ELSE 'سند قبض' END,
      cp.payment_number,
      cp.posted_number,
      cp.status,
      'customer_payment',
      CASE WHEN EXISTS (
        SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id
      ) THEN 'رد مبلغ مرتجع للعميل' ELSE 'تحصيل من العميل' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id
      ) THEN cp.amount::numeric ELSE 0 END,
      CASE WHEN EXISTS (
        SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id
      ) THEN 0 ELSE cp.amount::numeric END,
      cp.created_at
    FROM customer_payments cp
    WHERE p_entity_type = 'customer'
      AND cp.customer_id = p_entity_id
      AND cp.status = 'posted'
      AND (p_date_from IS NULL OR cp.payment_date >= p_date_from)
      AND (p_date_to IS NULL OR cp.payment_date <= p_date_to)

    -- Supplier flows
    UNION ALL
    SELECT
      pi.invoice_date,
      'فاتورة مشتريات',
      pi.invoice_number,
      pi.posted_number,
      pi.status,
      'purchase_invoice',
      'فاتورة مشتريات',
      0,
      pi.total::numeric,
      pi.created_at
    FROM purchase_invoices pi
    WHERE p_entity_type = 'supplier'
      AND pi.supplier_id = p_entity_id
      AND pi.status = 'posted'
      AND (p_date_from IS NULL OR pi.invoice_date >= p_date_from)
      AND (p_date_to IS NULL OR pi.invoice_date <= p_date_to)

    UNION ALL
    SELECT
      pr.return_date,
      'مرتجع مشتريات',
      pr.return_number,
      pr.posted_number,
      pr.status,
      'purchase_return',
      'مرتجع مشتريات',
      pr.total::numeric,
      0,
      pr.created_at
    FROM purchase_returns pr
    WHERE p_entity_type = 'supplier'
      AND pr.supplier_id = p_entity_id
      AND pr.status = 'posted'
      AND (p_date_from IS NULL OR pr.return_date >= p_date_from)
      AND (p_date_to IS NULL OR pr.return_date <= p_date_to)

    UNION ALL
    SELECT
      sp.payment_date,
      CASE WHEN EXISTS (
        SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id
      ) THEN 'مبلغ مسترد من مورد' ELSE 'سند صرف' END,
      sp.payment_number,
      sp.posted_number,
      sp.status,
      'supplier_payment',
      CASE WHEN EXISTS (
        SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id
      ) THEN 'استلام مبلغ مرتجع من المورد' ELSE 'دفعة للمورد' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id
      ) THEN 0 ELSE sp.amount::numeric END,
      CASE WHEN EXISTS (
        SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id
      ) THEN sp.amount::numeric ELSE 0 END,
      sp.created_at
    FROM supplier_payments sp
    WHERE p_entity_type = 'supplier'
      AND sp.supplier_id = p_entity_id
      AND sp.status = 'posted'
      AND (p_date_from IS NULL OR sp.payment_date >= p_date_from)
      AND (p_date_to IS NULL OR sp.payment_date <= p_date_to)
  ),
  ordered AS (
    SELECT
      *,
      SUM(debit - credit) OVER (
        ORDER BY line_date, sort_ts
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS running_balance,
      ROW_NUMBER() OVER (ORDER BY line_date, sort_ts) AS rn
    FROM all_lines
  ),
  totals AS (
    SELECT
      COALESCE(SUM(debit), 0) AS sum_debit,
      COALESCE(SUM(credit), 0) AS sum_credit,
      COUNT(*)::int AS cnt
    FROM all_lines
  )
  SELECT
    sum_debit, sum_credit, cnt
  INTO v_total_debit, v_total_credit, v_total_count
  FROM totals;

  -- Get paginated lines
  WITH all_lines AS (
    SELECT * FROM (
      -- Same union as above (re-evaluated; could be optimized with a temp table for very large sets)
      SELECT
        si.invoice_date AS line_date,
        'فاتورة مبيعات'::text AS line_type,
        si.invoice_number AS doc_number,
        si.posted_number AS doc_posted_number,
        si.status AS doc_status,
        'sales_invoice'::text AS doc_kind,
        'فاتورة مبيعات'::text AS description,
        si.total::numeric AS debit,
        0::numeric AS credit,
        si.created_at AS sort_ts
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
    ) u
  ),
  with_balance AS (
    SELECT
      line_date, line_type, doc_number, doc_posted_number, doc_status, doc_kind,
      description, debit, credit,
      SUM(debit - credit) OVER (ORDER BY line_date, sort_ts ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
    FROM all_lines
    ORDER BY line_date, sort_ts
  )
  SELECT jsonb_agg(row_to_json(t))
  INTO v_lines
  FROM (
    SELECT * FROM with_balance
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
$$;

-- ============================================
-- Ledger Lines RPC
-- ============================================
CREATE OR REPLACE FUNCTION public.get_ledger_lines(
  p_account_id uuid DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines jsonb;
  v_total_count int := 0;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
BEGIN
  WITH base AS (
    SELECT
      jel.id,
      jel.journal_entry_id,
      jel.account_id,
      jel.debit::numeric,
      jel.credit::numeric,
      jel.description,
      je.entry_number,
      je.posted_number AS entry_posted_number,
      je.entry_date,
      je.description AS entry_description,
      je.status AS entry_status,
      a.code AS account_code,
      a.name AS account_name,
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
      CASE
        WHEN p_account_id IS NOT NULL THEN
          SUM(debit - credit) OVER (ORDER BY entry_date, created_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
        ELSE 0
      END AS running_balance
    FROM base
    ORDER BY entry_date, created_at
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
        SUM(debit - credit) OVER (ORDER BY entry_date, created_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
      ELSE 0 END AS running_balance
    FROM base
  )
  SELECT jsonb_agg(row_to_json(t))
  INTO v_lines
  FROM (
    SELECT * FROM ordered
    ORDER BY entry_date, created_at
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
$$;

-- ============================================
-- Ledger active accounts (accounts with movements)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_ledger_active_accounts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  FROM (
    SELECT DISTINCT a.id, a.code, a.name, a.account_type
    FROM accounts a
    JOIN journal_entry_lines jel ON jel.account_id = a.id
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.status = 'posted' AND a.is_active = true
    ORDER BY a.code
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.get_account_statement(text, uuid, date, date, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ledger_lines(uuid, date, date, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ledger_active_accounts() TO authenticated;
