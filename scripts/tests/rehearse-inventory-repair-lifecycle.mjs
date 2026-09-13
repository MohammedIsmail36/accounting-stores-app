// TDD لدورة سجل معالجة انحرافات المخزون داخل حاوية L3 المعزولة فقط.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolation, container, database } from "./rehearse-public-restore.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sqlPath = join(root, "supabase/tests/inventory_reconciliation_repair_lifecycle_contract.sql");
const marker = "INVENTORY_RECONCILIATION_REPAIR_LIFECYCLE_CONTRACT_OK";

export const requiredRepairTables = [
  "inventory_reconciliation_repairs",
  "inventory_reconciliation_repair_items",
  "inventory_reconciliation_repair_effects",
  "inventory_reconciliation_repair_events",
];

export const requiredRepairFunctions = [
  "public.create_inventory_reconciliation_repair(text,text,text,timestamptz,text,jsonb,uuid)",
  "public.update_inventory_reconciliation_repair(uuid,text,text,jsonb,integer,uuid)",
  "public.submit_inventory_reconciliation_repair(uuid,integer,uuid)",
  "public.approve_inventory_reconciliation_repair(uuid,integer,text,uuid)",
  "public.cancel_inventory_reconciliation_repair(uuid,text,integer,uuid)",
  "public.execute_inventory_reconciliation_repair(uuid,integer,uuid)",
];

export function validateRepairLifecycleContractSql(sql) {
  for (const required of [
    "BEGIN;",
    "ROLLBACK;",
    "current_database() <> 'l3_public_restore'",
    marker,
    ...requiredRepairTables,
    ...requiredRepairFunctions.map((signature) => signature.split("(")[0].replace("public.", "")),
  ]) {
    if (!sql.includes(required)) throw new Error(`حاجز أو عقد مفقود من اختبار المعالج: ${required}`);
  }
  for (let index = 1; index <= 16; index += 1) {
    const label = `Scenario ${String(index).padStart(2, "0")}`;
    if (!sql.includes(label)) throw new Error(`سيناريو معالج مفقود: ${label}`);
  }
  for (const pattern of [
    /\bCOMMIT\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
    /\bDELETE\s+FROM\b/i,
    /(?:farida|alibea)-db/i,
    /https?:\/\//i,
    /\\connect\b/i,
  ]) {
    if (pattern.test(sql)) throw new Error(`عبارة غير مسموحة في اختبار دورة المعالج: ${pattern}`);
  }
}

function runDocker(args, input) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(result.stderr?.trim() || result.error?.message || "فشل فحص L3");
  }
  return result.stdout.trim();
}

function psql(query) {
  return runDocker(
    [
      "exec", "-i", container, "psql", "-h", "/tmp", "-U", "postgres",
      "-d", database, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-",
    ],
    query,
  );
}

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--expect-missing"].includes(mode) || process.argv.length > 3) {
    throw new Error("استخدم --check أو --expect-missing");
  }

  const sql = readFileSync(sqlPath, "utf8");
  validateRepairLifecycleContractSql(sql);
  if (mode === "--check") {
    console.log("تم التحقق من حواجز وسيناريوهات عقد دورة المعالج؛ لم يُنفذ SQL");
    return;
  }

  assertIsolation(JSON.parse(runDocker(["inspect", container]))[0]);
  const state = JSON.parse(
    psql(`SELECT jsonb_build_object(
      'tables', jsonb_build_object(
        ${requiredRepairTables.map((name) => `'${name}', to_regclass('public.${name}') IS NOT NULL`).join(",\n        ")}
      ),
      'functions', jsonb_build_object(
        ${requiredRepairFunctions.map((signature, index) => `'f${index + 1}', to_regprocedure('${signature}') IS NOT NULL`).join(",\n        ")}
      )
    );`),
  );
  if (Object.values(state.tables).some(Boolean) || Object.values(state.functions).some(Boolean)) {
    throw new Error("بعض جداول أو دوال المعالج موجودة بالفعل؛ لم تعد مرحلة TDD الحمراء صالحة");
  }

  console.log("TDD_REPAIR_LIFECYCLE_RED_OK: عقد الاختبار جاهز والجداول والدوال الجديدة غير موجودة كما هو متوقع");
  console.log("لم تُنفذ بيانات السيناريوهات ولم تتغير L3 أو Staging أو أي قاعدة إنتاجية");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
