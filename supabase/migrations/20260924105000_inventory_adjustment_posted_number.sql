-- A draft keeps its internal adjustment_number (#18). The official ADJ-
-- number is reserved only by a successful atomic posting transaction.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regclass('public.inventory_variance_operations') IS NULL
     OR to_regprocedure('public.post_inventory_adjustment_atomic_base(uuid,uuid)') IS NULL
     OR to_regprocedure('public.reverse_inventory_adjustment_atomic_base(uuid,uuid,text)') IS NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
       AND table_name='inventory_adjustments' AND column_name='posted_number')
     OR EXISTS (SELECT 1 FROM public.inventory_variance_operations
       WHERE source_type='adjustment' AND operation_kind='post') THEN
    RAISE EXCEPTION 'INVENTORY_ADJUSTMENT_POSTED_NUMBER_BASELINE_MISMATCH';
  END IF;
END;
$preflight$;

ALTER TABLE public.inventory_adjustments ADD COLUMN posted_number integer;
ALTER TABLE public.inventory_adjustments ADD CONSTRAINT inventory_adjustments_posted_number_valid
  CHECK (posted_number IS NULL OR (posted_number > 0 AND status IN ('posted','cancelled')));
CREATE UNIQUE INDEX inventory_adjustments_posted_number_unique
  ON public.inventory_adjustments(posted_number) WHERE posted_number IS NOT NULL;
COMMENT ON COLUMN public.inventory_adjustments.posted_number IS
  'Official number allocated only when an atomic stock adjustment posts. NULL on drafts and historical rows.';

CREATE FUNCTION public.next_inventory_adjustment_posted_number()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('inventory_adjustments.posted_number'));
  SELECT COALESCE(max(posted_number),0)+1 INTO v_next
  FROM public.inventory_adjustments;
  -- Historical posted/approved rows did not have a separate posted_number.
  -- Keep their displayed ADJ numbers without letting synthetic high-number
  -- acceptance fixtures force all future official numbers into that range.
  WHILE EXISTS (SELECT 1 FROM public.inventory_adjustments
    WHERE status IN ('posted','cancelled','approved') AND posted_number IS NULL
      AND adjustment_number=v_next) LOOP
    v_next := v_next + 1;
  END LOOP;
  RETURN v_next;
END;
$function$;
REVOKE ALL ON FUNCTION public.next_inventory_adjustment_posted_number()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_guard_inventory_adjustment_posted_number()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $function$
BEGIN
  IF current_user IN ('anon','authenticated','service_role')
     AND ((TG_OP='INSERT' AND NEW.posted_number IS NOT NULL)
       OR (TG_OP='UPDATE' AND NEW.posted_number IS DISTINCT FROM OLD.posted_number)) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_DIRECT_WRITE_DENIED';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_guard_inventory_adjustment_posted_number
BEFORE INSERT OR UPDATE ON public.inventory_adjustments
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_inventory_adjustment_posted_number();
REVOKE ALL ON FUNCTION public.fn_guard_inventory_adjustment_posted_number()
  FROM PUBLIC,anon,authenticated,service_role;

-- Change only the numbered label and number allocation within the existing,
-- already-hardened atomic gateway. Keep all product/account/period guards.
DO $patch$
DECLARE
  v_source text;
  v_new text;
  v_old text;
  v_replacement text;
BEGIN
  SELECT pg_get_functiondef('public.post_inventory_adjustment_atomic_base(uuid,uuid)'::regprocedure)
    INTO v_source;
  IF v_source IS NULL THEN RAISE EXCEPTION 'INVENTORY_VARIANCE_POST_GATEWAY_MISSING'; END IF;
  v_new := v_source;
  v_old := E'  v_locked_until date;\nBEGIN';
  v_replacement := E'  v_locked_until date;\n  v_posted_number integer;\nBEGIN';
  IF length(v_new)-length(replace(v_new,v_old,'')) <> length(v_old) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_POST_GATEWAY_CHANGED';
  END IF;
  v_new := replace(v_new,v_old,v_replacement);

  v_old := E'  INSERT INTO public.inventory_variance_operations(\n    source_type,source_id,operation_kind,request_id,actor_id';
  v_replacement := E'  v_posted_number := public.next_inventory_adjustment_posted_number();\n\n  INSERT INTO public.inventory_variance_operations(\n    source_type,source_id,operation_kind,request_id,actor_id';
  IF length(v_new)-length(replace(v_new,v_old,'')) <> length(v_old) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_POST_GATEWAY_CHANGED';
  END IF;
  v_new := replace(v_new,v_old,v_replacement);

  v_old := '''تسوية مخزون رقم ADJ-'' || v_doc.adjustment_number';
  v_replacement := '''تسوية مخزون رقم ADJ-'' || lpad(v_posted_number::text,4,''0'')';
  IF length(v_new)-length(replace(v_new,v_old,'')) <> length(v_old) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_POST_GATEWAY_CHANGED';
  END IF;
  v_new := replace(v_new,v_old,v_replacement);

  v_old := E'UPDATE public.inventory_adjustments SET status = ''posted'',\n    journal_entry_id = v_journal_id, updated_at = now()';
  v_replacement := E'UPDATE public.inventory_adjustments SET status = ''posted'',\n    posted_number = v_posted_number, journal_entry_id = v_journal_id, updated_at = now()';
  IF length(v_new)-length(replace(v_new,v_old,'')) <> length(v_old) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_POST_GATEWAY_CHANGED';
  END IF;
  EXECUTE replace(v_new,v_old,v_replacement);

  SELECT pg_get_functiondef('public.reverse_inventory_adjustment_atomic_base(uuid,uuid,text)'::regprocedure)
    INTO v_source;
  v_old := '''عكس تسوية مخزون رقم ADJ-'' || v_doc.adjustment_number';
  v_replacement := '''عكس تسوية مخزون رقم ADJ-'' || COALESCE(lpad(v_doc.posted_number::text,4,''0''),v_doc.adjustment_number::text)';
  IF v_source IS NULL OR length(v_source)-length(replace(v_source,v_old,'')) <> length(v_old) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_REVERSE_GATEWAY_CHANGED';
  END IF;
  EXECUTE replace(v_source,v_old,v_replacement);
END;
$patch$;

COMMIT;
