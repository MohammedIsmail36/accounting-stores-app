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
$function$;

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
$function$;

REVOKE ALL ON FUNCTION public.get_inventory_reorder(date, date, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_inventory_valuation(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_reorder(date, date, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_inventory_valuation(date) TO authenticated, service_role;