
-- جدول توزيع مدفوعات العملاء على فواتير المبيعات
CREATE TABLE public.customer_payment_allocations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES public.customer_payments(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
  allocated_amount NUMERIC NOT NULL CHECK (allocated_amount > 0),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- جدول توزيع مدفوعات الموردين على فواتير المشتريات
CREATE TABLE public.supplier_payment_allocations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES public.supplier_payments(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  allocated_amount NUMERIC NOT NULL CHECK (allocated_amount > 0),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_cpa_payment ON public.customer_payment_allocations(payment_id);
CREATE INDEX idx_cpa_invoice ON public.customer_payment_allocations(invoice_id);
CREATE INDEX idx_spa_payment ON public.supplier_payment_allocations(payment_id);
CREATE INDEX idx_spa_invoice ON public.supplier_payment_allocations(invoice_id);

-- Unique constraint: a payment can only be allocated to a specific invoice once
CREATE UNIQUE INDEX idx_cpa_unique ON public.customer_payment_allocations(payment_id, invoice_id);
CREATE UNIQUE INDEX idx_spa_unique ON public.supplier_payment_allocations(payment_id, invoice_id);

-- RLS for customer_payment_allocations
ALTER TABLE public.customer_payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view customer payment allocations"
ON public.customer_payment_allocations FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'sales'::app_role));

CREATE POLICY "Authorized can insert customer payment allocations"
ON public.customer_payment_allocations FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'sales'::app_role));

CREATE POLICY "Authorized can delete customer payment allocations"
ON public.customer_payment_allocations FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

-- RLS for supplier_payment_allocations
ALTER TABLE public.supplier_payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view supplier payment allocations"
ON public.supplier_payment_allocations FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

CREATE POLICY "Authorized can insert supplier payment allocations"
ON public.supplier_payment_allocations FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

CREATE POLICY "Authorized can delete supplier payment allocations"
ON public.supplier_payment_allocations FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));
