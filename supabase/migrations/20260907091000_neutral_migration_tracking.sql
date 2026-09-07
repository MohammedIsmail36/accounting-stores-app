-- Move the self-hosted deployment runner to a neutral migration-history name.
--
-- The legacy name is retained temporarily as a read/write compatibility view so
-- the previously deployed scripts remain usable during the rollback window.
-- A later, separately approved migration may remove that view after every
-- deployment checkout has moved to public.app_schema_migrations.
DO $migration_tracking$
DECLARE
  neutral_kind "char";
  legacy_kind "char";
BEGIN
  SELECT c.relkind
    INTO neutral_kind
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'app_schema_migrations';

  SELECT c.relkind
    INTO legacy_kind
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'lovable_schema_migrations';

  IF neutral_kind IS NULL THEN
    IF legacy_kind IN ('r', 'p') THEN
      ALTER TABLE public.lovable_schema_migrations
        RENAME TO app_schema_migrations;

      IF to_regclass('public.lovable_schema_migrations_pkey') IS NOT NULL
         AND to_regclass('public.app_schema_migrations_pkey') IS NULL THEN
        ALTER INDEX public.lovable_schema_migrations_pkey
          RENAME TO app_schema_migrations_pkey;
      END IF;
    ELSIF legacy_kind IS NULL THEN
      CREATE TABLE public.app_schema_migrations (
        version text PRIMARY KEY,
        filename text NOT NULL,
        checksum text NOT NULL,
        executed_at timestamptz NOT NULL DEFAULT now()
      );
    ELSE
      RAISE EXCEPTION
        'Cannot initialize app_schema_migrations: the legacy relation has unsupported kind %',
        legacy_kind;
    END IF;
  ELSIF neutral_kind NOT IN ('r', 'p') THEN
    RAISE EXCEPTION
      'public.app_schema_migrations exists but is not a table';
  ELSIF legacy_kind IN ('r', 'p') THEN
    RAISE EXCEPTION
      'Both legacy and neutral migration-history tables exist; reconcile them manually';
  END IF;

  SELECT c.relkind
    INTO legacy_kind
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'lovable_schema_migrations';

  IF legacy_kind IS NULL THEN
    CREATE VIEW public.lovable_schema_migrations AS
      SELECT version, filename, checksum, executed_at
        FROM public.app_schema_migrations;
  ELSIF legacy_kind <> 'v' THEN
    RAISE EXCEPTION
      'The legacy migration-history relation is not a compatibility view';
  ELSIF position(
    'app_schema_migrations'
    IN pg_get_viewdef('public.lovable_schema_migrations'::regclass, true)
  ) = 0 THEN
    RAISE EXCEPTION
      'The legacy migration-history view does not target app_schema_migrations';
  END IF;
END
$migration_tracking$;
