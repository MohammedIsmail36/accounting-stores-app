DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND roles = '{public}'
      AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%auth.uid()%'
  LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I TO authenticated', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "No updates on sales return payment allocations" ON public.sales_return_payment_allocations;
CREATE POLICY "No updates on sales return payment allocations"
ON public.sales_return_payment_allocations
FOR UPDATE TO authenticated
USING (false) WITH CHECK (false);