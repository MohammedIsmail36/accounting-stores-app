\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_database() <> 'store_accounting_atomic_test' THEN
    RAISE EXCEPTION 'هذا الاختبار يعمل فقط على قاعدة store_accounting_atomic_test المؤقتة';
  END IF;
END;
$guard$;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);

CREATE OR REPLACE FUNCTION public.test_fail_atomic_invoice_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.description = '__force_atomic_failure__' THEN
    RAISE EXCEPTION 'forced atomic invoice line failure';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER test_fail_atomic_invoice_line
BEFORE INSERT ON public.sales_invoice_items
FOR EACH ROW EXECUTE FUNCTION public.test_fail_atomic_invoice_line();

DO $test$
DECLARE
  v_admin_id uuid := gen_random_uuid();
  v_customer_id uuid;
  v_product_id uuid;
  v_invoice_id uuid;
  v_return_id uuid;
  v_result jsonb;
  v_original_journal_id uuid;
  v_reversal_journal_id uuid;
  v_posted_number integer;
  v_value numeric;
  v_failure_caught boolean := false;
BEGIN
  INSERT INTO auth.users (
    id,
    aud,
    role,
    email,
    raw_user_meta_data,
    created_at,
    updated_at
  ) VALUES (
    v_admin_id,
    'authenticated',
    'authenticated',
    'atomic-admin@example.test',
    '{"full_name":"Atomic admin"}'::jsonb,
    now(),
    now()
  );

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'isolated admin fixture was not created';
  END IF;

  INSERT INTO public.company_settings (
    company_name,
    enable_return_days_limit,
    stock_enforcement_enabled,
    loyalty_enabled,
    locked_until_date
  ) VALUES ('Atomic sales test', false, true, true, NULL);

  INSERT INTO public.accounts (code, name, account_type) VALUES
    ('1103', 'Customers', 'asset'),
    ('1104', 'Inventory', 'asset'),
    ('4101', 'Sales revenue', 'revenue'),
    ('5101', 'Cost of goods sold', 'expense');

  INSERT INTO public.customers (code, name, opening_balance, balance, loyalty_points)
  VALUES ('AT-C1', 'Atomic customer', 0, 0, 50)
  RETURNING id INTO v_customer_id;

  INSERT INTO public.loyalty_transactions (
    customer_id, transaction_date, points, type, reference_type, notes
  ) VALUES (
    v_customer_id, CURRENT_DATE, 50, 'manual_adjust', 'test_opening', 'Opening test points'
  );

  INSERT INTO public.products (
    code,
    name,
    purchase_price,
    selling_price,
    quantity_on_hand
  ) VALUES ('AT-P1', 'Atomic product', 50, 100, 10)
  RETURNING id INTO v_product_id;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_admin_id)::text,
    false
  );
  v_result := public.save_sales_invoice_draft(
    NULL,
    jsonb_build_object(
      'customer_id', v_customer_id,
      'invoice_date', CURRENT_DATE,
      'subtotal', 200,
      'discount', 0,
      'tax', 0,
      'total', 190,
      'loyalty_points_redeemed', 10,
      'loyalty_discount', 10,
      'notes', 'initial atomic draft'
    ),
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'description', 'Atomic product',
      'quantity', 2,
      'unit_price', 100,
      'discount', 0,
      'total', 200,
      'net_total', 190
    ))
  );
  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'atomic invoice draft creation failed: %', v_result;
  END IF;
  v_invoice_id := (v_result->>'invoice_id')::uuid;

  v_result := public.post_sales_invoice(v_invoice_id);
  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'invoice posting failed: %', v_result;
  END IF;
  v_original_journal_id := (v_result->>'journal_entry_id')::uuid;
  v_posted_number := (v_result->>'posted_number')::integer;

  SELECT quantity_on_hand INTO v_value FROM public.products WHERE id = v_product_id;
  IF v_value <> 8 THEN
    RAISE EXCEPTION 'invoice stock expected 8, got %', v_value;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_movements
    WHERE reference_id = v_invoice_id
      AND reference_type = 'sales_invoice'
      AND movement_type = 'sale'
      AND unit_cost = 50
      AND total_cost = 100
  ) THEN
    RAISE EXCEPTION 'invoice purchase-price fallback cost movement is missing or incorrect';
  END IF;
  SELECT balance INTO v_value FROM public.customers WHERE id = v_customer_id;
  IF v_value <> 190 THEN
    RAISE EXCEPTION 'customer balance after invoice expected 190, got %', v_value;
  END IF;
  SELECT loyalty_points INTO v_value FROM public.customers WHERE id = v_customer_id;
  IF v_value <> 60 THEN
    RAISE EXCEPTION 'customer loyalty after invoice expected 60, got %', v_value;
  END IF;

  v_result := public.save_sales_invoice_draft(
    v_invoice_id,
    jsonb_build_object(
      'customer_id', v_customer_id,
      'invoice_date', CURRENT_DATE,
      'subtotal', 200,
      'discount', 0,
      'tax', 0,
      'total', 190,
      'loyalty_points_redeemed', 10,
      'loyalty_discount', 10
    ),
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'description', 'Atomic product',
      'quantity', 2,
      'unit_price', 100,
      'discount', 0,
      'total', 200,
      'net_total', 190
    ))
  );
  IF COALESCE((v_result->>'success')::boolean, false)
     OR v_result->>'error' NOT LIKE 'يمكن تعديل فواتير المسودة فقط%' THEN
    RAISE EXCEPTION 'posted invoice was editable through draft save: %', v_result;
  END IF;

  -- Posted invoice edit flow: reset to draft, change the draft, then post it
  -- again. The same posted number and journal header must be reused.
  v_result := public.unpost_sales_invoice(v_invoice_id);
  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'invoice reset to draft failed: %', v_result;
  END IF;
  IF (v_result->>'journal_entry_id')::uuid <> v_original_journal_id
     OR (v_result->>'posted_number')::integer <> v_posted_number THEN
    RAISE EXCEPTION 'invoice reset did not preserve its journal and posted number';
  END IF;

  SELECT quantity_on_hand INTO v_value FROM public.products WHERE id = v_product_id;
  IF v_value <> 10 THEN
    RAISE EXCEPTION 'invoice reset stock expected 10, got %', v_value;
  END IF;
  SELECT balance INTO v_value FROM public.customers WHERE id = v_customer_id;
  IF v_value <> 0 THEN
    RAISE EXCEPTION 'customer balance after invoice reset expected 0, got %', v_value;
  END IF;
  SELECT loyalty_points INTO v_value FROM public.customers WHERE id = v_customer_id;
  IF v_value <> 50 THEN
    RAISE EXCEPTION 'customer loyalty after invoice reset expected 50, got %', v_value;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE reference_id = v_invoice_id AND reference_type = 'sales_invoice'
  ) OR EXISTS (
    SELECT 1 FROM public.loyalty_transactions
    WHERE reference_id = v_invoice_id AND reference_type = 'sales_invoice'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE id = v_original_journal_id AND status = 'draft'
  ) THEN
    RAISE EXCEPTION 'invoice reset did not restore draft state completely';
  END IF;

  -- Force an exception during the replacement-line insert, after the function
  -- has updated the header and deleted the old lines. PostgreSQL must roll the
  -- entire save back, leaving the original draft intact.
  BEGIN
    PERFORM public.save_sales_invoice_draft(
      v_invoice_id,
      jsonb_build_object(
        'customer_id', v_customer_id,
        'invoice_date', CURRENT_DATE,
        'subtotal', 300,
        'discount', 0,
        'tax', 0,
        'total', 280,
        'loyalty_points_redeemed', 20,
        'loyalty_discount', 20
      ),
      jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id,
        'description', '__force_atomic_failure__',
        'quantity', 3,
        'unit_price', 100,
        'discount', 0,
        'total', 300,
        'net_total', 280
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'forced atomic invoice line failure' THEN
      v_failure_caught := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_failure_caught THEN
    RAISE EXCEPTION 'forced invoice save failure was not raised';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.sales_invoices invoice
    JOIN public.sales_invoice_items item ON item.invoice_id = invoice.id
    WHERE invoice.id = v_invoice_id
      AND invoice.status = 'draft'
      AND invoice.total = 190
      AND item.quantity = 2
      AND item.total = 200
  ) OR (
    SELECT COUNT(*) FROM public.sales_invoice_items WHERE invoice_id = v_invoice_id
  ) <> 1 THEN
    RAISE EXCEPTION 'failed atomic save changed the existing invoice or its lines';
  END IF;

  v_result := public.save_sales_invoice_draft(
    v_invoice_id,
    jsonb_build_object(
      'customer_id', v_customer_id,
      'invoice_date', CURRENT_DATE,
      'subtotal', 300,
      'discount', 0,
      'tax', 0,
      'total', 280,
      'loyalty_points_redeemed', 20,
      'loyalty_discount', 20,
      'notes', 'modified atomic draft'
    ),
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'description', 'Atomic product modified',
      'quantity', 3,
      'unit_price', 100,
      'discount', 0,
      'total', 300,
      'net_total', 280
    ))
  );
  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'atomic invoice draft modification failed: %', v_result;
  END IF;

  v_result := public.post_sales_invoice(v_invoice_id);
  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'modified invoice reposting failed: %', v_result;
  END IF;
  IF (v_result->>'journal_entry_id')::uuid <> v_original_journal_id
     OR (v_result->>'posted_number')::integer <> v_posted_number THEN
    RAISE EXCEPTION 'modified invoice repost did not reuse its journal and posted number';
  END IF;

  SELECT quantity_on_hand INTO v_value FROM public.products WHERE id = v_product_id;
  IF v_value <> 7 THEN
    RAISE EXCEPTION 'modified invoice stock expected 7, got %', v_value;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_movements
    WHERE reference_id = v_invoice_id
      AND reference_type = 'sales_invoice'
      AND movement_type = 'sale'
      AND quantity = 3
      AND unit_cost = 50
      AND total_cost = 150
  ) THEN
    RAISE EXCEPTION 'modified invoice cost movement is missing or incorrect';
  END IF;
  SELECT balance INTO v_value FROM public.customers WHERE id = v_customer_id;
  IF v_value <> 280 THEN
    RAISE EXCEPTION 'customer balance after modified invoice expected 280, got %', v_value;
  END IF;
  SELECT loyalty_points INTO v_value FROM public.customers WHERE id = v_customer_id;
  IF v_value <> 60 THEN
    RAISE EXCEPTION 'customer loyalty after modified invoice expected 60, got %', v_value;
  END IF;

  v_result := public.cancel_sales_invoice(v_invoice_id);
  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'invoice cancellation failed: %', v_result;
  END IF;
  v_reversal_journal_id := (v_result->>'reversal_journal_entry_id')::uuid;

  SELECT quantity_on_hand INTO v_value FROM public.products WHERE id = v_product_id;
  IF v_value <> 10 THEN
    RAISE EXCEPTION 'invoice cancellation stock expected 10, got %', v_value;
  END IF;
  SELECT balance INTO v_value FROM public.customers WHERE id = v_customer_id;
  IF v_value <> 0 THEN
    RAISE EXCEPTION 'customer balance after invoice cancellation expected 0, got %', v_value;
  END IF;
  SELECT loyalty_points INTO v_value FROM public.customers WHERE id = v_customer_id;
  IF v_value <> 50 THEN
    RAISE EXCEPTION 'customer loyalty after invoice cancellation expected 50, got %', v_value;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.loyalty_transactions
    WHERE reference_id = v_invoice_id AND type = 'cancel_earn' AND points = -30
  ) OR NOT EXISTS (
    SELECT 1 FROM public.loyalty_transactions
    WHERE reference_id = v_invoice_id AND type = 'cancel_redeem' AND points = 20
  ) THEN
    RAISE EXCEPTION 'invoice loyalty cancellation ledger is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE reference_id = v_invoice_id AND reference_type = 'sales_invoice'
  ) THEN
    RAISE EXCEPTION 'invoice movements were not removed';
  END IF;
  IF EXISTS (
    SELECT account_id
    FROM public.journal_entry_lines
    WHERE journal_entry_id IN (v_original_journal_id, v_reversal_journal_id)
    GROUP BY account_id
    HAVING ROUND(SUM(debit - credit), 2) <> 0
  ) THEN
    RAISE EXCEPTION 'invoice original and reversal entries do not net to zero';
  END IF;

  INSERT INTO public.sales_returns (
    return_number,
    customer_id,
    return_date,
    subtotal,
    tax,
    total,
    status
  ) VALUES (-900001, v_customer_id, CURRENT_DATE, 100, 0, 100, 'draft')
  RETURNING id INTO v_return_id;

  INSERT INTO public.sales_return_items (
    return_id,
    product_id,
    description,
    quantity,
    unit_price,
    total,
    net_total
  ) VALUES (v_return_id, v_product_id, 'Atomic product', 1, 100, 100, 100);

  v_result := public.post_sales_return(v_return_id);
  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'return posting failed: %', v_result;
  END IF;
  v_original_journal_id := (v_result->>'journal_entry_id')::uuid;

  SELECT quantity_on_hand INTO v_value FROM public.products WHERE id = v_product_id;
  IF v_value <> 11 THEN
    RAISE EXCEPTION 'return stock expected 11, got %', v_value;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_movements
    WHERE reference_id = v_return_id
      AND reference_type = 'sales_return'
      AND movement_type = 'sale_return'
      AND unit_cost = 50
      AND total_cost = 50
  ) THEN
    RAISE EXCEPTION 'return cost movement is missing or incorrect';
  END IF;
  SELECT balance INTO v_value FROM public.customers WHERE id = v_customer_id;
  IF v_value <> -100 THEN
    RAISE EXCEPTION 'customer balance after return expected -100, got %', v_value;
  END IF;
  SELECT loyalty_points INTO v_value FROM public.customers WHERE id = v_customer_id;
  IF v_value <> 40 THEN
    RAISE EXCEPTION 'customer loyalty after return expected 40, got %', v_value;
  END IF;

  v_result := public.cancel_sales_return(v_return_id);
  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'return cancellation failed: %', v_result;
  END IF;
  v_reversal_journal_id := (v_result->>'reversal_journal_entry_id')::uuid;

  SELECT quantity_on_hand INTO v_value FROM public.products WHERE id = v_product_id;
  IF v_value <> 10 THEN
    RAISE EXCEPTION 'return cancellation stock expected 10, got %', v_value;
  END IF;
  SELECT balance INTO v_value FROM public.customers WHERE id = v_customer_id;
  IF v_value <> 0 THEN
    RAISE EXCEPTION 'customer balance after return cancellation expected 0, got %', v_value;
  END IF;
  SELECT loyalty_points INTO v_value FROM public.customers WHERE id = v_customer_id;
  IF v_value <> 50 THEN
    RAISE EXCEPTION 'customer loyalty after return cancellation expected 50, got %', v_value;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE reference_id = v_return_id AND reference_type = 'sales_return'
  ) THEN
    RAISE EXCEPTION 'return movements were not removed';
  END IF;
  IF EXISTS (
    SELECT account_id
    FROM public.journal_entry_lines
    WHERE journal_entry_id IN (v_original_journal_id, v_reversal_journal_id)
    GROUP BY account_id
    HAVING ROUND(SUM(debit - credit), 2) <> 0
  ) THEN
    RAISE EXCEPTION 'return original and reversal entries do not net to zero';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}',
    false
  );
  v_result := public.post_sales_return(gen_random_uuid());
  IF COALESCE((v_result->>'success')::boolean, false)
     OR v_result->>'error' NOT LIKE 'غير مصرح%' THEN
    RAISE EXCEPTION 'unauthorized identity was not rejected: %', v_result;
  END IF;

  v_result := public.save_sales_invoice_draft(
    NULL,
    jsonb_build_object('invoice_date', CURRENT_DATE),
    '[]'::jsonb
  );
  IF COALESCE((v_result->>'success')::boolean, false)
     OR v_result->>'error' NOT LIKE 'غير مصرح%' THEN
    RAISE EXCEPTION 'unauthorized invoice draft save was not rejected: %', v_result;
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.post_sales_invoice_atomic_internal(uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.recalculate_customer_balance_internal(uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.recalculate_customer_loyalty_internal(uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'an internal sales function is still executable by authenticated';
  END IF;

  RAISE NOTICE 'atomic sales invoice and return lifecycle test passed';
END;
$test$;
