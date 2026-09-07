-- The invoker-based average-cost wrapper calls the guard while the effective
-- PostgreSQL role is `authenticated`. Executing the guard reveals no data: it
-- either returns void for a finance actor or raises insufficient_privilege.
GRANT EXECUTE ON FUNCTION public.require_finance_api_access()
  TO authenticated, service_role;
