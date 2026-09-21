import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  in: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: query.from },
}));

import { loadInventoryProductIdentities } from "./inventory-reconciliation-product-identity";

describe("loadInventoryProductIdentities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.from.mockReturnValue({ select: query.select });
    query.select.mockReturnValue({ in: query.in });
    query.in.mockResolvedValue({
      data: [{ id: "product-1", model_number: "M-1", product_brands: { name: "ماركة" } }],
      error: null,
    });
  });

  it("لا تستعلم عندما تخلو صفحة التشخيص من المنتجات", async () => {
    expect((await loadInventoryProductIdentities([])).size).toBe(0);
    expect(query.from).not.toHaveBeenCalled();
  });

  it("تقرأ هوية المنتجات المرئية فقط مرة واحدة ودون حقول تكلفة", async () => {
    const identities = await loadInventoryProductIdentities(["product-1", "product-1"]);
    expect(query.from).toHaveBeenCalledWith("products");
    expect(query.select).toHaveBeenCalledWith("id, model_number, product_brands(name)");
    expect(query.in).toHaveBeenCalledWith("id", ["product-1"]);
    expect(identities.get("product-1")).toEqual({ brandName: "ماركة", modelNumber: "M-1" });
  });

  it("لا تعرض بيانات ناقصة عند فشل قراءة الهوية", async () => {
    query.in.mockResolvedValueOnce({ data: null, error: new Error("identity unavailable") });
    await expect(loadInventoryProductIdentities(["product-1"])).rejects.toThrow("identity unavailable");
  });
});
