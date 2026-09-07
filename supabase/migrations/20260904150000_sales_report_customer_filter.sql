CREATE OR REPLACE FUNCTION public.get_sales_report_summary_filtered(
  p_date_from date,
  p_date_to date,
  p_previous_from date,
  p_previous_to date,
  p_customer_filter text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH current_invoices AS (
    SELECT id, total, tax
    FROM public.sales_invoices
    WHERE status = 'posted'
      AND invoice_date BETWEEN p_date_from AND p_date_to
      AND (
        p_customer_filter IS NULL
        OR (p_customer_filter = '__cash__' AND customer_id IS NULL)
        OR customer_id::text = p_customer_filter
      )
  ),
  current_returns AS (
    SELECT id, total, tax
    FROM public.sales_returns
    WHERE status = 'posted'
      AND return_date BETWEEN p_date_from AND p_date_to
      AND (
        p_customer_filter IS NULL
        OR (p_customer_filter = '__cash__' AND customer_id IS NULL)
        OR customer_id::text = p_customer_filter
      )
  ),
  current_invoice_totals AS (
    SELECT
      COUNT(*)::integer AS invoice_count,
      ROUND(COALESCE(SUM(total), 0), 2) AS invoice_total_including_tax,
      ROUND(COALESCE(SUM(ROUND(COALESCE(total, 0) - COALESCE(tax, 0), 2)), 0), 2)
        AS sales_revenue_excluding_tax
    FROM current_invoices
  ),
  current_return_totals AS (
    SELECT
      COUNT(*)::integer AS return_count,
      ROUND(COALESCE(SUM(total), 0), 2) AS return_total_including_tax,
      ROUND(COALESCE(SUM(ROUND(COALESCE(total, 0) - COALESCE(tax, 0), 2)), 0), 2)
        AS return_revenue_excluding_tax
    FROM current_returns
  ),
  current_cost_movements AS (
    SELECT movement.movement_type, movement.total_cost
    FROM public.inventory_movements movement
    JOIN current_invoices invoice
      ON movement.reference_type = 'sales_invoice'
      AND movement.reference_id = invoice.id
    WHERE movement.movement_type = 'sale'

    UNION ALL

    SELECT movement.movement_type, movement.total_cost
    FROM public.inventory_movements movement
    JOIN current_returns sales_return
      ON movement.reference_type = 'sales_return'
      AND movement.reference_id = sales_return.id
    WHERE movement.movement_type = 'sale_return'
  ),
  current_cost_totals AS (
    SELECT
      ROUND(COALESCE(SUM(total_cost) FILTER (WHERE movement_type = 'sale'), 0), 2)
        AS sales_cogs,
      ROUND(COALESCE(SUM(total_cost) FILTER (WHERE movement_type = 'sale_return'), 0), 2)
        AS return_cogs
    FROM current_cost_movements
  ),
  current_cash AS (
    SELECT ROUND(COALESCE(SUM(allocation.allocated_amount), 0), 2) AS cash_collected
    FROM public.customer_payment_allocations allocation
    JOIN public.customer_payments payment ON payment.id = allocation.payment_id
    JOIN current_invoices invoice ON invoice.id = allocation.invoice_id
    WHERE payment.status = 'posted'
  ),
  current_return_settlements AS (
    SELECT ROUND(COALESCE(SUM(settlement.settled_amount), 0), 2) AS return_settled
    FROM public.sales_invoice_return_settlements settlement
    JOIN current_invoices invoice ON invoice.id = settlement.invoice_id
    JOIN public.sales_returns sales_return ON sales_return.id = settlement.return_id
    WHERE sales_return.status = 'posted'
  ),
  current_base AS (
    SELECT
      invoice.invoice_count,
      returns.return_count,
      invoice.invoice_total_including_tax,
      returns.return_total_including_tax,
      invoice.sales_revenue_excluding_tax,
      returns.return_revenue_excluding_tax,
      ROUND(invoice.sales_revenue_excluding_tax - returns.return_revenue_excluding_tax, 2)
        AS net_sales_revenue,
      costs.sales_cogs,
      costs.return_cogs,
      ROUND(costs.sales_cogs - costs.return_cogs, 2) AS net_cogs,
      cash.cash_collected,
      settlements.return_settled
    FROM current_invoice_totals invoice
    CROSS JOIN current_return_totals returns
    CROSS JOIN current_cost_totals costs
    CROSS JOIN current_cash cash
    CROSS JOIN current_return_settlements settlements
  ),
  current_metrics AS (
    SELECT
      *,
      ROUND(net_sales_revenue - net_cogs, 2) AS gross_profit,
      ROUND(cash_collected + return_settled, 2) AS total_covered
    FROM current_base
  ),
  previous_invoice_totals AS (
    SELECT
      COUNT(*)::integer AS invoice_count,
      ROUND(COALESCE(SUM(ROUND(COALESCE(total, 0) - COALESCE(tax, 0), 2)), 0), 2)
        AS sales_revenue_excluding_tax
    FROM public.sales_invoices
    WHERE status = 'posted'
      AND invoice_date BETWEEN p_previous_from AND p_previous_to
      AND (
        p_customer_filter IS NULL
        OR (p_customer_filter = '__cash__' AND customer_id IS NULL)
        OR customer_id::text = p_customer_filter
      )
  ),
  previous_return_totals AS (
    SELECT ROUND(
      COALESCE(SUM(ROUND(COALESCE(total, 0) - COALESCE(tax, 0), 2)), 0),
      2
    ) AS return_revenue_excluding_tax
    FROM public.sales_returns
    WHERE status = 'posted'
      AND return_date BETWEEN p_previous_from AND p_previous_to
      AND (
        p_customer_filter IS NULL
        OR (p_customer_filter = '__cash__' AND customer_id IS NULL)
        OR customer_id::text = p_customer_filter
      )
  )
  SELECT jsonb_build_object(
    'current', jsonb_build_object(
      'invoice_count', current.invoice_count,
      'return_count', current.return_count,
      'invoice_total_including_tax', current.invoice_total_including_tax,
      'return_total_including_tax', current.return_total_including_tax,
      'sales_revenue_excluding_tax', current.sales_revenue_excluding_tax,
      'return_revenue_excluding_tax', current.return_revenue_excluding_tax,
      'net_sales_revenue', current.net_sales_revenue,
      'sales_cogs', current.sales_cogs,
      'return_cogs', current.return_cogs,
      'net_cogs', current.net_cogs,
      'gross_profit', current.gross_profit,
      'gross_margin_percent', CASE
        WHEN current.net_sales_revenue > 0 AND current.net_cogs > 0
          THEN ROUND((current.gross_profit / current.net_sales_revenue) * 100, 2)
        ELSE NULL
      END,
      'invoice_gross_total', current.invoice_total_including_tax,
      'cash_collected', current.cash_collected,
      'return_settled', current.return_settled,
      'total_covered', current.total_covered,
      'cash_collection_rate', CASE
        WHEN current.invoice_total_including_tax > 0
          THEN ROUND((current.cash_collected / current.invoice_total_including_tax) * 100, 2)
        ELSE NULL
      END
    ),
    'previous', jsonb_build_object(
      'invoice_count', previous_invoice.invoice_count,
      'gross_sales', previous_invoice.sales_revenue_excluding_tax,
      'returns_total', previous_return.return_revenue_excluding_tax,
      'net_sales', ROUND(
        previous_invoice.sales_revenue_excluding_tax
          - previous_return.return_revenue_excluding_tax,
        2
      )
    )
  )
  FROM current_metrics current
  CROSS JOIN previous_invoice_totals previous_invoice
  CROSS JOIN previous_return_totals previous_return
$$;

REVOKE ALL ON FUNCTION public.get_sales_report_summary_filtered(date, date, date, date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_report_summary_filtered(date, date, date, date, text)
  TO authenticated, service_role;
