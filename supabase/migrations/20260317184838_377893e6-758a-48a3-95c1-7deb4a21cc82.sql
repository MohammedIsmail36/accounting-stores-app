
-- Fix product_brands policies
DROP POLICY IF EXISTS "Admin/accountant can manage brands" ON public.product_brands;
DROP POLICY IF EXISTS "Authorized users can view brands" ON public.product_brands;

CREATE POLICY "Authorized users can view brands"
ON public.product_brands FOR SELECT
TO public
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'sales'::app_role));

CREATE POLICY "Admin/accountant can insert brands"
ON public.product_brands FOR INSERT
TO public
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

CREATE POLICY "Admin/accountant can update brands"
ON public.product_brands FOR UPDATE
TO public
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

CREATE POLICY "Admin can delete brands"
ON public.product_brands FOR DELETE
TO public
USING (has_role(auth.uid(), 'admin'::app_role));

-- Fix product_categories policies
DROP POLICY IF EXISTS "Admin/accountant can manage categories" ON public.product_categories;
DROP POLICY IF EXISTS "Authorized users can view categories" ON public.product_categories;

CREATE POLICY "Authorized users can view categories"
ON public.product_categories FOR SELECT
TO public
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'sales'::app_role));

CREATE POLICY "Admin/accountant can insert categories"
ON public.product_categories FOR INSERT
TO public
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

CREATE POLICY "Admin/accountant can update categories"
ON public.product_categories FOR UPDATE
TO public
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

CREATE POLICY "Admin can delete categories"
ON public.product_categories FOR DELETE
TO public
USING (has_role(auth.uid(), 'admin'::app_role));

-- Fix product_images policies
DROP POLICY IF EXISTS "Admin/accountant can manage product images" ON public.product_images;
DROP POLICY IF EXISTS "Authorized users can view product images" ON public.product_images;

CREATE POLICY "Authorized users can view product images"
ON public.product_images FOR SELECT
TO public
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'sales'::app_role));

CREATE POLICY "Admin/accountant can insert product images"
ON public.product_images FOR INSERT
TO public
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

CREATE POLICY "Admin/accountant can update product images"
ON public.product_images FOR UPDATE
TO public
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role));

CREATE POLICY "Admin can delete product images"
ON public.product_images FOR DELETE
TO public
USING (has_role(auth.uid(), 'admin'::app_role));
