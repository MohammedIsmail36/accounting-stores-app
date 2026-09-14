import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/components/inventory-reconciliation/ExecuteInventoryRepairDialog.tsx"), "utf8");

describe("ExecuteInventoryRepairDialog boundary", () => {
  it("ينفذ RPC المقيد بقفل الإصدار وطلب ثابت للمحاولة", () => {
    expect(source).toContain('supabase.rpc("execute_inventory_reconciliation_repair"');
    expect(source).toContain("p_expected_version: repair.version");
    expect(source).toContain("setRequestId(crypto.randomUUID())");
    expect(source).toContain("p_request_id: requestId");
    expect(source).toContain('result.status !== "executed"');
  });

  it("يتطلب رقم المعالجة كتأكيد صريح قبل التنفيذ", () => {
    expect(source).toContain("confirmation.trim() === repairNumber");
    expect(source).toContain("confirmDisabled={!requestId || !confirmationMatches}");
    expect(source).toContain("تحقق نهائي قبل التنفيذ");
  });

  it("يقبل نوع إعادة البطاقة فقط ولا يكتب مباشرة في الجداول", () => {
    expect(source).toContain("canExecuteInventoryProductCardRepair(repair, items)");
    expect(source).not.toContain(".from(");
    expect(source).not.toContain("create_missing_inventory_journal");
    expect(source).not.toContain("post_rounding_adjustment");
  });
});
