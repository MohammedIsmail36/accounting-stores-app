
-- Update expenses RLS policies to allow sales role to view and insert
DROP POLICY IF EXISTS "Authorized users can view expenses" ON public.expenses;
CREATE POLICY "Authorized users can view expenses" ON public.expenses
  FOR SELECT USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'accountant'::app_role) OR
    has_role(auth.uid(), 'sales'::app_role)
  );

DROP POLICY IF EXISTS "Admin/accountant can insert expenses" ON public.expenses;
CREATE POLICY "Authorized can insert expenses" ON public.expenses
  FOR INSERT WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'accountant'::app_role) OR
    has_role(auth.uid(), 'sales'::app_role)
  );

-- Allow sales to view expense types (needed for expense form dropdown)
DROP POLICY IF EXISTS "Authorized users can view expense types" ON public.expense_types;
CREATE POLICY "Authorized users can view expense types" ON public.expense_types
  FOR SELECT USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'accountant'::app_role) OR
    has_role(auth.uid(), 'sales'::app_role)
  );
