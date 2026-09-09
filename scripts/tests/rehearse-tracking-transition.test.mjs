import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSchema, historyCheck, rollbackBody, copyRowsSql, projectStagingRollbackForIsolatedTest } from './rehearse-tracking-transition.mjs';

test('COPY uses a SELECT for both tables and compatibility views without changing column order', () => {
  for (const relation of ['app_schema_migrations', 'source_schema_migrations']) {
    const sql = copyRowsSql(relation, ['version', 'filename', 'checksum', 'executed_at']);
    assert.ok(sql.includes(`COPY (SELECT "version","filename","checksum","executed_at" FROM public."${relation}") TO STDOUT;`));
    assert.doesNotMatch(sql, /COPY public\./);
    assert.match(sql, /SET timezone='UTC'/);
    assert.match(sql, /SET datestyle='ISO, MDY'/);
    assert.doesNotMatch(sql, /SELECT \*|DISTINCT|WHERE|LIMIT/);
  }
});

test('COPY query rejects empty columns and SQL identifier injection', () => {
  assert.throws(() => copyRowsSql('items', []));
  assert.throws(() => copyRowsSql('items;DROP TABLE items', ['id']));
  assert.throws(() => copyRowsSql('items', ['id) TO PROGRAM']));
});

test('schema comparison strips random pg_dump nonces but preserves schema and privileges', () => {
  const a = '\\restrict first\nCREATE TABLE a(id int);\nGRANT SELECT ON a TO anon;\n\\unrestrict first\n';
  const b = a.replaceAll('first', 'second');
  assert.equal(normalizeSchema(a), normalizeSchema(b));
  assert.notEqual(normalizeSchema(a), normalizeSchema(a.replace('SELECT', 'ALL')));
  assert.notEqual(normalizeSchema(a), normalizeSchema(a.replace('int', 'text')));
});

test('history check requires all three metadata fields and original 96-row signature', () => {
  const sql = historyCheck('source_schema_migrations');
  assert.match(sql, /count\(\*\).*<> 96/);
  assert.match(sql, /version \|\| chr\(31\) \|\| filename \|\| chr\(31\) \|\| checksum/);
  assert.match(sql, /ORDER BY version/);
  assert.match(sql, /634e981f2f7363bcdc1b546a1e9c37c0/);
});

test('reverse requires test DB, exact table identity, compatibility view and original data', () => {
  const sql = rollbackBody('source_schema_migrations', 'source_schema_migrations_pkey', 12345);
  assert.match(sql, /current_database\(\) <> 'l3_public_restore'/);
  assert.match(sql, /IS DISTINCT FROM 12345::oid/);
  assert.match(sql, /pg_rewrite/);
  assert.match(sql, /ACCESS EXCLUSIVE MODE/);
  assert.match(sql, /DROP VIEW public\."source_schema_migrations" RESTRICT/);
  assert.match(sql, /ALTER TABLE public.app_schema_migrations RENAME TO "source_schema_migrations"/);
  assert.match(sql, /ALTER INDEX public.app_schema_migrations_pkey RENAME TO "source_schema_migrations_pkey"/);
  assert.doesNotMatch(sql, /\b(?:CASCADE|TRUNCATE|DELETE FROM|DROP TABLE|DROP DATABASE)\b/i);
});

test('rollback generator rejects identifier injection and invalid identities', () => {
  assert.throws(() => rollbackBody('bad;DROP TABLE anything', 'test_pkey', 1));
  assert.throws(() => rollbackBody('test_history', 'bad name', 1));
  for (const oid of [0, -1, 1.2, '123', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => rollbackBody('test_history', 'test_pkey', oid));
  }
});

test('the pinned Staging rollback remains data-preserving by construction', () => {
  const source = readFileSync(
    '/backups/staging/l3-before-tracking-20260909-093540/tracking-rehearsal/staging-rollback.sql',
    'utf8',
  );
  const sourceName = /DROP VIEW public\.([a-z_]+_schema_migrations) RESTRICT/.exec(source)?.[1];
  assert.ok(sourceName);
  assert.notEqual(sourceName, 'app_schema_migrations');
  assert.match(source, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(source, /Migration history differs from pre-L3 baseline; rollback refused/);
  assert.ok(source.includes(`DROP VIEW public.${sourceName} RESTRICT;`));
  assert.ok(source.includes(`ALTER TABLE public.app_schema_migrations RENAME TO ${sourceName};`));
  assert.ok(source.includes(`ALTER INDEX public.app_schema_migrations_pkey RENAME TO ${sourceName}_pkey;`));
  assert.doesNotMatch(source, /\b(?:CASCADE|TRUNCATE|DELETE FROM|DROP TABLE|DROP DATABASE)\b/i);
});

test('isolated test projection changes only the hosted database-name guard', () => {
  const source = readFileSync(
    '/backups/staging/l3-before-tracking-20260909-093540/tracking-rehearsal/staging-rollback.sql',
    'utf8',
  );
  const projected = projectStagingRollbackForIsolatedTest(source);
  assert.equal(projected.replace("current_database() <> 'l3_public_restore'", "current_database() <> 'postgres'"), source);
  assert.equal(projected.length, source.length + 'l3_public_restore'.length - 'postgres'.length);
  assert.throws(() => projectStagingRollbackForIsolatedTest(projected));
  assert.throws(() => projectStagingRollbackForIsolatedTest(source.replace("current_database() <> 'postgres'", 'TRUE')));
});
