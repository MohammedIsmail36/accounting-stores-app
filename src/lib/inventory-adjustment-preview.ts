import { calculateLegacyAdjustmentLine } from "@/lib/inventory-adjustment-legacy";

export type AdjustmentPreviewInput = {
  product_id: string;
  product_name: string;
  system_quantity: number;
  actual_quantity: number;
  unit_cost: number;
};

export type AdjustmentPreviewLine = {
  productId: string;
  productName: string;
  beforeQuantity: number;
  afterQuantity: number;
  difference: number;
  estimatedValue: number;
  kind: "surplus" | "shortage" | "matched";
  debitAccount: "1104" | "5201" | null;
  creditAccount: "1104" | "4201" | null;
};

/** UI estimate only; posting recomputes movement-book cost under database locks. */
export function buildInventoryAdjustmentPreview(
  items: AdjustmentPreviewInput[],
): AdjustmentPreviewLine[] {
  return items.filter((item) => item.product_id).map((item) => {
    const { difference, totalCost } = calculateLegacyAdjustmentLine(
      item.system_quantity,
      item.actual_quantity,
      item.unit_cost,
    );
    const kind = difference > 0 ? "surplus" : difference < 0 ? "shortage" : "matched";
    return {
      productId: item.product_id,
      productName: item.product_name,
      beforeQuantity: item.system_quantity,
      afterQuantity: item.actual_quantity,
      difference,
      estimatedValue: totalCost,
      kind,
      debitAccount: kind === "surplus" ? "1104" : kind === "shortage" ? "5201" : null,
      creditAccount: kind === "surplus" ? "4201" : kind === "shortage" ? "1104" : null,
    };
  });
}
