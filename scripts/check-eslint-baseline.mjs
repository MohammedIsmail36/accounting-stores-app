#!/usr/bin/env node

import { ESLint } from "eslint";

const limits = Object.freeze({
  explicitAnyWarnings: 997,
  otherWarnings: 81,
});

const eslint = new ESLint();
const results = await eslint.lintFiles(["."]);

let errors = 0;
let explicitAnyWarnings = 0;
let otherWarnings = 0;

for (const result of results) {
  errors += result.errorCount;
  for (const message of result.messages) {
    if (message.severity !== 1) continue;
    if (message.ruleId === "@typescript-eslint/no-explicit-any") {
      explicitAnyWarnings += 1;
    } else {
      otherWarnings += 1;
    }
  }
}

console.log(
  `ESLINT_BASELINE errors=${errors} explicit_any=${explicitAnyWarnings}/${limits.explicitAnyWarnings} other_warnings=${otherWarnings}/${limits.otherWarnings}`,
);

const failures = [];
if (errors > 0) failures.push(`${errors} blocking error(s)`);
if (explicitAnyWarnings > limits.explicitAnyWarnings) {
  failures.push(
    `explicit-any warnings increased from ${limits.explicitAnyWarnings} to ${explicitAnyWarnings}`,
  );
}
if (otherWarnings > limits.otherWarnings) {
  failures.push(
    `other warnings increased from ${limits.otherWarnings} to ${otherWarnings}`,
  );
}

if (failures.length > 0) {
  console.error(`ESLint baseline failed: ${failures.join("; ")}.`);
  process.exitCode = 1;
} else {
  console.log("ESLint baseline passed: no lint regression detected.");
}
