UPDATE public.journal_entries
SET description = 'عكس فاتورة بيع رقم INV-0102'
WHERE id = 'ecbb67ec-95b5-44f1-80fa-e95dc93275a5';

WITH calc AS (
  SELECT
    COALESCE((SELECT opening_balance FROM customers WHERE id='1b2f3082-52c0-44ac-bac0-613f2a753f59'),0)
    + COALESCE((SELECT SUM(total) FROM sales_invoices WHERE customer_id='1b2f3082-52c0-44ac-bac0-613f2a753f59' AND status='posted'),0)
    - COALESCE((SELECT SUM(total) FROM sales_returns WHERE customer_id='1b2f3082-52c0-44ac-bac0-613f2a753f59' AND status='posted'),0)
    - COALESCE((SELECT SUM(amount) FROM customer_payments WHERE customer_id='1b2f3082-52c0-44ac-bac0-613f2a753f59' AND status='posted'),0) AS bal
)
UPDATE public.customers SET balance = ROUND((SELECT bal FROM calc)::numeric, 2)
WHERE id='1b2f3082-52c0-44ac-bac0-613f2a753f59';