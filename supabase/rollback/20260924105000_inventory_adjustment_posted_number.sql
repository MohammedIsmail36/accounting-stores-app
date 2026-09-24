-- Rehearsal-only rollback. Refuse after the first real atomic posting.
BEGIN;
SET LOCAL lock_timeout='5s';

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
       AND table_name='inventory_adjustments' AND column_name='posted_number')
     OR EXISTS (SELECT 1 FROM public.inventory_adjustments WHERE posted_number IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.inventory_variance_operations
       WHERE source_type='adjustment' AND operation_kind='post') THEN
    RAISE EXCEPTION 'INVENTORY_ADJUSTMENT_NUMBER_ROLLBACK_UNSAFE';
  END IF;
END;
$preflight$;

DO $patch$
DECLARE v_source text; v_new text; v_old text; v_replacement text;
BEGIN
  SELECT pg_get_functiondef('public.post_inventory_adjustment_atomic_base(uuid,uuid)'::regprocedure)
    INTO v_source;
  v_new := v_source;
  v_old := E'  v_locked_until date;\n  v_posted_number integer;\nBEGIN';
  v_replacement := E'  v_locked_until date;\nBEGIN';
  IF v_new IS NULL OR length(v_new)-length(replace(v_new,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_POST_GATEWAY_CHANGED'; END IF;
  v_new := replace(v_new,v_old,v_replacement);

  v_old := E'  v_posted_number := public.next_inventory_adjustment_posted_number();\n\n  INSERT INTO public.inventory_variance_operations(\n    source_type,source_id,operation_kind,request_id,actor_id';
  v_replacement := E'  INSERT INTO public.inventory_variance_operations(\n    source_type,source_id,operation_kind,request_id,actor_id';
  IF length(v_new)-length(replace(v_new,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_POST_GATEWAY_CHANGED'; END IF;
  v_new := replace(v_new,v_old,v_replacement);

  v_old := '''تسوية مخزون رقم ADJ-'' || lpad(v_posted_number::text,4,''0'')';
  v_replacement := '''تسوية مخزون رقم ADJ-'' || v_doc.adjustment_number';
  IF length(v_new)-length(replace(v_new,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_POST_GATEWAY_CHANGED'; END IF;
  v_new := replace(v_new,v_old,v_replacement);

  v_old := E'UPDATE public.inventory_adjustments SET status = ''posted'',\n    posted_number = v_posted_number, journal_entry_id = v_journal_id, updated_at = now()';
  v_replacement := E'UPDATE public.inventory_adjustments SET status = ''posted'',\n    journal_entry_id = v_journal_id, updated_at = now()';
  IF length(v_new)-length(replace(v_new,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_POST_GATEWAY_CHANGED'; END IF;
  EXECUTE replace(v_new,v_old,v_replacement);

  SELECT pg_get_functiondef('public.reverse_inventory_adjustment_atomic_base(uuid,uuid,text)'::regprocedure)
    INTO v_source;
  v_old := '''عكس تسوية مخزون رقم ADJ-'' || COALESCE(lpad(v_doc.posted_number::text,4,''0''),v_doc.adjustment_number::text)';
  v_replacement := '''عكس تسوية مخزون رقم ADJ-'' || v_doc.adjustment_number';
  IF v_source IS NULL OR length(v_source)-length(replace(v_source,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_REVERSE_GATEWAY_CHANGED'; END IF;
  EXECUTE replace(v_source,v_old,v_replacement);
END;
$patch$;

DROP TRIGGER trg_guard_inventory_adjustment_posted_number ON public.inventory_adjustments;
DROP FUNCTION public.fn_guard_inventory_adjustment_posted_number();
DROP FUNCTION public.next_inventory_adjustment_posted_number();
DROP INDEX public.inventory_adjustments_posted_number_unique;
ALTER TABLE public.inventory_adjustments DROP CONSTRAINT inventory_adjustments_posted_number_valid;
ALTER TABLE public.inventory_adjustments DROP COLUMN posted_number;

COMMIT;
