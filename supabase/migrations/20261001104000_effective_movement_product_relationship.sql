-- Explicit PostgREST relationship for the cost view's product embedding.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$ BEGIN
  IF to_regclass('public.inventory_movements_effective_cost') IS NULL
     OR to_regprocedure('public.products(public.inventory_movements_effective_cost)') IS NOT NULL
  THEN RAISE EXCEPTION 'EFFECTIVE_MOVEMENT_PRODUCT_RELATIONSHIP_BASELINE_MISMATCH'; END IF;
END $guard$;
CREATE FUNCTION public.products(public.inventory_movements_effective_cost)
RETURNS SETOF public.products ROWS 1
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
  SELECT p.* FROM public.products p WHERE p.id = $1.product_id;
$function$;
REVOKE ALL ON FUNCTION public.products(public.inventory_movements_effective_cost)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.products(public.inventory_movements_effective_cost)
  TO authenticated, service_role;
COMMIT;
