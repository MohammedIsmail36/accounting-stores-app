import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/components/inventory-reconciliation/ApproveInventoryRepairDialog.tsx"), "utf8");

describe("ApproveInventoryRepairDialog boundary", () => {
  it("تعتمد نسخة المراجعة عبر RPC المعتمد بقفل الإصدار وطلب ثابت", () => {
    expect(source).toContain('supabase.rpc("approve_inventory_reconciliation_repair"');
    expect(source).toContain("p_expected_version: repair.version");
    expect(source).toContain("setRequestId(crypto.randomUUID())");
    expect(source).toContain("p_request_id: requestId");
    expect(source).toContain('result.status !== "approved"');
  });

  it("تطلب سبب عدم فصل المهام عندما يكون المدير هو معد المسودة", () => {
    expect(source).toContain("repair.preparedBy === currentUserId");
    expect(source).toContain("separationOverrideRequired && !trimmedReason");
    expect(source).toContain("p_separation_override_reason: separationOverrideRequired ? trimmedReason : null");
    expect(source).toContain("سبب عدم فصل المهام");
  });

  it("لا تنفذ الإصلاح ولا تكتب مباشرة في الجداول", () => {
    expect(source).not.toContain("execute_inventory_reconciliation_repair");
    expect(source).not.toContain("reverse_inventory_reconciliation_repair");
    expect(source).not.toContain("cancel_inventory_reconciliation_repair");
    expect(source).not.toContain(".from(");
    expect(source).toContain("اعتماد فقط دون تنفيذ");
  });
});
