# سجل ملفات SQL ومصادر بنية قاعدة البيانات

آخر مراجعة: 2026-09-07

## المصدر التشغيلي الوحيد

`supabase/migrations/*.sql` هو التاريخ الرسمي والمتسلسل لبنية قاعدة البيانات. سكربت `scripts/migrate-all-companies.sh` يطبق هذا المسار فقط.

لا تنسخ SQL يدوياً إلى قاعدة إنتاج، ولا تجمع لقطة مخطط مع migrations، ولا تعدل migration سبق تطبيقه.

## اختبارات قاعدة البيانات

`supabase/tests/atomic_sales_document_operations.sql` اختبار تكامل، وليس migration. لا يشغّل مباشرة؛ يستدعيه `scripts/tests/run-atomic-sales-documents.sh` داخل قاعدة مؤقتة اسمها `store_accounting_atomic_test` وحاوية غير إنتاجية محددة صراحة.

## الأرشيف التاريخي

| الملف | السبب | الحالة |
|---|---|---|
| `docs/archive/sql/full-schema-snapshot-2026-02.sql` | لقطة قديمة غير مكتملة مقارنة بتاريخ migrations | للقراءة التاريخية فقط؛ أزيلت من `public` حتى لا تدخل حزمة الويب |
| `docs/archive/sql/local-fix-purchase-tax-2026-04.sql` | إصلاح يدوي قديم؛ منطق فاتورة الشراء تطور لاحقاً في migrations | للقراءة التاريخية فقط؛ لا ينفذ |

## تجارب Drizzle المؤرشفة

كان `drizzle/migrations` يحتوي سبعة ملفات أُنشئت في 2026-08-31، بينما كان `drizzle/schema.ts` فارغاً ولم يوجد أمر Drizzle في `package.json`. كما يصرح migration الرسمي `20260831213000_journal_writer_gateway_and_header_sync.sql` أن النشر يطبق `supabase/migrations` وليس `drizzle/migrations`.

معظم منطق Drizzle نُقل أو جُمّع لاحقاً داخل migrations الرسمية. احتوى الملف `0002_journal_and_document_integrity_guards.sql` دالة ومشغلين لا تظهر أسماؤهم في المسار الرسمي؛ وأثبت استعلام قراءة على Farida وAlibea أن العناصر الثلاثة غير موجودة في القاعدتين.

بناءً على ذلك نُقلت الملفات إلى `docs/archive/sql/drizzle-experiments`، وحُذف `drizzle.config.ts` والتعريف الفارغ، وأزيلت حزم Drizzle و`postgres` غير المستخدمة. لا تستعمل ملفات الأرشيف لإنشاء migration جديد.
