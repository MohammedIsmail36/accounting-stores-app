
-- Fix get_avg_selling_price to calculate from actual sales invoice items instead of inventory movements
CREATE OR REPLACE FUNCTION public.get_avg_selling_price(_product_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    CASE WHEN SUM(si.quantity) > 0 THEN SUM(si.total) / SUM(si.quantity) ELSE 0 END,
    0
  )
  FROM public.sales_invoice_items si
  JOIN public.sales_invoices s ON s.id = si.invoice_id
  WHERE si.product_id = _product_id
    AND s.status = 'posted'
$function$;
