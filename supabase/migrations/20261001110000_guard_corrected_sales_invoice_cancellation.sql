-- Keep the historical source movement and correction audit intact.
-- This gate is intentionally limited to invoices with a cost-correction record.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$ BEGIN
  IF to_regclass('public.historical_sale_cost_corrections') IS NULL
     OR to_regprocedure('public.cancel_sales_invoice_finance_internal(uuid)') IS NULL
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.cancel_sales_invoice(uuid)'::regprocedure)
        IS DISTINCT FROM '81a939c271ace3890192d3b33c5aeb4d'
  THEN RAISE EXCEPTION 'CORRECTED_SALE_CANCEL_GUARD_BASELINE_MISMATCH'; END IF;
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

  IF EXISTS (
    SELECT 1 FROM public.historical_sale_cost_corrections
    WHERE source_invoice_id = p_invoice_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'HISTORICAL_COST_CORRECTION_REQUIRES_REVIEW',
      'error', 'لا يمكن إلغاء هذه الفاتورة آليًا لارتباطها بتصحيح تكلفة تاريخي. راجع المحاسب لإجراء عكس موثق.'
    );
  END IF;

  RETURN public.cancel_sales_invoice_finance_internal(p_invoice_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_sales_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_sales_invoice(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.cancel_sales_invoice(uuid) IS
  'Finance-only cancellation; invoices with audited historical cost corrections require a separate reviewed reversal.';
COMMIT;
