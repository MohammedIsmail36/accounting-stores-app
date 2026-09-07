import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Test CSV export logic (without DOM dependency for file download)
 */
describe("CSV Export Logic", () => {
  const escapeCell = (val: string | number) => {
    const s = String(val);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const buildCsv = (headers: string[], rows: (string | number)[][]) => {
    const bom = "\uFEFF";
    return bom + [headers.map(escapeCell), ...rows.map(r => r.map(escapeCell))]
      .map(r => r.join(","))
      .join("\n");
  };

  it("should include BOM for Arabic support", () => {
    const csv = buildCsv(["اسم"], [["أحمد"]]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  it("should produce correct CSV structure", () => {
    const csv = buildCsv(
      ["الكود", "الاسم", "السعر"],
      [["P001", "منتج", 100], ["P002", "منتج2", 200]]
    );
    const lines = csv.split("\n");
    expect(lines.length).toBe(3); // header + 2 rows
    expect(lines[0]).toContain("الكود");
  });

  it("should escape commas in values", () => {
    const result = escapeCell("hello, world");
    expect(result).toBe('"hello, world"');
  });

  it("should escape double quotes in values", () => {
    const result = escapeCell('he said "hi"');
    expect(result).toBe('"he said ""hi"""');
  });

  it("should escape newlines in values", () => {
    const result = escapeCell("line1\nline2");
    expect(result).toBe('"line1\nline2"');
  });

  it("should not escape simple values", () => {
    expect(escapeCell("simple")).toBe("simple");
    expect(escapeCell(42)).toBe("42");
  });
});
