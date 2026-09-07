
-- Customer/Supplier Statement & Ledger performance indexes

-- Sales invoices: customer + date (statement queries)
CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer_date
  ON public.sales_invoices (customer_id, invoice_date DESC)
  WHERE status = 'posted';

-- Sales returns: customer + date
CREATE INDEX IF NOT EXISTS idx_sales_returns_customer_date
  ON public.sales_returns (customer_id, return_date DESC)
  WHERE status = 'posted';

-- Customer payments: customer + date
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer_date
  ON public.customer_payments (customer_id, payment_date DESC)
  WHERE status = 'posted';

-- Purchase invoices: supplier + date
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier_date
  ON public.purchase_invoices (supplier_id, invoice_date DESC)
  WHERE status = 'posted';

-- Purchase returns: supplier + date
CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier_date
  ON public.purchase_returns (supplier_id, return_date DESC)
  WHERE status = 'posted';

-- Supplier payments: supplier + date
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_date
  ON public.supplier_payments (supplier_id, payment_date DESC)
  WHERE status = 'posted';

-- Ledger: journal_entry_lines by account (most critical)
CREATE INDEX IF NOT EXISTS idx_jel_account_entry
  ON public.journal_entry_lines (account_id, journal_entry_id);

-- Journal entries by date + status (for ledger date filtering)
CREATE INDEX IF NOT EXISTS idx_journal_entries_date_status
  ON public.journal_entries (entry_date DESC, status);

-- Posted journal entries fast lookup
CREATE INDEX IF NOT EXISTS idx_journal_entries_posted
  ON public.journal_entries (entry_date DESC)
  WHERE status = 'posted';

-- Customer/Supplier name search (trigram for ilike)
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON public.customers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm
  ON public.suppliers USING gin (name gin_trgm_ops);

-- Allocation lookups (settlement progress on statements)
CREATE INDEX IF NOT EXISTS idx_cust_pay_alloc_invoice
  ON public.customer_payment_allocations (invoice_id);

CREATE INDEX IF NOT EXISTS idx_supp_pay_alloc_invoice
  ON public.supplier_payment_allocations (invoice_id);

ANALYZE public.sales_invoices;
ANALYZE public.sales_returns;
ANALYZE public.customer_payments;
ANALYZE public.purchase_invoices;
ANALYZE public.purchase_returns;
ANALYZE public.supplier_payments;
ANALYZE public.journal_entry_lines;
ANALYZE public.journal_entries;
