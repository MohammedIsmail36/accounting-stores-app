# 🧪 خطة الاختبار اليدوي V3
**تاريخ الإصدار:** 2026-04-21
**الهدف:** التحقق الكامل من جاهزية النظام للإنتاج
**المدة الإجمالية المتوقعة:** 6-8 ساعات (لمختبِر واحد)

---

## الجزء 1 — الإطار العام

### البيئة المطلوبة
- ✅ قاعدة بيانات نظيفة (تشغيل `seed-system` edge function أولاً)
- ✅ مستخدم admin + accountant + sales (3 حسابات)
- ✅ متصفح حديث (Chrome/Edge/Firefox)
- ✅ شاشة عادية (1366×768) + موبايل (375×667 محاكاة)
- ✅ صلاحية الوصول لـ Supabase SQL Editor للتحقق

### الأدوار

| الدور | البريد المقترح | الاستخدام |
|------|---------------|-----------|
| admin | admin@test.local | اختبار الصلاحيات الكاملة |
| accountant | accountant@test.local | اختبار صلاحيات المحاسب |
| sales | sales@test.local | اختبار صلاحيات المبيعات |

### نموذج التوقيع لكل مرحلة

| المرحلة | المختبِر | التاريخ | النتيجة | ملاحظات |
|---------|---------|---------|---------|---------|
| Smoke | | | | |
| الدورة المحاسبية | | | | |
| التحقق الرقمي | | | | |
| Edge Cases | | | | |
| الأمان | | | | |
| التقارير | | | | |
| UX | | | | |
| الأداء | | | | |
| الاسترجاع | | | | |
| **UAT النهائي** | | | | |

### مفاتيح القبول
- ✅ **Pass** — يعمل كما هو متوقع تماماً
- ⚠️ **Pass with notes** — يعمل لكن مع ملاحظة بسيطة
- ❌ **Fail** — لا يعمل / نتيجة خاطئة

---

## الجزء 2 — اختبارات Smoke (15 دقيقة)

### S-01: تسجيل دخول
1. افتح `/auth`
2. سجّل دخول كـ admin
3. **متوقع:** تحويل لـ `/` بدون أخطاء

### S-02: MFA enrollment
1. من `/profile` → فعّل MFA
2. سجّل خروج → سجّل دخول → أدخل رمز TOTP
3. **متوقع:** يتم التحويل لـ `/auth/mfa` ثم `/`

### S-03: تحميل Dashboard
1. افتح `/`
2. **متوقع:** عرض KPIs، تنبيهات المخزون، آخر المبيعات بدون أخطاء console

### S-04: إنشاء عميل/مورد/منتج
- إنشاء عميل: CUST-001 / "عميل اختبار"
- إنشاء مورد: SUPP-001 / "مورد اختبار"
- إنشاء منتج: PRD-001 / "منتج اختبار" / سعر شراء 80 / سعر بيع 100

### S-05: ترحيل فاتورة بيع بسيطة
1. شراء أولي: مورد + 10 قطع × 80 = 800
2. بيع: عميل + 1 قطعة × 100 = 100
3. **متوقع:** الترحيل ينجح + رقم posted يظهر

### S-06: ميزان المراجعة = 0
```sql
SELECT SUM(debit) - SUM(credit) FROM journal_entry_lines
WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE status='posted');
```
**متوقع:** `0.00` بالضبط ✅

---

## الجزء 3 — اختبارات الدورة المحاسبية الكاملة

### السيناريو 1: دورة كاملة بدون ضريبة

**البيانات:**
- شراء: 10 قطع × 80 = 800
- بيع: 5 قطع × 100 = 500
- مرتجع بيع: 1 قطعة (= 100)
- مرتجع شراء: 2 قطعة × 80 = 160

**القيود المتوقعة بعد كل عملية:**

**فاتورة الشراء:**
| الحساب | مدين | دائن |
|--------|------|------|
| المخزون 1104 | 800 | — |
| الموردون 2101 | — | 800 |

**فاتورة البيع (مع COGS):**
| الحساب | مدين | دائن |
|--------|------|------|
| العملاء 1102 | 500 | — |
| إيرادات 4101 | — | 500 |
| تكلفة بضاعة 5101 | 400 | — |
| المخزون 1104 | — | 400 |

**معايير القبول:**
- ✅ ميزان المراجعة = 0
- ✅ `customers.balance = 400` (500 - 100)
- ✅ `suppliers.balance = 640` (800 - 160)
- ✅ `quantity_on_hand = 4` (10 - 5 + 1 - 2)

### السيناريو 2: نفس الدورة بضريبة 15%
- فعّل `enable_tax = true` ومعدل 15
- نفس الأرقام، الفاتورة = 500 + 75 ضريبة = 575
- **تحقق:** يظهر سطر ضريبة المبيعات في القيد

### السيناريو 3: الخصومات

**أ. خصم سطر فقط:** 5 قطع × 100 خصم 10 = 490 صافي
**ب. خصم إجمالي فقط:** 500 خصم 50 = 450 صافي
**ج. منع الجمع:** عند إدخال خصم سطر، يجب تعطيل خصم الإجمالي والعكس صحيح

**معيار القبول:** UI يمنع الجمع تلقائياً (per `mem://features/sales-invoice-discount-logic`)

### السيناريو 4: WAC مع 3 أسعار

| العملية | كمية | سعر | WAC المتوقع |
|---------|------|-----|-------------|
| شراء 1 | 10 | 80 | 80 |
| شراء 2 | 10 | 100 | 90 |
| شراء 3 | 5 | 120 | 96 |

**صيغة التحقق:** `(10×80 + 10×100 + 5×120) / 25 = 96`

### السيناريو 5: مرتجع شراء بسعر ≠ WAC

- WAC الحالي = 96
- مرتجع 2 قطعة بسعر شراء أصلي 120
- **متوقع:** فرق (120-96)×2 = 48 → حساب 5108 (variance)

### السيناريو 6: تسوية المخزون

**زيادة 5 قطع:**
| الحساب | مدين | دائن |
|--------|------|------|
| المخزون 1104 | 5×WAC | — |
| فروقات الجرد | — | 5×WAC |

**نقص 3 قطع:** عكس القيد

### السيناريو 7: مدفوعات متعددة لفاتورة

- فاتورة 1000
- دفعة 1: 400 → `paid_amount = 400`
- دفعة 2: 350 → `paid_amount = 750`
- دفعة 3: 250 → `paid_amount = 1000` → الحالة "مدفوعة"

**تحقق:**
```sql
SELECT i.id, i.total, i.paid_amount,
  (SELECT SUM(allocated_amount) FROM customer_payment_allocations WHERE invoice_id = i.id) AS sum_alloc
FROM sales_invoices i WHERE i.id = '...';
-- متوقع: paid_amount = sum_alloc
```

### السيناريو 8: مرتجع → تسوية مع فاتورة لاحقة

- مرتجع رصيد 200 لعميل
- فاتورة جديدة 500
- استخدام التسوية → الباقي 300 فقط

### السيناريو 9: متوسط سعر البيع (إصلاح net_total الجديد) ⭐

**أ. منتج بمرتجع بدون خصم:**
- مبيعات: 60 قطعة × 99 = 5940 (مع خصم 90 → net 5850)
- مرتجع: 10 قطع × 100 = 1000 (بدون خصم → net 1000)
- **متوقع:** `(5850 - 1000) / (60-10) = 97.00`

**ب. منتج بمرتجع فيه خصم 10%:**
- مبيعات: 50 قطعة × 100 = 5000 (net 5000)
- مرتجع: 10 قطع × 100 = 1000 خصم 100 → net 900
- **متوقع:** `(5000 - 900) / (50-10) = 102.50`

**استعلام التحقق:**
```sql
SELECT p.code, get_avg_selling_price(p.id) AS avg
FROM products p WHERE p.code IN ('PRD-001','PRD-002');
```

---

## الجزء 4 — اختبارات التحقق الرقمي (SQL)

### V-01: ميزان المراجعة
```sql
SELECT SUM(debit) - SUM(credit) AS diff FROM journal_entry_lines
WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE status='posted');
```
**متوقع:** `0.00`

### V-02: مطابقة المخزون مع GL
```sql
SELECT
  (SELECT SUM(quantity_on_hand * purchase_price) FROM products) AS inventory_value,
  (SELECT SUM(debit) - SUM(credit) FROM journal_entry_lines jl
   JOIN accounts a ON a.id = jl.account_id WHERE a.code = '1104') AS gl_balance;
```
**متوقع:** الفرق ≤ 0.50 لكل 10000 معاملة

### V-03: customer.balance vs الحركات
```sql
SELECT c.code, c.balance,
  COALESCE((SELECT SUM(total) FROM sales_invoices WHERE customer_id=c.id AND status='posted'),0)
  - COALESCE((SELECT SUM(total) FROM sales_returns WHERE customer_id=c.id AND status='posted'),0)
  - COALESCE((SELECT SUM(cpa.allocated_amount) FROM customer_payment_allocations cpa
              JOIN customer_payments cp ON cp.id=cpa.payment_id
              WHERE cp.customer_id=c.id AND cp.status='posted'),0) AS calc_balance
FROM customers c;
```
**متوقع:** `balance = calc_balance` لكل عميل

### V-04: paid_amount vs allocations
```sql
SELECT i.id, i.paid_amount,
  COALESCE((SELECT SUM(allocated_amount) FROM customer_payment_allocations WHERE invoice_id=i.id),0) AS allocs
FROM sales_invoices i WHERE i.status='posted'
HAVING i.paid_amount != COALESCE((SELECT SUM(allocated_amount) FROM customer_payment_allocations WHERE invoice_id=i.id),0);
```
**متوقع:** صفر صفوف

### V-05: net_total للمرتجعات (الإصلاح الجديد)
```sql
SELECT COUNT(*) FROM sales_return_items WHERE net_total = 0 AND total > 0;
SELECT COUNT(*) FROM purchase_return_items WHERE net_total = 0 AND total > 0;
```
**متوقع:** `0` في كلاهما (بعد backfill)

---

## الجزء 5 — اختبارات Edge Cases

| # | السيناريو | السلوك المتوقع |
|---|-----------|----------------|
| E-01 | فاتورة بتاريخ ضمن فترة مغلقة | ❌ رفض مع رسالة عربية واضحة |
| E-02 | مرتجع كمية > الأصلية | ❌ رفض في UI + DB |
| E-03 | بيع متوازي لآخر قطعة من شخصين | فقط واحد ينجح |
| E-04 | دفعة بمبلغ صفر/سالب | ❌ رفض |
| E-05 | إلغاء قيد closing | ❌ رفض |
| E-06 | تعديل قيد آلي يدوياً | ❌ رفض |
| E-07 | حذف حساب مرتبط بحركات | ❌ رفض |
| E-08 | حذف حساب نظامي (`is_system=true`) | ❌ رفض |
| E-09 | منتج بنفس brand+model | ❌ رفض (uniqueness) |
| E-10 | تسجيل دخول بعدة محاولات خاطئة | rate limit Supabase |

---

## الجزء 6 — الأمان والصلاحيات

### مصفوفة الوصول لكل دور

| الصفحة | admin | accountant | sales |
|--------|:-----:|:----------:|:-----:|
| `/` Dashboard | ✅ | ✅ | ✅ |
| `/sales` فواتير بيع | ✅ | ✅ | ✅ |
| `/purchases` فواتير شراء | ✅ | ✅ | ❌ |
| `/accounts` شجرة الحسابات | ✅ | ✅ | ❌ |
| `/journal` قيود يومية | ✅ | ✅ | ❌ |
| `/users` إدارة المستخدمين | ✅ | ❌ | ❌ |
| `/settings` إعدادات الشركة | ✅ | ❌ | ❌ |
| `/fiscal-year-closing` | ✅ | ❌ | ❌ |
| تقارير مالية (BS/IS/TB) | ✅ | ✅ | ❌ |

### اختبار RLS مباشرة عبر API
- استخدم JWT لكل دور وحاول SELECT من `audit_log` → فقط admin يرى نتائج
- حاول DELETE فاتورة معتمدة بـ accountant → يجب رفض

### MFA
- إذا كان MFA مفعّلاً ولم يتم التحقق → التحويل لـ `/auth/mfa`
- يجب عدم الوصول لأي صفحة محمية قبل aal2

---

## الجزء 7 — التقارير

لكل تقرير من القائمة، تحقق من:
- ✅ الأرقام صحيحة (محسوبة يدوياً من بيانات الاختبار)
- ✅ الفلاتر تعمل (تاريخ، فترة، فلاتر خاصة)
- ✅ تصدير PDF بالعربية بدون مشاكل خطوط
- ✅ تصدير Excel يفتح بدون فساد
- ✅ تصدير CSV بـ UTF-8 BOM

| التقرير | المسار | ملاحظة |
|---------|--------|--------|
| ميزان المراجعة | `/reports/trial-balance` | تحقق debit=credit |
| قائمة الدخل | `/reports/income-statement` | تحقق Revenue-COGS=GP |
| الميزانية | `/reports/balance-sheet` | Assets=Liab+Eq |
| التدفقات النقدية | `/reports/cash-flow` | |
| تقرير المبيعات | `/reports/sales` | net_total |
| تقرير المشتريات | `/reports/purchases` | net_total |
| تقرير المخزون | `/reports/inventory` | مطابقة GL |
| أعمار الديون | `/reports/debt-aging` | 4 buckets |
| تقرير الأداء | `/reports/growth-analytics` | KPIs مع مقارنة |
| تحليل المنتجات | `/reports/product-analytics` | يستخدم net_total |
| دوران المخزون - Dashboard | `/reports/turnover` | |
| دوران - Full Analysis | `/reports/turnover/full` | |
| دوران - Dormant | `/reports/turnover/dormant` | |
| دوران - Inactive | `/reports/turnover/inactive` | |
| دوران - New Products | `/reports/turnover/new` | |
| دوران - Purchase Planning | `/reports/turnover/planning` | |
| دوران - Supplier Returns | `/reports/turnover/supplier-returns` | |

---

## الجزء 8 — تجربة المستخدم

### UX-01: تحذير الخروج بدون حفظ
- افتح فاتورة جديدة، أدخل بيانات، حاول الخروج → **متوقع:** نافذة تأكيد
- بعد الحفظ، حاول الخروج → **متوقع:** لا تظهر النافذة

### UX-02: التنقل + Breadcrumb
- في كل صفحة عميقة، Breadcrumb يعرض المسار الصحيح وكل عنصر قابل للنقر

### UX-03: الفلاتر والبحث
- بحث في DataTable (الموردين/العملاء/المنتجات/...) يعمل فوراً

### UX-04: الإدخال السريع (Tab/Enter)
- في فاتورة، Tab/Enter ينقل بين الحقول ويفتح صف جديد

### UX-05: الموبايل
- محاكاة 375×667
- جميع الصفحات قابلة للاستخدام (السايدبار يصبح drawer)

### UX-06: الطباعة العربية RTL
- طباعة فاتورة → النص عربي صحيح، الأرقام موضعها صحيح

---

## الجزء 9 — الأداء

| الاختبار | الحد المقبول | كيفية القياس |
|---------|---------------|---------------|
| تحميل صفحة 5000 عميل | < 2s | DevTools Network |
| تقرير 10000 معاملة | < 3s | DevTools |
| First Load bundle | < 600KB gzipped | `vite build` |
| Lighthouse Performance | ≥ 80 | Chrome DevTools |
| Lighthouse Accessibility | ≥ 90 | Chrome DevTools |

---

## الجزء 10 — الاسترجاع والصيانة

### R-01: backup → restore
1. شغّل `database-backup` edge function
2. احفظ النسخة في مكان آمن
3. (في بيئة منفصلة) reset DB
4. restore النسخة
5. تحقق: عدد السجلات في كل جدول مطابق

### R-02: seed-system على DB نظيف
1. DB فارغ تماماً
2. شغّل `seed-system`
3. **متوقع:** admin user + chart of accounts + system accounts + company_settings

---

## الجزء 11 — UAT Sign-off

> **أنا الموقّع أدناه أؤكد أن كل الاختبارات أعلاه تم تنفيذها وحققت النتائج المتوقعة. النظام جاهز للنشر الإنتاجي.**

| الدور | الاسم | التوقيع | التاريخ |
|------|------|---------|---------|
| المختبِر الرئيسي | | | |
| المحاسب المعتمد | | | |
| مدير المشروع | | | |
| Admin (صاحب القرار) | | | |

**القرار النهائي:** [ ] ✅ Go to Production    [ ] ❌ No-Go (السبب: _______)

---

## الجزء 12 — جدول تتبع المشكلات

| # | المرحلة | الوصف | الخطورة | الحالة | المسؤول | تاريخ الاكتشاف | تاريخ الإغلاق |
|---|---------|-------|---------|--------|---------|----------------|-----------------|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |

**مستويات الخطورة:**
- 🔴 **Critical** — يمنع النشر
- 🟠 **High** — يجب إصلاحه قبل النشر
- 🟡 **Medium** — يمكن إصلاحه بعد النشر
- 🟢 **Low** — تحسين

---

**ملاحظة ختامية:** هذا الملف هو الوثيقة الوحيدة التي تربط نتائج الاختبار بقرار النشر. أي بند ❌ يجب إغلاقه أو نقله لقائمة المخاطر المقبولة في `PRODUCTION_READINESS_V3.md` قبل الانتقال للإنتاج.
