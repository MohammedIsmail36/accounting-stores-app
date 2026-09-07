
-- Drop existing policies on product_units
DROP POLICY IF EXISTS "Admin/accountant can manage units" ON public.product_units;
DROP POLICY IF EXISTS "Authorized users can view units" ON public.product_units;

-- Recreate with public role (matching other tables pattern)
CREATE POLICY "Authorized users can view units"
ON public.product_units FOR SELECT
TO public
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'sales'::app_role));

CREATE POLICY "Admin/accountant can insert units"
ON public.product_units FOR INSERT
TO public
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

CREATE POLICY "Admin/accountant can update units"
ON public.product_units FOR UPDATE
TO public
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

CREATE POLICY "Admin can delete units"
ON public.product_units FOR DELETE
TO public
USING (has_role(auth.uid(), 'admin'::app_role));
