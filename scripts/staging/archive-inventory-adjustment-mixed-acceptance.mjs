// Archive read-only before/after evidence for Staging adjustment #35.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const [backup, beforeDir, afterDir] = process.argv.slice(2);
if (!backup?.startsWith('/backups/staging/inventory-adjustment-reason-post-before-')
    || !beforeDir?.startsWith('/tmp/accounting-staging-mixed-adjustment-verification-')
    || !afterDir?.startsWith('/tmp/accounting-staging-mixed-adjustment-verification-')
    || beforeDir === afterDir) {
  throw new Error('حدد النسخة وتقريرَي فحص المسودة والتنفيذ');
}
const before = JSON.parse(readFileSync(join(beforeDir, 'report.json'), 'utf8'));
const after = JSON.parse(readFileSync(join(afterDir, 'report.json'), 'utf8'));
assert.equal(before.result, 'STAGING_MIXED_ADJUSTMENT_DRAFT_OK');
assert.equal(after.result, 'STAGING_MIXED_ADJUSTMENT_POSTED_OK');
assert.equal(before.backup, backup);
assert.equal(after.backup, backup);
assert.equal(before.document.id, after.document.id);
assert.equal(before.document.number, 35);
assert.equal(after.document.posted_number, 3);
assert.equal(after.journal.posted_number, 325);

const archive = join(backup, 'mixed-adjustment-35-acceptance');
mkdirSync(archive, { mode: 0o700 });
const files = [];
for (const [label, source] of [['before-post', beforeDir], ['after-post', afterDir]]) {
  const target = join(archive, label);
  mkdirSync(target, { mode: 0o700 });
  for (const name of ['verification.sql', 'run.log', 'report.json']) {
    const destination = join(target, name);
    copyFileSync(join(source, name), destination);
    files.push(destination);
  }
}
for (const [source, name] of [
  ['/opt/accounting-app/scripts/staging/verify-inventory-adjustment-mixed-acceptance.mjs', 'verifier.mjs'],
  ['/opt/accounting-app/scripts/staging/backup-inventory-adjustment-reason-post-baseline.mjs', 'backup-script.mjs'],
  ['/opt/accounting-app/docs/INVENTORY_ADJUSTMENT_MIXED_STAGING_ACCEPTANCE_2026-09-27.md', 'acceptance-plan.md'],
]) {
  const destination = join(archive, name);
  copyFileSync(source, destination);
  files.push(destination);
}
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
for (const file of files) assert.ok(statSync(file).size > 0);
const sums = join(archive, 'SHA256SUMS');
writeFileSync(sums, `${files.map((file) => `${sha(file)}  ${relative(archive, file)}`).join('\n')}\n`,
  { mode: 0o600 });
console.log('حُفظ دليل قبول التسوية #35 قبل الترحيل وبعده وتحققت بصماته');
console.log(`ARCHIVE_DIR=${archive}`);
