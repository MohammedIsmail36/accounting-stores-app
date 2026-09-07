-- Restrict cost-sensitive RPCs to finance application roles.
--
-- RLS protects rows, not columns. A sales user that can select a product or
-- inventory-movement row can otherwise ask PostgREST for its cost columns.
-- These wrappers close the parallel RPC path before table access is tightened
-- in the next 9D-2C batches, while preserving every existing API signature.

CREATE OR REPLACE FUNCTION public.require_finance_api_access()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'accountant'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'غير مصرح بالوصول إلى بيانات التكلفة'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.require_finance_api_access()
  FROM PUBLIC, anon, authenticated, service_role;

-- Small invoker functions are also used from inside the atomic sales
-- SECURITY DEFINER gateways. Preserve that internal call path by applying the
-- actor guard only to direct PostgREST roles; nested owner calls remain valid.
ALTER FUNCTION public.get_avg_purchase_price(uuid)
  RENAME TO get_avg_purchase_price_finance_internal;

REVOKE ALL ON FUNCTION public.get_avg_purchase_price_finance_internal(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_avg_purchase_price(_product_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'anon' THEN
    RAISE EXCEPTION 'غير مصرح بالوصول إلى بيانات التكلفة'
      USING ERRCODE = '42501';
  ELSIF current_user = 'authenticated' THEN
    PERFORM public.require_finance_api_access();
  END IF;

  RETURN public.get_avg_purchase_price_finance_internal(_product_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_avg_purchase_price(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_avg_purchase_price(uuid)
  TO authenticated, service_role;

ALTER FUNCTION public.get_inventory_movements_summary(date, date, uuid)
  RENAME TO get_inventory_movements_summary_finance_internal;

REVOKE ALL ON FUNCTION public.get_inventory_movements_summary_finance_internal(date, date, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_inventory_movements_summary(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_product_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_finance_api_access();
  RETURN public.get_inventory_movements_summary_finance_internal(
    p_date_from,
    p_date_to,
    p_product_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_movements_summary(date, date, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_movements_summary(date, date, uuid)
  TO authenticated, service_role;

ALTER FUNCTION public.get_products_summary()
  RENAME TO get_products_summary_finance_internal;

REVOKE ALL ON FUNCTION public.get_products_summary_finance_internal()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_products_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_finance_api_access();
  RETURN public.get_products_summary_finance_internal();
END;
$$;

REVOKE ALL ON FUNCTION public.get_products_summary()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_products_summary()
  TO authenticated, service_role;

-- Inventory analytics functions run as their owner and therefore bypass RLS.
-- Keep their existing bodies private and expose role-checked wrappers with the
-- exact original names and return contracts.
ALTER FUNCTION public.inventory_product_state(date)
  RENAME TO inventory_product_state_finance_internal;

REVOKE ALL ON FUNCTION public.inventory_product_state_finance_internal(date)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.inventory_product_state(p_as_of date)
RETURNS TABLE(
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_finance_api_access();
  RETURN QUERY
  SELECT *
  FROM public.inventory_product_state_finance_internal(p_as_of);
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_product_state(date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_product_state(date)
  TO authenticated, service_role;

ALTER FUNCTION public.get_inventory_aging(date, integer, integer)
  RENAME TO get_inventory_aging_finance_internal;

REVOKE ALL ON FUNCTION public.get_inventory_aging_finance_internal(date, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_inventory_aging(
  p_as_of date DEFAULT NULL,
  p_slow_days integer DEFAULT NULL,
  p_dead_days integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_finance_api_access();
  RETURN public.get_inventory_aging_finance_internal(
    p_as_of,
    p_slow_days,
    p_dead_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_aging(date, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_aging(date, integer, integer)
  TO authenticated, service_role;

ALTER FUNCTION public.get_inventory_kpis(date, date)
  RENAME TO get_inventory_kpis_finance_internal;

REVOKE ALL ON FUNCTION public.get_inventory_kpis_finance_internal(date, date)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_inventory_kpis(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_finance_api_access();
  RETURN public.get_inventory_kpis_finance_internal(p_date_from, p_date_to);
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_kpis(date, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_kpis(date, date)
  TO authenticated, service_role;

ALTER FUNCTION public.get_inventory_reorder(date, date, integer, integer)
  RENAME TO get_inventory_reorder_finance_internal;

REVOKE ALL ON FUNCTION public.get_inventory_reorder_finance_internal(date, date, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_inventory_reorder(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_lead_time_days integer DEFAULT NULL,
  p_target_days integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_finance_api_access();
  RETURN public.get_inventory_reorder_finance_internal(
    p_date_from,
    p_date_to,
    p_lead_time_days,
    p_target_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_reorder(date, date, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_reorder(date, date, integer, integer)
  TO authenticated, service_role;

ALTER FUNCTION public.get_inventory_valuation(date)
  RENAME TO get_inventory_valuation_finance_internal;

REVOKE ALL ON FUNCTION public.get_inventory_valuation_finance_internal(date)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_inventory_valuation(p_as_of date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_finance_api_access();
  RETURN public.get_inventory_valuation_finance_internal(p_as_of);
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_valuation(date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_valuation(date)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.require_finance_api_access() IS
  'Raises insufficient_privilege unless the JWT actor is admin, accountant, or service_role.';
COMMENT ON FUNCTION public.get_avg_purchase_price(uuid) IS
  'Finance-only cost RPC; atomic document gateways may call it under their owner context.';
