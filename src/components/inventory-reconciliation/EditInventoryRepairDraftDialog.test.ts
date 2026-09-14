import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/components/inventory-reconciliation/EditInventoryRepairDraftDialog.tsx"), "utf8");

describe("EditInventoryRepairDraftDialog boundary", () => {
  it("تعدل المسودة عبر RPC المعتمد مع الإصدار وrequest id ثابت", () => {
    expect(source).toContain('supabase.rpc("update_inventory_reconciliation_repair"');
    expect(source).toContain("p_expected_version: repair.version");
    expect(source).toContain("setRequestId(crypto.randomUUID())");
    expect(source).toContain("p_request_id: requestId");
    expect(source).toContain("items.map(buildInventoryRepairUpdateItem)");
    expect(source).toContain("!hasChanges");
  });

  it("لا ترسل أو تعتمد أو تنفذ ولا تكتب مباشرة في الجداول", () => {
    expect(source).not.toContain("submit_inventory_reconciliation_repair");
    expect(source).not.toContain("approve_inventory_reconciliation_repair");
    expect(source).not.toContain("execute_inventory_reconciliation_repair");
    expect(source).not.toContain(".from(");
  });
});
