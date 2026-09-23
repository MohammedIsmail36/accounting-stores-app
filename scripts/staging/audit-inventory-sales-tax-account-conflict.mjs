// Read-only audit of the legacy 2102 collision before creating a dedicated output-tax account.
import { chmodSync, chownSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const cli = "supabase@2.116.0";

function assertStagingLink() {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التدقيق: المشروع المرتبط ليس Staging المعتمد");
  }
}

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") throw new Error("شغّل التدقيق بواسطة sudo من حساب deploy فقط");
    const token = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
    if (!token) throw new Error("جلسة Supabase للمستخدم deploy غير موجودة");
    return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: token };
  }
  return process.env;
}

function returnOutputToCaller(path) {
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  if (Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) chownSync(path, uid, gid);
}

export function extractNamedPayload(output, name) {
  const parsed = typeof output === "string" ? JSON.parse(output) : output;
  const visit = (value) => {
    if (!value || typeof value !== "object") return undefined;
    if (Object.prototype.hasOwnProperty.call(value, name)) return value[name];
    for (const child of Object.values(value)) {
      const found = visit(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return visit(parsed);
}

export const auditSql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
WITH target AS (
  SELECT * FROM public.accounts WHERE code = '2102'
), target_usage AS (
  SELECT jsonb_build_object(
    'journal_lines', (SELECT count(*) FROM public.journal_entry_lines l JOIN target t ON t.id = l.account_id),
    'journal_debit', (SELECT COALESCE(sum(l.debit), 0) FROM public.journal_entry_lines l JOIN target t ON t.id = l.account_id),
    'journal_credit', (SELECT COALESCE(sum(l.credit), 0) FROM public.journal_entry_lines l JOIN target t ON t.id = l.account_id),
    'child_accounts', (SELECT count(*) FROM public.accounts a JOIN target t ON t.id = a.parent_id),
    'expense_types', (SELECT count(*) FROM public.expense_types e JOIN target t ON t.id = e.account_id),
    'purchase_tax_settings', (SELECT count(*) FROM public.company_settings s JOIN target t ON t.id = s.purchase_tax_account_id),
    'sales_tax_settings', (SELECT count(*) FROM public.company_settings s JOIN target t ON t.id = s.sales_tax_account_id),
    'audit_events', (SELECT count(*) FROM public.audit_log x JOIN target t ON t.id::text = x.record_id WHERE x.table_name = 'accounts')
  ) AS value
), liability_accounts AS (
  SELECT a.id, a.code, a.name, a.account_type, a.is_active, a.is_parent, a.is_system,
         p.code AS parent_code,
         (SELECT count(*) FROM public.journal_entry_lines l WHERE l.account_id = a.id) AS journal_lines,
         (SELECT count(*) FROM public.accounts c WHERE c.parent_id = a.id) AS child_accounts
  FROM public.accounts a
  LEFT JOIN public.accounts p ON p.id = a.parent_id
  WHERE a.account_type = 'liability' AND a.code LIKE '21%'
), audit_history AS (
  SELECT x.action, x.created_at, x.old_data, x.new_data
  FROM public.audit_log x
  JOIN target t ON t.id::text = x.record_id
  WHERE x.table_name = 'accounts'
  ORDER BY x.created_at, x.id
)
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'project_ref', '${expectedProjectRef}',
  'migration_present', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923100000'
  ),
  'target_2102', (SELECT to_jsonb(t) FROM target t),
  'target_2102_count', (SELECT count(*) FROM target),
  'target_2102_usage', (SELECT value FROM target_usage),
  'target_2102_audit_history', COALESCE((SELECT jsonb_agg(to_jsonb(h)) FROM audit_history h), '[]'::jsonb),
  'liability_21xx', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.code, a.id) FROM liability_accounts a), '[]'::jsonb),
  'code_availability', jsonb_build_object(
    '2104', NOT EXISTS (SELECT 1 FROM public.accounts WHERE code = '2104'),
    '2105', NOT EXISTS (SELECT 1 FROM public.accounts WHERE code = '2105'),
    '2106', NOT EXISTS (SELECT 1 FROM public.accounts WHERE code = '2106')
  ),
  'referencing_foreign_keys', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'table', con.conrelid::regclass::text,
      'constraint', con.conname,
      'definition', pg_get_constraintdef(con.oid)
    ) ORDER BY con.conrelid::regclass::text, con.conname)
    FROM pg_constraint con
    WHERE con.contype = 'f' AND con.confrelid = 'public.accounts'::regclass
  ), '[]'::jsonb)
) AS sales_tax_account_audit;
ROLLBACK;
`;

export function validateAudit(report) {
  const failures = [];
  if (!report) failures.push("report_missing");
  if (report?.database !== "postgres") failures.push("database_identity");
  if (report?.project_ref !== expectedProjectRef) failures.push("project_identity");
  if (!report?.server_version?.startsWith("17.")) failures.push("server_version");
  if (!report?.migration_present) failures.push("configurable_tax_migration_missing");
  if (Number(report?.target_2102_count) !== 1 || !report?.target_2102) failures.push("target_2102_identity");
  if (!report?.target_2102_usage || !Array.isArray(report?.liability_21xx)) failures.push("audit_payload_invalid");
  if (!report?.code_availability || !Array.isArray(report?.referencing_foreign_keys)) failures.push("dependency_payload_invalid");
  if (failures.length > 0) throw new Error(`تدقيق تعارض 2102 غير آمن: ${failures.join(",")}`);
  return report;
}

function runCli(queryPath, logPath) {
  const result = spawnSync("npx", ["-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", queryPath], {
    cwd: root,
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}`, { mode: 0o600 });
  if (result.status !== 0 || result.error) throw new Error(`فشل تدقيق تعارض حساب 2102؛ التشخيص: ${logPath}`);
  return result.stdout;
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المدقق لا يقبل معاملات");
  assertStagingLink();
  process.umask(0o077);
  const outputDir = mkdtempSync("/tmp/accounting-staging-sales-tax-account-audit-");
  chmodSync(outputDir, 0o700);
  const queryPath = join(outputDir, "audit.sql");
  const reportPath = join(outputDir, "report.json");
  const logPath = join(outputDir, "run.log");
  writeFileSync(queryPath, auditSql, { mode: 0o600 });
  try {
    const output = runCli(queryPath, logPath);
    const report = validateAudit(extractNamedPayload(output, "sales_tax_account_audit"));
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    for (const path of [outputDir, queryPath, reportPath, logPath]) returnOutputToCaller(path);
    console.log("نجح تدقيق تعارض حساب ضريبة المخرجات على Staging للقراءة فقط");
    console.log(`TARGET_2102=${JSON.stringify(report.target_2102)}`);
    console.log(`TARGET_2102_USAGE=${JSON.stringify(report.target_2102_usage)}`);
    console.log(`LIABILITY_21XX=${JSON.stringify(report.liability_21xx)}`);
    console.log(`CODE_AVAILABILITY=${JSON.stringify(report.code_availability)}`);
    console.log(`REFERENCING_FOREIGN_KEYS=${report.referencing_foreign_keys.length}`);
    console.log(`REPORT_DIR=${outputDir}`);
  } catch (error) {
    for (const path of [outputDir, queryPath, logPath]) returnOutputToCaller(path);
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
