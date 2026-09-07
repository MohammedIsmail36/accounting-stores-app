-- Create accounts table for Chart of Accounts (hierarchical)
CREATE TABLE public.accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT,
  is_parent BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

-- Admins and accountants can view all accounts
CREATE POLICY "Authorized users can view accounts"
ON public.accounts
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'accountant'::app_role) OR
  has_role(auth.uid(), 'sales'::app_role)
);

-- Only admins can insert accounts
CREATE POLICY "Admins can insert accounts"
ON public.accounts
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'accountant'::app_role)
);

-- Only admins can update accounts
CREATE POLICY "Admins can update accounts"
ON public.accounts
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'accountant'::app_role)
);

-- Only admins can delete accounts
CREATE POLICY "Admins can delete accounts"
ON public.accounts
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_accounts_updated_at
BEFORE UPDATE ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default chart of accounts (Arabic)
INSERT INTO public.accounts (code, name, account_type, is_parent) VALUES
-- Main parent accounts
('1', 'الأصول', 'asset', true),
('2', 'الخصوم', 'liability', true),
('3', 'حقوق الملكية', 'equity', true),
('4', 'الإيرادات', 'revenue', true),
('5', 'المصروفات', 'expense', true);

-- Insert sub-accounts
INSERT INTO public.accounts (code, name, account_type, parent_id, is_parent) VALUES
-- Assets sub-accounts
('11', 'الأصول المتداولة', 'asset', (SELECT id FROM public.accounts WHERE code = '1'), true),
('12', 'الأصول الثابتة', 'asset', (SELECT id FROM public.accounts WHERE code = '1'), true);

INSERT INTO public.accounts (code, name, account_type, parent_id) VALUES
('1101', 'الصندوق (النقدية)', 'asset', (SELECT id FROM public.accounts WHERE code = '11')),
('1102', 'البنك', 'asset', (SELECT id FROM public.accounts WHERE code = '11')),
('1103', 'العملاء (المدينون)', 'asset', (SELECT id FROM public.accounts WHERE code = '11')),
('1104', 'المخزون', 'asset', (SELECT id FROM public.accounts WHERE code = '11')),
('1201', 'الأثاث والتجهيزات', 'asset', (SELECT id FROM public.accounts WHERE code = '12')),
('1202', 'المعدات', 'asset', (SELECT id FROM public.accounts WHERE code = '12')),
('1203', 'السيارات', 'asset', (SELECT id FROM public.accounts WHERE code = '12')),

-- Liabilities sub-accounts
('2101', 'الموردون (الدائنون)', 'liability', (SELECT id FROM public.accounts WHERE code = '2')),
('2102', 'قروض قصيرة الأجل', 'liability', (SELECT id FROM public.accounts WHERE code = '2')),
('2103', 'قروض طويلة الأجل', 'liability', (SELECT id FROM public.accounts WHERE code = '2')),

-- Equity sub-accounts
('3101', 'رأس المال', 'equity', (SELECT id FROM public.accounts WHERE code = '3')),
('3102', 'الأرباح المحتجزة', 'equity', (SELECT id FROM public.accounts WHERE code = '3')),

-- Revenue sub-accounts
('4101', 'إيرادات المبيعات', 'revenue', (SELECT id FROM public.accounts WHERE code = '4')),
('4102', 'إيرادات الخدمات', 'revenue', (SELECT id FROM public.accounts WHERE code = '4')),
('4103', 'إيرادات أخرى', 'revenue', (SELECT id FROM public.accounts WHERE code = '4')),

-- Expense sub-accounts
('5101', 'تكلفة البضاعة المباعة', 'expense', (SELECT id FROM public.accounts WHERE code = '5')),
('5102', 'رواتب وأجور', 'expense', (SELECT id FROM public.accounts WHERE code = '5')),
('5103', 'إيجار', 'expense', (SELECT id FROM public.accounts WHERE code = '5')),
('5104', 'مصاريف كهرباء وماء', 'expense', (SELECT id FROM public.accounts WHERE code = '5')),
('5105', 'مصاريف إدارية', 'expense', (SELECT id FROM public.accounts WHERE code = '5')),
('5106', 'مصاريف تسويق', 'expense', (SELECT id FROM public.accounts WHERE code = '5')),
('5107', 'إهلاك', 'expense', (SELECT id FROM public.accounts WHERE code = '5'));