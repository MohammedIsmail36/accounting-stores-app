
-- Enum for inventory movement types
CREATE TYPE public.inventory_movement_type AS ENUM (
  'opening_balance',
  'purchase',
  'purchase_return',
  'sale',
  'sale_return',
  'adjustment'
);

-- Inventory movements table
CREATE TABLE public.inventory_movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id),
  movement_type inventory_movement_type NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  reference_id UUID,
  reference_type TEXT,
  notes TEXT,
  movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view inventory movements"
  ON public.inventory_movements FOR SELECT
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));

CREATE POLICY "Admin/accountant can insert inventory movements"
  ON public.inventory_movements FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

CREATE POLICY "Admin/accountant can update inventory movements"
  ON public.inventory_movements FOR UPDATE
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

CREATE POLICY "Admin can delete inventory movements"
  ON public.inventory_movements FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

CREATE INDEX idx_inventory_movements_product ON public.inventory_movements(product_id);
CREATE INDEX idx_inventory_movements_type ON public.inventory_movements(movement_type);
CREATE INDEX idx_inventory_movements_ref ON public.inventory_movements(reference_id);

-- Purchase returns table
CREATE TABLE public.purchase_returns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  return_number INTEGER NOT NULL DEFAULT nextval('purchase_invoices_invoice_number_seq'),
  purchase_invoice_id UUID REFERENCES public.purchase_invoices(id),
  supplier_id UUID REFERENCES public.suppliers(id),
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC NOT NULL DEFAULT 0,
  tax NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  notes TEXT,
  reference TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Use separate sequence for purchase returns
CREATE SEQUENCE IF NOT EXISTS purchase_returns_number_seq;
ALTER TABLE public.purchase_returns ALTER COLUMN return_number SET DEFAULT nextval('purchase_returns_number_seq');

ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view purchase returns" ON public.purchase_returns FOR SELECT
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
CREATE POLICY "Admin/accountant can insert purchase returns" ON public.purchase_returns FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
CREATE POLICY "Admin/accountant can update purchase returns" ON public.purchase_returns FOR UPDATE
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
CREATE POLICY "Admin can delete purchase returns" ON public.purchase_returns FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

CREATE TABLE public.purchase_return_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  return_id UUID NOT NULL REFERENCES public.purchase_returns(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  description TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_return_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view purchase return items" ON public.purchase_return_items FOR SELECT
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
CREATE POLICY "Admin/accountant can insert purchase return items" ON public.purchase_return_items FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
CREATE POLICY "Admin/accountant can update purchase return items" ON public.purchase_return_items FOR UPDATE
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
CREATE POLICY "Admin/accountant can delete purchase return items" ON public.purchase_return_items FOR DELETE
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- Sales returns table
CREATE TABLE public.sales_returns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  return_number INTEGER NOT NULL DEFAULT nextval('sales_invoices_invoice_number_seq'),
  sales_invoice_id UUID REFERENCES public.sales_invoices(id),
  customer_id UUID REFERENCES public.customers(id),
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC NOT NULL DEFAULT 0,
  tax NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  notes TEXT,
  reference TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS sales_returns_number_seq;
ALTER TABLE public.sales_returns ALTER COLUMN return_number SET DEFAULT nextval('sales_returns_number_seq');

ALTER TABLE public.sales_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view sales returns" ON public.sales_returns FOR SELECT
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
CREATE POLICY "Authorized can insert sales returns" ON public.sales_returns FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
CREATE POLICY "Authorized can update sales returns" ON public.sales_returns FOR UPDATE
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
CREATE POLICY "Admin can delete sales returns" ON public.sales_returns FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

CREATE TABLE public.sales_return_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  return_id UUID NOT NULL REFERENCES public.sales_returns(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  description TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.sales_return_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view sales return items" ON public.sales_return_items FOR SELECT
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
CREATE POLICY "Authorized can insert sales return items" ON public.sales_return_items FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
CREATE POLICY "Authorized can update sales return items" ON public.sales_return_items FOR UPDATE
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
CREATE POLICY "Authorized can delete sales return items" ON public.sales_return_items FOR DELETE
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- Customer payments table
CREATE TABLE public.customer_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_number INTEGER NOT NULL DEFAULT nextval('journal_entries_entry_number_seq'),
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  reference TEXT,
  notes TEXT,
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS customer_payments_number_seq;
ALTER TABLE public.customer_payments ALTER COLUMN payment_number SET DEFAULT nextval('customer_payments_number_seq');

ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view customer payments" ON public.customer_payments FOR SELECT
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
CREATE POLICY "Authorized can insert customer payments" ON public.customer_payments FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
CREATE POLICY "Authorized can update customer payments" ON public.customer_payments FOR UPDATE
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
CREATE POLICY "Admin can delete customer payments" ON public.customer_payments FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

-- Supplier payments table
CREATE TABLE public.supplier_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_number INTEGER NOT NULL DEFAULT nextval('journal_entries_entry_number_seq'),
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  reference TEXT,
  notes TEXT,
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS supplier_payments_number_seq;
ALTER TABLE public.supplier_payments ALTER COLUMN payment_number SET DEFAULT nextval('supplier_payments_number_seq');

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view supplier payments" ON public.supplier_payments FOR SELECT
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
CREATE POLICY "Admin/accountant can insert supplier payments" ON public.supplier_payments FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
CREATE POLICY "Admin/accountant can update supplier payments" ON public.supplier_payments FOR UPDATE
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
CREATE POLICY "Admin can delete supplier payments" ON public.supplier_payments FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

-- Function to get average purchase price from inventory movements
CREATE OR REPLACE FUNCTION public.get_avg_purchase_price(_product_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    CASE WHEN SUM(quantity) > 0 THEN SUM(total_cost) / SUM(quantity) ELSE 0 END,
    0
  )
  FROM public.inventory_movements
  WHERE product_id = _product_id
    AND movement_type IN ('purchase', 'opening_balance')
$$;

-- Function to get average selling price from inventory movements
CREATE OR REPLACE FUNCTION public.get_avg_selling_price(_product_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    CASE WHEN SUM(quantity) > 0 THEN SUM(total_cost) / SUM(quantity) ELSE 0 END,
    0
  )
  FROM public.inventory_movements
  WHERE product_id = _product_id
    AND movement_type = 'sale'
$$;

-- Triggers for updated_at
CREATE TRIGGER update_purchase_returns_updated_at BEFORE UPDATE ON public.purchase_returns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sales_returns_updated_at BEFORE UPDATE ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_customer_payments_updated_at BEFORE UPDATE ON public.customer_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_supplier_payments_updated_at BEFORE UPDATE ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
