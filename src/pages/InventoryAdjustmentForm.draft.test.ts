import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/pages/InventoryAdjustmentForm.tsx"), "utf8");
const save = source.split("  async function handleSave() {")[1]
  ?.split("  async function handleDeleteDraft() {")[0];

describe("مسار حفظ تسوية المخزون", () => {
  it("يحفظ المسودة وبنودها بطلب خادمي واحد ولا يكتب جداولها على مراحل", () => {
    expect(save).toContain("saveInventoryAdjustmentDraft({");
    expect(save).toContain("expectedUpdatedAt: id ? loadedUpdatedAt : null");
    expect(save).not.toContain(".insert(");
    expect(save).not.toContain(".update(");
    expect(save).not.toContain(".delete(");
  });

  it("يرفض تكرار المنتج قبل إرسال المسودة", () => {
    expect(save).toContain("new Set(productIds).size !== productIds.length");
  });
});
