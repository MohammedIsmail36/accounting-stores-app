-- Performance indexes for frequently filtered/sorted columns

-- inventory_movements: filtering by product + date range
CREATE INDEX IF NOT EXISTS idx_inv_mov_product_date
  ON public.inventory_movements (product_id, movement_date DESC);

CREATE INDEX IF NOT EXISTS idx_inv_mov_type_date
  ON public.inventory_movements (movement_type, movement_date DESC);

CREATE INDEX IF NOT EXISTS idx_inv_mov_reference
  ON public.inventory_movements (reference_type, reference_id);

-- sales_invoices
CREATE INDEX IF NOT EXISTS idx_sales_inv_date_status
  ON public.sales_invoices (invoice_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_sales_inv_customer
  ON public.sales_invoices (customer_id);

CREATE INDEX IF NOT EXISTS idx_sales_inv_status
  ON public.sales_invoices (status);

-- purchase_invoices
CREATE INDEX IF NOT EXISTS idx_purchase_inv_date_status
  ON public.purchase_invoices (invoice_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_purchase_inv_supplier
  ON public.purchase_invoices (supplier_id);

CREATE INDEX IF NOT EXISTS idx_purchase_inv_status
  ON public.purchase_invoices (status);

-- journal_entries
CREATE INDEX IF NOT EXISTS idx_je_date_status
  ON public.journal_entries (entry_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_je_status
  ON public.journal_entries (status);

-- journal_entry_lines: lookups by entry and account
CREATE INDEX IF NOT EXISTS idx_jel_entry
  ON public.journal_entry_lines (journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_jel_account
  ON public.journal_entry_lines (account_id);

-- sales_invoice_items
CREATE INDEX IF NOT EXISTS idx_sii_invoice
  ON public.sales_invoice_items (invoice_id);

CREATE INDEX IF NOT EXISTS idx_sii_product
  ON public.sales_invoice_items (product_id);

-- purchase_invoice_items
CREATE INDEX IF NOT EXISTS idx_pii_invoice
  ON public.purchase_invoice_items (invoice_id);

CREATE INDEX IF NOT EXISTS idx_pii_product
  ON public.purchase_invoice_items (product_id);

-- sales_returns / purchase_returns
CREATE INDEX IF NOT EXISTS idx_sret_date_status
  ON public.sales_returns (return_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_sret_customer
  ON public.sales_returns (customer_id);

CREATE INDEX IF NOT EXISTS idx_sret_invoice
  ON public.sales_returns (sales_invoice_id);

CREATE INDEX IF NOT EXISTS idx_pret_date_status
  ON public.purchase_returns (return_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_pret_supplier
  ON public.purchase_returns (supplier_id);

CREATE INDEX IF NOT EXISTS idx_pret_invoice
  ON public.purchase_returns (purchase_invoice_id);

-- sales_return_items / purchase_return_items
CREATE INDEX IF NOT EXISTS idx_sri_return
  ON public.sales_return_items (return_id);

CREATE INDEX IF NOT EXISTS idx_sri_product
  ON public.sales_return_items (product_id);

CREATE INDEX IF NOT EXISTS idx_pri_return
  ON public.purchase_return_items (return_id);

CREATE INDEX IF NOT EXISTS idx_pri_product
  ON public.purchase_return_items (product_id);

-- payments + allocations
CREATE INDEX IF NOT EXISTS idx_cp_customer_date
  ON public.customer_payments (customer_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_cp_status_date
  ON public.customer_payments (status, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_sp_supplier_date
  ON public.supplier_payments (supplier_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_sp_status_date
  ON public.supplier_payments (status, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_cpa_payment
  ON public.customer_payment_allocations (payment_id);

CREATE INDEX IF NOT EXISTS idx_cpa_invoice
  ON public.customer_payment_allocations (invoice_id);

CREATE INDEX IF NOT EXISTS idx_spa_payment
  ON public.supplier_payment_allocations (payment_id);

CREATE INDEX IF NOT EXISTS idx_spa_invoice
  ON public.supplier_payment_allocations (invoice_id);

-- products: filtering / sorting
CREATE INDEX IF NOT EXISTS idx_products_active
  ON public.products (is_active);

CREATE INDEX IF NOT EXISTS idx_products_category
  ON public.products (category_id);

CREATE INDEX IF NOT EXISTS idx_products_brand
  ON public.products (brand_id);

CREATE INDEX IF NOT EXISTS idx_products_name_lower
  ON public.products (lower(name));

-- expenses
CREATE INDEX IF NOT EXISTS idx_expenses_date_status
  ON public.expenses (expense_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_expenses_type
  ON public.expenses (expense_type_id);

-- inventory_adjustments
CREATE INDEX IF NOT EXISTS idx_ia_date_status
  ON public.inventory_adjustments (adjustment_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_iai_adjustment
  ON public.inventory_adjustment_items (adjustment_id);

CREATE INDEX IF NOT EXISTS idx_iai_product
  ON public.inventory_adjustment_items (product_id);

-- audit_log: queries by table+record and time
CREATE INDEX IF NOT EXISTS idx_audit_table_record
  ON public.audit_log (table_name, record_id);

CREATE INDEX IF NOT EXISTS idx_audit_created
  ON public.audit_log (created_at DESC);
