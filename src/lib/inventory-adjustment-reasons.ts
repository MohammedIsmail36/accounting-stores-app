// Stable values for inventory-adjustment line reasons. Labels may change; codes must not.
export const INVENTORY_ADJUSTMENT_REASONS = [
  { code: "damage", label: "تلف" },
  { code: "loss", label: "فقد" },
  { code: "found_stock", label: "كمية عُثر عليها" },
  { code: "internal_use", label: "استخدام داخلي" },
  { code: "sample", label: "عينة" },
  { code: "prior_entry_error", label: "تصحيح خطأ سابق" },
  { code: "other", label: "سبب آخر" },
] as const;

export type InventoryAdjustmentReasonCode =
  (typeof INVENTORY_ADJUSTMENT_REASONS)[number]["code"];

const codes = new Set<string>(INVENTORY_ADJUSTMENT_REASONS.map((reason) => reason.code));

export function isInventoryAdjustmentReasonCode(value: unknown): value is InventoryAdjustmentReasonCode {
  return typeof value === "string" && codes.has(value);
}

export function inventoryAdjustmentReasonLabel(code: string | null | undefined): string | null {
  return INVENTORY_ADJUSTMENT_REASONS.find((reason) => reason.code === code)?.label ?? null;
}

export function inventoryAdjustmentReasonNeedsDetail(code: InventoryAdjustmentReasonCode): boolean {
  return code === "internal_use" || code === "sample" || code === "other";
}

export function inventoryAdjustmentReasonNeedsSourceReference(code: InventoryAdjustmentReasonCode): boolean {
  return code === "prior_entry_error";
}
