BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'migration_versions', (SELECT coalesce(jsonb_agg(version ORDER BY version), '[]'::jsonb)
    FROM supabase_migrations.schema_migrations
    WHERE version IN ('20260924100000','20260924101000','20260924102000','20260924103000','20260924104000')),
  'engine_exists', to_regclass('public.inventory_variance_operations') IS NOT NULL,
  'counts', jsonb_build_object(
    'adjustments', (SELECT count(*) FROM public.inventory_adjustments),
    'adjustment_items', (SELECT count(*) FROM public.inventory_adjustment_items),
    'movements', (SELECT count(*) FROM public.inventory_movements),
    'products', (SELECT count(*) FROM public.products),
    'journals', (SELECT count(*) FROM public.journal_entries),
    'journal_lines', (SELECT count(*) FROM public.journal_entry_lines)
  ),
  'signatures', jsonb_build_object(
    'adjustments', (SELECT md5(coalesce(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_adjustments x),
    'adjustment_items', (SELECT md5(coalesce(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.inventory_adjustment_items x),
    'movements', (SELECT md5(coalesce(string_agg((to_jsonb(x) - 'variance_operation_id')::text, '|' ORDER BY x.id), '')) FROM public.inventory_movements x),
    'products', (SELECT md5(coalesce(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.products x),
    'journals', (SELECT md5(coalesce(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.journal_entries x),
    'journal_lines', (SELECT md5(coalesce(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) FROM public.journal_entry_lines x)
  ),
  'diagnostic', public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)
) AS inventory_atomic_baseline;
ROLLBACK;
