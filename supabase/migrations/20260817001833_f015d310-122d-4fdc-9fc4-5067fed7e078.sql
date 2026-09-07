-- 1) Guard: never allow a journal entry to become 'posted' while empty or unbalanced
CREATE OR REPLACE FUNCTION public.fn_guard_posted_journal_entry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_debit numeric; v_credit numeric; v_count int;
BEGIN
  IF NEW.status = 'posted' AND COALESCE(OLD.status, '') <> 'posted' THEN
    SELECT COUNT(*), COALESCE(SUM(debit),0), COALESCE(SUM(credit),0)
      INTO v_count, v_debit, v_credit
    FROM journal_entry_lines WHERE journal_entry_id = NEW.id;

    IF v_count = 0 THEN
      RAISE EXCEPTION 'لا يمكن ترحيل قيد بدون سطور';
    END IF;
    IF ROUND(v_debit, 2) <> ROUND(v_credit, 2) THEN
      RAISE EXCEPTION 'لا يمكن ترحيل قيد غير متوازن (مدين % ≠ دائن %)', v_debit, v_credit;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_posted_journal_entry ON public.journal_entries;
CREATE TRIGGER trg_guard_posted_journal_entry
BEFORE UPDATE ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_posted_journal_entry();

-- 2) Unpost a posted sales invoice (reset to draft, Odoo-style)
CREATE OR REPLACE FUNCTION public.unpost_sales_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inv RECORD; v_locked date; v_cnt int; v_mov RECORD; v_pts int;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'هذه العملية متاحة للمدير فقط');
  END IF;

  SELECT * INTO v_inv FROM sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'الفاتورة غير موجودة');
  END IF;
  IF v_inv.status <> 'posted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'يمكن إعادة تعيين الفواتير المرحّلة فقط');
  END IF;

  SELECT COUNT(*) INTO v_cnt FROM customer_payment_allocations WHERE invoice_id = p_invoice_id;
  IF v_cnt > 0 OR COALESCE(v_inv.paid_amount, 0) > 0 THEN
    RETURN jsonb_build_object('success', false, 'error',
      'لا يمكن إعادة التعيين: توجد سدادات مرتبطة بالفاتورة — يجب إلغاؤها أولاً');
  END IF;

  SELECT COUNT(*) INTO v_cnt FROM customer_payments
   WHERE sales_invoice_id = p_invoice_id AND status <> 'cancelled';
  IF v_cnt > 0 THEN
    RETURN jsonb_build_object('success', false, 'error',
      'لا يمكن إعادة التعيين: توجد سندات قبض مرتبطة بالفاتورة — يجب إلغاؤها أولاً');
  END IF;

  SELECT COUNT(*) INTO v_cnt FROM sales_returns
   WHERE sales_invoice_id = p_invoice_id AND status <> 'cancelled';
  IF v_cnt = 0 THEN
    SELECT COUNT(*) INTO v_cnt FROM sales_invoice_return_settlements WHERE invoice_id = p_invoice_id;
  END IF;
  IF v_cnt > 0 THEN
    RETURN jsonb_build_object('success', false, 'error',
      'لا يمكن إعادة التعيين: توجد مرتجعات مرتبطة بالفاتورة — يجب إلغاؤها أولاً');
  END IF;

  SELECT locked_until_date INTO v_locked FROM company_settings LIMIT 1;
  IF v_locked IS NOT NULL AND v_inv.invoice_date <= v_locked THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('لا يمكن إعادة التعيين: الفترة مقفلة حتى %s', v_locked));
  END IF;

  -- Journal entry stays, becomes draft (excluded from reports)
  IF v_inv.journal_entry_id IS NOT NULL THEN
    UPDATE journal_entries SET status = 'draft' WHERE id = v_inv.journal_entry_id;
  END IF;

  -- Restore stock and drop movements
  FOR v_mov IN SELECT * FROM inventory_movements
    WHERE reference_id = p_invoice_id AND reference_type = 'sales_invoice' LOOP
    UPDATE products SET quantity_on_hand = quantity_on_hand + v_mov.quantity WHERE id = v_mov.product_id;
  END LOOP;
  DELETE FROM inventory_movements WHERE reference_id = p_invoice_id AND reference_type = 'sales_invoice';

  -- Erase loyalty effect of this invoice
  SELECT COALESCE(SUM(points), 0) INTO v_pts FROM loyalty_transactions
   WHERE reference_type = 'sales_invoice' AND reference_id = p_invoice_id;
  IF v_pts <> 0 AND v_inv.customer_id IS NOT NULL THEN
    UPDATE customers SET loyalty_points = GREATEST(COALESCE(loyalty_points, 0) - v_pts, 0)
     WHERE id = v_inv.customer_id;
  END IF;
  DELETE FROM loyalty_transactions
   WHERE reference_type = 'sales_invoice' AND reference_id = p_invoice_id;

  -- Keep posted_number and journal_entry_id
  UPDATE sales_invoices SET status = 'draft' WHERE id = p_invoice_id;

  INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, user_id)
  VALUES ('sales_invoices', p_invoice_id::text, 'reset_to_draft',
    jsonb_build_object('status', 'posted', 'posted_number', v_inv.posted_number,
                       'journal_entry_id', v_inv.journal_entry_id),
    jsonb_build_object('status', 'draft', 'posted_number', v_inv.posted_number,
                       'journal_entry_id', v_inv.journal_entry_id),
    auth.uid());

  RETURN jsonb_build_object('success', true, 'journal_entry_id', v_inv.journal_entry_id,
                            'posted_number', v_inv.posted_number);
END;
$function$;

-- 3) Unpost a posted purchase invoice
CREATE OR REPLACE FUNCTION public.unpost_purchase_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inv RECORD; v_locked date; v_cnt int; v_mov RECORD; v_qty numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'هذه العملية متاحة للمدير فقط');
  END IF;

  SELECT * INTO v_inv FROM purchase_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'الفاتورة غير موجودة');
  END IF;
  IF v_inv.status <> 'posted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'يمكن إعادة تعيين الفواتير المرحّلة فقط');
  END IF;

  SELECT COUNT(*) INTO v_cnt FROM supplier_payment_allocations WHERE invoice_id = p_invoice_id;
  IF v_cnt > 0 OR COALESCE(v_inv.paid_amount, 0) > 0 THEN
    RETURN jsonb_build_object('success', false, 'error',
      'لا يمكن إعادة التعيين: توجد سدادات مرتبطة بالفاتورة — يجب إلغاؤها أولاً');
  END IF;

  SELECT COUNT(*) INTO v_cnt FROM supplier_payments
   WHERE purchase_invoice_id = p_invoice_id AND status <> 'cancelled';
  IF v_cnt > 0 THEN
    RETURN jsonb_build_object('success', false, 'error',
      'لا يمكن إعادة التعيين: توجد سندات صرف مرتبطة بالفاتورة — يجب إلغاؤها أولاً');
  END IF;

  SELECT COUNT(*) INTO v_cnt FROM purchase_returns
   WHERE purchase_invoice_id = p_invoice_id AND status <> 'cancelled';
  IF v_cnt = 0 THEN
    SELECT COUNT(*) INTO v_cnt FROM purchase_invoice_return_settlements WHERE invoice_id = p_invoice_id;
  END IF;
  IF v_cnt > 0 THEN
    RETURN jsonb_build_object('success', false, 'error',
      'لا يمكن إعادة التعيين: توجد مرتجعات مرتبطة بالفاتورة — يجب إلغاؤها أولاً');
  END IF;

  SELECT locked_until_date INTO v_locked FROM company_settings LIMIT 1;
  IF v_locked IS NOT NULL AND v_inv.invoice_date <= v_locked THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('لا يمكن إعادة التعيين: الفترة مقفلة حتى %s', v_locked));
  END IF;

  -- Stock must still be available to pull back
  FOR v_mov IN SELECT * FROM inventory_movements
    WHERE reference_id = p_invoice_id AND reference_type = 'purchase_invoice' LOOP
    SELECT quantity_on_hand INTO v_qty FROM products WHERE id = v_mov.product_id;
    IF COALESCE(v_qty, 0) < v_mov.quantity THEN
      RETURN jsonb_build_object('success', false, 'error',
        'لا يمكن إعادة التعيين: كميات هذه الفاتورة تم صرفها بالفعل من المخزون');
    END IF;
  END LOOP;

  IF v_inv.journal_entry_id IS NOT NULL THEN
    UPDATE journal_entries SET status = 'draft' WHERE id = v_inv.journal_entry_id;
  END IF;

  FOR v_mov IN SELECT * FROM inventory_movements
    WHERE reference_id = p_invoice_id AND reference_type = 'purchase_invoice' LOOP
    UPDATE products SET quantity_on_hand = quantity_on_hand - v_mov.quantity WHERE id = v_mov.product_id;
  END LOOP;
  DELETE FROM inventory_movements WHERE reference_id = p_invoice_id AND reference_type = 'purchase_invoice';

  UPDATE purchase_invoices SET status = 'draft' WHERE id = p_invoice_id;

  INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, user_id)
  VALUES ('purchase_invoices', p_invoice_id::text, 'reset_to_draft',
    jsonb_build_object('status', 'posted', 'posted_number', v_inv.posted_number,
                       'journal_entry_id', v_inv.journal_entry_id),
    jsonb_build_object('status', 'draft', 'posted_number', v_inv.posted_number,
                       'journal_entry_id', v_inv.journal_entry_id),
    auth.uid());

  RETURN jsonb_build_object('success', true, 'journal_entry_id', v_inv.journal_entry_id,
                            'posted_number', v_inv.posted_number);
END;
$function$;

REVOKE ALL ON FUNCTION public.unpost_sales_invoice(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unpost_purchase_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unpost_sales_invoice(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unpost_purchase_invoice(uuid) TO authenticated, service_role;

-- 4) Re-posting reuses the same journal entry and the same document number
CREATE OR REPLACE FUNCTION public.post_sales_invoice(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice RECORD; v_item RECORD; v_product RECORD; v_settings RECORD;
  v_customers_acc_id uuid; v_revenue_acc_id uuid; v_cogs_acc_id uuid;
  v_inventory_acc_id uuid; v_sales_tax_acc_id uuid;
  v_total_cost numeric := 0; v_avg_cost numeric; v_effective_cost numeric;
  v_je_id uuid; v_je_posted_num int; v_inv_posted_num int;
  v_tax_amount numeric; v_net_revenue numeric;
  v_prefix text; v_doc_label text;
  v_item_count int; v_je_desc text; v_je_total numeric;
BEGIN
  SELECT * INTO v_invoice FROM sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الفاتورة غير موجودة'); END IF;
  IF v_invoice.status != 'draft' THEN RETURN jsonb_build_object('success', false, 'error', 'يمكن ترحيل الفواتير ذات حالة المسودة فقط'); END IF;

  SELECT COUNT(*) INTO v_item_count FROM sales_invoice_items WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL;
  IF v_item_count = 0 OR COALESCE(v_invoice.total, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'لا يمكن ترحيل فاتورة فارغة - يجب إضافة بنود وإجمالي أكبر من صفر');
  END IF;

  SELECT locked_until_date, stock_enforcement_enabled, enable_tax, sales_tax_account_id, sales_invoice_prefix
    INTO v_settings FROM company_settings LIMIT 1;

  IF v_settings.locked_until_date IS NOT NULL AND v_invoice.invoice_date <= v_settings.locked_until_date THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('لا يمكن ترحيل فاتورة بتاريخ %s — الفترة مقفلة حتى %s', v_invoice.invoice_date, v_settings.locked_until_date));
  END IF;

  SELECT id INTO v_customers_acc_id FROM accounts WHERE code = '1103' LIMIT 1;
  SELECT id INTO v_revenue_acc_id FROM accounts WHERE code = '4101' LIMIT 1;
  SELECT id INTO v_cogs_acc_id FROM accounts WHERE code = '5101' LIMIT 1;
  SELECT id INTO v_inventory_acc_id FROM accounts WHERE code = '1104' LIMIT 1;

  IF v_customers_acc_id IS NULL OR v_revenue_acc_id IS NULL OR v_cogs_acc_id IS NULL OR v_inventory_acc_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'تأكد من وجود حسابات العملاء والإيرادات والتكلفة والمخزون');
  END IF;

  v_tax_amount := COALESCE(v_invoice.tax, 0);
  v_net_revenue := v_invoice.total - v_tax_amount;

  IF v_tax_amount > 0 THEN
    IF v_settings.enable_tax IS NOT TRUE OR v_settings.sales_tax_account_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error',
        'الضريبة مطبقة على الفاتورة ولكنها غير مفعّلة في الإعدادات أو لم يتم تحديد حساب ضريبة المبيعات. يرجى ضبط ذلك من تبويب "الضريبة" في إعدادات الشركة');
    END IF;
    v_sales_tax_acc_id := v_settings.sales_tax_account_id;
    PERFORM 1 FROM accounts WHERE id = v_sales_tax_acc_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'حساب ضريبة المبيعات المحدد في الإعدادات غير موجود في شجرة الحسابات');
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM sales_invoice_items WHERE invoice_id = p_invoice_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      SELECT * INTO v_product FROM products WHERE id = v_item.product_id;
      IF COALESCE(v_settings.stock_enforcement_enabled, true) AND v_product.quantity_on_hand < v_item.quantity THEN
        RETURN jsonb_build_object('success', false, 'error',
          format('الكمية المطلوبة من %s أكبر من المتاح (%s)', v_item.description, v_product.quantity_on_hand));
      END IF;
      v_avg_cost := get_avg_purchase_price(v_item.product_id);
      v_effective_cost := CASE WHEN v_avg_cost > 0 THEN v_avg_cost ELSE COALESCE(v_product.purchase_price, 0) END;
      v_total_cost := v_total_cost + ROUND(v_effective_cost * v_item.quantity, 2);
    END IF;
  END LOOP;

  -- Reuse the document number when re-posting after a reset to draft
  v_inv_posted_num := v_invoice.posted_number;
  IF v_inv_posted_num IS NULL THEN
    SELECT COALESCE(MAX(posted_number), 0) + 1 INTO v_inv_posted_num FROM sales_invoices WHERE posted_number IS NOT NULL;
  END IF;

  v_prefix := COALESCE(NULLIF(v_settings.sales_invoice_prefix, ''), 'INV-');
  v_doc_label := v_prefix || LPAD(v_inv_posted_num::text, 4, '0');
  v_je_desc := format('فاتورة بيع رقم %s', v_doc_label);
  v_je_total := v_invoice.total + v_total_cost;

  IF v_invoice.journal_entry_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM journal_entries WHERE id = v_invoice.journal_entry_id) THEN
    -- Rebuild the lines of the SAME journal entry (Odoo-style)
    v_je_id := v_invoice.journal_entry_id;
    DELETE FROM journal_entry_lines WHERE journal_entry_id = v_je_id;
    UPDATE journal_entries
       SET description = v_je_desc, entry_date = v_invoice.invoice_date,
           total_debit = v_je_total, total_credit = v_je_total
     WHERE id = v_je_id;
  ELSE
    SELECT COALESCE(MAX(posted_number), 0) + 1 INTO v_je_posted_num FROM journal_entries WHERE posted_number IS NOT NULL;
    INSERT INTO journal_entries (description, entry_date, total_debit, total_credit, status, posted_number)
    VALUES (v_je_desc, v_invoice.invoice_date, v_je_total, v_je_total, 'draft', v_je_posted_num)
    RETURNING id INTO v_je_id;
  END IF;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_customers_acc_id, v_invoice.total, 0, format('مبيعات - فاتورة %s', v_doc_label)),
    (v_je_id, v_revenue_acc_id, 0, v_net_revenue, format('إيراد مبيعات - فاتورة %s', v_doc_label));

  IF v_tax_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_sales_tax_acc_id, 0, v_tax_amount, format('ضريبة مبيعات - فاتورة %s', v_doc_label));
  END IF;

  IF v_total_cost > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_cogs_acc_id, v_total_cost, 0, format('تكلفة بضاعة مباعة - فاتورة %s', v_doc_label)),
      (v_je_id, v_inventory_acc_id, 0, v_total_cost, format('خصم مخزون - فاتورة %s', v_doc_label));
  END IF;

  UPDATE journal_entries SET status = 'posted' WHERE id = v_je_id;

  UPDATE sales_invoices SET status = 'posted', journal_entry_id = v_je_id, posted_number = v_inv_posted_num
  WHERE id = p_invoice_id;

  FOR v_item IN SELECT * FROM sales_invoice_items WHERE invoice_id = p_invoice_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      v_avg_cost := get_avg_purchase_price(v_item.product_id);
      v_effective_cost := CASE WHEN v_avg_cost > 0 THEN v_avg_cost ELSE 0 END;
      UPDATE products SET quantity_on_hand = quantity_on_hand - v_item.quantity WHERE id = v_item.product_id;
      INSERT INTO inventory_movements (product_id, movement_type, quantity, unit_cost, total_cost, reference_id, reference_type, movement_date)
      VALUES (v_item.product_id, 'sale', v_item.quantity, v_effective_cost,
        ROUND(v_effective_cost * v_item.quantity, 2), p_invoice_id, 'sales_invoice', v_invoice.invoice_date);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'posted_number', v_inv_posted_num, 'journal_entry_id', v_je_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_purchase_invoice(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice RECORD; v_item RECORD; v_settings RECORD;
  v_inventory_acc_id uuid; v_supplier_acc_id uuid; v_input_vat_acc_id uuid;
  v_je_id uuid; v_je_posted_num int; v_inv_posted_num int;
  v_unit_cost numeric; v_tax_amount numeric; v_net_cost numeric;
  v_prefix text; v_doc_label text;
  v_item_count int; v_je_desc text;
BEGIN
  SELECT * INTO v_invoice FROM purchase_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الفاتورة غير موجودة'); END IF;
  IF v_invoice.status != 'draft' THEN RETURN jsonb_build_object('success', false, 'error', 'يمكن ترحيل الفواتير ذات حالة المسودة فقط'); END IF;

  SELECT COUNT(*) INTO v_item_count FROM purchase_invoice_items WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL;
  IF v_item_count = 0 OR COALESCE(v_invoice.total, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'لا يمكن ترحيل فاتورة فارغة - يجب إضافة بنود وإجمالي أكبر من صفر');
  END IF;

  IF v_invoice.supplier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'يجب اختيار المورد قبل الترحيل');
  END IF;

  SELECT locked_until_date, enable_tax, purchase_tax_account_id, purchase_invoice_prefix INTO v_settings FROM company_settings LIMIT 1;

  IF v_settings.locked_until_date IS NOT NULL AND v_invoice.invoice_date <= v_settings.locked_until_date THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('لا يمكن ترحيل فاتورة بتاريخ %s — الفترة مقفلة حتى %s', v_invoice.invoice_date, v_settings.locked_until_date));
  END IF;

  SELECT id INTO v_inventory_acc_id FROM accounts WHERE code = '1104' LIMIT 1;
  SELECT id INTO v_supplier_acc_id FROM accounts WHERE code = '2101' LIMIT 1;

  IF v_inventory_acc_id IS NULL OR v_supplier_acc_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'تأكد من وجود حسابات المخزون والموردين في شجرة الحسابات');
  END IF;

  v_tax_amount := COALESCE(v_invoice.tax, 0);
  v_net_cost := v_invoice.total - v_tax_amount;

  IF v_tax_amount > 0 THEN
    IF v_settings.enable_tax IS NOT TRUE OR v_settings.purchase_tax_account_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error',
        'الضريبة مطبقة على الفاتورة ولكنها غير مفعّلة في الإعدادات أو لم يتم تحديد حساب ضريبة المشتريات. يرجى ضبط ذلك من تبويب "الضريبة" في إعدادات الشركة');
    END IF;
    v_input_vat_acc_id := v_settings.purchase_tax_account_id;
    PERFORM 1 FROM accounts WHERE id = v_input_vat_acc_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'حساب ضريبة المشتريات المحدد في الإعدادات غير موجود في شجرة الحسابات');
    END IF;
  END IF;

  v_inv_posted_num := v_invoice.posted_number;
  IF v_inv_posted_num IS NULL THEN
    SELECT COALESCE(MAX(posted_number), 0) + 1 INTO v_inv_posted_num FROM purchase_invoices WHERE posted_number IS NOT NULL;
  END IF;

  v_prefix := COALESCE(NULLIF(v_settings.purchase_invoice_prefix, ''), 'PUR-');
  v_doc_label := v_prefix || LPAD(v_inv_posted_num::text, 4, '0');
  v_je_desc := format('فاتورة شراء رقم %s', v_doc_label);

  IF v_invoice.journal_entry_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM journal_entries WHERE id = v_invoice.journal_entry_id) THEN
    v_je_id := v_invoice.journal_entry_id;
    DELETE FROM journal_entry_lines WHERE journal_entry_id = v_je_id;
    UPDATE journal_entries
       SET description = v_je_desc, entry_date = v_invoice.invoice_date,
           total_debit = v_invoice.total, total_credit = v_invoice.total
     WHERE id = v_je_id;
  ELSE
    SELECT COALESCE(MAX(posted_number), 0) + 1 INTO v_je_posted_num FROM journal_entries WHERE posted_number IS NOT NULL;
    INSERT INTO journal_entries (description, entry_date, total_debit, total_credit, status, posted_number)
    VALUES (v_je_desc, v_invoice.invoice_date, v_invoice.total, v_invoice.total, 'draft', v_je_posted_num)
    RETURNING id INTO v_je_id;
  END IF;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_inventory_acc_id, v_net_cost, 0, format('مشتريات - فاتورة %s', v_doc_label)),
    (v_je_id, v_supplier_acc_id, 0, v_invoice.total, format('مستحقات مورد - فاتورة %s', v_doc_label));

  IF v_tax_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_input_vat_acc_id, v_tax_amount, 0, format('ضريبة مدخلات - فاتورة %s', v_doc_label));
  END IF;

  UPDATE journal_entries SET status = 'posted' WHERE id = v_je_id;

  UPDATE purchase_invoices SET status = 'posted', journal_entry_id = v_je_id, posted_number = v_inv_posted_num
  WHERE id = p_invoice_id;

  FOR v_item IN SELECT * FROM purchase_invoice_items WHERE invoice_id = p_invoice_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      v_unit_cost := CASE WHEN v_item.quantity > 0 THEN ROUND(v_item.net_total / v_item.quantity, 2) ELSE 0 END;
      UPDATE products SET quantity_on_hand = quantity_on_hand + v_item.quantity WHERE id = v_item.product_id;
      INSERT INTO inventory_movements (product_id, movement_type, quantity, unit_cost, total_cost, reference_id, reference_type, movement_date)
      VALUES (v_item.product_id, 'purchase', v_item.quantity, v_unit_cost,
        v_item.net_total, p_invoice_id, 'purchase_invoice', v_invoice.invoice_date);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'posted_number', v_inv_posted_num, 'journal_entry_id', v_je_id);
END;
$function$;