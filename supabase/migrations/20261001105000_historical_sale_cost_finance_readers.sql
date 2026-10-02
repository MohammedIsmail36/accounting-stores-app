BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$ BEGIN
  IF to_regclass('public.inventory_movements_effective_cost') IS NULL
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.inventory_product_state_finance_internal(date)'::regprocedure)
        IS DISTINCT FROM '4972c5a12581accba356758813121eca'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_inventory_kpis_finance_internal(date,date)'::regprocedure)
        IS DISTINCT FROM '8cec13b05c9a65a426a6e95e6d129289'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_sales_report_summary_finance_internal(date,date,date,date)'::regprocedure)
        IS DISTINCT FROM '1968a0e0c8535ff496f317248f8b587e'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_sales_report_summary_filtered_finance_internal(date,date,date,date,text)'::regprocedure)
        IS DISTINCT FROM 'dc276ea39a50c64e4afd0802fafbcaf6'
  THEN RAISE EXCEPTION 'HISTORICAL_SALE_COST_FINANCE_READER_DEFINITION_CHANGED'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.inventory_product_state_finance_internal(p_as_of date)
 RETURNS TABLE(product_id uuid, quantity numeric, moves_value numeric, wac numeric, purchased_qty numeric, purchased_cost numeric, sold_qty numeric, sold_cost numeric, last_sale_date date, last_receipt_date date, first_movement_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    m.product_id,
    round(SUM(public.inventory_signed_quantity(m.movement_type::text, m.quantity)), 2),
    round(SUM(
      CASE
        WHEN m.movement_type = 'adjustment'
          THEN sign(COALESCE(m.quantity, 0)) * abs(COALESCE(m.total_cost, 0))
        WHEN m.movement_type IN ('sale', 'purchase_return')
          THEN -abs(COALESCE(m.total_cost, 0))
        ELSE abs(COALESCE(m.total_cost, 0))
      END
    ), 2),
    CASE
      WHEN SUM(CASE WHEN m.movement_type IN ('purchase', 'opening_balance')
                    THEN abs(COALESCE(m.quantity, 0)) ELSE 0 END) > 0
      THEN round(
        SUM(CASE WHEN m.movement_type IN ('purchase', 'opening_balance')
                 THEN abs(COALESCE(m.total_cost, 0)) ELSE 0 END)
        / SUM(CASE WHEN m.movement_type IN ('purchase', 'opening_balance')
                   THEN abs(COALESCE(m.quantity, 0)) ELSE 0 END), 2)
      ELSE NULL
    END,
    round(SUM(CASE WHEN m.movement_type IN ('purchase', 'opening_balance')
                   THEN abs(COALESCE(m.quantity, 0)) ELSE 0 END), 2),
    round(SUM(CASE WHEN m.movement_type IN ('purchase', 'opening_balance')
                   THEN abs(COALESCE(m.total_cost, 0)) ELSE 0 END), 2),
    round(SUM(CASE WHEN m.movement_type = 'sale' THEN abs(COALESCE(m.quantity, 0))
                   WHEN m.movement_type = 'sale_return' THEN -abs(COALESCE(m.quantity, 0))
                   ELSE 0 END), 2),
    round(SUM(CASE WHEN m.movement_type = 'sale' THEN abs(COALESCE(m.total_cost, 0))
                   WHEN m.movement_type = 'sale_return' THEN -abs(COALESCE(m.total_cost, 0))
                   ELSE 0 END), 2),
    MAX(CASE WHEN m.movement_type = 'sale' THEN m.movement_date END),
    MAX(CASE WHEN m.movement_type IN ('purchase', 'opening_balance') THEN m.movement_date END),
    MIN(m.movement_date)
  FROM public.inventory_movements_effective_cost m
  WHERE m.movement_date <= COALESCE(p_as_of, current_date)
  GROUP BY m.product_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_inventory_kpis_finance_internal(p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_to date := COALESCE(p_date_to, current_date);
  v_from date := COALESCE(p_date_from, date_trunc('year', v_to)::date);
  v_days integer := GREATEST((v_to - v_from) + 1, 1);
  v_open numeric;
  v_close numeric;
  v_cogs numeric;
  v_purchases numeric;
  v_revenue numeric;
  v_avg numeric;
  v_turnover numeric;
  v_rows jsonb;
BEGIN
  SELECT COALESCE(SUM(quantity * COALESCE(wac, 0)), 0) INTO v_open
  FROM public.inventory_product_state(v_from - 1);

  SELECT COALESCE(SUM(quantity * COALESCE(wac, 0)), 0) INTO v_close
  FROM public.inventory_product_state(v_to);

  SELECT
    COALESCE(SUM(CASE WHEN movement_type = 'sale' THEN abs(total_cost)
                      WHEN movement_type = 'sale_return' THEN -abs(total_cost) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type IN ('purchase', 'opening_balance') THEN abs(total_cost)
                      WHEN movement_type = 'purchase_return' THEN -abs(total_cost) ELSE 0 END), 0)
    INTO v_cogs, v_purchases
  FROM public.inventory_movements_effective_cost
  WHERE movement_date BETWEEN v_from AND v_to;

  SELECT COALESCE(SUM(i.net_total), 0) INTO v_revenue
  FROM public.sales_invoice_items i
  JOIN public.sales_invoices inv ON inv.id = i.invoice_id
  WHERE inv.status = 'posted' AND inv.invoice_date BETWEEN v_from AND v_to;

  v_avg := round((v_open + v_close) / 2, 2);
  v_turnover := CASE WHEN v_avg > 0 THEN round(v_cogs / v_avg, 2) ELSE NULL END;

  SELECT COALESCE(jsonb_agg(to_jsonb(z) ORDER BY z.revenue DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      y.*,
      CASE
        WHEN y.total_revenue <= 0 THEN 'C'
        WHEN y.cumulative_share <= 0.80 THEN 'A'
        WHEN y.cumulative_share <= 0.95 THEN 'B'
        ELSE 'C'
      END AS abc_class
    FROM (
      SELECT
        x.*,
        SUM(x.revenue) OVER (ORDER BY x.revenue DESC ROWS UNBOUNDED PRECEDING)
          / NULLIF(SUM(x.revenue) OVER (), 0) AS cumulative_share,
        SUM(x.revenue) OVER () AS total_revenue
      FROM (
        SELECT
          p.id AS product_id,
          p.code,
          p.name,
          p.model_number,
          b.name AS brand_name,
          c.name AS category_name,
          COALESCE(sold.revenue, 0) AS revenue,
          COALESCE(sold.qty, 0) AS sold_qty,
          COALESCE(mv.cogs, 0) AS cogs,
          round(COALESCE(sold.revenue, 0) - COALESCE(mv.cogs, 0), 2) AS gross_profit,
          COALESCE(st.quantity, 0) AS quantity,
          round(COALESCE(st.quantity, 0) * COALESCE(st.wac, p.purchase_price, 0), 2) AS stock_value
        FROM public.products p
        LEFT JOIN public.product_categories c ON c.id = p.category_id
        LEFT JOIN public.product_brands b ON b.id = p.brand_id
        LEFT JOIN public.inventory_product_state(v_to) st ON st.product_id = p.id
        LEFT JOIN (
          SELECT i.product_id,
                 SUM(i.net_total) AS revenue,
                 SUM(i.quantity) AS qty
          FROM public.sales_invoice_items i
          JOIN public.sales_invoices inv ON inv.id = i.invoice_id
          WHERE inv.status = 'posted' AND inv.invoice_date BETWEEN v_from AND v_to
          GROUP BY i.product_id
        ) sold ON sold.product_id = p.id
        LEFT JOIN (
          SELECT m.product_id,
                 SUM(CASE WHEN m.movement_type = 'sale' THEN abs(m.total_cost)
                          WHEN m.movement_type = 'sale_return' THEN -abs(m.total_cost)
                          ELSE 0 END) AS cogs
          FROM public.inventory_movements_effective_cost m
          WHERE m.movement_date BETWEEN v_from AND v_to
            AND m.movement_type IN ('sale', 'sale_return')
          GROUP BY m.product_id
        ) mv ON mv.product_id = p.id
      ) x
    ) y
  ) z;

  RETURN jsonb_build_object(
    'date_from', v_from,
    'date_to', v_to,
    'period_days', v_days,
    'opening_value', round(v_open, 2),
    'closing_value', round(v_close, 2),
    'average_value', v_avg,
    'purchases_value', round(v_purchases, 2),
    'cogs', round(v_cogs, 2),
    'revenue', round(v_revenue, 2),
    'gross_profit', round(v_revenue - v_cogs, 2),
    'turnover', v_turnover,
    'dio', CASE WHEN v_turnover > 0 THEN round(365 / v_turnover, 1) ELSE NULL END,
    'gmroi', CASE WHEN v_avg > 0 THEN round((v_revenue - v_cogs) / v_avg, 2) ELSE NULL END,
    'rows', v_rows
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_sales_report_summary_finance_internal(
  p_date_from date,
  p_date_to date,
  p_previous_from date,
  p_previous_to date
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
    FROM public.sales_returns
    WHERE status = 'posted'
      AND return_date BETWEEN p_date_from AND p_date_to
  ),
  current_cost_totals AS (
    SELECT
      ROUND(COALESCE(SUM(total_cost) FILTER (WHERE movement_type = 'sale'), 0), 2)
        AS sales_cogs,
      ROUND(COALESCE(SUM(total_cost) FILTER (WHERE movement_type = 'sale_return'), 0), 2)
        AS return_cogs
    FROM public.inventory_movements_effective_cost
    WHERE movement_type IN ('sale', 'sale_return')
      AND movement_date BETWEEN p_date_from AND p_date_to
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
  ),
  previous_return_totals AS (
    SELECT ROUND(
      COALESCE(SUM(ROUND(COALESCE(total, 0) - COALESCE(tax, 0), 2)), 0),
      2
    ) AS return_revenue_excluding_tax
    FROM public.sales_returns
    WHERE status = 'posted'
      AND return_date BETWEEN p_previous_from AND p_previous_to
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
        WHEN current.net_sales_revenue > 0
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

CREATE OR REPLACE FUNCTION public.get_sales_report_summary_filtered_finance_internal(
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
    FROM public.inventory_movements_effective_cost movement
    JOIN current_invoices invoice
      ON movement.reference_type = 'sales_invoice'
      AND movement.reference_id = invoice.id
    WHERE movement.movement_type = 'sale'

    UNION ALL

    SELECT movement.movement_type, movement.total_cost
    FROM public.inventory_movements_effective_cost movement
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
COMMIT;
