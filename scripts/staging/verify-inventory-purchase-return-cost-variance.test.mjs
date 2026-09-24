import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./backup-inventory-purchase-return-cost-variance-baseline.mjs";
import { validateVerification, verificationSql } from "./verify-inventory-purchase-return-cost-variance.mjs";

const lines = [
  { account_code: "1104", debit: 0, credit: 50 },
  { account_code: "1105", debit: 0, credit: 6.30 },
  { account_code: "2101", debit: 51.30, credit: 0 },
  { account_code: "5108", debit: 5, credit: 0 },
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
  repair: { repair_number: 54, status: "draft", version: 1, prepared_by: "actor" },
  item: { axis: "source", classification: "movement_without_journal",
    repair_type: "create_missing_inventory_journal", source_type: "purchase_return",
    source_id: fixture.returnId, source_number: String(fixture.returnNumber),
    precondition_hash: "fingerprint", result_status: "pending",
    proposed_state: { mode: "create_full_journal", plan_fingerprint: "plan", correction_lines: lines } },
  source: { return_number: fixture.returnNumber, purchase_invoice_id: fixture.sourceInvoiceId,
    status: "posted", subtotal: 45, tax: 6.30, total: 51.30, journal_entry_id: null },
  source_invoice: { invoice_number: 990023, status: "posted", tax: 14, journal_entry_id: "posted-journal" },
  prior_return: { id: fixture.priorReturnId, status: "posted", journal_status: "posted", journal_entry_id: "prior-journal" },
  product: { quantity: 0, purchase_price: 50 }, movement_count: 1,
  events: { created: 1 }, effect_count: 0, effect: null,
  live_plan: { eligible: true, reason_code: "READY", plan_fingerprint: "plan", correction_lines: lines },
  diagnostic_row: { classification: "movement_without_journal" }, counts,
};

test("استعلام فرق التكلفة قراءة فقط ومحدد بالمرتجع الجديد", () => {
  assert.match(verificationSql, /^BEGIN TRANSACTION READ ONLY/);
  assert.match(verificationSql, new RegExp(fixture.returnId));
  assert.match(verificationSql, new RegExp(fixture.priorReturnId));
  assert.match(verificationSql, /purchase_return_variance_verification/);
  assert.doesNotMatch(verificationSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test("يقبل المسودة ويرفض غياب حساب فرق التكلفة أو تغير المرتجع السابق", () => {
  assert.equal(validateVerification(draft, "--draft", baseline), draft);
  assert.throws(() => validateVerification({ ...draft, item: { ...draft.item,
    proposed_state: { ...draft.item.proposed_state,
      correction_lines: lines.filter((line) => line.account_code !== "5108") } } }, "--draft", baseline), /stored_plan/);
  assert.throws(() => validateVerification({ ...draft, prior_return: { ...draft.prior_return,
    status: "draft" } }, "--draft", baseline), /source/);
  assert.throws(() => validateVerification({ ...draft, effect_count: 1 }, "--draft", baseline), /pre_execution_state/);
});

test("يرفض قيدًا منفذًا غير متوازن", () => {
  const executed = { ...draft,
    repair: { ...draft.repair, status: "executed", version: 4 },
    item: { ...draft.item, result_status: "applied" },
    source: { ...draft.source, journal_entry_id: "new-journal" },
    events: { created: 1, submitted: 1, approved: 1, executed: 1 },
    effect_count: 1, effect: { effect_type: "missing_inventory_journal_created",
      table_name: "journal_entries", record_id: "new-journal" },
    live_plan: { eligible: false, reason_code: "NO_CORRECTION_REQUIRED" },
    diagnostic_row: null,
    journal: { id: "new-journal", status: "posted", posted_number: 320,
      total_debit: 56.30, total_credit: 55.30, lines },
    counts: { ...counts, journal_entries: 2, journal_entry_lines: 5,
      repair_effects: 2, repair_events: 5 },
  };
  assert.throws(() => validateVerification(executed, "--executed", baseline), /execution_state/);
  assert.equal(validateVerification({ ...executed, journal: { ...executed.journal,
    total_credit: 56.30 } }, "--executed", baseline).repair.status, "executed");
});
