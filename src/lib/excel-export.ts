import ExcelJS from "exceljs";

// Tab colors cycling order
const TAB_COLORS = [
  "FFEC5B13",
  "FFD4A853",
  "FF3B82F6",
  "FF6366F1",
  "FF0E7490",
  "FF15803D",
];

interface ExportSheetOptions {
  sheetName: string;
  headers: string[];
  rows: any[][];
  title?: string;
  metaRows?: Array<[string, string | number]>;
  totalsRow?: boolean;
}

interface ExportOptions extends ExportSheetOptions {
  filename: string;
  extraSheets?: ExportSheetOptions[];
}

/**
 * Export data as an Excel file using ExcelJS (secure alternative to xlsx/SheetJS)
 * Supports two signatures:
 *   exportToExcel(options: ExportOptions)
 *   exportToExcel(data: Record[], sheetName, fileName) — legacy
 */
export async function exportToExcel(
  dataOrOptions: Record<string, any>[] | ExportOptions,
  sheetName?: string,
  fileName?: string,
) {
  const toExcelColumn = (columnNumber: number) => {
    let n = columnNumber;
    let label = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      label = String.fromCharCode(65 + rem) + label;
      n = Math.floor((n - 1) / 26);
    }
    return label || "A";
  };

  const isPercentHeader = (h: string) => /%|نسبة|هامش/.test(h);

  const styleHeaderRow = (headerRow: ExcelJS.Row) => {
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE2E8F0" },
      };
      cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
  };

  const applyNumberFormat = (
    cell: ExcelJS.Cell,
    headerStr: string,
    value: any,
  ) => {
    if (typeof value !== "number") return;
    if (isPercentHeader(headerStr)) {
      cell.numFmt = "0.00%";
      // percent values from pages are already 0–100, convert to 0–1 for Excel
      cell.value = value / 100;
    } else {
      cell.numFmt = "#,##0.00";
    }
  };

  const applyNumericColor = (cell: ExcelJS.Cell, value: any) => {
    if (typeof value !== "number" || value === 0) return;
    cell.font = {
      ...(cell.font ?? {}),
      color: { argb: value < 0 ? "FFDC2626" : "FF15803D" },
      bold: value < 0,
    };
  };

  const autoFitColumns = (worksheet: ExcelJS.Worksheet) => {
    worksheet.columns.forEach((column) => {
      let maxLength = 10;
      column.eachCell?.({ includeEmpty: true }, (cell) => {
        const cellLength = cell.value ? String(cell.value).length : 0;
        if (cellLength > maxLength) maxLength = cellLength;
      });
      column.width = Math.min(maxLength + 2, 48);
    });
  };

  const addSheet = (
    workbook: ExcelJS.Workbook,
    opts: ExportSheetOptions,
    tabColorArgb: string,
  ) => {
    const worksheet = workbook.addWorksheet(opts.sheetName);

    // ── Tab color ──
    worksheet.properties = {
      ...worksheet.properties,
      tabColor: { argb: tabColorArgb },
    } as any;

    // ── Print setup ──
    worksheet.pageSetup = {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    } as any;

    const safeHeaders = opts.headers?.length ? opts.headers : ["-"];
    const maxCols = safeHeaders.length;

    let currentRow = 0;

    if (opts.title) {
      const titleRow = worksheet.addRow([opts.title]);
      currentRow = titleRow.number;
      worksheet.mergeCells(
        `A${titleRow.number}:${toExcelColumn(maxCols)}${titleRow.number}`,
      );
      const titleCell = titleRow.getCell(1);
      titleCell.font = { bold: true, size: 14 };
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      titleCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF8FAFC" },
      };
      titleRow.height = 28;
      worksheet.addRow([]);
      currentRow += 2;
    }

    if (opts.metaRows?.length) {
      opts.metaRows.forEach(([label, value]) => {
        const row = worksheet.addRow([label, value]);
        row.getCell(1).font = { bold: true };
        row.getCell(1).alignment = { horizontal: "right" };
        row.getCell(2).alignment = { horizontal: "left" };
        currentRow = row.number;
      });
      worksheet.addRow([]);
      currentRow++;
    }

    const headerRowNum = currentRow + 1;
    const headerRow = worksheet.addRow(safeHeaders);
    styleHeaderRow(headerRow);
    headerRow.height = 22;

    // ── Freeze rows above + header ──
    worksheet.views = [
      {
        state: "frozen",
        ySplit: headerRow.number,
        xSplit: 0,
        activeCell: "A1",
      },
    ];

    // ── AutoFilter ──
    worksheet.autoFilter = {
      from: { row: headerRow.number, column: 1 },
      to: { row: headerRow.number, column: maxCols },
    };

    // ── Print repeat titles ──
    (worksheet.pageSetup as any).printTitlesRow =
      `${headerRowNum}:${headerRowNum}`;

    // ── Data rows ──
    opts.rows.forEach((rowData, rowIdx) => {
      const dataRow = worksheet.addRow(rowData);
      const isEven = rowIdx % 2 === 0;

      dataRow.eachCell({ includeEmpty: true }, (cell, colIdx) => {
        const headerStr = safeHeaders[colIdx - 1] ?? "";
        const rawValue = rowData[colIdx - 1];

        // Alternating row color
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: isEven ? "FFFFFFFF" : "FFF8FAFC" },
        };
        cell.border = {
          bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
        };
        cell.alignment = { vertical: "middle", horizontal: "center" };

        // Number formatting
        applyNumberFormat(cell, headerStr, rawValue);

        // Conditional color: red negative, green positive
        applyNumericColor(cell, rawValue);
      });
    });

    // ── Totals row ──
    if (opts.totalsRow && opts.rows.length > 0) {
      const totalsData = safeHeaders.map((h, i) => {
        const col = opts.rows.map((r) => r[i]);
        const allNum = col.every((v) => typeof v === "number");
        if (allNum) return col.reduce((a: number, b: number) => a + b, 0);
        return i === 0 ? "الإجمالي" : "";
      });
      const totalsRow = worksheet.addRow(totalsData);
      totalsRow.eachCell({ includeEmpty: true }, (cell, colIdx) => {
        const headerStr = safeHeaders[colIdx - 1] ?? "";
        cell.font = { bold: true };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE2E8F0" },
        };
        cell.border = {
          top: { style: "medium", color: { argb: "FF94A3B8" } },
          bottom: { style: "thin", color: { argb: "FF94A3B8" } },
        };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        const rawValue = totalsData[colIdx - 1];
        applyNumberFormat(cell, headerStr, rawValue);
        applyNumericColor(cell, rawValue);
      });
      totalsRow.height = 20;
    }

    autoFitColumns(worksheet);
  };

  const workbook = new ExcelJS.Workbook();

  if (Array.isArray(dataOrOptions)) {
    // Legacy signature
    const data = dataOrOptions;
    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    const rows = data.map((row) => Object.values(row));
    addSheet(
      workbook,
      { sheetName: sheetName || "Sheet1", headers, rows },
      TAB_COLORS[0],
    );
    fileName = fileName || "export";
  } else {
    // New options signature
    const opts = dataOrOptions;
    addSheet(
      workbook,
      {
        sheetName: opts.sheetName,
        headers: opts.headers,
        rows: opts.rows,
        title: opts.title,
        metaRows: opts.metaRows,
        totalsRow: opts.totalsRow,
      },
      TAB_COLORS[0],
    );

    opts.extraSheets?.forEach((sheet, idx) =>
      addSheet(workbook, sheet, TAB_COLORS[(idx + 1) % TAB_COLORS.length]),
    );
    fileName = opts.filename;
  }

  const finalFileName = fileName?.toLowerCase().endsWith(".xlsx")
    ? fileName
    : `${fileName}.xlsx`;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = finalFileName!;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Read an Excel file and return rows as arrays (for import functionality)
 */
export async function readExcelFile(
  file: File,
): Promise<{ sheetNames: string[]; rows: any[][] }> {
  const workbook = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  const sheetNames = workbook.worksheets.map((ws) => ws.name);
  const rows: any[][] = [];

  sheet.eachRow((row) => {
    rows.push(row.values as any[]);
  });

  return { sheetNames, rows };
}
