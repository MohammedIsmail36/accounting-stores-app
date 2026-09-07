
CREATE OR REPLACE FUNCTION public.check_duplicate_brand_model()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  existing_record RECORD;
BEGIN
  -- Only check if both brand_id and model_number are provided
  IF NEW.brand_id IS NOT NULL AND NEW.model_number IS NOT NULL AND NEW.model_number != '' THEN
    SELECT code, name INTO existing_record
    FROM public.products
    WHERE brand_id = NEW.brand_id
      AND model_number = NEW.model_number
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND is_active = true
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'يوجد صنف بنفس الماركة ونفس رقم الموديل: % - %', existing_record.code, existing_record.name;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_duplicate_brand_model
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.check_duplicate_brand_model();
