-- Safe product catalogue for sales documents.
-- It intentionally omits purchase_price and every inventory cost field.
CREATE OR REPLACE FUNCTION public.get_sales_product_catalog()
RETURNS TABLE(
  id uuid,
  code text,
  name text,
  barcode text,
  model_number text,
  selling_price numeric,
  quantity_on_hand numeric,
  is_active boolean,
  product_brands jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT (
       public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'accountant'::public.app_role)
       OR public.has_role(auth.uid(), 'sales'::public.app_role)
     ) THEN
    RAISE EXCEPTION 'غير مصرح بقراءة كتالوج البيع'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    product.id,
    product.code,
    product.name,
    product.barcode,
    product.model_number,
    product.selling_price,
    product.quantity_on_hand,
    product.is_active,
    CASE
      WHEN brand.id IS NULL THEN NULL
      ELSE jsonb_build_object('name', brand.name)
    END AS product_brands
  FROM public.products product
  LEFT JOIN public.product_brands brand ON brand.id = product.brand_id
  ORDER BY product.name, product.code, product.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_sales_product_catalog()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_product_catalog()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_sales_product_catalog() IS
  'Role-checked sales catalogue without purchase price, unit cost, total cost, or profit fields.';
