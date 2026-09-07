
-- Create sequence first
CREATE SEQUENCE IF NOT EXISTS public.inventory_adjustments_number_seq START WITH 1 INCREMENT BY 1;

-- جدول تسويات المخزون
CREATE TABLE IF NOT EXISTS public.inventory_adjustments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  adjustment_number INTEGER NOT NULL DEFAULT nextval('inventory_adjustments_number_seq'::regclass),
  adjustment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- بنود التسوية
CREATE TABLE IF NOT EXISTS public.inventory_adjustment_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  adjustment_id UUID NOT NULL REFERENCES public.inventory_adjustments(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  system_quantity NUMERIC NOT NULL DEFAULT 0,
  actual_quantity NUMERIC NOT NULL DEFAULT 0,
  difference NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_adjustment_items ENABLE ROW LEVEL SECURITY;

-- Policies for inventory_adjustments
DROP POLICY IF EXISTS "Authorized users can view inventory adjustments" ON public.inventory_adjustments;
CREATE POLICY "Authorized users can view inventory adjustments" ON public.inventory_adjustments FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

DROP POLICY IF EXISTS "Admin/accountant can insert inventory adjustments" ON public.inventory_adjustments;
CREATE POLICY "Admin/accountant can insert inventory adjustments" ON public.inventory_adjustments FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

DROP POLICY IF EXISTS "Admin/accountant can update inventory adjustments" ON public.inventory_adjustments;
CREATE POLICY "Admin/accountant can update inventory adjustments" ON public.inventory_adjustments FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

DROP POLICY IF EXISTS "Admin can delete inventory adjustments" ON public.inventory_adjustments;
CREATE POLICY "Admin can delete inventory adjustments" ON public.inventory_adjustments FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));

-- Policies for inventory_adjustment_items
DROP POLICY IF EXISTS "Authorized users can view inventory adjustment items" ON public.inventory_adjustment_items;
CREATE POLICY "Authorized users can view inventory adjustment items" ON public.inventory_adjustment_items FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

DROP POLICY IF EXISTS "Admin/accountant can insert inventory adjustment items" ON public.inventory_adjustment_items;
CREATE POLICY "Admin/accountant can insert inventory adjustment items" ON public.inventory_adjustment_items FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

DROP POLICY IF EXISTS "Admin/accountant can update inventory adjustment items" ON public.inventory_adjustment_items;
CREATE POLICY "Admin/accountant can update inventory adjustment items" ON public.inventory_adjustment_items FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

DROP POLICY IF EXISTS "Admin/accountant can delete inventory adjustment items" ON public.inventory_adjustment_items;
CREATE POLICY "Admin/accountant can delete inventory adjustment items" ON public.inventory_adjustment_items FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_inventory_adjustments_updated_at ON public.inventory_adjustments;
CREATE TRIGGER update_inventory_adjustments_updated_at
  BEFORE UPDATE ON public.inventory_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
