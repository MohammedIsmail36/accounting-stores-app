
-- expense_types table
CREATE TABLE public.expense_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.expense_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view expense types" ON public.expense_types
  FOR SELECT TO public USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'sales'::app_role)
  );

CREATE POLICY "Admin/accountant can insert expense types" ON public.expense_types
  FOR INSERT TO public WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role)
  );

CREATE POLICY "Admin/accountant can update expense types" ON public.expense_types
  FOR UPDATE TO public USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role)
  );

CREATE POLICY "Admin can delete expense types" ON public.expense_types
  FOR DELETE TO public USING (
    has_role(auth.uid(), 'admin'::app_role)
  );

-- expenses table
CREATE SEQUENCE IF NOT EXISTS public.expenses_number_seq;

CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_number integer NOT NULL DEFAULT nextval('expenses_number_seq'),
  posted_number integer,
  expense_type_id uuid NOT NULL REFERENCES public.expense_types(id),
  amount numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'cash',
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  description text,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  status text NOT NULL DEFAULT 'draft',
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view expenses" ON public.expenses
  FOR SELECT TO public USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role)
  );

CREATE POLICY "Admin/accountant can insert expenses" ON public.expenses
  FOR INSERT TO public WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role)
  );

CREATE POLICY "Admin/accountant can update expenses" ON public.expenses
  FOR UPDATE TO public USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role)
  );

CREATE POLICY "Admin can delete expenses" ON public.expenses
  FOR DELETE TO public USING (
    has_role(auth.uid(), 'admin'::app_role)
  );

-- Add update trigger
CREATE TRIGGER update_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add expense_prefix to company_settings
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS expense_prefix text NOT NULL DEFAULT 'EXP-';
