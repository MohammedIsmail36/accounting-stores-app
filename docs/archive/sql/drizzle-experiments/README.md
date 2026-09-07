# تجارب Drizzle المؤرشفة

> هذه الملفات غير مطبقة وغير تشغيلية، ولا يجوز تنفيذها على قاعدة بيانات.

أُنشئت ملفات هذا المجلد في 2026-08-31 كمسار تجريبي موازٍ. النشر الفعلي كان وما زال يطبق `supabase/migrations` فقط.

أكد استعلام قراءة في 2026-09-07 أن الدالة والمشغلين الموجودين حصراً في `0002_journal_and_document_integrity_guards.sql` غير موجودين في قاعدتي Farida وAlibea:

- `fn_assert_journal_entry_integrity`: غير موجودة في القاعدتين.
- `trg_assert_journal_entry_integrity`: غير موجود في القاعدتين.
- `trg_assert_journal_lines_integrity`: غير موجود في القاعدتين.

نُقل المسار إلى الأرشيف لحفظ تاريخ العمل فقط، وحُذف إعداد Drizzle الفارغ واعتماديات `drizzle-kit` و`drizzle-orm` و`postgres` غير المستخدمة من المشروع النظيف.
