-- Stage 1 RED contract: synthetic, disposable database only. This models the
-- status='posted' payment filter in CashFlowStatement and get_account_statement.
-- It does not claim to execute either complete production report.
BEGIN;

ALTER TABLE public.customer_payments ADD COLUMN payment_date date, ADD COLUMN amount numeric;
ALTER TABLE public.supplier_payments ADD COLUMN payment_date date, ADD COLUMN amount numeric;
UPDATE public.customer_payments SET payment_date = DATE '2026-09-01', amount = 100;
UPDATE public.supplier_payments SET payment_date = DATE '2026-09-01', amount = 75;
UPDATE public.journal_entries SET entry_date = DATE '2026-09-01';

DO $contract$
DECLARE
  customer_legacy numeric;
  supplier_legacy numeric;
  customer_prior_as_of numeric;
  supplier_prior_as_of numeric;
  customer_after_as_of numeric;
  supplier_after_as_of numeric;
  original_journals integer;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO customer_legacy
  FROM public.customer_payments
  WHERE status = 'posted' AND payment_date <= DATE '2026-09-30';
  SELECT COALESCE(SUM(amount), 0) INTO supplier_legacy
  FROM public.supplier_payments
  WHERE status = 'posted' AND payment_date <= DATE '2026-09-30';
  IF customer_legacy <> 100 OR supplier_legacy <> 75 THEN
    RAISE EXCEPTION 'TEMPORAL_RED_INVALID_BASELINE';
  END IF;

  -- Simulate a future atomic cancellation that preserves the original journals
  -- and changes the voucher status on 2026-10-01.
  UPDATE public.customer_payments SET status = 'cancelled';
  UPDATE public.supplier_payments SET status = 'cancelled';

  SELECT COALESCE(SUM(amount), 0) INTO customer_legacy
  FROM public.customer_payments
  WHERE status = 'posted' AND payment_date <= DATE '2026-09-30';
  SELECT COALESCE(SUM(amount), 0) INTO supplier_legacy
  FROM public.supplier_payments
  WHERE status = 'posted' AND payment_date <= DATE '2026-09-30';
  SELECT COUNT(*) INTO original_journals FROM public.journal_entries
  WHERE status = 'posted' AND entry_date <= DATE '2026-09-30';

  -- Independent event calculation: original payment plus a dated opposite event.
  SELECT COALESCE(SUM(signed_amount), 0) INTO customer_prior_as_of FROM (
    SELECT payment_date AS event_date, amount AS signed_amount FROM public.customer_payments
    UNION ALL SELECT DATE '2026-10-01', -100::numeric
  ) events WHERE event_date <= DATE '2026-09-30';
  SELECT COALESCE(SUM(signed_amount), 0) INTO supplier_prior_as_of FROM (
    SELECT payment_date AS event_date, amount AS signed_amount FROM public.supplier_payments
    UNION ALL SELECT DATE '2026-10-01', -75::numeric
  ) events WHERE event_date <= DATE '2026-09-30';
  SELECT COALESCE(SUM(signed_amount), 0) INTO customer_after_as_of FROM (
    SELECT payment_date AS event_date, amount AS signed_amount FROM public.customer_payments
    UNION ALL SELECT DATE '2026-10-01', -100::numeric
  ) events WHERE event_date <= DATE '2026-10-31';
  SELECT COALESCE(SUM(signed_amount), 0) INTO supplier_after_as_of FROM (
    SELECT payment_date AS event_date, amount AS signed_amount FROM public.supplier_payments
    UNION ALL SELECT DATE '2026-10-01', -75::numeric
  ) events WHERE event_date <= DATE '2026-10-31';

  IF customer_legacy <> 0 OR supplier_legacy <> 0 OR original_journals <> 2
    OR customer_prior_as_of <> 100 OR supplier_prior_as_of <> 75
    OR customer_after_as_of <> 0 OR supplier_after_as_of <> 0 THEN
    RAISE EXCEPTION 'TEMPORAL_RED_EXPECTATION_FAILED';
  END IF;
END;
$contract$;

ROLLBACK;
SELECT 'PAYMENT_VOUCHER_TEMPORAL_RED_OK: status filter loses prior-period payments; dated events preserve history';
