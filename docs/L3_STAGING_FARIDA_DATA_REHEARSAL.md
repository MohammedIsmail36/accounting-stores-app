# تجربة بيانات Farida على Staging قبل L3

> التاريخ: 2026-09-08
> الحالة: اكتملت النسخ الاحتياطية والفحص المسبق؛ لم تبدأ الاستعادة

## الهدف وحدود الأمان

الهدف هو تجهيز Staging بصورة واقعية من بيانات Farida الحالية قبل تطبيق L3 الخاص بفصل سجل الترحيلات. تظل Farida مصدر قراءة فقط، ويقتصر أي حذف أو استبدال على Staging بعد وجود نسخة رجوع متحققة.

- لا تنقل مخططات Supabase الداخلية من Farida مثل `auth` و`storage` و`realtime`.
- لا تنقل كلمات مرور أو جلسات أو هويات مستخدمي الإنتاج.
- يبقى مستخدم إدارة Staging وسيلة الدخول إلى البيئة التجريبية.
- تنقل بيانات التطبيق من `public` بالحالة الفعلية، بما فيها المشكلات المعروفة.
- ينقل `lovable_schema_migrations` لأنه موضوع اختبار L3، ولا يعاد تسميته قبل اكتمال الاستعادة والتحقق.
- لا يطبق L3 على Farida أو Alibea قبل نجاح Staging واعتماد المستخدم.

## نسخة Farida الحالية

- المسار: `/backups/farida/manual/farida-before-staging-20260908-1425.dump`
- النوع: PostgreSQL custom dump كامل، دون owner أو ACL.
- الحجم: 2,539,981 بايت.
- عناصر فهرس الاستعادة: 1,046.
- الصلاحية: `0600`، والمالك `deploy:deploy`.
- SHA-256: `efb7cd559ee48d7b592d642793cc723f4e5d951b43ce9a487e7d0896638aa778`.
- اجتاز فحص `pg_restore --list`.

## نسخة رجوع Staging قبل النقل

المجلد `/backups/staging/before-farida-copy-20260908-1435` بصلاحية `0700`، وملفاته بصلاحية `0600`:

| الملف | الحجم | SHA-256 |
|---|---:|---|
| `schema.sql` | 414,159 بايت | `0eff5e88407b47ba0fe0bcd14dff1e08771345a8d38662e77661420684121a59` |
| `data.sql` | 136,142 بايت | `e79c786a4525220bceec750ad8ba4a13f10dbb1092b811bdb5955a0e188747b3` |
| `roles.sql` | 370 بايت | `168a95a9c745af5ed4679751f90419ac9dc434240a213b03e32a06d5664c2308` |

أعيد إنشاء `SHA256SUMS` بأسماء ملفات نسبية بعد اكتشاف أنه كان يشير إلى مجلد العمل المؤقت. اجتازت الملفات الثلاثة `sha256sum -c` بعد التصحيح، ولم يتغير محتوى ملفات النسخة.

ظهر عند تفريغ البيانات تحذير علاقات دائرية في `accounts` و`product_categories`. النسخة صالحة، لكن استعادة data-only فوق قيود مفعلة قد تفشل؛ لذلك يجب أن تستخدم الاستعادة ترتيباً مضبوطاً أو تعطيل المشغلات مؤقتاً داخل Staging فقط.

## مقارنة المخططين

- Farida يعمل على PostgreSQL 15، وStaging البعيد على PostgreSQL 17.
- Farida يحتوي 39 جدول بيانات في `public`، وStaging يحتوي 38.
- الجدول الوحيد الموجود في Farida وغير الموجود في Staging هو `lovable_schema_migrations`.
- أسماء دوال `public` متطابقة: 76 في كل بيئة.
- أسماء المشغلات متطابقة: 37 في كل بيئة.
- تسلسلات أرقام القيود وفواتير البيع والشراء موجودة في البيئتين. اختلاف موضع `DEFAULT nextval(...)` في التفريغ ليس اختلافاً وظيفياً.
- لا توجد بيانات تخالف قيود أنواع الحسابات أو إيجابية مبالغ التخصيص الموجودة في Staging.
- أعمدة مبالغ القيود والسطور `numeric` في Farida و`numeric(15,2)` في Staging. لا توجد قيمة تتجاوز السعة.

## خط أساس أعداد صفوف Farida

```text
accounts=37                         audit_log=10934
company_settings=1                  customer_payment_allocations=90
customer_payments=91                customers=6
expense_types=8                     expenses=24
inventory_adjustment_items=77       inventory_adjustments=2
inventory_movements=1354            journal_entries=308
journal_entry_lines=821             lovable_schema_migrations=96
loyalty_transactions=0              product_brands=195
product_categories=56               product_images=193
product_units=4                     products=613
profiles=2                          purchase_invoice_items=602
purchase_invoice_return_settlements=4  purchase_invoices=30
purchase_return_items=19            purchase_return_payment_allocations=1
purchase_returns=5                  sales_invoice_items=747
sales_invoice_return_settlements=10 sales_invoices=97
sales_return_items=16               sales_return_payment_allocations=1
sales_returns=10                    supplier_payment_allocations=39
supplier_payments=40                suppliers=18
telegram_post_log=19                telegram_settings=1
user_roles=2                        auth.users=2
```

## نتائج سلامة البيانات قبل النقل

- لا توجد رؤوس قيود يكون فيها إجمالي المدين مختلفاً عن إجمالي الدائن.
- القيد 152 بتاريخ 2026-08-06 يحتوي مبالغ بأكثر من منزلتين عشريتين: الإجمالي `954.1090909090909`، وسطر مدين وسطر دائن بقيمة `414.1090909090909`. التقريب إلى `954.11` و`414.11` متماثل ويبقي القيد متوازناً، لكنه يعني أن تحميله مباشرة إلى أعمدة Staging الحالية لن يكون نسخة رقمية حرفية.
- القيد `jentry_balanced` على `journal_entries` معرف بحالة `NOT VALID` في Farida.
- القيود المرحلة 114 و118 و137 متوازنة في الرأس، لكن كل واحد منها بلا أي سطر. إجمالياتها على الترتيب 200 و525 و5,000. هذه مشكلة موجودة في إنتاج Farida قبل النسخ وليست ناتجة عن Staging.
- ترتبط القيود الثلاثة تاريخياً بسندات مصروف، لكن سجلات المصروف الحالية التي تحمل الأرقام نفسها لا تطابق اثنين منها؛ لا يجوز إصلاحها تلقائياً أثناء النقل.
- العلاقات الصريحة من بيانات التطبيق إلى المستخدم محصورة في `loyalty_transactions.created_by -> auth.users` و`telegram_post_log.created_by -> profiles`. يجب الحفاظ على مستخدم Staging وعدم استيراد `auth.users` من الإنتاج.

## قرار النقل

يجب أن تكون Staging صورة واقعية وتحافظ على المشكلات المكتشفة كي تستخدم في الاختبار، مع عدم نسخ هويات الإنتاج. لا تستخدم استعادة كاملة للنسخة؛ تُنشأ حزمة `public` مخصصة، ويحدد فيها صراحة التعامل مع `profiles` و`user_roles` ومراجع المستخدم وتسلسلات الأرقام والكسور الزائدة.

## الخطوة التالية

إنشاء حزمة نقل مخصصة من نسخة Farida، ثم فحص محتواها قبل أي تغيير في Staging. لا تبدأ الاستعادة إلا بعد توثيق الجداول المستبعدة وطريقة الحفاظ على مستخدم إدارة Staging وخطة التحقق والرجوع.
