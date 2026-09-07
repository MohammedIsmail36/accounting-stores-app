import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const from = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

const { isPeriodLocked, invokeDocumentRpc, deleteDraftDocument } = await import(
  "./document-actions"
);

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("isPeriodLocked", () => {
  it("مقفلة إذا كان التاريخ يساوي أو يسبق تاريخ الإقفال", () => {
    expect(isPeriodLocked("2026-01-01", "2026-01-31")).toBe(true);
    expect(isPeriodLocked("2026-01-31", "2026-01-31")).toBe(true);
  });

  it("غير مقفلة بعد تاريخ الإقفال", () => {
    expect(isPeriodLocked("2026-02-01", "2026-01-31")).toBe(false);
  });

  it("غير مقفلة إذا لا يوجد تاريخ إقفال", () => {
    expect(isPeriodLocked("2020-01-01", null)).toBe(false);
    expect(isPeriodLocked("2020-01-01", undefined)).toBe(false);
    expect(isPeriodLocked("2020-01-01", "")).toBe(false);
  });
});

describe("invokeDocumentRpc", () => {
  it("ينجح عند success = true", async () => {
    rpc.mockResolvedValue({ data: { success: true }, error: null });
    expect(await invokeDocumentRpc("post_sales_invoice", { p_invoice_id: "1" })).toEqual({
      success: true,
    });
    expect(rpc).toHaveBeenCalledWith("post_sales_invoice", { p_invoice_id: "1" });
  });

  it("يحافظ على بيانات النجاح التي تعيدها الدالة", async () => {
    rpc.mockResolvedValue({
      data: { success: true, invoice_id: "inv-1", invoice_number: 25 },
      error: null,
    });
    expect(await invokeDocumentRpc("save_sales_invoice_draft", {})).toEqual({
      success: true,
      invoice_id: "inv-1",
      invoice_number: 25,
    });
  });

  it("يعيد رفضًا منطقيًا مع رسالة الدالة دون isException", async () => {
    rpc.mockResolvedValue({ data: { success: false, error: "الفترة مقفلة" }, error: null });
    const r = await invokeDocumentRpc("unpost_sales_invoice", {});
    expect(r.success).toBe(false);
    expect(r.error).toBe("الفترة مقفلة");
    expect(r.isException).toBeUndefined();
  });

  it("يعلّم أخطاء قاعدة البيانات بـ isException", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const r = await invokeDocumentRpc("post_sales_invoice", {});
    expect(r).toEqual({ success: false, error: "permission denied", isException: true });
  });

  it("لا يرفع استثناءً عند فشل الشبكة", async () => {
    rpc.mockRejectedValue(new Error("Failed to fetch"));
    const r = await invokeDocumentRpc("post_sales_invoice", {});
    expect(r).toEqual({ success: false, error: "Failed to fetch", isException: true });
  });

  it("يتعامل مع data = null كرفض", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await invokeDocumentRpc("post_sales_invoice", {});
    expect(r.success).toBe(false);
    expect(r.isException).toBeUndefined();
  });
});

describe("deleteDraftDocument", () => {
  function mockDeletes(itemsError: unknown = null, parentError: unknown = null) {
    const calls: Array<{ table: string; column: string; value: string }> = [];
    from.mockImplementation((table: string) => ({
      delete: () => ({
        eq: (column: string, value: string) => {
          calls.push({ table, column, value });
          return Promise.resolve({
            error: column === "id" ? parentError : itemsError,
          });
        },
      }),
    }));
    return calls;
  }

  it("يحذف البنود ثم المستند بالترتيب", async () => {
    const calls = mockDeletes();
    await deleteDraftDocument({
      itemsTable: "sales_invoice_items",
      parentTable: "sales_invoices",
      parentKey: "invoice_id",
      id: "inv-1",
    });
    expect(calls).toEqual([
      { table: "sales_invoice_items", column: "invoice_id", value: "inv-1" },
      { table: "sales_invoices", column: "id", value: "inv-1" },
    ]);
  });

  it("يدعم مفتاح المرتجعات return_id", async () => {
    const calls = mockDeletes();
    await deleteDraftDocument({
      itemsTable: "sales_return_items",
      parentTable: "sales_returns",
      parentKey: "return_id",
      id: "ret-2",
    });
    expect(calls[0]).toEqual({
      table: "sales_return_items",
      column: "return_id",
      value: "ret-2",
    });
  });

  it("يرفع الخطأ ولا يحذف المستند إذا فشل حذف البنود", async () => {
    const calls = mockDeletes({ message: "fk violation" });
    await expect(
      deleteDraftDocument({
        itemsTable: "sales_invoice_items",
        parentTable: "sales_invoices",
        parentKey: "invoice_id",
        id: "inv-1",
      }),
    ).rejects.toMatchObject({ message: "fk violation" });
    expect(calls).toHaveLength(1);
  });

  it("يرفع الخطأ إذا فشل حذف المستند نفسه", async () => {
    mockDeletes(null, { message: "denied" });
    await expect(
      deleteDraftDocument({
        itemsTable: "purchase_return_items",
        parentTable: "purchase_returns",
        parentKey: "return_id",
        id: "r1",
      }),
    ).rejects.toMatchObject({ message: "denied" });
  });
});
