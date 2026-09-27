import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCUMENT_STATUS_LABELS } from "@/lib/constants";

const source = readFileSync(
  join(process.cwd(), "src/pages/InventoryAdjustments.tsx"),
  "utf8",
);

describe("اتساق قائمة وتصدير التسويات", () => {
  it("يعرض المستند القديم كمرحّل عبر قاموس مشترك مع شارة الحالة", () => {
    expect(DOCUMENT_STATUS_LABELS.adjustment.approved).toBe("مُرحّل (قديم)");
    expect(source).toContain("const statusLabels = DOCUMENT_STATUS_LABELS.adjustment");
    expect(source).toContain('kind="adjustment"');
    expect(source).toContain("statusLabels[a.status] || a.status");
  });

  it("يُصدر رقم التسوية نفسه المعروض في القائمة", () => {
    expect(source.match(/formatInventoryAdjustmentNumber\(/g)).toHaveLength(2);
    expect(source).toContain("formatInventoryAdjustmentNumber(a.status, a.adjustment_number, a.posted_number)");
  });
});
