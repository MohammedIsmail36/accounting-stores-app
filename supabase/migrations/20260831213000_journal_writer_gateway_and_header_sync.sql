-- ============================================================
-- Atomic journal writer gateway + repair stale header totals.
-- This is intentionally in supabase/migrations because the production
-- deployment workflow applies this directory (not drizzle/migrations).
-- ============================================================

-- Validate every individual journal line.
CREATE OR REPLACE FUNCTION public.fn_validate_journal_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.debit, 0) < 0 OR COALESCE(NEW.credit, 0) < 0 THEN
    RAISE EXCEPTION 'لا يمكن إدخال مبالغ سالبة في سطر القيد';
  END IF;
  IF COALESCE(NEW.debit, 0) > 0 AND COALESCE(NEW.credit, 0) > 0 THEN
    RAISE EXCEPTION 'سطر القيد لا يمكن أن يكون مدينًا ودائنًا في نفس الوقت';
  END IF;
  IF COALESCE(NEW.debit, 0) = 0 AND COALESCE(NEW.credit, 0) = 0 THEN
    RAISE EXCEPTION 'سطر القيد يجب أن يحتوي مبلغًا في المدين أو الدائن';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_journal_line ON public.journal_entry_lines;
CREATE TRIGGER trg_validate_journal_line
BEFORE INSERT OR UPDATE ON public.journal_entry_lines
FOR EACH ROW EXECUTE FUNCTION public.fn_validate_journal_line();

-- Validate the complete set of lines before writing a journal entry.
CREATE OR REPLACE FUNCTION public.fn_validate_journal_lines_json(p_lines jsonb)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_debit numeric;
  v_credit numeric;
  v_bad integer;
  v_missing integer;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'سطور القيد غير صحيحة';
  END IF;

  SELECT count(*),
         COALESCE(sum((l->>'debit')::numeric), 0),
         COALESCE(sum((l->>'credit')::numeric), 0),
         count(*) FILTER (
           WHERE COALESCE((l->>'debit')::numeric, 0) < 0
              OR COALESCE((l->>'credit')::numeric, 0) < 0
              OR (COALESCE((l->>'debit')::numeric, 0) > 0 AND COALESCE((l->>'credit')::numeric, 0) > 0)
              OR (COALESCE((l->>'debit')::numeric, 0) = 0 AND COALESCE((l->>'credit')::numeric, 0) = 0)
         )
    INTO v_count, v_debit, v_credit, v_bad
  FROM jsonb_array_elements(p_lines) AS l;

  IF v_count < 2 THEN
    RAISE EXCEPTION 'القيد يجب أن يحتوي سطرين على الأقل';
  END IF;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'يوجد سطر غير صحيح (سالب، أو صفر، أو مدين ودائن معًا)';
  END IF;
  IF round(v_debit, 2) <> round(v_credit, 2) THEN
    RAISE EXCEPTION 'القيد غير متوازن: مدين % ودائن %', round(v_debit, 2), round(v_credit, 2);
  END IF;
  IF round(v_debit, 2) <= 0 THEN
    RAISE EXCEPTION 'إجمالي القيد يجب أن يكون أكبر من صفر';
  END IF;

  SELECT count(*) INTO v_missing
  FROM jsonb_array_elements(p_lines) AS l
  WHERE NOT EXISTS (
    SELECT 1 FROM public.accounts a WHERE a.id = (l->>'account_id')::uuid
  );
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'أحد الحسابات المستخدمة في القيد غير موجود';
  END IF;

  RETURN round(v_debit, 2);
END;
$$;

-- Create the header and all lines atomically, deriving header totals from all
-- debit/credit lines rather than from the source document total.
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
AS $$
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
         (l->>'account_id')::uuid,
         COALESCE((l->>'debit')::numeric, 0),
         COALESCE((l->>'credit')::numeric, 0),
         COALESCE(l->>'description', p_description)
  FROM jsonb_array_elements(p_lines) AS l;

  RETURN v_id;
END;
$$;

-- Replace lines atomically and keep the header and posted number synchronized.
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

  INSERT INTO public.journal_entry_lines (
    journal_entry_id, account_id, debit, credit, description
  )
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

REVOKE ALL ON FUNCTION public.create_journal_entry(date, text, jsonb, text, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.replace_journal_entry_lines(uuid, jsonb, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_validate_journal_lines_json(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_journal_entry(date, text, jsonb, text, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.replace_journal_entry_lines(uuid, jsonb, date, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_validate_journal_lines_json(jsonb) TO authenticated, service_role;

-- Repair stale header totals for every existing entry whose complete line set
-- is valid and balanced. This fixes PRN-0005 / posted journal #254 as well as
-- any equivalent historical mismatch without altering accounting lines.
WITH balanced_line_totals AS (
  SELECT journal_entry_id,
         round(COALESCE(sum(debit), 0), 2) AS debit,
         round(COALESCE(sum(credit), 0), 2) AS credit
  FROM public.journal_entry_lines
  GROUP BY journal_entry_id
  HAVING count(*) >= 2
     AND round(COALESCE(sum(debit), 0), 2) = round(COALESCE(sum(credit), 0), 2)
     AND round(COALESCE(sum(debit), 0), 2) > 0
)
UPDATE public.journal_entries je
   SET total_debit = totals.debit,
       total_credit = totals.credit,
       updated_at = now()
  FROM balanced_line_totals totals
 WHERE totals.journal_entry_id = je.id
   AND (
     round(COALESCE(je.total_debit, 0), 2) <> totals.debit
     OR round(COALESCE(je.total_credit, 0), 2) <> totals.credit
   );
