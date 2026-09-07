-- Move cost-sensitive sales document operations behind atomic, role-checked
-- database functions. This is a prerequisite for restricting direct access to
-- product and inventory cost columns without breaking the sales workflow.

-- The UI has historically recorded these two audit events, but the original
-- constraint predates them. Keeping the explicit types makes invoice loyalty
-- cancellation auditable instead of silently failing its ledger inserts.
ALTER TABLE public.loyalty_transactions
  DROP CONSTRAINT IF EXISTS loyalty_transactions_type_check;

ALTER TABLE public.loyalty_transactions
  ADD CONSTRAINT loyalty_transactions_type_check CHECK (
    type IN (
      'earn',
      'redeem',
      'reversal',
      'redeem_reversal',
      'manual_adjust',
      'cancel_earn',
      'cancel_redeem'
    )
  );

CREATE OR REPLACE FUNCTION public.recalculate_customer_balance_internal(
  p_customer_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance numeric := 0;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN 0;
  END IF;

  WITH invoice_total AS (
    SELECT COALESCE(SUM(total), 0) AS amount
    FROM public.sales_invoices
    WHERE customer_id = p_customer_id AND status = 'posted'
  ),
  return_total AS (
    SELECT COALESCE(SUM(total), 0) AS amount
    FROM public.sales_returns
    WHERE customer_id = p_customer_id AND status = 'posted'
  ),
  return_allocations AS (
    SELECT payment_id, SUM(allocated_amount) AS amount
    FROM public.sales_return_payment_allocations
    GROUP BY payment_id
  ),
  payment_total AS (
    SELECT
      COALESCE(SUM(
        payment.amount
          - LEAST(payment.amount, GREATEST(0, COALESCE(allocation.amount, 0)))
      ), 0) AS normal_amount,
      COALESCE(SUM(
        LEAST(payment.amount, GREATEST(0, COALESCE(allocation.amount, 0)))
      ), 0) AS refund_amount
    FROM public.customer_payments payment
    LEFT JOIN return_allocations allocation ON allocation.payment_id = payment.id
    WHERE payment.customer_id = p_customer_id AND payment.status = 'posted'
  )
  SELECT ROUND(
    COALESCE(customer.opening_balance, 0)
      + invoice_total.amount
      - return_total.amount
      - payment_total.normal_amount
      + payment_total.refund_amount,
    2
  )
  INTO v_balance
  FROM public.customers customer
  CROSS JOIN invoice_total
  CROSS JOIN return_total
  CROSS JOIN payment_total
  WHERE customer.id = p_customer_id;

  UPDATE public.customers
  SET balance = COALESCE(v_balance, 0)
  WHERE id = p_customer_id;

  RETURN COALESCE(v_balance, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_customer_balance_internal(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.recalculate_customer_loyalty_internal(
  p_customer_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_points integer := 0;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT GREATEST(COALESCE(SUM(points), 0), 0)::integer
  INTO v_points
  FROM public.loyalty_transactions
  WHERE customer_id = p_customer_id;

  UPDATE public.customers
  SET loyalty_points = v_points
  WHERE id = p_customer_id;

  RETURN v_points;
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_customer_loyalty_internal(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_document_reversal_internal(
  p_source_entry_id uuid,
  p_entry_date date,
  p_description text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lines jsonb;
  v_posted_number integer;
  v_reversal_id uuid;
BEGIN
  IF p_source_entry_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.journal_entries
    WHERE id = p_source_entry_id AND status = 'posted'
  ) THEN
    RAISE EXCEPTION 'القيد الأصلي غير موجود أو غير مرحّل';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'account_id', line.account_id,
      'debit', COALESCE(line.credit, 0),
      'credit', COALESCE(line.debit, 0),
      'description', 'عكس - ' || COALESCE(line.description, p_description)
    )
    ORDER BY line.id
  )
  INTO v_lines
  FROM public.journal_entry_lines line
  WHERE line.journal_entry_id = p_source_entry_id;

  PERFORM public.fn_validate_journal_lines_json(v_lines);

  PERFORM pg_advisory_xact_lock(hashtext('journal_entries.posted_number'));
  SELECT COALESCE(MAX(posted_number), 0) + 1
  INTO v_posted_number
  FROM public.journal_entries
  WHERE posted_number IS NOT NULL;

  v_reversal_id := public.create_journal_entry(
    p_entry_date,
    p_description,
    v_lines,
    'posted',
    v_posted_number,
    'reversal'
  );

  RETURN v_reversal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_document_reversal_internal(uuid, date, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Existing invoice posting is already a single PostgreSQL transaction, but it
-- ran with the caller's table privileges and recalculated the customer balance
-- later in the browser. Keep its proven accounting body private and wrap it in
-- one role-checked, locked server transaction.
ALTER FUNCTION public.post_sales_invoice(uuid)
  RENAME TO post_sales_invoice_atomic_internal;

REVOKE ALL ON FUNCTION public.post_sales_invoice_atomic_internal(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.post_sales_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id uuid;
  v_product_id uuid;
  v_result jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT (
       public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'accountant'::public.app_role)
       OR public.has_role(auth.uid(), 'sales'::public.app_role)
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'غير مصرح بتنفيذ عملية البيع');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('sales_invoices.posted_number'));
  SELECT customer_id
  INTO v_customer_id
  FROM public.sales_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  -- Lock all affected products in a deterministic order before the internal
  -- availability checks. This prevents two concurrent invoices from both
  -- accepting the same stock balance.
  FOR v_product_id IN
    SELECT DISTINCT item.product_id
    FROM public.sales_invoice_items item
    WHERE item.invoice_id = p_invoice_id AND item.product_id IS NOT NULL
    ORDER BY item.product_id
  LOOP
    PERFORM 1
    FROM public.products
    WHERE id = v_product_id
    FOR UPDATE;
  END LOOP;

  PERFORM pg_advisory_xact_lock(hashtext('journal_entries.posted_number'));
  v_result := public.post_sales_invoice_atomic_internal(p_invoice_id);

  IF COALESCE((v_result->>'success')::boolean, false) THEN
    -- The legacy posting body falls back to products.purchase_price in the
    -- journal when no purchase history exists, but used zero in the stock
    -- movement. Align the movement to the exact same fallback so inventory
    -- cost and the general ledger cannot diverge.
    UPDATE public.inventory_movements movement
    SET unit_cost = CASE
          WHEN public.get_avg_purchase_price(movement.product_id) > 0
            THEN public.get_avg_purchase_price(movement.product_id)
          ELSE COALESCE(product.purchase_price, 0)
        END,
        total_cost = ROUND(
          (CASE
            WHEN public.get_avg_purchase_price(movement.product_id) > 0
              THEN public.get_avg_purchase_price(movement.product_id)
            ELSE COALESCE(product.purchase_price, 0)
          END) * movement.quantity,
          2
        )
    FROM public.products product
    WHERE movement.product_id = product.id
      AND movement.reference_id = p_invoice_id
      AND movement.reference_type = 'sales_invoice';

    IF v_customer_id IS NOT NULL THEN
      PERFORM public.recalculate_customer_balance_internal(v_customer_id);
      PERFORM public.recalculate_customer_loyalty_internal(v_customer_id);
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.post_sales_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_sales_invoice(uuid) TO authenticated, service_role;

-- Make reset-to-draft include the customer balance update in the same RPC.
ALTER FUNCTION public.unpost_sales_invoice(uuid)
  RENAME TO unpost_sales_invoice_atomic_internal;

REVOKE ALL ON FUNCTION public.unpost_sales_invoice_atomic_internal(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.unpost_sales_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id uuid;
  v_product_id uuid;
  v_result jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'هذه العملية متاحة للمدير فقط');
  END IF;

  SELECT customer_id
  INTO v_customer_id
  FROM public.sales_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF EXISTS (
       SELECT 1
       FROM public.sales_invoices
       WHERE id = p_invoice_id AND status = 'posted'
     )
     AND EXISTS (
    WITH item_totals AS (
      SELECT product_id, SUM(quantity) AS quantity
      FROM public.sales_invoice_items
      WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL
      GROUP BY product_id
    ),
    movement_totals AS (
      SELECT product_id, SUM(quantity) AS quantity
      FROM public.inventory_movements
      WHERE reference_id = p_invoice_id AND reference_type = 'sales_invoice'
      GROUP BY product_id
    )
    SELECT 1
    FROM item_totals item
    FULL JOIN movement_totals movement USING (product_id)
    WHERE COALESCE(item.quantity, 0) <> COALESCE(movement.quantity, 0)
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'لا يمكن إعادة التعيين لأن حركات مخزون الفاتورة ناقصة أو غير متطابقة؛ راجع سلامة المستند أولاً'
    );
  END IF;

  FOR v_product_id IN
    SELECT DISTINCT movement.product_id
    FROM public.inventory_movements movement
    WHERE movement.reference_id = p_invoice_id
      AND movement.reference_type = 'sales_invoice'
    ORDER BY movement.product_id
  LOOP
    PERFORM 1
    FROM public.products
    WHERE id = v_product_id
    FOR UPDATE;
  END LOOP;

  v_result := public.unpost_sales_invoice_atomic_internal(p_invoice_id);

  IF COALESCE((v_result->>'success')::boolean, false) AND v_customer_id IS NOT NULL THEN
    PERFORM public.recalculate_customer_balance_internal(v_customer_id);
    PERFORM public.recalculate_customer_loyalty_internal(v_customer_id);
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.unpost_sales_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unpost_sales_invoice(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.post_sales_return(p_return_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_return public.sales_returns%ROWTYPE;
  v_settings record;
  v_item record;
  v_product record;
  v_item_count integer;
  v_sold numeric;
  v_returned numeric;
  v_avg_cost numeric;
  v_effective_cost numeric;
  v_line_cost numeric;
  v_total_cost numeric := 0;
  v_costs jsonb := '{}'::jsonb;
  v_customers_account uuid;
  v_revenue_account uuid;
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_tax_account uuid;
  v_tax numeric;
  v_net_revenue numeric;
  v_posted_number integer;
  v_journal_number integer;
  v_journal_id uuid;
  v_prefix text;
  v_label text;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT (
       public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'accountant'::public.app_role)
       OR public.has_role(auth.uid(), 'sales'::public.app_role)
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'غير مصرح بترحيل مرتجع البيع');
  END IF;

  SELECT *
  INTO v_return
  FROM public.sales_returns
  WHERE id = p_return_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'مرتجع البيع غير موجود');
  END IF;
  IF v_return.status <> 'draft' THEN
    RETURN jsonb_build_object('success', false, 'error', 'يمكن ترحيل مرتجعات المسودة فقط');
  END IF;

  SELECT COUNT(*)
  INTO v_item_count
  FROM public.sales_return_items
  WHERE return_id = p_return_id AND product_id IS NOT NULL;

  IF v_item_count = 0 OR COALESCE(v_return.total, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'لا يمكن ترحيل مرتجع فارغ — أضف بنوداً وإجمالياً أكبر من صفر');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.sales_return_items
    WHERE return_id = p_return_id
      AND (product_id IS NULL OR COALESCE(quantity, 0) <= 0)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'كل بند في المرتجع يجب أن يحتوي منتجاً وكمية أكبر من صفر');
  END IF;

  SELECT
    locked_until_date,
    stock_enforcement_enabled,
    enable_tax,
    sales_tax_account_id,
    sales_return_prefix,
    enable_return_days_limit,
    return_days_limit
  INTO v_settings
  FROM public.company_settings
  LIMIT 1;

  IF v_settings.locked_until_date IS NOT NULL
     AND v_return.return_date <= v_settings.locked_until_date THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format(
        'لا يمكن ترحيل مرتجع بتاريخ %s — الفترة مقفلة حتى %s',
        v_return.return_date,
        v_settings.locked_until_date
      )
    );
  END IF;

  FOR v_item IN
    SELECT
      item.product_id,
      SUM(item.quantity) AS quantity,
      COALESCE(MAX(NULLIF(item.description, '')), MAX(product.name), 'المنتج') AS description
    FROM public.sales_return_items item
    JOIN public.products product ON product.id = item.product_id
    WHERE item.return_id = p_return_id
    GROUP BY item.product_id
    ORDER BY item.product_id
  LOOP
    SELECT id, purchase_price, quantity_on_hand
    INTO v_product
    FROM public.products
    WHERE id = v_item.product_id
    FOR UPDATE;

    IF COALESCE(v_settings.enable_return_days_limit, true) THEN
      SELECT COALESCE(SUM(invoice_item.quantity), 0)
      INTO v_sold
      FROM public.sales_invoice_items invoice_item
      JOIN public.sales_invoices invoice ON invoice.id = invoice_item.invoice_id
      WHERE invoice_item.product_id = v_item.product_id
        AND invoice.status = 'posted'
        AND invoice.invoice_date >= CURRENT_DATE - COALESCE(v_settings.return_days_limit, 30);

      SELECT COALESCE(SUM(return_item.quantity), 0)
      INTO v_returned
      FROM public.sales_return_items return_item
      JOIN public.sales_returns sales_return ON sales_return.id = return_item.return_id
      WHERE return_item.product_id = v_item.product_id
        AND return_item.return_id <> p_return_id
        AND sales_return.status = 'posted';

      IF v_item.quantity > v_sold - v_returned THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', format(
            'الكمية المرتجعة للصنف (%s) أكبر من الكمية المباعة خلال %s يوم السابقة. المتاح للإرجاع: %s',
            v_item.description,
            COALESCE(v_settings.return_days_limit, 30),
            v_sold - v_returned
          )
        );
      END IF;
    END IF;

    v_avg_cost := public.get_avg_purchase_price(v_item.product_id);
    v_effective_cost := CASE
      WHEN v_avg_cost > 0 THEN v_avg_cost
      ELSE COALESCE(v_product.purchase_price, 0)
    END;
    v_line_cost := ROUND(v_effective_cost * v_item.quantity, 2);
    v_total_cost := v_total_cost + v_line_cost;
    v_costs := v_costs || jsonb_build_object(v_item.product_id::text, v_effective_cost);
  END LOOP;

  SELECT id INTO v_customers_account FROM public.accounts WHERE code = '1103' LIMIT 1;
  SELECT id INTO v_revenue_account FROM public.accounts WHERE code = '4101' LIMIT 1;
  SELECT id INTO v_cogs_account FROM public.accounts WHERE code = '5101' LIMIT 1;
  SELECT id INTO v_inventory_account FROM public.accounts WHERE code = '1104' LIMIT 1;

  IF v_customers_account IS NULL OR v_revenue_account IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'تأكد من وجود حسابي العملاء وإيرادات المبيعات');
  END IF;
  IF v_total_cost > 0 AND (v_cogs_account IS NULL OR v_inventory_account IS NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'تأكد من وجود حسابي تكلفة البضاعة والمخزون');
  END IF;

  v_tax := ROUND(COALESCE(v_return.tax, 0), 2);
  v_net_revenue := ROUND(COALESCE(v_return.total, 0) - v_tax, 2);
  IF v_net_revenue < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'ضريبة المرتجع لا يمكن أن تتجاوز إجماليه');
  END IF;

  IF v_tax > 0 THEN
    IF v_settings.enable_tax IS NOT TRUE OR v_settings.sales_tax_account_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'الضريبة مطبقة على المرتجع ولكن إعداد حساب ضريبة المبيعات غير مكتمل');
    END IF;
    SELECT id INTO v_tax_account
    FROM public.accounts
    WHERE id = v_settings.sales_tax_account_id;
    IF v_tax_account IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'حساب ضريبة المبيعات المحدد غير موجود');
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('sales_returns.posted_number'));
  v_posted_number := v_return.posted_number;
  IF v_posted_number IS NULL THEN
    SELECT COALESCE(MAX(posted_number), 0) + 1
    INTO v_posted_number
    FROM public.sales_returns
    WHERE posted_number IS NOT NULL;
  END IF;

  v_prefix := COALESCE(NULLIF(v_settings.sales_return_prefix, ''), 'SRN-');
  v_label := v_prefix || LPAD(v_posted_number::text, 4, '0');

  IF v_net_revenue > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_revenue_account,
      'debit', v_net_revenue,
      'credit', 0,
      'description', 'مرتجع مبيعات - ' || v_label
    ));
  END IF;
  IF v_tax > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_tax_account,
      'debit', v_tax,
      'credit', 0,
      'description', 'عكس ضريبة مبيعات - ' || v_label
    ));
  END IF;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'account_id', v_customers_account,
    'debit', 0,
    'credit', ROUND(v_return.total, 2),
    'description', 'خصم ذمم عملاء - ' || v_label
  ));
  IF v_total_cost > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_inventory_account,
        'debit', ROUND(v_total_cost, 2),
        'credit', 0,
        'description', 'إرجاع مخزون - ' || v_label
      ),
      jsonb_build_object(
        'account_id', v_cogs_account,
        'debit', 0,
        'credit', ROUND(v_total_cost, 2),
        'description', 'عكس تكلفة بضاعة - ' || v_label
      )
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('journal_entries.posted_number'));
  SELECT COALESCE(MAX(posted_number), 0) + 1
  INTO v_journal_number
  FROM public.journal_entries
  WHERE posted_number IS NOT NULL;

  v_journal_id := public.create_journal_entry(
    v_return.return_date,
    'مرتجع بيع رقم ' || v_label,
    v_lines,
    'posted',
    v_journal_number,
    'regular'
  );

  UPDATE public.sales_returns
  SET status = 'posted',
      journal_entry_id = v_journal_id,
      posted_number = v_posted_number
  WHERE id = p_return_id;

  FOR v_item IN
    SELECT item.product_id, SUM(item.quantity) AS quantity
    FROM public.sales_return_items item
    WHERE item.return_id = p_return_id
    GROUP BY item.product_id
    ORDER BY item.product_id
  LOOP
    v_effective_cost := COALESCE((v_costs->>v_item.product_id::text)::numeric, 0);
    UPDATE public.products
    SET quantity_on_hand = quantity_on_hand + v_item.quantity
    WHERE id = v_item.product_id;

    INSERT INTO public.inventory_movements (
      product_id,
      movement_type,
      quantity,
      unit_cost,
      total_cost,
      reference_id,
      reference_type,
      movement_date
    ) VALUES (
      v_item.product_id,
      'sale_return',
      v_item.quantity,
      v_effective_cost,
      ROUND(v_effective_cost * v_item.quantity, 2),
      p_return_id,
      'sales_return',
      v_return.return_date
    );
  END LOOP;

  IF v_return.customer_id IS NOT NULL THEN
    PERFORM public.recalculate_customer_balance_internal(v_return.customer_id);
    PERFORM public.recalculate_customer_loyalty_internal(v_return.customer_id);
  END IF;

  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id)
  VALUES (
    'sales_returns',
    p_return_id::text,
    'post',
    jsonb_build_object('status', 'draft'),
    jsonb_build_object(
      'status', 'posted',
      'posted_number', v_posted_number,
      'journal_entry_id', v_journal_id
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'success', true,
    'posted_number', v_posted_number,
    'journal_entry_id', v_journal_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.post_sales_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_sales_return(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_sales_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice public.sales_invoices%ROWTYPE;
  v_movement record;
  v_prefix text;
  v_label text;
  v_reversal_id uuid;
  v_earned integer := 0;
  v_redeemed integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT (
       public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'accountant'::public.app_role)
       OR public.has_role(auth.uid(), 'sales'::public.app_role)
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'غير مصرح بإلغاء فاتورة البيع');
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.sales_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'فاتورة البيع غير موجودة');
  END IF;
  IF v_invoice.status <> 'posted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'يمكن إلغاء الفواتير المرحّلة فقط');
  END IF;

  IF EXISTS (
    WITH item_totals AS (
      SELECT product_id, SUM(quantity) AS quantity
      FROM public.sales_invoice_items
      WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL
      GROUP BY product_id
    ),
    movement_totals AS (
      SELECT product_id, SUM(quantity) AS quantity
      FROM public.inventory_movements
      WHERE reference_id = p_invoice_id AND reference_type = 'sales_invoice'
      GROUP BY product_id
    )
    SELECT 1
    FROM item_totals item
    FULL JOIN movement_totals movement USING (product_id)
    WHERE COALESCE(item.quantity, 0) <> COALESCE(movement.quantity, 0)
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'لا يمكن إلغاء الفاتورة لأن حركات مخزونها ناقصة أو غير متطابقة؛ راجع سلامة المستند أولاً'
    );
  END IF;

  IF COALESCE(v_invoice.paid_amount, 0) > 0
     OR EXISTS (SELECT 1 FROM public.customer_payment_allocations WHERE invoice_id = p_invoice_id)
     OR EXISTS (
       SELECT 1 FROM public.customer_payments
       WHERE sales_invoice_id = p_invoice_id AND status <> 'cancelled'
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'لا يمكن إلغاء الفاتورة قبل إلغاء سندات القبض والتخصيصات المرتبطة بها');
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.sales_returns
       WHERE sales_invoice_id = p_invoice_id AND status <> 'cancelled'
     )
     OR EXISTS (
       SELECT 1 FROM public.sales_invoice_return_settlements
       WHERE invoice_id = p_invoice_id
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'لا يمكن إلغاء الفاتورة قبل إلغاء المرتجعات وتسوياتها المرتبطة بها');
  END IF;

  SELECT COALESCE(NULLIF(sales_invoice_prefix, ''), 'INV-')
  INTO v_prefix
  FROM public.company_settings
  LIMIT 1;
  v_label := COALESCE(v_prefix, 'INV-') || LPAD(
    COALESCE(v_invoice.posted_number, v_invoice.invoice_number)::text,
    4,
    '0'
  );

  FOR v_movement IN
    SELECT product_id, SUM(quantity) AS quantity
    FROM public.inventory_movements
    WHERE reference_id = p_invoice_id AND reference_type = 'sales_invoice'
    GROUP BY product_id
    ORDER BY product_id
  LOOP
    PERFORM 1 FROM public.products WHERE id = v_movement.product_id FOR UPDATE;
  END LOOP;

  v_reversal_id := public.create_document_reversal_internal(
    v_invoice.journal_entry_id,
    CURRENT_DATE,
    'عكس فاتورة بيع رقم ' || v_label
  );

  FOR v_movement IN
    SELECT product_id, SUM(quantity) AS quantity
    FROM public.inventory_movements
    WHERE reference_id = p_invoice_id AND reference_type = 'sales_invoice'
    GROUP BY product_id
    ORDER BY product_id
  LOOP
    UPDATE public.products
    SET quantity_on_hand = quantity_on_hand + v_movement.quantity
    WHERE id = v_movement.product_id;
  END LOOP;

  DELETE FROM public.inventory_movements
  WHERE reference_id = p_invoice_id AND reference_type = 'sales_invoice';

  UPDATE public.sales_invoices
  SET status = 'cancelled'
  WHERE id = p_invoice_id;

  IF v_invoice.customer_id IS NOT NULL THEN
    SELECT
      COALESCE(SUM(points) FILTER (WHERE type = 'earn'), 0),
      ABS(COALESCE(SUM(points) FILTER (WHERE type = 'redeem'), 0))
    INTO v_earned, v_redeemed
    FROM public.loyalty_transactions
    WHERE reference_type = 'sales_invoice' AND reference_id = p_invoice_id;

    IF v_earned > 0 THEN
      INSERT INTO public.loyalty_transactions (
        customer_id, transaction_date, points, type,
        reference_type, reference_id, notes, created_by
      ) VALUES (
        v_invoice.customer_id, CURRENT_DATE, -v_earned, 'cancel_earn',
        'sales_invoice', p_invoice_id, 'إلغاء اكتساب من فاتورة ' || v_label, auth.uid()
      );
    END IF;
    IF v_redeemed > 0 THEN
      INSERT INTO public.loyalty_transactions (
        customer_id, transaction_date, points, type,
        reference_type, reference_id, notes, created_by
      ) VALUES (
        v_invoice.customer_id, CURRENT_DATE, v_redeemed, 'cancel_redeem',
        'sales_invoice', p_invoice_id, 'إلغاء استبدال من فاتورة ' || v_label, auth.uid()
      );
    END IF;

    PERFORM public.recalculate_customer_loyalty_internal(v_invoice.customer_id);
    PERFORM public.recalculate_customer_balance_internal(v_invoice.customer_id);
  END IF;

  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id)
  VALUES (
    'sales_invoices',
    p_invoice_id::text,
    'cancel',
    jsonb_build_object(
      'status', 'posted',
      'journal_entry_id', v_invoice.journal_entry_id,
      'posted_number', v_invoice.posted_number
    ),
    jsonb_build_object(
      'status', 'cancelled',
      'reversal_journal_entry_id', v_reversal_id,
      'posted_number', v_invoice.posted_number
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'success', true,
    'reversal_journal_entry_id', v_reversal_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_sales_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_sales_invoice(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_sales_return(p_return_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_return public.sales_returns%ROWTYPE;
  v_movement record;
  v_product record;
  v_stock_enforced boolean := true;
  v_prefix text;
  v_label text;
  v_reversal_id uuid;
  v_reversed_earn integer := 0;
  v_refunded_redeem integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT (
       public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'accountant'::public.app_role)
       OR public.has_role(auth.uid(), 'sales'::public.app_role)
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'غير مصرح بإلغاء مرتجع البيع');
  END IF;

  SELECT *
  INTO v_return
  FROM public.sales_returns
  WHERE id = p_return_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'مرتجع البيع غير موجود');
  END IF;
  IF v_return.status <> 'posted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'يمكن إلغاء المرتجعات المرحّلة فقط');
  END IF;

  IF EXISTS (
    WITH item_totals AS (
      SELECT product_id, SUM(quantity) AS quantity
      FROM public.sales_return_items
      WHERE return_id = p_return_id AND product_id IS NOT NULL
      GROUP BY product_id
    ),
    movement_totals AS (
      SELECT product_id, SUM(quantity) AS quantity
      FROM public.inventory_movements
      WHERE reference_id = p_return_id AND reference_type = 'sales_return'
      GROUP BY product_id
    )
    SELECT 1
    FROM item_totals item
    FULL JOIN movement_totals movement USING (product_id)
    WHERE COALESCE(item.quantity, 0) <> COALESCE(movement.quantity, 0)
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'لا يمكن إلغاء المرتجع لأن حركات مخزونه ناقصة أو غير متطابقة؛ راجع سلامة المستند أولاً'
    );
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.sales_invoice_return_settlements
       WHERE return_id = p_return_id
     )
     OR EXISTS (
       SELECT 1 FROM public.sales_return_payment_allocations
       WHERE return_id = p_return_id
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'لا يمكن إلغاء المرتجع قبل إلغاء التسويات أو مبالغ الرد المرتبطة به');
  END IF;

  SELECT
    COALESCE(stock_enforcement_enabled, true),
    COALESCE(NULLIF(sales_return_prefix, ''), 'SRN-')
  INTO v_stock_enforced, v_prefix
  FROM public.company_settings
  LIMIT 1;
  v_label := COALESCE(v_prefix, 'SRN-') || LPAD(
    COALESCE(v_return.posted_number, v_return.return_number)::text,
    4,
    '0'
  );

  FOR v_movement IN
    SELECT product_id, SUM(quantity) AS quantity
    FROM public.inventory_movements
    WHERE reference_id = p_return_id AND reference_type = 'sales_return'
    GROUP BY product_id
    ORDER BY product_id
  LOOP
    SELECT id, quantity_on_hand
    INTO v_product
    FROM public.products
    WHERE id = v_movement.product_id
    FOR UPDATE;

    IF v_stock_enforced AND COALESCE(v_product.quantity_on_hand, 0) < v_movement.quantity THEN
      RETURN jsonb_build_object('success', false, 'error', 'لا يمكن إلغاء المرتجع لأن جزءاً من كمياته صُرف من المخزون');
    END IF;
  END LOOP;

  v_reversal_id := public.create_document_reversal_internal(
    v_return.journal_entry_id,
    CURRENT_DATE,
    'عكس مرتجع بيع رقم ' || v_label
  );

  FOR v_movement IN
    SELECT product_id, SUM(quantity) AS quantity
    FROM public.inventory_movements
    WHERE reference_id = p_return_id AND reference_type = 'sales_return'
    GROUP BY product_id
    ORDER BY product_id
  LOOP
    UPDATE public.products
    SET quantity_on_hand = quantity_on_hand - v_movement.quantity
    WHERE id = v_movement.product_id;
  END LOOP;

  DELETE FROM public.inventory_movements
  WHERE reference_id = p_return_id AND reference_type = 'sales_return';

  UPDATE public.sales_returns
  SET status = 'cancelled'
  WHERE id = p_return_id;

  IF v_return.customer_id IS NOT NULL THEN
    SELECT
      ABS(COALESCE(SUM(points) FILTER (WHERE type = 'reversal'), 0)),
      COALESCE(SUM(points) FILTER (WHERE type = 'redeem_reversal'), 0)
    INTO v_reversed_earn, v_refunded_redeem
    FROM public.loyalty_transactions
    WHERE reference_type = 'sales_return' AND reference_id = p_return_id;

    IF v_reversed_earn > 0 THEN
      INSERT INTO public.loyalty_transactions (
        customer_id, transaction_date, points, type,
        reference_type, reference_id, notes, created_by
      ) VALUES (
        v_return.customer_id, CURRENT_DATE, v_reversed_earn, 'earn',
        'sales_return', p_return_id, 'إلغاء عكس نقاط مرتجع ' || v_label, auth.uid()
      );
    END IF;
    IF v_refunded_redeem > 0 THEN
      INSERT INTO public.loyalty_transactions (
        customer_id, transaction_date, points, type,
        reference_type, reference_id, notes, created_by
      ) VALUES (
        v_return.customer_id, CURRENT_DATE, -v_refunded_redeem, 'reversal',
        'sales_return', p_return_id, 'إلغاء إعادة نقاط مرتجع ' || v_label, auth.uid()
      );
    END IF;

    PERFORM public.recalculate_customer_loyalty_internal(v_return.customer_id);
    PERFORM public.recalculate_customer_balance_internal(v_return.customer_id);
  END IF;

  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id)
  VALUES (
    'sales_returns',
    p_return_id::text,
    'cancel',
    jsonb_build_object(
      'status', 'posted',
      'journal_entry_id', v_return.journal_entry_id,
      'posted_number', v_return.posted_number
    ),
    jsonb_build_object(
      'status', 'cancelled',
      'reversal_journal_entry_id', v_reversal_id,
      'posted_number', v_return.posted_number
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'success', true,
    'reversal_journal_entry_id', v_reversal_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_sales_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_sales_return(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.post_sales_invoice(uuid) IS
  'Atomic sales invoice posting gateway for admin/accountant/sales roles.';
COMMENT ON FUNCTION public.unpost_sales_invoice(uuid) IS
  'Atomic admin-only sales invoice reset-to-draft gateway.';
COMMENT ON FUNCTION public.post_sales_return(uuid) IS
  'Atomic sales return posting including journal, stock, loyalty and customer balance.';
COMMENT ON FUNCTION public.cancel_sales_invoice(uuid) IS
  'Atomic sales invoice cancellation including reversal, stock, loyalty and customer balance.';
COMMENT ON FUNCTION public.cancel_sales_return(uuid) IS
  'Atomic sales return cancellation including reversal, stock, loyalty and customer balance.';
