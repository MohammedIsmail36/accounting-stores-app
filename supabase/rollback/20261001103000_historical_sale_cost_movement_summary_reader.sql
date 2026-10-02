BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$ BEGIN
  IF to_regclass('public.inventory_movements_effective_cost') IS NULL THEN
    RAISE EXCEPTION 'HISTORICAL_SALE_COST_SUMMARY_ROLLBACK_MISSING_VIEW'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.get_inventory_movements_summary_finance_internal(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_product_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH mv AS (
    SELECT movement_type, quantity, total_cost
    FROM inventory_movements
    WHERE (p_date_from IS NULL OR movement_date >= p_date_from)
      AND (p_date_to IS NULL OR movement_date <= p_date_to)
      AND (p_product_id IS NULL OR product_id = p_product_id)
  ),
  by_type AS (
    SELECT movement_type::text AS mt, COUNT(*)::int AS cnt
    FROM mv
    GROUP BY movement_type
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT COUNT(*) FROM mv),
    'in_qty',  (SELECT COALESCE(SUM(quantity), 0)   FROM mv WHERE movement_type IN ('purchase','opening_balance','sale_return')),
    'out_qty', (SELECT COALESCE(SUM(quantity), 0)   FROM mv WHERE movement_type IN ('sale','purchase_return')),
    'in_value',(SELECT COALESCE(SUM(total_cost), 0) FROM mv WHERE movement_type IN ('purchase','opening_balance','sale_return')),
    'out_value',(SELECT COALESCE(SUM(total_cost), 0) FROM mv WHERE movement_type IN ('sale','purchase_return')),
    'total_in',  (SELECT COALESCE(SUM(quantity), 0)   FROM mv WHERE movement_type IN ('purchase','opening_balance','sale_return')),
    'total_out', (SELECT COALESCE(SUM(quantity), 0)   FROM mv WHERE movement_type IN ('sale','purchase_return')),
    'total_value', (SELECT COALESCE(SUM(total_cost), 0) FROM mv),
    'adjustment_count', (SELECT COUNT(*) FROM mv WHERE movement_type = 'adjustment'),
    'by_type', COALESCE((SELECT jsonb_object_agg(mt, cnt) FROM by_type), '{}'::jsonb)
  )
$$;
COMMIT;
