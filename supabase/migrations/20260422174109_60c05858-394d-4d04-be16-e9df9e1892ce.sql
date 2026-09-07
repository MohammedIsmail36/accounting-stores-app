CREATE OR REPLACE FUNCTION public.get_products_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total_count', COUNT(*),
    'active_count', COUNT(*) FILTER (WHERE is_active = true),
    'inactive_count', COUNT(*) FILTER (WHERE is_active = false),
    'available_count', COUNT(*) FILTER (WHERE is_active = true AND quantity_on_hand > 0),
    'low_stock_count', COUNT(*) FILTER (WHERE is_active = true AND quantity_on_hand > 0 AND min_stock_level > 0 AND quantity_on_hand < min_stock_level),
    'out_of_stock_count', COUNT(*) FILTER (WHERE is_active = true AND quantity_on_hand <= 0),
    'total_value', COALESCE(SUM(quantity_on_hand * purchase_price) FILTER (WHERE is_active = true), 0),
    'total_stock_value', COALESCE(SUM(quantity_on_hand * purchase_price) FILTER (WHERE is_active = true), 0)
  )
  FROM products
$function$;