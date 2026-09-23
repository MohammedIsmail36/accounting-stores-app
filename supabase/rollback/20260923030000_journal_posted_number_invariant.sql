-- Explicit rollback for the numeric posted journal numbering invariant.
-- Official numbers already assigned by the forward migration are retained.

BEGIN;

DO $guard$
BEGIN
  IF current_setting('app.journal_posted_number_rollback_authorized', true)
       IS DISTINCT FROM 'STAGING_20260923030000' THEN
    RAISE EXCEPTION 'JOURNAL_POSTED_NUMBER_ROLLBACK_NOT_AUTHORIZED';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.journal_entries'::regclass
         AND conname = 'journal_entries_posted_number_required'
     )
     OR to_regclass('public.journal_entries_posted_number_unique') IS NULL THEN
    RAISE EXCEPTION 'JOURNAL_POSTED_NUMBER_ROLLBACK_BASELINE_MISMATCH';
  END IF;
END;
$guard$;

ALTER TABLE public.journal_entries
  DROP CONSTRAINT journal_entries_posted_number_required;
DROP INDEX public.journal_entries_posted_number_unique;

CREATE OR REPLACE FUNCTION public.create_journal_entry(
  p_entry_date date,
  p_description text,
  p_lines jsonb,
  p_status text DEFAULT 'posted',
  p_posted_number integer DEFAULT NULL,
  p_entry_type text DEFAULT 'regular'
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_total numeric;
  v_id uuid;
BEGIN
  IF p_description IS NULL OR btrim(p_description) = '' THEN
    RAISE EXCEPTION 'وصف القيد مطلوب';
  END IF;

  v_total := public.fn_validate_journal_lines_json(p_lines);

  INSERT INTO public.journal_entries (
    entry_date, description, status, total_debit, total_credit,
    posted_number, entry_type, created_by
  ) VALUES (
    p_entry_date, p_description, COALESCE(p_status, 'posted'), v_total, v_total,
    p_posted_number, COALESCE(p_entry_type, 'regular'), auth.uid()
  )
  RETURNING id INTO v_id;

  INSERT INTO public.journal_entry_lines (
    journal_entry_id, account_id, debit, credit, description
  )
  SELECT v_id,
         (line->>'account_id')::uuid,
         COALESCE((line->>'debit')::numeric, 0),
         COALESCE((line->>'credit')::numeric, 0),
         COALESCE(line->>'description', p_description)
  FROM jsonb_array_elements(p_lines) AS line;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.replace_journal_entry_lines(
  p_entry_id uuid,
  p_lines jsonb,
  p_entry_date date DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_total numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.journal_entries WHERE id = p_entry_id) THEN
    RAISE EXCEPTION 'القيد غير موجود';
  END IF;

  v_total := public.fn_validate_journal_lines_json(p_lines);

  DELETE FROM public.journal_entry_lines WHERE journal_entry_id = p_entry_id;

  INSERT INTO public.journal_entry_lines (
    journal_entry_id, account_id, debit, credit, description
  )
  SELECT p_entry_id,
         (line->>'account_id')::uuid,
         COALESCE((line->>'debit')::numeric, 0),
         COALESCE((line->>'credit')::numeric, 0),
         COALESCE(line->>'description', p_description)
  FROM jsonb_array_elements(p_lines) AS line;

  UPDATE public.journal_entries entry
  SET total_debit = v_total,
      total_credit = v_total,
      entry_date = COALESCE(p_entry_date, entry.entry_date),
      description = COALESCE(p_description, entry.description),
      status = COALESCE(p_status, entry.status),
      posted_number = CASE
        WHEN COALESCE(p_status, entry.status) = 'posted' AND entry.posted_number IS NULL
          THEN (SELECT COALESCE(max(candidate.posted_number), 0) + 1 FROM public.journal_entries candidate)
        ELSE entry.posted_number
      END,
      updated_at = now()
  WHERE entry.id = p_entry_id;

  RETURN p_entry_id;
END;
$function$;

COMMIT;
