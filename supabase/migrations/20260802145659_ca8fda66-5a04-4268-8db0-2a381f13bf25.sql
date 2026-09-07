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
  v_linked boolean := false;
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

  -- قيد آلي مولّد من مستند؟
  SELECT EXISTS (SELECT 1 FROM public.sales_invoices WHERE journal_entry_id = p_entry_id)
      OR EXISTS (SELECT 1 FROM public.purchase_invoices WHERE journal_entry_id = p_entry_id)
      OR EXISTS (SELECT 1 FROM public.customer_payments WHERE journal_entry_id = p_entry_id)
      OR EXISTS (SELECT 1 FROM public.supplier_payments WHERE journal_entry_id = p_entry_id)
      OR EXISTS (SELECT 1 FROM public.sales_returns WHERE journal_entry_id = p_entry_id)
      OR EXISTS (SELECT 1 FROM public.purchase_returns WHERE journal_entry_id = p_entry_id)
  INTO v_linked;

  IF v_linked THEN
    RAISE EXCEPTION 'قيد آلي مرتبط بمستند — لا يمكن تعديله يدوياً';
  END IF;

  IF COALESCE(v_entry.description, '') LIKE 'عكس %' THEN
    RAISE EXCEPTION 'القيود العكسية لا يمكن تعديلها';
  END IF;

  -- قفل الفترة
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
    IF COALESCE(v_line->>'account_id', '') = '' THEN
      RAISE EXCEPTION 'يرجى اختيار الحساب لكل سطر';
    END IF;
    v_total_debit := v_total_debit + COALESCE((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::numeric, 0);
    IF COALESCE((v_line->>'debit')::numeric, 0) > 0 OR COALESCE((v_line->>'credit')::numeric, 0) > 0 THEN
      v_valid_count := v_valid_count + 1;
    END IF;
  END LOOP;

  IF v_valid_count < 2 THEN
    RAISE EXCEPTION 'يجب إضافة سطرين صالحين على الأقل';
  END IF;

  IF v_total_debit <= 0 OR round(v_total_debit, 2) <> round(v_total_credit, 2) THEN
    RAISE EXCEPTION 'القيد غير متوازن (مدين % / دائن %)', round(v_total_debit, 2), round(v_total_credit, 2);
  END IF;

  -- كتابة فوق ذرية: حذف السطور القديمة وإدراج الجديدة، مع الحفاظ على الأرقام
  DELETE FROM public.journal_entry_lines WHERE journal_entry_id = p_entry_id;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  SELECT p_entry_id,
         (l->>'account_id')::uuid,
         COALESCE((l->>'debit')::numeric, 0),
         COALESCE((l->>'credit')::numeric, 0),
         NULLIF(btrim(COALESCE(l->>'description', '')), '')
  FROM jsonb_array_elements(p_lines) AS l
  WHERE COALESCE((l->>'debit')::numeric, 0) > 0
     OR COALESCE((l->>'credit')::numeric, 0) > 0;

  UPDATE public.journal_entries
  SET entry_date = p_entry_date,
      description = btrim(p_description),
      total_debit = round(v_total_debit, 2),
      total_credit = round(v_total_credit, 2)
  WHERE id = p_entry_id;

  RETURN p_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.edit_journal_entry(uuid, date, text, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_journal_entry(uuid, date, text, jsonb) TO authenticated;