import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc(this: { rpc: unknown } | undefined, ...args: unknown[]) {
      if (!this?.rpc) throw new TypeError("Cannot read properties of undefined (reading 'rest')");
      return rpc(...args);
    },
  },
}));
const { deleteInventoryAdjustmentDraft } = await import("./inventory-adjustment-delete");
beforeEach(() => rpc.mockReset());

describe("حذف مسودة تسوية المخزون", () => {
  it("يرسل المعرف ونسخة المسودة في طلب واحد مع بقاء rpc مرتبطة بالعميل", async () => {
    rpc.mockResolvedValue({ data: { deleted: true, adjustment_id: "draft-1" }, error: null });
    await deleteInventoryAdjustmentDraft("draft-1", "2026-09-25T03:00:00Z");
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("delete_inventory_adjustment_draft", {
      p_adjustment_id: "draft-1", p_expected_updated_at: "2026-09-25T03:00:00Z",
    });
  });
  it("يشرح تعارض النسخة ولا يظهر نجاحًا", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("INVENTORY_DRAFT_DELETE_VERSION_CHANGED") });
    await expect(deleteInventoryAdjustmentDraft("draft-1", "old")).rejects.toThrow("جلسة أخرى");
  });
  it("يرفض الاستجابة الناقصة بدل اعتبارها حذفًا ناجحًا", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(deleteInventoryAdjustmentDraft("draft-1", "old")).rejects.toThrow("غير متوقعة");
  });
});
