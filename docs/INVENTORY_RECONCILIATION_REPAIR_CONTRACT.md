# عقد معالج انحرافات المخزون

> التاريخ: 2026-09-13
>
> الفرع: `feature/inventory-control-staging`
>
> الحالة: المرحلة 2B مطبقة ومتحقق منها على Staging فقط؛ التنفيذ الفعلي للإصلاح ما زال محجوبًا
>
> النطاق: فرع Staging فقط؛ لا تطبيق إنتاجي ولا تنفيذ إصلاح أعمال في 2B

## 1. الهدف

يحوّل المعالج نتيجة التشخيص المقروءة إلى عملية مراجعة موثقة، ثم ينفذ نوع إصلاح محدداً بعد اعتماد المدير. لا يغيّر المعالج رقماً لمجرد وجود فرق، ولا يعد فرق WAC التحليلي انحرافاً يحتاج إصلاحاً.

يبقى الفصل واضحاً بين:

- `get_inventory_reconciliation_diagnostic`: تشخيص لحظي للقراءة فقط.
- معالج الانحراف: طلب ومراجعة واعتماد وتنفيذ موثق.
- تسوية المخزون: مستند تشغيلي لتسجيل واقع مخزني جديد.
- الجرد الفعلي: عملية رقابية مستقلة تبدأ بلقطة وعد أعمى.

## 2. قرار التنفيذ المرحلي

لا تنفذ الأنواع الخمسة في Migration واحدة. تقسم المرحلة 2 إلى:

1. **2A — عقد المعالج:** تثبيت الجداول والحالات والصلاحيات والعقود. لا SQL.
2. **2B — سجل المعالجة:** إنشاء الجداول وسياسات القراءة وعمليات إنشاء/تعديل/إرسال/اعتماد المسودة فقط. لا تغيير منتجات أو حركات أو قيود.
3. **2C — إعادة بناء كمية البطاقة:** أول منفذ إصلاح، ويعمل فقط عندما تثبت صحة الحركات وأن `quantity_on_hand` وحده خاطئ.
4. **2D — حركة صحيحة بلا قيد:** منفذ مستقل بعد تثبيت خريطة الحساب المقابل لكل نوع مستند.
5. **2E — قيد بلا حركة:** منفذ مستقل؛ لا يعكس القيد كاملاً قبل تحليل سطوره وأثره.
6. **2F — التسوية وفرق التقريب:** الربط بمستند التسوية الذري وحساب فروق التقريب بعد اعتماد إعداد الحساب.

لا تنتقل دفعة إلى التالية إلا بعد L3 معزولة ثم Staging وقبول مستقل.

## 3. أنواع الإصلاح في الإصدار الأول

| الرمز | الوصف | الأثر المسموح | حالة التنفيذ |
|---|---|---|---|
| `rebuild_product_card` | إعادة كمية بطاقة المنتج من صافي الحركات الصحيحة | تحديث `products.quantity_on_hand` فقط داخل RPC موثقة | أول نوع ينفذ في 2C |
| `create_missing_inventory_journal` | إنشاء قيد تصحيح لحركة صحيحة موثقة بلا أثر 1104 | قيد تصحيح جديد بلا حركة جديدة | تصميم فقط حتى 2D |
| `reverse_unbacked_inventory_journal` | معالجة قيد 1104 غير المدعوم بحركة | قيد تصحيحي/عكسي جديد؛ لا تعديل للأصل | تصميم فقط حتى 2E |
| `create_linked_inventory_adjustment` | فرق كمية أو قيمة يمثل واقعاً مخزنياً جديداً | إنشاء مسودة تسوية مرتبطة ثم ترحيلها بمحرك التسوية | تصميم فقط حتى 2F |
| `post_rounding_adjustment` | باقي تقريب مثبت المصدر | قيد تكلفة محدود إلى حساب تقريب معتمد | محجوب حتى اعتماد الحساب والحد |

`manual_review` تصنيف قرار وليس نوع إصلاح منفذ. يستخدم عندما لا تكفي الأدلة، وتبقى الحالة مفتوحة بلا كتابة مالية.

## 4. نموذج البيانات

### 4.1 رأس عملية المعالجة

الجدول: `inventory_reconciliation_repairs`

الحقول الأساسية:

```text
id uuid primary key
repair_number bigint unique not null
status text not null
title text not null
explanation text not null
diagnostic_fingerprint text not null
diagnostic_snapshot_at timestamptz not null
source_scope text not null
version integer not null default 1
accounting_date date null
reverses_repair_id uuid null
reversed_by_repair_id uuid null
separation_override_reason text null
prepared_by uuid not null
prepared_at timestamptz not null
submitted_by uuid / submitted_at timestamptz
approved_by uuid / approved_at timestamptz
executed_by uuid / executed_at timestamptz
cancelled_by uuid / cancelled_at timestamptz / cancellation_reason text
reversed_by uuid / reversed_at timestamptz / reversal_reason text
created_at / updated_at timestamptz
```

الحالات المسموحة:

```text
draft -> ready_for_review -> approved -> executed -> reversed
  |             |              |
  +-----------> cancelled <----+
```

- لا توجد حالة `executing` دائمة؛ التنفيذ يتم داخل معاملة واحدة.
- فشل متوقع داخل المنفذ يسجل حدث `execution_failed` وتبقى العملية `approved` قابلة للمراجعة، من دون أثر أعمال جزئي.
- لا تعاد العملية المنفذة إلى مسودة.
- لا يحذف أي رأس معالجة؛ المسودة غير المطلوبة تصبح `cancelled` للحفاظ على الأثر الرقابي.

### 4.2 بنود الانحراف

الجدول: `inventory_reconciliation_repair_items`

```text
id uuid primary key
repair_id uuid not null
line_number integer not null
axis text not null                 -- product أو source
issue_key text not null
classification text not null
repair_type text not null
product_id uuid null
source_type text null
source_id uuid null
source_number text null
original_journal_entry_id uuid null
before_card_quantity numeric null
before_movement_quantity numeric null
before_movement_book_value numeric(18,2) null
before_ledger_1104_value numeric(18,2) null
proposed_card_quantity numeric null
proposed_movement_book_value numeric(18,2) null
proposed_ledger_1104_value numeric(18,2) null
after_card_quantity numeric null
after_movement_quantity numeric null
after_movement_book_value numeric(18,2) null
after_ledger_1104_value numeric(18,2) null
before_state jsonb not null
proposed_state jsonb not null
after_state jsonb null
precondition_hash text not null
result_status text not null default 'pending'
result_message text null
created_at / updated_at timestamptz
```

القيود:

- `unique (repair_id, line_number)`.
- `unique (repair_id, axis, issue_key)` لمنع تكرار الانحراف داخل الطلب.
- لا يسمح بأكثر من عملية نشطة (`draft` أو `ready_for_review` أو `approved`) لنفس `axis + issue_key`. يتحقق RPC من ذلك داخل قفل استشاري خاص بمفتاح الانحراف لمنع سباق طلبين متزامنين، مع إبقاء العمليات التاريخية `cancelled` و`executed`.
- يجب وجود `product_id` لمحور المنتج، و`source_type/source_id` لمحور المصدر المعروف.
- القيم الكمية والمالية التي تقود القرار تحفظ في أعمدة `numeric` قابلة للفحص، ولا تدفن داخل JSON فقط. تستخدم حقول JSON للأدلة والسياق الإضافي.
- لا تحفظ قيمة «بعد» إلا بواسطة منفذ قاعدة البيانات.
- `before_state` و`proposed_state` لقطتان غير قابلتين للتعديل بعد `ready_for_review`.
- لا تقبل بنود `matched`، ولا يقبل فرق WAC وحده كبند إصلاح.

### 4.3 آثار التنفيذ

الجدول: `inventory_reconciliation_repair_effects`

```text
id uuid primary key
repair_id uuid not null
repair_item_id uuid not null
effect_type text not null
table_name text not null
record_id uuid not null
before_data jsonb null
after_data jsonb null
created_at timestamptz not null
```

يحفظ روابط السجلات التي أنشئت أو تغيرت فعلاً: المنتج، مستند التسوية، الحركة، القيد أو قيد العكس. وجود جدول آثار مستقل يمنع ضغط عدة حركات أو قيود داخل أعمدة مفردة في البند.

### 4.4 سجل الأحداث والأوامر

الجدول: `inventory_reconciliation_repair_events`

```text
id uuid primary key
repair_id uuid not null
event_type text not null
from_status text null
to_status text null
request_id uuid not null
actor_id uuid not null
event_data jsonb not null default '{}'
created_at timestamptz not null
unique (request_id)
```

يكون `request_id` فريداً على مستوى جدول الأحداث كله، وليس داخل العملية فقط، حتى تكون إعادة إرسال أمر الإنشاء نفسه آمنة أيضاً ولا تنشئ عملية ثانية.

## 5. الصلاحيات

- المدير والمحاسب يقرآن الرأس والبنود والآثار والأحداث.
- المحاسب والمدير ينشئان المسودة ويعدلانها ويرسلانها للمراجعة.
- المدير وحده يعتمد وينفذ ويلغي بعد الاعتماد ويعكس عملية منفذة.
- إذا كان المُعد والمدير المنفذ الشخص نفسه، يجب ملء `separation_override_reason` وتسجيل حدث صريح بأن فصل المهام لم يتحقق.
- لا يملك `anon` أو دور البائع أي صلاحية.
- لا توجد سياسات `INSERT/UPDATE/DELETE` مباشرة للمستخدمين على الجداول الأربعة.
- جميع الكتابات تمر عبر دوال `SECURITY DEFINER` ذات `search_path` ثابت وفحص صريح لـ`auth.uid()` والدور.
- `service_role` لا يتجاوز قواعد الأعمال؛ يسمح به فقط للأدوات الإدارية المقيدة ويُسجل الفاعل التشغيلي صراحة.

## 6. واجهات قاعدة البيانات

### 6.1 عمليات دورة المستند

```text
create_inventory_reconciliation_repair(..., p_request_id uuid) -> jsonb
update_inventory_reconciliation_repair(..., p_expected_version integer, p_request_id uuid) -> jsonb
submit_inventory_reconciliation_repair(p_id, p_expected_version, p_request_id) -> jsonb
approve_inventory_reconciliation_repair(p_id, p_expected_version, p_separation_override_reason, p_request_id) -> jsonb
cancel_inventory_reconciliation_repair(p_id, p_reason, p_expected_version, p_request_id) -> jsonb
```

في 2B تنفذ هذه العمليات دورة الاعتماد فقط ولا تلمس جداول الأعمال.

### 6.2 التنفيذ والرجوع

```text
execute_inventory_reconciliation_repair(p_id, p_expected_version, p_request_id) -> jsonb
reverse_inventory_reconciliation_repair(p_id, p_reason, p_expected_version, p_request_id) -> jsonb
```

تضاف كل حالة `repair_type` إلى المنفذ في دفعتها الخاصة. أي نوع غير مفعل يعيد `REPAIR_TYPE_NOT_ENABLED` قبل أي كتابة.

تعيد أخطاء دورة المستند رموزاً ثابتة قابلة للعرض والترجمة في الواجهة، ومنها:

- `REPAIR_DUPLICATE_ISSUE` عند تكرار الانحراف داخل الطلب نفسه.
- `REPAIR_ISSUE_ACTIVE` عند وجود عملية نشطة أخرى للانحراف نفسه.
- `REPAIR_VERSION_CONFLICT` عند إرسال نسخة قديمة.
- `REPAIR_PRECONDITION_CHANGED` عند تغير السجل منذ المعاينة.
- `REPAIR_TYPE_NOT_ENABLED` عند طلب تنفيذ نوع لم تعتمد دفعته بعد.

## 7. التزامن ومنع القرار القديم

البصمة العامة من شاشة التشخيص تحفظ كدليل إنشاء، لكنها لا تستخدم وحدها لمنع التنفيذ؛ لأنها تتغير عند أي حركة مخزون غير مرتبطة بالإصلاح.

عند التنفيذ:

1. يقفل رأس المعالجة وبنودها `FOR UPDATE`.
2. يقفل المنتج أو المستند أو القيد المتأثر فقط.
3. يعيد حساب الانحراف المحدد من المصدر الحالي.
4. يقارن `precondition_hash` والقيم الأساسية في `before_state`.
5. يرفض بـ`REPAIR_PRECONDITION_CHANGED` إذا تغير السجل المتأثر.
6. لا يرفض بسبب تغير منتج آخر غير داخل العملية.
7. يزيد `version` في كل انتقال حالة لمنع اعتماد نسخة واجهة قديمة.

هذا قفل متفائل على المستند وقفل صفوف عند التنفيذ، وليس قفلاً عاماً للمخزون.

## 8. قواعد التنفيذ الذري

- تبدأ جميع الآثار وتنتهي داخل استدعاء RPC واحد ومعاملة واحدة.
- يمنع التنفيذ في تاريخ يساوي أو يسبق `locked_until_date` عندما ينشأ قيد أو مستند مؤرخ.
- لا يعدل قيداً أو حركة مرحلة؛ التصحيح بسجل جديد مرتبط بالأصل.
- الاستثناء الوحيد هو `rebuild_product_card`: يعدل حقل البطاقة لأنه نسخة مشتقة، بعد إثبات أن الحركات نفسها سليمة، ويسجل القديم والجديد في الآثار والتدقيق.
- لا ينشئ `rebuild_product_card` حركة أو قيداً؛ إن كان الواقع المخزني تغير فالمسار الصحيح تسوية مخزون.
- بعد الكتابة يعاد التشخيص داخل المعاملة نفسها على البنود المتأثرة.
- لا تعتمد العملية `executed` إلا إذا تحقق الأثر المتوقع ولم تظهر مشكلة جديدة.
- عند الفشل ترجع آثار الأعمال كلها. يسجل فشل متوقع في حدث مستقل داخل معالجة استثناء مضبوطة، من دون إخفاء خطأ غير متوقع.
- العكس عملية جديدة أو قيد/مستند عكس؛ لا يحذف الأثر السابق ولا يعيد كتابة تاريخه.

## 9. عقد أول منفذ: إعادة بناء كمية البطاقة

لا يقبل التنفيذ إلا إذا تحققت جميع الشروط:

- التصنيف الحالي `product_balance`.
- المنتج نفسه هو المحدد في البند.
- لا يوجد `unresolved_source_reference`.
- لا توجد `zero_quantity_nonzero_value` أو `nonzero_quantity_zero_value` أو تكلفة دفترية سالبة.
- صافي الحركات الحالي يساوي القيمة المقترحة المخزنة في البند.
- كمية البطاقة الحالية تساوي `before_state.card_quantity`.
- لا توجد عملية أخرى منفذة أو معتمدة لنفس `issue_key` وشرط البداية.

الأثر:

```text
products.quantity_on_hand = current_movement_quantity
```

ثم يسجل:

- القيمة القديمة والجديدة.
- عدد الحركات وتاريخ آخر حركة.
- البصمة الموضعية قبل التنفيذ.
- نتيجة إعادة التشخيص.
- المنفذ و`request_id` والزمن.

## 10. الأنواع المحجوبة حتى استكمال متطلباتها

### حركة بلا قيد

لا ينشأ قيد تلقائياً حتى توجد خريطة معتمدة لكل نوع مستند تحدد:

- اتجاه أثر `1104`.
- الحساب المقابل الصحيح من المستند الأصلي.
- التاريخ والوصف والمرجع.
- منع إنشاء قيد ثان عند إعادة المحاولة.

### قيد بلا حركة

لا يعكس القيد كاملاً تلقائياً؛ فقد يحتوي أطرافاً صحيحة أخرى. يجب تحليل سطور القيد وتحديد هل المطلوب قيد تصحيح جزئي أم مستند مخزون مفقود.

### فرق التقريب

محجوب حتى اعتماد:

- الحد لكل مستند والحد الإجمالي.
- حساب فروق التقريب في `company_settings` أو إعداد محاسبي مكافئ.
- اتجاه القيد وسياسة التاريخ والفترة المقفلة.

فرق Staging الحالي `0.02` يبقى ملاحظة موثقة ولا يحتاج تصحيحاً لمجرد صغره.

## 11. الفهارس الأولية

```text
repairs (status, created_at desc)
repairs (prepared_by, created_at desc)
items (repair_id, line_number)
items (axis, issue_key)
items (product_id) where product_id is not null
items (source_type, source_id) where source_id is not null
effects (repair_id, repair_item_id)
events (repair_id, created_at)
```

لا يضاف فهرس إلى جداول الأعمال قبل إثبات الحاجة بـ`EXPLAIN (ANALYZE, BUFFERS)` على Staging.

## 12. اختبارات 2B قبل Migration

1. رفض البائع و`anon` لكل قراءة أو أمر.
2. نجاح قراءة المدير والمحاسب.
3. المحاسب ينشئ ويعدل مسودة صحيحة.
4. رفض UUID مصدر غير موجود أو لا يطابق `source_type`.
5. رفض منتج أو مصدر حالته `matched`.
6. رفض فرق WAC وحده كبند إصلاح.
7. رفض تكرار `issue_key` في العملية.
8. رفض فتح عملية نشطة ثانية لنفس `axis + issue_key` ولو كانت في رأس مختلف.
9. نجاح الإرسال للمراجعة وقفل البنود.
10. رفض تعديل بند بعد الإرسال.
11. المدير وحده يعتمد.
12. رفض الاعتماد عند تغير `version`.
13. إعادة `request_id` نفسه لا تنشئ حدثاً أو عملية ثانية.
14. رفض التنفيذ في 2B برسالة `REPAIR_TYPE_NOT_ENABLED` وبقاء بيانات الأعمال كما هي.
15. إلغاء المسودة/المعتمدة حسب الصلاحية دون حذف.
16. سلامة القيود الأجنبية وRLS والمنح و`search_path` وتطابق بيانات الأعمال بعد `ROLLBACK`.

## 13. اختبارات 2C الإضافية

1. نجاح إعادة بناء البطاقة عند سلامة الحركات وحدها.
2. رفض التنفيذ إذا أصبحت البطاقة مطابقة بالفعل.
3. رفض التنفيذ إذا تغيرت كمية البطاقة بعد المعاينة.
4. رفض التنفيذ إذا أضيفت حركة للمنتج بعد المعاينة.
5. عدم تأثر العملية بحركة على منتج آخر.
6. منع التنفيذ المكرر بنفس `request_id` أو بطلب جديد للعملية المنفذة.
7. حفظ أثر قبل/بعد وحدث التنفيذ والفاعل.
8. إعادة التشخيص وإثبات صفر فرق الكمية.
9. عدم إنشاء حركة أو قيد أو تعديل قيمة تكلفة.
10. فشل أي تحقق يرجع تحديث المنتج وكل آثار العملية.

## 14. خطة الرجوع

- Migration 2B تضيف جداول ودوال جديدة فقط ولا تعدل مستندات قديمة.
- قبل Staging تؤخذ نسخة schema/data وخط أساس الأعمال.
- يجرب الإنشاء ودورة الحالات داخل معاملة تنتهي بـ`ROLLBACK` على نسخة L3 أولاً.
- ملف الرجوع يحذف الدوال ثم الجداول الجديدة بترتيب العلاقات، ولا يلمس التشخيص أو جداول الأعمال.
- بعد وجود عملية منفذة في أي بيئة لا يسمح بإسقاط الجداول كرجوع عادي؛ يستخدم إصلاح أمامي أو عكس أعمال موثق.
- لا يطبق شيء على Farida أو Alibea ضمن المرحلة الحالية.

## 15. بوابة الانتقال إلى 2B

لا تبدأ Migration الجداول حتى:

- اعتماد هذا العقد.
- حسم أن عمليات المعالجة لا تحذف، بل تلغى.
- اعتماد أن البصمة الموضعية هي حاجز التنفيذ، والبصمة العامة دليل تشخيص فقط.
- قبول أن 2B يبني دورة المستند بلا أي إصلاح فعلي.
- كتابة اختبارات TDD الحمراء للعقد أولاً.

**حالة البوابة:** مكتملة بتاريخ 2026-09-13. اعتمد المستخدم العقد، وثُبتت سياسة الإلغاء وعدم الحذف، والفصل بين البصمة العامة وشرط البداية الموضعي، وحدود 2B دون كتابة على جداول الأعمال. نجح الأمر المعزول:

```text
sudo /usr/bin/node /opt/accounting-app/scripts/tests/rehearse-inventory-repair-lifecycle.mjs --expect-missing
TDD_REPAIR_LIFECYCLE_RED_OK
```

أكد الاختبار غياب الجداول والدوال الجديدة كما هو متوقع قبل التنفيذ، ولم ينفذ سيناريوهات بيانات أو يغير L3 أو Staging أو الإنتاج.

بعد كتابة Migration ‏`20260913234500_inventory_reconciliation_repair_lifecycle.sql`، نجحت السيناريوهات الستة عشر داخل L3 المعزولة مع `ROLLBACK` كامل. أثبت الاختبار دورة الإنشاء والتعديل والإرسال والاعتماد والإلغاء، والصلاحيات وRLS، ومنع التكرار والطلبات القديمة، وبقاء منفذ الإصلاح الفعلي محجوبًا بالرمز `REPAIR_TYPE_NOT_ENABLED`. لم تبق الجداول أو الدوال أو العينات في L3، ولم تتغير Staging أو قواعد الإنتاج.

حُفظ دليل التجربة والتحقق منه في:

```text
/backups/staging/inventory-reconciliation-before-20260913-192242/repair-lifecycle-l3-rehearsal
```

بتاريخ 2026-09-14 أُخذت نسخة حديثة من Staging قبل 2B وحُفظت في:

```text
/backups/staging/inventory-repair-before-20260914-081004
```

أثبت خط الأساس وجود `613` منتجًا و`1354` حركة مخزون، وحالة التشخيص `rounding_only`، وغياب جميع جداول ودوال 2B وسجل إصدارها. بعد ذلك شُغلت Migration والسيناريوهات الستة عشر على مشروع Staging `dunzfxurefzlaamgghys` داخل معاملة واحدة انتهت بـ`ROLLBACK`. أكد فحص مستقل اختفاء كل مكونات 2B وتطابق أعداد وبصمات بيانات الأعمال مع النسخة. حُفظ دليل التجربة في:

```text
/backups/staging/inventory-repair-before-20260914-081004/repair-lifecycle-transactional-rehearsal
```

قبل التطبيق الدائم أُنشئ ملف رجوع صريح مقيد برمز Staging ويرفض العمل إذا وُجد أي سجل معالجة. اختُبر داخل L3، فأزال الدوال والجداول دون `CASCADE` مع بقاء بيانات الأعمال كما هي. حُفظ الدليل في:

```text
/backups/staging/inventory-repair-before-20260914-081004/repair-lifecycle-explicit-rollback-rehearsal
```

أكد `dry-run` الرسمي أن `20260913234500_inventory_reconciliation_repair_lifecycle.sql` هو الترحيل الوحيد المنتظر، دون seeds أو roles. بعد الاعتماد طُبق هذا الملف وحده على Staging، ثم نجح تحقق مستقل أثبت:

- تسجيل الإصدار ووجود الجداول الأربعة والدوال الست العامة.
- تفعيل RLS ومنع DML المباشر ومنع `anon` من تنفيذ RPC.
- إخفاء الدوال الداخلية عن `authenticated`.
- بقاء جداول المعالجة الأربعة فارغة بعد التطبيق.
- تطابق أعداد وبصمات بيانات الأعمال وبصمة التشخيص وحالته `rounding_only` مع النسخة السابقة.
- عدم تعديل Farida أو Alibea.

حُفظ دليل التطبيق والتحقق منه في:

```text
/backups/staging/inventory-repair-before-20260914-081004/repair-lifecycle-post-apply
```

بهذا اكتملت بوابة قاعدة البيانات للمرحلة 2B على Staging. بُنيت بعد ذلك قائمة سجل مستقلة للقراءة على المسار `/reports/inventory-reconciliation/repairs`، تشمل البحث بالرقم أو العنوان وفلتر الحالة والترقيم الخادمي والربط من شاشة التشخيص، ولا تستدعي أي RPC كتابة أو تنفيذ. اجتازت فحص الأنواع والبناء وESLint و`588` اختبارًا، ثم نُشرت على Staging فقط بعد حفظ نسخة الرجوع `/opt/backups/accounting-app/staging-inventory-repair-registry-before-20260914-090014`. تطابقت بصمة `index.html` المنشور مع البناء (`34e85ae3f7fa96988488d58588fa8ee84d395f89a31e197f32bf41bb7ff22201`)، وأعادت الصفحة والمسارات المباشرة والأصل الرئيسي الحالة `200`، وبقيت ملفات Farida وAlibea دون تغيير. أكد المستخدم ظهور الصفحة، فاعتُمدت القائمة بصريًا.

بُنيت بعدها شاشة تفاصيل للقراءة على المسار `/reports/inventory-reconciliation/repairs/:id`، ويفتحها صف السجل. تعرض الرأس والحالة والإصدار ولقطة التشخيص والبنود والحالة قبل/المقترحة وسجل الأحداث وآثار التنفيذ، مع روابط للسجلات المعروفة. لا تحتوي استدعاءات إنشاء أو تعديل أو اعتماد أو تنفيذ. اجتازت فحص الأنواع وESLint والبناء و`592` اختبارًا، ثم نُشرت على Staging فقط بعد حفظ نسخة الرجوع `/opt/backups/accounting-app/staging-inventory-repair-detail-before-20260914-092703`. تطابقت بصمة `index.html` المنشور مع البناء (`e9fd7b60b9191f4369ffb65dffe7aaca1b1debf9cd4f6f455a2bb90d3098b`)، وأعادت مسارات السجل والتفاصيل المباشرة والأصل الرئيسي الحالة `200`، وبقيت ملفات Farida وAlibea دون تغيير. أكد المستخدم أن المعرّف غير الموجود يعرض حالة الفراغ الآمنة دون كشف الفرق بين غياب السجل ومنع الصلاحية. بقي اختبار الرأس والبنود والأحداث الفعلية مع أول مسودة في الدفعة التالية، مع إبقاء التنفيذ الفعلي محجوبًا حتى المرحلة 2C.

أُعدت بعدها واجهة إنشاء أول مسودة من صف التشخيص نفسه. لا يظهر إجراء «إعداد مسودة» إلا عندما تعيد دالة التشخيص `can_prepare_repair=true`، ويُشتق نوع المعالجة آليًا من التصنيف دون اختيار يدوي. يطلب النموذج عنوانًا وسببًا، ويرسل بصمة التشخيص ووقت اللقطة ونطاق المصدر وبندًا واحدًا إلى `create_inventory_reconciliation_repair` مع `request_id` ثابت للمحاولة وإعادتها. لا تستدعي هذه الدفعة التعديل أو الإرسال للمراجعة أو الاعتماد أو التنفيذ، ولا تكتب مباشرة في أي جدول. اجتازت فحص الأنواع والبناء وESLint و`597` اختبارًا، ودُفعت في الالتزام `9c12f26` ثم نُشرت على Staging فقط بعد حفظ نسخة الرجوع `/opt/backups/accounting-app/staging-inventory-repair-draft-before-20260914-134944`. كشف الاختبار الأول أن مفتاح `sb_publishable` المأخوذ من الحزمة السابقة يعيد `401 Invalid API key`؛ فأعيدت نسخة الرجوع فورًا وتأكد تطابق بصمتها وعدم تغير الإنتاج. اختُبر مفتاح `anon JWT` العام من الحزمة السابقة وأعاد `200`، ثم أعيد البناء والنشر به. تطابقت بصمة `index.html` المصحح مع البناء (`88bab8ba20f7d9e0113bac4285f90c68dc7a0d0b480036cc5435f10e31c424e1`)، وقدمت الواجهة الأصل `assets/index-DUBcVR__.js`، وأعادت المسارات الأربعة وREST API الحالة `200`. بقيت بصمتا واجهتي Farida وAlibea دون تغيير، ولم تُطبق Migration أو Edge Function. أنشأ المستخدم `IR-0001` لفاتورة الشراء `PUR-0024` بنجاح. أثبت فاحص Staging داخل معاملة قراءة فقط وجود مسودة واحدة وبند واحد وحدث إنشاء واحد وصفر آثار تنفيذ، وتطابق أعداد وبصمات المنتجات والحركات والفواتير والقيود والتشخيص مع خط الأساس. حُفظ التقرير واستعلامه مع بصماتهما في `/opt/backups/accounting-app/staging-inventory-repair-draft-before-20260914-134944/first-draft-verification`، وبذلك اعتُمد إنشاء المسودة وتفاصيلها وظيفيًا دون أي إصلاح أو ترحيل للأعمال.

بُنيت محليًا بعدها دفعة تعديل المسودة فقط. يظهر الإجراء عندما تكون الحالة `draft`، ويعيد إرسال البنود المقروءة دون تغيير هويتها عبر `update_inventory_reconciliation_repair` مع `expected_version` و`request_id` ثابت للمحاولة. يسمح النموذج بتعديل العنوان والسبب فقط، ويرفض الحفظ دون تغيير فعلي حتى لا ينشئ إصدارًا وحدثًا بلا معنى. تتولى قاعدة البيانات رفض تغير الحالة أو الإصدار أو التشخيص. لا تستدعي الدفعة الإرسال للمراجعة أو الاعتماد أو التنفيذ ولا تنفذ DML مباشرًا. اجتازت فحص الأنواع وESLint والبناء و`601` اختبارًا؛ ولم تُدفع أو تُنشر بعد، ولم تتغير Staging أو قواعد الإنتاج بسببها.
