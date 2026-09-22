// Read-only Staging backup and baseline before the controlled stage-2D UI acceptance fixture.
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baselineSql } from "./backup-inventory-missing-journal-ui-bridge-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedProjectRef = "dunzfxurefzlaamgghys";
const projectRefPath = join(root, "supabase/.temp/project-ref");
const cli = "supabase@2.116.0";

function assertStagingLink() {
  if (readFileSync(projectRefPath, "utf8").trim() !== expectedProjectRef) {
    throw new Error("رُفض التنفيذ: المشروع المرتبط ليس Staging المعتمد");
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function runCli(args, logPath) {
  assertStagingLink();
  const result = spawnSync("npx", ["-y", cli, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 96 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    appendFileSync(
      logPath,
      `\n=== supabase ${args.join(" ")} ===\n${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}\n`,
      { mode: 0o600 },
    );
    throw new Error(`فشل إنشاء نسخة Staging قبل قبول واجهة 2D؛ التشخيص: ${logPath}`);
  }
  return result.stdout;
}

function main() {
  if (process.argv.length !== 2) throw new Error("هذا المشغل لا يقبل معاملات");
  assertStagingLink();
  process.umask(0o077);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const outputDir = `/tmp/staging-inventory-missing-journal-ui-acceptance-before-${stamp}`;
  mkdirSync(outputDir, { mode: 0o700 });
  chmodSync(outputDir, 0o700);

  const schemaPath = join(outputDir, "public-schema.sql");
  const dataPath = join(outputDir, "public-data.sql");
  const queryPath = join(outputDir, "baseline-query.sql");
  const baselinePath = join(outputDir, "baseline.json");
  const manifestPath = join(outputDir, "manifest.json");
  const logPath = join(outputDir, "run.log");
  writeFileSync(queryPath, baselineSql, { mode: 0o600 });

  runCli(["db", "dump", "--linked", "--schema", "public", "--file", schemaPath], logPath);
  runCli(["db", "dump", "--linked", "--schema", "public", "--data-only", "--use-copy", "--file", dataPath], logPath);
  chmodSync(schemaPath, 0o600);
  chmodSync(dataPath, 0o600);
  if (statSync(schemaPath).size < 10_000 || statSync(dataPath).size < 10_000) {
    throw new Error(`نسخة Staging غير مكتملة: ${outputDir}`);
  }

  const queryOutput = runCli(
    ["db", "query", "--linked", "--output-format", "json", "--file", queryPath],
    logPath,
  );
  const baseline = JSON.parse(queryOutput).rows?.[0]?.baseline;
  const migrations = baseline?.migration_state ?? {};
  const bridge = baseline?.bridge_state ?? {};
  if (
    !baseline
    || baseline.database !== "postgres"
    || baseline.project_ref !== expectedProjectRef
    || !baseline.server_version?.startsWith("17.")
    || !migrations.system_accounts
    || !migrations.planner
    || !migrations.executor
    || !migrations.bridge
    || !bridge.function_exists
    || bridge.trigger_count !== 1
    || bridge.active_repairs !== 0
  ) {
    throw new Error(`خط أساس Staging قبل قبول واجهة 2D غير آمن: ${outputDir}`);
  }

  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 });
  const files = [schemaPath, dataPath, queryPath, baselinePath];
  const manifest = {
    result: "STAGING_INVENTORY_MISSING_JOURNAL_UI_ACCEPTANCE_BASELINE_OK",
    projectRef: expectedProjectRef,
    createdAt: new Date().toISOString(),
    readOnly: true,
    all2DMigrationsPresent: true,
    bridgePresent: true,
    activeMissingJournalRepairs: 0,
    productionModified: false,
    files: Object.fromEntries(files.map((path) => [path.split("/").at(-1), {
      bytes: statSync(path).size,
      sha256: sha256(path),
    }])),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(
    join(outputDir, "SHA256SUMS"),
    `${[...files, manifestPath]
      .map((path) => `${sha256(path)}  ${path.split("/").at(-1)}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );

  console.log("تم إنشاء نسخة Staging وخط أساس ما قبل قبول واجهة 2D دون كتابة على القاعدة");
  console.log(`SOURCE_DIR=${outputDir}`);
  console.log(`COUNTS=${JSON.stringify(baseline.counts)}`);
  console.log(`DIAGNOSTIC_STATUS=${baseline.diagnostic?.status}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
