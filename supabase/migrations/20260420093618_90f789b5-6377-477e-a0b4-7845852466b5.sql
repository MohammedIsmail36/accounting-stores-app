CREATE OR REPLACE FUNCTION public.get_avg_purchase_price(_product_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    CASE
      WHEN SUM(CASE
        WHEN movement_type IN ('purchase','opening_balance') THEN quantity
        WHEN movement_type = 'purchase_return' THEN -quantity
        ELSE 0 END) > 0
      THEN SUM(CASE
        WHEN movement_type IN ('purchase','opening_balance') THEN total_cost
        WHEN movement_type = 'purchase_return' THEN -total_cost
        ELSE 0 END)
        /
        SUM(CASE
        WHEN movement_type IN ('purchase','opening_balance') THEN quantity
        WHEN movement_type = 'purchase_return' THEN -quantity
        ELSE 0 END)
      ELSE 0 END, 0)
  FROM public.inventory_movements
  WHERE product_id = _product_id
    AND movement_type IN ('purchase','opening_balance','purchase_return')
$$;

CREATE OR REPLACE FUNCTION public.get_avg_selling_price(_product_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH sales AS (
    SELECT COALESCE(SUM(si.quantity), 0) AS qty,
           COALESCE(SUM(si.net_total), 0) AS amt
    FROM public.sales_invoice_items si
    JOIN public.sales_invoices s ON s.id = si.invoice_id
    WHERE si.product_id = _product_id AND s.status = 'posted'
  ),
  rets AS (
    SELECT COALESCE(SUM(ri.quantity), 0) AS qty,
           COALESCE(SUM(ri.total), 0) AS amt
    FROM public.sales_return_items ri
    JOIN public.sales_returns r ON r.id = ri.return_id
    WHERE ri.product_id = _product_id AND r.status = 'posted'
  )
  SELECT COALESCE(
    CASE WHEN (sales.qty - rets.qty) > 0
      THEN (sales.amt - rets.amt) / (sales.qty - rets.qty)
      ELSE 0 END, 0)
  FROM sales, rets
$$;