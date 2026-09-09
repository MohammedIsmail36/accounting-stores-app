import test from 'node:test';
import assert from 'node:assert/strict';
import { audit } from './audit-migration-history.mjs';

const columns = ['version', 'filename', 'checksum', 'executed_at'];
const row = (version, filename, checksum) => `${version}\t${filename}\t${checksum}\t2026-01-01 00:00:00+00`;
const file = (filename, checksum) => ({ filename, checksum });

test('audit separates one pending migration from recorded history', () => {
  const result = audit([
    file('20260101000000_first.sql', 'same'),
    file('20260102000000_second.sql', 'new'),
  ], [row('20260101000000_first', '20260101000000_first.sql', 'same')], columns);
  assert.deepEqual(result.pending, ['20260102000000_second.sql']);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.filenameDrift, []);
  assert.deepEqual(result.checksumDrift, []);
});

test('checksum drift never becomes a pending migration or historical replay', () => {
  const result = audit(
    [file('20260101000000_first.sql', 'current')],
    [row('20260101000000_first', '20260101000000_first.sql', 'recorded')], columns,
  );
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.checksumDrift, ['20260101000000_first.sql']);
  assert.equal(result.recordedVersions, 1);
  assert.equal(result.localFiles, 1);
});

test('audit reports missing and renamed history distinctly', () => {
  const result = audit(
    [file('20260101000000_changed.sql', 'same')],
    [
      row('20260101000000_changed', '20260101000000_original.sql', 'same'),
      row('20260102000000_missing', '20260102000000_missing.sql', 'same'),
    ], columns,
  );
  assert.deepEqual(result.filenameDrift, ['20260101000000_changed.sql']);
  assert.deepEqual(result.missing, ['20260102000000_missing.sql']);
});

test('audit rejects malformed or duplicate local and recorded versions', () => {
  assert.throws(() => audit([file('bad.sql', 'x')], [], columns));
  assert.throws(() => audit([
    file('20260101000000_same.sql', 'x'), file('20260101000000_same.sql', 'x'),
  ], [], columns));
  assert.throws(() => audit([], [
    row('20260101000000_same', '20260101000000_same.sql', 'x'),
    row('20260101000000_same', '20260101000000_same.sql', 'x'),
  ], columns));
  assert.throws(() => audit([], [], ['version', 'filename']));
});
