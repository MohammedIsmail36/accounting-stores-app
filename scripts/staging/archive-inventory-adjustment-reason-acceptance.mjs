// Archive protected transactional acceptance evidence beside its Staging backup.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [backup, reasonDir, zeroDir] = process.argv.slice(2);
if (!backup?.startsWith('/backups/staging/inventory-adjustment-reason-post-before-')
    || !reasonDir?.startsWith('/tmp/accounting-staging-reason-post-rehearsal-')
    || !zeroDir?.startsWith('/tmp/accounting-staging-adjustment-zero-difference-')) {
  throw new Error('حدد النسخة وتقريري قبول الأسباب والفرق الصفري');
}
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const reason = JSON.parse(readFileSync(join(reasonDir, 'report.json'), 'utf8'));
const zero = JSON.parse(readFileSync(join(zeroDir, 'report.json'), 'utf8'));
assert.equal(reason.result, 'STAGING_REASON_CODED_POST_TRANSACTION_OK');
assert.equal(zero.result, 'STAGING_ZERO_DIFFERENCE_TRANSACTION_OK');
assert.equal(reason.backup, backup);
assert.equal(zero.backup, backup);
assert.equal(reason.businessRowsRestored, true);
assert.equal(zero.businessRowsRestored, true);
const archive = join(backup, 'reason-post-and-zero-difference-rehearsal');
mkdirSync(archive, { mode: 0o700 });
const files = [];
for (const [label, source] of [['reason-post', reasonDir], ['zero-difference', zeroDir]]) {
  const target = join(archive, label);
  mkdirSync(target, { mode: 0o700 });
  for (const name of ['rehearsal.sql', 'run.log', 'report.json']) {
    const destination = join(target, name);
    copyFileSync(join(source, name), destination);
    files.push(destination);
  }
}
for (const name of [
  'backup-inventory-adjustment-reason-post-baseline.mjs',
  'rehearse-inventory-adjustment-reason-post.mjs',
  'rehearse-inventory-adjustment-zero-difference.mjs',
]) {
  const destination = join(archive, name);
  copyFileSync(join('/opt/accounting-app/scripts/staging', name), destination);
  files.push(destination);
}
const sums = join(archive, 'SHA256SUMS');
writeFileSync(sums, `${files.map((file) => `${sha(file)}  ${file.slice(archive.length + 1)}`).join('\n')}\n`,
  { mode: 0o600 });
for (const file of files) {
  assert.ok(statSync(file).size > 0);
}
console.log('حُفظ دليل تجربتي الأسباب والفرق الصفري داخل النسخة المحمية');
console.log(`ARCHIVE_DIR=${archive}`);
