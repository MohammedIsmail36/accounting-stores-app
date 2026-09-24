BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT jsonb_build_object(
  'database', current_database(),
  'version', current_setting('server_version'),
  'migrations', (SELECT coalesce(jsonb_agg(version ORDER BY version), '[]'::jsonb)
    FROM supabase_migrations.schema_migrations
    WHERE version IN ('20260924100000','20260924101000','20260924102000','20260924103000','20260924104000')),
  'operations_table', to_regclass('public.inventory_variance_operations') IS NOT NULL,
  'operation_lines_table', to_regclass('public.inventory_variance_operation_lines') IS NOT NULL,
  'operation_count', (SELECT count(*) FROM public.inventory_variance_operations),
  'post_function', to_regprocedure('public.post_inventory_adjustment_atomic(uuid,uuid)') IS NOT NULL,
  'reverse_function', to_regprocedure('public.reverse_inventory_adjustment_atomic(uuid,uuid,text)') IS NOT NULL,
  'post_security_definer', (SELECT prosecdef FROM pg_proc
    WHERE oid=to_regprocedure('public.post_inventory_adjustment_atomic(uuid,uuid)')),
  'reverse_security_definer', (SELECT prosecdef FROM pg_proc
    WHERE oid=to_regprocedure('public.reverse_inventory_adjustment_atomic(uuid,uuid,text)')),
  'authenticated_post_execute', has_function_privilege('authenticated',
    'public.post_inventory_adjustment_atomic(uuid,uuid)', 'EXECUTE'),
  'authenticated_reverse_execute', has_function_privilege('authenticated',
    'public.reverse_inventory_adjustment_atomic(uuid,uuid,text)', 'EXECUTE'),
  'anon_post_execute', has_function_privilege('anon',
    'public.post_inventory_adjustment_atomic(uuid,uuid)', 'EXECUTE'),
  'anon_reverse_execute', has_function_privilege('anon',
    'public.reverse_inventory_adjustment_atomic(uuid,uuid,text)', 'EXECUTE'),
  'authenticated_internal_execute', has_function_privilege('authenticated',
    'public.apply_inventory_variance_effects_internal(uuid,text,uuid,date,jsonb,jsonb,text,uuid)', 'EXECUTE'),
  'authenticated_old_quantity_execute', has_function_privilege('authenticated',
    'public.adjust_product_quantity(uuid,numeric)', 'EXECUTE'),
  'zero_balance_guard', EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.inventory_movements'::regclass
      AND tgname='trg_guard_variance_zero_balance' AND tgenabled='O' AND NOT tgisinternal),
  'header_write_guard', EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.inventory_adjustments'::regclass
      AND tgname='trg_guard_inventory_adjustment_document' AND tgenabled='O' AND NOT tgisinternal),
  'item_write_guard', EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.inventory_adjustment_items'::regclass
      AND tgname='trg_guard_inventory_adjustment_item' AND tgenabled='O' AND NOT tgisinternal),
  'movement_write_guard', EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.inventory_movements'::regclass
      AND tgname='trg_guard_inventory_adjustment_movement' AND tgenabled='O' AND NOT tgisinternal)
) AS atomic_schema_state;
ROLLBACK;
