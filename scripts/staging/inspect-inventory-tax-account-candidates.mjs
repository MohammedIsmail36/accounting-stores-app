// Read-only inspection of tax-account candidates before the controlled 2D tax acceptance case.
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
    throw new Error("رُفض الفحص: المشروع المرتبط ليس Staging المعتمد");
  }
}

function cliEnvironment() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.env.SUDO_USER !== "deploy") {
      throw new Error("شغّل الفحص بواسطة sudo من حساب deploy فقط");
    }
    const accessToken = readFileSync("/home/deploy/.supabase/access-token", "utf8").trim();
    if (!accessToken) throw new Error("جلسة Supabase للمستخدم deploy غير موجودة");
    return { ...process.env, HOME: "/home/deploy", SUPABASE_ACCESS_TOKEN: accessToken };
  }
  return process.env;
}

function returnOutputToCaller(path) {
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  if (Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) {
    chownSync(path, uid, gid);
  }
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

export const inspectionSql = `BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
WITH account_usage AS (
  SELECT a.id,
         count(l.id)::integer AS journal_line_count,
         COALESCE(sum(l.debit), 0)::numeric AS total_debit,
         COALESCE(sum(l.credit), 0)::numeric AS total_credit
  FROM public.accounts a
  LEFT JOIN public.journal_entry_lines l ON l.account_id = a.id
  GROUP BY a.id
), candidates AS (
  SELECT a.id, a.code, a.name, a.account_type, a.is_active, a.is_parent, a.is_system,
         p.code AS parent_code, p.name AS parent_name,
         u.journal_line_count, u.total_debit, u.total_credit,
         EXISTS (SELECT 1 FROM public.company_settings s WHERE s.purchase_tax_account_id = a.id)
           AS configured_for_purchase,
         EXISTS (SELECT 1 FROM public.company_settings s WHERE s.sales_tax_account_id = a.id)
           AS configured_for_sales
  FROM public.accounts a
  LEFT JOIN public.accounts p ON p.id = a.parent_id
  JOIN account_usage u ON u.id = a.id
  WHERE a.code IN ('1105', '1106', '2102', '2103')
     OR a.name ILIKE '%ضريب%'
     OR a.name ILIKE '%tax%'
     OR a.name ILIKE '%vat%'
)
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'project_ref', '${expectedProjectRef}',
  'migration_present', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260923100000'
  ),
  'guards', jsonb_build_object(
    'settings_validator', to_regprocedure('public.fn_validate_company_tax_account_mapping()') IS NOT NULL,
    'account_guard', to_regprocedure('public.fn_guard_configured_tax_account_shape()') IS NOT NULL
  ),
  'settings', (
    SELECT jsonb_build_object(
      'id', s.id,
      'enable_tax', s.enable_tax,
      'tax_rate', s.tax_rate,
      'purchase_tax_account_id', s.purchase_tax_account_id,
      'sales_tax_account_id', s.sales_tax_account_id
    )
    FROM public.company_settings s
    ORDER BY s.created_at
    LIMIT 1
  ),
  'settings_count', (SELECT count(*) FROM public.company_settings),
  'purchase_candidates', COALESCE((
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.code, c.id)
    FROM candidates c
    WHERE c.account_type = 'asset' AND c.is_active IS TRUE AND c.is_parent IS FALSE
  ), '[]'::jsonb),
  'sales_candidates', COALESCE((
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.code, c.id)
    FROM candidates c
    WHERE c.account_type = 'liability' AND c.is_active IS TRUE AND c.is_parent IS FALSE
  ), '[]'::jsonb),
  'rejected_tax_like_accounts', COALESCE((
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.code, c.id)
    FROM candidates c
    WHERE NOT (
      c.is_active IS TRUE AND c.is_parent IS FALSE
      AND c.account_type IN ('asset', 'liability')
    )
  ), '[]'::jsonb)
) AS tax_account_inspection;
ROLLBACK;
`;

export function validateInspection(report) {
  const failures = [];
  if (!report) failures.push("report_missing");
  if (report?.database !== "postgres") failures.push("database_identity");
  if (report?.project_ref !== expectedProjectRef) failures.push("project_identity");
  if (!report?.server_version?.startsWith("17.")) failures.push("server_version");
  if (!report?.migration_present) failures.push("configurable_tax_migration_missing");
  if (!report?.guards?.settings_validator || !report?.guards?.account_guard) {
    failures.push("tax_guards_missing");
  }
  if (Number(report?.settings_count) !== 1 || !report?.settings) failures.push("settings_identity");
  if (!Array.isArray(report?.purchase_candidates) || !Array.isArray(report?.sales_candidates)) {
    failures.push("candidate_payload_invalid");
  }
  if (failures.length > 0) {
    throw new Error(`فحص مرشحي حسابات الضريبة غير آمن: ${failures.join(",")}`);
  }
  return report;
}

function runCli(queryPath, logPath) {
  assertStagingLink();
  const result = spawnSync("npx", ["-y", cli, "db", "query", "--linked", "--output-format", "json", "--file", queryPath], {
    cwd: root,
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(logPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}`, { mode: 0o600 });
  if (result.status !== 0 || result.error) {
    throw new Error(`فشل فحص مرشحي حسابات الضريبة؛ التشخيص: ${logPath}`);
  }
  return result.stdout;
}

function summarize(candidates) {
  return candidates.map((candidate) => ({
    code: candidate.code,
    name: candidate.name,
    id: candidate.id,
    parent: candidate.parent_code,
    journal_lines: candidate.journal_line_count,
    debit: candidate.total_debit,
    credit: candidate.total_credit,
    system: candidate.is_system,
  }));
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا الفاحص لا يقبل معاملات");
  assertStagingLink();
  process.umask(0o077);
  const outputDir = mkdtempSync("/tmp/accounting-staging-tax-account-inspection-");
  chmodSync(outputDir, 0o700);
  const queryPath = join(outputDir, "inspection.sql");
  const reportPath = join(outputDir, "report.json");
  const logPath = join(outputDir, "run.log");
  writeFileSync(queryPath, inspectionSql, { mode: 0o600 });

  try {
    const output = runCli(queryPath, logPath);
    const report = validateInspection(extractNamedPayload(output, "tax_account_inspection"));
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    returnOutputToCaller(outputDir);
    returnOutputToCaller(queryPath);
    returnOutputToCaller(reportPath);
    returnOutputToCaller(logPath);

    console.log("نجح فحص حسابات الضريبة على Staging للقراءة فقط");
    console.log(`SETTINGS=${JSON.stringify(report.settings)}`);
    console.log(`PURCHASE_CANDIDATES=${JSON.stringify(summarize(report.purchase_candidates))}`);
    console.log(`SALES_CANDIDATES=${JSON.stringify(summarize(report.sales_candidates))}`);
    console.log(`REJECTED_TAX_LIKE_COUNT=${report.rejected_tax_like_accounts.length}`);
    console.log(`REPORT_DIR=${outputDir}`);
  } catch (error) {
    returnOutputToCaller(outputDir);
    returnOutputToCaller(queryPath);
    returnOutputToCaller(logPath);
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
