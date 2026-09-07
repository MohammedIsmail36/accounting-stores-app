
-- Trigger A: block sensitive updates on system accounts
CREATE OR REPLACE FUNCTION public.fn_guard_system_accounts_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.is_system = true THEN
    IF NEW.code <> OLD.code
       OR NEW.account_type <> OLD.account_type
       OR NEW.is_parent <> OLD.is_parent
       OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
       OR (NEW.is_system = false) THEN
      RAISE EXCEPTION 'لا يمكن تعديل رمز أو نوع أو موقع أو طبيعة حساب النظام. مسموح تعديل الاسم والوصف والحالة فقط.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_system_accounts_update ON public.accounts;
CREATE TRIGGER trg_guard_system_accounts_update
BEFORE UPDATE ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_system_accounts_update();

-- Trigger B: block inserting children under system leaf accounts
CREATE OR REPLACE FUNCTION public.fn_guard_system_accounts_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_sys boolean;
  v_isp boolean;
  v_code text;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT is_system, is_parent, code INTO v_sys, v_isp, v_code
    FROM public.accounts WHERE id = NEW.parent_id;
    IF v_sys = true AND v_isp = false THEN
      RAISE EXCEPTION 'لا يمكن إضافة حساب فرعي تحت حساب ترحيل النظام (%). أضف تحت حسابات رئيسية فقط.', v_code;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_system_accounts_insert ON public.accounts;
CREATE TRIGGER trg_guard_system_accounts_insert
BEFORE INSERT ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_system_accounts_insert();
