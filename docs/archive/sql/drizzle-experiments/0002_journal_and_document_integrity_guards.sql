-- ─────────────────────────────────────────────────────────────
-- المحور الرابع: رفض الإدخال غير الصحيح من قاعدة البيانات
-- ─────────────────────────────────────────────────────────────

-- 1) حاجز مؤجّل على مستوى القيد: متوازن، له سطور، ورأسه = مجموع سطوره
CREATE OR REPLACE FUNCTION public.fn_assert_journal_entry_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid;
  v_status text;
  v_sd numeric;
  v_sc numeric;
  v_n integer;
  v_td numeric;
  v_tc numeric;
BEGIN
  v_entry_id := COALESCE(NEW.id, OLD.id);

  SELECT status, ROUND(total_debit, 2), ROUND(total_credit, 2)
    INTO v_status, v_td, v_tc
  FROM public.journal_entries WHERE id = v_entry_id;

  IF v_status IS NULL THEN
    RETURN NULL; -- القيد حُذف داخل نفس المعاملة
  END IF;

  IF v_status <> 'posted' THEN
    RETURN NULL; -- المسودات والملغاة لا تُفحص
  END IF;

  SELECT COUNT(*), ROUND(COALESCE(SUM(debit), 0), 2), ROUND(COALESCE(SUM(credit), 0), 2)
    INTO v_n, v_sd, v_sc
  FROM public.journal_entry_lines WHERE journal_entry_id = v_entry_id;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'لا يمكن ترحيل قيد بلا سطور (القيد %)', v_entry_id;
  END IF;

  IF v_n < 2 THEN
    RAISE EXCEPTION 'القيد يجب أن يحتوي سطرين على الأقل (القيد %)', v_entry_id;
  END IF;

  IF v_sd <> v_sc THEN
    RAISE EXCEPTION 'القيد غير متوازن: مدين % ودائن % (القيد %)', v_sd, v_sc, v_entry_id;
  END IF;

  IF v_td <> v_sd OR v_tc <> v_sc THEN
    RAISE EXCEPTION 'إجمالي رأس القيد لا يطابق مجموع سطوره (رأس % / % ، سطور % / %)', v_td, v_tc, v_sd, v_sc;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_journal_entry_integrity ON public.journal_entries;
CREATE CONSTRAINT TRIGGER trg_assert_journal_entry_integrity
  AFTER INSERT OR UPDATE ON public.journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.fn_assert_journal_entry_integrity();

DROP TRIGGER IF EXISTS trg_assert_journal_lines_integrity ON public.journal_entry_lines;
CREATE CONSTRAINT TRIGGER trg_assert_journal_lines_integrity
  AFTER INSERT OR UPDATE OR DELETE ON public.journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.fn_assert_journal_entry_integrity();

-- 2) منع تكرار رقم النشر لكل نوع مستند
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_posted_number ON public.journal_entries (posted_number) WHERE posted_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_invoices_posted_number ON public.sales_invoices (posted_number) WHERE posted_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_invoices_posted_number ON public.purchase_invoices (posted_number) WHERE posted_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_returns_posted_number ON public.sales_returns (posted_number) WHERE posted_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_returns_posted_number ON public.purchase_returns (posted_number) WHERE posted_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_payments_posted_number ON public.customer_payments (posted_number) WHERE posted_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_payments_posted_number ON public.supplier_payments (posted_number) WHERE posted_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_posted_number ON public.expenses (posted_number) WHERE posted_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_adjustments_posted_number ON public.inventory_adjustments (adjustment_number);

-- 3) منع بنود المستندات السالبة أو التافهة
CREATE OR REPLACE FUNCTION public.fn_validate_document_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'الكمية يجب أن تكون أكبر من صفر';
  END IF;
  IF NEW.unit_price IS NULL OR NEW.unit_price < 0 THEN
    RAISE EXCEPTION 'سعر الوحدة لا يمكن أن يكون سالبًا';
  END IF;
  IF COALESCE(NEW.discount, 0) < 0 THEN
    RAISE EXCEPTION 'الخصم لا يمكن أن يكون سالبًا';
  END IF;
  IF COALESCE(NEW.net_total, 0) < 0 THEN
    RAISE EXCEPTION 'صافي البند لا يمكن أن يكون سالبًا';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_sales_invoice_item ON public.sales_invoice_items;
CREATE TRIGGER trg_validate_sales_invoice_item
  BEFORE INSERT OR UPDATE ON public.sales_invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_document_item();

DROP TRIGGER IF EXISTS trg_validate_purchase_invoice_item ON public.purchase_invoice_items;
CREATE TRIGGER trg_validate_purchase_invoice_item
  BEFORE INSERT OR UPDATE ON public.purchase_invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_document_item();

DROP TRIGGER IF EXISTS trg_validate_sales_return_item ON public.sales_return_items;
CREATE TRIGGER trg_validate_sales_return_item
  BEFORE INSERT OR UPDATE ON public.sales_return_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_document_item();

DROP TRIGGER IF EXISTS trg_validate_purchase_return_item ON public.purchase_return_items;
CREATE TRIGGER trg_validate_purchase_return_item
  BEFORE INSERT OR UPDATE ON public.purchase_return_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_document_item();

-- 4) منع ترحيل مستند بلا بنود أو بإجمالي صفر
CREATE OR REPLACE FUNCTION public.fn_assert_document_postable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_items integer;
BEGIN
  IF NEW.status <> 'posted' THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT COUNT(*) FROM public.%I WHERE %I = $1', TG_ARGV[0], TG_ARGV[1])
    INTO v_items USING NEW.id;

  IF v_items = 0 THEN
    RAISE EXCEPTION 'لا يمكن ترحيل مستند بلا بنود';
  END IF;

  IF COALESCE(NEW.total, 0) <= 0 THEN
    RAISE EXCEPTION 'لا يمكن ترحيل مستند بإجمالي صفر أو سالب';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_sales_invoice_postable ON public.sales_invoices;
CREATE TRIGGER trg_assert_sales_invoice_postable
  BEFORE UPDATE ON public.sales_invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_assert_document_postable('sales_invoice_items', 'invoice_id');

DROP TRIGGER IF EXISTS trg_assert_purchase_invoice_postable ON public.purchase_invoices;
CREATE TRIGGER trg_assert_purchase_invoice_postable
  BEFORE UPDATE ON public.purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_assert_document_postable('purchase_invoice_items', 'invoice_id');

DROP TRIGGER IF EXISTS trg_assert_sales_return_postable ON public.sales_returns;
CREATE TRIGGER trg_assert_sales_return_postable
  BEFORE UPDATE ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.fn_assert_document_postable('sales_return_items', 'return_id');

DROP TRIGGER IF EXISTS trg_assert_purchase_return_postable ON public.purchase_returns;
CREATE TRIGGER trg_assert_purchase_return_postable
  BEFORE UPDATE ON public.purchase_returns
  FOR EACH ROW EXECUTE FUNCTION public.fn_assert_document_postable('purchase_return_items', 'return_id');

-- 5) منع مبالغ السندات والمصروفات السالبة أو الصفرية
CREATE OR REPLACE FUNCTION public.fn_validate_amount_positive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_customer_payment_amount ON public.customer_payments;
CREATE TRIGGER trg_validate_customer_payment_amount
  BEFORE INSERT OR UPDATE ON public.customer_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_amount_positive();

DROP TRIGGER IF EXISTS trg_validate_supplier_payment_amount ON public.supplier_payments;
CREATE TRIGGER trg_validate_supplier_payment_amount
  BEFORE INSERT OR UPDATE ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_amount_positive();

DROP TRIGGER IF EXISTS trg_validate_expense_amount ON public.expenses;
CREATE TRIGGER trg_validate_expense_amount
  BEFORE INSERT OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_amount_positive();

-- 6) منع التخصيص السالب أو الصفري في التسويات
CREATE OR REPLACE FUNCTION public.fn_validate_allocation_positive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.allocated_amount IS NULL OR NEW.allocated_amount <= 0 THEN
    RAISE EXCEPTION 'مبلغ التخصيص يجب أن يكون أكبر من صفر';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_customer_payment_allocation ON public.customer_payment_allocations;
CREATE TRIGGER trg_validate_customer_payment_allocation
  BEFORE INSERT OR UPDATE ON public.customer_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_allocation_positive();

DROP TRIGGER IF EXISTS trg_validate_supplier_payment_allocation ON public.supplier_payment_allocations;
CREATE TRIGGER trg_validate_supplier_payment_allocation
  BEFORE INSERT OR UPDATE ON public.supplier_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_allocation_positive();

-- 7) فهارس الأداء الأكثر استخدامًا في التقارير
CREATE INDEX IF NOT EXISTS idx_jel_entry ON public.journal_entry_lines (journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_jel_account ON public.journal_entry_lines (account_id);
CREATE INDEX IF NOT EXISTS idx_je_status_date ON public.journal_entries (status, entry_date);
CREATE INDEX IF NOT EXISTS idx_inv_mov_product_date ON public.inventory_movements (product_id, movement_date);
CREATE INDEX IF NOT EXISTS idx_inv_mov_reference ON public.inventory_movements (reference_id);
CREATE INDEX IF NOT EXISTS idx_si_status_date ON public.sales_invoices (status, invoice_date);
CREATE INDEX IF NOT EXISTS idx_pi_status_date ON public.purchase_invoices (status, invoice_date);
CREATE INDEX IF NOT EXISTS idx_sr_status_date ON public.sales_returns (status, return_date);
CREATE INDEX IF NOT EXISTS idx_pr_status_date ON public.purchase_returns (status, return_date);
CREATE INDEX IF NOT EXISTS idx_sii_invoice ON public.sales_invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_pii_invoice ON public.purchase_invoice_items (invoice_id);