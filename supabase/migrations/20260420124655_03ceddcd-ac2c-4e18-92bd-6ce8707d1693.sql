-- RPC: get_account_balances
-- Returns balances aggregated from posted journal entries for all non-parent accounts.
-- Used by both Trial Balance and Account Balances reports.
CREATE OR REPLACE FUNCTION public.get_account_balances(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_only_with_activity boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows jsonb;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
BEGIN
  WITH agg AS (
    SELECT
      jel.account_id,
      COALESCE(SUM(jel.debit), 0)::numeric  AS debit,
      COALESCE(SUM(jel.credit), 0)::numeric AS credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.status = 'posted'
      AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
      AND (p_date_to   IS NULL OR je.entry_date <= p_date_to)
    GROUP BY jel.account_id
  ),
  joined AS (
    SELECT
      a.id, a.code, a.name, a.account_type,
      COALESCE(g.debit, 0)  AS debit,
      COALESCE(g.credit, 0) AS credit,
      (COALESCE(g.debit, 0) - COALESCE(g.credit, 0)) AS balance
    FROM accounts a
    LEFT JOIN agg g ON g.account_id = a.id
    WHERE a.is_active = true
      AND a.is_parent = false
      AND (NOT p_only_with_activity OR g.account_id IS NOT NULL)
  )
  SELECT jsonb_agg(row_to_json(t) ORDER BY t.code),
         COALESCE(SUM(t.debit), 0),
         COALESCE(SUM(t.credit), 0)
  INTO v_rows, v_total_debit, v_total_credit
  FROM joined t;

  RETURN jsonb_build_object(
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'total_debit', v_total_debit,
    'total_credit', v_total_credit
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_account_balances(date, date, boolean) TO authenticated;