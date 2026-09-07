# جرد الأنماط المتكررة في الواجهة (المرحلة 1)

تاريخ المسح: 2026-08-24 — النطاق: `src/pages`, `src/components`, `src/hooks`, `src/contexts`, `src/lib`
(مستبعد: `src/components/ui/*`, `src/integrations/*`, ملفات الاختبار)

الحجم الكلي المفحوص: 158 ملفًا / 67,842 سطرًا. الملفات التي تحتوي على نمط متكرر واحد على الأقل: 92.

هذا الملف مرجع للقرار فقط — لم يُعدَّل أي كود تطبيق في هذه المرحلة.

## 1) جدول ملف-ملف

| الملف | أسطر | الأنماط المتكررة | البديل المقترح | المخاطرة |
|---|---|---|---|---|
| `src/pages/reports/ProductAnalytics.tsx` | 3062 | شبكة مؤشرات×1 • KpiCard محلي×1 • فلتر تاريخ×25 • حالة فراغ×10 | EmptyState, StatCard, StatGrid, useDateRangeFilter | عالية |
| `src/lib/pdf-arabic.ts` | 2663 | formatNum محلي×1 | lib/format | عالية |
| `src/features/sales-report/components/SalesReport.tsx` | 2912 | شبكة مؤشرات×3 • فلتر تاريخ×48 • حالة فراغ×7 | EmptyState, StatGrid, useDateRangeFilter | عالية |
| `src/pages/reports/PurchasesReport.tsx` | 2205 | شبكة مؤشرات×4 • فلتر تاريخ×44 • حالة فراغ×5 | EmptyState, StatGrid, useDateRangeFilter | عالية |
| `src/pages/Dashboard.tsx` | 2070 | حالة فراغ×9 | EmptyState | عالية |
| `src/pages/reports/InventoryReport.tsx` | 1800 | شبكة مؤشرات×5 • فلتر تاريخ×20 • حالة فراغ×4 | EmptyState, StatGrid, useDateRangeFilter | عالية |
| `src/pages/reports/GrowthAnalytics.tsx` | 1554 | شبكة مؤشرات×7 • فلتر تاريخ×66 • حالة فراغ×1 | EmptyState, StatGrid, useDateRangeFilter | عالية |
| `src/pages/reports/AccountBalancesReport.tsx` | 1433 | شبكة مؤشرات×4 • KpiCard محلي×2 • حالة فراغ×4 | EmptyState, StatCard, StatGrid | عالية |
| `src/pages/SalesInvoiceForm.tsx` | 1414 | حوار تأكيد×7 • toast (use-toast)×1 • شبكة مؤشرات×2 • مؤشر تحميل×2 • حالة فراغ×2 • حماية تنقل×2 | ConfirmDialog, EmptyState, LoadingState, StatGrid, notify | عالية |
| `src/pages/reports/inventory-turnover/TurnoverDataContext.tsx` | 1403 | فلتر تاريخ×25 • حالة فراغ×1 | EmptyState, useDateRangeFilter | عالية |
| `src/pages/InventoryAdjustmentForm.tsx` | 1388 | حوار تأكيد×7 • toast (use-toast)×1 • شبكة مؤشرات×1 • خريطة حالات محلية×3 • مؤشر تحميل×1 • حالة فراغ×2 • حماية تنقل×2 | ConfirmDialog, EmptyState, LoadingState, StatGrid, StatusBadge, notify | عالية |
| `src/pages/SalesReturnForm.tsx` | 1383 | حوار تأكيد×5 • toast (use-toast)×1 • شبكة مؤشرات×2 • مؤشر تحميل×1 • حالة فراغ×2 • حماية تنقل×2 | ConfirmDialog, EmptyState, LoadingState, StatGrid, notify | عالية |
| `src/pages/ProductView.tsx` | 1229 | toast (use-toast)×1 • شبكة مؤشرات×4 • formatCurrency محلي×1 • مؤشر تحميل×1 • حالة فراغ×3 | EmptyState, LoadingState, SettingsContext, StatGrid, notify | عالية |
| `src/pages/PurchaseReturnForm.tsx` | 1164 | حوار تأكيد×5 • toast (use-toast)×1 • شبكة مؤشرات×1 • مؤشر تحميل×1 • حالة فراغ×2 • حماية تنقل×2 | ConfirmDialog, EmptyState, LoadingState, StatGrid, notify | عالية |
| `src/pages/PurchaseInvoiceForm.tsx` | 1150 | حوار تأكيد×7 • toast (use-toast)×1 • شبكة مؤشرات×2 • مؤشر تحميل×1 • حالة فراغ×2 • حماية تنقل×2 | ConfirmDialog, EmptyState, LoadingState, StatGrid, notify | عالية |
| `src/pages/SettingsPage.tsx` | 1148 | toast (sonner مباشر)×1 • شبكة مؤشرات×7 • مؤشر تحميل×3 | LoadingState, StatGrid, notify | عالية |
| `src/pages/ProductForm.tsx` | 1130 | toast (use-toast)×1 • شبكة مؤشرات×4 • مؤشر تحميل×1 • حماية تنقل×2 | LoadingState, StatGrid, notify | عالية |
| `src/pages/Products.tsx` | 1054 | حوار تأكيد×5 • toast (use-toast)×1 • شبكة مؤشرات×1 • formatCurrency محلي×1 • formatNum محلي×1 • حالة فراغ×1 • حالة بحث×6 | ConfirmDialog, EmptyState, FilterBar, SettingsContext, StatGrid, lib/format, notify | عالية |
| `src/pages/BalanceSheet.tsx` | 1019 | toast (use-toast)×1 • KpiCard محلي×1 • formatCurrency محلي×1 • formatNum محلي×1 • حالة فراغ×2 | EmptyState, SettingsContext, StatCard, lib/format, notify | عالية |
| `src/pages/Expenses.tsx` | 1002 | حوار تأكيد×9 • toast (use-toast)×1 • شبكة مؤشرات×1 • فلتر تاريخ×16 • حالة فراغ×1 • حالة بحث×3 | ConfirmDialog, EmptyState, FilterBar, StatGrid, notify, useDateRangeFilter | عالية |
| `src/pages/reports/DebtAgingReport.tsx` | 964 | شبكة مؤشرات×2 • حالة فراغ×3 | EmptyState, StatGrid | عالية |
| `src/pages/CustomerPayments.tsx` | 962 | حوار تأكيد×9 • toast (use-toast)×1 • خريطة حالات محلية×3 • فلتر تاريخ×12 • مؤشر تحميل×2 • حالة فراغ×1 | ConfirmDialog, EmptyState, LoadingState, StatusBadge, notify, useDateRangeFilter | عالية |
| `src/pages/SupplierPayments.tsx` | 953 | حوار تأكيد×9 • toast (use-toast)×1 • خريطة حالات محلية×3 • فلتر تاريخ×12 • مؤشر تحميل×2 • حالة فراغ×1 | ConfirmDialog, EmptyState, LoadingState, StatusBadge, notify, useDateRangeFilter | عالية |
| `src/components/InvoicePaymentSection.tsx` | 941 | حوار تأكيد×3 • toast (use-toast)×1 | ConfirmDialog, notify | عالية |
| `src/pages/reports/inventory-turnover/TurnoverDashboardPage.tsx` | 874 | شبكة مؤشرات×4 • حالة فراغ×1 | EmptyState, StatGrid | عالية |
| `src/pages/JournalEntryForm.tsx` | 855 | حوار تأكيد×7 • toast (use-toast)×1 • شبكة مؤشرات×1 • خريطة حالات محلية×4 • مؤشر تحميل×3 • حماية تنقل×2 | ConfirmDialog, LoadingState, StatGrid, StatusBadge, notify | عالية |
| `src/pages/FiscalYearClosing.tsx` | 852 | حوار تأكيد×3 • toast (sonner مباشر)×1 • مؤشر تحميل×3 • حالة فراغ×3 | ConfirmDialog, EmptyState, LoadingState, notify | عالية |
| `src/pages/ProductImport.tsx` | 824 | toast (use-toast)×1 • حالة فراغ×1 | EmptyState, notify | عالية |
| `src/pages/Accounts.tsx` | 819 | حوار تأكيد×5 • toast (use-toast)×1 • شبكة مؤشرات×1 • مؤشر تحميل×1 • حالة فراغ×1 • حالة بحث×4 | ConfirmDialog, EmptyState, FilterBar, LoadingState, StatGrid, notify | عالية |
| `src/pages/reports/inventory-turnover/DormantInventoryPage.tsx` | 773 | شبكة مؤشرات×2 • حالة فراغ×2 | EmptyState, StatGrid | متوسطة |
| `src/pages/LoyaltyReport.tsx` | 769 | toast (use-toast)×1 • شبكة مؤشرات×1 • KpiCard محلي×1 • فلتر تاريخ×10 • حالة فراغ×2 • حالة بحث×2 | EmptyState, FilterBar, StatCard, StatGrid, notify, useDateRangeFilter | متوسطة |
| `src/pages/TrialBalance.tsx` | 737 | toast (use-toast)×1 • KpiCard محلي×1 • فلتر تاريخ×25 • formatCurrency محلي×1 • formatNum محلي×1 • حالة فراغ×2 | EmptyState, SettingsContext, StatCard, lib/format, notify, useDateRangeFilter | متوسطة |
| `src/pages/Customers.tsx` | 728 | حوار تأكيد×3 • toast (use-toast)×1 • حالة فراغ×1 • حالة بحث×3 | ConfirmDialog, EmptyState, FilterBar, notify | متوسطة |
| `src/pages/InventoryMovements.tsx` | 726 | شبكة مؤشرات×1 • فلتر تاريخ×24 • formatNum محلي×1 • حالة فراغ×2 • حالة بحث×3 | EmptyState, FilterBar, StatGrid, lib/format, useDateRangeFilter | متوسطة |
| `src/pages/Suppliers.tsx` | 686 | حوار تأكيد×3 • toast (use-toast)×1 • حالة فراغ×1 • حالة بحث×3 | ConfirmDialog, EmptyState, FilterBar, notify | متوسطة |
| `src/pages/reports/inventory-turnover/FullAnalysisPage.tsx` | 670 | شبكة مؤشرات×1 • حالة فراغ×1 | EmptyState, StatGrid | متوسطة |
| `src/pages/UserManagement.tsx` | 666 | حوار تأكيد×3 • toast (use-toast)×1 • شبكة مؤشرات×1 • حالة فراغ×1 | ConfirmDialog, EmptyState, StatGrid, notify | متوسطة |
| `src/pages/IncomeStatement.tsx` | 613 | toast (use-toast)×1 • KpiCard محلي×1 • فلتر تاريخ×20 • formatCurrency محلي×1 • formatNum محلي×1 • حالة فراغ×2 | EmptyState, SettingsContext, StatCard, lib/format, notify, useDateRangeFilter | متوسطة |
| `src/pages/LookupManagement.tsx` | 613 | toast (use-toast)×1 • حالة فراغ×2 | EmptyState, notify | متوسطة |
| `src/pages/Profile.tsx` | 604 | toast (use-toast)×1 • شبكة مؤشرات×2 • مؤشر تحميل×3 | LoadingState, StatGrid, notify | متوسطة |
| `src/pages/CategoryManagement.tsx` | 601 | toast (use-toast)×1 • شبكة مؤشرات×1 • حالة فراغ×1 | EmptyState, StatGrid, notify | متوسطة |
| `src/pages/reports/inventory-turnover/BuyNowPage.tsx` | 599 | شبكة مؤشرات×1 • حالة فراغ×1 | EmptyState, StatGrid | متوسطة |
| `src/pages/reports/CommissionCalculatorPage.tsx` | 555 | شبكة مؤشرات×2 • مؤشر تحميل×1 • حالة فراغ×4 | EmptyState, LoadingState, StatGrid | متوسطة |
| `src/pages/reports/ProfitLossReport.tsx` | 553 | شبكة مؤشرات×1 • حالة فراغ×2 | EmptyState, StatGrid | متوسطة |
| `src/pages/reports/inventory-turnover/PurchasePlanningPage.tsx` | 503 | شبكة مؤشرات×1 • حالة فراغ×1 | EmptyState, StatGrid | متوسطة |
| `src/pages/CashFlowStatement.tsx` | 482 | toast (use-toast)×1 • شبكة مؤشرات×1 • فلتر تاريخ×16 • formatNum محلي×1 • حالة فراغ×3 | EmptyState, StatGrid, lib/format, notify, useDateRangeFilter | متوسطة |
| `src/components/ExpenseFormDialog.tsx` | 472 | toast (use-toast)×1 • مؤشر تحميل×3 | LoadingState, notify | متوسطة |
| `src/pages/Journal.tsx` | 467 | toast (use-toast)×1 • فلتر تاريخ×24 • formatNum محلي×1 • حالة فراغ×1 • حالة بحث×3 | EmptyState, FilterBar, lib/format, notify, useDateRangeFilter | متوسطة |
| `src/pages/Purchases.tsx` | 438 | toast (use-toast)×1 • شبكة مؤشرات×1 • فلتر تاريخ×24 • formatNum محلي×1 • حالة فراغ×1 • حالة بحث×3 | EmptyState, FilterBar, StatGrid, lib/format, notify, useDateRangeFilter | متوسطة |
| `src/pages/reports/inventory-turnover/UrgentActionsPage.tsx` | 436 | شبكة مؤشرات×1 • حالة فراغ×1 | EmptyState, StatGrid | متوسطة |
| `src/pages/Sales.tsx` | 433 | toast (use-toast)×1 • شبكة مؤشرات×1 • فلتر تاريخ×24 • formatNum محلي×1 • حالة فراغ×1 • حالة بحث×3 | EmptyState, FilterBar, StatGrid, lib/format, notify, useDateRangeFilter | متوسطة |
| `src/components/OutstandingCreditsSection.tsx` | 416 | حوار تأكيد×3 • toast (use-toast)×1 | ConfirmDialog, notify | متوسطة |
| `src/pages/Ledger.tsx` | 405 | شبكة مؤشرات×1 • فلتر تاريخ×14 • حالة فراغ×1 | EmptyState, StatGrid, useDateRangeFilter | متوسطة |
| `src/pages/reports/AccountStatement.tsx` | 395 | شبكة مؤشرات×1 • فلتر تاريخ×12 • حالة فراغ×2 | EmptyState, StatGrid, useDateRangeFilter | متوسطة |
| `src/pages/reports/inventory-turnover/TurnoverKPIs.tsx` | 391 | شبكة مؤشرات×2 | StatGrid | متوسطة |
| `src/pages/reports/InventoryReconciliationPage.tsx` | 390 | حوار تأكيد×3 • toast (use-toast)×1 • شبكة مؤشرات×1 • مؤشر تحميل×1 • حالة فراغ×1 • حالة بحث×2 | ConfirmDialog, EmptyState, FilterBar, LoadingState, StatGrid, notify | متوسطة |
| `src/pages/PurchaseReturns.tsx` | 378 | toast (use-toast)×1 • شبكة مؤشرات×1 • فلتر تاريخ×26 • formatNum محلي×1 • حالة فراغ×1 • حالة بحث×3 | EmptyState, FilterBar, StatGrid, lib/format, notify, useDateRangeFilter | متوسطة |
| `src/pages/reports/inventory-turnover/SupplierReturnsPage.tsx` | 375 | شبكة مؤشرات×1 • حالة فراغ×1 | EmptyState, StatGrid | متوسطة |
| `src/pages/ExpenseTypes.tsx` | 374 | حوار تأكيد×3 • toast (use-toast)×1 • حالة فراغ×1 | ConfirmDialog, EmptyState, notify | متوسطة |
| `src/pages/SalesReturns.tsx` | 374 | toast (use-toast)×1 • شبكة مؤشرات×1 • فلتر تاريخ×26 • formatNum محلي×1 • حالة فراغ×1 • حالة بحث×3 | EmptyState, FilterBar, StatGrid, lib/format, notify, useDateRangeFilter | متوسطة |
| `src/pages/reports/inventory-turnover/NewProductsPage.tsx` | 343 | شبكة مؤشرات×1 • حالة فراغ×1 | EmptyState, StatGrid | منخفضة |
| `src/pages/SystemSetup.tsx` | 302 | حوار تأكيد×3 • toast (use-toast)×1 • مؤشر تحميل×2 | ConfirmDialog, LoadingState, notify | منخفضة |
| `src/components/CategoryTreeSelect.tsx` | 285 | حالة فراغ×2 • حالة بحث×5 | EmptyState, FilterBar | منخفضة |
| `src/pages/InventoryAdjustments.tsx` | 281 | حوار تأكيد×3 • toast (use-toast)×1 • خريطة حالات محلية×3 • حالة فراغ×1 | ConfirmDialog, EmptyState, StatusBadge, notify | منخفضة |
| `src/pages/reports/inventory-turnover/SmartAlertsSection.tsx` | 276 | حالة فراغ×1 | EmptyState | منخفضة |
| `src/components/settings/TelegramSettingsTab.tsx` | 271 | toast (sonner مباشر)×1 • شبكة مؤشرات×2 • مؤشر تحميل×3 | LoadingState, StatGrid, notify | منخفضة |
| `src/components/LookupImportDialog.tsx` | 266 | toast (use-toast)×1 • مؤشر تحميل×1 | LoadingState, notify | منخفضة |
| `src/components/products/TelegramPublishButton.tsx` | 259 | حوار تأكيد×3 • toast (use-toast)×1 • مؤشر تحميل×1 | ConfirmDialog, LoadingState, notify | منخفضة |
| `src/components/LookupCombobox.tsx` | 258 | حالة فراغ×1 • حالة بحث×2 | EmptyState, FilterBar | منخفضة |
| `src/pages/reports/inventory-turnover/PurchaseSuggestionsTable.tsx` | 247 | حالة فراغ×1 | EmptyState | منخفضة |
| `src/pages/reports/inventory-turnover/ProductHealthPage.tsx` | 245 | شبكة مؤشرات×1 • حالة فراغ×1 | EmptyState, StatGrid | منخفضة |
| `src/pages/reports/inventory-turnover/UnlistedProductsPage.tsx` | 240 | شبكة مؤشرات×1 • حالة فراغ×1 | EmptyState, StatGrid | منخفضة |
| `src/components/products/ProductCard.tsx` | 240 | حوار تأكيد×3 • formatNum محلي×1 | ConfirmDialog, lib/format | منخفضة |
| `src/pages/Auth.tsx` | 231 | toast (use-toast)×1 • مؤشر تحميل×1 | LoadingState, notify | منخفضة |
| `src/pages/reports/inventory-turnover/NewProductsTable.tsx` | 219 | حالة فراغ×1 | EmptyState | منخفضة |
| `src/components/ExportMenu.tsx` | 213 | toast (use-toast)×1 • مؤشر تحميل×1 | LoadingState, notify | منخفضة |
| `src/pages/reports/inventory-turnover/TurnoverFilterBar.tsx` | 189 | فلتر تاريخ×6 | useDateRangeFilter | منخفضة |
| `src/pages/reports/inventory-turnover/SupplierReturnTable.tsx` | 182 | حالة فراغ×1 | EmptyState | منخفضة |
| `src/components/BarcodePrintDialog.tsx` | 163 | شبكة مؤشرات×1 • حالة فراغ×1 | EmptyState, StatGrid | منخفضة |
| `src/components/QuickAddSupplierDialog.tsx` | 161 | toast (use-toast)×1 • مؤشر تحميل×1 | LoadingState, notify | منخفضة |
| `src/components/QuickAddCustomerDialog.tsx` | 160 | toast (use-toast)×1 • مؤشر تحميل×1 | LoadingState, notify | منخفضة |
| `src/pages/MfaVerify.tsx` | 144 | toast (use-toast)×1 • مؤشر تحميل×2 | LoadingState, notify | منخفضة |
| `src/hooks/use-navigation-guard.ts` | 140 | حماية تنقل×1 |  | عالية |
| `src/pages/reports/inventory-turnover/InactiveProductsTable.tsx` | 136 | حالة فراغ×1 | EmptyState | منخفضة |
| `src/components/products/ProductsGrid.tsx` | 131 | شبكة مؤشرات×2 • حالة فراغ×1 | EmptyState, StatGrid | منخفضة |
| `src/components/AccountCombobox.tsx` | 114 | حالة فراغ×1 | EmptyState | منخفضة |
| `src/contexts/SettingsContext.tsx` | 109 | formatCurrency محلي×1 | SettingsContext | منخفضة |
| `src/pages/reports/inventory-turnover/DormantActionMenu.tsx` | 104 | حوار تأكيد×3 • toast (sonner مباشر)×1 | ConfirmDialog, notify | منخفضة |
| `src/components/PageSkeleton.tsx` | 96 | شبكة مؤشرات×1 | StatGrid | منخفضة |
| `src/hooks/use-toast.ts` | 78 | toast (sonner مباشر)×1 | notify | منخفضة |
| `src/components/UnsavedChangesDialog.tsx` | 61 | حوار تأكيد×3 | ConfirmDialog | منخفضة |
| `src/components/auth/ProtectedRoute.tsx` | 44 | مؤشر تحميل×1 | LoadingState | منخفضة |

## 2) الأنماط مجمّعة + القرار

### 2.1 حوارات التأكيد — القرار: يُوحَّد الآن (أولوية 1)
25 ملفًا يبني `AlertDialog` تأكيد يدويًا بنفس الهيكل (Header/Title/Description/Cancel/Action)، بإجمالي 40+ حوارًا:
- حذف: `Customers.tsx:708`, `Suppliers.tsx:666`, `Accounts.tsx:434` و`:672`, `ExpenseTypes.tsx:360`, `UserManagement.tsx:427`, `Products.tsx:732`, `products/ProductCard.tsx:190`, `InventoryAdjustments.tsx:168`, `Expenses.tsx:959`, `CustomerPayments.tsx:876`, `SalesInvoiceForm.tsx:724`, `PurchaseInvoiceForm.tsx:606`, `SalesReturnForm.tsx:855`, `PurchaseReturnForm.tsx:732`, `JournalEntryForm.tsx:464`, `InventoryAdjustmentForm.tsx:843`.
- إلغاء مستند مرحّل: `SalesInvoiceForm.tsx:756`, `PurchaseInvoiceForm.tsx:635`, `SalesReturnForm.tsx:887`, `PurchaseReturnForm.tsx:761`, `JournalEntryForm.tsx:494`, `Expenses.tsx:939`, `CustomerPayments.tsx:917`, `InventoryAdjustmentForm.tsx:947`.
- ترحيل / اعتماد: `Expenses.tsx:923`, `CustomerPayments.tsx:897`, `InventoryAdjustmentForm.tsx:907`.
- إعادة كمسودة: `SalesInvoiceForm.tsx:784`, `PurchaseInvoiceForm.tsx:663`, `Expenses.tsx:975`.
- تفعيل/تعطيل: `Products.tsx:695`, `reports/inventory-turnover/DormantActionMenu.tsx`.
- خاص (يبقى كما هو): `FiscalYearClosing.tsx:470` (عكس الإقفال), `SystemSetup.tsx:260` (تهيئة النظام), `reports/InventoryReconciliationPage.tsx:367` (مزامنة كميات), `products/TelegramPublishButton.tsx:217` (نشر) — هذه لها محتوى تفصيلي داخل الحوار.

الفروقات الحقيقية بين النسخ: نص العنوان/الوصف، نوع زر التأكيد (عادي/مدمّر)، وجود حالة انتظار (`saving`), ووجود عناصر إضافية داخل الجسم (سبب الإلغاء، تحذير محاسبي).
البديل: `ConfirmDialog` بخصائص `{ title, description, confirmText, cancelText, destructive, loading, onConfirm, children }` + خطاف `useConfirm` للاستدعاء الإجرائي.

### 2.2 التنبيهات (toast) — القرار: يُوحَّد الآن (أولوية 1)
44 ملفًا يستورد `@/hooks/use-toast` و5 ملفات تستورد `sonner` مباشرة (`SettingsPage.tsx`, `FiscalYearClosing.tsx`, `settings/TelegramSettingsTab.tsx`, `reports/inventory-turnover/DormantActionMenu.tsx`, `hooks/use-toast.ts` نفسه).
البديل: `notify.success/error/info/warning` واحد فوق Sonner، مع تمرير أخطاء قاعدة البيانات عبر `lib/format-error.ts` تلقائيًا. `use-toast` يبقى كطبقة توافق فقط أثناء الترحيل.

### 2.3 بطاقات المؤشرات — القرار: يُوحَّد الآن (أولوية 2)
`KpiCard` مُعاد تعريفه محليًا في 6 ملفات: `IncomeStatement.tsx:590`, `BalanceSheet.tsx:991`, `TrialBalance.tsx:621`, `LoyaltyReport.tsx:737`, `reports/ProductAnalytics.tsx:2999`, `reports/AccountBalancesReport.tsx:1346` (+ نسخة معلّقة في `:541`).
وشبكة `md:grid-cols-*` مكتوبة يدويًا في 62 ملفًا.
البديل: `StatCard` (icon, label, value, sub/hint, tone, valueClass) + `StatGrid` (cols 2/3/4 متجاوبة). التوحيد يعتمد على نسخة `AccountBalancesReport` لأنها الأغنى بالخصائص.

### 2.4 شرائح الحالة — القرار: يُوحَّد الآن (أولوية 2)
`INVOICE_STATUS_LABELS/COLORS` موجودة في `lib/constants.ts` لكن 15 ملفًا يعيد تعريف خرائط محلية أو يعيد تسميتها: `Sales.tsx`, `Purchases.tsx`, `SalesReturns.tsx`, `PurchaseReturns.tsx`, `CustomerPayments.tsx:73`, `SupplierPayments.tsx:63`, `InventoryAdjustments.tsx:38`, `InventoryAdjustmentForm.tsx:747`, `JournalEntryForm.tsx:419-424`, ونماذج الفواتير الأربعة.
البديل: `StatusBadge status={...} kind="invoice|adjustment|journal"` يقرأ من `constants.ts` فقط، وإضافة خرائط التسويات/القيود إلى `constants.ts`.

### 2.5 تنسيق الأرقام والعملة — القرار: يُوحَّد الآن (أولوية 2، منخفض المخاطرة)
`formatCurrency` محلي في 5 صفحات (`ProductView.tsx:692`, `BalanceSheet.tsx:293`, `Products.tsx:92`, `TrialBalance.tsx:246`, `IncomeStatement.tsx:185`) — بعضها يثبّت "EGP" نصًا ويتجاهل عملة الإعدادات (خطأ فعلي في `ProductView` و`Products`).
`formatNum`/`fmtNum` محلي في 13 ملفًا.
البديل: `formatCurrency` من `SettingsContext` فقط + `formatNumber` مشترك في `lib/format.ts`. مع الحفاظ على قاعدة إظهار الإشارة السالبة.

### 2.6 أشرطة الفلاتر وحالة التاريخ — القرار: يُوحَّد الآن (أولوية 3)
22 ملفًا يدير `dateFrom/dateTo` يدويًا (الأكثف: `reports/GrowthAnalytics.tsx` 66 إشارة، `reports/SalesReport.tsx` 48، `reports/PurchasesReport.tsx` 44، `PurchaseReturns.tsx`/`SalesReturns.tsx` 26 لكل منهما).
27 ملفًا يستخدم `DatePickerInput` داخل نفس تركيبة الفلتر، و15 ملفًا يعيد إنشاء حالة البحث.
النموذج المرجعي الجاهز: `reports/inventory-turnover/TurnoverFilterBar.tsx`.
البديل: `FilterBar` + `useDateRangeFilter` (نطاقات جاهزة: كل الوقت/الشهر/الربع/السنة/مخصص) مع الحفاظ على «كل الوقت» كافتراضي في تقرير الولاء.

### 2.7 حالات التحميل والفراغ — القرار: يُوحَّد جزئيًا (أولوية 3)
27 ملفًا يستخدم `animate-spin` بأربع صيغ مختلفة (دائرة `border-b-2` في `Auth.tsx:35`, `Accounts.tsx:600`, `auth/ProtectedRoute.tsx` مقابل `Loader2` بأحجام متفرقة في الباقي).
124 نص «لا توجد/لا يوجد»، منها 42 عبر خاصية `emptyMessage` في `DataTable` (سليمة وتبقى) والباقي markup يدوي.
البديل: `LoadingState` (صفحة/داخلي/زر) و`EmptyState` (أيقونة + عنوان + وصف + إجراء) لغير حالات `DataTable`.

### 2.8 رؤوس الصفحات والتصدير — القرار: يبقى كما هو
`PageHeader` مستخدم في 61 ملفًا و`ExportMenu` في 45 — التوحيد قائم فعلًا ولا حاجة لتغيير.

### 2.9 نماذج المستندات (فواتير/مرتجعات) — القرار: يُوحَّد لاحقًا (مرحلة منفصلة، مخاطرة عالية)
`SalesInvoiceForm` (1414 سطرًا)، `PurchaseInvoiceForm` (1150)، `SalesReturnForm` (1383)، `PurchaseReturnForm` (1164)، `InventoryAdjustmentForm` (1388) تتشارك: `useNavigationGuard` + الحفظ التلقائي قبل الترحيل + سطور البنود + الإجماليات + حوارات الحذف/الإلغاء/إعادة المسودة + شريحة الحالة.
مشترك جاهز بالفعل: `use-line-items.ts` (5 استخدامات)، `invoice-totals.ts`، `InvoicePaymentSection`.
لا يُستخرج أي منطق ترحيل في المرحلة الحالية — يقتصر التوحيد على طبقة العرض (الحوارات، الشريحة، الحالات).

### 2.10 الوصول للبيانات — القرار: يُوحَّد لاحقًا (أولوية 4)
43 ملفًا يستدعي `supabase.from` مباشرة؛ الأكثف: `PurchaseReturnForm` 21، `SalesInvoiceForm`/`SalesReturnForm` 20، `InventoryAdjustmentForm` 18، `PurchaseInvoiceForm` 15، `Dashboard`/`CustomerPayments`/`SupplierPayments` 14.
استعلامات متكررة: `products` 49 موضعًا، `customers` 12، `suppliers` 5 — مع وجود خطافات جاهزة غير مستخدمة بالكامل (`use-products-lookup`, `use-customers`, `use-suppliers`, `use-accounts`).
البديل: توسيع الخطافات الموجودة وترحيل قراءات القوائم إليها فقط (بدون المساس بعمليات الكتابة/الترحيل).

## 3) ترتيب التنفيذ المقترح

1. `notify` + `ConfirmDialog` + `useConfirm` → ترحيل شاشات القوائم والجداول المرجعية.
2. `StatCard`/`StatGrid` + `StatusBadge` + `lib/format.ts` → ترحيل التقارير والقوائم.
3. `FilterBar` + `useDateRangeFilter` + `EmptyState`/`LoadingState` → ترحيل التقارير الكبيرة.
4. نماذج المستندات (طبقة العرض فقط) ثم توحيد قراءات البيانات.

بعد كل خطوة: `tsgo` + `vitest` + قراءة سجل البناء.
