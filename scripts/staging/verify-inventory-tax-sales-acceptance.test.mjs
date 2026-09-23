import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./backup-inventory-tax-sales-acceptance-baseline.mjs";
import { validateVerification, verificationSql } from "./verify-inventory-tax-sales-acceptance.mjs";

const lines = [
  { account_code: "1103", debit: 114, credit: 0 },
  { account_code: "1104", debit: 0, credit: 80 },
  { account_code: "2104", debit: 0, credit: 14 },
  { account_code: "4101", debit: 0, credit: 100 },
  { account_code: "5101", debit: 80, credit: 0 },
];
const baseline = { counts: { products: 1, inventory_movements: 1, sales_invoices: 1,
  sales_invoice_items: 1, purchase_invoices: 1, journal_entries: 1,
  journal_entry_lines: 1, repairs: 1, repair_items: 1, repair_effects: 1, repair_events: 1 } };
const draft = {
  database: "postgres", server_version: "17.6", configured_prefix: "JV-",
  tax_settings: { enable_tax: true, tax_rate: 14, purchase_code: "1105", sales_code: "2104" },
  repair: { repair_number: 51, status: "draft", version: 1, prepared_by: "actor" },
  item: { axis: "source", classification: "movement_without_journal",
    repair_type: "create_missing_inventory_journal", source_type: "sales_invoice",
    source_id: fixture.invoiceId, source_number: String(fixture.invoiceNumber),
    precondition_hash: "fingerprint", result_status: "pending",
    proposed_state: { mode: "create_full_journal", plan_fingerprint: "plan", correction_lines: lines } },
  source: { invoice_number: fixture.invoiceNumber, status: "posted", subtotal: 100,
    tax: 14, total: 114, journal_entry_id: null },
  product: { quantity: 8, purchase_price: 40 }, sale_movement_count: 1,
  opening: { movement_type: "opening_balance", reference_type: "staging_seed", journal_status: "posted",
    journal_posted_number: 316, quantity: 10, total_cost: 400, journal_debit: 400, journal_credit: 400, line_count: 2 },
  events: { created: 1 }, effect_count: 0, effect: null,
  live_plan: { eligible: true, reason_code: "READY", plan_fingerprint: "plan", correction_lines: lines },
  diagnostic_row: { classification: "movement_without_journal" },
  counts: { products: 2, inventory_movements: 3, sales_invoices: 2, sales_invoice_items: 2,
    purchase_invoices: 1, journal_entries: 2, journal_entry_lines: 3,
    repairs: 2, repair_items: 2, repair_effects: 1, repair_events: 2 },
};

test("الاستعلام قراءة فقط ومحدد بفواتير البيع في Staging", () => {
  assert.match(verificationSql, /^BEGIN TRANSACTION READ ONLY/);
  assert.match(verificationSql, new RegExp(fixture.invoiceId));
  assert.match(verificationSql, /'sales_invoice'/);
  assert.doesNotMatch(verificationSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test("يتحقق من المسودة ويرفض تغيير حساب الضريبة أو الخطة", () => {
  assert.equal(validateVerification(draft, "--draft", baseline), draft);
  assert.throws(() => validateVerification({ ...draft, tax_settings: { ...draft.tax_settings, sales_code: "2102" } }, "--draft", baseline), /tax_settings/);
  assert.throws(() => validateVerification({ ...draft, item: { ...draft.item,
    proposed_state: { ...draft.item.proposed_state, correction_lines: lines.filter((line) => line.account_code !== "2104") } } }, "--draft", baseline), /stored_plan/);
  assert.throws(() => validateVerification({ ...draft, effect_count: 1 }, "--draft", baseline), /pre_execution_state/);
});
