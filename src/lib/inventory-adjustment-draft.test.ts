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

const { saveInventoryAdjustmentDraft } = await import("./inventory-adjustment-draft");
const input = {
  id: null, expectedUpdatedAt: null, date: "2026-09-25", description: "اختبار",
  items: [{ product_id: "product-1", system_quantity: 5,
    actual_quantity: 6, unit_cost: 108, notes: "فائض",
    reason_code: "found_stock", reason_reference: null }],
};

beforeEach(() => rpc.mockReset());

describe("حفظ مسودة التسوية الذري", () => {
  it("يرسل الرأس والبنود في طلب واحد مع بقاء rpc مرتبطة بالعميل", async () => {
    const result = { adjustment_id: "adjustment-1", adjustment_number: 18,
      updated_at: "2026-09-25T01:00:00Z", status: "draft" };
    rpc.mockResolvedValue({ data: result, error: null });
    expect(await saveInventoryAdjustmentDraft(input)).toEqual(result);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("save_inventory_adjustment_draft_with_reasons", {
      p_adjustment_id: null, p_expected_updated_at: null,
      p_adjustment_date: "2026-09-25", p_description: "اختبار",
      p_items: input.items,
    });
  });

  it("يمرر نسخة المستند عند التعديل ويرفض الخطأ الخادمي", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("INVENTORY_DRAFT_VERSION_CHANGED") });
    await expect(saveInventoryAdjustmentDraft({ ...input, id: "adjustment-1",
      expectedUpdatedAt: "2026-09-25T01:00:00Z" }))
      .rejects.toThrow("جلسة أخرى");
    expect(rpc.mock.calls[0][1].p_expected_updated_at).toBe("2026-09-25T01:00:00Z");
  });

  it("لا يعتبر النتيجة الناقصة حفظًا ناجحًا", async () => {
    rpc.mockResolvedValue({ data: { adjustment_id: "adjustment-1" }, error: null });
    await expect(saveInventoryAdjustmentDraft(input)).rejects.toThrow("غير متوقعة");
  });
});
