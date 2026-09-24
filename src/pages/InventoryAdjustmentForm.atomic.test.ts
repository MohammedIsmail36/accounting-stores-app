import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/pages/InventoryAdjustmentForm.tsx"),
  "utf8",
);

describe("ربط شاشة التسوية بالمحرك الذري", () => {
  it("يرحّل ويعكس عبر المدخلين الخادميين فقط", () => {
    expect(source).toContain("postInventoryAdjustmentAtomic(id, requestId)");
    expect(source).toContain("reverseInventoryAdjustmentAtomic(id, requestId, reverseReason)");
    expect(source).not.toContain("createJournalEntry(");
    expect(source).not.toContain("createReverseJournalEntry(");
    expect(source).not.toContain("adjust_product_quantity");
    expect(source).not.toContain('from("inventory_movements")');
    expect(source).not.toContain('status: "approved"');
  });

  it("يحافظ على المستند القديم للعرض فقط ويلزم سبب الفروق والعكس", () => {
    expect(source).toContain('const isPosted = status === "posted"');
    expect(source).toContain('approved: "معتمد (قديم)"');
    expect(source).toContain("!item.notes.trim()");
    expect(source).toContain("confirmDisabled={!reverseReason.trim()}");
    expect(source).toContain("postRequestId.current ?? crypto.randomUUID()");
    expect(source).toContain("reverseRequestId.current ?? crypto.randomUUID()");
  });
});
