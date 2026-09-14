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

export interface InventoryRepairDetail extends InventoryRepairListRow {
  diagnosticFingerprint: string;
  diagnosticSnapshotAt: string;
  sourceScope: string;
  accountingDate: string | null;
  separationOverrideReason: string | null;
  preparedBy: string;
  submittedBy: string | null;
  approvedBy: string | null;
  executedBy: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
}

export interface InventoryRepairItem {
  id: string;
  lineNumber: number;
  axis: "product" | "source";
  issueKey: string;
  classification: string;
  repairType: string;
  productId: string | null;
  sourceType: string | null;
  sourceId: string | null;
  sourceNumber: string | null;
  originalJournalEntryId: string | null;
  beforeCardQuantity: number | null;
  beforeMovementQuantity: number | null;
  beforeMovementBookValue: number | null;
  beforeLedger1104Value: number | null;
  proposedCardQuantity: number | null;
  proposedMovementBookValue: number | null;
  proposedLedger1104Value: number | null;
  resultStatus: string;
  resultMessage: string | null;
  beforeState: Record<string, unknown>;
  proposedState: Record<string, unknown>;
}

export interface InventoryRepairEvent {
  id: string;
  eventType: string;
  fromStatus: InventoryRepairStatus | null;
  toStatus: InventoryRepairStatus | null;
  actorId: string;
  createdAt: string;
}

export interface InventoryRepairEffect {
  id: string;
  repairItemId: string;
  effectType: string;
  tableName: string;
  recordId: string;
  createdAt: string;
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

export const inventoryRepairAxisLabel: Record<InventoryRepairItem["axis"], string> = {
  product: "منتج",
  source: "مصدر مستندي",
};

export const inventoryRepairClassificationLabel: Record<string, string> = {
  product_balance: "فرق رصيد منتج",
  movement_without_journal: "حركة دون قيد",
  journal_without_movement: "قيد دون حركة",
  undocumented_effect: "أثر غير موثق",
  rounding: "فرق تقريب",
};

export const inventoryRepairTypeLabel: Record<string, string> = {
  rebuild_product_card: "إعادة بناء بطاقة المنتج",
  create_missing_inventory_journal: "إنشاء قيد المخزون المفقود",
  reverse_unbacked_inventory_journal: "عكس قيد مخزون بلا حركة",
  create_linked_inventory_adjustment: "إنشاء تسوية مخزون مرتبطة",
  post_rounding_adjustment: "إثبات فرق التقريب",
  manual_review: "مراجعة يدوية",
};

export const inventoryRepairEventLabel: Record<string, string> = {
  created: "إنشاء المسودة",
  updated: "تحديث المسودة",
  submitted: "إرسال للمراجعة",
  approved: "اعتماد",
  cancelled: "إلغاء",
  executed: "تنفيذ",
  execution_failed: "فشل التنفيذ",
  reversed: "عكس المعالجة",
};

type RepairRecord = Record<string, unknown>;

const nullableText = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : null;

const requiredText = (value: unknown) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("سجل معالجة المطابقة غير صالح");
  }
  return value;
};

const nullableNumber = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("سجل معالجة المطابقة غير صالح");
  return parsed;
};

const objectValue = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("سجل معالجة المطابقة غير صالح");
  }
  return value as Record<string, unknown>;
};

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

export function parseInventoryRepairDetail(value: unknown): InventoryRepairDetail {
  const base = parseInventoryRepairListRow(value);
  const row = value as RepairRecord;
  return {
    ...base,
    diagnosticFingerprint: requiredText(row.diagnostic_fingerprint),
    diagnosticSnapshotAt: requiredText(row.diagnostic_snapshot_at),
    sourceScope: requiredText(row.source_scope),
    accountingDate: nullableText(row.accounting_date),
    separationOverrideReason: nullableText(row.separation_override_reason),
    preparedBy: requiredText(row.prepared_by),
    submittedBy: nullableText(row.submitted_by),
    approvedBy: nullableText(row.approved_by),
    executedBy: nullableText(row.executed_by),
    cancelledBy: nullableText(row.cancelled_by),
    cancellationReason: nullableText(row.cancellation_reason),
  };
}

export function parseInventoryRepairItem(value: unknown): InventoryRepairItem {
  const row = objectValue(value);
  const lineNumber = Number(row.line_number);
  const axis = row.axis;
  if (!Number.isSafeInteger(lineNumber) || lineNumber < 1 || (axis !== "product" && axis !== "source")) {
    throw new Error("سجل معالجة المطابقة غير صالح");
  }
  return {
    id: requiredText(row.id),
    lineNumber,
    axis,
    issueKey: requiredText(row.issue_key),
    classification: requiredText(row.classification),
    repairType: requiredText(row.repair_type),
    productId: nullableText(row.product_id),
    sourceType: nullableText(row.source_type),
    sourceId: nullableText(row.source_id),
    sourceNumber: nullableText(row.source_number),
    originalJournalEntryId: nullableText(row.original_journal_entry_id),
    beforeCardQuantity: nullableNumber(row.before_card_quantity),
    beforeMovementQuantity: nullableNumber(row.before_movement_quantity),
    beforeMovementBookValue: nullableNumber(row.before_movement_book_value),
    beforeLedger1104Value: nullableNumber(row.before_ledger_1104_value),
    proposedCardQuantity: nullableNumber(row.proposed_card_quantity),
    proposedMovementBookValue: nullableNumber(row.proposed_movement_book_value),
    proposedLedger1104Value: nullableNumber(row.proposed_ledger_1104_value),
    resultStatus: requiredText(row.result_status),
    resultMessage: nullableText(row.result_message),
    beforeState: objectValue(row.before_state),
    proposedState: objectValue(row.proposed_state),
  };
}

export function parseInventoryRepairEvent(value: unknown): InventoryRepairEvent {
  const row = objectValue(value);
  const fromStatus = nullableText(row.from_status) as InventoryRepairStatus | null;
  const toStatus = nullableText(row.to_status) as InventoryRepairStatus | null;
  if ((fromStatus && !inventoryRepairStatusLabel[fromStatus]) || (toStatus && !inventoryRepairStatusLabel[toStatus])) {
    throw new Error("سجل معالجة المطابقة غير صالح");
  }
  return {
    id: requiredText(row.id),
    eventType: requiredText(row.event_type),
    fromStatus,
    toStatus,
    actorId: requiredText(row.actor_id),
    createdAt: requiredText(row.created_at),
  };
}

export function parseInventoryRepairEffect(value: unknown): InventoryRepairEffect {
  const row = objectValue(value);
  return {
    id: requiredText(row.id),
    repairItemId: requiredText(row.repair_item_id),
    effectType: requiredText(row.effect_type),
    tableName: requiredText(row.table_name),
    recordId: requiredText(row.record_id),
    createdAt: requiredText(row.created_at),
  };
}

export function inventoryRepairItemLabel(item: InventoryRepairItem) {
  const name = typeof item.beforeState.name === "string" ? item.beforeState.name : null;
  const code = typeof item.beforeState.code === "string" ? item.beforeState.code : null;
  if (name && code) return `${name} — ${code}`;
  if (name) return name;
  if (item.sourceNumber) return item.sourceNumber;
  return item.issueKey;
}

export function getInventoryRepairItemPath(item: InventoryRepairItem) {
  if (item.axis === "product" && item.productId) return `/products/${item.productId}`;
  if (!item.sourceId) return null;
  const routes: Record<string, string> = {
    sales_invoice: "/sales",
    purchase_invoice: "/purchases",
    sales_return: "/sales-returns",
    purchase_return: "/purchase-returns",
    inventory_adjustment: "/inventory-adjustments",
  };
  const base = item.sourceType ? routes[item.sourceType] : null;
  return base ? `${base}/${item.sourceId}` : null;
}
