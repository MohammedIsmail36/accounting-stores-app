REVOKE EXECUTE ON FUNCTION public.edit_customer_payment(uuid, uuid, date, numeric, text, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.edit_supplier_payment(uuid, uuid, date, numeric, text, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_customer_payment(uuid, uuid, date, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_supplier_payment(uuid, uuid, date, numeric, text, text, text) TO authenticated;