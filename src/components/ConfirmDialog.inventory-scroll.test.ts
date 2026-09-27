import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dialog = readFileSync(join(process.cwd(), "src/components/ConfirmDialog.tsx"), "utf8");
const form = readFileSync(join(process.cwd(), "src/pages/InventoryAdjustmentForm.tsx"), "utf8");

describe("معاينة ترحيل تسوية كثيرة البنود", () => {
  it("يخصص حد الارتفاع لنافذة الترحيل دون تغيير جميع نوافذ التأكيد", () => {
    expect(dialog).toContain("contentClassName?: string");
    expect(dialog).toContain('<AlertDialogContent dir="rtl" className={contentClassName}>');
    expect(form).toContain('contentClassName="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"');
  });

  it("يمرر جسم المعاينة مع بقاء جميع البنود والملخص متاحين", () => {
    expect(form).toContain('role="region" aria-label="تفاصيل بنود التسوية" tabIndex={0}');
    expect(form).toContain('className="min-h-0 space-y-3 overflow-y-auto overscroll-contain text-sm"');
    expect(form).toContain('className="sticky top-0 z-10');
    expect(form).toContain("عدد البنود: {postingPreview.length}");
    expect(form).toContain("postingPreview.map((line) => (");
    expect(form).not.toContain('className="max-h-52 divide-y overflow-y-auto"');
  });
});
