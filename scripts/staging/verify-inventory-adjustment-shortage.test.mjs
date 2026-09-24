import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./backup-inventory-adjustment-shortage-baseline.mjs";
import { validateVerification, verificationSql } from "./verify-inventory-adjustment-shortage.mjs";

const lines = [
  { account_code: "1104", debit: 0, credit: 40 },
  { account_code: "5201", debit: 40, credit: 0 },
];
const baseline = { counts: Object.fromEntries([
  "accounts", "settings", "products", "inventory_movements", "inventory_adjustments",
  "inventory_adjustment_items", "sales_invoices", "sales_returns", "purchase_invoices",
  "purchase_returns", "journal_entries", "journal_entry_lines", "repairs", "repair_items",
  "repair_effects", "repair_events",
].map((key) => [key, 1])) };
const counts = { ...baseline.counts, inventory_movements: 2, inventory_adjustments: 2,
  inventory_adjustment_items: 2, repairs: 2, repair_items: 2, repair_events: 2 };
const draft = {
  database: "postgres", server_version: "17.6", configured_prefix: "JV-",
  repair: { repair_number: 55, status: "draft", version: 1, prepared_by: "actor" },
  item: { axis: "source", classification: "movement_without_journal",
    repair_type: "create_missing_inventory_journal", source_type: "adjustment",
    source_id: fixture.adjustmentId, source_number: String(fixture.adjustmentNumber),
    precondition_hash: "fingerprint", result_status: "pending",
    proposed_state: { mode: "create_full_journal", plan_fingerprint: "plan", correction_lines: lines } },
  source: { adjustment_number: fixture.adjustmentNumber, status: "posted",
    description: "__INVENTORY_SHORTAGE_ACCEPTANCE_WITHOUT_JOURNAL__", journal_entry_id: null },
  source_item: { system_quantity: 10, actual_quantity: 9, difference: -1, unit_cost: 40, total_cost: 40 },
  product: { quantity: 9, purchase_price: 40 }, movement_count: 1,
  events: { created: 1 }, effect_count: 0, effect: null, journal: null,
  live_plan: { eligible: true, reason_code: "READY", plan_fingerprint: "plan", correction_lines: lines },
  diagnostic_row: { classification: "movement_without_journal" }, counts,
};

test("استعلام التحقق قراءة فقط ومحدد بتسوية العجز", () => {
  assert.match(verificationSql, /^BEGIN TRANSACTION READ ONLY/);
  assert.match(verificationSql, new RegExp(fixture.adjustmentId));
  assert.match(verificationSql, /adjustment_shortage_verification/);
  assert.doesNotMatch(verificationSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test("يقبل المسودة ويرفض تغير الخطة أو رصيد المنتج", () => {
  assert.equal(validateVerification(draft, "--draft", baseline), draft);
  assert.throws(() => validateVerification({ ...draft, product: { quantity: 8, purchase_price: 40 } }, "--draft", baseline), /inventory_evidence/);
  assert.throws(() => validateVerification({ ...draft, item: { ...draft.item,
    proposed_state: { ...draft.item.proposed_state, correction_lines: lines.slice(0, 1) } } }, "--draft", baseline), /stored_plan/);
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
    journal: { id: "new-journal", status: "posted", posted_number: 321,
      total_debit: 40, total_credit: 39, lines },
    counts: { ...counts, journal_entries: 2, journal_entry_lines: 3,
      repair_effects: 2, repair_events: 5 },
  };
  assert.throws(() => validateVerification(executed, "--executed", baseline), /execution_state/);
  assert.equal(validateVerification({ ...executed, journal: { ...executed.journal,
    total_credit: 40 } }, "--executed", baseline).repair.status, "executed");
});
