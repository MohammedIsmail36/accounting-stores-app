/**
 * Export data as a CSV file with BOM for Arabic support
 */
export function exportToCsv({
  filename,
  headers,
  rows,
}: {
  filename: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  const bom = "\uFEFF";
  const escapeCell = (val: string | number) => {
    const s = String(val);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const csv =
    bom +
    [headers.map(escapeCell), ...rows.map((r) => r.map(escapeCell))]
      .map((r) => r.join(","))
      .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
