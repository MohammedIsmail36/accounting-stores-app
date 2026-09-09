import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCopy, rowDigest, assertIsolation, validationSql, databaseAction, bootstrapSql, sumExact, financialBaseline, financialChecksSql } from './rehearse-public-restore.mjs';

const metrics = {
  posted_sales_count: '94', posted_sales_total: '196801', posted_purchases_count: '31',
  posted_purchases_total: '626171', inventory_quantity_sum: '6138', inventory_total_cost: '775736.1690909090909',
};

test('COPY handles quoted identifiers, escaped text, nulls, and empty tables', () => {
  const data = 'COPY "public"."items" ("id", "notes") FROM stdin;\n1\ta\\tb\\n\n2\t\\N\n\\.\nCOPY public.empty (id) FROM stdin;\n\\.\n';
  const tables = parseCopy(data);
  assert.deepEqual(tables[0].columns, ['id', 'notes']);
  assert.deepEqual(tables[0].rows, ['1\ta\\tb\\n', '2\t\\N']);
  assert.equal(tables[1].rows.length, 0);
});

test('COPY rejects incomplete, duplicate, malformed and external-schema input', () => {
  const block = 'COPY public.items (id) FROM stdin;\n1\n\\.\n';
  for (const data of [block + block, block.replace('public.', 'auth.'),
    block.replace('\\.\n', ''), block.replace('\n1\n', '\n1\t2\n'), '']) {
    assert.throws(() => parseCopy(data));
  }
});

test('row digest ignores order but preserves duplicate counts and every field', () => {
  assert.equal(rowDigest(['a', 'b']), rowDigest(['b', 'a']));
  assert.notEqual(rowDigest(['a']), rowDigest(['a', 'a']));
  assert.notEqual(rowDigest(['a\t\\N']), rowDigest(['a\t']));
});

const isolated = () => ({
  Id: '854444943e9790aab117a5e4639e8b23e448441673d45340b259abd9ba532a22',
  Name: '/accounting-l3-restore-20260909', State: { Running: true },
  Config: { User: 'postgres', Labels: { 'accounting.purpose': 'l3-restore-test' } },
  HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Privileged: false,
    Memory: 536870912, MemorySwap: 536870912, NanoCpus: 500000000 }, Mounts: [],
});

test('isolation accepts only the pinned, isolated test container', () => {
  assert.doesNotThrow(() => assertIsolation(isolated()));
  for (const change of [
    (c) => { c.Id = 'another-container'; },
    (c) => { c.Name = '/farida-db'; },
    (c) => { c.State.Running = false; },
    (c) => { c.Config.User = 'root'; },
    (c) => { c.Config.Labels = {}; },
    (c) => { c.HostConfig.NetworkMode = 'bridge'; },
    (c) => { c.HostConfig.ReadonlyRootfs = false; },
    (c) => { c.HostConfig.Privileged = true; },
    (c) => { c.HostConfig.PidMode = 'host'; },
    (c) => { c.HostConfig.IpcMode = 'host'; },
    (c) => { c.HostConfig.Binds = ['/data:/data']; },
    (c) => { c.Mounts = [{ Type: 'volume', Destination: '/data' }]; },
    (c) => { c.HostConfig.PortBindings = { '5432/tcp': [{}] }; },
    (c) => { c.HostConfig.Memory = 0; },
    (c) => { c.HostConfig.MemorySwap = -1; },
    (c) => { c.HostConfig.NanoCpus = 0; },
  ]) {
    const info = isolated(); change(info);
    assert.throws(() => assertIsolation(info));
  }
});

test('SQL forces FK revalidation and checks financial, trigger and sequence baselines', () => {
  const sql = validationSql([{ name: 'items', rows: ['1'] }],
    [{ name: '"public"."items_seq"', value: '42', called: 'true' }], metrics);
  assert.match(sql, /SET session_replication_role = origin/);
  assert.match(sql, /DROP CONSTRAINT/);
  assert.match(sql, /ADD CONSTRAINT/);
  assert.match(sql, /Financial baseline mismatch/);
  assert.match(sql, /tgenabled <> 'O'/);
  assert.match(sql, /SELECT last_value, is_called/);
});

test('FK validation is distinct from the one historical NOT VALID balance CHECK', () => {
  const sql = validationSql([{ name: 'items', rows: ['1'] }], [], metrics);
  assert.match(sql, /contype='f' AND NOT convalidated/);
  assert.match(sql, /conrelid='public\.journal_entries'::regclass\s+AND conname='jentry_balanced' AND contype='c' AND NOT convalidated/);
  assert.match(sql, /connamespace='public'::regnamespace AND NOT convalidated\) <> 1/);
  assert.match(sql, /total_debit IS DISTINCT FROM total_credit/);
  assert.doesNotMatch(sql, /ALTER TABLE[^;]*VALIDATE CONSTRAINT jentry_balanced/);
});

test('resuming requires an existing database; normal restore never overwrites one', () => {
  assert.equal(databaseAction('--restore', false), 'create');
  assert.equal(databaseAction('--resume-empty', true), 'verify-empty');
  assert.throws(() => databaseAction('--restore', true));
  assert.throws(() => databaseAction('--resume-empty', false));
});

test('bootstrap checks pristine state and pg_trgm before creating application dependencies', () => {
  const sql = bootstrapSql();
  for (const catalog of ['pg_class', 'pg_proc', 'pg_type', 'pg_namespace', 'pg_roles', 'pg_extension', 'pg_stat_activity']) {
    assert.ok(sql.includes(`FROM ${catalog}`));
  }
  assert.match(sql, /FROM pg_available_extensions WHERE name='pg_trgm'/);
  assert.ok(sql.indexOf('END $empty_guard$;') < sql.indexOf('CREATE EXTENSION pg_trgm WITH SCHEMA public;'));
  assert.ok(sql.indexOf('CREATE EXTENSION') < sql.indexOf('CREATE ROLE'));
  assert.doesNotMatch(sql, /^\s*(DROP|TRUNCATE|DELETE)\s/im);
});

test('exact decimal sums preserve snapshot precision rather than rounded display amounts', () => {
  assert.equal(sumExact(['775000', '736.1690909090909']), metrics.inventory_total_cost);
  assert.notEqual(sumExact(['775000', '736.1690909090909']), '775736.17');
  assert.equal(sumExact(['0.1', '0.2']), '0.3');
  assert.equal(sumExact(['-0.01', '0.001']), '-0.009');
  assert.equal(sumExact(['-1.20', '1.2']), '0');
  assert.equal(sumExact(['9007199254740993', '0.01']), '9007199254740993.01');
  assert.equal(sumExact(['1200.00', null]), '1200');
  assert.equal(sumExact([]), null);
  assert.equal(sumExact([null]), null);
  for (const value of ['NaN', '1e2', undefined, '1;SELECT 1']) assert.throws(() => sumExact([value]));
});

test('financial baseline comes from COPY with posted filtering and exact sums', () => {
  const tables = [
    { name: 'sales_invoices', columns: ['status', 'total'], rows: ['draft\t100', 'posted\t0.10', 'posted\t0.20'] },
    { name: 'purchase_invoices', columns: ['total', 'status'], rows: ['4.125\tposted', '9\tcancelled'] },
    { name: 'inventory_movements', columns: ['quantity', 'total_cost'], rows: ['2\t3.123456789', '-1\t-0.000000001'] },
  ];
  assert.deepEqual(financialBaseline(tables), {
    posted_sales_count: '2', posted_sales_total: '0.3', posted_purchases_count: '1',
    posted_purchases_total: '4.125', inventory_quantity_sum: '1', inventory_total_cost: '3.123456788',
  });
});

test('financial SQL keeps exact numeric precision and identifies each failing metric', () => {
  const sql = financialChecksSql(metrics);
  assert.match(sql, /775736\.1690909090909::numeric/);
  assert.match(sql, /Financial baseline mismatch \(inventory_total_cost\): expected %, got %/);
  assert.doesNotMatch(sql, /round\(|775736\.17::numeric/i);
  assert.throws(() => financialChecksSql({ ...metrics, inventory_total_cost: '1;SELECT 1' }));
});
