// Read-only L3 audit: compare the frozen Staging history with repository files.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSnapshot } from './rehearse-public-restore.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const migrationsDir = join(root, 'supabase/migrations');
const transitionFile = '20260907091000_neutral_migration_tracking.sql';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function audit(files, historyRows, columns) {
  const at = Object.fromEntries(columns.map((column, index) => [column, index]));
  for (const required of ['version', 'filename', 'checksum']) {
    if (!Number.isInteger(at[required])) throw new Error(`History is missing ${required}`);
  }
  const recorded = new Map();
  for (const row of historyRows) {
    const fields = row.split('\t');
    const version = fields[at.version];
    if (recorded.has(version)) throw new Error(`Duplicate recorded version: ${version}`);
    recorded.set(version, { filename: fields[at.filename], checksum: fields[at.checksum] });
  }
  const current = new Map();
  for (const file of files) {
    if (!/^\d{14}_[A-Za-z0-9_-]+\.sql$/.test(file.filename)) throw new Error(`Invalid migration filename: ${file.filename}`);
    const version = basename(file.filename, '.sql');
    if (current.has(version)) throw new Error(`Duplicate local version: ${version}`);
    current.set(version, file);
  }
  const pending = [];
  const missing = [];
  const filenameDrift = [];
  const checksumDrift = [];
  for (const [version, file] of current) {
    const old = recorded.get(version);
    if (!old) pending.push(file.filename);
    else {
      if (old.filename !== file.filename) filenameDrift.push(file.filename);
      if (old.checksum !== file.checksum) checksumDrift.push(file.filename);
    }
  }
  for (const [version, old] of recorded) {
    if (!current.has(version)) missing.push(old.filename);
  }
  return { localFiles: current.size, recordedVersions: recorded.size,
    pending: pending.sort(), missing: missing.sort(), filenameDrift: filenameDrift.sort(),
    checksumDrift: checksumDrift.sort() };
}

function main() {
  const snapshot = loadSnapshot();
  const tracking = snapshot.tables.filter((table) => table.name.endsWith('_schema_migrations'));
  if (tracking.length !== 1) throw new Error('Expected exactly one migration-history table in snapshot');
  const files = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => ({ filename: entry.name, checksum: sha256(readFileSync(join(migrationsDir, entry.name))) }));
  const result = audit(files, tracking[0].rows, tracking[0].columns);
  if (result.recordedVersions !== 96 || result.localFiles !== 97
      || result.missing.length || result.filenameDrift.length
      || result.pending.length !== 1 || result.pending[0] !== transitionFile) {
    throw new Error(`MIGRATION_DRY_RUN_BLOCKED ${JSON.stringify(result)}`);
  }
  console.log(`MIGRATION_DRY_RUN_OK local=${result.localFiles} recorded=${result.recordedVersions} pending=1 historical_replay=0`);
  console.log(`PENDING ${result.pending[0]}`);
  console.log(`HISTORICAL_CHECKSUM_DRIFT_WARNING count=${result.checksumDrift.length}`);
  for (const filename of result.checksumDrift) console.log(`DRIFT ${filename}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
