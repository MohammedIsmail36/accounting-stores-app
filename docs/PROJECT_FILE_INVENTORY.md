# سجل ملفات جذر المشروع والأصول العامة

آخر مراجعة: 2026-09-07

## ملفات الجذر

جميع الملفات الأربعة عشر الموجودة في الجذر لها وظيفة حالية:

- `package.json` و`package-lock.json`: تعريف الحزم وقفلها.
- `index.html`: مدخل تطبيق Vite وتعريف favicon وسياسة منع الفهرسة.
- `vite.config.ts` و`vitest.config.ts`: البناء والاختبارات.
- `tsconfig.json` و`tsconfig.app.json` و`tsconfig.node.json`: إعداد TypeScript.
- `eslint.config.js`: قواعد التحليل الساكن.
- `postcss.config.js` و`tailwind.config.ts`: معالجة CSS وهوية الواجهة.
- `components.json`: إعداد أدوات ومكونات shadcn ومسارات alias.
- `.gitignore`: منع الأسرار والمخرجات والملفات المحلية.
- `README.md`: نقطة الدخول إلى أدلة المشروع.

لا يوجد ملف مؤقت أو `*.bak` أو `*.old` أو `*.orig` أو `*.rej` في الجذر. مجلدا `node_modules` و`dist` مخرجات محلية مستبعدة من Git وليسا جزءاً من المستودع الجديد.

## الأصول العامة المعتمدة

- `public/favicon.ico`: أيقونة النظام المحايدة متعددة المقاسات.
- `public/fonts/Tajawal-Regular.ttf`
- `public/fonts/Tajawal-Medium.ttf`
- `public/fonts/Tajawal-Bold.ttf`
- `public/robots.txt`: يمنع فهرسة التطبيق المحاسبي بالكامل.

خطوط Tajawal الثلاثة مستخدمة مباشرة في `src/lib/pdf-arabic.ts`. حُذف خطا Amiri لأن البحث في كامل الكود أثبت عدم وجود أي استدعاء لهما.

## صفحة الروابط القديمة

كان `public/links.html` ملفاً منفصلاً عن تطبيق المحاسبة ولا يستدعيه الكود. كان يضم صفحتين تسويقيتين قديمتين ملتصقتين، وتعليق React غير صالح، وروابط وهمية.

تحقق HTTP في 2026-09-07 أثبت أن النسخة القديمة منشورة بحالة `200` على النطاقات الثلاثة. قرر المالك إزالة الملف من المشروع النظيف وتأجيل بناء بديل آمن حتى استقرار الإنتاج والتنظيف. بقيت النسخ المنشورة دون تغيير في هذه المرحلة، والخطة اللاحقة موثقة في `docs/DEFERRED_CUSTOMER_LINKS_PAGE.md`.

## إعدادات Nginx المتعقبة

- `deploy/nginx/farida.conf`: مطابق للملف المركب حالياً على الخادم وقت المراجعة.
- `deploy/nginx/staging.conf`: مكافئ وظيفياً للملف المركب، مع اختلاف تعليق ومسافات فقط.
- `deploy/nginx/alibea.conf`: أضيف من إعداد Alibea المركب حالياً لأن المستودع لم يكن يحتفظ بنسخة منه.

إضافة ملف Alibea إلى cleanroom لا تغير Nginx. أي تركيب مستقبلي يتطلب مقارنة مستقلة ثم `sudo nginx -t` قبل reload.
