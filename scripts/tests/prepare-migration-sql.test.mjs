import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { prepareMigrationSql } from '../prepare-migration-sql.mjs';

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations');
const wrappedNames = new Set([
  '20260923030000_journal_posted_number_invariant.sql',
  '20260924103000_inventory_atomic_variance_write_guard.sql',
  '20260924104000_inventory_atomic_variance_diagnostic_compat.sql',
  '20260924105000_inventory_adjustment_posted_number.sql',
  '20261001100000_historical_sale_cost_corrections.sql',
  '20261001101000_historical_sale_cost_lookup_index.sql',
  '20261001102000_historical_sale_cost_diagnostic_reader.sql',
  '20261001103000_historical_sale_cost_movement_summary_reader.sql',
  '20261001104000_effective_movement_product_relationship.sql',
  '20261001105000_historical_sale_cost_finance_readers.sql',
  '20261001110000_guard_corrected_sales_invoice_cancellation.sql',
]);

test('removes only a complete outer transaction', () => {
  const sql = '-- migration\n\nBEGIN;\nSELECT 1;\nCOMMIT;\n';
  assert.equal(prepareMigrationSql(sql), '-- migration\n\nSELECT 1;\n');
});

test('leaves transaction-free SQL unchanged', () => {
  const sql = '-- migration\nCREATE TABLE public.example (id integer);\n';
  assert.equal(prepareMigrationSql(sql), sql);
});

test('rejects incomplete, repeated, or misplaced transaction controls', () => {
  for (const sql of [
    'BEGIN;\nSELECT 1;\n',
    'SELECT 1;\nCOMMIT;\n',
    'BEGIN;\nCOMMIT;\nSELECT 1;\n',
    'BEGIN;\nCOMMIT;\nBEGIN;\nCOMMIT;\n',
    'ROLLBACK;\n',
  ]) {
    assert.throws(() => prepareMigrationSql(sql), /single outer BEGIN\/COMMIT pair/);
  }
});

test('normalizes every repository migration without changing an unwrapped file', () => {
  let wrappedCount = 0;
  for (const name of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'))) {
    const sql = readFileSync(join(migrationsDir, name), 'utf8');
    const prepared = prepareMigrationSql(sql);
    assert.equal(prepareMigrationSql(prepared), prepared, name);
    if (wrappedNames.has(name)) {
      wrappedCount += 1;
      assert.notEqual(prepared, sql, name);
    } else {
      assert.equal(prepared, sql, name);
    }
  }
  assert.equal(wrappedCount, wrappedNames.size);
});
