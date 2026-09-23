import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateRehearsalSource } from "./rehearse-journal-posted-number-invariant.mjs";

const source = readFileSync(
  fileURLToPath(new URL("./rehearse-journal-posted-number-invariant.mjs", import.meta.url)),
  "utf8",
);

test("تجربة ترقيم القيود مقيدة بـStaging ومعاملة راجعة", () => {
  assert.doesNotThrow(() => validateRehearsalSource(source));
  for (const required of [
    "baseline-preflight",
    "forward-and-explicit-rollback",
    "post-rollback-baseline",
    "createGatewayAutoNumberVerified",
    "configuredPrefixUntouched",
  ]) assert.ok(source.includes(required), `شرط مفقود: ${required}`);
});

test("لا توجد وجهة إنتاجية أو اعتماد على بادئة ثابتة داخل SQL", () => {
  for (const forbidden of [
    ["farida", "-db"].join(""),
    ["alibea", "-db"].join(""),
    ["farida", ".alibea2020.com"].join(""),
    ["alibea", ".alibea2020.com"].join(""),
  ]) assert.equal(source.includes(forbidden), false, `وجهة ممنوعة: ${forbidden}`);
  assert.equal(source.includes("'JV-'"), false);
});
