import assert from "node:assert/strict";
import test from "node:test";
import { validateVerification, verificationSql } from "./verify-inventory-tax-purchase-acceptance.mjs";

const lines = [
  { account_code: "1104", debit: 100, credit: 0 },
  { account_code: "1105", debit: 14, credit: 0 },
  { account_code: "2101", debit: 0, credit: 114 },
];
const draft = {
  database: "postgres", server_version: "17.6", configured_prefix: "JV-",
  tax_settings: { enable_tax: true, tax_rate: 14, purchase_code: "1105", sales_code: "2104" },
  repair: { repair_number: 50, status: "draft", version: 1 },
  item: {
    axis: "source", classification: "movement_without_journal",
    repair_type: "create_missing_inventory_journal", source_type: "purchase_invoice",
    source_id: "3d3d0000-0000-4000-8000-000000000302", source_number: "990023",
    result_status: "pending", precondition_hash: "hash",
    proposed_state: { mode: "create_full_journal", plan_fingerprint: "plan", correction_lines: lines },
  },
  source: { invoice_number: 990023, status: "posted", subtotal: 100, tax: 14, total: 114, journal_entry_id: null },
  events: { created: 1 }, effect_count: 0,
  live_plan: { eligible: true, reason_code: "READY", plan_fingerprint: "plan", correction_lines: lines },
  counts: { products: 616, inventory_movements: 1368, purchase_invoices: 33, journal_entries: 314,
    journal_entry_lines: 839, repairs: 6, repair_items: 6, repair_effects: 3, repair_events: 21 },
};

test("استعلام التحقق للقراءة فقط", () => {
  const sql = verificationSql();
  assert.match(sql, /BEGIN TRANSACTION READ ONLY/);
  assert.match(sql, /3d3d0000-0000-4000-8000-000000000302/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test("يقبل المسودة الضريبية الصحيحة ويرفض تغيير حساب الضريبة", () => {
  assert.equal(validateVerification(draft, "--draft"), draft);
  assert.throws(
    () => validateVerification({ ...draft, item: { ...draft.item,
      proposed_state: { ...draft.item.proposed_state, correction_lines: lines.map((line) => line.account_code === "1105" ? { ...line, account_code: "2104" } : line) } } }, "--draft"),
    /stored_plan/,
  );
});
