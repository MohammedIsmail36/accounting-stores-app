
-- Add net_total column to sales_invoice_items
ALTER TABLE public.sales_invoice_items ADD COLUMN IF NOT EXISTS net_total numeric NOT NULL DEFAULT 0;

-- Backfill existing data: net_total = total (no invoice discount existed before)
UPDATE public.sales_invoice_items SET net_total = total WHERE net_total = 0 AND total > 0;

-- Update get_avg_selling_price to use net_total
CREATE OR REPLACE FUNCTION public.get_avg_selling_price(_product_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    CASE WHEN SUM(si.quantity) > 0
    THEN SUM(si.net_total) / SUM(si.quantity)
    ELSE 0 END,
    0
  )
  FROM public.sales_invoice_items si
  JOIN public.sales_invoices s ON s.id = si.invoice_id
  WHERE si.product_id = _product_id
    AND s.status = 'posted'
$$;
