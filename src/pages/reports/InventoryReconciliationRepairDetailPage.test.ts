import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/pages/reports/InventoryReconciliationRepairDetailPage.tsx"), "utf8");

describe("InventoryReconciliationRepairDetailPage boundary", () => {
  it("تقرأ الرأس والبنود والآثار والأحداث فقط", () => {
    expect(source).toContain('supabase.from("inventory_reconciliation_repairs"');
    expect(source).toContain('supabase.from("inventory_reconciliation_repair_items"');
    expect(source).toContain('supabase.from("inventory_reconciliation_repair_effects"');
    expect(source).toContain('supabase.from("inventory_reconciliation_repair_events"');
  });

  it("لا تستدعي دورة الكتابة أو التنفيذ", () => {
    expect(source).not.toContain("create_inventory_reconciliation_repair");
    expect(source).not.toContain("approve_inventory_reconciliation_repair");
    expect(source).not.toContain("execute_inventory_reconciliation_repair");
    expect(source).not.toContain(".insert(");
    expect(source).not.toContain(".update(");
    expect(source).not.toContain(".delete(");
  });

  it("تعرض تعديل المسودة من مكون مستقل للمسودة فقط", () => {
    expect(source).toContain("EditInventoryRepairDraftDialog");
    expect(source).toContain('repair.status === "draft"');
    expect(source).toContain("تعديل المسودة");
  });

  it("تعرض إرسال المسودة للمراجعة داخل حارس حالة المسودة نفسه", () => {
    expect(source).toContain("SubmitInventoryRepairDraftDialog");
    expect(source).toContain("itemsCount={items.length}");
    expect(source).toContain('repair.status === "draft"');
  });

  it("تعرض الاعتماد للمدير فقط عندما تكون المعالجة بانتظار المراجعة", () => {
    expect(source).toContain("ApproveInventoryRepairDialog");
    expect(source).toContain('repair.status === "ready_for_review" && role === "admin" && user');
    expect(source).toContain("currentUserId={user.id}");
  });

  it("تعرض منفذ الحدث باسمه ودوره دون UUID أو طلب لكل حدث", () => {
    expect(source).toContain('supabase.from("profiles").select("id, full_name").in("id", actorIds)');
    expect(source).toContain('supabase.from("user_roles").select("user_id, role").in("user_id", actorIds)');
    expect(source).toContain("نفّذ بواسطة:");
    expect(source).not.toContain("shortId(event.actorId)");
  });
});
