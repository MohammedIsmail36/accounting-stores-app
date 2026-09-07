
-- Sales invoice return settlements (ربط مرتجع مبيعات مباشرة بفاتورة بيع)
CREATE TABLE public.sales_invoice_return_settlements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
  return_id UUID NOT NULL REFERENCES public.sales_returns(id) ON DELETE CASCADE,
  settled_amount NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Purchase invoice return settlements (ربط مرتجع مشتريات مباشرة بفاتورة شراء)
CREATE TABLE public.purchase_invoice_return_settlements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  return_id UUID NOT NULL REFERENCES public.purchase_returns(id) ON DELETE CASCADE,
  settled_amount NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sales_invoice_return_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoice_return_settlements ENABLE ROW LEVEL SECURITY;

-- RLS policies for sales settlements
CREATE POLICY "Authorized can view sales settlements" ON public.sales_invoice_return_settlements
  FOR SELECT TO public USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'sales'::app_role)
  );
CREATE POLICY "Authorized can insert sales settlements" ON public.sales_invoice_return_settlements
  FOR INSERT TO public WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'sales'::app_role)
  );
CREATE POLICY "Authorized can delete sales settlements" ON public.sales_invoice_return_settlements
  FOR DELETE TO public USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role)
  );

-- RLS policies for purchase settlements
CREATE POLICY "Authorized can view purchase settlements" ON public.purchase_invoice_return_settlements
  FOR SELECT TO public USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role)
  );
CREATE POLICY "Authorized can insert purchase settlements" ON public.purchase_invoice_return_settlements
  FOR INSERT TO public WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role)
  );
CREATE POLICY "Authorized can delete purchase settlements" ON public.purchase_invoice_return_settlements
  FOR DELETE TO public USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role)
  );
