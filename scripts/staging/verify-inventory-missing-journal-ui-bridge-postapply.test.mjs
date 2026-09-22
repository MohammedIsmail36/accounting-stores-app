import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateSource,
  verificationSql,
} from "./verify-inventory-missing-journal-ui-bridge-postapply.mjs";

const source = readFileSync(fileURLToPath(new URL(
  "./verify-inventory-missing-journal-ui-bridge-postapply.mjs",
  import.meta.url,
)), "utf8");

test("فاحص ما بعد تطبيق جسر 2D-C مقيد بـ Staging والقراءة فقط", () => {
  assert.doesNotThrow(() => validateSource(source));
  const sql = verificationSql();
  assert.match(sql, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(sql, /ROLLBACK;/);
  assert.match(sql, /20260922070000/);
  assert.match(sql, /trg_prepare_inventory_missing_journal_repair_item/);
  assert.match(sql, /get_inventory_reconciliation_journal_plan/);
  assert.match(sql, /old_data - 'updated_at'/);
  assert.match(sql, /business_changes/);
});

test("يرفض وقت خط أساس غير صالح", () => {
  assert.throws(() => verificationSql("غير صالح"), /وقت خط الأساس/);
});

test("يرفض الفاحص عند اختفاء هوية Staging", () => {
  assert.throws(
    () => validateSource(source.replaceAll("dunzfxurefzlaamgghys", "wrong-project")),
    /حاجز تحقق/,
  );
});

test("يرفض الفاحص عند إضافة وجهة إنتاجية", () => {
  assert.throws(
    () => validateSource(`${source}\nfarida.alibea2020.com`),
    /وجهة إنتاجية ممنوعة/,
  );
});
