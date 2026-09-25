-- Phase 4B: delete a draft and its items as one checked operation.
-- Direct API table deletes are withdrawn at the UI cutover; the function owns
-- the cascade and holds the document lock until commit.
DO $preflight$
BEGIN
  IF to_regprocedure('public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)') IS NULL
     OR to_regprocedure('public.delete_inventory_adjustment_draft(uuid,timestamptz)') IS NOT NULL
     OR to_regclass('public.inventory_variance_operations') IS NULL
     OR NOT has_table_privilege('authenticated','public.inventory_adjustments','DELETE')
     OR NOT has_table_privilege('authenticated','public.inventory_adjustment_items','DELETE') THEN
    RAISE EXCEPTION 'INVENTORY_DRAFT_DELETE_BASELINE_MISMATCH';
  END IF;
END $preflight$;

CREATE FUNCTION public.delete_inventory_adjustment_draft(
  p_adjustment_id uuid,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_doc public.inventory_adjustments%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'INVENTORY_DRAFT_DELETE_PERMISSION_DENIED';
  END IF;
  IF p_adjustment_id IS NULL OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_DRAFT_DELETE_INPUT_INVALID';
  END IF;

  SELECT * INTO v_doc FROM public.inventory_adjustments
  WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_DRAFT_DELETE_NOT_FOUND'; END IF;
  IF v_doc.status <> 'draft' OR v_doc.journal_entry_id IS NOT NULL
     OR v_doc.posted_number IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.inventory_variance_operations
       WHERE source_type = 'adjustment' AND source_id = p_adjustment_id)
     OR EXISTS (SELECT 1 FROM public.inventory_movements
       WHERE reference_id = p_adjustment_id
         AND reference_type IN ('adjustment','inventory_adjustment')) THEN
    RAISE EXCEPTION 'INVENTORY_DRAFT_DELETE_STATUS_CHANGED';
  END IF;
  IF v_doc.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'INVENTORY_DRAFT_DELETE_VERSION_CHANGED';
  END IF;

  -- inventory_adjustment_items has ON DELETE CASCADE. If its deletion fails,
  -- PostgreSQL rolls back the parent deletion in the same statement/transaction.
  DELETE FROM public.inventory_adjustments WHERE id = p_adjustment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_DRAFT_DELETE_NOT_FOUND'; END IF;
  RETURN jsonb_build_object('deleted', true, 'adjustment_id', p_adjustment_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_inventory_adjustment_draft(uuid,timestamptz)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_inventory_adjustment_draft(uuid,timestamptz)
  TO authenticated;

REVOKE DELETE ON public.inventory_adjustments, public.inventory_adjustment_items
  FROM PUBLIC, anon, authenticated;
