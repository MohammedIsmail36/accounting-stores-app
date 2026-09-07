-- Trigger to enforce: show_tax_on_invoice cannot be true if enable_tax is false
CREATE OR REPLACE FUNCTION public.fn_sync_tax_display_setting()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- إذا الضريبة معطلة، إجبار إخفاؤها من الفواتير المطبوعة
  IF NEW.enable_tax IS NOT TRUE THEN
    NEW.show_tax_on_invoice := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_tax_display_setting ON public.company_settings;
CREATE TRIGGER trg_sync_tax_display_setting
BEFORE INSERT OR UPDATE ON public.company_settings
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_tax_display_setting();

-- تنظيف البيانات الحالية لضمان الاتساق
UPDATE public.company_settings
SET show_tax_on_invoice = false
WHERE enable_tax = false AND show_tax_on_invoice = true;