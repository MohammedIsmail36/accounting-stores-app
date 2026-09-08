# دليل النشر المعتمد

هذا هو **دليل النشر التشغيلي الوحيد** للمشروع. يخص نسختي الإنتاج المنفصلتين:

- Farida: `farida.alibea2020.com`
- Alibea: `alibea.alibea2020.com`

كل نسخة تخدم شركة واحدة ولها قاعدة بيانات وواجهة منفصلتان. وجود النسختين على الخادم نفسه لا يجعل التطبيق متعدد الشركات داخل الجلسة الواحدة.

## نقطة التنفيذ الرسمية

السكربت المعتمد هو:

```bash
scripts/deploy-all.sh
```

أُزيل السكربت الانتقالي القديم `scripts/update-everything.sh` من المسار التشغيلي؛ ملخصه محفوظ في الأرشيف. لا تستخدم أدلة الأرشيف لتنفيذ نشر جديد.

## متطلبات الجلسة

نفّذ الأوامر من نسخة العمل التشغيلية:

```bash
cd /opt/accounting-app
```

حمّل مفاتيح الواجهة العامة من مصدر محمي خارج Git، ثم تحقق من وجودها **من دون طباعة قيمها**:

```bash
: "${FARIDA_SUPABASE_PUBLISHABLE_KEY:?متغير Farida غير مضبوط}"
: "${ALIBEA_SUPABASE_PUBLISHABLE_KEY:?متغير Alibea غير مضبوط}"
```

ممنوع وضع `service_role` في متغيرات `VITE_*` أو في ملفات الواجهة. قيم `VITE_*` تدخل في حزمة المتصفح، ولذلك لا يجوز استخدامها لأي سر خادمي.

## فحص ما قبل النشر

ابدأ بفحص المستودع ثم نفّذ بناءً تجريبياً لا يغير ملفات المواقع أو قواعد البيانات أو Edge Functions:

```bash
git status --short
bash scripts/check-repository-safety.sh
./scripts/deploy-all.sh --dry-run --only farida
./scripts/deploy-all.sh --dry-run --only alibea
```

يجب معالجة أي تعارض Git أو فشل بناء قبل الانتقال إلى الإنتاج. الوضع `--dry-run` قد يعيد تثبيت الحزم ويبني الواجهة محلياً، لكنه لا ينشرها.

## النشر الإنتاجي المعتاد

انشر كل نسخة وحدها حتى يمكن اختبارها قبل الانتقال إلى الأخرى:

```bash
./scripts/deploy-all.sh --only farida
```

بعد نجاح Farida وفحص الدخول والشاشة التي تغيرت، انشر Alibea:

```bash
./scripts/deploy-all.sh --only alibea
```

السكربت مسؤول عن:

1. حفظ تعديلات العمل المحلية مؤقتاً عند وجودها، ثم سحب التحديثات وإعادة تطبيقها.
2. تطبيق ملفات `supabase/migrations` على قاعدة الشركة المحددة.
3. نسخ Edge Functions والتحقق من الملفات الأساسية ثم إعادة تشغيل خدمتها.
4. تشغيل `npm ci` والبناء باستخدام عنوان API الصحيح للشركة.
5. تثبيت صلاحيات الأصول الثابتة (755 للمجلدات و644 للملفات)، ثم نشر `dist` بواسطة `rsync --delete-delay --delay-updates`.
6. مقارنة البناء المنشور محلياً والتحقق من أن النطاق يقدم ملف JavaScript المتوقع.

يفضل دائماً أن تكون نسخة العمل نظيفة قبل النشر، حتى مع وجود آلية `stash` في السكربت.

## نشر Staging الثابت يدوياً

لا يدعم `scripts/deploy-all.sh` نطاق Staging، ولا يجوز تمرير Staging إليه كأنها شركة إنتاج. عند نشر بناء متحقق منه يدوياً إلى `/var/www/staging.alibea2020.com` يجب تنفيذ حاجز الصلاحيات التالي قبل `rsync`:

```bash
STAGING_BUILD_DIR=/tmp/accounting-staging-build.EXAMPLE
find "$STAGING_BUILD_DIR" -type d -exec chmod 0755 {} +
find "$STAGING_BUILD_DIR" -type f -exec chmod 0644 {} +
test "$(stat -c '%a' "$STAGING_BUILD_DIR")" = "755"
rsync -a --delete-delay --delay-updates "$STAGING_BUILD_DIR/" /var/www/staging.alibea2020.com/
chmod 0755 /var/www/staging.alibea2020.com
test "$(stat -c '%a' /var/www/staging.alibea2020.com)" = "755"
```

هذه قاعدة إلزامية: **ممنوع تشغيل `rsync -a` من مجلد أنشأه `mktemp -d` قبل تطبيع الصلاحيات**. وضع `mktemp` الافتراضي `0700`، و`rsync -a` قد ينسخه إلى جذر الموقع فيمنع مستخدم Nginx من عبور المجلد ويعيد HTTP 403. سكربت الإنتاج يطبق التطبيع آلياً بالفعل؛ هذه الخطوات تغطي نشر Staging اليدوي حتى إعداد سكربت مخصص لها.

بعد النسخ يجب مقارنة البناء والوجهة، وفحص `/` و`/auth` والمسار المتغير عبر HTTPS، ثم التأكد من أن Nginx وDocker نشطان. نشر الواجهة الثابتة إلى Staging لا يبرر تطبيق migrations أو نسخ Edge Functions.

## خيارات معتمدة

```bash
./scripts/deploy-all.sh --only farida
./scripts/deploy-all.sh --only alibea
./scripts/deploy-all.sh --no-pull --only farida
./scripts/deploy-all.sh --skip-db --only farida
./scripts/deploy-all.sh --skip-functions --only farida
./scripts/deploy-all.sh --baseline-db --only farida
./scripts/deploy-all.sh --dry-run --only farida
```

- `--no-pull`: يستخدم النسخة المحلية الحالية من الكود.
- `--skip-db`: لا يطبق migrations؛ لا تستخدمه عندما يحتوي الإصدار على تغيير لقاعدة البيانات.
- `--skip-functions`: لا ينشر Edge Functions.
- `--baseline-db`: إجراء تأسيسي مرة واحدة فقط لقاعدة قائمة بلا سجل migrations؛ ليس خيار نشر دوري.
- `--dry-run`: يفحص الإعداد والبناء دون تغيير الإنتاج.

## التحقق بعد كل شركة

بعد كل نشر:

1. افتح النطاق الصحيح ونفّذ تحديثاً إجبارياً للمتصفح.
2. تحقق من تسجيل الدخول والصلاحيات.
3. اختبر الشاشة أو العملية التي تغيرت.
4. افتح أدوات المتصفح وتأكد من عدم وجود أخطاء API أو تحميل ملفات.
5. لا تنتقل إلى الشركة الثانية إذا فشل أي تحقق.

## حدود الأمان الحالية

- نشر ملفات الواجهة يفرض صلاحيات قراءة Nginx ويستخدم `rsync --delete-delay --delay-updates` لمنع ظهور نسخ جزئية أو حذف الأصول القديمة قبل اكتمال النقل، لكنه لا ينشئ إصداراً سابقاً مستقلاً للرجوع التلقائي.
- نشر Edge Functions يستبدل الملفات ثم يعيد تشغيل الخدمة، ولا يملك حالياً آلية إصدارات ذرية.
- migrations تنفذ قبل نشر الواجهة ولا يطبق عليها رجوع آلي.
- لذلك لا تستخدم أمر النشر المزدوج غير المقيد في تغيير مرتفع الخطورة؛ التزم بالنشر المتتابع `--only` وبالتحقق بين الشركتين.

سيكون تحصين الإصدارات والرجوع التلقائي مرحلة مستقلة قبل اعتبار النشر ذرياً بالكامل.

## عند الفشل

- توقف ولا تنتقل إلى الشركة الثانية.
- احتفظ بنص الخطأ كاملاً من دون نشر مفاتيح أو أسرار.
- افحص:

```bash
git status --short
git log -1 --oneline
sudo nginx -t
```

- لا تشغل `rm -rf` داخل `/var/www`، ولا تستبدل قاعدة البيانات يدوياً، ولا تستخدم لقطات SQL الموجودة في `docs/archive/sql` كبديل عن migrations.
- الرجوع إلى كود سابق لا يعني تلقائياً رجوع بنية قاعدة البيانات؛ يجب تقييم migration الذي نُفذ أولاً.

## الأدلة التاريخية

المواد التالية محفوظة للرجوع التاريخي فقط ولا تمثل خطوات التشغيل الحالية:

- `docs/archive/deployment/PRODUCTION_DEPLOY_GUIDE.md`
- `docs/archive/deployment/MULTI_COMPANY_DEPLOY.md`
- `docs/archive/runbooks/NODE22_HOST_UPGRADE_RUNBOOK.md`
- `docs/archive/runbooks/UPDATE_EVERYTHING_2026-09.md`
