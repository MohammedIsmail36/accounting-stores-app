CREATE FUNCTION public.test_inventory_draft_delete_failure()
RETURNS trigger LANGUAGE plpgsql AS $test$
BEGIN
  IF OLD.notes = 'FORCE_DELETE_FAIL' THEN
    RAISE EXCEPTION 'DRAFT_DELETE_INJECTED_CHILD_FAILURE';
  END IF;
  RETURN OLD;
END;
$test$;
CREATE TRIGGER test_inventory_draft_delete_failure
BEFORE DELETE ON public.inventory_adjustment_items
FOR EACH ROW EXECUTE FUNCTION public.test_inventory_draft_delete_failure();
