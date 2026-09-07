
ALTER TABLE purchase_invoice_items ADD COLUMN IF NOT EXISTS net_total numeric NOT NULL DEFAULT 0;

UPDATE purchase_invoice_items SET net_total = total WHERE net_total = 0;

CREATE OR REPLACE FUNCTION public.get_avg_purchase_price(_product_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    CASE WHEN SUM(quantity) > 0
    THEN SUM(total_cost) / SUM(quantity)
    ELSE 0 END,
    0
  )
  FROM public.inventory_movements
  WHERE product_id = _product_id
    AND movement_type IN ('purchase', 'opening_balance')
$$;
