-- Compatibility scaffolding only inside the frozen L3 transaction. The
-- production Stage 3 tables/column exist on Staging but not in this snapshot.
CREATE TABLE public.inventory_variance_operations (
  source_type text NOT NULL,
  source_id uuid NOT NULL
);
ALTER TABLE public.inventory_adjustments ADD COLUMN posted_number integer;
CREATE FUNCTION public.post_inventory_adjustment_atomic(uuid,uuid)
RETURNS jsonb LANGUAGE sql AS $test$ SELECT '{}'::jsonb $test$;

-- The frozen public-only L3 restore has inert auth stubs. Give this transaction
-- Supabase-compatible claims to exercise the real authorization gate.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $test$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$test$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $test$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '')
$test$;

CREATE FUNCTION public.test_inventory_draft_insert_failure()
RETURNS trigger LANGUAGE plpgsql AS $test$
BEGIN
  IF NEW.notes = 'FORCE_FAIL' THEN
    RAISE EXCEPTION 'DRAFT_SAVE_INJECTED_INSERT_FAILURE';
  END IF;
  RETURN NEW;
END;
$test$;
CREATE TRIGGER test_inventory_draft_insert_failure
BEFORE INSERT ON public.inventory_adjustment_items
FOR EACH ROW EXECUTE FUNCTION public.test_inventory_draft_insert_failure();
