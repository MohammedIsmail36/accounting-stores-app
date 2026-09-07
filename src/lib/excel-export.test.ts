import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";

describe("ExcelJS read/write roundtrip", () => {
  it("should write and read Excel data correctly", async () => {
    // Create a test workbook
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Products");
    sheet.addRow(["الكود", "الاسم", "سعر الشراء", "سعر البيع"]);
    sheet.addRow(["P001", "منتج تجريبي", 100, 150]);
    sheet.addRow(["P002", "منتج ثاني", 200, 300]);

    // Write to buffer
    const buffer = await workbook.xlsx.writeBuffer();
    expect(buffer).toBeDefined();
    expect(buffer.byteLength).toBeGreaterThan(0);

    // Read back
    const workbook2 = new ExcelJS.Workbook();
    await workbook2.xlsx.load(buffer as ArrayBuffer);

    const sheet2 = workbook2.worksheets[0];
    expect(sheet2.name).toBe("Products");

    const rows: any[][] = [];
    sheet2.eachRow((row) => {
      rows.push(row.values as any[]);
    });

    expect(rows.length).toBe(3); // header + 2 data rows

    // ExcelJS row.values has undefined at index 0
    const headerRow = rows[0].slice(1);
    expect(headerRow).toEqual(["الكود", "الاسم", "سعر الشراء", "سعر البيع"]);

    const dataRow1 = rows[1].slice(1);
    expect(dataRow1).toEqual(["P001", "منتج تجريبي", 100, 150]);

    const dataRow2 = rows[2].slice(1);
    expect(dataRow2).toEqual(["P002", "منتج ثاني", 200, 300]);
  });
});
