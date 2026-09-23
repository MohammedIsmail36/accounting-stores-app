import assert from "node:assert/strict";
import test from "node:test";
import {
  applySql,
  explicitRollbackSql,
  stateSql,
  validateAppliedState,
} from "./manage-inventory-tax-purchase-acceptance-fixture.mjs";

const baseline = {
  counts: { products: 615, purchase_invoices: 32, inventory_movements: 1367, journal_entries: 314, journal_entry_lines: 839, repairs: 5 },
};

const validState = {
  database: "postgres",
  server_version: "17.6",
  settings: { enable_tax: true, tax_rate: 14, purchase_code: "1105", sales_code: "2104" },
  product: { code: "TST-TAX-PI-001", quantity: 2, purchase_price: 50 },
  invoice: {
    invoice_number: 990023, status: "posted", subtotal: 100, tax: 14, total: 114,
    journal_entry_id: null, notes: "__TAX_PURCHASE_ACCEPTANCE_WITHOUT_JOURNAL__",
  },
  item_count: 1,
  movement: { movement_type: "purchase", quantity: 2, total_cost: 100, reference_type: "purchase_invoice" },
  repair_count: 0,
  diagnostic_row: { classification: "movement_without_journal", movement_book_value: 100 },
  plan: {
    eligible: true, reason_code: "READY", mode: "create_full_journal",
    correction_lines: [
      { account_code: "1104", debit: 100, credit: 0 },
      { account_code: "1105", debit: 14, credit: 0 },
      { account_code: "2101", debit: 0, credit: 114 },
    ],
  },
  counts: { products: 616, purchase_invoices: 33, inventory_movements: 1368, journal_entries: 314, journal_entry_lines: 839, repairs: 5 },
};

test("التطبيق والرجوع مقيدان بحالة الاختبار", () => {
  for (const required of [
    "STAGING_TAX_PURCHASE_ACCEPTANCE_FIXTURE_READY",
    "enable_tax = true, tax_rate = 14",
    "PURCHASE_ACCEPTANCE_FIXTURE_ALREADY_EXISTS",
    "COMMIT;",
  ]) assert.ok(applySql.includes(required), `حارس تطبيق مفقود: ${required}`);

  for (const required of [
    "STAGING_TAX_PURCHASE_ACCEPTANCE_ROLLBACK_REFUSED",
    "enable_tax = false, tax_rate = 0",
    "DELETE FROM public.inventory_movements",
    "DELETE FROM public.purchase_invoices",
    "COMMIT;",
  ]) assert.ok(explicitRollbackSql.includes(required), `حارس رجوع مفقود: ${required}`);
});

test("التحقق المستقل للقراءة فقط", () => {
  assert.match(stateSql, /BEGIN TRANSACTION READ ONLY/);
  assert.match(stateSql, /get_inventory_reconciliation_journal_plan/);
  assert.doesNotMatch(stateSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test("يقبل الأثر المضبوط ويرفض ضريبة أو قيدًا غير صحيح", () => {
  assert.equal(validateAppliedState(validState, baseline), validState);
  assert.throws(
    () => validateAppliedState({ ...validState, invoice: { ...validState.invoice, tax: 0 } }, baseline),
    /invoice/,
  );
  assert.throws(
    () => validateAppliedState({ ...validState, plan: { ...validState.plan, correction_lines: [] } }, baseline),
    /journal_plan/,
  );
});
