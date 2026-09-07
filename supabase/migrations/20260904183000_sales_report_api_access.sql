-- Protect the full financial sales report at the database API boundary.
--
-- Application roles are stored in public.user_roles, so PostgreSQL grants alone
-- cannot distinguish an accountant from a sales user (both connect as
-- `authenticated`). Keep the original aggregations private and expose guarded
-- wrappers under the existing RPC names to avoid changing the frontend contract.

ALTER FUNCTION public.get_sales_report_summary(date, date, date, date)
  RENAME TO get_sales_report_summary_finance_internal;

ALTER FUNCTION public.get_sales_report_summary_filtered(date, date, date, date, text)
  RENAME TO get_sales_report_summary_filtered_finance_internal;

REVOKE ALL ON FUNCTION public.get_sales_report_summary_finance_internal(date, date, date, date)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_sales_report_summary_filtered_finance_internal(date, date, date, date, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_sales_report_summary(
  p_date_from date,
  p_date_to date,
  p_previous_from date,
  p_previous_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT (
       public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'accountant'::public.app_role)
     ) THEN
    RAISE EXCEPTION 'غير مصرح: تقرير المبيعات المالي متاح للمدير أو المحاسب فقط'
      USING ERRCODE = '42501';
  END IF;

  RETURN public.get_sales_report_summary_finance_internal(
    p_date_from,
    p_date_to,
    p_previous_from,
    p_previous_to
  );
END;
$$;

CREATE FUNCTION public.get_sales_report_summary_filtered(
  p_date_from date,
  p_date_to date,
  p_previous_from date,
  p_previous_to date,
  p_customer_filter text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT (
       public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'accountant'::public.app_role)
     ) THEN
    RAISE EXCEPTION 'غير مصرح: تقرير المبيعات المالي متاح للمدير أو المحاسب فقط'
      USING ERRCODE = '42501';
  END IF;

  RETURN public.get_sales_report_summary_filtered_finance_internal(
    p_date_from,
    p_date_to,
    p_previous_from,
    p_previous_to,
    p_customer_filter
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_sales_report_summary(date, date, date, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_report_summary(date, date, date, date)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_sales_report_summary_filtered(date, date, date, date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_report_summary_filtered(date, date, date, date, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_sales_report_summary(date, date, date, date) IS
  'Financial sales summary restricted to admin/accountant application roles and service_role.';

COMMENT ON FUNCTION public.get_sales_report_summary_filtered(date, date, date, date, text) IS
  'Filtered financial sales summary restricted to admin/accountant application roles and service_role.';
