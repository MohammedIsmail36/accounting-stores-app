-- =======================================================================
-- نقل تحسينات الفرع المحلي إلى Lovable Cloud (الدفعة 1: Migrations)
-- يدمج 7 migrations محلية في migration واحد منظّم
-- =======================================================================

-- ─── 1. حسابات الضرائب ───
INSERT INTO public.accounts (code, name, account_type, parent_id, is_system)
VALUES ('1105', 'ضريبة القيمة المضافة للمدخلات', 'asset',
  (SELECT id FROM public.accounts WHERE code = '11' LIMIT 1), true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.accounts (code, name, account_type, parent_id, is_system)
VALUES ('2102', 'مستحقات ضريبة المبيعات', 'liability',
  COALESCE((SELECT id FROM public.accounts WHERE code = '21' LIMIT 1),
           (SELECT id FROM public.accounts WHERE code = '2' LIMIT 1)), true)
ON CONFLICT (code) DO NOTHING;

-- ─── 2. أعمدة جديدة ───
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS stock_enforcement_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS locked_until_date date DEFAULT NULL;

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS entry_type VARCHAR(50) DEFAULT 'regular';

COMMENT ON COLUMN public.journal_entries.entry_type IS 'Type: regular, closing, reversal';

CREATE INDEX IF NOT EXISTS idx_journal_entries_entry_type ON public.journal_entries(entry_type);

UPDATE public.journal_entries
SET entry_type = 'closing'
WHERE description LIKE '%قيد إقفال السنة المالية%' AND entry_type = 'regular';

-- ─── 3. CHECK توازن القيود (NOT VALID لتجنب فشل بسبب بيانات قديمة) ───
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jentry_balanced') THEN
    ALTER TABLE public.journal_entries
      ADD CONSTRAINT jentry_balanced CHECK (total_debit = total_credit) NOT VALID;
  END IF;
END $$;

-- ─── 4. جدول التدقيق ───
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  user_id uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_view" ON public.audit_log;
CREATE POLICY "audit_log_view" ON public.audit_log
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_audit_log_table ON public.audit_log (table_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_record ON public.audit_log (record_id);

-- ─── 5. دالة التدقيق ───
CREATE OR REPLACE FUNCTION public.fn_audit_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (table_name, record_id, action, new_data)
    VALUES (TG_TABLE_NAME, NEW.id::text, 'INSERT', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data)
    VALUES (TG_TABLE_NAME, NEW.id::text, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data)
    VALUES (TG_TABLE_NAME, OLD.id::text, 'DELETE', to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- ربط التدقيق
DROP TRIGGER IF EXISTS trg_audit_journal_entries ON public.journal_entries;
CREATE TRIGGER trg_audit_journal_entries AFTER INSERT OR UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_sales_invoices ON public.sales_invoices;
CREATE TRIGGER trg_audit_sales_invoices AFTER INSERT OR UPDATE OR DELETE ON public.sales_invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_purchase_invoices ON public.purchase_invoices;
CREATE TRIGGER trg_audit_purchase_invoices AFTER INSERT OR UPDATE OR DELETE ON public.purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_expenses ON public.expenses;
CREATE TRIGGER trg_audit_expenses AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_customer_payments ON public.customer_payments;
CREATE TRIGGER trg_audit_customer_payments AFTER INSERT OR UPDATE OR DELETE ON public.customer_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_supplier_payments ON public.supplier_payments;
CREATE TRIGGER trg_audit_supplier_payments AFTER INSERT OR UPDATE OR DELETE ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_products ON public.products;
CREATE TRIGGER trg_audit_products AFTER UPDATE OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- ─── 6. قفل الفترة المحاسبية ───
CREATE OR REPLACE FUNCTION public.fn_check_period_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_locked_date date;
BEGIN
  SELECT locked_until_date INTO v_locked_date FROM company_settings LIMIT 1;
  IF v_locked_date IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD.entry_date <= v_locked_date THEN
        RAISE EXCEPTION 'لا يمكن حذف قيود في فترة محاسبية مقفلة (قبل %)', v_locked_date;
      END IF;
    ELSE
      IF NEW.entry_date <= v_locked_date THEN
        RAISE EXCEPTION 'لا يمكن إنشاء أو تعديل قيود في فترة محاسبية مقفلة (قبل %)', v_locked_date;
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_period_lock ON public.journal_entries;
CREATE TRIGGER trg_check_period_lock BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_check_period_lock();

-- ─── 7. RPC: تعديل كمية المنتج ذرياً ───
CREATE OR REPLACE FUNCTION public.adjust_product_quantity(p_product_id UUID, p_delta NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_new_qty NUMERIC;
BEGIN
  UPDATE products SET quantity_on_hand = quantity_on_hand + p_delta
  WHERE id = p_product_id RETURNING quantity_on_hand INTO v_new_qty;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found: %', p_product_id; END IF;
  RETURN v_new_qty;
END;
$$;

-- ─── 8. RPC: الفواتير غير المسددة (الإصدار النهائي مع posted_number) ───
CREATE OR REPLACE FUNCTION public.get_unpaid_invoices(p_limit int DEFAULT 10)
RETURNS TABLE(id uuid, invoice_number bigint, posted_number bigint, total numeric,
  paid_amount numeric, remaining numeric, customer_id uuid, customer_name text)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT si.id, si.invoice_number, si.posted_number::bigint, si.total, si.paid_amount,
    (si.total - si.paid_amount) AS remaining, si.customer_id,
    COALESCE(c.name, 'عميل نقدي') AS customer_name
  FROM sales_invoices si LEFT JOIN customers c ON si.customer_id = c.id
  WHERE si.status = 'posted' AND si.paid_amount < si.total
  ORDER BY (si.total - si.paid_amount) DESC LIMIT p_limit;
$$;

-- ─── 9. RPC: أعلى المنتجات مبيعاً ───
CREATE OR REPLACE FUNCTION public.get_top_products(p_limit int DEFAULT 10)
RETURNS TABLE(product_id uuid, product_name text, total_qty numeric, total_amount numeric)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT sii.product_id,
    CONCAT_WS(' - ', NULLIF(pb.name, ''), p.name, NULLIF(p.model_number, '')) AS product_name,
    SUM(sii.quantity) AS total_qty,
    SUM(COALESCE(sii.net_total, sii.total)) AS total_amount
  FROM sales_invoice_items sii
  JOIN sales_invoices si ON sii.invoice_id = si.id
  JOIN products p ON sii.product_id = p.id
  LEFT JOIN product_brands pb ON p.brand_id = pb.id
  WHERE si.status = 'posted' AND sii.product_id IS NOT NULL
  GROUP BY sii.product_id, p.name, p.model_number, pb.name
  ORDER BY total_amount DESC LIMIT p_limit;
$$;

-- ─── 10. RPC: ترحيل فاتورة المبيعات (الإصدار النهائي مع الضريبة + قفل الفترة + خيار المخزون) ───
CREATE OR REPLACE FUNCTION public.post_sales_invoice(p_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_invoice RECORD; v_item RECORD; v_product RECORD; v_settings RECORD;
  v_customers_acc_id uuid; v_revenue_acc_id uuid; v_cogs_acc_id uuid;
  v_inventory_acc_id uuid; v_sales_tax_acc_id uuid;
  v_total_cost numeric := 0; v_avg_cost numeric; v_effective_cost numeric;
  v_je_id uuid; v_je_posted_num int; v_inv_posted_num int;
  v_tax_amount numeric; v_net_revenue numeric;
BEGIN
  SELECT * INTO v_invoice FROM sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الفاتورة غير موجودة'); END IF;
  IF v_invoice.status != 'draft' THEN RETURN jsonb_build_object('success', false, 'error', 'يمكن ترحيل الفواتير ذات حالة المسودة فقط'); END IF;

  SELECT locked_until_date, stock_enforcement_enabled INTO v_settings FROM company_settings LIMIT 1;

  IF v_settings.locked_until_date IS NOT NULL AND v_invoice.invoice_date <= v_settings.locked_until_date THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('لا يمكن ترحيل فاتورة بتاريخ %s — الفترة مقفلة حتى %s', v_invoice.invoice_date, v_settings.locked_until_date));
  END IF;

  SELECT id INTO v_customers_acc_id FROM accounts WHERE code = '1103' LIMIT 1;
  SELECT id INTO v_revenue_acc_id FROM accounts WHERE code = '4101' LIMIT 1;
  SELECT id INTO v_cogs_acc_id FROM accounts WHERE code = '5101' LIMIT 1;
  SELECT id INTO v_inventory_acc_id FROM accounts WHERE code = '1104' LIMIT 1;
  SELECT id INTO v_sales_tax_acc_id FROM accounts WHERE code = '2102' LIMIT 1;

  IF v_customers_acc_id IS NULL OR v_revenue_acc_id IS NULL OR v_cogs_acc_id IS NULL OR v_inventory_acc_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'تأكد من وجود حسابات العملاء والإيرادات والتكلفة والمخزون');
  END IF;

  v_tax_amount := COALESCE(v_invoice.tax, 0);
  v_net_revenue := v_invoice.total - v_tax_amount;

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

  INSERT INTO journal_entries (description, entry_date, total_debit, total_credit, status, posted_number)
  VALUES (format('فاتورة بيع رقم %s', v_inv_posted_num), v_invoice.invoice_date,
    v_invoice.total + v_total_cost, v_invoice.total + v_total_cost, 'posted', v_je_posted_num)
  RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_customers_acc_id, v_invoice.total, 0, format('مبيعات - فاتورة %s', v_inv_posted_num)),
    (v_je_id, v_revenue_acc_id, 0, v_net_revenue, format('إيراد مبيعات - فاتورة %s', v_inv_posted_num));

  IF v_tax_amount > 0 AND v_sales_tax_acc_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_sales_tax_acc_id, 0, v_tax_amount, format('ضريبة مبيعات - فاتورة %s', v_inv_posted_num));
  END IF;

  IF v_total_cost > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_cogs_acc_id, v_total_cost, 0, format('تكلفة بضاعة مباعة - فاتورة %s', v_inv_posted_num)),
      (v_je_id, v_inventory_acc_id, 0, v_total_cost, format('خصم مخزون - فاتورة %s', v_inv_posted_num));
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
$$;

-- ─── 11. RPC: ترحيل فاتورة المشتريات (الإصدار النهائي) ───
CREATE OR REPLACE FUNCTION public.post_purchase_invoice(p_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_invoice RECORD; v_item RECORD; v_locked_date date;
  v_inventory_acc_id uuid; v_supplier_acc_id uuid; v_input_vat_acc_id uuid;
  v_je_id uuid; v_je_posted_num int; v_inv_posted_num int;
  v_unit_cost numeric; v_tax_amount numeric; v_net_cost numeric;
BEGIN
  SELECT * INTO v_invoice FROM purchase_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الفاتورة غير موجودة'); END IF;
  IF v_invoice.status != 'draft' THEN RETURN jsonb_build_object('success', false, 'error', 'يمكن ترحيل الفواتير ذات حالة المسودة فقط'); END IF;

  SELECT locked_until_date INTO v_locked_date FROM company_settings LIMIT 1;
  IF v_locked_date IS NOT NULL AND v_invoice.invoice_date <= v_locked_date THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('لا يمكن ترحيل فاتورة بتاريخ %s — الفترة مقفلة حتى %s', v_invoice.invoice_date, v_locked_date));
  END IF;

  SELECT id INTO v_inventory_acc_id FROM accounts WHERE code = '1104' LIMIT 1;
  SELECT id INTO v_supplier_acc_id FROM accounts WHERE code = '2101' LIMIT 1;
  SELECT id INTO v_input_vat_acc_id FROM accounts WHERE code = '1105' LIMIT 1;

  IF v_inventory_acc_id IS NULL OR v_supplier_acc_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'تأكد من وجود حسابات المخزون والموردين في شجرة الحسابات');
  END IF;

  v_tax_amount := COALESCE(v_invoice.tax, 0);
  v_net_cost := v_invoice.total - v_tax_amount;

  SELECT COALESCE(MAX(posted_number), 0) + 1 INTO v_je_posted_num FROM journal_entries WHERE posted_number IS NOT NULL;
  SELECT COALESCE(MAX(posted_number), 0) + 1 INTO v_inv_posted_num FROM purchase_invoices WHERE posted_number IS NOT NULL;

  INSERT INTO journal_entries (description, entry_date, total_debit, total_credit, status, posted_number)
  VALUES (format('فاتورة شراء رقم %s', v_inv_posted_num), v_invoice.invoice_date,
    v_invoice.total, v_invoice.total, 'posted', v_je_posted_num)
  RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_inventory_acc_id, v_net_cost, 0, format('مشتريات - فاتورة %s', v_inv_posted_num)),
    (v_je_id, v_supplier_acc_id, 0, v_invoice.total, format('مستحقات مورد - فاتورة %s', v_inv_posted_num));

  IF v_tax_amount > 0 THEN
    IF v_input_vat_acc_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'الضريبة مفعلة ولا يوجد حساب ضريبة المدخلات (1105) في شجرة الحسابات');
    END IF;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_input_vat_acc_id, v_tax_amount, 0, format('ضريبة مدخلات - فاتورة %s', v_inv_posted_num));
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
$$;

-- ─── 12. فهارس الأداء ───
CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer_id ON public.sales_invoices (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_status_date ON public.sales_invoices (status, invoice_date);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier_id ON public.purchase_invoices (supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_status_date ON public.purchase_invoices (status, invoice_date);
CREATE INDEX IF NOT EXISTS idx_sales_returns_customer_id ON public.sales_returns (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_status ON public.sales_returns (status);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier_id ON public.purchase_returns (supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_status ON public.purchase_returns (status);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_type_id ON public.expenses (expense_type_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON public.expenses (status);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_date ON public.inventory_movements (product_id, movement_date);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_items_invoice_id ON public.sales_invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_invoice_id ON public.purchase_invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_return_items_return_id ON public.sales_return_items (return_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_return_id ON public.purchase_return_items (return_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_status_date ON public.journal_entries (status, entry_date);