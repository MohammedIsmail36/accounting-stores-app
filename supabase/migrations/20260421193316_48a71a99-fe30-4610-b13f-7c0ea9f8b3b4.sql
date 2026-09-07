-- 1) إضافة عمود net_total لجداول بنود المرتجعات
ALTER TABLE public.sales_return_items
  ADD COLUMN IF NOT EXISTS net_total numeric NOT NULL DEFAULT 0;

ALTER TABLE public.purchase_return_items
  ADD COLUMN IF NOT EXISTS net_total numeric NOT NULL DEFAULT 0;

-- 2) Backfill — توزيع خصم المرتجع نسبياً على الأسطر
-- Sales returns
WITH header AS (
  SELECT sr.id AS return_id,
         COALESCE(sr.discount, 0) AS discount,
         COALESCE(NULLIF(SUM(sri.total), 0), 0) AS sum_total
  FROM public.sales_returns sr
  JOIN public.sales_return_items sri ON sri.return_id = sr.id
  GROUP BY sr.id, sr.discount
)
UPDATE public.sales_return_items sri
SET net_total = ROUND(
  CASE
    WHEN h.sum_total > 0 AND h.discount > 0
      THEN sri.total - (sri.total / h.sum_total) * h.discount
    ELSE sri.total
  END
, 2)
FROM header h
WHERE sri.return_id = h.return_id;

-- Purchase returns
WITH header AS (
  SELECT pr.id AS return_id,
         COALESCE(pr.discount, 0) AS discount,
         COALESCE(NULLIF(SUM(pri.total), 0), 0) AS sum_total
  FROM public.purchase_returns pr
  JOIN public.purchase_return_items pri ON pri.return_id = pr.id
  GROUP BY pr.id, pr.discount
)
UPDATE public.purchase_return_items pri
SET net_total = ROUND(
  CASE
    WHEN h.sum_total > 0 AND h.discount > 0
      THEN pri.total - (pri.total / h.sum_total) * h.discount
    ELSE pri.total
  END
, 2)
FROM header h
WHERE pri.return_id = h.return_id;

-- 3) تحديث دالة متوسط سعر البيع — صافي للطرفين
CREATE OR REPLACE FUNCTION public.get_avg_selling_price(_product_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH sales AS (
    SELECT COALESCE(SUM(si.quantity), 0) AS qty,
           COALESCE(SUM(si.net_total), 0) AS amt
    FROM public.sales_invoice_items si
    JOIN public.sales_invoices s ON s.id = si.invoice_id
    WHERE si.product_id = _product_id AND s.status = 'posted'
  ),
  rets AS (
    SELECT COALESCE(SUM(ri.quantity), 0) AS qty,
           COALESCE(SUM(ri.net_total), 0) AS amt
    FROM public.sales_return_items ri
    JOIN public.sales_returns r ON r.id = ri.return_id
    WHERE ri.product_id = _product_id AND r.status = 'posted'
  )
  SELECT COALESCE(
    CASE WHEN (sales.qty - rets.qty) > 0
      THEN (sales.amt - rets.amt) / (sales.qty - rets.qty)
      ELSE 0 END, 0)
  FROM sales, rets
$function$;