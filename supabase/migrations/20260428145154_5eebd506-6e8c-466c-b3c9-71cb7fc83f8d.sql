-- 1) Opening balance columns
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS opening_balance numeric NOT NULL DEFAULT 0;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS opening_balance numeric NOT NULL DEFAULT 0;

-- 2) Update get_account_statement to include opening balance line
CREATE OR REPLACE FUNCTION public.get_account_statement(
  p_entity_type text, p_entity_id uuid,
  p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_lines jsonb;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_total_count int := 0;
  v_opening numeric := 0;
BEGIN
  -- Fetch opening balance for the entity
  IF p_entity_type = 'customer' THEN
    SELECT COALESCE(opening_balance, 0) INTO v_opening FROM customers WHERE id = p_entity_id;
  ELSIF p_entity_type = 'supplier' THEN
    SELECT COALESCE(opening_balance, 0) INTO v_opening FROM suppliers WHERE id = p_entity_id;
  END IF;

  WITH all_lines AS (
    -- Opening balance synthetic line (only if non-zero)
    SELECT
      COALESCE(p_date_from, '1900-01-01'::date) AS line_date,
      'رصيد افتتاحي'::text AS line_type,
      NULL::bigint AS doc_number,
      NULL::integer AS doc_posted_number,
      'posted'::text AS doc_status,
      'opening'::text AS doc_kind,
      'رصيد افتتاحي'::text AS description,
      CASE WHEN p_entity_type = 'customer' AND v_opening <> 0 THEN v_opening ELSE 0 END::numeric AS debit,
      CASE WHEN p_entity_type = 'supplier' AND v_opening <> 0 THEN v_opening ELSE 0 END::numeric AS credit,
      '1900-01-01 00:00:00+00'::timestamptz AS sort_ts
    WHERE v_opening <> 0

    UNION ALL
    SELECT si.invoice_date, 'فاتورة مبيعات', si.invoice_number, si.posted_number, si.status,
      'sales_invoice', 'فاتورة مبيعات', si.total::numeric, 0::numeric, si.created_at
    FROM sales_invoices si
    WHERE p_entity_type = 'customer' AND si.customer_id = p_entity_id AND si.status = 'posted'
      AND (p_date_from IS NULL OR si.invoice_date >= p_date_from)
      AND (p_date_to IS NULL OR si.invoice_date <= p_date_to)
    UNION ALL
    SELECT sr.return_date, 'مرتجع مبيعات', sr.return_number, sr.posted_number, sr.status,
      'sales_return', 'مرتجع مبيعات', 0, sr.total::numeric, sr.created_at
    FROM sales_returns sr
    WHERE p_entity_type = 'customer' AND sr.customer_id = p_entity_id AND sr.status = 'posted'
      AND (p_date_from IS NULL OR sr.return_date >= p_date_from)
      AND (p_date_to IS NULL OR sr.return_date <= p_date_to)
    UNION ALL
    SELECT cp.payment_date,
      CASE WHEN EXISTS (SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id)
        THEN 'رد مبلغ لعميل' ELSE 'سند قبض' END,
      cp.payment_number, cp.posted_number, cp.status, 'customer_payment',
      CASE WHEN EXISTS (SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id)
        THEN 'رد مبلغ مرتجع للعميل' ELSE 'تحصيل من العميل' END,
      CASE WHEN EXISTS (SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id)
        THEN cp.amount::numeric ELSE 0 END,
      CASE WHEN EXISTS (SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id)
        THEN 0 ELSE cp.amount::numeric END,
      cp.created_at
    FROM customer_payments cp
    WHERE p_entity_type = 'customer' AND cp.customer_id = p_entity_id AND cp.status = 'posted'
      AND (p_date_from IS NULL OR cp.payment_date >= p_date_from)
      AND (p_date_to IS NULL OR cp.payment_date <= p_date_to)
    UNION ALL
    SELECT pi.invoice_date, 'فاتورة مشتريات', pi.invoice_number, pi.posted_number, pi.status,
      'purchase_invoice', 'فاتورة مشتريات', 0, pi.total::numeric, pi.created_at
    FROM purchase_invoices pi
    WHERE p_entity_type = 'supplier' AND pi.supplier_id = p_entity_id AND pi.status = 'posted'
      AND (p_date_from IS NULL OR pi.invoice_date >= p_date_from)
      AND (p_date_to IS NULL OR pi.invoice_date <= p_date_to)
    UNION ALL
    SELECT pr.return_date, 'مرتجع مشتريات', pr.return_number, pr.posted_number, pr.status,
      'purchase_return', 'مرتجع مشتريات', pr.total::numeric, 0, pr.created_at
    FROM purchase_returns pr
    WHERE p_entity_type = 'supplier' AND pr.supplier_id = p_entity_id AND pr.status = 'posted'
      AND (p_date_from IS NULL OR pr.return_date >= p_date_from)
      AND (p_date_to IS NULL OR pr.return_date <= p_date_to)
    UNION ALL
    SELECT sp.payment_date,
      CASE WHEN EXISTS (SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id)
        THEN 'مبلغ مسترد من مورد' ELSE 'سند صرف' END,
      sp.payment_number, sp.posted_number, sp.status, 'supplier_payment',
      CASE WHEN EXISTS (SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id)
        THEN 'استلام مبلغ مرتجع من المورد' ELSE 'دفعة للمورد' END,
      CASE WHEN EXISTS (SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id)
        THEN 0 ELSE sp.amount::numeric END,
      CASE WHEN EXISTS (SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id)
        THEN sp.amount::numeric ELSE 0 END,
      sp.created_at
    FROM supplier_payments sp
    WHERE p_entity_type = 'supplier' AND sp.supplier_id = p_entity_id AND sp.status = 'posted'
      AND (p_date_from IS NULL OR sp.payment_date >= p_date_from)
      AND (p_date_to IS NULL OR sp.payment_date <= p_date_to)
  ),
  with_balance AS (
    SELECT
      line_date, line_type, doc_number, doc_posted_number, doc_status, doc_kind,
      description, debit, credit,
      SUM(debit - credit) OVER (ORDER BY sort_ts, line_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance,
      sort_ts
    FROM all_lines
  )
  SELECT
    COALESCE(SUM(debit), 0),
    COALESCE(SUM(credit), 0),
    COUNT(*)::int
  INTO v_total_debit, v_total_credit, v_total_count
  FROM with_balance;

  WITH all_lines AS (
    SELECT
      COALESCE(p_date_from, '1900-01-01'::date) AS line_date,
      'رصيد افتتاحي'::text AS line_type,
      NULL::bigint AS doc_number,
      NULL::integer AS doc_posted_number,
      'posted'::text AS doc_status,
      'opening'::text AS doc_kind,
      'رصيد افتتاحي'::text AS description,
      CASE WHEN p_entity_type = 'customer' AND v_opening <> 0 THEN v_opening ELSE 0 END::numeric AS debit,
      CASE WHEN p_entity_type = 'supplier' AND v_opening <> 0 THEN v_opening ELSE 0 END::numeric AS credit,
      '1900-01-01 00:00:00+00'::timestamptz AS sort_ts
    WHERE v_opening <> 0
    UNION ALL
    SELECT si.invoice_date, 'فاتورة مبيعات', si.invoice_number, si.posted_number, si.status,
      'sales_invoice', 'فاتورة مبيعات', si.total::numeric, 0::numeric, si.created_at
    FROM sales_invoices si
    WHERE p_entity_type = 'customer' AND si.customer_id = p_entity_id AND si.status = 'posted'
      AND (p_date_from IS NULL OR si.invoice_date >= p_date_from)
      AND (p_date_to IS NULL OR si.invoice_date <= p_date_to)
    UNION ALL
    SELECT sr.return_date, 'مرتجع مبيعات', sr.return_number, sr.posted_number, sr.status,
      'sales_return', 'مرتجع مبيعات', 0, sr.total::numeric, sr.created_at
    FROM sales_returns sr
    WHERE p_entity_type = 'customer' AND sr.customer_id = p_entity_id AND sr.status = 'posted'
      AND (p_date_from IS NULL OR sr.return_date >= p_date_from)
      AND (p_date_to IS NULL OR sr.return_date <= p_date_to)
    UNION ALL
    SELECT cp.payment_date,
      CASE WHEN EXISTS (SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id)
        THEN 'رد مبلغ لعميل' ELSE 'سند قبض' END,
      cp.payment_number, cp.posted_number, cp.status, 'customer_payment',
      CASE WHEN EXISTS (SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id)
        THEN 'رد مبلغ مرتجع للعميل' ELSE 'تحصيل من العميل' END,
      CASE WHEN EXISTS (SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id)
        THEN cp.amount::numeric ELSE 0 END,
      CASE WHEN EXISTS (SELECT 1 FROM sales_return_payment_allocations a WHERE a.payment_id = cp.id)
        THEN 0 ELSE cp.amount::numeric END,
      cp.created_at
    FROM customer_payments cp
    WHERE p_entity_type = 'customer' AND cp.customer_id = p_entity_id AND cp.status = 'posted'
      AND (p_date_from IS NULL OR cp.payment_date >= p_date_from)
      AND (p_date_to IS NULL OR cp.payment_date <= p_date_to)
    UNION ALL
    SELECT pi.invoice_date, 'فاتورة مشتريات', pi.invoice_number, pi.posted_number, pi.status,
      'purchase_invoice', 'فاتورة مشتريات', 0, pi.total::numeric, pi.created_at
    FROM purchase_invoices pi
    WHERE p_entity_type = 'supplier' AND pi.supplier_id = p_entity_id AND pi.status = 'posted'
      AND (p_date_from IS NULL OR pi.invoice_date >= p_date_from)
      AND (p_date_to IS NULL OR pi.invoice_date <= p_date_to)
    UNION ALL
    SELECT pr.return_date, 'مرتجع مشتريات', pr.return_number, pr.posted_number, pr.status,
      'purchase_return', 'مرتجع مشتريات', pr.total::numeric, 0, pr.created_at
    FROM purchase_returns pr
    WHERE p_entity_type = 'supplier' AND pr.supplier_id = p_entity_id AND pr.status = 'posted'
      AND (p_date_from IS NULL OR pr.return_date >= p_date_from)
      AND (p_date_to IS NULL OR pr.return_date <= p_date_to)
    UNION ALL
    SELECT sp.payment_date,
      CASE WHEN EXISTS (SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id)
        THEN 'مبلغ مسترد من مورد' ELSE 'سند صرف' END,
      sp.payment_number, sp.posted_number, sp.status, 'supplier_payment',
      CASE WHEN EXISTS (SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id)
        THEN 'استلام مبلغ مرتجع من المورد' ELSE 'دفعة للمورد' END,
      CASE WHEN EXISTS (SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id)
        THEN 0 ELSE sp.amount::numeric END,
      CASE WHEN EXISTS (SELECT 1 FROM purchase_return_payment_allocations a WHERE a.payment_id = sp.id)
        THEN sp.amount::numeric ELSE 0 END,
      sp.created_at
    FROM supplier_payments sp
    WHERE p_entity_type = 'supplier' AND sp.supplier_id = p_entity_id AND sp.status = 'posted'
      AND (p_date_from IS NULL OR sp.payment_date >= p_date_from)
      AND (p_date_to IS NULL OR sp.payment_date <= p_date_to)
  ),
  with_balance AS (
    SELECT
      line_date, line_type, doc_number, doc_posted_number, doc_status, doc_kind,
      description, debit, credit,
      SUM(debit - credit) OVER (ORDER BY sort_ts, line_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance,
      sort_ts
    FROM all_lines
  )
  SELECT jsonb_agg(row_to_json(t))
  INTO v_lines
  FROM (
    SELECT line_date, line_type, doc_number, doc_posted_number, doc_status, doc_kind,
           description, debit, credit, running_balance
    FROM with_balance
    ORDER BY sort_ts, line_date
    OFFSET p_offset LIMIT p_limit
  ) t;

  v_result := jsonb_build_object(
    'lines', COALESCE(v_lines, '[]'::jsonb),
    'total_count', v_total_count,
    'total_debit', v_total_debit,
    'total_credit', v_total_credit,
    'final_balance', v_total_debit - v_total_credit
  );

  RETURN v_result;
END;
$function$;

-- 3) Guard against empty invoices in posting RPCs
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
  v_item_count int;
BEGIN
  SELECT * INTO v_invoice FROM sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الفاتورة غير موجودة'); END IF;
  IF v_invoice.status != 'draft' THEN RETURN jsonb_build_object('success', false, 'error', 'يمكن ترحيل الفواتير ذات حالة المسودة فقط'); END IF;

  -- Empty invoice guard
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

  SELECT COALESCE(MAX(posted_number), 0) + 1 INTO v_je_posted_num FROM journal_entries WHERE posted_number IS NOT NULL;
  SELECT COALESCE(MAX(posted_number), 0) + 1 INTO v_inv_posted_num FROM sales_invoices WHERE posted_number IS NOT NULL;

  v_prefix := COALESCE(NULLIF(v_settings.sales_invoice_prefix, ''), 'INV-');
  v_doc_label := v_prefix || LPAD(v_inv_posted_num::text, 4, '0');

  INSERT INTO journal_entries (description, entry_date, total_debit, total_credit, status, posted_number)
  VALUES (format('فاتورة بيع رقم %s', v_doc_label), v_invoice.invoice_date,
    v_invoice.total + v_total_cost, v_invoice.total + v_total_cost, 'posted', v_je_posted_num)
  RETURNING id INTO v_je_id;

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
  v_item_count int;
BEGIN
  SELECT * INTO v_invoice FROM purchase_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الفاتورة غير موجودة'); END IF;
  IF v_invoice.status != 'draft' THEN RETURN jsonb_build_object('success', false, 'error', 'يمكن ترحيل الفواتير ذات حالة المسودة فقط'); END IF;

  -- Empty invoice guard
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

  SELECT COALESCE(MAX(posted_number), 0) + 1 INTO v_je_posted_num FROM journal_entries WHERE posted_number IS NOT NULL;
  SELECT COALESCE(MAX(posted_number), 0) + 1 INTO v_inv_posted_num FROM purchase_invoices WHERE posted_number IS NOT NULL;

  v_prefix := COALESCE(NULLIF(v_settings.purchase_invoice_prefix, ''), 'PUR-');
  v_doc_label := v_prefix || LPAD(v_inv_posted_num::text, 4, '0');

  INSERT INTO journal_entries (description, entry_date, total_debit, total_credit, status, posted_number)
  VALUES (format('فاتورة شراء رقم %s', v_doc_label), v_invoice.invoice_date,
    v_invoice.total, v_invoice.total, 'posted', v_je_posted_num)
  RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_inventory_acc_id, v_net_cost, 0, format('مشتريات - فاتورة %s', v_doc_label)),
    (v_je_id, v_supplier_acc_id, 0, v_invoice.total, format('مستحقات مورد - فاتورة %s', v_doc_label));

  IF v_tax_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_input_vat_acc_id, v_tax_amount, 0, format('ضريبة مدخلات - فاتورة %s', v_doc_label));
  END IF;

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