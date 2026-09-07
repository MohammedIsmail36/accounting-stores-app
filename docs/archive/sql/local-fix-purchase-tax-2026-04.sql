-- ARCHIVED SQL — DO NOT EXECUTE.
-- Historical manual patch from April 2026. The active schema history is
-- supabase/migrations; this file is retained only to explain the old state.
-- =======================================================================
-- إصلاح متكامل لمعالجة الضريبة في فواتير ومرتجعات الشراء
-- يطبَّق على الفرع المحلي local-selfhosted (Self-hosted Supabase)
--
-- يشمل هذا الملف:
--   1. إضافة حقول إعدادات الضريبة لجدول company_settings:
--        enable_tax / sales_tax_account_id / purchase_tax_account_id
--   2. ضمان وجود حساب ضريبة المدخلات (1105) بشكل افتراضي للتوافق مع
--      البيانات القديمة (لا يُجبَر استخدامه — يُترك للإعدادات الجديدة).
--   3. إعادة تعريف post_purchase_invoice و post_purchase_return لقراءة
--      حساب الضريبة من company_settings.purchase_tax_account_id بدل
--      الاعتماد على كود ثابت.
--   4. منع الترحيل بقيد غير متوازن إذا كانت الضريبة مفعَّلة بدون حساب.
--
-- ملاحظة: مرتجعات وفواتير المبيعات في المشروع تُرحَّل من الواجهة مباشرةً
-- وليس عبر RPC، لذا الإصلاح هناك يتم في الكود الـ TypeScript فقط.
-- =======================================================================

-- 1) أعمدة إعدادات الضريبة على company_settings
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS enable_tax boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sales_tax_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_tax_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;


-- 2) ضمان وجود حساب ضريبة المدخلات الافتراضي (1105) — متوافق مع القديم
INSERT INTO public.accounts (code, name, account_type, parent_id, is_system, is_active)
VALUES (
  '1105',
  'ضريبة القيمة المضافة للمدخلات',
  'asset',
  COALESCE(
    (SELECT id FROM public.accounts WHERE code = '11' LIMIT 1),
    (SELECT id FROM public.accounts WHERE code = '1' LIMIT 1)
  ),
  true, true
)
ON CONFLICT (code) DO NOTHING;

-- ضمان وجود حساب ضريبة المخرجات الافتراضي (2102) — اختياري للاستخدام
INSERT INTO public.accounts (code, name, account_type, parent_id, is_system, is_active)
VALUES (
  '2102',
  'ضريبة القيمة المضافة للمخرجات',
  'liability',
  COALESCE(
    (SELECT id FROM public.accounts WHERE code = '21' LIMIT 1),
    (SELECT id FROM public.accounts WHERE code = '2' LIMIT 1)
  ),
  true, true
)
ON CONFLICT (code) DO NOTHING;


-- 3) post_purchase_invoice — يقرأ حساب ضريبة المشتريات من الإعدادات
CREATE OR REPLACE FUNCTION public.post_purchase_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_invoice RECORD;
  v_item RECORD;
  v_settings RECORD;
  v_inventory_acc_id uuid;
  v_supplier_acc_id  uuid;
  v_tax_input_acc_id uuid;
  v_je_id uuid;
  v_je_posted_num int;
  v_inv_posted_num int;
  v_unit_cost numeric;
  v_tax_amount numeric;
  v_net_inventory numeric;
BEGIN
  -- 1. Fetch invoice
  SELECT * INTO v_invoice FROM purchase_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'الفاتورة غير موجودة');
  END IF;
  IF v_invoice.status != 'draft' THEN
    RETURN jsonb_build_object('success', false, 'error', 'يمكن ترحيل الفواتير ذات حالة المسودة فقط');
  END IF;

  -- 2. Read tax settings
  SELECT enable_tax, purchase_tax_account_id INTO v_settings
  FROM company_settings LIMIT 1;

  -- 3. Look up base accounts
  SELECT id INTO v_inventory_acc_id FROM accounts WHERE code = '1104' LIMIT 1;
  SELECT id INTO v_supplier_acc_id  FROM accounts WHERE code = '2101' LIMIT 1;

  IF v_inventory_acc_id IS NULL OR v_supplier_acc_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error',
      'تأكد من وجود حسابات المخزون (1104) والموردين (2101) في شجرة الحسابات');
  END IF;

  v_tax_amount := COALESCE(v_invoice.tax, 0);

  -- 4. تحديد حساب ضريبة المدخلات: من الإعدادات إن وُجد، وإلا من الكود 1105
  IF v_tax_amount > 0 THEN
    IF v_settings.enable_tax IS TRUE AND v_settings.purchase_tax_account_id IS NOT NULL THEN
      v_tax_input_acc_id := v_settings.purchase_tax_account_id;
    ELSE
      SELECT id INTO v_tax_input_acc_id FROM accounts WHERE code = '1105' LIMIT 1;
    END IF;

    IF v_tax_input_acc_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error',
        'فعّل الضريبة من الإعدادات وحدّد حساب ضريبة المشتريات، أو تأكد من وجود حساب 1105 قبل ترحيل فاتورة بضريبة');
    END IF;
  END IF;

  v_net_inventory := ROUND(v_invoice.total - v_tax_amount, 2);

  -- 5. Posted numbers
  SELECT COALESCE(MAX(posted_number), 0) + 1 INTO v_je_posted_num
    FROM journal_entries WHERE posted_number IS NOT NULL;
  SELECT COALESCE(MAX(posted_number), 0) + 1 INTO v_inv_posted_num
    FROM purchase_invoices WHERE posted_number IS NOT NULL;

  -- 6. Journal entry
  INSERT INTO journal_entries (description, entry_date, total_debit, total_credit, status, posted_number)
  VALUES (
    format('فاتورة شراء رقم %s', v_inv_posted_num),
    v_invoice.invoice_date,
    v_invoice.total, v_invoice.total,
    'posted', v_je_posted_num
  ) RETURNING id INTO v_je_id;

  -- 7. JE lines: المخزون (الصافي) + ضريبة المدخلات (إن وُجدت) + المورد (الإجمالي)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_inventory_acc_id, v_net_inventory, 0,
          format('مشتريات - فاتورة %s', v_inv_posted_num));

  IF v_tax_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_tax_input_acc_id, v_tax_amount, 0,
            format('ضريبة مدخلات - فاتورة %s', v_inv_posted_num));
  END IF;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_supplier_acc_id, 0, v_invoice.total,
          format('مستحقات مورد - فاتورة %s', v_inv_posted_num));

  -- 8. Update invoice
  UPDATE purchase_invoices
  SET status = 'posted', journal_entry_id = v_je_id, posted_number = v_inv_posted_num
  WHERE id = p_invoice_id;

  -- 9. Inventory + movements
  FOR v_item IN SELECT * FROM purchase_invoice_items WHERE invoice_id = p_invoice_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      v_unit_cost := CASE WHEN v_item.quantity > 0
                          THEN ROUND(v_item.net_total / v_item.quantity, 2) ELSE 0 END;

      UPDATE products SET quantity_on_hand = quantity_on_hand + v_item.quantity
      WHERE id = v_item.product_id;

      INSERT INTO inventory_movements
        (product_id, movement_type, quantity, unit_cost, total_cost,
         reference_id, reference_type, movement_date)
      VALUES
        (v_item.product_id, 'purchase', v_item.quantity, v_unit_cost,
         v_item.net_total, p_invoice_id, 'purchase_invoice', v_invoice.invoice_date);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'posted_number', v_inv_posted_num,
    'journal_entry_id', v_je_id
  );
END;
$$;


-- 4) post_purchase_return بنفس المنطق (عكسي)
CREATE OR REPLACE FUNCTION public.post_purchase_return(p_return_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_return RECORD;
  v_item RECORD;
  v_settings RECORD;
  v_inventory_acc_id uuid;
  v_supplier_acc_id  uuid;
  v_tax_input_acc_id uuid;
  v_je_id uuid;
  v_je_posted_num int;
  v_ret_posted_num int;
  v_tax_amount numeric;
  v_net_inventory numeric;
BEGIN
  SELECT * INTO v_return FROM purchase_returns WHERE id = p_return_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'المرتجع غير موجود');
  END IF;
  IF v_return.status != 'draft' THEN
    RETURN jsonb_build_object('success', false, 'error', 'يمكن ترحيل المرتجعات ذات حالة المسودة فقط');
  END IF;

  SELECT enable_tax, purchase_tax_account_id INTO v_settings
  FROM company_settings LIMIT 1;

  SELECT id INTO v_inventory_acc_id FROM accounts WHERE code = '1104' LIMIT 1;
  SELECT id INTO v_supplier_acc_id  FROM accounts WHERE code = '2101' LIMIT 1;

  IF v_inventory_acc_id IS NULL OR v_supplier_acc_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error',
      'تأكد من وجود حسابات المخزون (1104) والموردين (2101)');
  END IF;

  v_tax_amount := COALESCE(v_return.tax, 0);

  IF v_tax_amount > 0 THEN
    IF v_settings.enable_tax IS TRUE AND v_settings.purchase_tax_account_id IS NOT NULL THEN
      v_tax_input_acc_id := v_settings.purchase_tax_account_id;
    ELSE
      SELECT id INTO v_tax_input_acc_id FROM accounts WHERE code = '1105' LIMIT 1;
    END IF;

    IF v_tax_input_acc_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error',
        'فعّل الضريبة من الإعدادات وحدّد حساب ضريبة المشتريات، أو تأكد من وجود حساب 1105 قبل ترحيل مرتجع بضريبة');
    END IF;
  END IF;

  v_net_inventory := ROUND(v_return.total - v_tax_amount, 2);

  SELECT COALESCE(MAX(posted_number), 0) + 1 INTO v_je_posted_num
    FROM journal_entries WHERE posted_number IS NOT NULL;
  SELECT COALESCE(MAX(posted_number), 0) + 1 INTO v_ret_posted_num
    FROM purchase_returns WHERE posted_number IS NOT NULL;

  INSERT INTO journal_entries (description, entry_date, total_debit, total_credit, status, posted_number)
  VALUES (
    format('مرتجع شراء رقم %s', v_ret_posted_num),
    v_return.return_date,
    v_return.total, v_return.total,
    'posted', v_je_posted_num
  ) RETURNING id INTO v_je_id;

  -- DR: المورد (الإجمالي) | CR: المخزون (الصافي) + CR: ضريبة المدخلات (إن وُجدت)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_supplier_acc_id, v_return.total, 0,
          format('مرتجع شراء - %s', v_ret_posted_num));

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_inventory_acc_id, 0, v_net_inventory,
          format('خصم مخزون مرتجع - %s', v_ret_posted_num));

  IF v_tax_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_tax_input_acc_id, 0, v_tax_amount,
            format('عكس ضريبة مدخلات - %s', v_ret_posted_num));
  END IF;

  UPDATE purchase_returns
  SET status = 'posted', journal_entry_id = v_je_id, posted_number = v_ret_posted_num
  WHERE id = p_return_id;

  -- خصم المخزون
  FOR v_item IN SELECT * FROM purchase_return_items WHERE return_id = p_return_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      UPDATE products SET quantity_on_hand = quantity_on_hand - v_item.quantity
      WHERE id = v_item.product_id;

      INSERT INTO inventory_movements
        (product_id, movement_type, quantity, unit_cost, total_cost,
         reference_id, reference_type, movement_date)
      VALUES
        (v_item.product_id, 'purchase_return', v_item.quantity,
         CASE WHEN v_item.quantity > 0 THEN ROUND(v_item.total / v_item.quantity, 2) ELSE 0 END,
         v_item.total, p_return_id, 'purchase_return', v_return.return_date);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'posted_number', v_ret_posted_num,
    'journal_entry_id', v_je_id
  );
END;
$$;
