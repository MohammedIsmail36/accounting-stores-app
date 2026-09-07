export const APP_NAME = "نظام الباقي";

export const routeLabels: Record<string, string> = {
  "": "لوحة التحكم",
  accounts: "شجرة الحسابات",
  journal: "القيود المحاسبية",
  ledger: "دفتر الأستاذ",
  "trial-balance": "ميزان المراجعة",
  "income-statement": "قائمة الدخل",
  "balance-sheet": "الميزانية العمومية",
  "cash-flow": "التدفقات النقدية",
  "fiscal-year-closing": "إقفال السنة المالية",
  sales: "فواتير البيع",
  "sales-returns": "مرتجعات البيع",
  "customer-payments": "مدفوعات العملاء",
  customers: "العملاء",
  "customer-statement": "كشف حساب عميل",
  purchases: "فواتير الشراء",
  "purchase-returns": "مرتجعات الشراء",
  "supplier-payments": "مدفوعات الموردين",
  suppliers: "الموردين",
  "supplier-statement": "كشف حساب مورد",
  products: "المنتجات",
  "inventory-adjustments": "تسوية المخزون",
  "inventory-movements": "حركة المخزون",
  inventory: "المخزون",
  categories: "التصنيفات",
  units: "وحدات القياس",
  brands: "الماركات",
  expenses: "المصروفات",
  "expense-types": "أنواع المصروفات",
  reports: "التقارير",
  // health key defined below for inventory-turnover
  "sales-report": "تقرير المبيعات",
  "purchases-report": "تقرير المشتريات",
  growth: "تحليلات النمو",
  "products-analytics": "تحليل المنتجات",
  aging: "أعمار الديون",
  balances: "أرصدة الحسابات",
  "profit-loss": "الأرباح والخسائر",
  commission: "حاسبة العمولة",
  "inventory-reconciliation": "تسوية المخزون",
  "inventory-valuation": "تقييم المخزون",
  "inventory-aging": "تعمير المخزون",
  "inventory-reorder": "إعادة الطلب والنواقص",
  "inventory-kpis": "مؤشرات المخزون",
  "system-health": "سلامة البيانات",

  "inventory-turnover": "دوران المخزون",
  dashboard: "لوحة المؤشرات",
  "urgent-actions": "اشترِ الآن",
  "purchase-planning": "اشترِ الآن",
  "buy-now": "اشترِ الآن",
  dormant: "المخزون الراكد",
  "supplier-returns": "إرجاع للمورد",
  "new-products": "تحت المراقبة",
  unlisted: "تحت المراقبة",
  health: "تحت المراقبة",
  "under-observation": "تحت المراقبة",
  analysis: "مستكشف البيانات",
  settings: "الإعدادات",
  users: "إدارة المستخدمين",
  profile: "الملف الشخصي",
  "system-setup": "إعداد النظام",
  auth: "تسجيل الدخول",
  mfa: "التحقق الثنائي",
  new: "إضافة جديد",
  edit: "تعديل",
  import: "استيراد",
  forbidden: "غير مصرح",
  loyalty: "نقاط الولاء",
};

export function isUUID(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Build a human-readable page title from a pathname.
 * Combines special segments (new/edit/import) with their context for clarity.
 */
export function buildPageTitle(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return routeLabels[""];

  // Filter out UUIDs to find meaningful segments
  const meaningful = segments.filter((s) => !isUUID(s));
  if (meaningful.length === 0) return routeLabels[""];

  const last = meaningful[meaningful.length - 1];
  const prev = meaningful.length > 1 ? meaningful[meaningful.length - 2] : null;

  // Combine action segments with context
  const actions: Record<string, (ctx: string) => string> = {
    new: (ctx) => {
      const map: Record<string, string> = {
        products: "إضافة منتج جديد",
        sales: "فاتورة بيع جديدة",
        "sales-returns": "مرتجع بيع جديد",
        purchases: "فاتورة شراء جديدة",
        "purchase-returns": "مرتجع شراء جديد",
        journal: "قيد محاسبي جديد",
        expenses: "مصروف جديد",
        "inventory-adjustments": "تسوية مخزون جديدة",
      };
      return map[ctx] || `${routeLabels[ctx] || ctx} - إضافة جديد`;
    },
    edit: (ctx) => `تعديل ${routeLabels[ctx] || ctx}`,
    import: (ctx) => `استيراد ${routeLabels[ctx] || ctx}`,
  };

  if (prev && actions[last]) {
    return actions[last](prev);
  }

  // UUID detail page → show parent label + "تفاصيل"
  if (isUUID(segments[segments.length - 1]) && prev) {
    return `${routeLabels[last] || last} - تفاصيل`;
  }

  return routeLabels[last] || last;
}
