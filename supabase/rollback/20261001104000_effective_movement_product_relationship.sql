BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION public.products(public.inventory_movements_effective_cost);
COMMIT;
