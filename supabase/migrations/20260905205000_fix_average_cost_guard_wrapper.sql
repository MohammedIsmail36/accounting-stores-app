-- Keep direct average-cost reads finance-only while allowing the atomic sales
-- gateways to use the private calculation internally.
DO $migration$
DECLARE
  v_function_name text;
  v_function_oid oid;
  v_definition text;
  v_rewritten text;
BEGIN
  FOREACH v_function_name IN ARRAY ARRAY[
    'public.post_sales_invoice(uuid)',
    'public.post_sales_invoice_atomic_internal(uuid)',
    'public.post_sales_return(uuid)'
  ]
  LOOP
    v_function_oid := to_regprocedure(v_function_name);
    IF v_function_oid IS NULL THEN
      RAISE EXCEPTION 'Required sales gateway is missing: %', v_function_name;
    END IF;

    SELECT pg_get_functiondef(v_function_oid)
    INTO v_definition;

    v_rewritten := replace(
      v_definition,
      'public.get_avg_purchase_price(',
      'public.get_avg_purchase_price_finance_internal('
    );
    v_rewritten := replace(
      v_rewritten,
      'get_avg_purchase_price(',
      'public.get_avg_purchase_price_finance_internal('
    );

    IF v_rewritten = v_definition THEN
      RAISE EXCEPTION 'Average-cost call was not found in %', v_function_name;
    END IF;

    EXECUTE v_rewritten;
  END LOOP;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.get_avg_purchase_price(_product_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_finance_api_access();
  RETURN public.get_avg_purchase_price_finance_internal(_product_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_avg_purchase_price(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_avg_purchase_price(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_avg_purchase_price(uuid) IS
  'Finance-only average-cost endpoint; atomic sales gateways call the private implementation directly.';
