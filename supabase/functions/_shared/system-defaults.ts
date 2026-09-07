export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "expense";

export type DefaultAccount = {
  code: string;
  name: string;
  account_type: AccountType;
  is_parent: boolean;
  parent_code: string | null;
};

export const SYSTEM_CODES = [
  "1101",
  "1102",
  "1103",
  "1104",
  "2101",
  "3101",
  "3102",
  "4101",
  "5101",
  "5108",
];

// Keep Arabic defaults in one UTF-8 source to avoid accidental encoding drift.
export const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  {
    code: "1",
    name: "الأصول",
    account_type: "asset",
    is_parent: true,
    parent_code: null,
  },
  {
    code: "11",
    name: "الأصول المتداولة",
    account_type: "asset",
    is_parent: true,
    parent_code: "1",
  },
  {
    code: "1101",
    name: "الصندوق (النقدية)",
    account_type: "asset",
    is_parent: false,
    parent_code: "11",
  },
  {
    code: "1102",
    name: "البنك",
    account_type: "asset",
    is_parent: false,
    parent_code: "11",
  },
  {
    code: "1103",
    name: "العملاء (المدينون)",
    account_type: "asset",
    is_parent: false,
    parent_code: "11",
  },
  {
    code: "1104",
    name: "المخزون",
    account_type: "asset",
    is_parent: false,
    parent_code: "11",
  },
  {
    code: "1105",
    name: "ضريبة القيمة المضافة للمدخلات",
    account_type: "asset",
    is_parent: false,
    parent_code: "11",
  },
  {
    code: "12",
    name: "الأصول الثابتة",
    account_type: "asset",
    is_parent: true,
    parent_code: "1",
  },
  {
    code: "1201",
    name: "الأثاث والتجهيزات",
    account_type: "asset",
    is_parent: false,
    parent_code: "12",
  },
  {
    code: "1202",
    name: "المعدات",
    account_type: "asset",
    is_parent: false,
    parent_code: "12",
  },
  {
    code: "1203",
    name: "السيارات",
    account_type: "asset",
    is_parent: false,
    parent_code: "12",
  },
  {
    code: "2",
    name: "الخصوم",
    account_type: "liability",
    is_parent: true,
    parent_code: null,
  },
  {
    code: "2101",
    name: "الموردون (الدائنون)",
    account_type: "liability",
    is_parent: false,
    parent_code: "2",
  },
  {
    code: "2102",
    name: "قروض قصيرة الأجل",
    account_type: "liability",
    is_parent: false,
    parent_code: "2",
  },
  {
    code: "2103",
    name: "قروض طويلة الأجل",
    account_type: "liability",
    is_parent: false,
    parent_code: "2",
  },
  {
    code: "3",
    name: "حقوق الملكية",
    account_type: "equity",
    is_parent: true,
    parent_code: null,
  },
  {
    code: "3101",
    name: "رأس المال",
    account_type: "equity",
    is_parent: false,
    parent_code: "3",
  },
  {
    code: "3102",
    name: "الأرباح المحتجزة",
    account_type: "equity",
    is_parent: false,
    parent_code: "3",
  },
  {
    code: "4",
    name: "الإيرادات",
    account_type: "revenue",
    is_parent: true,
    parent_code: null,
  },
  {
    code: "4101",
    name: "إيرادات المبيعات",
    account_type: "revenue",
    is_parent: false,
    parent_code: "4",
  },
  {
    code: "4102",
    name: "إيرادات الخدمات",
    account_type: "revenue",
    is_parent: false,
    parent_code: "4",
  },
  {
    code: "4103",
    name: "إيرادات أخرى",
    account_type: "revenue",
    is_parent: false,
    parent_code: "4",
  },
  {
    code: "5",
    name: "المصروفات",
    account_type: "expense",
    is_parent: true,
    parent_code: null,
  },
  {
    code: "5101",
    name: "تكلفة البضاعة المباعة",
    account_type: "expense",
    is_parent: false,
    parent_code: "5",
  },
  {
    code: "5102",
    name: "رواتب وأجور",
    account_type: "expense",
    is_parent: false,
    parent_code: "5",
  },
  {
    code: "5103",
    name: "إيجار",
    account_type: "expense",
    is_parent: false,
    parent_code: "5",
  },
  {
    code: "5108",
    name: "فروقات أسعار مرتجعات الشراء",
    account_type: "expense",
    is_parent: false,
    parent_code: "5",
  },
  {
    code: "5104",
    name: "مصاريف كهرباء وماء",
    account_type: "expense",
    is_parent: false,
    parent_code: "5",
  },
  {
    code: "5105",
    name: "مصاريف إدارية",
    account_type: "expense",
    is_parent: false,
    parent_code: "5",
  },
  {
    code: "5106",
    name: "مصاريف تسويق",
    account_type: "expense",
    is_parent: false,
    parent_code: "5",
  },
  {
    code: "5107",
    name: "إهلاك",
    account_type: "expense",
    is_parent: false,
    parent_code: "5",
  },
];

export const DEFAULT_ADMIN_EMAIL = Deno.env.get("DEFAULT_ADMIN_EMAIL") ?? "admin@system.com";
// كلمة المرور الافتراضية للمدير — يجب ضبطها كـ secret اسمه DEFAULT_ADMIN_PASSWORD.
// لا توجد قيمة افتراضية في الكود لأسباب أمنية.
export const DEFAULT_ADMIN_PASSWORD = Deno.env.get("DEFAULT_ADMIN_PASSWORD") ?? "";
export const DEFAULT_ADMIN_NAME = "مدير النظام";
export const DEFAULT_COMPANY_NAME = "شركتي";
