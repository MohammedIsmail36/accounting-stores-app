import { formatProductDisplay } from "@/lib/product-utils";
import type { InventoryProductIdentity } from "@/lib/inventory-reconciliation-product-identity";

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

export interface InventoryRepairActor {
  fullName: string | null;
  role: string | null;
}

export type InventoryJournalPlanMode = "create_full_journal" | "post_delta_journal";

export interface InventoryJournalPlanLine {
  accountCode: string;
  debit: number;
  credit: number;
}

export interface InventoryJournalPlan {
  eligible: boolean;
  reasonCode: string;
  planFingerprint: string | null;
  mode: InventoryJournalPlanMode | null;
  sourceType: string | null;
  sourceId: string | null;
  sourceNumber: string | null;
  sourceStatus: string | null;
  sourceDate: string | null;
  accountingDate: string | null;
  originalJournalEntryId: string | null;
  journalStatus: string | null;
  movementCount: number | null;
  movementBookValue: number | null;
  expectedLines: InventoryJournalPlanLine[];
  actualLines: InventoryJournalPlanLine[];
  correctionLines: InventoryJournalPlanLine[];
  targetLedger1104Value: number | null;
  unexpectedAccountCodes: string[];
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

export const inventoryJournalPlanModeLabel: Record<InventoryJournalPlanMode, string> = {
  create_full_journal: "إنشاء القيد الكامل المفقود",
  post_delta_journal: "إنشاء قيد بالفرق فقط",
};

export const inventoryJournalPlanReasonLabel: Record<string, string> = {
  READY: "الخطة جاهزة",
  ACCOUNTING_DATE_REQUIRED: "اختر تاريخًا محاسبيًا داخل فترة مفتوحة",
  ACCOUNTING_DATE_LOCKED: "التاريخ المحاسبي المحدد يقع داخل فترة مقفلة",
  SOURCE_NOT_FOUND: "المستند غير موجود",
  SOURCE_NOT_POSTED: "المستند غير مرحّل",
  SOURCE_TYPE_NOT_SUPPORTED: "نوع المستند غير مدعوم",
  MOVEMENT_EVIDENCE_INVALID: "حركات المخزون غير كافية لبناء القيد",
  JOURNAL_DRAFT_REQUIRES_REVIEW: "يوجد قيد مسودة يحتاج إلى مراجعة يدوية",
  JOURNAL_UNBALANCED_REQUIRES_REVIEW: "القيد الحالي غير متوازن ويحتاج إلى مراجعة",
  SOURCE_TOTALS_INVALID: "إجماليات المستند غير صالحة لبناء القيد",
  SOURCE_VALUE_MISMATCH: "قيمة المصدر لا تطابق أثر المخزون",
  ACCOUNT_MAPPING_MISSING: "حساب مطلوب غير موجود في دليل الحسابات",
  ACCOUNT_MAPPING_INVALID: "هوية أحد حسابات النظام غير صحيحة",
  TAX_ACCOUNT_MAPPING_INVALID: "حساب الضريبة المطلوب غير صحيح",
  UNEXPECTED_ACCOUNT_DELTA: "الفرق يتضمن حسابًا غير متوقع",
  CORRECTION_NOT_BALANCED: "القيد المقترح غير متوازن",
  NO_CORRECTION_REQUIRED: "لا يوجد فرق يحتاج إلى قيد تصحيحي",
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

const inventoryRepairActorRoleLabel: Record<string, string> = {
  admin: "مدير",
  accountant: "محاسب",
  sales: "موظف مبيعات",
};

export function inventoryRepairActorLabel(actor?: InventoryRepairActor) {
  const name = actor?.fullName?.trim() || "مستخدم مخوّل";
  const role = actor?.role ? inventoryRepairActorRoleLabel[actor.role] : null;
  return role ? `${name} — ${role}` : name;
}

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

export function canExecuteInventoryProductCardRepair(
  repair: InventoryRepairDetail,
  items: InventoryRepairItem[],
) {
  return repair.status === "approved"
    && items.length > 0
    && items.every((item) => (
      item.axis === "product"
      && item.classification === "product_balance"
      && item.repairType === "rebuild_product_card"
      && Boolean(item.productId)
      && item.proposedCardQuantity !== null
      && item.resultStatus === "pending"
    ));
}

const nullablePlanNumber = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("خطة قيد تسوية المخزون غير صالحة");
  return parsed;
};

function parseInventoryJournalPlanLines(value: unknown): InventoryJournalPlanLine[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("خطة قيد تسوية المخزون غير صالحة");
  return value.map((entry) => {
    const line = objectValue(entry);
    const accountCode = requiredText(line.account_code);
    const debit = Number(line.debit ?? 0);
    const credit = Number(line.credit ?? 0);
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
      throw new Error("خطة قيد تسوية المخزون غير صالحة");
    }
    return { accountCode, debit, credit };
  });
}

export function parseInventoryJournalPlan(value: unknown): InventoryJournalPlan {
  const row = objectValue(value);
  if (typeof row.eligible !== "boolean") {
    throw new Error("خطة قيد تسوية المخزون غير صالحة");
  }
  const modeValue = nullableText(row.mode);
  if (modeValue && modeValue !== "create_full_journal" && modeValue !== "post_delta_journal") {
    throw new Error("خطة قيد تسوية المخزون غير صالحة");
  }
  const unexpectedAccountCodes = row.unexpected_account_codes ?? [];
  if (!Array.isArray(unexpectedAccountCodes)
      || unexpectedAccountCodes.some((code) => typeof code !== "string")) {
    throw new Error("خطة قيد تسوية المخزون غير صالحة");
  }
  return {
    eligible: row.eligible,
    reasonCode: requiredText(row.reason_code),
    planFingerprint: nullableText(row.plan_fingerprint),
    mode: modeValue as InventoryJournalPlanMode | null,
    sourceType: nullableText(row.source_type),
    sourceId: nullableText(row.source_id),
    sourceNumber: nullableText(row.source_number),
    sourceStatus: nullableText(row.source_status),
    sourceDate: nullableText(row.source_date),
    accountingDate: nullableText(row.accounting_date),
    originalJournalEntryId: nullableText(row.original_journal_entry_id),
    journalStatus: nullableText(row.journal_status),
    movementCount: nullablePlanNumber(row.movement_count),
    movementBookValue: nullablePlanNumber(row.movement_book_value),
    expectedLines: parseInventoryJournalPlanLines(row.expected_lines),
    actualLines: parseInventoryJournalPlanLines(row.actual_lines),
    correctionLines: parseInventoryJournalPlanLines(row.correction_lines),
    targetLedger1104Value: nullablePlanNumber(row.target_ledger_1104_value),
    unexpectedAccountCodes: unexpectedAccountCodes as string[],
  };
}

export function parseStoredInventoryJournalPlan(item: InventoryRepairItem): InventoryJournalPlan {
  const plan = parseInventoryJournalPlan({
    eligible: true,
    reason_code: "READY",
    plan_fingerprint: item.proposedState.plan_fingerprint,
    mode: item.proposedState.mode,
    source_type: item.sourceType,
    source_id: item.sourceId,
    source_number: item.sourceNumber,
    source_status: item.beforeState.source_status ?? null,
    source_date: item.beforeState.source_date ?? null,
    accounting_date: item.proposedState.accounting_date,
    original_journal_entry_id: item.originalJournalEntryId,
    journal_status: item.beforeState.journal_status ?? null,
    movement_count: item.beforeState.movement_count ?? null,
    movement_book_value: item.beforeMovementBookValue,
    expected_lines: [],
    actual_lines: [],
    correction_lines: item.proposedState.correction_lines,
    target_ledger_1104_value: item.proposedLedger1104Value,
    unexpected_account_codes: [],
  });
  if (!plan.planFingerprint || !plan.mode || !plan.accountingDate || plan.correctionLines.length === 0) {
    throw new Error("خطة القيد المثبتة في المعالجة غير مكتملة");
  }
  return plan;
}

const comparablePlanLines = (lines: InventoryJournalPlanLine[]) => lines.map((line) => ({
  accountCode: line.accountCode,
  debit: Number(line.debit.toFixed(2)),
  credit: Number(line.credit.toFixed(2)),
}));

export function inventoryJournalPlanMatchesStoredState(
  plan: InventoryJournalPlan,
  item: InventoryRepairItem,
) {
  let stored: InventoryJournalPlan;
  try {
    stored = parseStoredInventoryJournalPlan(item);
  } catch {
    return false;
  }
  return plan.eligible
    && plan.reasonCode === "READY"
    && plan.planFingerprint === stored.planFingerprint
    && plan.mode === stored.mode
    && plan.accountingDate === stored.accountingDate
    && JSON.stringify(comparablePlanLines(plan.correctionLines))
      === JSON.stringify(comparablePlanLines(stored.correctionLines));
}

export function canExecuteInventoryMissingJournalRepair(
  repair: InventoryRepairDetail,
  items: InventoryRepairItem[],
) {
  if (repair.status !== "approved" || items.length === 0) return false;
  return items.every((item) => {
    if (item.axis !== "source"
        || item.classification !== "movement_without_journal"
        || item.repairType !== "create_missing_inventory_journal"
        || !item.sourceType
        || !item.sourceId
        || item.resultStatus !== "pending") return false;
    try {
      parseStoredInventoryJournalPlan(item);
      return true;
    } catch {
      return false;
    }
  });
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

export function inventoryRepairItemLabel(item: InventoryRepairItem, identity?: InventoryProductIdentity) {
  const name = typeof item.beforeState.name === "string" ? item.beforeState.name : null;
  const code = typeof item.beforeState.code === "string" ? item.beforeState.code : null;
  const brandName = identity?.brandName
    ?? (typeof item.beforeState.brand_name === "string" ? item.beforeState.brand_name : null);
  const modelNumber = identity?.modelNumber
    ?? (typeof item.beforeState.model_number === "string" ? item.beforeState.model_number : null);
  if (name) return formatProductDisplay(name, brandName, modelNumber, code);
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

export function buildInventoryRepairUpdateItem(item: InventoryRepairItem) {
  const common = {
    axis: item.axis,
    issue_key: item.issueKey,
    classification: item.classification,
    repair_type: item.repairType,
    proposed_state: item.proposedState,
  };

  if (item.axis === "product") {
    if (!item.productId) throw new Error("بيانات منتج المعالجة غير مكتملة");
    return {
      ...common,
      product_id: item.productId,
    };
  }

  if (!item.sourceType || !item.sourceId) {
    throw new Error("بيانات مصدر المعالجة غير مكتملة");
  }
  return {
    ...common,
    source_type: item.sourceType,
    source_id: item.sourceId,
    proposed_movement_book_value: item.proposedMovementBookValue,
    proposed_ledger_1104_value: item.proposedLedger1104Value,
  };
}

export interface InventoryRepairDraftDiagnosticRow {
  kind: "product" | "source";
  classification: string;
  canPrepareRepair: boolean;
  productId?: string;
  sourceKey?: string;
  sourceType?: string;
  sourceId?: string;
}

const repairTypeByClassification: Record<string, string> = {
  product_balance: "rebuild_product_card",
  movement_without_journal: "create_missing_inventory_journal",
  journal_without_movement: "reverse_unbacked_inventory_journal",
  undocumented_effect: "manual_review",
  rounding: "post_rounding_adjustment",
};

export function canPrepareInventoryRepairDraft(row: InventoryRepairDraftDiagnosticRow) {
  if (!row.canPrepareRepair || row.classification === "matched") return false;
  if (!repairTypeByClassification[row.classification]) return false;
  return row.kind === "product"
    ? row.classification === "product_balance" && Boolean(row.productId)
    : Boolean(row.sourceKey && row.sourceType && row.sourceId);
}

export function buildInventoryRepairDraftItem(row: InventoryRepairDraftDiagnosticRow) {
  const repairType = repairTypeByClassification[row.classification];
  if (!canPrepareInventoryRepairDraft(row) || !repairType) {
    throw new Error("هذا الانحراف غير متاح لإعداد مسودة معالجة");
  }

  if (row.kind === "product") {
    if (!row.productId || row.classification !== "product_balance") {
      throw new Error("بيانات منتج المعالجة غير مكتملة");
    }
    return {
      axis: "product",
      issue_key: `product:${row.productId}`,
      classification: row.classification,
      repair_type: repairType,
      product_id: row.productId,
      proposed_state: {},
    };
  }

  if (!row.sourceKey || !row.sourceType || !row.sourceId) {
    throw new Error("بيانات مصدر المعالجة غير مكتملة");
  }
  return {
    axis: "source",
    issue_key: row.sourceKey,
    classification: row.classification,
    repair_type: repairType,
    source_type: row.sourceType,
    source_id: row.sourceId,
    proposed_state: {},
  };
}

export function parseInventoryRepairCommandResult(value: unknown) {
  const row = objectValue(value);
  const repairNumber = Number(row.repair_number);
  const version = Number(row.version);
  const status = row.status as InventoryRepairStatus;
  if (!Number.isSafeInteger(repairNumber) || !Number.isSafeInteger(version) || !inventoryRepairStatusLabel[status]) {
    throw new Error("استجابة أمر معالجة المخزون غير صالحة");
  }
  return {
    id: requiredText(row.id),
    repairNumber,
    status,
    version,
  };
}
