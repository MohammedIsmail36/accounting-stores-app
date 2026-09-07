CREATE OR REPLACE FUNCTION public.get_ledger_lines(
  p_account_id uuid DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines jsonb;
  v_total_count int := 0;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
BEGIN
  WITH base AS (
    SELECT
      jel.debit::numeric AS debit,
      jel.credit::numeric AS credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.status = 'posted'
      AND (p_account_id IS NULL OR jel.account_id = p_account_id)
      AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
      AND (p_date_to IS NULL OR je.entry_date <= p_date_to)
  )
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(debit), 0),
    COALESCE(SUM(credit), 0)
  INTO v_total_count, v_total_debit, v_total_credit
  FROM base;

  WITH base AS (
    SELECT
      jel.id, jel.journal_entry_id, jel.account_id,
      jel.debit::numeric, jel.credit::numeric, jel.description,
      je.entry_number, je.posted_number AS entry_posted_number,
      je.entry_date, je.description AS entry_description, je.status AS entry_status,
      a.code AS account_code, a.name AS account_name,
      jel.created_at
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE je.status = 'posted'
      AND (p_account_id IS NULL OR jel.account_id = p_account_id)
      AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
      AND (p_date_to IS NULL OR je.entry_date <= p_date_to)
  ),
  ordered AS (
    SELECT
      *,
      CASE WHEN p_account_id IS NOT NULL THEN
        SUM(debit - credit) OVER (
          ORDER BY entry_posted_number NULLS LAST, entry_date, created_at
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
      ELSE 0 END AS running_balance
    FROM base
  )
  SELECT jsonb_agg(row_to_json(t))
  INTO v_lines
  FROM (
    SELECT * FROM ordered
    ORDER BY entry_posted_number NULLS LAST, entry_date, created_at
    OFFSET p_offset LIMIT p_limit
  ) t;

  RETURN jsonb_build_object(
    'lines', COALESCE(v_lines, '[]'::jsonb),
    'total_count', v_total_count,
    'total_debit', v_total_debit,
    'total_credit', v_total_credit,
    'net_balance', v_total_debit - v_total_credit
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_ledger_lines(uuid, date, date, int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_ledger_lines(uuid, date, date, int, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_ledger_lines(uuid, date, date, int, int) TO authenticated;