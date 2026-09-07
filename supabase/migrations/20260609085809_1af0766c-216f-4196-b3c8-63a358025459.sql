
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS loyalty_enabled boolean NOT NULL DEFAULT true;

-- Update loyalty trigger to skip customers with loyalty disabled
CREATE OR REPLACE FUNCTION public.fn_loyalty_on_invoice_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_settings RECORD;
  v_customer RECORD;
  v_points_earned integer := 0;
  v_earning_base numeric := 0;
BEGIN
  IF NEW.status <> 'posted' OR OLD.status = 'posted' THEN RETURN NEW; END IF;
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  SELECT loyalty_enabled, loyalty_egp_per_point INTO v_settings FROM company_settings LIMIT 1;
  IF v_settings.loyalty_enabled IS NOT TRUE THEN RETURN NEW; END IF;
  IF COALESCE(v_settings.loyalty_egp_per_point, 0) <= 0 THEN RETURN NEW; END IF;

  -- Skip customers explicitly excluded from loyalty program
  SELECT loyalty_enabled INTO v_customer FROM customers WHERE id = NEW.customer_id;
  IF v_customer.loyalty_enabled IS NOT TRUE THEN RETURN NEW; END IF;

  v_earning_base := GREATEST(COALESCE(NEW.total,0) - COALESCE(NEW.tax,0) + COALESCE(NEW.loyalty_discount,0), 0);
  v_points_earned := FLOOR(v_earning_base / v_settings.loyalty_egp_per_point)::int;

  IF COALESCE(NEW.loyalty_points_redeemed,0) > 0 THEN
    INSERT INTO loyalty_transactions (customer_id, transaction_date, points, type, reference_type, reference_id, notes)
    VALUES (NEW.customer_id, NEW.invoice_date, -NEW.loyalty_points_redeemed, 'redeem', 'sales_invoice', NEW.id,
            format('استبدال على فاتورة #%s', COALESCE(NEW.posted_number::text, NEW.invoice_number::text)));
    UPDATE customers SET loyalty_points = COALESCE(loyalty_points,0) - NEW.loyalty_points_redeemed WHERE id = NEW.customer_id;
  END IF;

  IF v_points_earned > 0 THEN
    INSERT INTO loyalty_transactions (customer_id, transaction_date, points, type, reference_type, reference_id, notes)
    VALUES (NEW.customer_id, NEW.invoice_date, v_points_earned, 'earn', 'sales_invoice', NEW.id,
            format('كسب من فاتورة #%s', COALESCE(NEW.posted_number::text, NEW.invoice_number::text)));
    UPDATE customers SET loyalty_points = COALESCE(loyalty_points,0) + v_points_earned WHERE id = NEW.customer_id;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_loyalty_on_invoice_post() FROM PUBLIC, anon;

-- Guard: prevent disabling loyalty if customer still has points
CREATE OR REPLACE FUNCTION public.fn_guard_customer_loyalty_disable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.loyalty_enabled = true AND NEW.loyalty_enabled = false
     AND COALESCE(OLD.loyalty_points, 0) <> 0 THEN
    RAISE EXCEPTION 'لا يمكن إلغاء تفعيل الولاء لهذا العميل — يجب تصفير رصيد النقاط أولاً (الرصيد الحالي: % نقطة)', OLD.loyalty_points;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_customer_loyalty_disable ON public.customers;
CREATE TRIGGER trg_guard_customer_loyalty_disable
  BEFORE UPDATE OF loyalty_enabled ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_customer_loyalty_disable();
