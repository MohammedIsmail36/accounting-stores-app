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
AS $$
DECLARE
  v_total numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.journal_entries WHERE id = p_entry_id) THEN
    RAISE EXCEPTION 'القيد غير موجود';
  END IF;

  v_total := public.fn_validate_journal_lines_json(p_lines);

  DELETE FROM public.journal_entry_lines WHERE journal_entry_id = p_entry_id;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  SELECT p_entry_id,
         (l->>'account_id')::uuid,
         COALESCE((l->>'debit')::numeric, 0),
         COALESCE((l->>'credit')::numeric, 0),
         COALESCE(l->>'description', p_description)
  FROM jsonb_array_elements(p_lines) AS l;

  UPDATE public.journal_entries je
     SET total_debit = v_total,
         total_credit = v_total,
         entry_date = COALESCE(p_entry_date, je.entry_date),
         description = COALESCE(p_description, je.description),
         status = COALESCE(p_status, je.status),
         posted_number = CASE
           WHEN COALESCE(p_status, je.status) = 'posted' AND je.posted_number IS NULL
             THEN (SELECT COALESCE(MAX(x.posted_number), 0) + 1 FROM public.journal_entries x)
           ELSE je.posted_number
         END,
         updated_at = now()
   WHERE je.id = p_entry_id;

  RETURN p_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_journal_entry_lines(uuid, jsonb, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_journal_entry_lines(uuid, jsonb, date, text, text) TO authenticated, service_role;