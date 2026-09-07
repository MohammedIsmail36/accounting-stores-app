> **سجل مهمة مكتملة ومؤرشفة:** تمت ترقية المضيف، ولا يعاد تنفيذ هذه الخطوات كجزء من النشر. راجع [`../../DEPLOYMENT_WORKFLOW.md`](../../DEPLOYMENT_WORKFLOW.md) للتشغيل الحالي.

# خطة ترقية Node.js على الخادم إلى الإصدار 22

آخر مراجعة: 2026-09-06

## الهدف والنطاق

ترقية أداة البناء على الخادم من Node.js `18.20.8` إلى فرع Node.js 22 المدعوم، من دون نشر واجهة جديدة أو إعادة تشغيل Nginx أو Docker أو قواعد البيانات. واجهات Farida وAlibea وStaging ملفات ثابتة يقدمها Nginx، وخدمات Supabase تعمل داخل حاويات معزولة عن `/usr/bin/node`.

الإصدار المرشح وقت إعداد الخطة هو `22.23.2-1nodesource1`. اجتاز المشروع مسبقاً تحت Node.js `22.23.2`: تثبيتاً نظيفاً، وفحص TypeScript، و47 ملف اختبار/540 اختباراً، وبناء Vite كاملاً داخل حاوية معزولة.

المصادر الرسمية:

- [حالة إصدارات Node.js ودعم LTS](https://nodejs.org/en/about/previous-releases)
- [أرشيف Node.js 22](https://nodejs.org/en/download/archive/v22)
- [تعليمات NodeSource الرسمية لتوزيعات Debian وUbuntu](https://github.com/nodesource/distributions/blob/master/DEV_README.md)
- [سكربت إعداد NodeSource لفرع 22](https://github.com/nodesource/distributions/blob/master/scripts/deb/setup_22.x)

## الحالة المرجعية قبل التنفيذ

- النظام: Ubuntu `22.04.5 LTS`، معمارية `x86_64`.
- Node.js: `18.20.8-1nodesource1` من `https://deb.nodesource.com/node_18.x`.
- npm: `10.8.2`، والحزمتان العالميتان فقط `npm` و`corepack`.
- لا توجد خدمة systemd للتطبيق تستخدم Node المضيف.
- Nginx وDocker في حالة `active/enabled` ومن دون إعادة تشغيل مسجلة وقت التدقيق.
- أصول الإنتاج المرجعية:
  - Farida: `/assets/index-C5crkh7N.js`
  - Alibea: `/assets/index-CAQrkerV.js`
  - Staging: `/assets/index-CRCDPZxh.js`
- القرص المتاح نحو `119 GiB`. ملف Swap بسعة `2 GiB` ممتلئ لكنه غير نشط وقت القياس؛ لا يُنفذ `swapoff` أثناء الترقية.

## قواعد إلزامية

1. تُنفذ كل مرحلة منفصلة، وتُراجع نتيجتها قبل الانتقال إلى التالية.
2. لا يُستخدم `curl | bash`. يُنزّل سكربت NodeSource إلى ملف، وتُراجع بصمته ومحتواه أولاً.
3. لا يُنفذ `npm audit fix` أو `npm audit fix --force` ضمن ترقية Node.
4. لا يُنشر أي بناء على Farida أو Alibea أو Staging ضمن هذه الخطة.
5. لا تُعاد خدمات Nginx أو Docker أو Supabase؛ الترقية تخص أداة البناء على المضيف فقط.
6. لا تبدأ الترقية أثناء وجود بناء أو نشر آخر، ويجب أن يكون Git نظيفاً ومتزامناً.

## المرحلة A — تجهيز رجوع محلي قبل التعديل

تنشأ حافظة جديدة بصلاحية `0700` داخل:

`/opt/backups/accounting-app/node22-host-upgrade-YYYYMMDD-HHMMSS`

وتحفظ فيها قبل أي تعديل:

- `/etc/apt/sources.list.d/nodesource.list`
- `/usr/share/keyrings/nodesource.gpg`
- أي ملف NodeSource داخل `/etc/apt/preferences.d/`
- نتيجة `dpkg-query` لإصدار `nodejs`، ونتيجة `node --version` و`npm --version` والحزم العالمية.
- بصمات ملفات `index.html` والأصول الرئيسية للبيئات الثلاث.
- حزمة الرجوع المحلية `nodejs_18.20.8-1nodesource1_amd64.deb` عبر `apt-get download`، ثم فحصها بـ`dpkg-deb --info` وSHA-256.

بوابة التوقف: لا يبدأ تعديل المستودع البرمجي ما لم توجد حزمة Node 18 المحلية وتنجح قراءتها وتتوافر نسخة ملفات المصدر والمفتاح وبصماتها.

تُنفذ الأوامر التالية خطوةً خطوة بعد استبدال وقت الحافظة بقيمة فعلية؛ لا تُلصق المراحل كلها ككتلة واحدة:

```bash
NODE22_BACKUP_DIR=/opt/backups/accounting-app/node22-host-upgrade-YYYYMMDD-HHMMSS
sudo install -d -o deploy -g deploy -m 0700 "$NODE22_BACKUP_DIR"
cp -a /etc/apt/sources.list.d/nodesource.list "$NODE22_BACKUP_DIR/nodesource.list.before"
cp -a /usr/share/keyrings/nodesource.gpg "$NODE22_BACKUP_DIR/nodesource.gpg.before"
cp -a /etc/apt/preferences.d "$NODE22_BACKUP_DIR/apt-preferences.d.before"
dpkg-query -W -f='${Package}\t${Version}\t${Status}\n' nodejs > "$NODE22_BACKUP_DIR/nodejs-package.before.txt"
node --version > "$NODE22_BACKUP_DIR/node.before.txt"
npm --version > "$NODE22_BACKUP_DIR/npm.before.txt"
npm list --global --depth=0 > "$NODE22_BACKUP_DIR/npm-globals.before.txt"
sha256sum \
  /var/www/farida/index.html /var/www/farida/assets/index-C5crkh7N.js \
  /var/www/alibea/index.html /var/www/alibea/assets/index-CAQrkerV.js \
  /var/www/staging.alibea2020.com/index.html /var/www/staging.alibea2020.com/assets/index-CRCDPZxh.js \
  > "$NODE22_BACKUP_DIR/production-assets.before.sha256"
(cd "$NODE22_BACKUP_DIR" && apt-get download nodejs=18.20.8-1nodesource1)
dpkg-deb --info "$NODE22_BACKUP_DIR/nodejs_18.20.8-1nodesource1_amd64.deb"
sha256sum "$NODE22_BACKUP_DIR/nodejs_18.20.8-1nodesource1_amd64.deb" \
  > "$NODE22_BACKUP_DIR/nodejs-18-package.sha256"
sha256sum -c "$NODE22_BACKUP_DIR/nodejs-18-package.sha256"
```

عند فتح جلسة SSH جديدة يجب تعريف `NODE22_BACKUP_DIR` مجدداً بالمسار الفعلي نفسه، ثم تنفيذ `test -d "$NODE22_BACKUP_DIR"` قبل أي أمر في المراحل اللاحقة. لا يجوز ترك `YYYYMMDD-HHMMSS` كما هو أثناء التنفيذ.

## المرحلة B — تجهيز مصدر Node 22 دون تثبيت

1. تنزيل `https://deb.nodesource.com/setup_22.x` إلى ملف داخل حافظة الرجوع.
2. تسجيل SHA-256 ومراجعة أن السكربت يحدد `NODE_VERSION="22.x"` ويستخدم `deb.nodesource.com/node_22.x` ومفتاح `/usr/share/keyrings/nodesource.gpg`.
3. تشغيل سكربت الإعداد الرسمي بعد المراجعة؛ هذه الخطوة تغير مصدر APT والمفتاح فقط ولا تثبت Node الجديد.
4. تشغيل `apt-cache policy nodejs` والتحقق أن المثبت ما زال `18.20.8-1nodesource1` وأن المرشح من فرع 22. وقت إعداد الخطة كان المرشح `22.23.2-1nodesource1`.

بوابة التوقف: إذا لم يكن المرشح `22.x` أو ظهر مصدر غير NodeSource، تُستعاد ملفات APT المحفوظة ولا ينفذ التثبيت.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x \
  -o "$NODE22_BACKUP_DIR/nodesource-setup-22.x.sh"
sha256sum "$NODE22_BACKUP_DIR/nodesource-setup-22.x.sh" \
  > "$NODE22_BACKUP_DIR/nodesource-setup-22.x.sha256"
rg -n 'NODE_VERSION="22.x"|deb.nodesource.com/node_\$node_version|nodesource.gpg' \
  "$NODE22_BACKUP_DIR/nodesource-setup-22.x.sh"
sudo -E bash "$NODE22_BACKUP_DIR/nodesource-setup-22.x.sh"
apt-cache policy nodejs
node --version
```

يجب أن يبقى `node --version` هنا على `v18.20.8` لأن هذه المرحلة تجهز المصدر فقط.

## المرحلة C — تثبيت Node 22

تنفيذ ترقية حزمة `nodejs` وحدها بواسطة APT، ثم التحقق مباشرة من:

- `node --version` يبدأ بـ`v22.`.
- `npm --version` يعمل.
- `command -v node` يظل `/usr/bin/node`.
- لا توجد حزم مكسورة في `dpkg --audit`.
- Nginx وDocker ما زالا `active`، ولم تتغير أصول النطاقات الثلاثة.

لا تُعاد أي خدمة لأن الواجهات ثابتة والحاويات تستخدم runtimes داخلية مستقلة.

```bash
sudo apt-get install --only-upgrade -y nodejs
node --version
npm --version
command -v node
dpkg --audit
systemctl is-active nginx docker
sha256sum -c "$NODE22_BACKUP_DIR/production-assets.before.sha256"
```

## المرحلة D — تحقق المشروع باستخدام Node المضيف الجديد

من نسخة مؤقتة نظيفة خارج مجلد الإنتاج، مع استبعاد `.git` و`node_modules` و`dist` وملفات `.env` واستخدام قيم بيئة وهمية:

1. `npm ci`
2. `npm run type-check`
3. `npm test`
4. `npm run build`

شروط النجاح: 47 ملف اختبار/540 اختباراً على الأقل، نجاح TypeScript والبناء، وعدم تعديل `package.json` أو`package-lock.json`. يُحذف مجلد التحقق المؤقت بعد تسجيل النتيجة.

```bash
test ! -e /tmp/accounting-node22-host-validation
install -d -m 0755 /tmp/accounting-node22-host-validation
rsync -a \
  --exclude='.git' --exclude='node_modules' --exclude='dist' \
  --exclude='.env' --exclude='.env.*' \
  /opt/accounting-app/ /tmp/accounting-node22-host-validation/
cd /tmp/accounting-node22-host-validation
npm ci
npm run type-check
export VITE_SUPABASE_URL=https://node22-validation.invalid
export VITE_SUPABASE_PUBLISHABLE_KEY=node22-validation
npm test
npm run build
unset VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY
cd /opt/accounting-app
rm -rf /tmp/accounting-node22-host-validation
git status --short
```

## المرحلة E — تحقق الخادم بعد الترقية

- التأكد أن Nginx وDocker `active` وأن الحاويات ما زالت عاملة.
- التأكد أن Farida وAlibea وStaging تعيد HTTP 200 وتقدم الأصول المرجعية نفسها.
- قياس الذاكرة و`vmstat` والتأكد من عدم وجود تبديل Swap نشط أو OOM جديد.
- تشغيل `git status --short` والتأكد أن المستودع نظيف.
- توثيق الإصدار الجديد والبصمات والاختبارات دون نشر أي واجهة.

```bash
systemctl is-active nginx docker
docker ps --format 'table {{.Names}}\t{{.Status}}'
curl -fsS -o /dev/null -w 'Farida %{http_code}\n' https://farida.alibea2020.com/
curl -fsS -o /dev/null -w 'Alibea %{http_code}\n' https://alibea.alibea2020.com/
curl -fsS -o /dev/null -w 'Staging %{http_code}\n' https://staging.alibea2020.com/
sha256sum -c "$NODE22_BACKUP_DIR/production-assets.before.sha256"
free -h
vmstat 1 5
git -C /opt/accounting-app status --short
```

## خطة الرجوع

يبدأ الرجوع فوراً إذا فشل Node أو npm، أو فشل التثبيت النظيف أو TypeScript أو الاختبارات أو البناء، أو تغيرت حالة الخدمات بصورة غير متوقعة.

1. استعادة ملفات NodeSource والمفتاح وتفضيلات APT من حافظة الرجوع.
2. تحديث فهرس APT.
3. تثبيت حزمة الرجوع المحلية `nodejs_18.20.8-1nodesource1_amd64.deb` مع السماح بالرجوع إلى إصدار أقدم.
4. التحقق من `node --version` و`npm --version`، ثم فحص Nginx وDocker والنطاقات الثلاثة.
5. عدم حذف حافظة الرجوع حتى اعتماد Node 22 وتشغيل أول بناء اعتيادي ناجح لاحقاً.

أوامر الرجوع، باستخدام الحافظة نفسها التي أنشئت في المرحلة A:

```bash
sudo rm -f /etc/apt/sources.list.d/nodesource.sources
sudo install -o root -g root -m 0644 \
  "$NODE22_BACKUP_DIR/nodesource.list.before" \
  /etc/apt/sources.list.d/nodesource.list
sudo install -o root -g root -m 0644 \
  "$NODE22_BACKUP_DIR/nodesource.gpg.before" \
  /usr/share/keyrings/nodesource.gpg
sudo rm -f /etc/apt/preferences.d/nodejs /etc/apt/preferences.d/nsolid
sudo cp -a "$NODE22_BACKUP_DIR/apt-preferences.d.before/." /etc/apt/preferences.d/
sudo apt-get update
sudo apt-get install --allow-downgrades -y \
  "$NODE22_BACKUP_DIR/nodejs_18.20.8-1nodesource1_amd64.deb"
node --version
npm --version
systemctl is-active nginx docker
sha256sum -c "$NODE22_BACKUP_DIR/production-assets.before.sha256"
```

حتى عند فشل الترقية، تظل الواجهات المنشورة تعمل لأن ملفاتها موجودة مسبقاً ويقدمها Nginx ولا تحتاج Node في وقت التشغيل.

## الحالة

- الخطة: جاهزة.
- المرحلة A: مكتملة ومتحقق منها في 2026-09-06.
- حافظة الرجوع: `/opt/backups/accounting-app/node22-host-upgrade-20260906-132413` بصلاحية `0700` وملكية `deploy:deploy`.
- حزمة الرجوع: `nodejs_18.20.8-1nodesource1_amd64.deb`، حجمها `29,654,864` بايت وبصمة SHA-256 هي `e91d56bef792c48bb1ca9212ec44d480f9b3998e88f83451e314ff62606b55d7`؛ نجح `dpkg-deb --info` وفحص البصمة.
- نُسخت إعدادات NodeSource ومفتاحه وتفضيلات APT وحالة الحاويات والخدمات والحزم العالمية وبصمات أصول البيئات الثلاث. طابقت الأصول الستة قيم ما قبل التنفيذ.
- Node المضيف بعد المرحلة A: `v18.20.8` وnpm `10.8.2`؛ لم يتغير مصدر APT أو المفتاح أو أي خدمة أو ملف إنتاج.
- المرحلة B: مكتملة ومتحقق منها في 2026-09-06.
- حُفظ سكربت NodeSource الرسمي داخل حافظة الرجوع بصلاحية قراءة/تنفيذ للمالك وبصمة SHA-256 `575583bbac2fccc0b5edd0dbc03e222d9f9dc8d724da996d22754d6411104fd1`. نجح `bash -n` وثبت استهدافه `NODE_VERSION="22.x"` ومستودع ومفتاح NodeSource المتوقعين قبل تشغيله.
- أصبح مصدر APT الفعلي `/etc/apt/sources.list.d/nodesource.sources` يشير حصراً إلى `https://deb.nodesource.com/node_22.x` للمعمارية `amd64`، واختفى ملف `.list` القديم وفق سلوك السكربت الرسمي. بقيت بصمة مفتاح NodeSource `7a96b125f721c99e07d3f45b279adbd6884ec4f3f06750f6b54df40cfae36836` مطابقة لما قبل الإعداد.
- يعرض APT الإصدار المثبت `18.20.8-1nodesource1` والمرشح `22.23.2-1nodesource1`. ظل التنفيذ الفعلي `node v18.20.8` وnpm `10.8.2`، ولم يسجل APT تثبيتاً أو ترقية لحزمة أثناء إعداد المصدر.
- بقي Nginx وDocker `active`، واجتازت بصمات أصول Farida وAlibea وStaging الستة الفحص. ظهرت 23 ترقية نظام عامة متاحة وتحذير مستقل بأن مفتاح مستودع Docker ما زال في `trusted.gpg` القديم؛ لم تُطبق تلك الترقيات ولم يُعدل مفتاح Docker ضمن ترقية Node.
- المرحلة C: مكتملة ومتحقق منها في 2026-09-06. رقّى APT حزمة `nodejs` وحدها من `18.20.8-1nodesource1` إلى `22.23.2-1nodesource1`، ويعمل الآن Node `v22.23.2` وnpm `10.9.8` من `/usr/bin/node`، ولم يعرض `dpkg --audit` مشكلة.
- انحراف تنفيذي موثق: شغّل `needrestart` تلقائياً Nginx وعدداً من خدمات النظام بسبب عمليات كانت تحمل مكتبات قديمة، رغم أن الخطة لم تطلب إعادة خدمات. أُجل Docker نفسه ولم تُعد الحاويات؛ أظهر سجل APT أن الحزمة الوحيدة التي رُقيت هي `nodejs`.
- نجح فحص Nginx الذي ينفذه systemd قبل التشغيل بحالة `0/SUCCESS` وعادت الخدمة `active` عند `13:38:39 UTC`. بقي Docker `active` منذ تشغيله السابق، ولم توجد وحدات systemd فاشلة، وظلت جميع حاويات الشركتين عاملة وذات حالات الصحة السابقة.
- أعادت Farida وAlibea وStaging HTTP 200، واجتازت بصمات أصول الإنتاج الستة الفحص. بقي Swap بلا إدخال أو إخراج نشط في قياس `vmstat` بعد التثبيت.
- حُذفت ملفات فحص NodeSource و`npm audit` المؤقتة من `/tmp` بعد حفظ النتائج اللازمة في الوثائق، وبقيت حافظة الرجوع الدائمة وحدها في المسار المعتمد.
- المرحلة D: مكتملة ومتحقق منها في 2026-09-06 من النسخة المؤقتة `/tmp/accounting-node22-host-validation-20260906-134313`. نجح `npm ci` وفحص TypeScript، ثم نجح 47 ملف اختبار/540 اختباراً، ونجح بناء Vite بخروج `0` خلال `41.99s` بعد تحويل `3935` وحدة.
- ملاحظة تنفيذية للمرحلة D: المحاولة الأولى شغلت قيم Supabase الوهمية مع أمر البناء فقط، لذلك اجتازت 40 مجموعة/474 اختباراً وتوقفت 7 مجموعات برسالة `supabaseUrl is required`. لم يكن ذلك عيب توافق في Node؛ أُعيد الاختبار بعد تصدير القيم الوهمية لأوامر الاختبار والبناء فنجحت جميع الاختبارات والبناء. صُححت أوامر هذا الدليل لمنع تكرار السهو.
- لم يتغير `package.json` أو `package-lock.json`، ولم يُنشر البناء التجريبي. اجتازت أصول Farida وAlibea وStaging الستة مقارنة بصمات ما قبل الترقية، وبقي Nginx وDocker والحاويات عاملة، وأعادت النطاقات الثلاثة HTTP 200، ولم يسجل `vmstat` إدخالاً أو إخراجاً نشطاً للـSwap. حُذف مجلد الاختبار المؤقت بعد التحقق.
- المرحلة E: مكتملة ومتحقق منها في 2026-09-06. ظل Node `v22.23.2` وnpm `10.9.8` من `/usr/bin/node`، وتطابق إصدار APT المثبت والمرشح `22.23.2-1nodesource1` ولم يعرض `dpkg --audit` أخطاء.
- كان Nginx وDocker بحالة `active`، ولم توجد وحدات systemd فاشلة، وكانت نتيجة تشغيل Nginx `success`. ظلت جميع حاويات Farida وAlibea عاملة، وجميع قيم `OOMKilled` لها `false`.
- أعادت Farida وAlibea وStaging HTTP 200 في القياس الختامي، واجتازت الأصول الستة مقارنة بصمات ما قبل الترقية. توفر نحو `2.6 GiB` من الذاكرة، ورغم بقاء Swap مملوءاً من نشاط سابق لم يسجل `vmstat` أي `si/so` خلال خمس قراءات.
- أثبت فحص سجل النواة بصلاحية `sudo` عدم وجود أي حدث `out of memory` أو `oom-killer` أو `killed process` منذ `2026-09-06 13:38:00 UTC`؛ كانت النتيجة `-- No entries --`.
- لم يتحقق أي شرط يستدعي الرجوع إلى Node 18. اعتُمد Node 22 للمضيف وأُغلقت S3-2، مع الإبقاء على حافظة الرجوع المحلية وعدم حذفها حتى نجاح أول بناء ونشر اعتيادي لاحق وفق الخطة.
