import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateFirstDraftVerifierSource } from "./verify-inventory-repair-first-draft.mjs";

const sourcePath = fileURLToPath(new URL("./verify-inventory-repair-first-draft.mjs", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

test("first-draft verifier is read-only, staging-bound, and baseline-aware", () => {
  assert.doesNotThrow(() => validateFirstDraftVerifierSource(source));
  assert.match(source, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(source, /repair_counts/);
  assert.match(source, /businessBaselinePreserved: true/);
  assert.doesNotMatch(source, /INSERT INTO|UPDATE public\.|DELETE FROM/);
});

test("first-draft verifier rejects a production target", () => {
  const unsafe = `${source}\n${["farida", "-db"].join("")}`;
  assert.throws(() => validateFirstDraftVerifierSource(unsafe), /وجهة إنتاجية ممنوعة/);
});
