# دليل تشغيل المشروع محليًا — Windows وWSL2

هذا الدليل يشغّل الواجهة وقاعدة Supabase محلية مستقلة. لا تستخدم أي عنوان أو مفتاح أو نسخة بيانات تخص Staging أو Farida أو Alibea أثناء الإعداد المحلي.

> حالة الاعتماد: نجح تثبيت الحزم وTypeScript و565 اختبارًا والبناء على Node `22.23.2`. اختُبر npm بالإصدارين `10.9.8` و`12.0.2`. يجب اجتياز تشغيل Supabase المحلي الكامل مرة واحدة قبل اعتبار مسار قاعدة البيانات المحلية معتمدًا نهائيًا.

## 1. المتطلبات

| المكوّن | النسخة المرجعية |
|---|---|
| Windows | 10 أو 11 بنظام 64-bit |
| WSL2 | Ubuntu 22.04 أو أحدث |
| Docker Desktop | إصدار يدعم WSL2 |
| Node.js | 22 LTS؛ النسخة المختبرة `22.23.2` |
| npm | من `10.9.0` إلى ما قبل `13`؛ النسختان المختبرتان `10.9.8` و`12.0.2` |
| Git | إصدار حديث |
| Supabase CLI | تُشغّل عبر `npx` بالنسخة `2.116.0`؛ لا يلزم تثبيت عالمي |

جميع أوامر Bash التالية تُنفذ داخل Ubuntu على WSL2.

## 2. تجهيز WSL2 وDocker

من PowerShell بصلاحية المدير:

```powershell
wsl --install
wsl --set-default-version 2
```

بعد تثبيت Docker Desktop، فعّل **Use WSL 2 based engine** ثم فعّل تكامل توزيعة Ubuntu من إعدادات Docker.

تحقق داخل WSL:

```bash
docker --version
docker compose version
node --version
npm --version
git --version
```

## 3. استنساخ المستودع النظيف

```bash
git clone https://github.com/YOUR_ORG/YOUR_REPO.git
cd YOUR_REPO
```

استبدل عنوان المثال بعنوان المستودع الجديد بعد إنشائه.

قبل إنشاء أي ملف بيئة، شغّل حواجز السلامة:

```bash
test ! -e .env
bash scripts/check-repository-safety.sh
npm ci
```

يجب أن يستخدم `npm ci` سجل npm الرسمي والإصدارات المثبتة في `package-lock.json`. لا تستخدم `npm install` لتجاوز lockfile، ولا تستخدم `npm audit fix --force`.

## 4. تشغيل Supabase محليًا

شغّل Docker Desktop أولًا، ثم من جذر المشروع:

```bash
npx -y supabase@2.116.0 start
```

يبدأ هذا الأمر خدمات Supabase المحلية ويطبق ملفات `supabase/migrations` على قاعدة جديدة. هذه الملفات هي مصدر بنية القاعدة؛ لا تستخدم لقطة `docs/archive/sql/full-schema-snapshot-2026-02.sql` المؤرشفة معها أو بدلاً منها.

اعرض بيانات البيئة المحلية:

```bash
npx -y supabase@2.116.0 status
```

انسخ **API URL** والمفتاح العام المحلي فقط إلى إعداد الواجهة. قد يعرض الأمر مفاتيح إدارية أيضًا؛ لا ترسل مخرجاته في محادثة ولا تحفظها في Git.

إذا فشل تطبيق migration، توقف عند أول خطأ واحتفظ باسم الملف ورسالة الخطأ فقط. لا تستخدم baseline ولا تعدّل سجل migrations يدويًا.

## 5. إعداد الواجهة

أنشئ `.env.local` في جذر المشروع. هذا الملف مستبعد من Git:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=PUT_LOCAL_ANON_KEY_HERE
VITE_APP_ENV=local
```

لا تضع `service_role` في أي متغير يبدأ بـ`VITE_`؛ متغيرات Vite تدخل حزمة المتصفح.

شغّل الواجهة:

```bash
npm run dev
```

العنوان الافتراضي هو `http://localhost:8080`.

## 6. تشغيل Edge Functions محليًا

أنشئ `supabase/.env.local` وضع فيه أسرار التطوير المحلية فقط:

```env
DEFAULT_ADMIN_EMAIL=admin.local@example.test
DEFAULT_ADMIN_PASSWORD=REPLACE_WITH_A_LONG_LOCAL_PASSWORD
```

شغّل الدوال في نافذة طرفية مستقلة:

```bash
npx -y supabase@2.116.0 functions serve --env-file supabase/.env.local --no-verify-jwt
```

خيار `--no-verify-jwt` مخصص لهذه البيئة المحلية فقط. لا تستخدمه في Staging أو الإنتاج.

على قاعدة محلية جديدة بلا مستخدمين، يمكن تهيئة النظام مرة واحدة:

```bash
curl -fsS -X POST http://127.0.0.1:54321/functions/v1/seed-system \
  -H "Content-Type: application/json"
```

بعدها سجّل الدخول بالبريد وكلمة المرور المحليين اللذين اخترتهما، ثم لا تشاركهما أو تنقلهما إلى أي بيئة أخرى.

> تحذير: الدالة المسماة `database-backup` ليست أداة نسخ احتياطي؛ هي عملية حذف وإعادة تهيئة. لا تستخدمها لإنشاء backup ولا تختبرها على بيانات مهمة.

## 7. بوابة التحقق قبل العمل

مع تشغيل Supabase ووجود `.env.local`:

```bash
npm run type-check
npm test -- --run
npm run build
```

الحد الأدنى المتوقع حاليًا:

- TypeScript بلا أخطاء.
- 50 ملف اختبار و565 اختبارًا ناجحًا.
- بناء Vite ناجح.

اختبر يدويًا بعد ذلك:

1. فتح `/auth` وتسجيل الدخول.
2. تحديث الصفحة والتأكد من استمرار الجلسة.
3. فتح تبويب ثانٍ والتأكد من مزامنة الجلسة.
4. تسجيل الخروج والتأكد من خروج التبويبين.
5. إنشاء مستند تجريبي داخل القاعدة المحلية فقط.

## 8. أوامر العمل اليومية

بدء الخدمات:

```bash
npx -y supabase@2.116.0 start
npm run dev
```

اعرض حالة Supabase:

```bash
npx -y supabase@2.116.0 status
```

أوقف البيئة المحلية مع إبقاء البيانات المحلية:

```bash
npx -y supabase@2.116.0 stop
```

إعادة بناء القاعدة المحلية من migrations عملية مدمرة للبيانات المحلية فقط:

```bash
npx -y supabase@2.116.0 db reset
```

لا تشغّل `db reset` إذا كان المشروع مرتبطًا بمشروع بعيد أو إذا كانت البيانات المحلية مطلوبة.

## 9. حل المشكلات

### Docker غير متاح داخل WSL

تأكد من تشغيل Docker Desktop وتفعيل WSL Integration لتوزيعة Ubuntu، ثم أعد فتح نافذة WSL.

### المنفذ مستخدم

اعرض الخدمات المحلية أولًا:

```bash
npx -y supabase@2.116.0 status
docker ps
```

لا توقف حاوية لا تخص هذا المشروع. عدّل منافذ `supabase/config.toml` في فرع مستقل إذا كان التعارض دائمًا.

### الواجهة لا تتصل بالقاعدة

تحقق من وجود القيم دون طباعتها:

```bash
test -s .env.local
npx -y supabase@2.116.0 status
```

أعد تشغيل `npm run dev` بعد تعديل ملف البيئة لأن Vite يقرأ المتغيرات عند البدء.

### تسجيل الدخول لا يعمل

تحقق من تشغيل Edge Functions ومن ضبط `DEFAULT_ADMIN_PASSWORD` في `supabase/.env.local`. لا تستبدل كلمة المرور بقيمة افتراضية معروفة.

## 10. الملفات المحلية المحظورة من Git

لا تضف أيًا من الآتي إلى المستودع:

- `.env` أو `.env.*`.
- `.npmrc` أو `.netrc`.
- مفاتيح `service_role` أو كلمات المرور أو التوكنات.
- `supabase/.temp`.
- نسخ قواعد البيانات وملفات dump.
- `node_modules` و`dist` و`coverage`.

قبل أي commit شغّل:

```bash
bash scripts/check-repository-safety.sh
git status --short
```

## 11. هيكل المشروع المختصر

```text
YOUR_REPO/
├── docs/                         # أدلة التشغيل والتوثيق والأرشيف
├── public/                       # الأصول العامة للواجهة فقط
├── scripts/                      # حواجز السلامة والنشر والترحيلات
├── src/                          # تطبيق React واختباراته
├── supabase/
│   ├── functions/               # Edge Functions
│   ├── migrations/              # المصدر المعتمد لتغييرات قاعدة البيانات
│   └── config.toml              # إعداد Supabase المحلي
├── .env.local                   # محلي فقط وغير متعقب
├── package.json
└── package-lock.json
```

للنشر راجع الدليل التشغيلي الوحيد `docs/DEPLOYMENT_WORKFLOW.md`. لا تستخدم هذا الدليل المحلي أو ملفات `docs/archive` لتغيير بيئة إنتاجية.
