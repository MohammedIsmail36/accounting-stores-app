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
$function$;

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

REVOKE ALL ON FUNCTION public.get_inventory_aging(date, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_inventory_reorder(date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_aging(date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inventory_reorder(date, date, integer, integer) TO authenticated;