-- Explicit emergency rollback for the stage 2C product-card executor.
-- The caller must authorize this rollback transaction-locally. The rollback
-- refuses to remove the executor after it has produced a real execution.

DO $guard$
BEGIN
  IF current_setting('app.inventory_rebuild_rollback_authorized', true)
     IS DISTINCT FROM 'STAGING_20260914190000' THEN
    RAISE EXCEPTION 'INVENTORY_REBUILD_ROLLBACK_NOT_AUTHORIZED';
  END IF;
  IF to_regprocedure(
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'
  ) IS NULL OR position(
    'product_card_rebuilt' IN pg_get_functiondef(
      'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'::regprocedure
    )
  ) = 0 THEN
    RAISE EXCEPTION 'INVENTORY_REBUILD_ROLLBACK_OBJECTS_MISSING';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.inventory_reconciliation_repairs r
    JOIN public.inventory_reconciliation_repair_items i ON i.repair_id = r.id
    WHERE r.status = 'executed'
      AND i.repair_type = 'rebuild_product_card'
  ) THEN
    RAISE EXCEPTION 'INVENTORY_REBUILD_ROLLBACK_HAS_EXECUTIONS';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.execute_inventory_reconciliation_repair(
  p_id uuid,
  p_expected_version integer,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid;
  v_repair public.inventory_reconciliation_repairs%ROWTYPE;
BEGIN
  v_actor := public.inventory_reconciliation_repair_require_actor(true);
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'REPAIR_REQUEST_ID_REQUIRED' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_repair
  FROM public.inventory_reconciliation_repairs
  WHERE id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPAIR_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_repair.status <> 'approved' THEN
    RAISE EXCEPTION 'REPAIR_STATUS_INVALID' USING ERRCODE = '55000';
  END IF;
  IF v_repair.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'REPAIR_VERSION_CONFLICT' USING ERRCODE = '40001';
  END IF;
  RAISE EXCEPTION 'REPAIR_TYPE_NOT_ENABLED' USING ERRCODE = '0A000';
END;
$function$;

REVOKE ALL ON FUNCTION public.execute_inventory_reconciliation_repair(uuid, integer, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_inventory_reconciliation_repair(uuid, integer, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.execute_inventory_reconciliation_repair(uuid, integer, uuid)
  IS 'Stage 2B guard restored by explicit rollback: validates approval then always raises REPAIR_TYPE_NOT_ENABLED without business writes.';
