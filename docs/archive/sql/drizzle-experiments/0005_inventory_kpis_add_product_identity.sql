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
$function$;

REVOKE ALL ON FUNCTION public.get_inventory_kpis(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_kpis(date, date) TO authenticated;