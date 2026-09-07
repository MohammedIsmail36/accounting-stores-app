-- 1) توسيع دالة تعديل القيود لتشمل المصروفات وتسويات المخزون
CREATE OR REPLACE FUNCTION public.is_system_journal_entry(p_entry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.sales_invoices WHERE journal_entry_id = p_entry_id)
      OR EXISTS (SELECT 1 FROM public.purchase_invoices WHERE journal_entry_id = p_entry_id)
      OR EXISTS (SELECT 1 FROM public.customer_payments WHERE journal_entry_id = p_entry_id)
      OR EXISTS (SELECT 1 FROM public.supplier_payments WHERE journal_entry_id = p_entry_id)
      OR EXISTS (SELECT 1 FROM public.sales_returns WHERE journal_entry_id = p_entry_id)
      OR EXISTS (SELECT 1 FROM public.purchase_returns WHERE journal_entry_id = p_entry_id)
      OR EXISTS (SELECT 1 FROM public.expenses WHERE journal_entry_id = p_entry_id)
      OR EXISTS (SELECT 1 FROM public.inventory_adjustments WHERE journal_entry_id = p_entry_id)
      OR EXISTS (
        SELECT 1 FROM public.journal_entries je
        WHERE je.id = p_entry_id
          AND (COALESCE(je.entry_type, 'regular') IN ('reversal', 'closing')
               OR COALESCE(je.description, '') LIKE 'عكس %')
      );
$$;

REVOKE EXECUTE ON FUNCTION public.is_system_journal_entry(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_system_journal_entry(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.edit_journal_entry(
  p_entry_id uuid,
  p_entry_date date,
  p_description text,
  p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.journal_entries;
  v_locked_date date;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_valid_count integer := 0;
  v_line jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant')) THEN
    RAISE EXCEPTION 'صلاحيات غير كافية لتعديل القيود';
  END IF;

  SELECT * INTO v_entry FROM public.journal_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'القيد غير موجود';
  END IF;

  IF v_entry.status <> 'posted' THEN
    RAISE EXCEPTION 'هذه الدالة مخصصة للقيود المعتمدة فقط';
  END IF;

  IF public.is_system_journal_entry(p_entry_id) THEN
    RAISE EXCEPTION 'قيد آلي مولّد من عملية — لا يمكن تعديله يدوياً، عدّل المستند نفسه';
  END IF;

  SELECT locked_until_date INTO v_locked_date FROM public.company_settings LIMIT 1;
  IF v_locked_date IS NOT NULL THEN
    IF v_entry.entry_date <= v_locked_date THEN
      RAISE EXCEPTION 'لا يمكن تعديل قيد بتاريخ % — الفترة مقفلة حتى %', v_entry.entry_date, v_locked_date;
    END IF;
    IF p_entry_date <= v_locked_date THEN
      RAISE EXCEPTION 'لا يمكن نقل القيد إلى تاريخ % — الفترة مقفلة حتى %', p_entry_date, v_locked_date;
    END IF;
  END IF;

  IF COALESCE(btrim(p_description), '') = '' THEN
    RAISE EXCEPTION 'يرجى إدخال وصف القيد';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'سطور القيد غير صالحة';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF COALESCE(NULLIF(v_line->>'account_id', ''), '') = '' THEN
      CONTINUE;
    END IF;
    IF COALESCE((v_line->>'debit')::numeric, 0) = 0
       AND COALESCE((v_line->>'credit')::numeric, 0) = 0 THEN
      CONTINUE;
    END IF;
    v_valid_count := v_valid_count + 1;
    v_total_debit := v_total_debit + COALESCE((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::numeric, 0);
  END LOOP;

  IF v_valid_count < 2 THEN
    RAISE EXCEPTION 'القيد يجب أن يحتوي على سطرين صالحين على الأقل';
  END IF;

  IF round(v_total_debit, 2) <> round(v_total_credit, 2) THEN
    RAISE EXCEPTION 'القيد غير متوازن: مدين % مقابل دائن %', v_total_debit, v_total_credit;
  END IF;

  DELETE FROM public.journal_entry_lines WHERE journal_entry_id = p_entry_id;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  SELECT p_entry_id,
         (l->>'account_id')::uuid,
         COALESCE((l->>'debit')::numeric, 0),
         COALESCE((l->>'credit')::numeric, 0),
         NULLIF(btrim(COALESCE(l->>'description', '')), '')
  FROM jsonb_array_elements(p_lines) l
  WHERE COALESCE(NULLIF(l->>'account_id', ''), '') <> ''
    AND (COALESCE((l->>'debit')::numeric, 0) <> 0 OR COALESCE((l->>'credit')::numeric, 0) <> 0);

  UPDATE public.journal_entries
     SET entry_date = p_entry_date,
         description = btrim(p_description),
         total_debit = round(v_total_debit, 2),
         total_credit = round(v_total_credit, 2),
         updated_at = now()
   WHERE id = p_entry_id;

  RETURN p_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.edit_journal_entry(uuid, date, text, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_journal_entry(uuid, date, text, jsonb) TO authenticated;

-- 2) منع إلغاء/حذف القيود الآلية من خارج مسار العملية
CREATE OR REPLACE FUNCTION public.fn_guard_system_journal_entry_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.is_system_journal_entry(OLD.id) THEN
      RAISE EXCEPTION 'قيد آلي مولّد من عملية — لا يمكن حذفه، عدّل المستند نفسه';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status = 'cancelled' AND COALESCE(OLD.status, '') <> 'cancelled' THEN
    IF public.is_system_journal_entry(NEW.id) THEN
      RAISE EXCEPTION 'قيد آلي مولّد من عملية — لا يمكن إلغاؤه، ألغِ المستند نفسه';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_system_je_update ON public.journal_entries;
CREATE TRIGGER trg_guard_system_je_update
  BEFORE UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_system_journal_entry_lifecycle();

DROP TRIGGER IF EXISTS trg_guard_system_je_delete ON public.journal_entries;
CREATE TRIGGER trg_guard_system_je_delete
  BEFORE DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_system_journal_entry_lifecycle();