// ─── حالات الفواتير والمدفوعات (Invoice/Payment status) ───

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  posted: "مُرحّل",
  cancelled: "ملغي",
};

export const INVOICE_STATUS_COLORS: Record<string, string> = {
  draft: "secondary",
  posted: "default",
  cancelled: "destructive",
};

// ─── حالات المستندات الموحّدة (تُقرأ بواسطة StatusBadge) ───

export type DocumentStatusKind = "invoice" | "adjustment" | "journal";

export const DOCUMENT_STATUS_LABELS: Record<
  DocumentStatusKind,
  Record<string, string>
> = {
  invoice: INVOICE_STATUS_LABELS,
  adjustment: { ...INVOICE_STATUS_LABELS, approved: "معتمد" },
  journal: { draft: "مسودة", posted: "معتمد", cancelled: "ملغي" },
};

export const DOCUMENT_STATUS_VARIANTS: Record<
  string,
  "secondary" | "default" | "destructive"
> = {
  draft: "secondary",
  posted: "default",
  approved: "default",
  cancelled: "destructive",
};



// ─── أنواع حركات المخزون (Inventory movement types) ───

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  opening_balance: "رصيد افتتاحي",
  purchase: "شراء",
  purchase_return: "مرتجع شراء",
  sale: "بيع",
  sale_return: "مرتجع بيع",
  adjustment: "تسوية",
};

/** Labels used in ProductView (slightly different wording) */
export const MOVEMENT_TYPE_LABELS_DETAIL: Record<string, string> = {
  sale: "مبيعات",
  purchase: "مشتريات",
  sale_return: "مرتجع بيع",
  purchase_return: "مرتجع شراء",
  adjustment: "تسوية مخزون",
  opening_balance: "رصيد افتتاحي",
};

export const MOVEMENT_TYPE_COLORS: Record<string, string> = {
  opening_balance: "bg-blue-100 text-blue-800",
  purchase: "bg-emerald-100 text-emerald-700",
  purchase_return: "bg-orange-100 text-orange-800",
  sale: "bg-rose-100 text-rose-700",
  sale_return: "bg-purple-100 text-purple-800",
  adjustment: "bg-muted text-muted-foreground",
};

/** Movement types that increase inventory */
export const MOVEMENT_IN_TYPES = ["opening_balance", "purchase", "sale_return"];

export const REFERENCE_ROUTE_MAP: Record<string, string> = {
  purchase_invoice: "/purchases",
  sales_invoice: "/sales",
  purchase_return: "/purchase-returns",
  sales_return: "/sales-returns",
  inventory_adjustment: "/inventory-adjustments",
  adjustment: "/inventory-adjustments",
};

// ─── أكواد الحسابات (Account codes) ───

export const ACCOUNT_CODES = {
  CASH: "1101",
  BANK: "1102",
  CUSTOMERS: "1103",
  INVENTORY: "1104",
  INPUT_VAT: "1105",
  SUPPLIERS: "2101",
  SALES_TAX: "2102",
  EQUITY: "3101",
  RETAINED_EARNINGS: "3102",
  REVENUE: "4101",
  INVENTORY_ADJUSTMENT_GAIN: "4201",
  COGS: "5101",
  PURCHASE_RETURN_PRICE_VARIANCE: "5108",
  INVENTORY_ADJUSTMENT_LOSS: "5201",
} as const;

// ─── أدوار المستخدمين (User roles) ───

export const ROLE_LABELS: Record<string, string> = {
  admin: "مدير",
  accountant: "محاسب",
  sales: "موظف مبيعات",
};

export const ROLE_COLORS: Record<string, string> = {
  admin: "bg-primary/10 text-primary border-primary/20",
  accountant: "bg-accent text-accent-foreground border-accent-foreground/20",
  sales: "bg-muted text-muted-foreground border-border",
};

// ─── وصف قيد الإقفال (Fiscal year closing description prefix) ───

export const FISCAL_CLOSING_DESCRIPTION_PREFIX = "قيد إقفال السنة المالية";

// ─── تسامح الأرصدة (Floating-point tolerance) ───

export const BALANCE_TOLERANCE = 0.01;

export function isBalanced(debit: number, credit: number): boolean {
  return Math.abs(debit - credit) <= BALANCE_TOLERANCE;
}
