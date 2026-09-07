# خطة إنهاء النظام — ملخص

## 1. التقارير القديمة المتبقية
- `InventoryReportPage.tsx` (تقرير المخزون القديم)
- `InventoryReconciliationPage.tsx` (تسوية المخزون التشخيصية)
- ملفات dead code: `InventoryReport.tsx`, `SalesReport.tsx`, `PurchasesReport.tsx`, `DebtAgingReport.tsx`, `ProfitLossReport.tsx`, `AccountBalancesReport.tsx`, `GrowthAnalytics.tsx`, `ProductAnalytics.tsx`

## 2. العمل المتبقي
1. **استبدال/إزالة التقارير القديمة**: إعادة توجيه `/reports/inventory` إلى التقرير الجديد، وتحديث/حذف `InventoryReconciliationPage.tsx` بعد التحقق من عدم الحاجة إليه.
2. **إزالة ملفات dead code**: حذف الملفات غير المربوطة بـ `App.tsx`.
3. **التحقق من أرقام المخزون**: مقارنة تقارير WAC/التقييم/التسوية مع رصيد GL 1104 وحل الفروق.
4. **اختبارات صارمة**: إضافة اختبارات للقيود، المخزون، والولاء.
5. **أداء وصحة**: تفعيل `fetchAllPaged` في التقارير الثقيلة، وتدقيق RLS/Triggers.

## 3. الخطوة التالية المقترحة
إعادة توجيه `/reports/inventory` إلى `InventoryValuationPage.tsx` وإزالة `InventoryReportPage.tsx` + ملفات dead code غير المستخدمة.
