// L3: isolated forward/rollback rehearsal, not a deployment command.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { container, database, backup, loadSnapshot, assertIsolation, rowDigest } from './rehearse-public-restore.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const migrationPath = join(root, 'supabase/migrations/20260907091000_neutral_migration_tracking.sql');
const migrationHash = '9a6eb211ec127cb8b125d08f71c2aafe4fcd93f721460cd0f0329fa0d9e2ed70';
const restoreReportHash = '1a4ab50d21ec7ea7900e7ceeea09d48b635afe6e93d6a3b52084dd054ad6d4ef';
const stagingRollbackPath = join(backup, 'tracking-rehearsal/staging-rollback.sql');
const stagingRollbackHash = 'f96ad1a4994c090492e606e603aab5519688dae6c46f9b93e8aa27623fedc001';
const neutral = 'app_schema_migrations';
const hash = (s) => createHash('sha256').update(s).digest('hex');
const qi = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('Unsupported identifier');
  return `"${s}"`;
};
const ql = (s) => `'${s.replaceAll("'", "''")}'`;

export function normalizeSchema(text) {
  // pg_dump emits fresh psql restriction nonces on each invocation.
  return text.replace(/^\\(?:un)?restrict [^\n]*\n?/gm, '');
}

export function copyRowsSql(table, columns) {
  if (!Array.isArray(columns) || columns.length === 0) throw new Error('Explicit COPY columns are required');
  // COPY relation TO rejects views. COPY (SELECT ...) supports both the original
  // table and the compatibility view, with identical field order and encoding.
  return `SET timezone='UTC'; SET datestyle='ISO, MDY';
    COPY (SELECT ${columns.map(qi).join(',')} FROM public.${qi(table)}) TO STDOUT;`;
}

export function projectStagingRollbackForIsolatedTest(sql) {
  const from = "current_database() <> 'postgres'";
  const to = `current_database() <> ${ql(database)}`;
  if (sql.split(from).length !== 2 || sql.includes(to)) {
    throw new Error('Expected exactly one hosted database guard in Staging rollback');
  }
  return sql.replace(from, to);
}

export function historyCheck(table) {
  return `DO $history$ BEGIN
  IF (SELECT count(*) FROM public.${qi(table)}) <> 96
    OR (SELECT md5(string_agg(version || chr(31) || filename || chr(31) || checksum,
      chr(30) ORDER BY version)) FROM public.${qi(table)})
      IS DISTINCT FROM '634e981f2f7363bcdc1b546a1e9c37c0'
  THEN RAISE EXCEPTION 'Migration history changed'; END IF;
END $history$;`;
}

export function rollbackBody(source, primaryKey, oid) {
  qi(source); qi(primaryKey);
  if (!Number.isSafeInteger(oid) || oid <= 0) throw new Error('Invalid source OID');
  return `
-- TEST DATABASE ONLY. Preserve the existing table, rows, owner and grants.
DO $rollback_guard$ BEGIN
  IF current_database() <> ${ql(database)}
    OR (SELECT oid FROM pg_class WHERE oid=to_regclass('public.app_schema_migrations') AND relkind='r') IS DISTINCT FROM ${oid}::oid
    OR (SELECT relkind FROM pg_class WHERE oid=to_regclass(${ql(`public.${source}`)})) IS DISTINCT FROM 'v'::"char"
    OR NOT EXISTS (SELECT 1 FROM pg_rewrite r JOIN pg_depend d ON d.classid='pg_rewrite'::regclass AND d.objid=r.oid
      WHERE r.ev_class=to_regclass(${ql(`public.${source}`)}) AND d.refclassid='pg_class'::regclass AND d.refobjid=${oid}::oid)
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=${oid}::oid AND contype='p' AND conname='app_schema_migrations_pkey')
  THEN RAISE EXCEPTION 'Rollback target/state mismatch; no object removed'; END IF;
END $rollback_guard$;
LOCK TABLE public.app_schema_migrations IN ACCESS EXCLUSIVE MODE;
${historyCheck(neutral)}
DROP VIEW public.${qi(source)} RESTRICT;
ALTER TABLE public.app_schema_migrations RENAME TO ${qi(source)};
ALTER INDEX public.app_schema_migrations_pkey RENAME TO ${qi(primaryKey)};
${historyCheck(source)}
`;
}

function main() {
  const mode = process.argv[2];
  if (!['--check', '--run', '--test-staging-rollback'].includes(mode) || process.argv.length !== 3) {
    throw new Error('Use --check, --run or --test-staging-rollback');
  }
  const snapshot = loadSnapshot();
  const migration = readFileSync(migrationPath, 'utf8');
  if (hash(migration) !== migrationHash) throw new Error('Migration checksum differs from reviewed file');
  const saved = readFileSync(join(backup, 'restore-report.json'));
  if (hash(saved) !== restoreReportHash) throw new Error('Saved restore report checksum mismatch');
  const report = JSON.parse(saved);
  if (report.status !== 'RESTORE_OK' || report.container !== container || report.database !== database
    || !report.allCopyRowsMatched) throw new Error('A verified restore report is required');
  const tracking = snapshot.tables.filter((t) => t.name.endsWith('_schema_migrations'));
  if (tracking.length !== 1 || tracking[0].name === neutral) throw new Error('Unexpected source tracking table');
  const source = tracking[0].name;
  const stagingRollback = readFileSync(stagingRollbackPath, 'utf8');
  if (hash(stagingRollback) !== stagingRollbackHash) throw new Error('Staging rollback checksum mismatch');
  const isolatedStagingRollback = projectStagingRollbackForIsolatedTest(stagingRollback);
  if (mode === '--check') {
    rollbackBody(source, `${source}_pkey`, 1);
    console.log('TRACKING_PLAN_CHECK_OK; restore report, migration and Staging rollback verified; no SQL executed');
    return;
  }

  const reportDir = mkdtempSync('/tmp/accounting-l3-tracking-report-');
  let phase = 'isolation';
  const run = (args, input) => {
    const r = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0 || r.error) {
      const log = join(reportDir, 'run.log');
      writeFileSync(log, `phase=${phase}\n${r.stderr ?? ''}\n${r.error?.message ?? ''}`, { mode: 0o600 });
      throw new Error(`Tracking rehearsal failed (${phase}); protected diagnostic: ${log}`);
    }
    return r.stdout;
  };
  assertIsolation(JSON.parse(run(['inspect', container]))[0]);
  const sql = (text) => run(['exec', '-i', container, 'psql', '-h', '/tmp', '-U', 'postgres', '-d', database,
    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], `\\set VERBOSITY terse\n${text}`);
  const state = (name) => JSON.parse(sql(`SELECT jsonb_build_object('oid', c.oid::bigint, 'kind', c.relkind,
    'owner', pg_get_userbyid(c.relowner), 'acl', c.relacl::text,
    'pk', (SELECT conname FROM pg_constraint WHERE conrelid=c.oid AND contype='p'))
    FROM pg_class c WHERE c.oid=to_regclass(${ql(`public.${name}`)});`).trim() || 'null');
  const schema = () => normalizeSchema(run(['exec', container, 'pg_dump', '-h', '/tmp', '-U', 'postgres',
    '-d', database, '--schema-only', '--schema=public']));
  const verifyRows = (activeTracking = source) => {
    for (const t of snapshot.tables) {
      const table = t.name === source ? activeTracking : t.name;
      const data = sql(copyRowsSql(table, t.columns));
      const rows = data === '' ? [] : data.replace(/\n$/, '').split('\n');
      if (rowDigest(rows) !== rowDigest(t.rows)) throw new Error(`Data mismatch (${phase}): ${t.name}`);
    }
  };
  phase = 'baseline';
  const original = state(source);
  if (original?.kind !== 'r' || original.pk !== `${source}_pkey` || state(neutral) !== null) {
    throw new Error('Source tracking state is not the restored baseline; no migration executed');
  }
  verifyRows();
  const beforeSchema = schema();
  const rollback = rollbackBody(source, original.pk, original.oid);
  const rollbackPath = join(reportDir, 'rollback-isolated-only.sql');
  writeFileSync(rollbackPath, `BEGIN;\n${rollback}\nCOMMIT;\n`, { mode: 0o600 });
  console.log(`ISOLATION_AND_BASELINE_OK; isolated rollback prepared: ${rollbackPath}`);
  const forwardCheck = `DO $forward$ BEGIN
    IF (SELECT oid FROM pg_class WHERE oid=to_regclass('public.app_schema_migrations') AND relkind='r') IS DISTINCT FROM ${original.oid}::oid
      OR (SELECT relkind FROM pg_class WHERE oid=to_regclass(${ql(`public.${source}`)})) IS DISTINCT FROM 'v'::"char"
    THEN RAISE EXCEPTION 'Forward relation state mismatch'; END IF;
  END $forward$;\n${historyCheck(neutral)}\n${historyCheck(source)}`;

  if (mode === '--test-staging-rollback') {
    let forwardCommitted = false;
    let stagingRollbackSucceeded = false;
    try {
      phase = 'staging-rollback-forward';
      sql(`BEGIN;\n${migration}\n${forwardCheck}\nCOMMIT;`);
      forwardCommitted = true;
      phase = 'staging-rollback-file';
      sql(isolatedStagingRollback);
      stagingRollbackSucceeded = true;
    } finally {
      // If the Staging-specific file rejects or fails, restore the disposable DB
      // with the already proven OID-bound rollback before reporting failure.
      if (forwardCommitted && !stagingRollbackSucceeded) {
        phase = 'emergency-isolated-rollback';
        sql(`BEGIN;\n${rollback}\nCOMMIT;`);
      }
    }
    phase = 'staging-rollback-verification';
    verifyRows();
    if (schema() !== beforeSchema || JSON.stringify(state(source)) !== JSON.stringify(original) || state(neutral) !== null) {
      throw new Error('Staging rollback did not restore the isolated baseline');
    }
    const result = { status: 'STAGING_ROLLBACK_REHEARSAL_OK', verifiedAt: new Date().toISOString(),
      container, database, migrationSha256: migrationHash, stagingRollbackPath,
      stagingRollbackSha256: stagingRollbackHash, tablesVerified: snapshot.tables.length,
      isolatedDatabaseGuardOnlySha256: hash(isolatedStagingRollback),
      historyRows: 96, allCopyRowsMatched: true, publicSchemaRestored: true,
      schemaSha256: hash(beforeSchema), forwardCommitted: true, reverseCommitted: true,
      historicalMigrationsExecuted: 0, productionOrHostedStagingModified: false,
      limitation: 'Staging rollback SQL tested against isolated restored snapshot; hosted channel not tested' };
    writeFileSync(join(reportDir, 'report.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    console.log('STAGING_ROLLBACK_REHEARSAL_OK; ALL_ROWS_AND_PUBLIC_SCHEMA_RESTORED');
    console.log(`Report: ${join(reportDir, 'report.json')}`);
    return;
  }

  // First prove forward, idempotence, writable compatibility and explicit reverse
  // within a transaction that is rolled back regardless of success.
  phase = 'transactional-preflight';
  sql(`BEGIN;\n${migration}\n${forwardCheck}\n${migration}\n${forwardCheck}
    SAVEPOINT compatibility_probe;
    INSERT INTO public.${qi(source)}(version,filename,checksum)
      VALUES ('__l3_isolated_probe__','isolated-probe.sql','probe');
    DO $probe$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM public.app_schema_migrations WHERE version='__l3_isolated_probe__')
      THEN RAISE EXCEPTION 'Compatibility write failed'; END IF;
    END $probe$;
    ROLLBACK TO SAVEPOINT compatibility_probe;
    ${rollback}\nROLLBACK;`);
  verifyRows();
  if (schema() !== beforeSchema || JSON.stringify(state(source)) !== JSON.stringify(original) || state(neutral) !== null) {
    throw new Error('Transactional preflight did not preserve the baseline');
  }
  console.log('TRANSACTIONAL_PREFLIGHT_OK; explicit rollback and idempotence checked');

  // Separate commits and independent reads prove the reversal also works after commit.
  let committed = false;
  try {
    phase = 'forward-commit';
    sql(`BEGIN;\n${migration}\n${forwardCheck}\nCOMMIT;`);
    committed = true;
    phase = 'forward-verification';
    verifyRows(neutral);
    verifyRows(source);
    const moved = state(neutral);
    if (moved.owner !== original.owner || moved.acl !== original.acl || moved.pk !== 'app_schema_migrations_pkey') {
      throw new Error('Tracking owner, grants or primary key changed unexpectedly');
    }
    console.log('FORWARD_OK; 96 history rows and all business rows unchanged');
  } finally {
    if (committed) {
      phase = 'rollback-commit';
      sql(`BEGIN;\n${rollback}\nCOMMIT;`);
    }
  }
  phase = 'rollback-verification';
  verifyRows();
  const afterSchema = schema();
  if (afterSchema !== beforeSchema || JSON.stringify(state(source)) !== JSON.stringify(original) || state(neutral) !== null) {
    throw new Error('Rollback schema or tracking metadata differs from baseline');
  }
  const result = { status: 'TRACKING_REHEARSAL_OK', verifiedAt: new Date().toISOString(),
    container, database, migration: migrationPath, migrationSha256: migrationHash,
    restoreReportSha256: restoreReportHash, rollbackPath, rollbackBodySha256: hash(rollback),
    tablesVerified: snapshot.tables.length, historyRows: 96, allCopyRowsMatched: true,
    publicSchemaRestored: true, schemaSha256: hash(beforeSchema), sourceMetadataRestored: true,
    forwardCommitted: true, reverseCommitted: true, sourceStateRestored: true,
    historicalMigrationsExecuted: 0, productionOrHostedStagingModified: false,
    limitation: 'Isolated database only; not a hosted execution-channel or full deployment-runner test' };
  writeFileSync(join(reportDir, 'report.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log('TRACKING_REHEARSAL_OK; FORWARD_AND_ROLLBACK_OK; ALL_ROWS_AND_PUBLIC_SCHEMA_RESTORED');
  console.log(`Report: ${join(reportDir, 'report.json')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
