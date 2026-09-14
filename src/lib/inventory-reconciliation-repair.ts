export type InventoryRepairStatus =
  | "draft"
  | "ready_for_review"
  | "approved"
  | "executed"
  | "cancelled"
  | "reversed";

export interface InventoryRepairListRow {
  id: string;
  repairNumber: number;
  status: InventoryRepairStatus;
  title: string;
  explanation: string;
  version: number;
  preparedAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  updatedAt: string;
}

export const inventoryRepairStatusLabel: Record<InventoryRepairStatus, string> = {
  draft: "مسودة",
  ready_for_review: "بانتظار المراجعة",
  approved: "معتمدة",
  executed: "منفذة",
  cancelled: "ملغاة",
  reversed: "معكوسة",
};

export const inventoryRepairStatusClass: Record<InventoryRepairStatus, string> = {
  draft: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
  ready_for_review: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
  approved: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  executed: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  cancelled: "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  reversed: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300",
};

type RepairRecord = Record<string, unknown>;

const nullableText = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : null;

export function parseInventoryRepairListRow(value: unknown): InventoryRepairListRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("سجل معالجة المطابقة غير صالح");
  }

  const row = value as RepairRecord;
  const repairNumber = Number(row.repair_number);
  const version = Number(row.version);
  const status = row.status as InventoryRepairStatus;

  if (
    typeof row.id !== "string"
    || !Number.isSafeInteger(repairNumber)
    || repairNumber < 1
    || !Object.prototype.hasOwnProperty.call(inventoryRepairStatusLabel, status)
    || typeof row.title !== "string"
    || typeof row.explanation !== "string"
    || !Number.isSafeInteger(version)
    || version < 1
    || typeof row.prepared_at !== "string"
    || typeof row.updated_at !== "string"
  ) {
    throw new Error("سجل معالجة المطابقة غير صالح");
  }

  return {
    id: row.id,
    repairNumber,
    status,
    title: row.title,
    explanation: row.explanation,
    version,
    preparedAt: row.prepared_at,
    submittedAt: nullableText(row.submitted_at),
    approvedAt: nullableText(row.approved_at),
    updatedAt: row.updated_at,
  };
}

export function inventoryRepairNumber(value: number) {
  return `IR-${String(value).padStart(4, "0")}`;
}
