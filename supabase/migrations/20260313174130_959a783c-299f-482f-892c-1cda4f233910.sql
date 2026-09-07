-- Create allocation tables for return payments
CREATE TABLE IF NOT EXISTS public.sales_return_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.customer_payments(id) ON DELETE CASCADE,
  return_id UUID NOT NULL REFERENCES public.sales_returns(id) ON DELETE CASCADE,
  allocated_amount NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_return_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.supplier_payments(id) ON DELETE CASCADE,
  return_id UUID NOT NULL REFERENCES public.purchase_returns(id) ON DELETE CASCADE,
  allocated_amount NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sales_return_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_return_payment_allocations ENABLE ROW LEVEL SECURITY;

-- RLS policies for sales_return_payment_allocations
CREATE POLICY "Authorized can view sales return payment allocations" ON public.sales_return_payment_allocations
  FOR SELECT TO public USING (
    has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales')
  );

CREATE POLICY "Authorized can insert sales return payment allocations" ON public.sales_return_payment_allocations
  FOR INSERT TO public WITH CHECK (
    has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales')
  );

CREATE POLICY "Authorized can delete sales return payment allocations" ON public.sales_return_payment_allocations
  FOR DELETE TO public USING (
    has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')
  );

-- RLS policies for purchase_return_payment_allocations
CREATE POLICY "Authorized can view purchase return payment allocations" ON public.purchase_return_payment_allocations
  FOR SELECT TO public USING (
    has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')
  );

CREATE POLICY "Authorized can insert purchase return payment allocations" ON public.purchase_return_payment_allocations
  FOR INSERT TO public WITH CHECK (
    has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')
  );

CREATE POLICY "Authorized can delete purchase return payment allocations" ON public.purchase_return_payment_allocations
  FOR DELETE TO public USING (
    has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')
  );