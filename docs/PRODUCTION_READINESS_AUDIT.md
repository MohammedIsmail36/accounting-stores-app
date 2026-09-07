# تقرير جاهزية النظام للإنتاج (Production Readiness Audit)

> **حالة الوثيقة:** أرشيف تاريخي لنتائج مراجعة 2026-04-21؛ لا يمثل حالة النظام الحالية ولا يُستخدم كقائمة نشر راهنة.
> **آخر تحديث:** 2026-04-21
> **النطاق وقت المراجعة:** نظام محاسبة كامل (مبيعات/مشتريات/مخزون/قيود/تقارير) على البيئة السحابية السابقة
> **الهدف:** رصد كل المشكلات الحدية قبل النشر الإنتاجي مع خطة إصلاح مرتبة بالأولوية

---

## 1. ملخص تنفيذي

| الفئة | حرجة 🔴 | عالية 🟠 | متوسطة 🟡 | منخفضة 🟢 | الإجمالي |
|---|---|---|---|---|---|
| المنطق المحاسبي | 4 | 3 | 2 | 1 | 10 |
| تجربة المستخدم | 1 | 4 | 4 | 2 | 11 |
| الأداء | 1 | 3 | 3 | 2 | 9 |
| الأمان | 1 | 2 | 1 | 1 | 5 |
| **الإجمالي** | **7** | **12** | **10** | **6** | **35** |

### قائمة الـ Blockers (يجب إصلاحها قبل النشر)
1. **[LOGIC-001]** فواتير البيع/الشراء وتسوية المخزون لا تتحقق من `locked_until_date`
2. **[LOGIC-002]** عدم وجود قفل تزامن (concurrency) عند ترحيل فاتورتين متوازيتين تستهلكان نفس المخزون
3. **[LOGIC-003]** المرتجعات لا تتحقق من تجاوز الكمية الأصلية على مستوى DB (التحقق فقط في UI)
4. **[LOGIC-004]** غياب فحص NUMERIC SCALE موحد في DB — أرقام بأكثر من خانتين عشريتين تُخزَّن كما هي
5. **[UX-001]** عدم وجود ErrorBoundary على مستوى التطبيق الجذر (App.tsx) — أي خطأ يُسقط الواجهة بالكامل
6. **[PERF-001]** صفحات Customers/Suppliers/Accounts تجلب كل الصفوف بدون pagination (حد 1000 من Supabase)
7. **[SEC-001]** RLS على `audit_log` يسمح لأي مستخدم authenticated بقراءة كل السجل (يجب حصره بـ admin)

---

## 2. المنطق المحاسبي والتجاري

### [LOGIC-001] الفواتير وتسوية المخزون لا تحترم الفترات المغلقة 🔴
- **الموقع:** `src/pages/SalesInvoiceForm.tsx`, `src/pages/PurchaseInvoiceForm.tsx`, `src/pages/InventoryAdjustmentForm.tsx`
- **الوصف:** التحقق من `locked_until_date` موجود في `JournalEntryForm`, `ExpenseForm`, `CustomerPayments`, `SalesReturnForm`, `PurchaseReturnForm` — **مفقود** في الفواتير وتسوية المخزون.
- **التأثير:** يمكن لمستخدم ترحيل فاتورة بتاريخ ضمن فترة محاسبية مغلقة → تشويه التقارير المالية المُعتمدة.
- **الحل:**
  1. إضافة فحص في `handlePost` لكل من الفاتورتين والتسوية:
     ```ts
     if (settings?.locked_until_date && invoiceDate <= settings.locked_until_date) {
       toast({ variant: "destructive", title: "الفترة مقفلة", description: `...` });
       return;
     }
     ```
  2. **إضافة حماية على مستوى DB** داخل `post_sales_invoice` / `post_purchase_invoice` (RAISE EXCEPTION) لمنع التحايل.
- **التحقق:** اختبار يدوي + unit test في `integration-cycle.test.ts`.

### [LOGIC-002] غياب قفل تزامن عند ترحيل فواتير متوازية 🔴
- **الموقع:** `supabase migrations` — دوال `post_sales_invoice`, `post_purchase_invoice`, `adjust_product_quantity`
- **الوصف:** عند ترحيل فاتورتين متزامنتين تبيعان آخر قطعة من منتج، قد يمران معاً (race condition) ويصبح المخزون سالباً رغم تفعيل `stock_enforcement_enabled`.
- **التأثير:** مخزون سالب، قيود COGS غير دقيقة، خلل في reconciliation.
- **الحل:** استخدام `SELECT ... FOR UPDATE` على صف المنتج داخل دالة الترحيل قبل خصم الكمية، أو advisory locks (`pg_advisory_xact_lock(hashtext(product_id::text))`).
- **التحقق:** اختبار تحميل بـ k6 يُرسل ترحيلين متزامنين لنفس المنتج.

### [LOGIC-003] التحقق من كمية المرتجع على UI فقط 🔴
- **الموقع:** `src/pages/SalesReturnForm.tsx`, `src/pages/PurchaseReturnForm.tsx`
- **الوصف:** التحقق من ألا يتجاوز إجمالي المرتجعات الكمية الأصلية موجود في الواجهة فقط — مستخدم بصلاحية INSERT يستطيع تجاوزه عبر API مباشرة.
- **التأثير:** كميات مرتجعة وهمية → خلل COGS، أرصدة عملاء/موردين خاطئة.
- **الحل:** إضافة trigger/check function في DB:
  ```sql
  CREATE FUNCTION check_return_qty_not_exceeds_invoice() RETURNS trigger AS $$
  BEGIN
    -- compare SUM(returned) <= invoice qty لكل بند
    IF ... THEN RAISE EXCEPTION 'الكمية المرتجعة تتجاوز الأصلية';
  END $$;
  ```
- **التحقق:** اختبار API مباشر يحاول إدخال كمية أعلى.

### [LOGIC-004] غياب فحص الدقة العشرية على مستوى DB 🔴
- **الموقع:** كل أعمدة `numeric` بدون `(precision, scale)` في schema
- **الوصف:** `numeric` بدون scale يقبل 5.123456789 — رغم استخدام `round2` في الواجهة، أي بيانات تأتي عبر API/import مباشر تُخزَّن بدقة عشوائية → أخطاء جمع وتقريب.
- **التأثير:** ميزان المراجعة غير متوازن بفروقات ضئيلة، تقارير مالية تختل.
- **الحل:** migration لتحويل الأعمدة النقدية إلى `numeric(18,2)` (والكميات إلى `numeric(18,3)`).
- **التحقق:** ميزان المراجعة بعد 1000 معاملة عشوائية يجب أن يساوي 0 بالضبط.

### [LOGIC-005] دالة `recalculateEntityBalance` لا تعمل ضمن transaction واحدة 🟠
- **الموقع:** `src/lib/entity-balance.ts:9`
- **الوصف:** عدة استعلامات منفصلة + UPDATE في النهاية — إذا فشل الاتصال بعد القراءة وقبل التحديث يبقى الرصيد قديماً.
- **الحل:** نقل المنطق إلى دالة DB واحدة (`recalc_entity_balance(entity_id, type)`) تستدعى من triggers بعد كل INSERT/UPDATE في الفواتير/المرتجعات/المدفوعات.
- **التحقق:** ضمان تطابق `customer.balance` مع كشف الحساب في كل الحالات.

### [LOGIC-006] الإقفال السنوي لا يمنع المعاملات بعد تاريخ الإقفال 🟠
- **الموقع:** `src/pages/FiscalYearClosing.tsx`
- **الوصف:** لا يوجد ربط تلقائي بين الإقفال و`locked_until_date` — يجب أن يُضبط آلياً بعد الإقفال.
- **الحل:** عند تنفيذ الإقفال، تحديث `company_settings.locked_until_date = closing_date` تلقائياً.

### [LOGIC-007] قيود الإقفال يمكن إلغاؤها 🟠
- **الموقع:** `journal_entries` بدون قيد على `entry_type='closing'`
- **الحل:** trigger يمنع تعديل/إلغاء أي قيد بـ `entry_type='closing'`.

### [LOGIC-008] WAC يُعاد حسابه عند المرتجعات بطريقة قد تُحدث variance غير دقيق 🟡
- **الموقع:** `src/lib/product-utils.ts` + دوال DB
- **الوصف:** عند مرتجع شراء، الـ WAC يُحسب من المتبقي — إذا كانت الكمية المتبقية صفر يحدث division by zero محتمل.
- **الحل:** حماية صريحة `IF qty > 0 THEN ... ELSE wac := 0`.

### [LOGIC-009] تكرار التسويات يدوياً ممكن 🟡
- **الموقع:** `sales_invoice_return_settlements` / `purchase_invoice_return_settlements`
- **الحل:** UNIQUE constraint على `(invoice_id, return_id)` + check `SUM(settled) <= return.total`.

### [LOGIC-010] دفعات بمبلغ صفر/سالب غير محظورة على DB 🟢
- **الحل:** CHECK constraint: `amount > 0`.

---

## 3. تجربة المستخدم (UX)

### [UX-001] غياب ErrorBoundary على مستوى App الجذر 🔴
- **الموقع:** `src/App.tsx`
- **الوصف:** ErrorBoundary مستخدم فقط داخل أقسام Dashboard. أي خطأ JS في أي صفحة أخرى → شاشة بيضاء.
- **الحل:** لف `<RouterProvider>` بـ `<ErrorBoundary>` على المستوى الأعلى.

### [UX-002] عدم وجود تحقق Zod موحد للنماذج المالية 🟠
- **الوصف:** المشروع يستخدم `react-hook-form` + zod في بعض الأماكن لكن نماذج الفواتير تعتمد على state عادي وفحوصات يدوية.
- **الحل:** إنشاء `src/lib/validation/invoice-schema.ts` ووضعه على `SalesInvoiceForm`/`PurchaseInvoiceForm` لضمان رسائل خطأ متسقة.

### [UX-003] رسائل خطأ Supabase تُعرض بصياغة تقنية أحياناً 🟠
- **الوصف:** كثير من `catch` يعرض `error.message` كما هو (إنجليزي تقني).
- **الحل:** wrapper موحّد `formatSupabaseError(err)` يُترجم رسائل القيود الشائعة (UNIQUE, CHECK, FK) للعربية.

### [UX-004] طباعة PDF بالعربية معتمدة لكن بدون preview قبل التصدير 🟠
- **الموقع:** `src/lib/pdf-arabic.ts`, `report-pdf.ts`
- **الحل:** إضافة modal preview (يستخدم `<iframe>` + blob URL) قبل التنزيل.

### [UX-005] تحذير قبل المغادرة (`useBeforeUnload`) غير مُفعّل في كل النماذج 🟠
- **الوصف:** مفعّل في `ExpenseForm`, `JournalEntryForm`, `InventoryAdjustmentForm`, `ProductForm`, `PurchaseInvoiceForm` — **مفقود** في `SalesInvoiceForm`, `SalesReturnForm`, `PurchaseReturnForm`, `CustomerPayments`, `SupplierPayments`.

### [UX-006] السايدبار على الموبايل يحتاج اختبار شامل 🟡
- الفئة: responsiveness — جداول التقارير لا تستخدم `overflow-x-auto` بثبات.

### [UX-007] LookupCombobox قد يبطئ مع +5000 سجل 🟡
- **الحل:** virtualization عبر `@tanstack/react-virtual` أو server-side search.

### [UX-008] استبدال `alert()`/`confirm()` بـ AlertDialog 🟡
- فحص: `grep "window.confirm\|alert(" src/` — ربما توجد بقايا.

### [UX-009] حالات Empty State بدون CTA واضح 🟡
- مثلاً صفحة Customers الفارغة لا تظهر زر "إضافة أول عميل" بشكل بارز.

### [UX-010] المسارات المحمية بدور لا تظهر صفحة 403 واضحة 🟢
- `ProtectedRoute` يعيد توجيه `/` بدون تنبيه — يفضل صفحة `Forbidden.tsx`.

### [UX-011] السكتلتون (Skeleton) غير موحد بين الصفحات 🟢
- استخدام `PageSkeleton` في كل الصفحات بدلاً من `Spinner`.

---

## 4. الأداء (Performance)

### [PERF-001] صفحات تجلب كل الصفوف بدون pagination 🔴
- **الموقع:** `Customers.tsx`, `Suppliers.tsx`, `Accounts.tsx`, `Expenses.tsx` (تحقّق)
- **الوصف:** Supabase يحدّ بـ 1000 صف افتراضياً. عميل لديه 1500 عميل سيشاهد 1000 فقط بدون أي تحذير.
- **الحل:** استخدام نفس نمط `usePagedQuery` + `range()` المُطبّق في `Sales`, `Purchases`, `Products`, `Journal`, `InventoryMovements`.

### [PERF-002] تقرير Inventory Turnover يجلب الكل دفعة واحدة 🟠
- **الموقع:** `src/pages/reports/inventory-turnover/TurnoverDataContext.tsx`
- **الحل:** نقل التجميعات الثقيلة إلى دالة Postgres تعيد JSON مُجمَّع.

### [PERF-003] استعلامات N+1 محتملة في كشف العملاء 🟠
- **الموقع:** `CustomerStatement.tsx`, `SupplierStatement.tsx`
- **الحل:** التحقق من استخدام join واحد عبر `get_account_statement` RPC الموجود.

### [PERF-004] غياب مؤشرات (indexes) على أعمدة مُستعلمة بكثرة 🟠
- **الأعمدة المرشحة:**
  - `journal_entry_lines(account_id, journal_entry_id)`
  - `inventory_movements(product_id, movement_date)`
  - `sales_invoices(customer_id, status, invoice_date)`
  - `purchase_invoices(supplier_id, status, invoice_date)`
- **الحل:** migration لإضافة الفهارس.

### [PERF-005] حجم الـ Bundle قد يكون كبيراً 🟡
- **الحل:** تحليل `vite build --mode analyze` ثم تأجيل تحميل `jspdf`, `xlsx`, `recharts` عبر dynamic import.

### [PERF-006] React Query staleTime منخفض في بعض الـ hooks 🟡
- مراجعة `use-products-lookup`, `use-accounts` — لا تتغير كثيراً، يمكن staleTime: 5min.

### [PERF-007] Re-render زائد في Dashboard 🟡
- ملف `Dashboard.tsx` بـ 2300 سطر — مرشح للتقسيم لمكونات مع `React.memo`.

### [PERF-008] عدم استخدام HTTP caching في edge functions 🟢
- إضافة `Cache-Control` للاستعلامات القابلة للتخزين.

### [PERF-009] جداول التقارير بدون virtualization 🟢
- `DataTable` يحمّل كل الصفوف للعرض — يحتاج virtualization عند >500 صف.

---

## 5. الأمان

### [SEC-001] RLS على `audit_log` فضفاض 🔴
- **السياسة الحالية:** `auth.role() = 'authenticated'` (أي مستخدم يقرأ الكل)
- **الخطر:** كشف بيانات حساسة (تغييرات على المرتبات، أرصدة، إلخ) لكل المستخدمين.
- **الحل:** تقييد بـ `has_role(auth.uid(), 'admin')`.

### [SEC-002] Edge functions بدون rate limiting 🟠
- **الموقع:** `supabase/functions/create-user`, `database-backup`, `seed-system`
- **الحل:** فحص `verify_jwt = true` + إضافة rate limit بسيط (Redis/upstash) للوظائف الإدارية.

### [SEC-003] Edge function `seed-system` خطيرة إن وصلت لمستخدم عادي 🟠
- **الحل:** التحقق صراحة من `has_role(user_id, 'admin')` داخل الدالة (وليس فقط verify_jwt).

### [SEC-004] غياب MFA إجباري للأدوار الحساسة 🟡
- النظام يدعم MFA لكن لا يفرضه على admin — يفضل `enforce_mfa_for_admins=true`.

### [SEC-005] Secrets متاحة كـ env client-side 🟢
- التأكد أن جميع الأسرار الحساسة في `supabase/functions/_shared` فقط.

---

## 6. خارطة الطريق المقترحة

### Sprint 1 — Blockers (5-7 أيام)
1. LOGIC-001: قفل الفترات في كل النماذج (UI + DB)
2. LOGIC-002: قفل التزامن في دوال الترحيل
3. LOGIC-003: trigger DB لمنع تجاوز كمية المرتجع
4. LOGIC-004: migration لتثبيت `numeric(18,2)` / `(18,3)`
5. UX-001: ErrorBoundary على الجذر
6. PERF-001: pagination لكل الصفحات الكبيرة
7. SEC-001: تشديد RLS على audit_log

### Sprint 2 — High Priority (5 أيام)
- LOGIC-005, 006, 007 (Entity balance, Closing locks)
- UX-002, 003, 004, 005 (Zod, error messages, PDF preview, beforeUnload)
- PERF-002, 003, 004 (Inventory turnover, N+1, indexes)
- SEC-002, 003 (Rate limit, seed-system guard)

### Sprint 3 — Polish (3 أيام)
- باقي البنود متوسطة/منخفضة الأولوية
- توثيق نهائي + اختبار قبول

---

## 7. قائمة فحص ما قبل النشر (Pre-launch)
انظر `docs/PRE_LAUNCH_CHECKLIST.md`.
