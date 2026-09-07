-- Cancelling a posted sales document creates a financial reversal and changes
-- inventory and customer balances. Keep posting available to sales, but make
-- cancellation a finance-only operation at the database boundary.

ALTER FUNCTION public.cancel_sales_invoice(uuid)
  RENAME TO cancel_sales_invoice_finance_internal;

REVOKE ALL ON FUNCTION public.cancel_sales_invoice_finance_internal(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.cancel_sales_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT (
       public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'accountant'::public.app_role)
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'إلغاء الفاتورة المرحّلة متاح للمدير والمحاسب فقط'
    );
  END IF;

  RETURN public.cancel_sales_invoice_finance_internal(p_invoice_id);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_sales_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_sales_invoice(uuid)
  TO authenticated, service_role;

ALTER FUNCTION public.cancel_sales_return(uuid)
  RENAME TO cancel_sales_return_finance_internal;

REVOKE ALL ON FUNCTION public.cancel_sales_return_finance_internal(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.cancel_sales_return(p_return_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT (
       public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'accountant'::public.app_role)
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'إلغاء المرتجع المرحّل متاح للمدير والمحاسب فقط'
    );
  END IF;

  RETURN public.cancel_sales_return_finance_internal(p_return_id);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_sales_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_sales_return(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.cancel_sales_invoice(uuid) IS
  'Finance-only atomic sales invoice cancellation gateway.';
COMMENT ON FUNCTION public.cancel_sales_return(uuid) IS
  'Finance-only atomic sales return cancellation gateway.';
