
-- =====================================================================
-- 1) Tighten RLS on audit_log: admins only
-- =====================================================================
DROP POLICY IF EXISTS audit_log_view ON public.audit_log;
CREATE POLICY "Admins can view audit log"
ON public.audit_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- =====================================================================
-- 2) Concurrency lock in adjust_product_quantity (row-level lock)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.adjust_product_quantity(p_product_id uuid, p_delta numeric)
RETURNS numeric
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_qty NUMERIC;
  v_current NUMERIC;
BEGIN
  -- Lock the product row to serialize concurrent posts touching the same product
  SELECT quantity_on_hand INTO v_current
  FROM products WHERE id = p_product_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found: %', p_product_id;
  END IF;

  v_new_qty := v_current + p_delta;
  UPDATE products SET quantity_on_hand = v_new_qty WHERE id = p_product_id;
  RETURN v_new_qty;
END;
$function$;

-- =====================================================================
-- 3) Trigger: prevent return quantity from exceeding original invoice quantity
-- =====================================================================

-- Sales returns
CREATE OR REPLACE FUNCTION public.check_sales_return_qty()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_invoice_id uuid;
  v_invoice_qty numeric;
  v_already_returned numeric;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;

  SELECT sales_invoice_id INTO v_invoice_id FROM sales_returns WHERE id = NEW.return_id;
  IF v_invoice_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO v_invoice_qty
  FROM sales_invoice_items
  WHERE invoice_id = v_invoice_id AND product_id = NEW.product_id;

  SELECT COALESCE(SUM(sri.quantity), 0) INTO v_already_returned
  FROM sales_return_items sri
  JOIN sales_returns sr ON sr.id = sri.return_id
  WHERE sr.sales_invoice_id = v_invoice_id
    AND sri.product_id = NEW.product_id
    AND sri.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF (v_already_returned + NEW.quantity) > v_invoice_qty THEN
    RAISE EXCEPTION 'الكمية المرتجعة (%) للمنتج تتجاوز الكمية الأصلية بالفاتورة (%)',
      v_already_returned + NEW.quantity, v_invoice_qty;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_sales_return_qty ON public.sales_return_items;
CREATE TRIGGER trg_check_sales_return_qty
BEFORE INSERT OR UPDATE ON public.sales_return_items
FOR EACH ROW EXECUTE FUNCTION public.check_sales_return_qty();

-- Purchase returns
CREATE OR REPLACE FUNCTION public.check_purchase_return_qty()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_invoice_id uuid;
  v_invoice_qty numeric;
  v_already_returned numeric;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;

  SELECT purchase_invoice_id INTO v_invoice_id FROM purchase_returns WHERE id = NEW.return_id;
  IF v_invoice_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO v_invoice_qty
  FROM purchase_invoice_items
  WHERE invoice_id = v_invoice_id AND product_id = NEW.product_id;

  SELECT COALESCE(SUM(pri.quantity), 0) INTO v_already_returned
  FROM purchase_return_items pri
  JOIN purchase_returns pr ON pr.id = pri.return_id
  WHERE pr.purchase_invoice_id = v_invoice_id
    AND pri.product_id = NEW.product_id
    AND pri.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF (v_already_returned + NEW.quantity) > v_invoice_qty THEN
    RAISE EXCEPTION 'الكمية المرتجعة (%) للمنتج تتجاوز الكمية الأصلية بالفاتورة (%)',
      v_already_returned + NEW.quantity, v_invoice_qty;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_purchase_return_qty ON public.purchase_return_items;
CREATE TRIGGER trg_check_purchase_return_qty
BEFORE INSERT OR UPDATE ON public.purchase_return_items
FOR EACH ROW EXECUTE FUNCTION public.check_purchase_return_qty();

-- =====================================================================
-- 4) Positive-amount CHECK constraints
-- =====================================================================
ALTER TABLE public.customer_payments
  DROP CONSTRAINT IF EXISTS customer_payments_amount_positive,
  ADD  CONSTRAINT customer_payments_amount_positive CHECK (amount >= 0);

ALTER TABLE public.supplier_payments
  DROP CONSTRAINT IF EXISTS supplier_payments_amount_positive,
  ADD  CONSTRAINT supplier_payments_amount_positive CHECK (amount >= 0);

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_amount_positive,
  ADD  CONSTRAINT expenses_amount_positive CHECK (amount >= 0);

ALTER TABLE public.customer_payment_allocations
  DROP CONSTRAINT IF EXISTS cpa_amount_positive,
  ADD  CONSTRAINT cpa_amount_positive CHECK (allocated_amount > 0);

ALTER TABLE public.supplier_payment_allocations
  DROP CONSTRAINT IF EXISTS spa_amount_positive,
  ADD  CONSTRAINT spa_amount_positive CHECK (allocated_amount > 0);

ALTER TABLE public.sales_return_payment_allocations
  DROP CONSTRAINT IF EXISTS srpa_amount_positive,
  ADD  CONSTRAINT srpa_amount_positive CHECK (allocated_amount > 0);

ALTER TABLE public.purchase_return_payment_allocations
  DROP CONSTRAINT IF EXISTS prpa_amount_positive,
  ADD  CONSTRAINT prpa_amount_positive CHECK (allocated_amount > 0);

ALTER TABLE public.sales_invoice_return_settlements
  DROP CONSTRAINT IF EXISTS sirs_amount_positive,
  ADD  CONSTRAINT sirs_amount_positive CHECK (settled_amount > 0);

ALTER TABLE public.purchase_invoice_return_settlements
  DROP CONSTRAINT IF EXISTS pirs_amount_positive,
  ADD  CONSTRAINT pirs_amount_positive CHECK (settled_amount > 0);

-- =====================================================================
-- 5) Protect closing journal entries from edit/cancel
-- =====================================================================
CREATE OR REPLACE FUNCTION public.protect_closing_entries()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.entry_type = 'closing' THEN
      RAISE EXCEPTION 'لا يمكن حذف قيد إقفال السنة المالية';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.entry_type = 'closing' THEN
    -- allow status to remain 'posted' but block changing to cancelled or editing fields
    IF NEW.status <> OLD.status OR NEW.description <> OLD.description
       OR NEW.entry_date <> OLD.entry_date THEN
      RAISE EXCEPTION 'لا يمكن تعديل قيد إقفال السنة المالية';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_closing_entries ON public.journal_entries;
CREATE TRIGGER trg_protect_closing_entries
BEFORE UPDATE OR DELETE ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION public.protect_closing_entries();
