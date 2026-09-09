// One frozen L3 snapshot, one disposable container. Never connects to a hosted DB.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const container = '854444943e9790aab117a5e4639e8b23e448441673d45340b259abd9ba532a22';
export const database = 'l3_public_restore';
export const backup = '/backups/staging/l3-before-tracking-20260909-093540';
const files = {
  'public-schema.sql': '6ddcae21151b94852b8be20380492a5f59e62e11760bde42e06ede045c96817a',
  'public-data.sql': '5db02fcde72325d77576d897057ac0f06f643e7bc160d6ac2c19641126708d6d',
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
const ident = (value) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Unsupported SQL identifier');
  return `"${value}"`;
};
const literal = (value) => `'${value.replaceAll("'", "''")}'`;

export function parseCopy(text) {
  const tables = [];
  let current;
  for (const line of text.split('\n')) {
    if (current) {
      if (line === '\\.') { tables.push(current); current = undefined; }
      else {
        if (line.split('\t').length !== current.columns.length) throw new Error('Invalid COPY row');
        current.rows.push(line);
      }
    } else if (line.startsWith('COPY ')) {
      const match = /^COPY (?:"public"\."([a-z_][a-z0-9_]*)"|public\.([a-z_][a-z0-9_]*)) \(([^)]+)\) FROM stdin;$/.exec(line);
      if (!match) throw new Error('Unsupported COPY statement');
      const name = match[1] ?? match[2];
      const columns = match[3].split(',').map((s) => s.trim().replace(/^"([a-z_][a-z0-9_]*)"$/, '$1'));
      columns.forEach(ident);
      if (tables.some((t) => t.name === name)) throw new Error('Duplicate COPY table');
      current = { name, columns, rows: [] };
    }
  }
  if (current || !tables.length) throw new Error('Incomplete COPY data');
  return tables;
}

// PostgreSQL 17 COPY text, same column order and UTC settings; ignore row order only.
export function rowDigest(rows) {
  return digest(JSON.stringify([...rows].sort()));
}

// Match PostgreSQL numeric SUM without binary floating-point or display rounding.
export function sumExact(values) {
  const parts = values.filter((v) => v !== null).map((value) => {
    if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error('Unsupported snapshot numeric value');
    const [whole, fraction = ''] = value.split('.');
    return { value: BigInt(whole + fraction), scale: fraction.length };
  });
  if (!parts.length) return null;
  const scale = Math.max(...parts.map((p) => p.scale));
  const sum = parts.reduce((total, p) => total + p.value * 10n ** BigInt(scale - p.scale), 0n);
  const digits = (sum < 0n ? -sum : sum).toString().padStart(scale + 1, '0');
  const unsigned = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '') : digits;
  return (sum < 0n ? '-' : '') + unsigned;
}

export function financialBaseline(tables) {
  const rowsOf = (name) => {
    const table = tables.find((t) => t.name === name);
    if (!table) throw new Error(`Missing financial source table: ${name}`);
    return table.rows.map((line) => Object.fromEntries(line.split('\t').map((v, i) => [table.columns[i], v === '\\N' ? null : v])));
  };
  const sales = rowsOf('sales_invoices').filter((r) => r.status === 'posted');
  const purchases = rowsOf('purchase_invoices').filter((r) => r.status === 'posted');
  const movements = rowsOf('inventory_movements');
  return {
    posted_sales_count: String(sales.length), posted_sales_total: sumExact(sales.map((r) => r.total)),
    posted_purchases_count: String(purchases.length), posted_purchases_total: sumExact(purchases.map((r) => r.total)),
    inventory_quantity_sum: sumExact(movements.map((r) => r.quantity)),
    inventory_total_cost: sumExact(movements.map((r) => r.total_cost)),
  };
}

export function financialChecksSql(metrics) {
  const queries = {
    posted_sales_count: "SELECT count(*) FROM public.sales_invoices WHERE status='posted'",
    posted_sales_total: "SELECT sum(total) FROM public.sales_invoices WHERE status='posted'",
    posted_purchases_count: "SELECT count(*) FROM public.purchase_invoices WHERE status='posted'",
    posted_purchases_total: "SELECT sum(total) FROM public.purchase_invoices WHERE status='posted'",
    inventory_quantity_sum: 'SELECT sum(quantity) FROM public.inventory_movements',
    inventory_total_cost: 'SELECT sum(total_cost) FROM public.inventory_movements',
  };
  return Object.entries(queries).map(([name, query]) => {
    const value = metrics[name];
    if (value !== null && (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value))) {
      throw new Error(`Invalid financial baseline: ${name}`);
    }
    const expected = value === null ? 'NULL::numeric' : `${value}::numeric`;
    return `SELECT (${query}) INTO actual_amount;
  IF actual_amount IS DISTINCT FROM ${expected}
    THEN RAISE EXCEPTION 'Financial baseline mismatch (${name}): expected %, got %', ${expected}, actual_amount; END IF;`;
  }).join('\n  ');
}

export function assertIsolation(info) {
  if (info.Id !== container || info.Name !== '/accounting-l3-restore-20260909'
      || !info.State.Running || info.Config.User !== 'postgres'
      || info.Config.Labels?.['accounting.purpose'] !== 'l3-restore-test'
      || info.HostConfig.NetworkMode !== 'none' || !info.HostConfig.ReadonlyRootfs
      || info.HostConfig.Privileged || info.HostConfig.PidMode === 'host'
      || info.HostConfig.IpcMode === 'host'
      || (info.HostConfig.Binds ?? []).length || (info.HostConfig.VolumesFrom ?? []).length
      || (info.Mounts ?? []).some((m) => m.Type !== 'tmpfs' || m.Destination !== '/tmp')
      || Object.keys(info.HostConfig.PortBindings ?? {}).length
      || info.HostConfig.Memory !== 512 * 1024 * 1024
      || info.HostConfig.MemorySwap !== info.HostConfig.Memory
      || info.HostConfig.NanoCpus !== 500000000) {
    throw new Error('Container identity or isolation check failed; no restore attempted');
  }
}

export function validationSql(tables, sequences, metrics) {
  const counts = tables.map((t) => `(${literal(t.name)},${t.rows.length})`).join(',');
  return `
SET session_replication_role = origin;
SET search_path = public, pg_catalog;
-- The snapshot excludes auth: IDs below are dependency fixtures, NOT auth accounts.
DO $fixtures$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.conrelid::regclass AS tbl, a.attname AS col
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    WHERE c.contype='f' AND c.confrelid='auth.users'::regclass
  LOOP
    EXECUTE format('INSERT INTO auth.users(id) SELECT DISTINCT %I FROM %s WHERE %I IS NOT NULL ON CONFLICT DO NOTHING', r.col, r.tbl, r.col);
  END LOOP;
END $fixtures$;
-- VALIDATE alone would skip constraints already marked valid during replica COPY.
-- Recreate each FK, forcing PostgreSQL to check every restored row, including cycles.
DO $foreign_keys$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.conrelid::regclass AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c WHERE c.contype='f' AND c.connamespace='public'::regnamespace
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', r.tbl, r.conname, r.def);
  END LOOP;
END $foreign_keys$;
CREATE TEMP TABLE expected_counts(name text, n bigint);
INSERT INTO expected_counts VALUES ${counts};
DO $check$
DECLARE r record; actual bigint; n bigint; called boolean; actual_amount numeric;
BEGIN
  FOR r IN SELECT * FROM expected_counts LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.name) INTO actual;
    IF actual <> r.n THEN RAISE EXCEPTION 'Row count mismatch in %', r.name; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r') <> ${tables.length}
    THEN RAISE EXCEPTION 'Public table inventory mismatch'; END IF;
  SELECT count(*) INTO actual FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f';
  IF actual <> 60 THEN RAISE EXCEPTION 'Foreign key count mismatch: expected 60, got %', actual; END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f' AND NOT convalidated)
    THEN RAISE EXCEPTION 'Restored foreign key is not validated'; END IF;
  -- Preserve the ONE pre-existing NOT VALID CHECK in the frozen source. Do not
  -- silently validate it or accept other unvalidated constraints. Check its rows too.
  IF (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated) <> 1
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.journal_entries'::regclass
      AND conname='jentry_balanced' AND contype='c' AND NOT convalidated)
    THEN RAISE EXCEPTION 'Unvalidated CHECK inventory differs from frozen source'; END IF;
  IF EXISTS(SELECT 1 FROM public.journal_entries WHERE total_debit IS DISTINCT FROM total_credit)
    THEN RAISE EXCEPTION 'Exact journal balance check failed'; END IF;
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal) <> 37
    OR EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal AND t.tgenabled <> 'O')
    THEN RAISE EXCEPTION 'User trigger state mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
      WHERE c.relnamespace='public'::regnamespace AND (NOT i.indisvalid OR NOT i.indisready))
    THEN RAISE EXCEPTION 'Invalid index'; END IF;
  ${financialChecksSql(metrics)}
  IF (SELECT count(*) FROM journal_entries WHERE round(total_debit,2) <> round(total_credit,2)) <> 0
    OR (SELECT count(*) FROM journal_entries j WHERE status='posted'
      AND NOT EXISTS(SELECT 1 FROM journal_entry_lines l WHERE l.journal_entry_id=j.id)) <> 3
    THEN RAISE EXCEPTION 'Journal baseline mismatch'; END IF;
  ${sequences.map((s) => `SELECT last_value, is_called INTO n, called FROM ${s.name};
  IF n <> ${s.value} OR called <> ${s.called} THEN RAISE EXCEPTION 'Sequence state mismatch'; END IF;`).join('\n')}
END $check$;
`;
}

export function loadSnapshot() {
  const contents = Object.entries(files).map(([name, hash]) => {
    const bytes = readFileSync(join(backup, name));
    if (digest(bytes) !== hash) throw new Error(`Backup checksum mismatch: ${name}`);
    return bytes.toString('utf8');
  });
  const [schema, data] = contents;
  const tables = parseCopy(data);
  const schemaTables = [...schema.matchAll(/^CREATE TABLE IF NOT EXISTS "public"\."([a-z_][a-z0-9_]*)"/gm)].map((m) => m[1]).sort();
  if (JSON.stringify(schemaTables) !== JSON.stringify(tables.map((t) => t.name).sort())) throw new Error('Schema/COPY table mismatch');
  const sequences = [...data.matchAll(/^SELECT pg_catalog\.setval\('("public"\."[a-z_][a-z0-9_]*")', (\d+), (true|false)\);$/gm)]
    .map((m) => ({ name: m[1], value: m[2], called: m[3] }));
  if (sequences.length !== 9) throw new Error('Unexpected sequence inventory');
  const tracking = tables.filter((t) => t.name.endsWith('_schema_migrations')
    && ['version', 'filename', 'checksum'].every((c) => t.columns.includes(c)));
  if (tracking.length !== 1 || tracking[0].rows.length !== 96) throw new Error('Migration tracking baseline mismatch');
  const signature = createHash('md5').update(tracking[0].rows.map((line) => {
    const fields = line.split('\t');
    return ['version', 'filename', 'checksum'].map((c) => fields[tracking[0].columns.indexOf(c)]).join('\x1f');
  }).sort().join('\x1e')).digest('hex');
  if (signature !== '634e981f2f7363bcdc1b546a1e9c37c0') throw new Error('Migration tracking signature mismatch');
  return { schema, data, tables, sequences, financial: financialBaseline(tables) };
}

export function databaseAction(mode, exists) {
  if (mode === '--restore' && !exists) return 'create';
  if (mode === '--resume-empty' && exists) return 'verify-empty';
  throw new Error(exists
    ? 'Test database already exists; refusing overwrite (use --resume-empty only after diagnosis)'
    : 'No existing test database to resume');
}

export function bootstrapSql() {
  return `
-- Verify the failed transaction rolled back BEFORE adding anything. No DROP/TRUNCATE.
DO $empty_guard$
BEGIN
  IF current_database() <> ${literal(database)}
    OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) <> 'postgres'
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace)
    OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace)
    OR EXISTS (SELECT 1 FROM pg_type WHERE typnamespace='public'::regnamespace)
    OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_'
      AND nspname NOT IN ('public','information_schema'))
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'))
    OR EXISTS (SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql')
    OR EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
      AND pid <> pg_backend_pid() AND backend_type='client backend')
  THEN RAISE EXCEPTION 'Test database is not pristine; refusing restore without deleting anything';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pg_trgm')
  THEN RAISE EXCEPTION 'pg_trgm is unavailable in the isolated image'; END IF;
END $empty_guard$;
-- pg_dump --schema public omitted extension creation, but seven indexes require it here.
CREATE EXTENSION pg_trgm WITH SCHEMA public;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS 'SELECT NULL::text';
`;
}

function main() {
  const mode = process.argv[2];
  if (!['--check', '--restore', '--resume-empty'].includes(mode) || process.argv.length !== 3) {
    throw new Error('Use --check, --restore or --resume-empty');
  }
  const snapshot = loadSnapshot();
  // Build validation even in read-only mode, to detect unsupported snapshot syntax.
  const checks = validationSql(snapshot.tables, snapshot.sequences, snapshot.financial);
  if (mode === '--check') {
    console.log(`SNAPSHOT_CHECK_OK tables=${snapshot.tables.length} sequences=${snapshot.sequences.length} tracking_rows=96`);
    console.log(`EXACT_FINANCIAL_BASELINE ${JSON.stringify(snapshot.financial)}`);
    return;
  }
  const reportDir = mkdtempSync('/tmp/accounting-l3-restore-report-');
  const logPath = join(reportDir, 'run.log');
  const logs = [];
  const run = (args, input) => {
    const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0 || result.error) {
      // Never print SQL rows, auth identifiers, or possible tokens from public data.
      logs.push(result.stderr ?? '', result.error?.message ?? '');
      writeFileSync(logPath, logs.join('\n'), { mode: 0o600 });
      throw new Error(`Docker/PostgreSQL step failed. Protected diagnostic: ${logPath}`);
    }
    return result.stdout;
  };
  const info = JSON.parse(run(['inspect', container]))[0];
  assertIsolation(info);
  const psql = (db, sql) => run(['exec', '-i', container, 'psql', '-h', '/tmp', '-U', 'postgres', '-d', db,
    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], sql);
  const version = psql('postgres', "SHOW server_version_num;").trim();
  if (!/^17\d{4}$/.test(version)) throw new Error('PostgreSQL 17 required');
  const exists = psql('postgres', `SELECT count(*) FROM pg_database WHERE datname=${literal(database)};`).trim() === '1';
  if (databaseAction(mode, exists) === 'create') {
    run(['exec', container, 'createdb', '-h', '/tmp', '-U', 'postgres', '-T', 'template0', database]);
  }
  console.log('ISOLATION_OK; verifying empty test database before transactional restore...');
  const sql = `\\set VERBOSITY terse
BEGIN;
${bootstrapSql()}
${snapshot.schema}
${snapshot.data}
${checks}
COMMIT;
`;
  psql(database, sql);
  // Independent post-commit reads compare every field, preserving duplicate rows.
  for (const table of snapshot.tables) {
    const output = psql(database, `SET timezone='UTC'; SET datestyle='ISO, MDY';
      COPY public.${ident(table.name)} (${table.columns.map(ident).join(',')}) TO STDOUT;`);
    const rows = output === '' ? [] : output.replace(/\n$/, '').split('\n');
    if (rows.length !== table.rows.length || rowDigest(rows) !== rowDigest(table.rows)) {
      throw new Error(`COPY content differs for ${table.name}; restore NOT accepted`);
    }
  }
  const report = {
    status: 'RESTORE_OK', container, database, backup, sha256: files, mode,
    prerequisites: ['pg_trgm in public'],
    verifiedAt: new Date().toISOString(), tables: snapshot.tables.length,
    allCopyRowsMatched: true, foreignKeysRevalidated: 60, enabledUserTriggers: 37,
    sequencesChecked: snapshot.sequences.length, migrationRows: 96,
    knownPostedJournalsWithoutLines: 3,
    preservedNotValidChecks: ['public.journal_entries.jentry_balanced'],
    exactJournalBalanceChecked: true,
    exactFinancialBaseline: snapshot.financial,
    limitation: 'public-only restore; auth.users IDs and auth functions are fixtures, not an auth/RLS test',
    productionOrHostedStagingModified: false,
  };
  writeFileSync(join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(`RESTORE_OK tables=${report.tables} foreign_keys=60 triggers=37 sequences=9 tracking_rows=96`);
  console.log('ALL_COPY_ROWS_MATCH; FINANCIAL_BASELINE_OK; known_posted_journals_without_lines=3');
  console.log('SOURCE_CHECK_STATE_PRESERVED: jentry_balanced NOT VALID; exact journal balance verified');
  console.log(`Report: ${join(reportDir, 'report.json')}`);
  console.log('Auth fixtures only. Container retained for the next isolated L3 rollback test.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
