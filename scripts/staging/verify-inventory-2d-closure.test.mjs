import assert from "node:assert/strict";
import test from "node:test";
import { expectedSources, validateClosure, verificationSql } from "./verify-inventory-2d-closure.mjs";

function validResult() {
  return { database: "postgres", server_version: "17.6", configured_prefix: "JV-",
    rows: expectedSources.map(([number, sourceType, sourceNumber]) => ({
      expected_repair_number: number, expected_source_type: sourceType, expected_source_number: sourceNumber,
      repair_number: number, repair_status: "executed", version: 4, source_type: sourceType,
      source_number: sourceNumber, result_status: "applied", source_status: "posted",
      effect_count: 1, effect_type: "missing_inventory_journal_created",
      effect_record_id: `journal-${number}`, linked_journal_id: `journal-${number}`, event_count: 4,
      journal_status: "posted", posted_number: number + 270, total_debit: 40, total_credit: 40,
      lines_debit: 40, lines_credit: 40, line_count: 2,
      plan_reason: "NO_CORRECTION_REQUIRED", source_issue_count: 0,
    })),
    global: { products: 617, movements: 1375, adjustments: 4, journals: 322,
      journal_lines: 865, repairs: 12, effects: 10, posted_without_number: 0,
      duplicate_posted_numbers: 0, diagnostic: { status: "rounding_only",
        issue_counts: { sources: 2, rounding: 2, products: 0, unlinked_journals: 0, unlinked_movements: 0 },
        totals: { quantity_difference: 0 } } },
  };
}

test("مراجعة إغلاق 2D قراءة فقط وتشمل خرائط القبول التسع", () => {
  assert.match(verificationSql, /^BEGIN TRANSACTION READ ONLY/);
  assert.match(verificationSql, /ROLLBACK;\s*$/);
  assert.equal(expectedSources.length, 9);
  assert.doesNotMatch(verificationSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test("تقبل الحالات التسع وترفض قيدًا غير متزن أو انحرافًا متبقيًا", () => {
  const valid = validResult();
  assert.equal(validateClosure(valid), valid);
  assert.throws(() => validateClosure({ ...valid, rows: valid.rows.map((row) => row.repair_number === 56
    ? { ...row, total_credit: 39 } : row) }), /journal_56/);
  assert.throws(() => validateClosure({ ...valid, rows: valid.rows.map((row) => row.repair_number === 55
    ? { ...row, source_issue_count: 1 } : row) }), /reconciliation_55/);
});
