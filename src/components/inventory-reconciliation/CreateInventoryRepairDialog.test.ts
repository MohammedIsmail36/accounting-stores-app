import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/components/inventory-reconciliation/CreateInventoryRepairDialog.tsx"), "utf8");

describe("CreateInventoryRepairDialog boundary", () => {
  it("تنشئ المسودة عبر RPC المعتمد ومع request id مستقل", () => {
    expect(source).toContain('supabase.rpc("create_inventory_reconciliation_repair"');
    expect(source).toContain("setRequestId(crypto.randomUUID())");
    expect(source).toContain("p_request_id: requestId");
    expect(source).toContain("p_diagnostic_fingerprint: diagnostic.fingerprint");
  });

  it("لا ترسل أو تعتمد أو تنفذ المسودة", () => {
    expect(source).not.toContain("submit_inventory_reconciliation_repair");
    expect(source).not.toContain("approve_inventory_reconciliation_repair");
    expect(source).not.toContain("execute_inventory_reconciliation_repair");
    expect(source).not.toContain(".from(");
  });
});
