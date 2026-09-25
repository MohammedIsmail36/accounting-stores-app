-- Phase 4C: structured reasons for adjustment lines. The existing save RPC
-- remains available during the UI cutover; posting refuses uncategorized lines.
DO $preflight$
BEGIN
  IF to_regprocedure('public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)') IS NULL
     OR to_regprocedure('public.save_inventory_adjustment_draft_with_reasons(uuid,timestamptz,date,text,jsonb)') IS NOT NULL
     OR to_regprocedure('public.post_inventory_adjustment_atomic(uuid,uuid)') IS NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='inventory_adjustment_items'
         AND column_name IN ('reason_code','reason_reference')) THEN
    RAISE EXCEPTION 'INVENTORY_ADJUSTMENT_REASONS_BASELINE_MISMATCH';
  END IF;
END $preflight$;

ALTER TABLE public.inventory_adjustment_items
  ADD COLUMN reason_code text,
  ADD COLUMN reason_reference text;

ALTER TABLE public.inventory_adjustment_items
  ADD CONSTRAINT inventory_adjustment_reason_code_check
  CHECK (reason_code IS NULL OR reason_code IN (
    'damage','loss','found_stock','internal_use','sample','prior_entry_error','other'
  )),
  ADD CONSTRAINT inventory_adjustment_reason_reference_check
  CHECK (reason_reference IS NULL OR length(btrim(reason_reference)) BETWEEN 1 AND 200);

CREATE FUNCTION public.save_inventory_adjustment_draft_with_reasons(
  p_adjustment_id uuid,
  p_expected_updated_at timestamptz,
  p_adjustment_date date,
  p_description text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_item jsonb;
  v_reason text;
  v_reference text;
  v_notes text;
  v_result jsonb;
  v_adjustment_id uuid;
  v_count integer;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'INVENTORY_DRAFT_INPUT_INVALID';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'INVENTORY_DRAFT_ITEM_INVALID';
    END IF;
    v_reason := NULLIF(btrim(v_item->>'reason_code'), '');
    v_reference := NULLIF(btrim(v_item->>'reason_reference'), '');
    v_notes := NULLIF(btrim(v_item->>'notes'), '');
    IF v_reason IS NOT NULL AND v_reason NOT IN (
      'damage','loss','found_stock','internal_use','sample','prior_entry_error','other'
    ) THEN
      RAISE EXCEPTION 'INVENTORY_DRAFT_REASON_INVALID';
    END IF;
    IF NULLIF(v_item->>'actual_quantity','') IS NOT NULL
       AND NULLIF(v_item->>'system_quantity','') IS NOT NULL
       AND (v_item->>'actual_quantity')::numeric IS DISTINCT FROM
           (v_item->>'system_quantity')::numeric
       AND (v_reason IS NULL OR v_notes IS NULL) THEN
      RAISE EXCEPTION 'INVENTORY_DRAFT_REASON_REQUIRED';
    END IF;
    IF (v_reason = 'prior_entry_error' AND v_reference IS NULL)
       OR (v_reason IS DISTINCT FROM 'prior_entry_error' AND v_reference IS NOT NULL)
       OR (v_reference IS NOT NULL AND length(v_reference) > 200) THEN
      RAISE EXCEPTION 'INVENTORY_DRAFT_REASON_REFERENCE_INVALID';
    END IF;
  END LOOP;

  -- Both functions run in the same PostgreSQL statement/transaction. A failure
  -- while attaching reason fields rolls back the original header and lines.
  v_result := public.save_inventory_adjustment_draft(
    p_adjustment_id, p_expected_updated_at, p_adjustment_date, p_description, p_items
  );
  v_adjustment_id := (v_result->>'adjustment_id')::uuid;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    UPDATE public.inventory_adjustment_items
    SET reason_code = NULLIF(btrim(v_item->>'reason_code'), ''),
        reason_reference = NULLIF(btrim(v_item->>'reason_reference'), '')
    WHERE adjustment_id = v_adjustment_id
      AND product_id = (v_item->>'product_id')::uuid;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'INVENTORY_DRAFT_REASON_ITEM_MISMATCH';
    END IF;
  END LOOP;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_inventory_adjustment_draft_with_reasons(
  uuid,timestamptz,date,text,jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_inventory_adjustment_draft_with_reasons(
  uuid,timestamptz,date,text,jsonb
) TO authenticated, service_role;

CREATE FUNCTION public.fn_require_inventory_adjustment_reason_on_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted'
     AND EXISTS (
       SELECT 1 FROM public.inventory_adjustment_items item
       WHERE item.adjustment_id = NEW.id AND item.difference <> 0
         AND (item.reason_code IS NULL
           OR NULLIF(btrim(COALESCE(item.notes,'')), '') IS NULL
           OR (item.reason_code = 'prior_entry_error'
             AND NULLIF(btrim(COALESCE(item.reason_reference,'')), '') IS NULL))
     ) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_REASON_CODE_REQUIRED';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_require_inventory_adjustment_reason_on_post()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER require_inventory_adjustment_reason_on_post
BEFORE UPDATE OF status ON public.inventory_adjustments
FOR EACH ROW EXECUTE FUNCTION public.fn_require_inventory_adjustment_reason_on_post();
