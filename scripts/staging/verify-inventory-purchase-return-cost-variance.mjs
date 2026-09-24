// Read-only verifier for the Staging purchase-return cost-variance repair lifecycle.
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extract, fixture } from "./backup-inventory-purchase-return-cost-variance-baseline.mjs";
import { fixture as previousFixture } from "./backup-inventory-tax-purchase-return-acceptance-baseline.mjs";
import { verificationSql as previousSql } from "./verify-inventory-tax-purchase-return-acceptance.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectRef = "dunzfxurefzlaamgghys";
const archive = "/backups/staging/inventory-purchase-return-variance-before-20260924-040046";
const cli = "supabase@2.116.0";
const phases = Object.freeze({
  "--draft": { status: "draft", version: 1 },
  "--submitted": { status: "ready_for_review", version: 2 },
  "--approved": { status: "approved", version: 3 },
  "--executed": { status: "executed", version: 4 },
});

const expectedLines = [
  { account_code: "1104", debit: 0, credit: 50 },
  { account_code: "1105", debit: 0, credit: 6.30 },
  { account_code: "2101", debit: 51.30, credit: 0 },
  { account_code: "5108", debit: 5, credit: 0 },
];

function replaceRequired(source, from, to) {
  if (!source.includes(from)) throw new Error(`تعذر تكييف استعلام التحقق: ${from}`);
  return source.replaceAll(from, to);
}

const priorReturnSql = `'prior_return', (SELECT jsonb_build_object('id', r.id, 'status', r.status,
    'journal_entry_id', r.journal_entry_id, 'journal_status', j.status)
    FROM public.purchase_returns r LEFT JOIN public.journal_entries j ON j.id = r.journal_entry_id
    WHERE r.id = '${fixture.priorReturnId}'::uuid),
  'source_invoice', (SELECT`;
export const verificationSql = replaceRequired(
  replaceRequired(
    replaceRequired(previousSql, previousFixture.returnId, fixture.returnId),
    previousFixture.movementId, fixture.movementId),
  "'source_invoice', (SELECT", priorReturnSql
).replace("purchase_return_verification;", "purchase_return_variance_verification;");
if (!verificationSql.includes("purchase_return_variance_verification;")
    || !verificationSql.includes(fixture.returnId)
    || !verificationSql.includes(fixture.priorReturnId)) throw new Error("استعلام التحقق لم يُحوّل بالكامل");

function linesComparable(lines) {
  return [...(lines ?? [])].map((line) => ({ account_code: String(line.account_code),
    debit: Number(line.debit), credit: Number(line.credit) })).sort((a, b) => a.account_code.localeCompare(b.account_code));
}

function assertStaging() {
  if (readFileSync(join(root, "supabase/.temp/project-ref"), "utf8").trim() !== projectRef) {
    throw new Error("المشروع المرتبط ليس Staging المعتمد");
  }
}

function cliEnvironment() {
  if (process.getuid?.() === 0 && process.env.SUDO_USER !== "deploy") throw new Error("استخدم sudo من حساب deploy فقط");
  const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
  if (!token) throw new Error("جلسة Supabase غير موجودة");
  return { ...process.env, ...(process.getuid?.() === 0 ? { HOME: "/home/deploy" } : {}), SUPABASE_ACCESS_TOKEN: token };
}

export function validateVerification(value, phase, baseline) {
  const expected = phases[phase];
  if (!expected) throw new Error("مرحلة تحقق غير مدعومة");
  const failures = [];
  const repair = value?.repair;
  const item = value?.item;
  const source = value?.source;
  const sourceInvoice = value?.source_invoice;
  const events = value?.events ?? {};
  const counts = value?.counts ?? {};
  const executed = phase === "--executed";
  if (value?.database !== "postgres" || !value?.server_version?.startsWith("17.")
      || typeof value?.configured_prefix !== "string" || !value.configured_prefix.trim()) failures.push("database_identity");
  if (value?.tax_settings?.enable_tax !== true || Number(value?.tax_settings?.tax_rate) !== 14
      || value?.tax_settings?.purchase_code !== "1105" || value?.tax_settings?.sales_code !== "2104") failures.push("tax_settings");
  if (repair?.repair_number !== 54 || repair?.status !== expected.status || repair?.version !== expected.version
      || !repair?.prepared_by) failures.push("repair_header");
  if (item?.axis !== "source" || item?.classification !== "movement_without_journal"
      || item?.repair_type !== "create_missing_inventory_journal" || item?.source_type !== "purchase_return"
      || item?.source_id !== fixture.returnId || item?.source_number !== String(fixture.returnNumber)
      || !item?.precondition_hash) failures.push("repair_item");
  if (source?.return_number !== fixture.returnNumber || source?.purchase_invoice_id !== fixture.sourceInvoiceId
      || source?.status !== "posted" || Number(source?.subtotal) !== 45
      || Number(source?.tax) !== 6.30 || Number(source?.total) !== 51.30
      || sourceInvoice?.invoice_number !== 990023 || sourceInvoice?.status !== "posted"
      || Number(sourceInvoice?.tax) !== 14 || !sourceInvoice?.journal_entry_id
      || value?.prior_return?.id !== fixture.priorReturnId || value?.prior_return?.status !== "posted"
      || value?.prior_return?.journal_status !== "posted" || !value?.prior_return?.journal_entry_id) failures.push("source");
  if (Number(value?.product?.quantity) !== 0 || Number(value?.product?.purchase_price) !== 50
      || Number(value?.movement_count) !== 1) failures.push("inventory_evidence");
  const proposed = linesComparable(item?.proposed_state?.correction_lines);
  if (JSON.stringify(proposed) !== JSON.stringify(linesComparable(expectedLines))
      || item?.proposed_state?.mode !== "create_full_journal" || !item?.proposed_state?.plan_fingerprint) failures.push("stored_plan");
  const expectedEvents = ["created", "submitted", "approved", "executed"].slice(0, expected.version);
  if (Object.keys(events).length !== expected.version || expectedEvents.some((event) => Number(events[event]) !== 1)) failures.push("events");
  const deltas = { inventory_movements: 1, purchase_returns: 1, purchase_return_items: 1,
    journal_entries: executed ? 1 : 0, journal_entry_lines: executed ? 4 : 0,
    repairs: 1, repair_items: 1, repair_effects: executed ? 1 : 0, repair_events: expected.version };
  for (const [key, original] of Object.entries(baseline?.counts ?? {})) {
    if (Number(counts[key]) !== Number(original) + (deltas[key] ?? 0)) failures.push(`count_${key}`);
  }
  if (!executed) {
    if (source?.journal_entry_id !== null || item?.result_status !== "pending"
        || Number(value?.effect_count) !== 0 || value?.effect !== null
        || value?.live_plan?.eligible !== true || value?.live_plan?.reason_code !== "READY"
        || value?.live_plan?.plan_fingerprint !== item?.proposed_state?.plan_fingerprint
        || JSON.stringify(linesComparable(value?.live_plan?.correction_lines)) !== JSON.stringify(linesComparable(expectedLines))
        || value?.diagnostic_row?.classification !== "movement_without_journal") failures.push("pre_execution_state");
  } else {
    const journal = value?.journal;
    if (!source?.journal_entry_id || item?.result_status !== "applied" || Number(value?.effect_count) !== 1
        || value?.effect?.effect_type !== "missing_inventory_journal_created"
        || value?.effect?.table_name !== "journal_entries" || value?.effect?.record_id !== source.journal_entry_id
        || journal?.id !== source.journal_entry_id || journal?.status !== "posted"
        || !Number.isInteger(journal?.posted_number) || Number(journal?.total_debit) !== 56.30
        || Number(journal?.total_credit) !== 56.30
        || JSON.stringify(linesComparable(journal?.lines)) !== JSON.stringify(linesComparable(expectedLines))
        || value?.live_plan?.eligible !== false || value?.live_plan?.reason_code !== "NO_CORRECTION_REQUIRED"
        || (value?.diagnostic_row !== null && (value?.diagnostic_row?.classification !== "matched"
          || Number(value?.diagnostic_row?.source_difference) !== 0))) failures.push("execution_state");
  }
  if (failures.length) throw new Error(`فشل تحقق فرق تكلفة مرتجع الشراء: ${failures.join(",")}`);
  return value;
}

function main() {
  const phase = process.argv[2];
  if (!phases[phase] || process.argv.length !== 3) throw new Error("استخدم --draft أو --submitted أو --approved أو --executed");
  assertStaging();
  process.umask(0o077);
  const dir = mkdtempSync(`/tmp/accounting-staging-purchase-return-variance-${phase.slice(2)}-verification-`);
  chmodSync(dir, 0o700);
  const sqlPath = join(dir, "verification.sql");
  const logPath = join(dir, "run.log");
  writeFileSync(sqlPath, verificationSql, { mode: 0o600 });
  const result = spawnSync("npx", ["-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", sqlPath], {
    cwd: root, env: cliEnvironment(), encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n`, { mode: 0o600 });
  if (result.status !== 0 || result.error || /"error"\s*:/.test(result.stdout ?? "")) {
    throw new Error(`فشل استعلام تحقق فرق التكلفة؛ التشخيص: ${logPath}`);
  }
  const baseline = JSON.parse(readFileSync(join(archive, "baseline.json"), "utf8"));
  const value = validateVerification(extract(result.stdout, "purchase_return_variance_verification"), phase, baseline);
  const officialJournalNumber = phase === "--executed"
    ? `${value.configured_prefix}${String(value.journal.posted_number).padStart(4, "0")}` : null;
  writeFileSync(join(dir, "report.json"), `${JSON.stringify({ ...value, phase, officialJournalNumber,
    projectRef, readOnly: true, productionModified: false, verifiedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  console.log(`نجح تحقق فرق تكلفة مرتجع الشراء في مرحلة ${phase.slice(2)} دون كتابة على Staging`);
  console.log(`REPAIR=IR-${String(value.repair.repair_number).padStart(4, "0")} STATUS=${value.repair.status} VERSION=${value.repair.version}`);
  if (officialJournalNumber) console.log(`JOURNAL=${officialJournalNumber}`);
  console.log(`REPORT_DIR=${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
