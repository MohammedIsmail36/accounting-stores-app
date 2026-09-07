
-- Enable trigram extension for fast ILIKE searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ═══════════════════════════════════════════════════════════════
-- INDEXES for performance at scale
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_sales_invoices_date_status ON public.sales_invoices(invoice_date DESC, status);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer ON public.sales_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_status ON public.sales_invoices(status);

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_date_status ON public.purchase_invoices(invoice_date DESC, status);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier ON public.purchase_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_status ON public.purchase_invoices(status);

CREATE INDEX IF NOT EXISTS idx_journal_entries_date_status ON public.journal_entries(entry_date DESC, status);
CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON public.journal_entries(status);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_date ON public.inventory_movements(movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON public.inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type ON public.inventory_movements(movement_type);

CREATE INDEX IF NOT EXISTS idx_products_active_code ON public.products(is_active, code);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON public.products USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_code_trgm ON public.products USING gin(code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_brand ON public.products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);

CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON public.customers USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm ON public.suppliers USING gin(name gin_trgm_ops);

-- ═══════════════════════════════════════════════════════════════
-- RPC: get_sales_summary
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_sales_summary(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH inv AS (
    SELECT status, total, paid_amount, due_date
    FROM sales_invoices
    WHERE (p_date_from IS NULL OR invoice_date >= p_date_from)
      AND (p_date_to IS NULL OR invoice_date <= p_date_to)
  ),
  ret AS (
    SELECT COALESCE(SUM(total), 0) AS total_returns
    FROM sales_returns
    WHERE status = 'posted'
      AND (p_date_from IS NULL OR return_date >= p_date_from)
      AND (p_date_to IS NULL OR return_date <= p_date_to)
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT COUNT(*) FROM inv),
    'draft_count', (SELECT COUNT(*) FROM inv WHERE status = 'draft'),
    'posted_count', (SELECT COUNT(*) FROM inv WHERE status = 'posted'),
    'cancelled_count', (SELECT COUNT(*) FROM inv WHERE status = 'cancelled'),
    'total_sales', (SELECT COALESCE(SUM(total), 0) FROM inv WHERE status = 'posted'),
    'total_paid', (SELECT COALESCE(SUM(paid_amount), 0) FROM inv WHERE status = 'posted'),
    'total_outstanding', (SELECT COALESCE(SUM(total - paid_amount), 0) FROM inv WHERE status = 'posted'),
    'total_returns', (SELECT total_returns FROM ret),
    'overdue_count', (SELECT COUNT(*) FROM inv WHERE status = 'posted' AND due_date IS NOT NULL AND due_date < CURRENT_DATE AND (total - paid_amount) > 0)
  )
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC: get_purchases_summary
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_purchases_summary(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH inv AS (
    SELECT status, total, paid_amount, due_date
    FROM purchase_invoices
    WHERE (p_date_from IS NULL OR invoice_date >= p_date_from)
      AND (p_date_to IS NULL OR invoice_date <= p_date_to)
  ),
  ret AS (
    SELECT COALESCE(SUM(total), 0) AS total_returns
    FROM purchase_returns
    WHERE status = 'posted'
      AND (p_date_from IS NULL OR return_date >= p_date_from)
      AND (p_date_to IS NULL OR return_date <= p_date_to)
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT COUNT(*) FROM inv),
    'draft_count', (SELECT COUNT(*) FROM inv WHERE status = 'draft'),
    'posted_count', (SELECT COUNT(*) FROM inv WHERE status = 'posted'),
    'cancelled_count', (SELECT COUNT(*) FROM inv WHERE status = 'cancelled'),
    'total_purchases', (SELECT COALESCE(SUM(total), 0) FROM inv WHERE status = 'posted'),
    'total_paid', (SELECT COALESCE(SUM(paid_amount), 0) FROM inv WHERE status = 'posted'),
    'total_outstanding', (SELECT COALESCE(SUM(total - paid_amount), 0) FROM inv WHERE status = 'posted'),
    'total_returns', (SELECT total_returns FROM ret),
    'overdue_count', (SELECT COUNT(*) FROM inv WHERE status = 'posted' AND due_date IS NOT NULL AND due_date < CURRENT_DATE AND (total - paid_amount) > 0)
  )
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC: get_journal_summary
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_journal_summary(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH je AS (
    SELECT status, total_debit, total_credit
    FROM journal_entries
    WHERE (p_date_from IS NULL OR entry_date >= p_date_from)
      AND (p_date_to IS NULL OR entry_date <= p_date_to)
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT COUNT(*) FROM je),
    'draft_count', (SELECT COUNT(*) FROM je WHERE status = 'draft'),
    'posted_count', (SELECT COUNT(*) FROM je WHERE status = 'posted'),
    'cancelled_count', (SELECT COUNT(*) FROM je WHERE status = 'cancelled'),
    'total_debit', (SELECT COALESCE(SUM(total_debit), 0) FROM je WHERE status = 'posted'),
    'total_credit', (SELECT COALESCE(SUM(total_credit), 0) FROM je WHERE status = 'posted')
  )
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC: get_inventory_movements_summary
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_inventory_movements_summary(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_product_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH mv AS (
    SELECT movement_type, quantity, total_cost
    FROM inventory_movements
    WHERE (p_date_from IS NULL OR movement_date >= p_date_from)
      AND (p_date_to IS NULL OR movement_date <= p_date_to)
      AND (p_product_id IS NULL OR product_id = p_product_id)
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT COUNT(*) FROM mv),
    'in_qty', (SELECT COALESCE(SUM(quantity), 0) FROM mv WHERE movement_type IN ('purchase','opening_balance','sale_return')),
    'out_qty', (SELECT COALESCE(SUM(quantity), 0) FROM mv WHERE movement_type IN ('sale','purchase_return')),
    'in_value', (SELECT COALESCE(SUM(total_cost), 0) FROM mv WHERE movement_type IN ('purchase','opening_balance','sale_return')),
    'out_value', (SELECT COALESCE(SUM(total_cost), 0) FROM mv WHERE movement_type IN ('sale','purchase_return')),
    'adjustment_count', (SELECT COUNT(*) FROM mv WHERE movement_type = 'adjustment')
  )
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC: get_products_summary
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_products_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_count', COUNT(*),
    'active_count', COUNT(*) FILTER (WHERE is_active = true),
    'inactive_count', COUNT(*) FILTER (WHERE is_active = false),
    'low_stock_count', COUNT(*) FILTER (WHERE is_active = true AND quantity_on_hand <= min_stock_level AND min_stock_level > 0),
    'out_of_stock_count', COUNT(*) FILTER (WHERE is_active = true AND quantity_on_hand <= 0),
    'total_stock_value', COALESCE(SUM(quantity_on_hand * purchase_price) FILTER (WHERE is_active = true), 0)
  )
  FROM products
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_sales_summary(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_purchases_summary(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_journal_summary(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inventory_movements_summary(date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_products_summary() TO authenticated;
