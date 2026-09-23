import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  sameBaseline,
  stagingContract,
} from "./rehearse-inventory-configurable-tax-accounts.mjs";

const source = readFileSync(fileURLToPath(new URL(
  "./rehearse-inventory-configurable-tax-accounts.mjs", import.meta.url,
)), "utf8");

test("تجربة حسابات الضريبة مقيدة بـStaging وROLLBACK", () => {
  for (const required of [
    "dunzfxurefzlaamgghys",
    "inventory-configurable-tax-before-20260923-055349",
    "BEGIN;",
    "ROLLBACK;",
    "STAGING_20260923100000",
    "STAGING_CONFIGURABLE_TAX_ACCOUNTS_EXPLICIT_ROLLBACK_OK",
    "productionModified: false",
  ]) assert.ok(source.includes(required), `حاجز مفقود: ${required}`);
  for (const forbidden of [
    ["farida", "-db"].join(""),
    ["alibea", "-db"].join(""),
    ["farida", ".alibea2020.com"].join(""),
    ["alibea", ".alibea2020.com"].join(""),
  ]) assert.equal(source.includes(forbidden), false, `وجهة إنتاجية ممنوعة: ${forbidden}`);
});

test("تحويل عقد L3 يزيل دوال الهوية ويحوّل حارس القاعدة", () => {
  const input = `\\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF current_database() <> 'l3_public_restore' THEN NULL; END IF; END $$;
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text LANGUAGE sql AS $$ SELECT 'x' $$;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
SELECT 'ok';
ROLLBACK;`;
  const output = stagingContract(input);
  assert.match(output, /current_database\(\) <> 'postgres'/);
  assert.doesNotMatch(output, /l3_public_restore|CREATE OR REPLACE FUNCTION auth\./);
  assert.match(output, /ROLLBACK;/);
});

test("مقارنة خط الأساس لا تتأثر بترتيب مفاتيح JSON", () => {
  assert.equal(sameBaseline({ b: 2, a: { d: 4, c: 3 } }, { a: { c: 3, d: 4 }, b: 2 }), true);
  const baseline = {
    database: "postgres",
    server_version: "17.6",
    project_ref: "dunzfxurefzlaamgghys",
    counts: { products: 1 },
    signatures: { products: "same" },
    diagnostic: { status: "matched", generated_at: "first" },
  };
  assert.equal(sameBaseline(
    { ...baseline, diagnostic: { ...baseline.diagnostic, generated_at: "second" } },
    baseline,
  ), true);
  assert.equal(sameBaseline({ ...baseline, counts: { products: 2 } }, baseline), false);
});
