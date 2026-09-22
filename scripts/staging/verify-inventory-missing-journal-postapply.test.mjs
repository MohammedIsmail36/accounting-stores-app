import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  validatePostApplySource,
  verificationSql,
} from "./verify-inventory-missing-journal-postapply.mjs";

const source = readFileSync(fileURLToPath(new URL(
  "./verify-inventory-missing-journal-postapply.mjs",
  import.meta.url,
)), "utf8");

test("فاحص ما بعد تطبيق 2D يحتوي حواجز Staging والقراءة فقط", () => {
  assert.doesNotThrow(() => validatePostApplySource(source));
  const sql = verificationSql();
  assert.match(sql, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(sql, /ROLLBACK;/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|COMMIT)\b/i);
  assert.match(sql, /product_card_rebuilt[\s\S]*execute_inventory_reconciliation_repair_rebuild_2c/);
});

test("يرفض الفاحص عند اختفاء هوية Staging", () => {
  assert.throws(
    () => validatePostApplySource(source.replaceAll("dunzfxurefzlaamgghys", "wrong-project")),
    /حاجز تحقق/,
  );
});

test("يرفض الفاحص إذا أضيفت وجهة إنتاجية", () => {
  assert.throws(
    () => validatePostApplySource(`${source}\nfarida.alibea2020.com`),
    /وجهة إنتاجية ممنوعة/,
  );
});
