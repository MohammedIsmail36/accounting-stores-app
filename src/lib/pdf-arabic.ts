/**
 * pdf-arabidc.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * يستخدم React.createElement بدلاً من JSX → يعمل كملف .ts بدون أخطاء
 *
 * الإصلاحات والتحسينات:
 *  ✅ fontWeight أرقام فقط (400/500/700)
 *  ✅ تحسين استخدام لون نوع الفاتورة (Accent Color) في التفاصيل
 *  ✅ توسيط رقم الفاتورة ونوعها (Badge)
 *  ✅ إزالة العملة والزخرفة الزائدة من شريط العميل/المورد
 *  ✅ تصحيح تخطيط الإجماليات ليكون RTL صحيح (الإجمالي يمينًا)
 *  ✅ تحسين الأداء (Memoization) لحساب أعمدة الجدول
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Font,
  pdf,
} from "@react-pdf/renderer";
import type { CompanySettings } from "@/contexts/SettingsContext";

// ─────────────────────────────────────────────────────────────────────────────
// 1. تسجيل الخطوط
// ─────────────────────────────────────────────────────────────────────────────
Font.register({
  family: "Tajawal",
  fonts: [
    { src: "/fonts/Tajawal-Regular.ttf", fontWeight: 400 },
    { src: "/fonts/Tajawal-Medium.ttf", fontWeight: 500 },
    { src: "/fonts/Tajawal-Bold.ttf", fontWeight: 700 },
  ],
});

// Mono font removed — files not available, using Tajawal for all text

Font.registerHyphenationCallback((word) => [word]);

// ─────────────────────────────────────────────────────────────────────────────
// 2. الألوان
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  ink: "#0f172a",
  ink2: "#1e293b",
  ink3: "#334155",
  ink4: "#475569",
  ink5: "#64748b",
  ink6: "#94a3b8",
  primary: "#ec5b13",
  primaryLight: "#fff7ed",
  primaryBorder: "#fed7aa",
  gold: "#d4a853",
  goldPale: "#fffbeb",
  goldLine: "#f0d990",
  goldMid: "#f0c96a",
  border: "#e2e8f0",
  bgSoft: "#f8fafc",
  slate100: "#f1f5f9",
  slate200: "#e2e8f0",
  slate400: "#94a3b8",
  slate500: "#64748b",
  slate800: "#1e293b",
  white: "#ffffff",
  green: "#15803d",
  red: "#dc2626",
  orange: "#ea580c",
  amber: "#b45309",
  amberDark: "#92400e",
  cyan: "#0e7490",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 3. Helpers
// ─────────────────────────────────────────────────────────────────────────────
const fmtNum = (v: number): string =>
  v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtDate = (d: string): string => {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

const fmtDateFull = (d: Date): string =>
  d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

async function loadLogoBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn("فشل تحميل الخط:", e);
    return null;
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. الأنماط (Styles)
// ─────────────────────────────────────────────────────────────────────────────
const base = StyleSheet.create({
  page: {
    fontFamily: "Tajawal",
    fontSize: 9,
    paddingBottom: 58,
    backgroundColor: C.white,
  },
  body: {
    paddingHorizontal: 30,
  },
  goldStripe: {
    height: 4,
    backgroundColor: C.gold,
  },

  // ── هيدر ──
  header: {
    backgroundColor: C.ink,
    paddingHorizontal: 30,
    paddingVertical: 18,
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
  },

  // جانب الشركة (يمين)
  companyBlock: {
    maxWidth: "35%",
    alignItems: "flex-end",
  },
  companyName: {
    fontSize: 14,
    fontWeight: 700,
    color: C.white,
    textAlign: "center",
  },
  companyNameEn: {
    fontSize: 12,
    color: C.white,
    textAlign: "center",
    marginTop: 2,
  },
  companyActivity: {
    fontSize: 10,
    color: C.white,
    textAlign: "center",
    marginTop: 1,
  },

  // ── Badge (وسط) ──
  badgeBlock: {
    alignItems: "center", // توسيط كامل
  },
  badgeLabel: {
    fontSize: 8,
    fontWeight: 700,
    color: C.gold,
    textAlign: "center",
  },
  badgeNumber: {
    fontSize: 20,
    fontWeight: 700,
    color: C.white,
    textAlign: "center",
    marginTop: 4,
  },

  // ── Legal Bar ──
  legalBar: {
    backgroundColor: C.bgSoft,
    paddingVertical: 6,
    paddingHorizontal: 30,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  legalText: {
    fontSize: 7,
    color: C.ink6,
    textAlign: "center",
  },

  // ── تسمية القسم ──
  sectionLabel: {
    fontSize: 7,
    fontWeight: 700,
    color: C.gold,
    marginBottom: 6,
    textAlign: "right",
  },

  // ── Footer: ثابت في الأسفل ──
  footerFixed: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  footerStripe: {
    height: 4,
    backgroundColor: C.gold,
  },
  footerContent: {
    paddingHorizontal: 30,
    paddingVertical: 6,
    borderTopWidth: 0.5,
    borderTopColor: C.border,
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: C.white,
  },
  footerText: {
    fontSize: 7,
    color: C.ink6,
  },
  footerCenter: {
    fontSize: 7,
    color: C.ink5,
    textAlign: "center",
    flex: 1,
  },
});

const tbl = StyleSheet.create({
  headerRow: {
    flexDirection: "row-reverse",
    backgroundColor: C.ink,
    borderBottomWidth: 1.5,
    borderBottomColor: C.gold,
  },
  headerCell: {
    fontSize: 8,
    fontWeight: 700,
    color: "#ffffff90",
    textAlign: "center",
    paddingVertical: 7,
    paddingHorizontal: 6,
  },
  row: {
    flexDirection: "row-reverse",
    borderBottomWidth: 0.5,
    borderBottomColor: "#f1f5f9",
  },
  rowEven: { backgroundColor: "#fafafa" },
  rowOdd: { backgroundColor: C.white },
  cell: {
    fontSize: 9,
    color: C.ink4,
    textAlign: "center",
    paddingVertical: 7,
    paddingHorizontal: 6,
  },
  cellBold: {
    fontSize: 9,
    fontWeight: 700,
    color: C.ink,
    textAlign: "left",
    paddingVertical: 7,
    paddingHorizontal: 6,
    fontFamily: "Tajawal",
  },
  cellName: {
    fontSize: 9,
    fontWeight: 700,
    color: C.ink,
    textAlign: "right",
    paddingVertical: 7,
    paddingHorizontal: 6,
  },
  cellNum: {
    fontFamily: "Tajawal",
    fontSize: 8.5,
    color: C.ink4,
    textAlign: "center",
    paddingVertical: 7,
    paddingHorizontal: 4,
  },
});

const inv = StyleSheet.create({
  metaBar: {
    flexDirection: "row-reverse",
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
    backgroundColor: C.bgSoft,
    marginBottom: 14,
  },
  clientBox: {
    width: "40%",
    paddingVertical: 10,
    paddingHorizontal: 14,
    // تم إزالة الحدود الجانبية والزخرفة
    justifyContent: "center",
    borderLeftWidth: 0.5, // فاصل خفيف فقط
    borderLeftColor: C.border,
  },
  clientLabel: {
    fontSize: 7,
    fontWeight: 700,
    color: C.gold, // سيتغير ديناميكياً
    textAlign: "right",
    marginBottom: 4,
  },
  clientName: {
    fontSize: 11,
    fontWeight: 700,
    color: C.ink,
    textAlign: "right",
  },
  metaCell: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRightWidth: 0.5,
    borderRightColor: C.border,
    justifyContent: "center",
  },
  metaLabel: {
    fontSize: 7,
    fontWeight: 700,
    color: C.ink6,
    textAlign: "right",
  },
  metaValue: {
    fontFamily: "Tajawal",
    fontSize: 10,
    fontWeight: 600,
    color: C.ink,
    textAlign: "right",
    marginTop: 3,
  },

  // ── تعديل تخطيط الأسفل: الاتجاه "row" (افتراضي) ──
  // لجعل أول عنصر (الملخص) يسار، وثاني عنصر (الإجماليات) يمين
  bottomGrid: {
    flexDirection: "row",
    marginTop: 14,
    justifyContent: "space-between",
  },
  summaryCol: {
    width: "52%",
    paddingRight: 10, // مسافة بين العمودين
  },
  totalsCol: {
    width: "46%",
    alignItems: "flex-end", // ل sticking مربع الإجماليات لليمين
  },

  // ── مظهر المربعات ──
  summaryBar: {
    flexDirection: "row-reverse",
    backgroundColor: C.goldPale,
    borderWidth: 1,
    borderColor: C.goldLine, // ديناميكي
    borderRadius: 2,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryLabel: {
    fontSize: 9,
    color: C.amberDark,
    marginLeft: 4,
  },
  summaryValue: {
    fontSize: 10,
    fontWeight: 700,
    color: C.amber,
  },
  notesBox: {
    backgroundColor: C.bgSoft,
    borderWidth: 1,
    borderColor: C.border,
    borderRightWidth: 2, // لمسة جمالية
    borderRightColor: C.gold, // ديناميكي
    padding: 10,
    marginTop: 8,
  },
  notesLabel: {
    fontSize: 7,
    fontWeight: 700,
    color: C.gold, // ديناميكي
    marginBottom: 4,
    textAlign: "right",
  },
  notesText: {
    fontSize: 9,
    color: C.ink5,
    lineHeight: 1.8,
    textAlign: "right",
  },

  // ── صفوف الإجماليات ──
  totalRow: {
    width: "100%", // العرض الكامل داخل العمود
    flexDirection: "row-reverse",
    justifyContent: "space-between", // ✅ إصلاح التصاق النصوص
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  totalLabel: {
    fontSize: 10,
    color: C.ink5,
    textAlign: "right",
  },
  totalValue: {
    fontSize: 10,
    color: C.ink,
    textAlign: "left",
    fontFamily: "Tajawal",
  },
  grandRow: {
    width: "100%",
    flexDirection: "row-reverse",
    justifyContent: "space-between", // ✅ إصلاح التصاق النصوص
    backgroundColor: C.ink,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderTopWidth: 1.5,
    borderTopColor: C.gold,
  },
  grandLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: "#ffffff90",
    textAlign: "right",
  },
  grandValue: {
    fontSize: 14,
    fontWeight: 700,
    color: C.goldMid,
    textAlign: "left",
    fontFamily: "Tajawal",
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. مكون Footer
// ─────────────────────────────────────────────────────────────────────────────
function PdfFooter({
  settings,
  accentColor = C.gold,
}: {
  settings: CompanySettings | null;
  accentColor?: string;
}) {
  const tags: string[] = [];
  if (settings?.address) tags.push(settings.address);
  if (settings?.email) tags.push(settings.email);
  if (settings?.phone) tags.push(settings.phone);
  if (settings?.tax_number) tags.push(`VAT: ${settings.tax_number}`);
  if (settings?.commercial_register)
    tags.push(`C.R: ${settings.commercial_register}`);

  return React.createElement(
    View,
    { style: base.footerFixed, fixed: true },
    React.createElement(View, {
      style: { ...base.footerStripe, backgroundColor: accentColor },
    }),
    React.createElement(
      View,
      { style: base.footerContent },
      React.createElement(
        Text,
        { style: base.footerText },
        fmtDateFull(new Date()),
      ),
      React.createElement(
        Text,
        { style: base.footerCenter },
        tags.join("  ·  "),
      ),
      React.createElement(Text, {
        style: base.footerText,
        render: ({
          pageNumber,
          totalPages,
        }: {
          pageNumber: number;
          totalPages: number;
        }) => `${pageNumber} / ${totalPages}`,
      }),
    ),
    settings?.invoice_footer
      ? React.createElement(
          View,
          {
            style: {
              backgroundColor: C.bgSoft,
              paddingHorizontal: 30,
              paddingBottom: 3,
            },
          },
          React.createElement(
            Text,
            {
              style: {
                fontSize: 6.5,
                color: C.ink6,
                textAlign: "center" as const,
              },
            },
            settings.invoice_footer,
          ),
        )
      : null,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. مكون Header
// ─────────────────────────────────────────────────────────────────────────────
function PdfHeader({
  settings,
  logoData,
  accentColor,
  badge,
}: {
  settings: CompanySettings | null;
  logoData: string | null;
  accentColor: string;
  badge?: React.ReactNode;
}) {
  const s = settings;

  const logoEl = logoData
    ? React.createElement(Image, {
        src: logoData,
        style: { width: 44, height: 44, borderRadius: 8 },
      })
    : React.createElement(
        View,
        {
          style: {
            width: 44,
            height: 44,
            backgroundColor: accentColor,
            borderRadius: 8,
            alignItems: "center" as const,
            justifyContent: "center" as const,
          },
        },
        React.createElement(
          Text,
          {
            style: {
              fontSize: 20,
              fontWeight: 700,
              color: C.white,
              fontFamily: "Tajawal",
            },
          },
          (s?.company_name ?? "N").charAt(0).toUpperCase(),
        ),
      );

  return React.createElement(
    View,
    null,
    React.createElement(View, {
      style: { ...base.goldStripe, backgroundColor: accentColor },
    }),
    React.createElement(
      View,
      { style: base.header },
      // يمين: الشركة
      React.createElement(
        View,
        { style: base.companyBlock },
        React.createElement(
          Text,
          { style: base.companyName },
          s?.company_name ?? "النظام المحاسبي",
        ),
        s?.company_name_en
          ? React.createElement(
              Text,
              { style: base.companyNameEn },
              s.company_name_en,
            )
          : null,
        s?.business_activity
          ? React.createElement(
              Text,
              { style: base.companyActivity },
              s.business_activity,
            )
          : null,
      ),
      // وسط: Badge
      badge ?? null,
      // يسار: الشعار
      logoEl,
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. LegalBar
// ─────────────────────────────────────────────────────────────────────────────
// function LegalBar({ settings }: { settings: CompanySettings | null }) {
//   const s = settings;
//   const parts: string[] = [];
//   if (s?.address) parts.push(s.address);
//   if (s?.phone) parts.push(s.phone);
//   if (s?.email) parts.push(s.email);
//   if (s?.tax_number) parts.push(`VAT: ${s.tax_number}`);
//   if (s?.commercial_register) parts.push(`C.R: ${s.commercial_register}`);
//   if (!parts.length) return null;
//   return React.createElement(
//     View,
//     { style: base.legalBar },
//     React.createElement(Text, { style: base.legalText }, parts.join("   ·   ")),
//   );
// }

// ─────────────────────────────────────────────────────────────────────────────
// 8. DataTable (Optimized)
// ─────────────────────────────────────────────────────────────────────────────
const WIDE_KEYWORDS = [
  "اسم",
  "وصف",
  "منتج",
  "بضاعة",
  "صنف",
  "بيان",
  "عنوان",
  "barcode",
  "باركود",
  "رقم المنتج",
  "العميل",
  "الجهة",
  "المورد",
];
const NARROW_KEYWORDS = [
  "كمية",
  "سعر",
  "إجمالي",
  "اجمالي",
  "ضريبة",
  "خصم",
  "رصيد",
  "مبلغ",
  "#",
  "كود",
  "رقم",
  "تاريخ",
  "نسبة",
  "معدل",
  "discount",
  "qty",
  "price",
  "total",
  "tax",
  "date",
];

function detectColType(header: string): "wide" | "narrow" | "medium" {
  const h = header.toLowerCase();
  if (WIDE_KEYWORDS.some((k) => h.includes(k))) return "wide";
  if (NARROW_KEYWORDS.some((k) => h.includes(k))) return "narrow";
  return "medium";
}

function buildColWidths(headers: string[]): string[] {
  const types = headers.map(detectColType);
  const wCount = types.filter((t) => t === "wide").length || 0;
  const nCount = types.filter((t) => t === "narrow").length || 0;
  const mCount = types.filter((t) => t === "medium").length || 0;

  const rawWide = 30;
  const rawNarrow = 10;
  const rawMedium = 15;
  const rawTotal = wCount * rawWide + nCount * rawNarrow + mCount * rawMedium;
  const scale = 100 / (rawTotal || headers.length * 15);

  return types.map((t) => {
    const pct =
      t === "wide"
        ? rawWide * scale
        : t === "narrow"
          ? rawNarrow * scale
          : rawMedium * scale;
    return `${Math.round(pct)}%`;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Product name cells: "[PRD-377] الاسم - الماركة - الموديل"
// Mixing a Latin code inside an RTL sentence breaks the visual order in PDF,
// so we render the code as its own LTR line above the Arabic name.
// ─────────────────────────────────────────────────────────────────────────────
const CODE_PREFIX_RE = /^\s*\[([^\]]+)\]\s*(.*)$/s;

function renderNameCell(
  key: string,
  value: string,
  style: Record<string, unknown>,
): React.ReactNode {
  const match = CODE_PREFIX_RE.exec(value);
  if (!match) {
    return React.createElement(Text, { key, style }, value);
  }
  const [, code, rest] = match;
  const fontSize =
    typeof style.fontSize === "number" ? (style.fontSize as number) : 8;
  return React.createElement(
    View,
    { key, style },
    React.createElement(
      Text,
      {
        style: {
          fontSize: Math.max(6, fontSize - 1),
          color: C.ink5,
          textAlign: "right" as const,
          direction: "ltr" as const,
        },
      },
      code,
    ),
    React.createElement(Text, { style: { textAlign: "right" as const } }, rest),
  );
}


function DataTable({
  headers,
  rows,
  colWidths: externalWidths,
}: {
  headers: string[];
  rows: (string | number)[][];
  colWidths?: (string | number)[];
}) {
  const colWidths = externalWidths ?? buildColWidths(headers);
  const colTypes = headers.map(detectColType); // ✅ حساب مرة واحدة

  const headerRow = React.createElement(
    View,
    { style: tbl.headerRow },
    ...headers.map((h, i) =>
      React.createElement(
        Text,
        { key: `h-${i}`, style: { ...tbl.headerCell, width: colWidths[i] } },
        h,
      ),
    ),
  );

  const bodyRows = rows.map((row, ri) =>
    React.createElement(
      View,
      {
        key: `r-${ri}`,
        style: { ...tbl.row, ...(ri % 2 === 0 ? tbl.rowOdd : tbl.rowEven) },
      },
      ...row.map((cell, ci) => {
        const colType = colTypes[ci];
        const isLast = ci === row.length - 1;

        if (isLast)
          return React.createElement(
            Text,
            {
              key: `c-${ri}-${ci}`,
              style: { ...tbl.cellBold, width: colWidths[ci] },
            },
            String(cell),
          );
        if (colType === "wide")
          return renderNameCell(`c-${ri}-${ci}`, String(cell), {
            ...tbl.cellName,
            width: colWidths[ci],
          });
        return React.createElement(
          Text,
          {
            key: `c-${ri}-${ci}`,
            style: { ...tbl.cellNum, width: colWidths[ci] },
          },
          String(cell),
        );
      }),
    ),
  );

  return React.createElement(View, null, headerRow, ...bodyRows);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. أنواع الفاتورة
// ─────────────────────────────────────────────────────────────────────────────
type InvoiceType =
  | "sales_invoice"
  | "purchase_invoice"
  | "sales_return"
  | "purchase_return";

const TYPE_META: Record<
  InvoiceType,
  { label: string; typeLabel: string; stripe: string }
> = {
  sales_invoice: {
    label: "فاتورة مبيعات",
    typeLabel: "INVOICE · فاتورة مبيعات ",
    stripe: C.gold,
  },
  purchase_invoice: {
    label: "فاتورة مشتريات",
    typeLabel: "INVOICE · فاتورة مشتريات",
    stripe: C.gold,
  },
  sales_return: {
    label: "مرتجع مبيعات",
    typeLabel: "RETURN · مرتجع مبيعات",
    stripe: C.gold,
  },
  purchase_return: {
    label: "مرتجع مشتريات",
    typeLabel: "RETURN · مرتجع مشتريات",
    stripe: C.gold,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 10. Interfaces
// ─────────────────────────────────────────────────────────────────────────────
export interface ReportPdfOptions {
  title: string;
  settings: CompanySettings | null;
  headers: string[];
  rows: (string | number)[][];
  /** تمييز صفوف الإجماليات: نفس ترتيب rows؛ undefined = صف عادي */
  rowEmphasis?: (undefined | "subtotal" | "total")[];
  summaryCards?: { label: string; value: string }[];
  summaryColumns?: number;
  methodologyTitle?: string;
  methodologyLines?: string[];
  reconciliationTitle?: string;
  reconciliationRows?: {
    label: string;
    value: string;
    tone?: "neutral" | "positive" | "negative" | "primary";
  }[];
  tableTitle?: string;
  footerNoteTitle?: string;
  footerNoteLines?: string[];
  footerNoteBlocks?: {
    label: string;
    segments: { text: string; highlight?: boolean }[];
  }[];
  orientation?: "portrait" | "landscape";
  filename: string;
}

export interface InvoicePdfOptions {
  type: InvoiceType;
  number: number | string;
  date: string;
  partyName: string;
  partyLabel: string;
  reference?: string;
  notes?: string;
  items: {
    name: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    total: number;
  }[];
  subtotal: number;
  discountTotal?: number;
  invoiceDiscount?: number;
  taxAmount?: number;
  taxRate?: number;
  grandTotal: number;
  showTax?: boolean;
  showDiscount?: boolean;
  settings: CompanySettings | null;
  status?: string;
  dueDate?: string;
  paidAmount?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. ReportDocument
// ─────────────────────────────────────────────────────────────────────────────
function ReportDocument(
  props: Omit<ReportPdfOptions, "filename"> & { logoData: string | null },
) {
  const {
    title,
    settings,
    headers,
    rows,
    rowEmphasis,
    summaryCards,
    summaryColumns,
    methodologyTitle,
    methodologyLines,
    reconciliationTitle,
    reconciliationRows,
    tableTitle,
    footerNoteTitle,
    footerNoteLines,
    footerNoteBlocks,
    orientation = "portrait",
    logoData,
  } = props;
  const currency = settings?.default_currency ?? "EGP";
  const accent = C.primary;

  // ── Report-specific styles matching invoice template ──
  const rpt = StyleSheet.create({
    page: {
      fontFamily: "Tajawal",
      fontSize: 9,
      paddingBottom: 50,
      backgroundColor: C.white,
    },
    // Light header matching template
    header: {
      paddingHorizontal: 24,
      paddingTop: 20,
      paddingBottom: 14,
      borderBottomWidth: 2,
      borderBottomColor: `${accent}33`, // primary/20
      marginBottom: 12,
    },
    headerRow: {
      flexDirection: "row-reverse" as const,
      justifyContent: "space-between" as const,
      alignItems: "flex-start" as const,
    },
    // Company info (right side)
    companySection: {
      flexDirection: "row-reverse" as const,
      alignItems: "center" as const,
      gap: 8,
    },
    companyIcon: {
      width: 36,
      height: 36,
      backgroundColor: accent,
      borderRadius: 4,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    companyIconText: {
      fontSize: 18,
      fontWeight: 700,
      color: C.white,
    },
    companyName: {
      fontSize: 16,
      fontWeight: 700,
      color: C.ink,
      textAlign: "right" as const,
    },
    companyActivity: {
      fontSize: 9,
      color: C.slate500,
      textAlign: "right" as const,
      marginTop: 2,
    },
    // Report title (center/left)
    titleSection: {
      alignItems: "center" as const,
    },
    titleText: {
      fontSize: 18,
      fontWeight: 700,
      color: accent,
      textAlign: "center" as const,
    },
    titleBadge: {
      backgroundColor: `${accent}1a`, // primary/10
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 20,
      marginTop: 6,
    },
    titleBadgeText: {
      fontSize: 8,
      fontWeight: 700,
      color: accent,
      textAlign: "center" as const,
    },
    // Date info
    dateSection: {
      alignItems: "flex-start" as const,
    },
    dateLabel: {
      fontSize: 8,
      fontWeight: 700,
      color: C.slate400,
      textAlign: "left" as const,
    },
    dateValue: {
      fontSize: 9,
      fontWeight: 700,
      color: C.ink,
      textAlign: "left" as const,
      marginTop: 2,
    },
    methodologyBox: {
      marginHorizontal: 24,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: `${accent}33`,
      backgroundColor: `${accent}0d`,
      borderRadius: 6,
      paddingVertical: 8,
      paddingHorizontal: 10,
    },
    methodologyTitle: {
      fontSize: 9,
      fontWeight: 700,
      color: accent,
      textAlign: "right" as const,
      marginBottom: 4,
    },
    methodologyLine: {
      fontSize: 8,
      color: C.ink4,
      textAlign: "right" as const,
      lineHeight: 1.7,
      marginBottom: 2,
    },
    footerNoteBlock: {
      flexDirection: "row" as const,
      justifyContent: "flex-end" as const,
      alignItems: "center" as const,
      marginBottom: 3,
      flexWrap: "wrap" as const,
    },
    footerNoteBlockLabel: {
      fontSize: 8,
      fontWeight: 700,
      color: accent,
      textAlign: "right" as const,
      marginLeft: 6,
    },
    footerNoteSegment: {
      fontSize: 8,
      color: C.ink4,
      textAlign: "center" as const,
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 3,
      backgroundColor: "transparent",
    },
    footerNoteSegmentHighlight: {
      fontSize: 8,
      fontWeight: 700,
      color: accent,
      backgroundColor: `${accent}15`,
      textAlign: "center" as const,
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 3,
    },
    footerNoteSeparator: {
      fontSize: 8,
      color: C.ink6,
      textAlign: "center" as const,
      paddingHorizontal: 2,
    },
    // ── Section headers ──
    // sectionHeader: {
    //   flexDirection: "row-reverse" as const,
    //   alignItems: "center" as const,
    //   backgroundColor: C.slate100,
    //   borderRightWidth: 4,
    //   borderRightColor: accent,
    //   paddingVertical: 6,
    //   paddingHorizontal: 12,
    //   marginHorizontal: 24,
    //   marginBottom: 8,
    //   marginTop: 4,
    //   borderRadius: 2,
    // },
    // sectionHeaderText: {
    //   fontSize: 9,
    //   fontWeight: 700,
    //   color: C.ink2,
    //   textAlign: "right" as const,
    // },
    // Summary cards — 4 per row
    summaryRow: {
      flexDirection: "row-reverse" as const,
      flexWrap: "wrap" as const,
      gap: 6,
      marginHorizontal: 24,
      marginBottom: 12,
    },
    summaryCard: {
      flexGrow: 1,
      flexBasis:
        summaryColumns && summaryColumns > 0
          ? `${Math.floor((100 - (summaryColumns - 1) * 1) / summaryColumns) - 1}%`
          : "23%",
      backgroundColor: C.bgSoft,
      borderWidth: 1,
      borderColor: C.slate200,
      borderTopWidth: 2,
      borderTopColor: accent,
      borderRadius: 4,
      paddingVertical: 8,
      paddingHorizontal: 8,
      alignItems: "center" as const,
    },
    summaryCardLabel: {
      fontSize: 7,
      fontWeight: 700,
      color: C.slate400,
      textAlign: "center" as const,
      marginBottom: 3,
    },
    summaryCardValue: {
      fontSize: 11,
      fontWeight: 700,
      color: accent,
      textAlign: "center" as const,
    },
    // Light table styles
    tableHeaderRow: {
      flexDirection: "row-reverse" as const,
      backgroundColor: C.slate100,
      borderBottomWidth: 1,
      borderBottomColor: C.slate200,
    },
    tableHeaderCell: {
      fontSize: 8,
      fontWeight: 700,
      color: C.slate800,
      textAlign: "center" as const,
      paddingVertical: 8,
      paddingHorizontal: 6,
    },
    tableRow: {
      flexDirection: "row-reverse" as const,
      borderBottomWidth: 0.5,
      borderBottomColor: C.slate200,
    },
    tableRowEven: { backgroundColor: C.white },
    tableRowOdd: { backgroundColor: "#fafafa" },
    // صفوف الإجماليات: أوضح وأغمق
    tableRowSubtotal: {
      backgroundColor: C.slate100,
      borderBottomWidth: 1,
      borderBottomColor: C.slate200,
    },
    tableRowTotal: {
      backgroundColor: "#fdf1e7",
      borderTopWidth: 1,
      borderTopColor: accent,
      borderBottomWidth: 1,
      borderBottomColor: accent,
    },
    tableCellSubtotal: {
      fontSize: 9.5,
      fontWeight: 700,
      color: C.ink,
      textAlign: "center" as const,
      paddingVertical: 7,
      paddingHorizontal: 4,
    },
    tableCellSubtotalName: {
      fontSize: 9.5,
      fontWeight: 700,
      color: C.ink,
      textAlign: "right" as const,
      paddingVertical: 7,
      paddingHorizontal: 6,
    },
    tableCellTotal: {
      fontSize: 10.5,
      fontWeight: 700,
      color: accent,
      textAlign: "center" as const,
      paddingVertical: 8,
      paddingHorizontal: 4,
    },
    tableCellTotalName: {
      fontSize: 10.5,
      fontWeight: 700,
      color: accent,
      textAlign: "right" as const,
      paddingVertical: 8,
      paddingHorizontal: 6,
    },
    tableCell: {
      fontSize: 8.5,
      color: C.ink4,
      textAlign: "center" as const,
      paddingVertical: 6,
      paddingHorizontal: 4,
    },
    // tableCellName: {
    //   fontSize: 8.5,
    //   fontWeight: 500,
    //   color: C.ink,
    //   textAlign: "right" as const,
    //   paddingVertical: 6,
    //   paddingHorizontal: 6,
    // },
    tableCellBold: {
      fontSize: 8.5,
      fontWeight: 700,
      color: C.ink,
      textAlign: "center" as const,
      paddingVertical: 6,
      paddingHorizontal: 4,
      backgroundColor: "#fef9f0",
      borderLeftWidth: 1.5,
      borderLeftColor: C.gold,
    },
    tableCellName: {
      fontSize: 8.5,
      fontWeight: 500,
      color: C.ink,
      textAlign: "right" as const,
      paddingVertical: 6,
      paddingHorizontal: 6,
    },
    // Section header bar (clean: single accent underline, no right border)
    sectionHeader: {
      flexDirection: "row-reverse" as const,
      alignItems: "center" as const,
      borderBottomWidth: 1,
      borderBottomColor: accent,
      paddingVertical: 4,
      paddingHorizontal: 0,
      marginHorizontal: 24,
      marginBottom: 8,
      marginTop: 6,
    },
    sectionHeaderText: {
      fontSize: 10,
      fontWeight: 700,
      color: accent,
      textAlign: "right" as const,
    },
    reconciliationSection: {
      marginHorizontal: 24,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: C.slate200,
      borderRadius: 6,
      overflow: "hidden" as const,
    },
    reconciliationHeader: {
      backgroundColor: C.slate100,
      borderBottomWidth: 1,
      borderBottomColor: C.slate200,
      paddingVertical: 6,
      paddingHorizontal: 10,
    },
    reconciliationHeaderText: {
      fontSize: 8.5,
      fontWeight: 700,
      color: C.ink2,
      textAlign: "right" as const,
    },
    reconciliationRow: {
      flexDirection: "row-reverse" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
      paddingVertical: 7,
      paddingHorizontal: 10,
      borderBottomWidth: 0.5,
      borderBottomColor: C.slate200,
      backgroundColor: C.white,
    },
    reconciliationRowAlt: {
      backgroundColor: "#fafafa",
    },
    reconciliationLabel: {
      fontSize: 8,
      color: C.ink4,
      textAlign: "right" as const,
      width: "70%",
    },
    reconciliationValue: {
      fontSize: 8.5,
      fontWeight: 700,
      textAlign: "left" as const,
      width: "28%",
    },
    tableTitle: {
      fontSize: 8.5,
      fontWeight: 700,
      color: C.ink3,
      textAlign: "right" as const,
      marginBottom: 6,
    },
    // Footer
    footer: {
      position: "absolute" as const,
      bottom: 0,
      left: 0,
      right: 0,
    },
    footerStripe: {
      height: 3,
      backgroundColor: accent,
    },
    footerInner: {
      borderTopWidth: 1,
      borderTopColor: C.slate200,
      paddingHorizontal: 24,
      paddingVertical: 8,
      flexDirection: "row-reverse" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
      backgroundColor: C.white,
    },
    footerContactRow: {
      flexDirection: "row-reverse" as const,
      gap: 12,
    },
    footerContactText: {
      fontSize: 7,
      color: C.slate500,
    },
    footerPagePill: {
      backgroundColor: `${accent}1a`,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 20,
    },
    footerPageText: {
      fontSize: 7,
      fontWeight: 700,
      color: accent,
    },
    recordCount: {
      fontSize: 7,
      color: C.slate500,
      textAlign: "left" as const,
      marginTop: 6,
      paddingHorizontal: 24,
    },
  });

  // ── Logo element ──
  const logoEl = logoData
    ? React.createElement(Image, {
        src: logoData,
        style: { width: 36, height: 36, borderRadius: 4 },
      })
    : React.createElement(
        View,
        { style: rpt.companyIcon },
        React.createElement(
          Text,
          { style: rpt.companyIconText },
          (settings?.company_name ?? "N").charAt(0).toUpperCase(),
        ),
      );

  // ── Build light DataTable for reports ──
  const colWidths = buildColWidths(headers);
  const colTypes = headers.map(detectColType);

  // Helper: determine text color for numeric cell values
  const getNumericCellColor = (cell: string | number): string | undefined => {
    const num =
      typeof cell === "number"
        ? cell
        : parseFloat(String(cell).replace(/,/g, ""));
    if (isNaN(num) || num === 0) return undefined;
    return num < 0 ? C.red : C.green;
  };

  const tableHeaderEl = React.createElement(
    View,
    { style: rpt.tableHeaderRow },
    ...headers.map((h, i) =>
      React.createElement(
        Text,
        {
          key: `h-${i}`,
          style: { ...rpt.tableHeaderCell, width: colWidths[i] },
        },
        h,
      ),
    ),
  );

  const tableBodyEls = rows.map((row, ri) => {
    const emphasis = rowEmphasis?.[ri];
    return React.createElement(
      View,
      {
        key: `r-${ri}`,
        style: {
          ...rpt.tableRow,
          ...(emphasis === "total"
            ? rpt.tableRowTotal
            : emphasis === "subtotal"
              ? rpt.tableRowSubtotal
              : ri % 2 === 0
                ? rpt.tableRowEven
                : rpt.tableRowOdd),
        },
      },
      ...row.map((cell, ci) => {
        const colType = colTypes[ci];
        const isLast = ci === row.length - 1;
        const numColor =
          colType !== "wide" ? getNumericCellColor(cell) : undefined;
        let baseStyle: Record<string, unknown>;
        if (emphasis) {
          const isTotal = emphasis === "total";
          baseStyle =
            colType === "wide"
              ? {
                  ...(isTotal
                    ? rpt.tableCellTotalName
                    : rpt.tableCellSubtotalName),
                  width: colWidths[ci],
                }
              : {
                  ...(isTotal ? rpt.tableCellTotal : rpt.tableCellSubtotal),
                  width: colWidths[ci],
                };
        } else {
          baseStyle = isLast
            ? { ...rpt.tableCellBold, width: colWidths[ci] }
            : colType === "wide"
              ? { ...rpt.tableCellName, width: colWidths[ci] }
              : { ...rpt.tableCell, width: colWidths[ci] };
        }
        const finalStyle =
          numColor && !emphasis ? { ...baseStyle, color: numColor } : baseStyle;
        if (colType === "wide" && !emphasis)
          return renderNameCell(`c-${ri}-${ci}`, String(cell), finalStyle);
        return React.createElement(
          Text,
          { key: `c-${ri}-${ci}`, style: finalStyle },
          String(cell),
        );
      }),
    );
  });


  // ── Footer contact info ──
  const contactParts: string[] = [];
  if (settings?.address) contactParts.push(settings.address);
  if (settings?.phone) contactParts.push(settings.phone);
  if (settings?.email) contactParts.push(settings.email);
  if (settings?.website) contactParts.push(settings.website);

  // ── Summary cards ──
  const summaryEl = summaryCards?.length
    ? React.createElement(
        View,
        { style: rpt.summaryRow },
        ...summaryCards.map((card, i) =>
          React.createElement(
            View,
            { key: `sc-${i}`, style: rpt.summaryCard },
            React.createElement(
              Text,
              { style: rpt.summaryCardLabel },
              card.label,
            ),
            React.createElement(
              Text,
              { style: rpt.summaryCardValue },
              card.value,
            ),
          ),
        ),
      )
    : null;

  const methodologyEl = methodologyLines?.length
    ? React.createElement(
        View,
        { style: rpt.methodologyBox },
        methodologyTitle
          ? React.createElement(
              Text,
              { style: rpt.methodologyTitle },
              methodologyTitle,
            )
          : null,
        ...methodologyLines.map((line, index) =>
          React.createElement(
            Text,
            { key: `method-${index}`, style: rpt.methodologyLine },
            `• ${line}`,
          ),
        ),
      )
    : null;

  const reconciliationToneColor = (
    tone?: "neutral" | "positive" | "negative" | "primary",
  ) => {
    if (tone === "positive") return C.green;
    if (tone === "negative") return C.red;
    if (tone === "primary") return accent;
    return C.ink;
  };

  const reconciliationEl = reconciliationRows?.length
    ? React.createElement(
        View,
        { style: rpt.reconciliationSection },
        React.createElement(
          View,
          { style: rpt.reconciliationHeader },
          React.createElement(
            Text,
            { style: rpt.reconciliationHeaderText },
            reconciliationTitle || "جسر المطابقة بين الربح التشغيلي والمحاسبي",
          ),
        ),
        ...reconciliationRows.map((row, index) =>
          React.createElement(
            View,
            {
              key: `recon-${index}`,
              style: {
                ...rpt.reconciliationRow,
                ...(index % 2 === 1 ? rpt.reconciliationRowAlt : {}),
                ...(index === reconciliationRows.length - 1
                  ? { borderBottomWidth: 0 }
                  : {}),
              },
            },
            React.createElement(
              Text,
              { style: rpt.reconciliationLabel },
              row.label,
            ),
            React.createElement(
              Text,
              {
                style: {
                  ...rpt.reconciliationValue,
                  color: reconciliationToneColor(row.tone),
                },
              },
              row.value,
            ),
          ),
        ),
      )
    : null;

  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", orientation, style: rpt.page },

      // ── Header (fixed: repeats on every page) ──
      React.createElement(
        View,
        { style: rpt.header, fixed: true },
        React.createElement(
          View,
          { style: rpt.headerRow },
          // Right: Company
          React.createElement(
            View,
            { style: rpt.companySection },
            logoEl,
            React.createElement(
              View,
              null,
              React.createElement(
                Text,
                { style: rpt.companyName },
                settings?.company_name ?? "النظام المحاسبي",
              ),
              settings?.business_activity
                ? React.createElement(
                    Text,
                    { style: rpt.companyActivity },
                    settings.business_activity,
                  )
                : null,
            ),
          ),
          // Center: Report title
          React.createElement(
            View,
            { style: rpt.titleSection },
            React.createElement(Text, { style: rpt.titleText }, title),
            React.createElement(
              View,
              { style: rpt.titleBadge },
              React.createElement(
                Text,
                { style: rpt.titleBadgeText },
                `${fmtDateFull(new Date())}  ·  ${currency}`,
              ),
            ),
          ),
          // Left: date
          React.createElement(
            View,
            { style: rpt.dateSection },
            React.createElement(
              Text,
              { style: rpt.dateLabel },
              "تاريخ الاستخراج",
            ),
            React.createElement(
              Text,
              { style: rpt.dateValue },
              fmtDateFull(new Date()),
            ),
          ),
        ),
      ),

      // ── Summary Cards ──
      methodologyEl,
      summaryCards?.length
        ? React.createElement(
            View,
            { style: rpt.sectionHeader },
            React.createElement(
              Text,
              { style: rpt.sectionHeaderText },
              "المؤشرات الرئيسية",
            ),
          )
        : null,
      summaryEl,

      // ── Reconciliation ──
      reconciliationRows?.length
        ? React.createElement(
            View,
            { style: { ...rpt.sectionHeader, marginTop: 8 } },
            React.createElement(
              Text,
              { style: rpt.sectionHeaderText },
              reconciliationTitle ||
                "جسر المطابقة بين الربح التشغيلي والمحاسبي",
            ),
          )
        : null,
      reconciliationEl,

      // ── Table ──
      React.createElement(
        View,
        {
          style: { paddingHorizontal: 24 },
        },
        React.createElement(
          View,
          {
            style: {
              ...rpt.sectionHeader,
              marginHorizontal: 0,
              marginBottom: 6,
            },
          },
          React.createElement(
            Text,
            { style: rpt.sectionHeaderText },
            tableTitle || "البيانات التفصيلية",
          ),
        ),
        tableHeaderEl,
        ...tableBodyEls,
      ),

      // ── Record count ──
      React.createElement(
        Text,
        { style: rpt.recordCount },
        `إجمالي السجلات: ${rows.length}`,
      ),

      // ── Footer note (compact summary at end of report) ──
      (footerNoteLines?.length || footerNoteBlocks?.length)
        ? React.createElement(
            View,
            { style: { ...rpt.methodologyBox, marginTop: 8 }, wrap: false },
            footerNoteTitle
              ? React.createElement(
                  Text,
                  { style: rpt.methodologyTitle },
                  footerNoteTitle,
                )
              : null,
            ...(footerNoteLines ?? []).map((line, index) =>
              React.createElement(
                Text,
                { key: `footnote-${index}`, style: rpt.methodologyLine },
                line,
              ),
            ),
            ...(footerNoteBlocks ?? []).map((block, index) =>
              React.createElement(
                View,
                { key: `footblock-${index}`, style: rpt.footerNoteBlock },
                ...block.segments.flatMap((segment, segIndex) => {
                  const isLast = segIndex === block.segments.length - 1;
                  const segmentEl = React.createElement(
                    Text,
                    {
                      key: `seg-${segIndex}`,
                      style: segment.highlight
                        ? rpt.footerNoteSegmentHighlight
                        : rpt.footerNoteSegment,
                    },
                    segment.text,
                  );
                  if (isLast) return [segmentEl];
                  return [
                    segmentEl,
                    React.createElement(
                      Text,
                      { key: `sep-${segIndex}`, style: rpt.footerNoteSeparator },
                      "•",
                    ),
                  ];
                }),
                React.createElement(
                  Text,
                  { style: rpt.footerNoteBlockLabel },
                  block.label,
                ),
              ),
            ),
          )
        : null,


      // ── Footer ──
      React.createElement(
        View,
        { style: rpt.footer, fixed: true },
        React.createElement(View, { style: rpt.footerStripe }),
        React.createElement(
          View,
          { style: rpt.footerInner },
          React.createElement(
            View,
            { style: rpt.footerContactRow },
            ...contactParts.map((p, i) =>
              React.createElement(
                Text,
                { key: `fc-${i}`, style: rpt.footerContactText },
                p,
              ),
            ),
          ),
          React.createElement(
            View,
            { style: rpt.footerPagePill },
            React.createElement(Text, {
              style: rpt.footerPageText,
              render: ({
                pageNumber,
                totalPages,
              }: {
                pageNumber: number;
                totalPages: number;
              }) => `صفحة ${pageNumber} من ${totalPages}`,
            }),
          ),
        ),
      ),
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. InvoiceDocument — Light theme matching template
// ─────────────────────────────────────────────────────────────────────────────
function InvoiceDocument(
  props: InvoicePdfOptions & { logoData: string | null },
) {
  const {
    type,
    number: num,
    date,
    partyName,
    partyLabel,
    reference,
    notes,
    items,
    subtotal,
    discountTotal,
    invoiceDiscount,
    taxAmount = 0,
    taxRate = 0,
    grandTotal,
    showTax,
    showDiscount = true,
    settings,
    status,
    dueDate,
    paidAmount,
    logoData,
  } = props;

  const meta = TYPE_META[type] ?? TYPE_META.sales_invoice;
  const accent = C.primary;
  const currency = settings?.default_currency ?? "EGP";

  const pillText =
    status === "posted" || status === "approved"
      ? "مؤكدة"
      : status === "draft"
        ? "مسودة"
        : (status ?? "");
  const pillColor =
    status === "posted" || status === "approved"
      ? C.green
      : status === "draft"
        ? C.orange
        : C.ink5;

  // ── Styles ──
  const s = StyleSheet.create({
    page: {
      fontFamily: "Tajawal",
      fontSize: 9,
      paddingBottom: 50,
      backgroundColor: C.white,
    },
    // Light header
    header: {
      paddingHorizontal: 24,
      paddingTop: 20,
      paddingBottom: 14,
      borderBottomWidth: 2,
      borderBottomColor: `${accent}33`,
      marginBottom: 0,
    },
    headerRow: {
      flexDirection: "row-reverse" as const,
      justifyContent: "space-between" as const,
      alignItems: "flex-start" as const,
    },
    companySection: {
      flexDirection: "row-reverse" as const,
      alignItems: "center" as const,
      gap: 8,
    },
    companyIcon: {
      width: 36,
      height: 36,
      backgroundColor: accent,
      borderRadius: 4,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    companyIconText: {
      fontSize: 18,
      fontWeight: 700,
      color: C.white,
    },
    companyName: {
      fontSize: 16,
      fontWeight: 700,
      color: C.ink,
      textAlign: "right" as const,
    },
    companyActivity: {
      fontSize: 9,
      color: C.slate500,
      textAlign: "right" as const,
      marginTop: 2,
    },
    // Title center
    titleSection: {
      alignItems: "center" as const,
    },
    titleText: {
      fontSize: 20,
      fontWeight: 700,
      color: accent,
      textAlign: "center" as const,
    },
    titleBadge: {
      backgroundColor: `${accent}1a`,
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 20,
      marginTop: 6,
    },
    titleBadgeText: {
      fontSize: 9,
      fontWeight: 700,
      color: accent,
      textAlign: "center" as const,
    },
    // Status pill
    statusPill: {
      marginTop: 6,
      backgroundColor: `${pillColor}1a`,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 20,
    },
    statusText: {
      fontSize: 8,
      fontWeight: 700,
      color: pillColor,
    },
    // Meta section
    metaSection: {
      flexDirection: "row-reverse" as const,
      paddingHorizontal: 24,
      paddingVertical: 10,
      gap: 24,
      marginBottom: 4,
    },
    metaGroup: {
      flex: 1,
    },
    metaGroupLabel: {
      fontSize: 8,
      fontWeight: 700,
      color: C.slate400,
      textAlign: "right" as const,
      marginBottom: 6,
    },
    partyBox: {
      borderRightWidth: 3,
      borderRightColor: accent,
      paddingRight: 10,
      paddingVertical: 4,
    },
    partyName: {
      fontSize: 12,
      fontWeight: 700,
      color: C.ink,
      textAlign: "right" as const,
    },
    metaRow: {
      flexDirection: "row-reverse" as const,
      justifyContent: "flex-start" as const,
      gap: 20,
    },
    metaItem: {
      marginBottom: 4,
    },
    metaLabel: {
      fontSize: 7,
      fontWeight: 700,
      color: C.slate400,
      textAlign: "right" as const,
    },
    metaValue: {
      fontSize: 10,
      fontWeight: 700,
      color: C.ink,
      textAlign: "right" as const,
      marginTop: 2,
    },
    // Table
    tableHeaderRow: {
      flexDirection: "row-reverse" as const,
      backgroundColor: C.slate100,
      borderBottomWidth: 1,
      borderBottomColor: C.slate200,
    },
    tableHeaderCell: {
      fontSize: 8,
      fontWeight: 700,
      color: C.slate800,
      textAlign: "center" as const,
      paddingVertical: 8,
      paddingHorizontal: 6,
    },
    tableRow: {
      flexDirection: "row-reverse" as const,
      borderBottomWidth: 0.5,
      borderBottomColor: C.slate200,
    },
    tableCell: {
      fontSize: 9,
      color: C.ink4,
      textAlign: "center" as const,
      paddingVertical: 6,
      paddingHorizontal: 4,
    },
    tableCellName: {
      fontSize: 9,
      fontWeight: 500,
      color: C.ink,
      textAlign: "right" as const,
      paddingVertical: 6,
      paddingHorizontal: 6,
    },
    tableCellBold: {
      fontSize: 9,
      fontWeight: 700,
      color: C.ink,
      textAlign: "center" as const,
      paddingVertical: 6,
      paddingHorizontal: 4,
    },
    // Bottom section
    bottomGrid: {
      flexDirection: "row" as const,
      marginTop: 14,
      paddingHorizontal: 24,
      justifyContent: "space-between" as const,
    },
    // Notes col (left)
    notesCol: {
      width: "52%" as const,
      paddingRight: 10,
    },
    statsBox: {
      backgroundColor: C.bgSoft,
      borderWidth: 1,
      borderColor: C.slate200,
      borderRadius: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginBottom: 8,
    },
    statsTitle: {
      fontSize: 7,
      fontWeight: 700,
      color: C.slate400,
      marginBottom: 6,
      textAlign: "right" as const,
    },
    statsRow: {
      flexDirection: "row-reverse" as const,
      justifyContent: "space-between" as const,
      paddingVertical: 3,
    },
    statsLabel: {
      fontSize: 9,
      fontWeight: 500,
      color: C.slate500,
    },
    statsValue: {
      fontSize: 9,
      fontWeight: 700,
      color: C.slate800,
    },
    notesBox: {
      borderWidth: 1,
      borderColor: C.slate200,
      borderRightWidth: 3,
      borderRightColor: accent,
      borderRadius: 4,
      padding: 10,
    },
    notesLabel: {
      fontSize: 7,
      fontWeight: 700,
      color: accent,
      marginBottom: 4,
      textAlign: "right" as const,
    },
    notesText: {
      fontSize: 8,
      color: C.slate500,
      lineHeight: 1.8,
      textAlign: "right" as const,
    },
    // Totals col (right)
    totalsCol: {
      width: "46%" as const,
    },
    totalRow: {
      flexDirection: "row-reverse" as const,
      justifyContent: "space-between" as const,
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderBottomWidth: 0.5,
      borderBottomColor: C.slate200,
    },
    totalLabel: {
      fontSize: 9,
      fontWeight: 500,
      color: C.slate500,
      textAlign: "right" as const,
    },
    totalValue: {
      fontSize: 9,
      fontWeight: 700,
      color: C.ink,
      textAlign: "left" as const,
    },
    grandRow: {
      flexDirection: "row-reverse" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
      backgroundColor: C.slate100,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginTop: 4,
    },
    grandLabel: {
      fontSize: 11,
      fontWeight: 700,
      color: accent,
      textAlign: "right" as const,
    },
    grandValue: {
      fontSize: 14,
      fontWeight: 700,
      color: accent,
      textAlign: "left" as const,
    },
    // Footer
    footer: {
      position: "absolute" as const,
      bottom: 0,
      left: 0,
      right: 0,
    },
    footerStripe: {
      height: 3,
      backgroundColor: accent,
    },
    footerInner: {
      borderTopWidth: 1,
      borderTopColor: C.slate200,
      paddingHorizontal: 24,
      paddingVertical: 8,
      flexDirection: "row-reverse" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
      backgroundColor: C.white,
    },
    footerContactRow: {
      flexDirection: "row-reverse" as const,
      gap: 12,
    },
    footerContactText: {
      fontSize: 7,
      color: C.slate500,
    },
    footerPagePill: {
      backgroundColor: `${accent}1a`,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 20,
    },
    footerPageText: {
      fontSize: 7,
      fontWeight: 700,
      color: accent,
    },
  });

  // ── Logo ──
  const logoEl = logoData
    ? React.createElement(Image, {
        src: logoData,
        style: { width: 36, height: 36, borderRadius: 4 },
      })
    : React.createElement(
        View,
        { style: s.companyIcon },
        React.createElement(
          Text,
          { style: s.companyIconText },
          (settings?.company_name ?? "N").charAt(0).toUpperCase(),
        ),
      );

  // ── Table data ──
  const hasAnyCode = items.some((it) => CODE_PREFIX_RE.test(it.name));
  const colHeaders: string[] = ["#"];
  if (hasAnyCode) colHeaders.push("الكود");
  colHeaders.push("البند / الوصف", "الكمية", "السعر");
  if (showDiscount) colHeaders.push("الخصم");
  colHeaders.push("المجموع");
  const colWidths = hasAnyCode
    ? showDiscount
      ? ["4%", "11%", "28%", "9%", "15%", "11%", "22%"]
      : ["4%", "12%", "31%", "10%", "19%", "24%"]
    : showDiscount
      ? ["5%", "38%", "10%", "16%", "11%", "20%"]
      : ["5%", "42%", "11%", "20%", "22%"];

  const tableRows = items.map((item, idx) => {
    const match = CODE_PREFIX_RE.exec(item.name);
    const code = match ? match[1] : "";
    const label = match ? match[2] : item.name;
    const row: (string | number)[] = [String(idx + 1)];
    if (hasAnyCode) row.push(code || "—");
    row.push(label, fmtNum(item.quantity), fmtNum(item.unitPrice));
    if (showDiscount) row.push(item.discount > 0 ? fmtNum(item.discount) : "—");
    row.push(fmtNum(item.total));
    return row;
  });

  const totalQty = items.reduce((a, i) => a + i.quantity, 0);

  // ── Meta defs ──
  const metaDefs: { label: string; value: string }[] = [
    { label: "تاريخ الإصدار", value: fmtDate(date) },
  ];
  if (dueDate)
    metaDefs.push({ label: "تاريخ الاستحقاق", value: fmtDate(dueDate) });
  if (reference) metaDefs.push({ label: "المرجع", value: reference });
  if (pillText) metaDefs.push({ label: "الحالة", value: pillText });

  // ── Footer contact ──
  const contactParts: string[] = [];
  if (settings?.address) contactParts.push(settings.address);
  if (settings?.phone) contactParts.push(settings.phone);
  if (settings?.email) contactParts.push(settings.email);
  if (settings?.website) contactParts.push(settings.website);

  // ── Totals elements ──
  const totalsEls: React.ReactNode[] = [];
  totalsEls.push(
    React.createElement(
      View,
      { key: "sub", style: s.totalRow },
      React.createElement(Text, { style: s.totalLabel }, "الإجمالي الفرعي"),
      React.createElement(
        Text,
        { style: s.totalValue },
        `${fmtNum(subtotal)} ${currency}`,
      ),
    ),
  );
  if (showDiscount) {
    const discValue = (invoiceDiscount && invoiceDiscount > 0 ? invoiceDiscount : discountTotal) || 0;
    const discLabel =
      invoiceDiscount && invoiceDiscount > 0
        ? `خصم على الفاتورة${subtotal > 0 ? ` (${((invoiceDiscount / subtotal) * 100).toFixed(1)}%)` : ""}`
        : "إجمالي الخصم";
    totalsEls.push(
      React.createElement(
        View,
        { key: "disc", style: s.totalRow },
        React.createElement(Text, { style: s.totalLabel }, discLabel),
        React.createElement(
          Text,
          { style: { ...s.totalValue, color: discValue > 0 ? C.red : C.ink5 } },
          `${fmtNum(discValue)} ${currency}`,
        ),
      ),
    );
  }
  if (showTax && taxRate > 0) {
    totalsEls.push(
      React.createElement(
        View,
        { key: "tax", style: s.totalRow },
        React.createElement(Text, { style: s.totalLabel }, `ضريبة ${taxRate}%`),
        React.createElement(
          Text,
          { style: s.totalValue },
          `${fmtNum(taxAmount)} ${currency}`,
        ),
      ),
    );
  }
  // Grand total
  totalsEls.push(
    React.createElement(
      View,
      { key: "grand", style: s.grandRow },
      React.createElement(Text, { style: s.grandLabel }, "الإجمالي"),
      React.createElement(
        Text,
        { style: s.grandValue },
        `${fmtNum(grandTotal)} ${currency}`,
      ),
    ),
  );
  if (paidAmount !== undefined && paidAmount > 0) {
    totalsEls.push(
      React.createElement(
        View,
        { key: "paid", style: s.totalRow },
        React.createElement(
          Text,
          { style: { ...s.totalLabel, color: C.green } },
          "المدفوع",
        ),
        React.createElement(
          Text,
          { style: { ...s.totalValue, color: C.green } },
          `${fmtNum(paidAmount)} ${currency}`,
        ),
      ),
    );
    const balance = grandTotal - paidAmount;
    if (balance > 0.01) {
      totalsEls.push(
        React.createElement(
          View,
          { key: "bal", style: { ...s.totalRow, borderBottomWidth: 0 } },
          React.createElement(
            Text,
            { style: { ...s.totalLabel, color: C.red } },
            "المتبقي",
          ),
          React.createElement(
            Text,
            { style: { ...s.totalValue, color: C.red } },
            `${fmtNum(balance)} ${currency}`,
          ),
        ),
      );
    }
  }

  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", style: s.page },

      // ── Header (fixed: repeats on every page) ──
      React.createElement(
        View,
        { style: s.header, fixed: true },
        React.createElement(
          View,
          { style: s.headerRow },
          // Right: Company
          React.createElement(
            View,
            { style: s.companySection },
            logoEl,
            React.createElement(
              View,
              null,
              React.createElement(
                Text,
                { style: s.companyName },
                settings?.company_name ?? "النظام المحاسبي",
              ),
              settings?.business_activity
                ? React.createElement(
                    Text,
                    { style: s.companyActivity },
                    settings.business_activity,
                  )
                : null,
            ),
          ),
          // Center: Invoice type + number
          React.createElement(
            View,
            { style: s.titleSection },
            React.createElement(Text, { style: s.titleText }, meta.label),
            React.createElement(
              View,
              { style: s.titleBadge },
              React.createElement(Text, { style: s.titleBadgeText }, String(num)),
            ),
          ),
        ),
      ),

      // ── Meta: Party + dates ──
      React.createElement(
        View,
        { style: s.metaSection },
        // Party info
        React.createElement(
          View,
          { style: s.metaGroup },
          React.createElement(Text, { style: s.metaGroupLabel }, partyLabel),
          React.createElement(
            View,
            { style: s.partyBox },
            React.createElement(Text, { style: s.partyName }, partyName),
          ),
        ),
        // Date info
        React.createElement(
          View,
          { style: { ...s.metaGroup, alignItems: "flex-end" as const } },
          React.createElement(
            View,
            { style: s.metaRow },
            ...metaDefs.map((m, i) =>
              React.createElement(
                View,
                { key: `m-${i}`, style: s.metaItem },
                React.createElement(Text, { style: s.metaLabel }, m.label),
                React.createElement(Text, { style: s.metaValue }, m.value),
              ),
            ),
          ),
        ),
      ),

      // ── Table ──
      React.createElement(
        View,
        { style: { paddingHorizontal: 24, marginBottom: 10 } },
        // Header
        React.createElement(
          View,
          { style: s.tableHeaderRow },
          ...colHeaders.map((h, i) =>
            React.createElement(
              Text,
              {
                key: `h-${i}`,
                style: { ...s.tableHeaderCell, width: colWidths[i] },
              },
              h,
            ),
          ),
        ),
        // Rows
        ...tableRows.map((row, ri) =>
          React.createElement(
            View,
            {
              key: `r-${ri}`,
              style: {
                ...s.tableRow,
                backgroundColor: ri % 2 === 0 ? C.white : "#fafafa",
              },
            },
            ...row.map((cell, ci) => {
              const isCode = hasAnyCode && ci === 1;
              const isName = ci === (hasAnyCode ? 2 : 1);
              const isLast = ci === row.length - 1;
              const cellStyle = isLast
                ? { ...s.tableCellBold, width: colWidths[ci] }
                : isName
                  ? { ...s.tableCellName, width: colWidths[ci] }
                  : isCode
                    ? {
                        ...s.tableCell,
                        width: colWidths[ci],
                        color: C.ink5,
                        direction: "ltr" as const,
                      }
                    : { ...s.tableCell, width: colWidths[ci] };
              return React.createElement(
                Text,
                { key: `c-${ri}-${ci}`, style: cellStyle },
                String(cell),
              );
            }),
          ),
        ),
      ),

      // ── Bottom: Notes + Totals ──
      React.createElement(
        View,
        { style: s.bottomGrid },
        // Notes col (left visually)
        React.createElement(
          View,
          { style: s.notesCol },
          // Stats box
          React.createElement(
            View,
            { style: s.statsBox },
            React.createElement(Text, { style: s.statsTitle }, "ملخص البنود"),
            React.createElement(
              View,
              { style: s.statsRow },
              React.createElement(
                Text,
                { style: s.statsLabel },
                "عدد المنتجات",
              ),
              React.createElement(
                Text,
                { style: s.statsValue },
                `${items.length} منتج`,
              ),
            ),
            React.createElement(
              View,
              { style: s.statsRow },
              React.createElement(
                Text,
                { style: s.statsLabel },
                "إجمالي الوحدات",
              ),
              React.createElement(
                Text,
                { style: s.statsValue },
                `${fmtNum(totalQty)} وحدة`,
              ),
            ),
          ),
          // Notes
          notes
            ? React.createElement(
                View,
                { style: s.notesBox },
                React.createElement(
                  Text,
                  { style: s.notesLabel },
                  "ملاحظات وشروط",
                ),
                React.createElement(Text, { style: s.notesText }, notes),
              )
            : null,
        ),
        // Totals col (right visually)
        React.createElement(
          View,
          { style: s.totalsCol },
          React.createElement(
            View,
            {
              style: {
                borderWidth: 1,
                borderColor: C.slate200,
                borderRadius: 4,
                overflow: "hidden" as const,
              },
            },
            ...totalsEls,
          ),
        ),
      ),

      // ── Invoice notes from settings ──
      settings?.invoice_notes
        ? React.createElement(
            Text,
            {
              style: {
                fontSize: 7,
                color: C.slate500,
                textAlign: "center" as const,
                marginTop: 8,
                paddingHorizontal: 24,
              },
            },
            settings.invoice_notes,
          )
        : null,

      // ── Footer ──
      React.createElement(
        View,
        { style: s.footer, fixed: true },
        React.createElement(View, { style: s.footerStripe }),
        React.createElement(
          View,
          { style: s.footerInner },
          React.createElement(
            View,
            { style: s.footerContactRow },
            ...contactParts.map((p, i) =>
              React.createElement(
                Text,
                { key: `fc-${i}`, style: s.footerContactText },
                p,
              ),
            ),
          ),
          React.createElement(
            View,
            { style: s.footerPagePill },
            React.createElement(Text, {
              style: s.footerPageText,
              render: ({
                pageNumber,
                totalPages,
              }: {
                pageNumber: number;
                totalPages: number;
              }) => `صفحة ${pageNumber} من ${totalPages}`,
            }),
          ),
        ),
      ),
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. الدوال المُصدَّرة
// ─────────────────────────────────────────────────────────────────────────────

export async function exportReportPdf(
  options: ReportPdfOptions,
): Promise<void> {
  const { filename, ...rest } = options;
  const logoData = rest.settings?.logo_url
    ? await loadLogoBase64(rest.settings.logo_url)
    : null;
  const doc = React.createElement(ReportDocument, {
    ...rest,
    logoData,
  }) as React.ReactElement;
  const blob = await pdf(doc).toBlob();
  downloadBlob(blob, `${filename}.pdf`);
}

export async function exportInvoicePdf(
  options: InvoicePdfOptions,
): Promise<void> {
  const meta = TYPE_META[options.type] ?? TYPE_META.sales_invoice;
  const logoData = options.settings?.logo_url
    ? await loadLogoBase64(options.settings.logo_url)
    : null;
  const doc = React.createElement(InvoiceDocument, {
    ...options,
    logoData,
  }) as React.ReactElement;
  const blob = await pdf(doc).toBlob();
  downloadBlob(blob, `${meta.label}-${options.number}.pdf`);
}
