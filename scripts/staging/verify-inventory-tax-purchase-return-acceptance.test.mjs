import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./backup-inventory-tax-purchase-return-acceptance-baseline.mjs";
import { validateVerification, verificationSql } from "./verify-inventory-tax-purchase-return-acceptance.mjs";

const lines = [
  { account_code: "1104", debit: 0, credit: 50 },
  { account_code: "1105", debit: 0, credit: 7 },
  { account_code: "2101", debit: 57, credit: 0 },
];
const baseline = { counts: Object.fromEntries([
  "accounts", "settings", "products", "inventory_movements", "sales_invoices", "sales_returns",
  "purchase_invoices", "purchase_returns", "purchase_return_items", "journal_entries",
  "journal_entry_lines", "repairs", "repair_items", "repair_effects", "repair_events",
].map((key) => [key, 1])) };
const counts = { ...baseline.counts, inventory_movements: 2, purchase_returns: 2,
  purchase_return_items: 2, repairs: 2, repair_items: 2, repair_events: 2 };
const draft = {
  database: "postgres", server_version: "17.6", configured_prefix: "JV-",
  tax_settings: { enable_tax: true, tax_rate: 14, purchase_code: "1105", sales_code: "2104" },
  repair: { repair_number: 53, status: "draft", version: 1, prepared_by: "actor" },
  item: { axis: "source", classification: "movement_without_journal",
    repair_type: "create_missing_inventory_journal", source_type: "purchase_return",
    source_id: fixture.returnId, source_number: String(fixture.returnNumber),
    precondition_hash: "fingerprint", result_status: "pending",
    proposed_state: { mode: "create_full_journal", plan_fingerprint: "plan", correction_lines: lines } },
  source: { return_number: fixture.returnNumber, purchase_invoice_id: fixture.sourceInvoiceId,
    status: "posted", subtotal: 50, tax: 7, total: 57, journal_entry_id: null },
  source_invoice: { invoice_number: 990023, status: "posted", tax: 14, journal_entry_id: "posted-journal" },
  product: { quantity: 1, purchase_price: 50 }, movement_count: 1,
  events: { created: 1 }, effect_count: 0, effect: null,
  live_plan: { eligible: true, reason_code: "READY", plan_fingerprint: "plan", correction_lines: lines },
  diagnostic_row: { classification: "movement_without_journal" }, counts,
};

test("الاستعلام قراءة فقط ومحدد بمرتجع الشراء", () => {
  assert.match(verificationSql, /^BEGIN TRANSACTION READ ONLY/);
  assert.match(verificationSql, new RegExp(fixture.returnId));
  assert.match(verificationSql, /'purchase_return'/);
  assert.doesNotMatch(verificationSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test("يقبل المسودة ويرفض ربطًا أو حساب ضريبة أو خطة أو أثرًا غير صحيح", () => {
  assert.equal(validateVerification(draft, "--draft", baseline), draft);
  assert.throws(() => validateVerification({ ...draft, source: { ...draft.source,
    purchase_invoice_id: "wrong-invoice" } }, "--draft", baseline), /source/);
  assert.throws(() => validateVerification({ ...draft, tax_settings: { ...draft.tax_settings,
    purchase_code: "1106" } }, "--draft", baseline), /tax_settings/);
  assert.throws(() => validateVerification({ ...draft, item: { ...draft.item,
    proposed_state: { ...draft.item.proposed_state,
      correction_lines: lines.filter((line) => line.account_code !== "1105") } } }, "--draft", baseline), /stored_plan/);
  assert.throws(() => validateVerification({ ...draft, effect_count: 1 }, "--draft", baseline), /pre_execution_state/);
});

test("يتحقق من انتقال الحالة ويرفض قيدًا غير متوازن", () => {
  assert.throws(() => validateVerification({ ...draft, repair: { ...draft.repair,
    status: "approved" } }, "--draft", baseline), /repair_header/);
  const executed = { ...draft,
    repair: { ...draft.repair, status: "executed", version: 4 },
    item: { ...draft.item, result_status: "applied" },
    source: { ...draft.source, journal_entry_id: "new-journal" },
    events: { created: 1, submitted: 1, approved: 1, executed: 1 },
    effect_count: 1, effect: { effect_type: "missing_inventory_journal_created",
      table_name: "journal_entries", record_id: "new-journal" },
    live_plan: { eligible: false, reason_code: "NO_CORRECTION_REQUIRED" },
    diagnostic_row: null,
    journal: { id: "new-journal", status: "posted", posted_number: 319,
      total_debit: 57, total_credit: 56, lines },
    counts: { ...counts, journal_entries: 2, journal_entry_lines: 4,
      repair_effects: 2, repair_events: 5 },
  };
  assert.throws(() => validateVerification(executed, "--executed", baseline), /execution_state/);
  assert.equal(validateVerification({ ...executed, journal: { ...executed.journal,
    total_credit: 57 } }, "--executed", baseline).repair.status, "executed");
});
