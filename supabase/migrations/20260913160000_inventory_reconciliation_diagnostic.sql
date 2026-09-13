-- Unified, read-only inventory reconciliation diagnostic.
-- No repair is performed here and no ledger value is guessed per product.

DROP FUNCTION IF EXISTS public.get_inventory_reconciliation_diagnostic(text, boolean, text, integer, integer, text);

CREATE FUNCTION public.get_inventory_reconciliation_diagnostic(
  p_section text DEFAULT 'summary',
  p_only_issues boolean DEFAULT true,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_expected_fingerprint text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_section text := lower(COALESCE(p_section, 'summary'));
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_fingerprint text;
  v_products jsonb := '[]'::jsonb;
  v_sources jsonb := '[]'::jsonb;
  v_filtered jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_totals jsonb;
  v_issue_counts jsonb;
  v_status text;
  v_total_count integer := 0;
  v_product_issue_count integer := 0;
  v_source_issue_count integer := 0;
  v_rounding_issue_count integer := 0;
  v_unlinked_movement_count integer := 0;
  v_unlinked_journal_count integer := 0;
  v_ledger_balance numeric := 0;
  v_card_quantity numeric := 0;
  v_movement_quantity numeric := 0;
  v_movement_value numeric := 0;
  v_wac_value numeric := 0;
BEGIN
  PERFORM public.require_finance_api_access();

  IF v_section NOT IN ('summary', 'products', 'sources') THEN
    RAISE EXCEPTION 'INVALID_RECONCILIATION_SECTION'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'INVALID_RECONCILIATION_LIMIT'
      USING ERRCODE = '22023';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'INVALID_RECONCILIATION_OFFSET'
      USING ERRCODE = '22023';
  END IF;

  -- The fingerprint covers the content that can change a diagnosis. Its order
  -- is deterministic and it deliberately excludes the request timestamp.
  SELECT md5(jsonb_build_object(
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(
        p.id, p.code, p.name, p.is_active, p.quantity_on_hand,
        p.purchase_price, p.updated_at
      ) ORDER BY p.id)
      FROM public.products p
    ), '[]'::jsonb),
    'movements', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(
        m.id, m.product_id, m.movement_type, m.quantity, m.unit_cost,
        m.total_cost, m.movement_date, m.reference_type, m.reference_id
      ) ORDER BY m.id)
      FROM public.inventory_movements m
    ), '[]'::jsonb),
    'inventory_journals', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(
        je.id, je.status, je.entry_date, je.entry_type, je.updated_at,
        jel.id, jel.debit, jel.credit
      ) ORDER BY je.id, jel.id)
      FROM public.journal_entries je
      JOIN public.journal_entry_lines jel ON jel.journal_entry_id = je.id
      JOIN public.accounts a ON a.id = jel.account_id AND a.code = '1104'
    ), '[]'::jsonb),
    'documents', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_array(d.source_type, d.source_id, d.item)
        ORDER BY d.source_type, d.source_id
      )
      FROM (
        SELECT 'sales_invoice' AS source_type, si.id AS source_id,
          jsonb_build_array(si.status, si.journal_entry_id, si.invoice_date, si.invoice_number, si.posted_number) AS item
        FROM public.sales_invoices si
        UNION ALL
        SELECT 'purchase_invoice', pi.id,
          jsonb_build_array(pi.status, pi.journal_entry_id, pi.invoice_date, pi.invoice_number, pi.posted_number)
        FROM public.purchase_invoices pi
        UNION ALL
        SELECT 'sales_return', sr.id,
          jsonb_build_array(sr.status, sr.journal_entry_id, sr.return_date, sr.return_number, sr.posted_number)
        FROM public.sales_returns sr
        UNION ALL
        SELECT 'purchase_return', pr.id,
          jsonb_build_array(pr.status, pr.journal_entry_id, pr.return_date, pr.return_number, pr.posted_number)
        FROM public.purchase_returns pr
        UNION ALL
        SELECT 'adjustment', ia.id,
          jsonb_build_array(ia.status, ia.journal_entry_id, ia.adjustment_date, ia.adjustment_number, NULL)
        FROM public.inventory_adjustments ia
      ) d
    ), '[]'::jsonb),
    'reversals', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(
        al.table_name, al.record_id, al.new_data->>'reversal_journal_entry_id', al.created_at
      ) ORDER BY al.id)
      FROM public.audit_log al
      WHERE al.new_data ? 'reversal_journal_entry_id'
    ), '[]'::jsonb)
  )::text)
  INTO v_fingerprint;

  IF p_expected_fingerprint IS NOT NULL
     AND p_expected_fingerprint IS DISTINCT FROM v_fingerprint THEN
    RAISE EXCEPTION 'RECONCILIATION_SNAPSHOT_STALE'
      USING ERRCODE = '40001';
  END IF;

  -- Product axis: card quantity versus signed movement quantity. Movement book
  -- value and WAC are returned separately and are never substituted for GL.
  WITH movement_state AS (
    SELECT
      m.product_id,
      sum(public.inventory_signed_quantity(m.movement_type::text, m.quantity)) AS movement_quantity,
      sum(CASE
        WHEN m.movement_type::text = 'adjustment'
          THEN sign(COALESCE(m.quantity, 0)) * abs(COALESCE(m.total_cost, 0))
        WHEN m.movement_type::text IN ('sale', 'purchase_return')
          THEN -abs(COALESCE(m.total_cost, 0))
        ELSE abs(COALESCE(m.total_cost, 0))
      END) AS movement_book_value,
      sum(CASE WHEN m.movement_type::text IN ('purchase', 'opening_balance')
        THEN abs(COALESCE(m.quantity, 0)) ELSE 0 END) AS purchased_quantity,
      sum(CASE WHEN m.movement_type::text IN ('purchase', 'opening_balance')
        THEN abs(COALESCE(m.total_cost, 0)) ELSE 0 END) AS purchased_value,
      max(m.movement_date) AS last_movement_date,
      count(*) AS movement_count,
      count(*) FILTER (WHERE
        m.reference_id IS NULL
        OR COALESCE(m.reference_type, '') NOT IN (
          'sales_invoice', 'purchase_invoice', 'sales_return', 'purchase_return',
          'adjustment', 'inventory_adjustment', 'staging_seed'
        )
        OR (m.reference_type = 'sales_invoice' AND NOT EXISTS (
          SELECT 1 FROM public.sales_invoices si WHERE si.id = m.reference_id
        ))
        OR (m.reference_type = 'purchase_invoice' AND NOT EXISTS (
          SELECT 1 FROM public.purchase_invoices pi WHERE pi.id = m.reference_id
        ))
        OR (m.reference_type = 'sales_return' AND NOT EXISTS (
          SELECT 1 FROM public.sales_returns sr WHERE sr.id = m.reference_id
        ))
        OR (m.reference_type = 'purchase_return' AND NOT EXISTS (
          SELECT 1 FROM public.purchase_returns pr WHERE pr.id = m.reference_id
        ))
        OR (m.reference_type IN ('adjustment', 'inventory_adjustment') AND NOT EXISTS (
          SELECT 1 FROM public.inventory_adjustments ia WHERE ia.id = m.reference_id
        ))
        OR (m.reference_type = 'staging_seed' AND NOT EXISTS (
          SELECT 1 FROM public.journal_entries je WHERE je.id = m.reference_id
        ))
      ) AS unresolved_reference_count
    FROM public.inventory_movements m
    GROUP BY m.product_id
  ), product_base AS (
    SELECT
      p.id AS product_id,
      p.code,
      p.name,
      p.is_active,
      COALESCE(p.quantity_on_hand, 0)::numeric AS card_quantity,
      COALESCE(ms.movement_quantity, 0)::numeric AS movement_quantity,
      (COALESCE(p.quantity_on_hand, 0) - COALESCE(ms.movement_quantity, 0))::numeric AS quantity_difference,
      COALESCE(ms.movement_book_value, 0)::numeric AS movement_book_value,
      CASE WHEN COALESCE(ms.movement_quantity, 0) <> 0
        THEN round(ms.movement_book_value / ms.movement_quantity, 6)
        ELSE NULL::numeric END AS book_unit_cost,
      CASE WHEN COALESCE(ms.purchased_quantity, 0) > 0
        THEN round(ms.purchased_value / ms.purchased_quantity, 6)
        ELSE COALESCE(p.purchase_price, 0)::numeric END AS wac,
      ms.last_movement_date,
      COALESCE(ms.movement_count, 0)::integer AS movement_count,
      COALESCE(ms.unresolved_reference_count, 0)::integer AS unresolved_reference_count
    FROM public.products p
    LEFT JOIN movement_state ms ON ms.product_id = p.id
    WHERE COALESCE(p.quantity_on_hand, 0) <> 0
       OR COALESCE(ms.movement_quantity, 0) <> 0
       OR COALESCE(ms.movement_book_value, 0) <> 0
  ), product_enriched AS (
    SELECT
      pb.*,
      round(pb.movement_quantity * pb.wac, 2) AS wac_valuation,
      jsonb_strip_nulls(jsonb_build_object(
        'card_without_movements', CASE WHEN pb.card_quantity <> 0 AND pb.movement_quantity = 0 THEN true END,
        'movements_not_applied_to_card', CASE WHEN pb.card_quantity = 0 AND pb.movement_quantity <> 0 THEN true END,
        'card_movement_quantity_mismatch', CASE WHEN pb.quantity_difference <> 0
          AND NOT (pb.card_quantity <> 0 AND pb.movement_quantity = 0)
          AND NOT (pb.card_quantity = 0 AND pb.movement_quantity <> 0) THEN true END,
        'zero_quantity_nonzero_value', CASE WHEN pb.movement_quantity = 0 AND pb.movement_book_value <> 0 THEN true END,
        'nonzero_quantity_zero_value', CASE WHEN pb.movement_quantity <> 0 AND pb.movement_book_value = 0 THEN true END,
        'negative_book_unit_cost', CASE WHEN pb.book_unit_cost < 0 THEN true END,
        'unresolved_source_reference', CASE WHEN pb.unresolved_reference_count > 0 THEN true END
      )) AS reason_map
    FROM product_base pb
  ), product_rows AS (
    SELECT jsonb_build_object(
      'product_id', pe.product_id,
      'code', pe.code,
      'name', pe.name,
      'is_active', pe.is_active,
      'card_quantity', pe.card_quantity,
      'movement_quantity', pe.movement_quantity,
      'quantity_difference', pe.quantity_difference,
      'movement_book_value', round(pe.movement_book_value, 2),
      'book_unit_cost', pe.book_unit_cost,
      'wac', pe.wac,
      'wac_valuation', pe.wac_valuation,
      'wac_to_movement_difference', round(pe.wac_valuation - pe.movement_book_value, 2),
      'last_movement_date', pe.last_movement_date,
      'movement_count', pe.movement_count,
      'classification', CASE
        WHEN pe.quantity_difference <> 0 THEN 'product_balance'
        WHEN pe.reason_map <> '{}'::jsonb THEN 'undocumented_effect'
        ELSE 'matched' END,
      'reason_codes', COALESCE((
        SELECT jsonb_agg(key ORDER BY key)
        FROM jsonb_each(pe.reason_map)
      ), '[]'::jsonb),
      'can_prepare_repair', CASE
        WHEN pe.movement_quantity = 0 AND pe.movement_book_value <> 0 THEN false
        WHEN pe.movement_quantity <> 0 AND pe.movement_book_value = 0 THEN false
        WHEN pe.book_unit_cost < 0 THEN false
        WHEN pe.unresolved_reference_count > 0 THEN false
        ELSE true END
    ) AS row_data
    FROM product_enriched pe
  )
  SELECT COALESCE(jsonb_agg(pr.row_data ORDER BY pr.row_data->>'code', pr.row_data->>'product_id'), '[]'::jsonb)
  INTO v_products
  FROM product_rows pr;

  -- Source axis: only explicit document, staging-seed and audited reversal
  -- links are accepted. Unresolved movements and journals remain individual.
  WITH journal_1104 AS (
    SELECT
      je.id,
      je.status,
      je.entry_date,
      COALESCE(je.entry_type, 'regular') AS entry_type,
      count(jel.id) > 0 AS has_1104_line,
      CASE WHEN je.status = 'posted'
        THEN COALESCE(sum(jel.debit - jel.credit), 0)
        ELSE 0::numeric END AS ledger_value
    FROM public.journal_entries je
    LEFT JOIN public.journal_entry_lines jel ON jel.journal_entry_id = je.id
      AND jel.account_id = (SELECT a.id FROM public.accounts a WHERE a.code = '1104' LIMIT 1)
    GROUP BY je.id, je.status, je.entry_date, je.entry_type
  ), reversal_links AS (
    SELECT DISTINCT ON (x.source_type, x.source_id)
      x.source_type, x.source_id, x.reversal_journal_entry_id
    FROM (
      SELECT
        CASE al.table_name
          WHEN 'sales_invoices' THEN 'sales_invoice'
          WHEN 'purchase_invoices' THEN 'purchase_invoice'
          WHEN 'sales_returns' THEN 'sales_return'
          WHEN 'purchase_returns' THEN 'purchase_return'
          WHEN 'inventory_adjustments' THEN 'adjustment'
        END AS source_type,
        CASE WHEN al.record_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN al.record_id::uuid END AS source_id,
        CASE WHEN COALESCE(al.new_data->>'reversal_journal_entry_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (al.new_data->>'reversal_journal_entry_id')::uuid END AS reversal_journal_entry_id,
        al.created_at,
        al.id
      FROM public.audit_log al
      WHERE al.table_name IN (
        'sales_invoices', 'purchase_invoices', 'sales_returns',
        'purchase_returns', 'inventory_adjustments'
      )
        AND al.new_data ? 'reversal_journal_entry_id'
    ) x
    WHERE x.source_type IS NOT NULL
      AND x.source_id IS NOT NULL
      AND x.reversal_journal_entry_id IS NOT NULL
    ORDER BY x.source_type, x.source_id, x.created_at DESC, x.id DESC
  ), documents AS (
    SELECT 'sales_invoice'::text AS source_type, si.id AS source_id,
      COALESCE(si.posted_number, si.invoice_number)::text AS source_number,
      si.status AS source_status, si.invoice_date AS source_date, si.journal_entry_id
    FROM public.sales_invoices si
    UNION ALL
    SELECT 'purchase_invoice', pi.id,
      COALESCE(pi.posted_number, pi.invoice_number)::text,
      pi.status, pi.invoice_date, pi.journal_entry_id
    FROM public.purchase_invoices pi
    UNION ALL
    SELECT 'sales_return', sr.id,
      COALESCE(sr.posted_number, sr.return_number)::text,
      sr.status, sr.return_date, sr.journal_entry_id
    FROM public.sales_returns sr
    UNION ALL
    SELECT 'purchase_return', pr.id,
      COALESCE(pr.posted_number, pr.return_number)::text,
      pr.status, pr.return_date, pr.journal_entry_id
    FROM public.purchase_returns pr
    UNION ALL
    SELECT 'adjustment', ia.id, ia.adjustment_number::text,
      ia.status, ia.adjustment_date, ia.journal_entry_id
    FROM public.inventory_adjustments ia
  ), movement_group AS (
    SELECT
      CASE WHEN m.reference_type = 'inventory_adjustment' THEN 'adjustment'
        ELSE m.reference_type END AS source_type,
      m.reference_id AS source_id,
      count(*)::integer AS movement_count,
      sum(public.inventory_signed_quantity(m.movement_type::text, m.quantity)) AS movement_quantity,
      sum(CASE
        WHEN m.movement_type::text = 'adjustment'
          THEN sign(COALESCE(m.quantity, 0)) * abs(COALESCE(m.total_cost, 0))
        WHEN m.movement_type::text IN ('sale', 'purchase_return')
          THEN -abs(COALESCE(m.total_cost, 0))
        ELSE abs(COALESCE(m.total_cost, 0)) END) AS movement_book_value
    FROM public.inventory_movements m
    WHERE m.reference_id IS NOT NULL
    GROUP BY CASE WHEN m.reference_type = 'inventory_adjustment' THEN 'adjustment'
      ELSE m.reference_type END, m.reference_id
  ), known_raw AS (
    SELECT
      d.source_type || ':' || d.source_id::text AS source_key,
      d.source_type, d.source_id, d.source_number, d.source_status, d.source_date,
      d.journal_entry_id,
      rl.reversal_journal_entry_id,
      COALESCE(mg.movement_count, 0) AS movement_count,
      COALESCE(mg.movement_quantity, 0)::numeric AS movement_quantity,
      COALESCE(mg.movement_book_value, 0)::numeric AS movement_book_value,
      COALESCE(jo.ledger_value, 0) + COALESCE(jr.ledger_value, 0) AS ledger_1104_value,
      jo.status AS journal_status,
      COALESCE(jo.has_1104_line, false) AS has_1104_line,
      jr.status AS reversal_status,
      CASE WHEN d.source_status = 'cancelled' THEN true ELSE false END AS is_cancelled
    FROM documents d
    LEFT JOIN movement_group mg
      ON mg.source_type = d.source_type AND mg.source_id = d.source_id
    LEFT JOIN reversal_links rl
      ON rl.source_type = d.source_type AND rl.source_id = d.source_id
    LEFT JOIN journal_1104 jo ON jo.id = d.journal_entry_id
    LEFT JOIN journal_1104 jr ON jr.id = rl.reversal_journal_entry_id
    WHERE COALESCE(mg.movement_count, 0) > 0
       OR COALESCE(jo.ledger_value, 0) <> 0
       OR COALESCE(jr.ledger_value, 0) <> 0
       OR (d.source_status = 'cancelled' AND d.journal_entry_id IS NOT NULL)
  ), staging_raw AS (
    SELECT
      'staging_seed:' || mg.source_id::text AS source_key,
      'staging_seed'::text AS source_type,
      mg.source_id,
      NULL::text AS source_number,
      j.status AS source_status,
      j.entry_date AS source_date,
      j.id AS journal_entry_id,
      NULL::uuid AS reversal_journal_entry_id,
      mg.movement_count, mg.movement_quantity, mg.movement_book_value,
      COALESCE(j.ledger_value, 0) AS ledger_1104_value,
      j.status AS journal_status,
      COALESCE(j.has_1104_line, false) AS has_1104_line,
      NULL::text AS reversal_status,
      false AS is_cancelled
    FROM movement_group mg
    LEFT JOIN journal_1104 j ON j.id = mg.source_id
    WHERE mg.source_type = 'staging_seed'
  ), explicit_raw AS (
    SELECT * FROM known_raw
    UNION ALL
    SELECT * FROM staging_raw
  ), explicit_classified AS (
    SELECT
      er.*,
      round(er.ledger_1104_value - er.movement_book_value, 2) AS source_difference,
      CASE
        WHEN er.is_cancelled AND er.reversal_journal_entry_id IS NOT NULL
          AND er.movement_count = 0 AND round(er.ledger_1104_value, 2) = 0 THEN 'matched'
        WHEN er.is_cancelled THEN 'undocumented_effect'
        WHEN er.movement_book_value <> 0 AND er.journal_entry_id IS NULL THEN 'movement_without_journal'
        WHEN er.journal_entry_id IS NOT NULL AND er.journal_status IS DISTINCT FROM 'posted' THEN 'movement_without_journal'
        WHEN er.movement_book_value <> 0 AND NOT er.has_1104_line THEN 'movement_without_journal'
        WHEN er.movement_count = 0 AND er.ledger_1104_value <> 0 THEN 'journal_without_movement'
        WHEN round(er.ledger_1104_value - er.movement_book_value, 2) = 0 THEN 'matched'
        WHEN abs(round(er.ledger_1104_value - er.movement_book_value, 2)) <= 0.01 THEN 'rounding'
        ELSE 'undocumented_effect'
      END AS classification,
      jsonb_strip_nulls(jsonb_build_object(
        'cancelled_source_not_fully_reversed', CASE WHEN er.is_cancelled AND NOT (
          er.reversal_journal_entry_id IS NOT NULL AND er.movement_count = 0
          AND round(er.ledger_1104_value, 2) = 0) THEN true END,
        'missing_journal_entry', CASE WHEN NOT er.is_cancelled
          AND er.movement_book_value <> 0 AND er.journal_entry_id IS NULL THEN true END,
        'journal_not_posted', CASE WHEN NOT er.is_cancelled
          AND er.journal_entry_id IS NOT NULL AND er.journal_status IS DISTINCT FROM 'posted' THEN true END,
        'missing_1104_line', CASE WHEN NOT er.is_cancelled
          AND er.movement_book_value <> 0 AND er.journal_entry_id IS NOT NULL
          AND er.journal_status = 'posted' AND NOT er.has_1104_line THEN true END,
        'posted_source_without_movements', CASE WHEN NOT er.is_cancelled
          AND er.movement_count = 0 AND er.ledger_1104_value <> 0 THEN true END,
        'traceable_rounding_residual', CASE WHEN NOT er.is_cancelled
          AND er.movement_count > 0 AND er.journal_status = 'posted' AND er.has_1104_line
          AND round(er.ledger_1104_value - er.movement_book_value, 2) <> 0
          AND abs(round(er.ledger_1104_value - er.movement_book_value, 2)) <= 0.01 THEN true END,
        'source_value_mismatch', CASE WHEN NOT er.is_cancelled
          AND er.movement_count > 0 AND er.journal_status = 'posted' AND er.has_1104_line
          AND abs(round(er.ledger_1104_value - er.movement_book_value, 2)) > 0.01 THEN true END
      )) AS reason_map
    FROM explicit_raw er
  ), unresolved_movements AS (
    SELECT
      'movement:' || m.id::text AS source_key,
      COALESCE(m.reference_type, m.movement_type::text) AS source_type,
      m.id AS source_id,
      NULL::text AS source_number,
      'unresolved'::text AS source_status,
      m.movement_date AS source_date,
      NULL::uuid AS journal_entry_id,
      NULL::uuid AS reversal_journal_entry_id,
      1 AS movement_count,
      public.inventory_signed_quantity(m.movement_type::text, m.quantity) AS movement_quantity,
      CASE
        WHEN m.movement_type::text = 'adjustment'
          THEN sign(COALESCE(m.quantity, 0)) * abs(COALESCE(m.total_cost, 0))
        WHEN m.movement_type::text IN ('sale', 'purchase_return')
          THEN -abs(COALESCE(m.total_cost, 0))
        ELSE abs(COALESCE(m.total_cost, 0)) END AS movement_book_value,
      0::numeric AS ledger_1104_value,
      (0 - CASE
        WHEN m.movement_type::text = 'adjustment'
          THEN sign(COALESCE(m.quantity, 0)) * abs(COALESCE(m.total_cost, 0))
        WHEN m.movement_type::text IN ('sale', 'purchase_return')
          THEN -abs(COALESCE(m.total_cost, 0))
        ELSE abs(COALESCE(m.total_cost, 0)) END)::numeric AS source_difference,
      'undocumented_effect'::text AS classification,
      jsonb_build_array(CASE
        WHEN m.reference_id IS NULL THEN 'missing_reference_id'
        WHEN COALESCE(m.reference_type, '') NOT IN (
          'sales_invoice', 'purchase_invoice', 'sales_return', 'purchase_return',
          'adjustment', 'inventory_adjustment', 'staging_seed'
        ) THEN 'unknown_reference_type'
        ELSE 'missing_source_document' END) AS reason_codes
    FROM public.inventory_movements m
    WHERE m.reference_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM documents d
         WHERE d.source_id = m.reference_id
           AND d.source_type = CASE WHEN m.reference_type = 'inventory_adjustment'
             THEN 'adjustment' ELSE m.reference_type END
       ) AND NOT (
         m.reference_type = 'staging_seed'
         AND EXISTS (SELECT 1 FROM journal_1104 j WHERE j.id = m.reference_id)
       )
  ), unresolved_journals AS (
    SELECT
      'journal:' || j.id::text AS source_key,
      'journal'::text AS source_type,
      j.id AS source_id,
      NULL::text AS source_number,
      j.status AS source_status,
      j.entry_date AS source_date,
      j.id AS journal_entry_id,
      NULL::uuid AS reversal_journal_entry_id,
      0 AS movement_count,
      0::numeric AS movement_quantity,
      0::numeric AS movement_book_value,
      j.ledger_value AS ledger_1104_value,
      j.ledger_value AS source_difference,
      'journal_without_movement'::text AS classification,
      jsonb_build_array(CASE WHEN j.entry_type = 'reversal'
        THEN 'unlinked_reversal' ELSE 'posted_source_without_movements' END) AS reason_codes
    FROM journal_1104 j
    WHERE j.status = 'posted'
      AND j.ledger_value <> 0
      AND NOT EXISTS (
        SELECT 1 FROM documents d
        LEFT JOIN reversal_links rl
          ON rl.source_type = d.source_type AND rl.source_id = d.source_id
        WHERE d.journal_entry_id = j.id OR rl.reversal_journal_entry_id = j.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.inventory_movements m
        WHERE m.reference_type = 'staging_seed' AND m.reference_id = j.id
      )
  ), source_rows AS (
    SELECT jsonb_build_object(
      'source_key', ec.source_key,
      'source_type', ec.source_type,
      'source_id', ec.source_id,
      'source_number', ec.source_number,
      'source_status', ec.source_status,
      'source_date', ec.source_date,
      'journal_entry_id', ec.journal_entry_id,
      'reversal_journal_entry_id', ec.reversal_journal_entry_id,
      'movement_count', ec.movement_count,
      'movement_quantity', ec.movement_quantity,
      'movement_book_value', round(ec.movement_book_value, 2),
      'ledger_1104_value', round(ec.ledger_1104_value, 2),
      'source_difference', ec.source_difference,
      'classification', ec.classification,
      'reason_codes', COALESCE((SELECT jsonb_agg(key ORDER BY key) FROM jsonb_each(ec.reason_map)), '[]'::jsonb),
      'is_rounding_only', ec.classification = 'rounding',
      'can_prepare_repair', ec.classification IN ('matched', 'rounding')
    ) AS row_data
    FROM explicit_classified ec
    UNION ALL
    SELECT jsonb_build_object(
      'source_key', um.source_key, 'source_type', um.source_type,
      'source_id', um.source_id, 'source_number', um.source_number,
      'source_status', um.source_status, 'source_date', um.source_date,
      'journal_entry_id', um.journal_entry_id,
      'reversal_journal_entry_id', um.reversal_journal_entry_id,
      'movement_count', um.movement_count, 'movement_quantity', um.movement_quantity,
      'movement_book_value', round(um.movement_book_value, 2),
      'ledger_1104_value', um.ledger_1104_value,
      'source_difference', round(um.source_difference, 2),
      'classification', um.classification, 'reason_codes', um.reason_codes,
      'is_rounding_only', false, 'can_prepare_repair', false
    ) FROM unresolved_movements um
    UNION ALL
    SELECT jsonb_build_object(
      'source_key', uj.source_key, 'source_type', uj.source_type,
      'source_id', uj.source_id, 'source_number', uj.source_number,
      'source_status', uj.source_status, 'source_date', uj.source_date,
      'journal_entry_id', uj.journal_entry_id,
      'reversal_journal_entry_id', uj.reversal_journal_entry_id,
      'movement_count', uj.movement_count, 'movement_quantity', uj.movement_quantity,
      'movement_book_value', uj.movement_book_value,
      'ledger_1104_value', round(uj.ledger_1104_value, 2),
      'source_difference', round(uj.source_difference, 2),
      'classification', uj.classification, 'reason_codes', uj.reason_codes,
      'is_rounding_only', false, 'can_prepare_repair', false
    ) FROM unresolved_journals uj
  )
  SELECT COALESCE(jsonb_agg(sr.row_data ORDER BY sr.row_data->>'source_key'), '[]'::jsonb)
  INTO v_sources
  FROM source_rows sr;

  SELECT COALESCE(sum((x->>'card_quantity')::numeric), 0),
         COALESCE(sum((x->>'movement_quantity')::numeric), 0),
         COALESCE(sum((x->>'movement_book_value')::numeric), 0),
         COALESCE(sum((x->>'wac_valuation')::numeric), 0),
         count(*) FILTER (WHERE x->>'classification' <> 'matched')
  INTO v_card_quantity, v_movement_quantity, v_movement_value,
       v_wac_value, v_product_issue_count
  FROM jsonb_array_elements(v_products) x;

  SELECT COALESCE(sum(jel.debit - jel.credit), 0)
  INTO v_ledger_balance
  FROM public.journal_entries je
  JOIN public.journal_entry_lines jel ON jel.journal_entry_id = je.id
  JOIN public.accounts a ON a.id = jel.account_id AND a.code = '1104'
  WHERE je.status = 'posted';

  SELECT
    count(*) FILTER (WHERE x->>'classification' <> 'matched'),
    count(*) FILTER (WHERE x->>'classification' = 'rounding'),
    count(*) FILTER (WHERE x->>'source_key' LIKE 'movement:%'),
    count(*) FILTER (WHERE x->>'source_key' LIKE 'journal:%')
  INTO v_source_issue_count, v_rounding_issue_count,
       v_unlinked_movement_count, v_unlinked_journal_count
  FROM jsonb_array_elements(v_sources) x;

  v_status := CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.accounts WHERE code = '1104') THEN 'unavailable'
    WHEN v_product_issue_count = 0 AND v_source_issue_count = 0 THEN 'matched'
    WHEN v_product_issue_count = 0 AND v_source_issue_count = v_rounding_issue_count THEN 'rounding_only'
    ELSE 'mismatch'
  END;

  v_totals := jsonb_build_object(
    'card_quantity', v_card_quantity,
    'movement_quantity', v_movement_quantity,
    'quantity_difference', v_card_quantity - v_movement_quantity,
    'movement_book_value', round(v_movement_value, 2),
    'wac_valuation', round(v_wac_value, 2),
    'ledger_1104_balance', round(v_ledger_balance, 2),
    'movement_to_ledger_difference', round(v_ledger_balance - v_movement_value, 2),
    'wac_to_movement_difference', round(v_wac_value - v_movement_value, 2),
    'wac_to_ledger_difference', round(v_ledger_balance - v_wac_value, 2),
    'product_issue_count', v_product_issue_count,
    'source_issue_count', v_source_issue_count,
    'rounding_issue_count', v_rounding_issue_count,
    'unlinked_movement_count', v_unlinked_movement_count,
    'unlinked_journal_count', v_unlinked_journal_count
  );
  v_issue_counts := jsonb_build_object(
    'products', v_product_issue_count,
    'sources', v_source_issue_count,
    'rounding', v_rounding_issue_count,
    'unlinked_movements', v_unlinked_movement_count,
    'unlinked_journals', v_unlinked_journal_count
  );

  IF v_section = 'products' THEN
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'code', x->>'product_id'), '[]'::jsonb)
    INTO v_filtered
    FROM jsonb_array_elements(v_products) x
    WHERE (NOT p_only_issues OR x->>'classification' <> 'matched')
      AND (v_search IS NULL OR lower(COALESCE(x->>'code', '') || ' ' || COALESCE(x->>'name', ''))
        LIKE '%' || lower(v_search) || '%');
  ELSIF v_section = 'sources' THEN
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'source_key'), '[]'::jsonb)
    INTO v_filtered
    FROM jsonb_array_elements(v_sources) x
    WHERE (NOT p_only_issues OR x->>'classification' <> 'matched')
      AND (v_search IS NULL OR lower(
        COALESCE(x->>'source_key', '') || ' ' || COALESCE(x->>'source_type', '') || ' ' ||
        COALESCE(x->>'source_number', '')
      ) LIKE '%' || lower(v_search) || '%');
  ELSE
    v_filtered := '[]'::jsonb;
  END IF;

  v_total_count := jsonb_array_length(v_filtered);
  IF v_section <> 'summary' THEN
    SELECT COALESCE(jsonb_agg(value ORDER BY ordinality), '[]'::jsonb)
    INTO v_rows
    FROM jsonb_array_elements(v_filtered) WITH ORDINALITY AS page(value, ordinality)
    WHERE ordinality > p_offset
      AND ordinality <= p_offset + p_limit;
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'snapshot_at', statement_timestamp(),
    'source_scope', 'all_recorded_stock_effects',
    'fingerprint', v_fingerprint,
    'status', v_status,
    'totals', v_totals,
    'issue_counts', v_issue_counts,
    'page', jsonb_build_object(
      'section', v_section,
      'limit', p_limit,
      'offset', p_offset,
      'total_count', v_total_count
    ),
    'rows', v_rows
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_inventory_reconciliation_diagnostic(text, boolean, text, integer, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_reconciliation_diagnostic(text, boolean, text, integer, integer, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_inventory_reconciliation_diagnostic(text, boolean, text, integer, integer, text)
  IS 'Read-only current-state inventory reconciliation by product and explicit source; never performs repairs.';
