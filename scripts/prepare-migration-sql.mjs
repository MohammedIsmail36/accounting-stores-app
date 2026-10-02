#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const transactionControl = /^\s*(?:(?:BEGIN|COMMIT|ROLLBACK)(?:\s+(?:WORK|TRANSACTION))?|START\s+TRANSACTION)\s*;\s*(?:--.*)?$/i;
const transactionStart = /^\s*(?:BEGIN(?:\s+(?:WORK|TRANSACTION))?|START\s+TRANSACTION)\s*;\s*(?:--.*)?$/i;
const transactionEnd = /^\s*COMMIT(?:\s+(?:WORK|TRANSACTION))?\s*;\s*(?:--.*)?$/i;

function isBlankOrLineComment(line) {
  return /^\s*(?:--.*)?$/.test(line);
}

export function prepareMigrationSql(sql) {
  const lines = sql.split(/\r?\n/);
  const significant = [];
  const controls = [];

  lines.forEach((line, index) => {
    if (!isBlankOrLineComment(line)) significant.push(index);
    if (transactionControl.test(line)) controls.push(index);
  });

  if (controls.length === 0) return sql;

  const first = significant[0];
  const last = significant.at(-1);
  if (
    controls.length !== 2 ||
    controls[0] !== first ||
    controls[1] !== last ||
    !transactionStart.test(lines[first]) ||
    !transactionEnd.test(lines[last])
  ) {
    throw new Error('SQL transaction control must be a single outer BEGIN/COMMIT pair');
  }

  // The migration runner supplies the only transaction, including its history row.
  return lines.filter((_, index) => index !== first && index !== last).join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    process.stderr.write('Usage: prepare-migration-sql.mjs FILE\n');
    process.exitCode = 2;
  } else {
    try {
      process.stdout.write(prepareMigrationSql(readFileSync(process.argv[2], 'utf8')));
    } catch (error) {
      process.stderr.write('Unsafe migration transaction boundary: ' + error.message + '\n');
      process.exitCode = 1;
    }
  }
}
