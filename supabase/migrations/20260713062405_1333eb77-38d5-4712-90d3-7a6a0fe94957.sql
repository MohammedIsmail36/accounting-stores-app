
CREATE OR REPLACE FUNCTION public.edit_customer_payment(
  p_payment_id uuid,
  p_customer_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_payment_method text,
  p_reference text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payment RECORD;
  v_je_id uuid;
  v_locked_date date;
  v_prefix text;
  v_display_num text;
  v_customer_name text;
  v_desc text;
  v_customers_acc_id uuid;
  v_cash_bank_acc_id uuid;
  v_cash_bank_code text;
  v_refund_count int;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'accountant'::app_role)) THEN
    RAISE EXCEPTION 'غير مصرح: يتطلب صلاحية مدير أو محاسب';
  END IF;

  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'يرجى اختيار العميل'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'يرجى إدخال مبلغ صحيح أكبر من صفر'; END IF;
  IF p_payment_date IS NULL THEN RAISE EXCEPTION 'يرجى إدخال تاريخ الدفعة'; END IF;
  IF p_payment_method NOT IN ('cash','bank','check') THEN RAISE EXCEPTION 'طريقة دفع غير صالحة'; END IF;

  SELECT * INTO v_payment FROM public.customer_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الدفعة غير موجودة'; END IF;
  IF v_payment.status <> 'posted' THEN RAISE EXCEPTION 'يمكن تعديل السندات المُرحَّلة فقط عبر هذه الدالة'; END IF;
  IF v_payment.journal_entry_id IS NULL THEN RAISE EXCEPTION 'السند غير مرتبط بقيد محاسبي'; END IF;

  SELECT locked_until_date INTO v_locked_date FROM public.company_settings LIMIT 1;
  IF v_locked_date IS NOT NULL AND (v_payment.payment_date <= v_locked_date OR p_payment_date <= v_locked_date) THEN
    RAISE EXCEPTION 'لا يمكن تعديل سند ضمن فترة محاسبية مقفلة حتى %', v_locked_date;
  END IF;

  SELECT COUNT(*) INTO v_refund_count
  FROM public.sales_return_payment_allocations
  WHERE payment_id = p_payment_id;
  IF v_refund_count > 0 THEN
    RAISE EXCEPTION 'لا يمكن تعديل سند مرتبط بمرتجع. ألغِ المرتجع أولاً ثم أنشئ السند من جديد.';
  END IF;

  v_je_id := v_payment.journal_entry_id;

  SELECT name INTO v_customer_name FROM public.customers WHERE id = p_customer_id;
  IF v_customer_name IS NULL THEN RAISE EXCEPTION 'العميل غير موجود'; END IF;

  SELECT COALESCE(NULLIF(customer_payment_prefix, ''), 'CPY-') INTO v_prefix FROM public.company_settings LIMIT 1;
  v_display_num := v_prefix || LPAD(COALESCE(v_payment.posted_number, v_payment.payment_number)::text, 4, '0');
  v_desc := 'سند قبض رقم ' || v_display_num || ' - تحصيل من عميل ' || v_customer_name;

  v_cash_bank_code := CASE WHEN p_payment_method = 'cash' THEN '1101' ELSE '1102' END;
  SELECT id INTO v_customers_acc_id FROM public.accounts WHERE code = '1103' LIMIT 1;
  SELECT id INTO v_cash_bank_acc_id FROM public.accounts WHERE code = v_cash_bank_code LIMIT 1;
  IF v_customers_acc_id IS NULL OR v_cash_bank_acc_id IS NULL THEN
    RAISE EXCEPTION 'تأكد من وجود حسابات العملاء (1103) والصندوق/البنك (%)', v_cash_bank_code;
  END IF;

  DELETE FROM public.customer_payment_allocations WHERE payment_id = p_payment_id;

  UPDATE public.journal_entries
  SET description = v_desc,
      entry_date  = p_payment_date,
      total_debit = p_amount,
      total_credit = p_amount
  WHERE id = v_je_id;

  DELETE FROM public.journal_entry_lines WHERE journal_entry_id = v_je_id;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_je_id, v_cash_bank_acc_id, p_amount, 0, v_desc),
    (v_je_id, v_customers_acc_id, 0, p_amount, v_desc);

  UPDATE public.customer_payments
  SET customer_id    = p_customer_id,
      payment_date   = p_payment_date,
      amount         = p_amount,
      payment_method = p_payment_method,
      reference      = NULLIF(BTRIM(COALESCE(p_reference, '')), ''),
      notes          = NULLIF(BTRIM(COALESCE(p_notes, '')), '')
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'journal_entry_id', v_je_id,
    'posted_number', v_payment.posted_number,
    'old_customer_id', v_payment.customer_id,
    'new_customer_id', p_customer_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.edit_customer_payment(uuid, uuid, date, numeric, text, text, text) TO authenticated;
