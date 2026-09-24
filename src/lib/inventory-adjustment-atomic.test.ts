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

const { postInventoryAdjustmentAtomic, reverseInventoryAdjustmentAtomic } =
  await import("./inventory-adjustment-atomic");

beforeEach(() => rpc.mockReset());

describe("جسر تسوية المخزون الذرية", () => {
  it("يرسل المعرفين فقط ولا يرسل تكلفة أو سطور قيد من المتصفح", async () => {
    const result = {
      status: "posted", operation_id: "operation-1",
      journal_entry_id: "journal-1", repeated: false,
    };
    rpc.mockResolvedValue({ data: result, error: null });
    expect(await postInventoryAdjustmentAtomic("adjustment-1", "request-1"))
      .toEqual(result);
    expect(rpc).toHaveBeenCalledWith("post_inventory_adjustment_atomic", {
      p_adjustment_id: "adjustment-1", p_request_id: "request-1",
    });
  });

  it("يستخدم معرف الطلب نفسه عند تكراره ويقبل النتيجة المكررة", async () => {
    rpc.mockResolvedValue({ data: {
      status: "posted", operation_id: "operation-1",
      journal_entry_id: "journal-1", repeated: true,
    }, error: null });
    await postInventoryAdjustmentAtomic("adjustment-1", "request-1");
    await postInventoryAdjustmentAtomic("adjustment-1", "request-1");
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  });

  it("يشترط سبب الرجوع ويرسله للخادم", async () => {
    await expect(reverseInventoryAdjustmentAtomic("adjustment-1", "request-2", " "))
      .rejects.toThrow("سبب");
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: {
      status: "cancelled", operation_id: "operation-2",
      journal_entry_id: "journal-2", repeated: false,
    }, error: null });
    await reverseInventoryAdjustmentAtomic("adjustment-1", "request-2", "  تصحيح خطأ  ");
    expect(rpc).toHaveBeenCalledWith("reverse_inventory_adjustment_atomic", {
      p_adjustment_id: "adjustment-1", p_request_id: "request-2",
      p_reason: "تصحيح خطأ",
    });
  });

  it("ينقل رفض القاعدة ولا يعتبر نتيجة ناقصة نجاحًا", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("الفترة مقفلة") });
    await expect(postInventoryAdjustmentAtomic("adjustment-1", "request-1"))
      .rejects.toThrow("الفترة مقفلة");
    rpc.mockResolvedValueOnce({ data: { status: "posted" }, error: null });
    await expect(postInventoryAdjustmentAtomic("adjustment-1", "request-1"))
      .rejects.toThrow("غير متوقعة");
  });

  it("يعرض رفض اللقطة القديمة بلغة واضحة دون إخفاء الخطأ الأصلي", async () => {
    const original = new Error("INVENTORY_VARIANCE_PRECONDITION_CHANGED");
    rpc.mockResolvedValue({ data: null, error: original });
    await expect(postInventoryAdjustmentAtomic("adjustment-1", "request-1"))
      .rejects.toMatchObject({ message: expect.stringContaining("تغيرت كمية المنتج"), cause: original });
  });
});
