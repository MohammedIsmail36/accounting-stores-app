-- Cost-bearing base tables must not be directly readable by the sales role.
-- Sales workflows use get_sales_product_catalog() and atomic document RPCs,
-- which expose only the fields needed to sell and return products.

DROP POLICY IF EXISTS "Authorized users can view products"
  ON public.products;

CREATE POLICY "Finance users can view products"
  ON public.products
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'accountant'::public.app_role)
  );

DROP POLICY IF EXISTS "Authorized users can view inventory movements"
  ON public.inventory_movements;

CREATE POLICY "Finance users can view inventory movements"
  ON public.inventory_movements
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'accountant'::public.app_role)
  );
