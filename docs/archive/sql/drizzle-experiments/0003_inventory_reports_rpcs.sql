-- ── إعدادات المخزون (قابلة للضبط بدل الحدود المدفونة في الكود) ──────────────
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS inventory_lead_time_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS inventory_target_cover_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS inventory_slow_days integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS inventory_dead_days integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS inventory_new_days integer NOT NULL DEFAULT 30;

-- ── دالة مساعدة: تجميع الحركات لكل منتج حتى تاريخ ───────────────────────────
CREATE OR REPLACE FUNCTION public.inventory_product_state(p_as_of date)
RETURNS TABLE (
  product_id uuid,
  quantity numeric,
  moves_value numeric,
  wac numeric,
  purchased_qty numeric,
  purchased_cost numeric,
  sold_qty numeric,
  sold_cost numeric,
  last_sale_date date,
  last_receipt_date date,
  first_movement_date date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  FROM public.inventory_movements m
  WHERE m.movement_date <= COALESCE(p_as_of, current_date)
  GROUP BY m.product_id;
$$;

-- ── 1) تقرير تقييم المخزون (مربوط بحساب 1104) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_inventory_valuation(p_as_of date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of date := COALESCE(p_as_of, current_date);
  v_gl numeric;
  v_rows jsonb;
BEGIN
  SELECT COALESCE(SUM(l.debit - l.credit), 0)
    INTO v_gl
  FROM public.journal_entry_lines l
  JOIN public.journal_entries e ON e.id = l.journal_entry_id
  JOIN public.accounts a ON a.id = l.account_id
  WHERE a.code = '1104'
    AND e.status = 'posted'
    AND e.entry_date <= v_as_of;

  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'value')::numeric DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT to_jsonb(x) AS r
    FROM (
      SELECT
        p.id AS product_id,
        p.code,
        p.name,
        p.model_number,
        b.name AS brand_name,
        c.name AS category_name,
        p.is_active,
        COALESCE(s.quantity, 0) AS quantity,
        COALESCE(s.wac, p.purchase_price, 0) AS unit_cost,
        round(COALESCE(s.quantity, 0) * COALESCE(s.wac, p.purchase_price, 0), 2) AS value,
        COALESCE(s.moves_value, 0) AS moves_value
      FROM public.products p
      LEFT JOIN public.inventory_product_state(v_as_of) s ON s.product_id = p.id
      LEFT JOIN public.product_brands b ON b.id = p.brand_id
      LEFT JOIN public.product_categories c ON c.id = p.category_id
      WHERE COALESCE(s.quantity, 0) <> 0 OR COALESCE(s.moves_value, 0) <> 0
    ) x
  ) y;

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'gl_balance', round(v_gl, 2),
    'total_value', (SELECT round(COALESCE(SUM((r->>'value')::numeric), 0), 2) FROM jsonb_array_elements(v_rows) r),
    'total_moves_value', (SELECT round(COALESCE(SUM((r->>'moves_value')::numeric), 0), 2) FROM jsonb_array_elements(v_rows) r),
    'total_quantity', (SELECT round(COALESCE(SUM((r->>'quantity')::numeric), 0), 2) FROM jsonb_array_elements(v_rows) r),
    'rows', v_rows
  );
END;
$$;

-- ── 2) تعمير المخزون والأصناف الراكدة ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_inventory_aging(
  p_as_of date DEFAULT NULL,
  p_slow_days integer DEFAULT NULL,
  p_dead_days integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of date := COALESCE(p_as_of, current_date);
  v_slow integer;
  v_dead integer;
  v_rows jsonb;
BEGIN
  SELECT COALESCE(p_slow_days, inventory_slow_days, 60),
         COALESCE(p_dead_days, inventory_dead_days, 180)
    INTO v_slow, v_dead
  FROM public.company_settings
  LIMIT 1;

  v_slow := COALESCE(v_slow, COALESCE(p_slow_days, 60));
  v_dead := COALESCE(v_dead, COALESCE(p_dead_days, 180));

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.value DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      p.id AS product_id,
      p.code,
      p.name,
      b.name AS brand_name,
      c.name AS category_name,
      s.quantity,
      COALESCE(s.wac, p.purchase_price, 0) AS unit_cost,
      round(s.quantity * COALESCE(s.wac, p.purchase_price, 0), 2) AS value,
      s.last_receipt_date,
      s.last_sale_date,
      (v_as_of - s.last_receipt_date) AS age_days,
      CASE WHEN s.last_sale_date IS NULL THEN NULL ELSE (v_as_of - s.last_sale_date) END AS days_since_sale,
      CASE
        WHEN (v_as_of - s.last_receipt_date) <= 30 THEN '0-30'
        WHEN (v_as_of - s.last_receipt_date) <= 60 THEN '31-60'
        WHEN (v_as_of - s.last_receipt_date) <= 90 THEN '61-90'
        WHEN (v_as_of - s.last_receipt_date) <= 180 THEN '91-180'
        ELSE '180+'
      END AS bucket,
      CASE
        WHEN COALESCE(v_as_of - s.last_sale_date, v_as_of - s.first_movement_date) >= v_dead THEN 'dead'
        WHEN COALESCE(v_as_of - s.last_sale_date, v_as_of - s.first_movement_date) >= v_slow THEN 'slow'
        ELSE 'moving'
      END AS status,
      p.selling_price,
      round(p.selling_price - COALESCE(s.wac, p.purchase_price, 0), 2) AS nrv_margin
    FROM public.inventory_product_state(v_as_of) s
    JOIN public.products p ON p.id = s.product_id
    LEFT JOIN public.product_brands b ON b.id = p.brand_id
    LEFT JOIN public.product_categories c ON c.id = p.category_id
    WHERE s.quantity > 0
  ) x;

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'slow_days', v_slow,
    'dead_days', v_dead,
    'rows', v_rows
  );
END;
$$;

-- ── 3) حالة المخزون واستثناءات إعادة الطلب ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_inventory_reorder(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_lead_time_days integer DEFAULT NULL,
  p_target_days integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_to date := COALESCE(p_date_to, current_date);
  v_from date := COALESCE(p_date_from, v_to - 90);
  v_days integer := GREATEST((v_to - v_from) + 1, 1);
  v_lead integer;
  v_target integer;
  v_rows jsonb;
BEGIN
  SELECT COALESCE(p_lead_time_days, inventory_lead_time_days, 7),
         COALESCE(p_target_days, inventory_target_cover_days, 30)
    INTO v_lead, v_target
  FROM public.company_settings
  LIMIT 1;

  v_lead := COALESCE(v_lead, COALESCE(p_lead_time_days, 7));
  v_target := COALESCE(v_target, COALESCE(p_target_days, 30));

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.shortage_cost DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      p.id AS product_id,
      p.code,
      p.name,
      b.name AS brand_name,
      c.name AS category_name,
      COALESCE(s.quantity, 0) AS quantity,
      p.min_stock_level AS safety_stock,
      COALESCE(s.wac, p.purchase_price, 0) AS unit_cost,
      round(COALESCE(period.net_sold, 0) / v_days::numeric, 3) AS avg_daily_sales,
      COALESCE(period.net_sold, 0) AS period_sold,
      v_lead AS lead_time_days,
      v_target AS target_cover_days,
      round(
        (COALESCE(period.net_sold, 0) / v_days::numeric) * v_lead + COALESCE(p.min_stock_level, 0)
      , 2) AS reorder_point,
      CASE
        WHEN COALESCE(period.net_sold, 0) > 0
        THEN round(COALESCE(s.quantity, 0) / (COALESCE(period.net_sold, 0) / v_days::numeric), 1)
        ELSE NULL
      END AS days_of_cover,
      GREATEST(
        ceil(
          (COALESCE(period.net_sold, 0) / v_days::numeric) * v_target
          + COALESCE(p.min_stock_level, 0)
          - COALESCE(s.quantity, 0)
        ), 0
      ) AS suggested_qty,
      round(
        GREATEST(
          ceil(
            (COALESCE(period.net_sold, 0) / v_days::numeric) * v_target
            + COALESCE(p.min_stock_level, 0)
            - COALESCE(s.quantity, 0)
          ), 0
        ) * COALESCE(s.wac, p.purchase_price, 0)
      , 2) AS shortage_cost
    FROM public.products p
    LEFT JOIN public.inventory_product_state(v_to) s ON s.product_id = p.id
    LEFT JOIN public.product_brands b ON b.id = p.brand_id
    LEFT JOIN public.product_categories c ON c.id = p.category_id
    LEFT JOIN (
      SELECT m.product_id,
             SUM(CASE WHEN m.movement_type = 'sale' THEN abs(m.quantity)
                      WHEN m.movement_type = 'sale_return' THEN -abs(m.quantity)
                      ELSE 0 END) AS net_sold
      FROM public.inventory_movements m
      WHERE m.movement_date BETWEEN v_from AND v_to
        AND m.movement_type IN ('sale', 'sale_return')
      GROUP BY m.product_id
    ) period ON period.product_id = p.id
    WHERE p.is_active
      AND (
        COALESCE(s.quantity, 0) <=
          (COALESCE(period.net_sold, 0) / v_days::numeric) * v_lead + COALESCE(p.min_stock_level, 0)
      )
      AND (COALESCE(period.net_sold, 0) > 0 OR COALESCE(p.min_stock_level, 0) > 0)
  ) x;

  RETURN jsonb_build_object(
    'date_from', v_from,
    'date_to', v_to,
    'period_days', v_days,
    'lead_time_days', v_lead,
    'target_cover_days', v_target,
    'rows', v_rows
  );
END;
$$;

-- ── 4) مؤشرات أداء المخزون + تصنيف ABC ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_inventory_kpis(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  FROM public.inventory_movements
  WHERE movement_date BETWEEN v_from AND v_to;

  SELECT COALESCE(SUM(i.net_total), 0) INTO v_revenue
  FROM public.sales_invoice_items i
  JOIN public.sales_invoices inv ON inv.id = i.invoice_id
  WHERE inv.status = 'posted' AND inv.invoice_date BETWEEN v_from AND v_to;

  v_avg := round((v_open + v_close) / 2, 2);
  v_turnover := CASE WHEN v_avg > 0 THEN round(v_cogs / v_avg, 2) ELSE NULL END;

  -- تصنيف ABC بباريتو على قيمة المبيعات خلال الفترة
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
          c.name AS category_name,
          COALESCE(sold.revenue, 0) AS revenue,
          COALESCE(sold.qty, 0) AS sold_qty,
          COALESCE(mv.cogs, 0) AS cogs,
          round(COALESCE(sold.revenue, 0) - COALESCE(mv.cogs, 0), 2) AS gross_profit,
          COALESCE(st.quantity, 0) AS quantity,
          round(COALESCE(st.quantity, 0) * COALESCE(st.wac, p.purchase_price, 0), 2) AS stock_value
        FROM public.products p
        LEFT JOIN public.product_categories c ON c.id = p.category_id
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
          FROM public.inventory_movements m
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
$$;

REVOKE ALL ON FUNCTION public.inventory_product_state(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_inventory_valuation(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_inventory_aging(date, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_inventory_reorder(date, date, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_inventory_kpis(date, date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.inventory_product_state(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_inventory_valuation(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_inventory_aging(date, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_inventory_reorder(date, date, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_inventory_kpis(date, date) TO authenticated, service_role;