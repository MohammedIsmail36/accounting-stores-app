
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_account_statement(text, uuid, date, date, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_ledger_lines(uuid, date, date, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_account_balances(date, date, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_ledger_active_accounts() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_statement(text, uuid, date, date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ledger_lines(uuid, date, date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_balances(date, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ledger_active_accounts() TO authenticated;
