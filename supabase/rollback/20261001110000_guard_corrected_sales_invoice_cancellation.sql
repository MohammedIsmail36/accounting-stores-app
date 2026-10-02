BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$ BEGIN
  IF (SELECT prosrc LIKE '%HISTORICAL_COST_CORRECTION_REQUIRES_REVIEW%'
      FROM pg_proc WHERE oid='public.cancel_sales_invoice(uuid)'::regprocedure) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'CORRECTED_SALE_CANCEL_GUARD_ROLLBACK_MISMATCH'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.cancel_sales_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.cancel_sales_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_sales_invoice(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.cancel_sales_invoice(uuid) IS
  'Finance-only atomic sales invoice cancellation gateway.';
COMMIT;
