
-- Add invoice linking columns to payment tables
ALTER TABLE public.customer_payments
ADD COLUMN IF NOT EXISTS sales_invoice_id uuid REFERENCES public.sales_invoices(id);

ALTER TABLE public.supplier_payments
ADD COLUMN IF NOT EXISTS purchase_invoice_id uuid REFERENCES public.purchase_invoices(id);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_customer_payments_invoice ON public.customer_payments(sales_invoice_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_invoice ON public.supplier_payments(purchase_invoice_id);
