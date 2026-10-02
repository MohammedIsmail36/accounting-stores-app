BEGIN;
SET LOCAL lock_timeout = '5s';
DROP INDEX public.historical_sale_cost_by_movement;
COMMIT;
