export type InventoryReconciliationSection = "products" | "sources";
export type InventoryReconciliationStatus =
  | "matched"
  | "rounding_only"
  | "mismatch"
  | "unavailable";

export interface InventoryReconciliationTotals {
  cardQuantity: number;
  movementQuantity: number;
  quantityDifference: number;
  movementBookValue: number;
  wacValuation: number;
  ledger1104Balance: number;
  movementToLedgerDifference: number;
  wacToMovementDifference: number;
  wacToLedgerDifference: number;
  productIssueCount: number;
  sourceIssueCount: number;
  roundingIssueCount: number;
  unlinkedMovementCount: number;
  unlinkedJournalCount: number;
}

export interface InventoryReconciliationProductRow {
  kind: "product";
  productId: string;
  code: string;
  name: string;
  isActive: boolean;
  cardQuantity: number;
  movementQuantity: number;
  quantityDifference: number;
  movementBookValue: number;
  bookUnitCost: number | null;
  wac: number;
  wacValuation: number;
  wacToMovementDifference: number;
  lastMovementDate: string | null;
  movementCount: number;
  classification: string;
  reasonCodes: string[];
  canPrepareRepair: boolean;
}

export interface InventoryReconciliationSourceRow {
  kind: "source";
  sourceKey: string;
  sourceType: string;
  sourceId: string;
  sourceNumber: string | null;
  sourceStatus: string | null;
  sourceDate: string | null;
  journalEntryId: string | null;
  reversalJournalEntryId: string | null;
  movementCount: number;
  movementQuantity: number;
  movementBookValue: number;
  ledger1104Value: number;
  sourceDifference: number;
  classification: string;
  reasonCodes: string[];
  isRoundingOnly: boolean;
  canPrepareRepair: boolean;
}

export type InventoryReconciliationRow =
  | InventoryReconciliationProductRow
  | InventoryReconciliationSourceRow;

export interface InventoryReconciliationDiagnostic {
  schemaVersion: number;
  snapshotAt: string;
  sourceScope: string;
  fingerprint: string;
  status: InventoryReconciliationStatus;
  totals: InventoryReconciliationTotals;
  issueCounts: {
    products: number;
    sources: number;
    rounding: number;
    unlinkedMovements: number;
    unlinkedJournals: number;
  };
  page: {
    section: InventoryReconciliationSection;
    limit: number;
    offset: number;
    totalCount: number;
  };
  rows: InventoryReconciliationRow[];
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown, field: string): UnknownRecord => {
  if (!isRecord(value)) throw new Error(`استجابة مطابقة المخزون غير صالحة: ${field}`);
  return value;
};

const text = (value: unknown, field: string): string => {
  if (typeof value !== "string") throw new Error(`استجابة مطابقة المخزون غير صالحة: ${field}`);
  return value;
};

const nullableText = (value: unknown, field: string): string | null =>
  value === null || value === undefined ? null : text(value, field);

const number = (value: unknown, field: string): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`استجابة مطابقة المخزون غير صالحة: ${field}`);
  return parsed;
};

const boolean = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`استجابة مطابقة المخزون غير صالحة: ${field}`);
  return value;
};

const stringArray = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`استجابة مطابقة المخزون غير صالحة: ${field}`);
  }
  return value;
};

const parseProductRow = (value: unknown, index: number): InventoryReconciliationProductRow => {
  const row = record(value, `rows[${index}]`);
  return {
    kind: "product",
    productId: text(row.product_id, `rows[${index}].product_id`),
    code: text(row.code, `rows[${index}].code`),
    name: text(row.name, `rows[${index}].name`),
    isActive: boolean(row.is_active, `rows[${index}].is_active`),
    cardQuantity: number(row.card_quantity, `rows[${index}].card_quantity`),
    movementQuantity: number(row.movement_quantity, `rows[${index}].movement_quantity`),
    quantityDifference: number(row.quantity_difference, `rows[${index}].quantity_difference`),
    movementBookValue: number(row.movement_book_value, `rows[${index}].movement_book_value`),
    bookUnitCost:
      row.book_unit_cost === null || row.book_unit_cost === undefined
        ? null
        : number(row.book_unit_cost, `rows[${index}].book_unit_cost`),
    wac: number(row.wac, `rows[${index}].wac`),
    wacValuation: number(row.wac_valuation, `rows[${index}].wac_valuation`),
    wacToMovementDifference: number(
      row.wac_to_movement_difference,
      `rows[${index}].wac_to_movement_difference`,
    ),
    lastMovementDate: nullableText(row.last_movement_date, `rows[${index}].last_movement_date`),
    movementCount: number(row.movement_count, `rows[${index}].movement_count`),
    classification: text(row.classification, `rows[${index}].classification`),
    reasonCodes: stringArray(row.reason_codes, `rows[${index}].reason_codes`),
    canPrepareRepair: boolean(row.can_prepare_repair, `rows[${index}].can_prepare_repair`),
  };
};

const parseSourceRow = (value: unknown, index: number): InventoryReconciliationSourceRow => {
  const row = record(value, `rows[${index}]`);
  return {
    kind: "source",
    sourceKey: text(row.source_key, `rows[${index}].source_key`),
    sourceType: text(row.source_type, `rows[${index}].source_type`),
    sourceId: text(row.source_id, `rows[${index}].source_id`),
    sourceNumber: nullableText(row.source_number, `rows[${index}].source_number`),
    sourceStatus: nullableText(row.source_status, `rows[${index}].source_status`),
    sourceDate: nullableText(row.source_date, `rows[${index}].source_date`),
    journalEntryId: nullableText(row.journal_entry_id, `rows[${index}].journal_entry_id`),
    reversalJournalEntryId: nullableText(
      row.reversal_journal_entry_id,
      `rows[${index}].reversal_journal_entry_id`,
    ),
    movementCount: number(row.movement_count, `rows[${index}].movement_count`),
    movementQuantity: number(row.movement_quantity, `rows[${index}].movement_quantity`),
    movementBookValue: number(row.movement_book_value, `rows[${index}].movement_book_value`),
    ledger1104Value: number(row.ledger_1104_value, `rows[${index}].ledger_1104_value`),
    sourceDifference: number(row.source_difference, `rows[${index}].source_difference`),
    classification: text(row.classification, `rows[${index}].classification`),
    reasonCodes: stringArray(row.reason_codes, `rows[${index}].reason_codes`),
    isRoundingOnly: boolean(row.is_rounding_only, `rows[${index}].is_rounding_only`),
    canPrepareRepair: boolean(row.can_prepare_repair, `rows[${index}].can_prepare_repair`),
  };
};

export function parseInventoryReconciliationDiagnostic(
  value: unknown,
): InventoryReconciliationDiagnostic {
  const payload = record(value, "payload");
  const totals = record(payload.totals, "totals");
  const issueCounts = record(payload.issue_counts, "issue_counts");
  const page = record(payload.page, "page");
  const section = text(page.section, "page.section");
  if (section !== "products" && section !== "sources") {
    throw new Error("استجابة مطابقة المخزون غير صالحة: page.section");
  }
  const status = text(payload.status, "status");
  if (!["matched", "rounding_only", "mismatch", "unavailable"].includes(status)) {
    throw new Error("استجابة مطابقة المخزون غير صالحة: status");
  }
  if (!Array.isArray(payload.rows)) {
    throw new Error("استجابة مطابقة المخزون غير صالحة: rows");
  }

  return {
    schemaVersion: number(payload.schema_version, "schema_version"),
    snapshotAt: text(payload.snapshot_at, "snapshot_at"),
    sourceScope: text(payload.source_scope, "source_scope"),
    fingerprint: text(payload.fingerprint, "fingerprint"),
    status: status as InventoryReconciliationStatus,
    totals: {
      cardQuantity: number(totals.card_quantity, "totals.card_quantity"),
      movementQuantity: number(totals.movement_quantity, "totals.movement_quantity"),
      quantityDifference: number(totals.quantity_difference, "totals.quantity_difference"),
      movementBookValue: number(totals.movement_book_value, "totals.movement_book_value"),
      wacValuation: number(totals.wac_valuation, "totals.wac_valuation"),
      ledger1104Balance: number(totals.ledger_1104_balance, "totals.ledger_1104_balance"),
      movementToLedgerDifference: number(
        totals.movement_to_ledger_difference,
        "totals.movement_to_ledger_difference",
      ),
      wacToMovementDifference: number(
        totals.wac_to_movement_difference,
        "totals.wac_to_movement_difference",
      ),
      wacToLedgerDifference: number(
        totals.wac_to_ledger_difference,
        "totals.wac_to_ledger_difference",
      ),
      productIssueCount: number(totals.product_issue_count, "totals.product_issue_count"),
      sourceIssueCount: number(totals.source_issue_count, "totals.source_issue_count"),
      roundingIssueCount: number(totals.rounding_issue_count, "totals.rounding_issue_count"),
      unlinkedMovementCount: number(
        totals.unlinked_movement_count,
        "totals.unlinked_movement_count",
      ),
      unlinkedJournalCount: number(
        totals.unlinked_journal_count,
        "totals.unlinked_journal_count",
      ),
    },
    issueCounts: {
      products: number(issueCounts.products, "issue_counts.products"),
      sources: number(issueCounts.sources, "issue_counts.sources"),
      rounding: number(issueCounts.rounding, "issue_counts.rounding"),
      unlinkedMovements: number(issueCounts.unlinked_movements, "issue_counts.unlinked_movements"),
      unlinkedJournals: number(issueCounts.unlinked_journals, "issue_counts.unlinked_journals"),
    },
    page: {
      section,
      limit: number(page.limit, "page.limit"),
      offset: number(page.offset, "page.offset"),
      totalCount: number(page.total_count, "page.total_count"),
    },
    rows: payload.rows.map((row, index) =>
      section === "products" ? parseProductRow(row, index) : parseSourceRow(row, index),
    ),
  };
}

export const inventoryReconciliationStatusLabel: Record<InventoryReconciliationStatus, string> = {
  matched: "مطابق",
  rounding_only: "فروق تقريب موثقة فقط",
  mismatch: "يحتاج مراجعة",
  unavailable: "تعذر التشخيص",
};

export const inventorySourceTypeLabel: Record<string, string> = {
  sales_invoice: "فاتورة بيع",
  purchase_invoice: "فاتورة شراء",
  sales_return: "مرتجع بيع",
  purchase_return: "مرتجع شراء",
  adjustment: "تسوية مخزون",
  inventory_adjustment: "تسوية مخزون",
  staging_seed: "رصيد تجريبي موثق",
  journal: "قيد يومية",
};

export const inventoryClassificationLabel: Record<string, string> = {
  matched: "مطابق",
  rounding: "فرق تقريب موثق",
  product_balance: "فرق في كمية المنتج",
  movement_without_journal: "حركة بلا قيد مكتمل",
  journal_without_movement: "قيد بلا حركة",
  undocumented_effect: "أثر غير موثق بالكامل",
};

export const inventoryReasonLabel: Record<string, string> = {
  card_without_movements: "كمية في البطاقة بلا حركات",
  movements_not_applied_to_card: "حركات لم تنعكس على البطاقة",
  card_movement_quantity_mismatch: "كمية البطاقة لا تطابق صافي الحركات",
  zero_quantity_nonzero_value: "قيمة مخزون مع كمية صفرية",
  nonzero_quantity_zero_value: "كمية مخزون بلا قيمة",
  negative_book_unit_cost: "تكلفة دفترية سالبة",
  unresolved_source_reference: "مرجع حركة غير قابل للتتبع",
  cancelled_source_not_fully_reversed: "مستند ملغي لم ينعكس بالكامل",
  missing_journal_entry: "لا يوجد قيد مرتبط",
  journal_not_posted: "القيد المرتبط غير مرحّل",
  missing_1104_line: "القيد لا يحتوي حساب 1104",
  posted_source_without_movements: "مستند أو قيد مرحّل بلا حركات",
  traceable_rounding_residual: "باقي تقريب قابل للتتبع",
  source_value_mismatch: "قيمة الحركة لا تطابق أثر القيد",
  missing_reference_id: "الحركة بلا معرف مرجع",
  unknown_reference_type: "نوع المرجع غير معروف",
  missing_source_document: "المستند المصدر غير موجود",
  unlinked_reversal: "قيد عكس غير مرتبط",
};

export interface InventoryDocumentPrefixes {
  salesInvoice: string;
  purchaseInvoice: string;
  salesReturn: string;
  purchaseReturn: string;
  journalEntry: string;
}

const defaultPrefixes: InventoryDocumentPrefixes = {
  salesInvoice: "INV-",
  purchaseInvoice: "PUR-",
  salesReturn: "SRN-",
  purchaseReturn: "PRN-",
  journalEntry: "JV-",
};

export function formatInventorySourceNumber(
  row: InventoryReconciliationSourceRow,
  prefixes: Partial<InventoryDocumentPrefixes> = {},
): string {
  const resolved = { ...defaultPrefixes, ...prefixes };
  const prefixByType: Record<string, string> = {
    sales_invoice: resolved.salesInvoice,
    purchase_invoice: resolved.purchaseInvoice,
    sales_return: resolved.salesReturn,
    purchase_return: resolved.purchaseReturn,
    journal: resolved.journalEntry,
  };
  const prefix = prefixByType[row.sourceType];
  if (!row.sourceNumber) return inventorySourceTypeLabel[row.sourceType] ?? row.sourceType;
  if (!prefix) return row.sourceNumber;

  const numericNumber = Number(row.sourceNumber);
  return Number.isInteger(numericNumber) && numericNumber >= 0
    ? `${prefix}${String(numericNumber).padStart(4, "0")}`
    : `${prefix}${row.sourceNumber}`;
}

export function getInventorySourcePath(row: InventoryReconciliationSourceRow): string | null {
  const pathByType: Record<string, string> = {
    sales_invoice: "/sales",
    purchase_invoice: "/purchases",
    sales_return: "/sales-returns",
    purchase_return: "/purchase-returns",
    adjustment: "/inventory-adjustments",
    inventory_adjustment: "/inventory-adjustments",
    staging_seed: "/journal",
    journal: "/journal",
  };
  const basePath = pathByType[row.sourceType];
  return basePath ? `${basePath}/${encodeURIComponent(row.sourceId)}` : null;
}

export const inventorySourceStatusLabel: Record<string, string> = {
  posted: "مرحّل",
  draft: "مسودة",
  cancelled: "ملغي",
  unresolved: "غير مرتبط",
};

export function isReconciliationSnapshotStale(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return (
    error.code === "40001" ||
    (typeof error.message === "string" && error.message.includes("RECONCILIATION_SNAPSHOT_STALE"))
  );
}
