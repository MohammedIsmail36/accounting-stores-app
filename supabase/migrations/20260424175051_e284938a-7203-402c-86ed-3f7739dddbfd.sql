-- One-time historical balance correction:
-- Recalculate ALL customer/supplier balances using the same logic as src/lib/entity-balance.ts
-- (posted invoices - posted returns - posted payments + refund-portion of payments)

-- 1) Customers
WITH inv AS (
  SELECT customer_id, COALESCE(SUM(total), 0) AS total
  FROM sales_invoices WHERE status = 'posted' AND customer_id IS NOT NULL
  GROUP BY customer_id
),
ret AS (
  SELECT customer_id, COALESCE(SUM(total), 0) AS total
  FROM sales_returns WHERE status = 'posted' AND customer_id IS NOT NULL
  GROUP BY customer_id
),
pay AS (
  SELECT cp.customer_id,
         COALESCE(SUM(cp.amount - LEAST(cp.amount, GREATEST(0, COALESCE(ra.alloc, 0)))), 0) AS normal,
         COALESCE(SUM(LEAST(cp.amount, GREATEST(0, COALESCE(ra.alloc, 0)))), 0) AS refund
  FROM customer_payments cp
  LEFT JOIN (
    SELECT payment_id, SUM(allocated_amount) AS alloc
    FROM sales_return_payment_allocations GROUP BY payment_id
  ) ra ON ra.payment_id = cp.id
  WHERE cp.status = 'posted'
  GROUP BY cp.customer_id
)
UPDATE customers c
SET balance = ROUND(
  COALESCE(inv.total, 0) - COALESCE(ret.total, 0)
  - COALESCE(pay.normal, 0) + COALESCE(pay.refund, 0), 2)
FROM customers c2
LEFT JOIN inv ON inv.customer_id = c2.id
LEFT JOIN ret ON ret.customer_id = c2.id
LEFT JOIN pay ON pay.customer_id = c2.id
WHERE c.id = c2.id;

-- 2) Suppliers
WITH inv AS (
  SELECT supplier_id, COALESCE(SUM(total), 0) AS total
  FROM purchase_invoices WHERE status = 'posted' AND supplier_id IS NOT NULL
  GROUP BY supplier_id
),
ret AS (
  SELECT supplier_id, COALESCE(SUM(total), 0) AS total
  FROM purchase_returns WHERE status = 'posted' AND supplier_id IS NOT NULL
  GROUP BY supplier_id
),
pay AS (
  SELECT sp.supplier_id,
         COALESCE(SUM(sp.amount - LEAST(sp.amount, GREATEST(0, COALESCE(ra.alloc, 0)))), 0) AS normal,
         COALESCE(SUM(LEAST(sp.amount, GREATEST(0, COALESCE(ra.alloc, 0)))), 0) AS refund
  FROM supplier_payments sp
  LEFT JOIN (
    SELECT payment_id, SUM(allocated_amount) AS alloc
    FROM purchase_return_payment_allocations GROUP BY payment_id
  ) ra ON ra.payment_id = sp.id
  WHERE sp.status = 'posted'
  GROUP BY sp.supplier_id
)
UPDATE suppliers s
SET balance = ROUND(
  COALESCE(inv.total, 0) - COALESCE(ret.total, 0)
  - COALESCE(pay.normal, 0) + COALESCE(pay.refund, 0), 2)
FROM suppliers s2
LEFT JOIN inv ON inv.supplier_id = s2.id
LEFT JOIN ret ON ret.supplier_id = s2.id
LEFT JOIN pay ON pay.supplier_id = s2.id
WHERE s.id = s2.id;