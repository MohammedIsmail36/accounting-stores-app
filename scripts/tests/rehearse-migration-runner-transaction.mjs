#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = mkdtempSync(join(tmpdir(), 'accounting-migration-tx-'));
const container = 'accounting-migration-tx-' + randomUUID().slice(0, 8);
const trackingVersion = '20260907091000_neutral_migration_tracking';
const goodVersion = '20260927000001_transaction_probe';
const failureVersion = '20260927000002_transaction_probe_failure';
let started = false;

function docker(args, input) {
  return execFileSync('docker', args, { encoding: 'utf8', input }).trim();
}

function query(sql) {
  return docker(['exec', '-i', container, 'psql', '-X', '-At', '-U', 'postgres', '-d', 'postgres'], sql + '\n');
}

function migrate(expectFailure = false) {
  const result = spawnSync(
    'bash',
    [join(scriptDir, 'migrate-all-companies.sh'), '--only', 'farida'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        MIGRATIONS_DIR: migrationsDir,
        TRACKING_MIGRATION: join(migrationsDir, trackingVersion + '.sql'),
        FARIDA_DB_CONTAINER: container,
      },
    },
  );
  if (result.error) throw result.error;
  if (expectFailure) {
    assert.notEqual(result.status, 0, 'injected failure must stop the migration runner');
    assert.match(result.stderr, /INJECTED_TRACKING_FAILURE/);
  } else {
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  }
}

const pause = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

try {
  writeFileSync(join(migrationsDir, trackingVersion + '.sql'), [
    'CREATE TABLE IF NOT EXISTS public.app_schema_migrations (',
    '  version text PRIMARY KEY, filename text NOT NULL, checksum text NOT NULL',
    ');',
    '',
  ].join('\n'));
  writeFileSync(join(migrationsDir, goodVersion + '.sql'), [
    '-- Complete outer transaction, as in the four production candidates.',
    'BEGIN;',
    'CREATE TABLE public.transaction_probe (id integer PRIMARY KEY);',
    'INSERT INTO public.transaction_probe VALUES (1);',
    'COMMIT;',
    '',
  ].join('\n'));

  docker([
    'run', '--rm', '-d', '--network', 'none',
    '--name', container,
    '-e', 'POSTGRES_PASSWORD=isolated-test-only',
    'postgres:15-alpine',
  ]);
  started = true;

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = spawnSync('docker', [
      'exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres',
    ], { encoding: 'utf8' });
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await pause(500);
  }
  assert.ok(ready, 'isolated PostgreSQL did not become ready');
  assert.match(query('SHOW server_version;'), /^15\./);

  migrate();
  assert.equal(query(
    "SELECT (SELECT count(*) FROM public.transaction_probe), " +
    "(SELECT count(*) FROM public.app_schema_migrations WHERE version = '" + goodVersion + "');",
  ), '1|1');

  writeFileSync(join(migrationsDir, failureVersion + '.sql'), [
    'BEGIN;',
    'CREATE TABLE public.transaction_probe_failure (id integer PRIMARY KEY);',
    'INSERT INTO public.transaction_probe_failure VALUES (1);',
    'COMMIT;',
    '',
  ].join('\n'));
  query([
    'CREATE FUNCTION public.inject_tracking_failure() RETURNS trigger',
    'LANGUAGE plpgsql AS $$ BEGIN',
    "  IF NEW.version = '" + failureVersion + "' THEN",
    "    RAISE EXCEPTION 'INJECTED_TRACKING_FAILURE';",
    '  END IF;',
    '  RETURN NEW;',
    'END $$;',
    'CREATE TRIGGER inject_tracking_failure BEFORE INSERT',
    'ON public.app_schema_migrations FOR EACH ROW',
    'EXECUTE FUNCTION public.inject_tracking_failure();',
  ].join('\n'));

  migrate(true);
  assert.equal(query(
    "SELECT to_regclass('public.transaction_probe_failure') IS NULL, " +
    "(SELECT count(*) FROM public.app_schema_migrations WHERE version = '" + failureVersion + "');",
  ), 't|0');

  query([
    'DROP TRIGGER inject_tracking_failure ON public.app_schema_migrations;',
    'DROP FUNCTION public.inject_tracking_failure();',
  ].join('\n'));
  migrate();
  migrate();
  assert.equal(query(
    "SELECT (SELECT count(*) FROM public.transaction_probe), " +
    "(SELECT count(*) FROM public.transaction_probe_failure), " +
    "(SELECT count(*) FROM public.app_schema_migrations WHERE version = '" + goodVersion + "'), " +
    "(SELECT count(*) FROM public.app_schema_migrations WHERE version = '" + failureVersion + "');",
  ), '1|1|1|1');

  process.stdout.write('PG15_MIGRATION_TRANSACTION_OK; atomic failure and idempotent rerun verified\n');
} finally {
  if (started) {
    const stopped = spawnSync('docker', ['stop', '-t', '1', container], { encoding: 'utf8' });
    if (stopped.status !== 0) {
      process.stderr.write('Could not stop isolated test container ' + container + '\n');
    }
  }
  rmSync(migrationsDir, { recursive: true, force: true });
}
