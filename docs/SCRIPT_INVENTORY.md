# سجل سكربتات المشروع

آخر مراجعة: 2026-09-07

هذا الملف يحدد وظيفة كل سكربت وما إذا كان جزءاً من التشغيل الدائم. وجود سكربت في المستودع لا يعني أنه آمن للتشغيل على الإنتاج دون قراءة الحواجز الموضحة هنا.

| السكربت | التصنيف | القرار | ملاحظات الأمان |
|---|---|---|---|
| `scripts/check-eslint-baseline.mjs` | بوابة جودة دائمة | إبقاء | يفشل عند ظهور أي خطأ ESLint أو زيادة تحذيرات `any` عن 997 أو بقية التحذيرات عن 81؛ يسمح بخفض الدين ولا يسمح بزيادته. |
| `scripts/check-repository-safety.sh` | فحص أمان دائم | إبقاء | قراءة فقط؛ يفحص أسماء الملفات وأنماط الأسرار وعودة اعتماد المنصة خارج قائمة تاريخية مغلقة، ولا يطبع القيم المكتشفة. |
| `scripts/deploy-all.sh` | تشغيل إنتاجي | إبقاء وتحصين لاحق | نقطة النشر الرسمية الوحيدة. يدعم `--dry-run` و`--only`، لكن الرجوع الذري للواجهة وEdge Functions غير متاح بعد. |
| `scripts/migrate-all-companies.sh` | تشغيل قواعد البيانات | إبقاء | المصدر الرسمي لتطبيق migrations على النسخ المنفصلة. يوقف التنفيذ عند اكتشاف قاعدة قائمة بلا تاريخ migrations. |
| `scripts/staging/seed-minimal.mjs` | تجهيز Staging | إبقاء | يكتب بيانات اختبار وقيوداً افتتاحية في مشروع Staging المحدد فقط. يحتاج تطابق URL و`ALLOW_STAGING_SEED=yes` ومفتاح service-role من البيئة. لا يشغل على الإنتاج. |
| `scripts/staging/verify-cost-rpc-guard.mjs` | اختبار أمني لـStaging | إبقاء | ينشئ/يعيد استخدام مستخدم اختبار، يغير دوره مؤقتاً، وينشئ فاتورة اختبار ثم يلغيها. مقيد بعنوان Staging و`ALLOW_STAGING_SECURITY_TEST=yes`. |
| `scripts/tests/run-atomic-sales-documents.sh` | اختبار تكامل PostgreSQL | إبقاء — محصن | ينشئ قاعدة مؤقتة داخل حاوية صريحة ثم يحذفها. يتطلب `ALLOW_ISOLATED_DB_TEST=yes` و`TEST_DB_CONTAINER`، ويرفض اسمي حاويتي الإنتاج `farida-db` و`alibea-db`. |
| `scripts/update-everything.sh` | سكربت انتقالي قديم | أزيل | أزيلت نسخته التنفيذية؛ وصف وظيفته وسبب الأرشفة محفوظان في `docs/archive/runbooks/UPDATE_EVERYTHING_2026-09.md`. |

## السكربتات التشغيلية المعتمدة

الحد الأدنى الدائم في جذر `scripts` هو:

```text
scripts/
├── check-eslint-baseline.mjs
├── check-repository-safety.sh
├── deploy-all.sh
├── migrate-all-companies.sh
├── staging/
│   ├── seed-minimal.mjs
│   └── verify-cost-rpc-guard.mjs
└── tests/
    └── run-atomic-sales-documents.sh
```

هذا هو الشكل الحالي المعتمد بعد تنفيذ قرارات المراجعة.

## قواعد الاستخدام

1. لا يشغل أي سكربت Staging على نطاق أو مشروع غير العنوان المقيد داخله.
2. لا تخزن مفاتيح Supabase أو كلمات المرور داخل السكربتات أو Git.
3. لا يستخدم سكربت اختبار حاوية إنتاج افتراضياً؛ يجب تحديد الهدف صراحة.
4. السكربتات الانتقالية الخاصة بإصلاح مرة واحدة لا تبقى بجانب سكربتات النشر الدائم.
5. النشر الفعلي يتبع `docs/DEPLOYMENT_WORKFLOW.md` فقط.
