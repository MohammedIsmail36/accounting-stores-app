> **وثيقة تاريخية مؤرشفة:** تصف المعمارية والإعداد السابق ولا تمثل خطوات النشر الحالية. الدليل التشغيلي المعتمد هو [`../../DEPLOYMENT_WORKFLOW.md`](../../DEPLOYMENT_WORKFLOW.md).

# دليل تشغيل عدة شركات على نفس السيرفر (Multi-Company)

> **استراتيجية المشروع**: Multi-Instance — كل شركة = Stack مستقل تماماً (قاعدة بيانات + Auth + API + Frontend) يعمل في حاويات Docker منفصلة، ويُقدَّم على Subdomain خاص بها.
> **لماذا**: عزل كامل للبيانات والقيود المحاسبية، أمان أعلى، نسخ احتياطية مستقلة، وإمكانية تحديث/إيقاف شركة دون التأثير على الأخرى.

هذا الدليل يفترض أنك أنجزت [`PRODUCTION_DEPLOY_GUIDE.md`](./PRODUCTION_DEPLOY_GUIDE.md) ولديك **الشركة الأولى تعمل** على `companyA.example.com`. سنضيف الشركة الثانية `companyB.example.com`.

---

## 🧭 المخطط النهائي

```
┌───────────────────────────── السيرفر الواحد ─────────────────────────────┐
│                                                                          │
│   companyA.example.com  ──┐                                              │
│                            ├──►  Nginx (443)                            │
│   companyB.example.com  ──┘         │                                   │
│                                     ├─► /var/www/companyA  +  Kong:8000 │
│                                     └─► /var/www/companyB  +  Kong:8100 │
│                                                                          │
│   /opt/supabase-companyA/      (Postgres داخلي + Auth + Storage)        │
│   /opt/supabase-companyB/      (Postgres داخلي + Auth + Storage)        │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

كل شركة لها:
- مجلد Supabase خاص: `/opt/supabase-<name>/`
- منافذ Kong/Studio فريدة
- شبكة Docker مستقلة (`supabase-<name>_default`)
- volumes مستقلة لقاعدة البيانات والملفات
- مجلد Frontend خاص: `/var/www/<name>/`
- Subdomain + شهادة SSL مستقلة
- نسخ احتياطية في `/backups/<name>/`

---

## 🧮 موارد السيرفر المطلوبة

| عدد الشركات | RAM موصى | CPU موصى | تخزين |
|------------|---------|---------|-------|
| 2 شركات    | 8 GB    | 4 vCPUs | 100 GB |
| 3-4 شركات  | 16 GB   | 6 vCPUs | 200 GB |
| 5+ شركات   | 32 GB   | 8 vCPUs | 400 GB |

> كل Stack مستقل يستهلك تقريباً **1.5–2 GB RAM** و**~5 GB تخزين** أساساً (قبل البيانات).

---

## 📋 جدول تخصيص المنافذ الداخلية

ليتجنب التعارض بين الـ Stacks، خصّص فترة منافذ لكل شركة (المنافذ داخلية فقط — لا تُفتح في الجدار الناري):

| الشركة | Kong (API) | Studio | Postgres | Functions |
|--------|------------|--------|----------|-----------|
| companyA | 8000 | 3000 | 5432 | 9000 |
| companyB | 8100 | 3100 | 5532 | 9100 |
| companyC | 8200 | 3200 | 5632 | 9200 |

> ملاحظة: PostgreSQL في Supabase Docker لا يُكشف على المضيف افتراضياً (يبقى داخل شبكة الـ Stack)، لذا تعارض 5432 لن يحدث ما لم تكشفه يدوياً.

---

## المرحلة 1: إعداد DNS للشركة الجديدة

في لوحة تحكم اسم النطاق (Domain Registrar):

```
Type: A    Name: companyB    Value: YOUR_SERVER_IP   TTL: 3600
```

أو إذا أردت Subdomain خاص بكل شركة على نطاق منفصل:

```
Type: A    Name: @           Value: YOUR_SERVER_IP   (لـ companyB.com)
Type: A    Name: www         Value: YOUR_SERVER_IP
```

انتظر انتشار DNS (دقائق إلى ساعة). تحقق:

```bash
dig +short companyB.example.com
```

---

## المرحلة 2: إعداد Stack شركة جديدة

### 2.1 إنشاء مجلد Supabase مستقل

```bash
cd /opt
sudo git clone --depth 1 https://github.com/supabase/supabase supabase-companyB
sudo chown -R deploy:deploy /opt/supabase-companyB
cd /opt/supabase-companyB/docker
```

### 2.2 ضبط متغيرات البيئة `.env`

```bash
cp .env.example .env
nano .env
```

**القيم الحرجة المطلوب تغييرها لكل شركة:**

```env
############
# Project Identity (مهم: غيّر اسم المشروع لتجنب تعارض الحاويات)
############
COMPOSE_PROJECT_NAME=supabase-companyB

############
# Secrets (وَلِّد قيماً جديدة وفريدة لهذه الشركة — لا تكرر قيم الشركة الأولى)
############
POSTGRES_PASSWORD=<كلمة-مرور-قوية-فريدة-للشركة-B>
JWT_SECRET=<JWT-Secret-جديد-32-حرفاً-على-الأقل>
ANON_KEY=<مفتاح-anon-جديد-مولّد-من-JWT_SECRET-أعلاه>
SERVICE_ROLE_KEY=<مفتاح-service-role-جديد>
DASHBOARD_USERNAME=admin_b
DASHBOARD_PASSWORD=<كلمة-مرور-قوية-للوحة-التحكم>

############
# عناوين الشركة الثانية
############
SITE_URL=https://companyB.example.com
API_EXTERNAL_URL=https://companyB.example.com/api
SUPABASE_PUBLIC_URL=https://companyB.example.com/api
GOTRUE_SITE_URL=https://companyB.example.com
ADDITIONAL_REDIRECT_URLS=https://companyB.example.com

############
# المنافذ الداخلية (يجب أن تكون مختلفة عن الشركة الأولى)
############
KONG_HTTP_PORT=8100
KONG_HTTPS_PORT=8543
STUDIO_PORT=3100

############
# Auth
############
GOTRUE_MAILER_AUTOCONFIRM=false
ENABLE_EMAIL_SIGNUP=false
```

> **توليد المفاتيح**: استخدم الأداة الرسمية https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys مع `JWT_SECRET` الجديد.

### 2.3 (اختياري) تحسينات PostgreSQL

```bash
mkdir -p volumes/db
cat > volumes/db/custom-postgresql.conf << 'EOF'
shared_buffers = 1GB
effective_cache_size = 3GB
work_mem = 32MB
maintenance_work_mem = 256MB
max_connections = 100
random_page_cost = 1.1
log_min_duration_statement = 1000
EOF
```

> قِم القيم بتوزيع منطقي. إذا كان لديك 8 GB RAM وشركتان: امنح كل شركة ~1 GB لـ shared_buffers لا أكثر.

### 2.4 تشغيل Stack الشركة الثانية

```bash
docker compose up -d
docker compose ps
```

تحقق أن جميع الحاويات `healthy`:

```bash
docker compose logs -f --tail=30
```

---

## المرحلة 3: تطبيق Schema للشركة الجديدة

```bash
# نسخ ملف Schema من المشروع
cp /opt/accounting-app/public/full-schema.sql /tmp/

# تطبيقه على قاعدة بيانات الشركة الثانية
docker exec -i supabase-companyB-db-1 psql -U postgres -d postgres < /tmp/full-schema.sql
```

> اسم الحاوية يعتمد على `COMPOSE_PROJECT_NAME` — تحقق منه عبر `docker ps | grep companyB`.

طبّق فهارس الأداء (نسخ نفس البلوك من المرحلة 5.3 في الدليل الأصلي).

---

## المرحلة 4: نشر Edge Functions للشركة الجديدة

```bash
# نسخ الدوال إلى Stack الشركة B
cp -r /opt/accounting-app/supabase/functions/* /opt/supabase-companyB/docker/volumes/functions/

# إعادة تشغيل الحاوية
cd /opt/supabase-companyB/docker
docker compose restart functions
```

تهيئة المدير الافتراضي للشركة الجديدة:

```bash
curl -X POST http://localhost:8100/functions/v1/seed-system \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY_FOR_COMPANY_B>" \
  -H "Content-Type: application/json"
```

---

## المرحلة 5: بناء ونشر Frontend الشركة الجديدة

> **ملاحظة مهمة**: نفس الكود يُبنى مرتين بمفاتيح بيئة مختلفة. لا حاجة لـ fork أو نسخة من الكود.

```bash
cd /opt/accounting-app

# إذا كانت هناك تعديلات جديدة
git pull
npm ci

# بناء خاص بالشركة B
VITE_SUPABASE_URL=https://companyB.example.com/api \
VITE_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY_FOR_COMPANY_B> \
npm run build

# نشر الملفات في مجلد منفصل
sudo mkdir -p /var/www/companyB
sudo cp -r dist/* /var/www/companyB/
sudo chown -R www-data:www-data /var/www/companyB
```

> **تحذير**: لا تنسَ إعادة بناء الشركة الأولى بمفاتيحها الخاصة عند كل تحديث، وإلا ستشير الواجهة للـ API الخاطئ.

---

## المرحلة 6: إعداد Nginx للشركة الجديدة

أنشئ ملف إعداد منفصل لكل شركة (لا تخلط الإعدادات في ملف واحد):

```bash
sudo nano /etc/nginx/sites-available/companyB
```

```nginx
# ─────────────────────────────────────────
# الشركة B — Nginx Configuration
# ─────────────────────────────────────────

server {
    listen 80;
    server_name companyB.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name companyB.example.com;

    # SSL — تُملأ تلقائياً بواسطة Certbot
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;

    client_max_body_size 50M;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    gzip_min_length 1000;

    # ── Frontend الخاص بالشركة B ──
    location / {
        root /var/www/companyB;
        try_files $uri $uri/ /index.html;

        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }

    # ── Supabase API الخاص بالشركة B (المنفذ 8100) ──
    location /api/ {
        proxy_pass http://127.0.0.1:8100/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location ~ /\. { deny all; }
}
```

تفعيل الموقع + شهادة SSL:

```bash
sudo ln -s /etc/nginx/sites-available/companyB /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

sudo certbot --nginx -d companyB.example.com
```

---

## المرحلة 7: نسخ احتياطي مستقل لكل شركة

عدّل `/opt/backup-db.sh` ليدعم عدة شركات:

```bash
sudo nano /opt/backup-db.sh
```

```bash
#!/bin/bash
# ═══════════════════════════════════════
# نسخ احتياطي متعدد الشركات
# ═══════════════════════════════════════

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)

# قائمة الشركات: اسم_الحاوية:اسم_الشركة
COMPANIES=(
  "supabase-db:companyA"
  "supabase-companyB-db-1:companyB"
)

for entry in "${COMPANIES[@]}"; do
  CONTAINER="${entry%%:*}"
  NAME="${entry##*:}"

  DAILY="/backups/${NAME}/daily"
  WEEKLY="/backups/${NAME}/weekly"
  mkdir -p "$DAILY" "$WEEKLY"

  # نسخة يومية
  docker exec "$CONTAINER" pg_dump -U postgres -Fc postgres \
    > "${DAILY}/db_${TIMESTAMP}.dump"

  # نسخة أسبوعية كل جمعة
  if [ "$DAY_OF_WEEK" -eq 5 ]; then
    docker exec "$CONTAINER" pg_dump -U postgres --clean --if-exists postgres \
      > "${WEEKLY}/db_${TIMESTAMP}.sql"
  fi

  # تنظيف
  find "$DAILY" -name "*.dump" -mtime +14 -delete
  find "$WEEKLY" -name "*.sql" -mtime +90 -delete

  echo "[$(date)] Backup completed for ${NAME}: db_${TIMESTAMP}"
done
```

نفس Cron job اليومي يكفي — السكريبت يدور على كل الشركات.

---

## المرحلة 8: قائمة فحص قبل الإطلاق ✅

| البند | لكل شركة |
|-------|---------|
| `COMPOSE_PROJECT_NAME` فريد | ☐ |
| `JWT_SECRET` و `POSTGRES_PASSWORD` فريدة (لا تكرار) | ☐ |
| `ANON_KEY` و `SERVICE_ROLE_KEY` مولّدة من الـ JWT_SECRET الجديد | ☐ |
| منافذ Kong/Studio لا تتعارض مع شركات أخرى | ☐ |
| Subdomain موجّه على DNS لـ IP السيرفر | ☐ |
| شهادة SSL سارية (`sudo certbot certificates`) | ☐ |
| Frontend مبني بمتغيرات البيئة الصحيحة (`VITE_SUPABASE_URL`) | ☐ |
| `seed-system` تم استدعاؤها لإنشاء المدير | ☐ |
| كلمة مرور المدير الافتراضية تم تغييرها | ☐ |
| النسخ الاحتياطي يكتب في `/backups/<name>/` | ☐ |

---

## ⚠️ أخطاء شائعة وحلولها

| المشكلة | السبب | الحل |
|--------|------|-----|
| `Cannot connect to API` بعد فتح الـ Subdomain | بُنيت الواجهة بـ `VITE_SUPABASE_URL` خاطئ | أعد البناء بالمتغيرات الصحيحة لهذه الشركة |
| `Invalid JWT` عند تسجيل الدخول | `ANON_KEY` في الواجهة لا يطابق `JWT_SECRET` في الـ Stack | ولّد `ANON_KEY` من نفس `JWT_SECRET` وأعد البناء |
| تعارض اسم حاوية عند `docker compose up` | `COMPOSE_PROJECT_NAME` غير مضبوط أو مكرر | أضف `COMPOSE_PROJECT_NAME=supabase-<name>` في `.env` |
| الشركتان تعرضان نفس البيانات | Frontend يشير لنفس الـ Backend | تأكد من اختلاف `VITE_SUPABASE_URL` بين البناءين |
| `Port 8000 already in use` | منفذ Kong مكرر | غيّر `KONG_HTTP_PORT` في `.env` للشركة الجديدة |
| نسيت إعادة بناء الشركة الأولى بعد تحديث الكود | كل شركة تحتاج بناء منفصل | احتفظ بسكريبت `deploy-frontend.sh` لكل شركة |

---

## 🔁 سكريبت نشر سريع لكل شركة (موصى)

أنشئ `/opt/deploy-frontend.sh`:

```bash
#!/bin/bash
# الاستخدام: ./deploy-frontend.sh <company-name> <api-url> <anon-key>
# مثال: ./deploy-frontend.sh companyB https://companyB.example.com/api eyJhbGc...

set -euo pipefail
NAME="$1"; URL="$2"; KEY="$3"

cd /opt/accounting-app
git pull
npm ci

VITE_SUPABASE_URL="$URL" VITE_SUPABASE_PUBLISHABLE_KEY="$KEY" npm run build

sudo rm -rf "/var/www/${NAME}/"*
sudo cp -r dist/* "/var/www/${NAME}/"
sudo chown -R www-data:www-data "/var/www/${NAME}"

echo "✅ Deployed frontend for ${NAME}"
```

```bash
chmod +x /opt/deploy-frontend.sh

# الاستخدام
/opt/deploy-frontend.sh companyA https://companyA.example.com/api <ANON_KEY_A>
/opt/deploy-frontend.sh companyB https://companyB.example.com/api <ANON_KEY_B>
```

---

## 🎯 إضافة شركة ثالثة لاحقاً

كرر الخطوات نفسها:
1. اختر منافذ جديدة (مثلاً 8200/3200)
2. مجلد `/opt/supabase-companyC/`
3. Subdomain جديد + شهادة SSL
4. أضف الحاوية لقائمة `COMPANIES` في سكريبت النسخ الاحتياطي
5. ابنِ Frontend بالمتغيرات الخاصة بها

---

## 📊 مراقبة استهلاك الموارد لكل شركة

```bash
# استهلاك الذاكرة والـ CPU لكل حاوية
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"

# مساحة القرص لكل Stack
du -sh /opt/supabase-*/docker/volumes/db/data
du -sh /backups/*
```
