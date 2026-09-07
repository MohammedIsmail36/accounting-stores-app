# قائمة فحص ما قبل النشر الإنتاجي

> **استخدم هذه القائمة قبل كل نشر للإنتاج.** كل بند يتطلب تحققاً فعلياً (ليس افتراضاً).
> المراجع التفصيلية في `PRODUCTION_READINESS_AUDIT.md`.

---

## 🔴 Blockers — يجب أن تكون كلها ✅ قبل النشر

- [ ] **L1.** فحص `locked_until_date` مفعّل في: SalesInvoiceForm, PurchaseInvoiceForm, InventoryAdjustmentForm + DB-side (LOGIC-001)
- [ ] **L2.** قفل تزامن (`SELECT FOR UPDATE` أو advisory lock) داخل `post_sales_invoice` و`post_purchase_invoice` (LOGIC-002)
- [ ] **L3.** Trigger DB يمنع كمية مرتجع > الأصلية (LOGIC-003)
- [ ] **L4.** كل الأعمدة النقدية `numeric(18,2)` والكميات `numeric(18,3)` (LOGIC-004)
- [ ] **U1.** `<ErrorBoundary>` يلف Router في `App.tsx` (UX-001)
- [ ] **P1.** Customers/Suppliers/Accounts/Expenses تستخدم pagination (PERF-001)
- [ ] **S1.** RLS على `audit_log` مقصور على admin (SEC-001)

---

## 🟠 المنطق المحاسبي

- [ ] ميزان المراجعة = 0 بعد تشغيل عشوائي لـ 100 معاملة في staging
- [ ] إجمالي `inventory_movements * unit_cost` = رصيد حساب 1104 في GL
- [ ] `customers.balance` = SUM(فواتير - مرتجعات - مدفوعات + مرتجعات نقدية) لكل عميل
- [ ] `suppliers.balance` نفس الفحص للموردين
- [ ] `sales_invoices.paid_amount` = SUM(allocations + settlements) لكل فاتورة
- [ ] قيود الإقفال (entry_type='closing') محمية من التعديل
- [ ] لا يمكن إنشاء أي قيد ضمن `locked_until_date` من أي نموذج

## 🟠 الأمان

- [ ] جميع جداول `public.*` لديها RLS مفعّل
- [ ] لا يوجد استخدام لـ `service_role` من client-side
- [ ] Edge functions الإدارية تتحقق من `has_role(uid, 'admin')` صراحة
- [ ] MFA متاح ومفعّل لحساب admin الإنتاج
- [ ] Secrets غير مكشوفة في git history (`git log --all -S "SUPABASE_SERVICE_ROLE"`)
- [ ] CSP headers مضافة في الـ deployment

## 🟠 الأداء

- [ ] `vite build` ينتج bundle < 800KB gzipped للصفحة الرئيسية
- [ ] Lighthouse Performance ≥ 80 على Dashboard
- [ ] Lighthouse Accessibility ≥ 90
- [ ] لا توجد استعلامات > 500ms في staging مع 10K صف اختباري
- [ ] الفهارس مضافة على الأعمدة المُستعلمة بكثرة (PERF-004)

## 🟠 تجربة المستخدم

- [ ] كل النماذج المالية تعرض رسائل خطأ بالعربية واضحة
- [ ] `useBeforeUnload` مفعّل في كل النماذج التي تقبل تعديلاً طويلاً
- [ ] PDF بالعربية يطبع بشكل صحيح (RTL + خطوط)
- [ ] Excel/CSV export يفتح بشكل سليم في Excel العربي (UTF-8 BOM)
- [ ] السايدبار يعمل على الموبايل (375px+)
- [ ] جداول التقارير قابلة للتمرير أفقياً على الموبايل

## 🟠 البيانات والنسخ الاحتياطي

- [ ] Edge function `database-backup` تعمل بنجاح
- [ ] خطة استرجاع موثقة (RTO/RPO)
- [ ] Migration الإنتاج مختبرة على staging أولاً
- [ ] لا توجد بيانات اختبار في DB الإنتاج

## 🟠 المراقبة (Observability)

- [ ] Sentry/error tracker مربوط
- [ ] Edge function logs قابلة للوصول
- [ ] تنبيه على فشل > 1% من الـ requests
- [ ] لوحة مراقبة لـ DB connections / slow queries

## 🟠 التوثيق

- [ ] README محدّث
- [ ] دليل المستخدم النهائي (PDF عربي)
- [ ] دليل المسؤول (إنشاء users, backup, MFA)
- [ ] قائمة Account Codes الموثقة (`mem://tech/accounting-integration-mapping`)

## 🟠 قانوني/تجاري

- [ ] صفحة شروط الاستخدام
- [ ] صفحة سياسة الخصوصية
- [ ] الامتثال لأي متطلبات ضريبية محلية (VAT/مصلحة الضرائب)
- [ ] فاتورة إلكترونية (إن لزم بحسب البلد)

---

## بعد النشر

- [ ] فحص الـ smoke test على الإنتاج (تسجيل دخول، إنشاء فاتورة تجريبية، حذفها)
- [ ] مراقبة الأخطاء أول 24 ساعة بشكل مكثف
- [ ] خطة rollback جاهزة
- [ ] جهة اتصال للدعم متاحة للعملاء الأوائل
