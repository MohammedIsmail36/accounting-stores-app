> **وثيقة تاريخية مؤرشفة:** لا تستخدم الأوامر أدناه لنشر النظام الحالي. الدليل التشغيلي المعتمد هو [`../../DEPLOYMENT_WORKFLOW.md`](../../DEPLOYMENT_WORKFLOW.md). المحتوى محفوظ لفهم الإعداد السابق فقط.

# دليل الرفع على سيرفر الإنتاج (DigitalOcean / Ubuntu)

هذا الدليل يشرح كيفية نشر النظام المحاسبي على سيرفر DigitalOcean مستقل تماماً.

---

## المتطلبات

| المكون | المواصفات الدنيا | الموصى للإنتاج |
|--------|-----------------|----------------|
| CPU | 2 vCPUs | 4+ vCPUs |
| RAM | 4 GB | 8+ GB |
| تخزين | 50 GB SSD | 200+ GB NVMe SSD |
| نظام التشغيل | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| Droplet Plan | Basic $24/mo | General Purpose $48/mo |

---

## المرحلة 1: إنشاء وإعداد السيرفر

### 1.1 إنشاء Droplet على DigitalOcean

1. سجّل الدخول على https://cloud.digitalocean.com
2. **Create** → **Droplets**
3. اختر:
   - **Region**: أقرب منطقة لمستخدميك (مثلاً `fra1` لأوروبا والشرق الأوسط)
   - **Image**: Ubuntu 24.04 LTS
   - **Size**: General Purpose — 4 vCPUs, 8 GB RAM
   - **Authentication**: SSH Key (موصى) أو Password
4. اضبط اسم Droplet: `accounting-server`
5. أنشئ الـ Droplet

### 1.2 الاتصال بالسيرفر

```bash
ssh root@YOUR_SERVER_IP
```

### 1.3 إنشاء مستخدم غير root

```bash
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

# التبديل للمستخدم الجديد
su - deploy
```

### 1.4 تحديث النظام

```bash
sudo apt update && sudo apt upgrade -y
```

### 1.5 إعداد الجدار الناري (UFW)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

> **مهم**: لا تفتح المنفذ 5432 (PostgreSQL) أو 8000 (Supabase API) — سنستخدم Nginx كـ reverse proxy.

---

## المرحلة 2: تثبيت Docker

```bash
# تثبيت Docker
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# إضافة المستخدم لمجموعة Docker
sudo usermod -aG docker deploy
newgrp docker

# التحقق
docker --version
docker compose version
```

---

## المرحلة 3: تثبيت Node.js و أدوات البناء

```bash
# تثبيت Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# التحقق
node --version
npm --version

# تثبيت Supabase CLI
sudo npm install -g supabase
```

---

## المرحلة 4: نشر Supabase Docker

### 4.1 تحميل Supabase

```bash
cd /opt
sudo git clone --depth 1 https://github.com/supabase/supabase
sudo chown -R deploy:deploy /opt/supabase
cd /opt/supabase/docker
```

### 4.2 إعداد متغيرات البيئة

```bash
cp .env.example .env
nano .env
```

**القيم المطلوب تعديلها:**

```env
############
# Secrets — استبدل جميع القيم بقيم قوية وفريدة
############
POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD_64_CHARS
JWT_SECRET=CHANGE_ME_SUPER_SECRET_JWT_AT_LEAST_32_CHARS

# ولّد المفاتيح عبر: https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys
ANON_KEY=your_generated_anon_key
SERVICE_ROLE_KEY=your_generated_service_role_key

############
# General
############
SITE_URL=https://your-domain.com
API_EXTERNAL_URL=https://your-domain.com/api

############
# Studio
############
STUDIO_DEFAULT_ORGANIZATION=اسم شركتك
STUDIO_DEFAULT_PROJECT=النظام المحاسبي

############
# Auth
############
GOTRUE_SITE_URL=https://your-domain.com
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_MAILER_AUTOCONFIRM=false
```

### 4.3 تحسين إعدادات PostgreSQL

أنشئ ملف تحسينات:

```bash
mkdir -p /opt/supabase/docker/volumes/db
cat > /opt/supabase/docker/volumes/db/custom-postgresql.conf << 'EOF'
# ═══════════════════════════════════════
# إعدادات PostgreSQL للإنتاج
# ═══════════════════════════════════════

# ── الذاكرة ──
shared_buffers = 2GB
effective_cache_size = 6GB
work_mem = 64MB
maintenance_work_mem = 512MB

# ── الاتصالات ──
max_connections = 200

# ── WAL ──
wal_buffers = 64MB
checkpoint_completion_target = 0.9
max_wal_size = 2GB

# ── Query Planner (SSD) ──
random_page_cost = 1.1
effective_io_concurrency = 200

# ── Logging ──
log_min_duration_statement = 1000
log_line_prefix = '%t [%p] %u@%d '
EOF
```

أضف هذا السطر في `docker-compose.yml` تحت خدمة `db`:

```yaml
services:
  db:
    # ... الإعدادات الموجودة ...
    command: >
      postgres
      -c config_file=/etc/postgresql/postgresql.conf
      -c include=/etc/postgresql-custom/custom-postgresql.conf
    volumes:
      # ... volumes الموجودة ...
      - ./volumes/db/custom-postgresql.conf:/etc/postgresql-custom/custom-postgresql.conf:ro
```

### 4.4 تشغيل Supabase

```bash
docker compose up -d
```

التحقق:

```bash
docker compose ps
docker compose logs -f --tail=50
```

---

## المرحلة 5: إنشاء قاعدة البيانات

### 5.1 نسخ ملف Schema إلى السيرفر

من جهازك المحلي:

```bash
scp public/full-schema.sql deploy@YOUR_SERVER_IP:/tmp/full-schema.sql
```

### 5.2 تطبيق Schema

```bash
# من السيرفر
docker exec -i supabase-db psql -U postgres -d postgres < /tmp/full-schema.sql
```

### 5.3 إضافة فهارس الأداء

```bash
docker exec -i supabase-db psql -U postgres -d postgres << 'SQL'
-- فهارس لتسريع الاستعلامات الشائعة
CREATE INDEX IF NOT EXISTS idx_sales_invoices_date ON public.sales_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer ON public.sales_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_status ON public.sales_invoices(status);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_items_invoice ON public.sales_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_items_product ON public.sales_invoice_items(product_id);

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_date ON public.purchase_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier ON public.purchase_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_invoice ON public.purchase_invoice_items(invoice_id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_date ON public.inventory_movements(product_id, movement_date);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type ON public.inventory_movements(movement_type);

CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON public.journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON public.journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account ON public.journal_entry_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry ON public.journal_entry_lines(journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON public.customer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON public.supplier_payments(supplier_id);

CREATE INDEX IF NOT EXISTS idx_products_code ON public.products(code);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON public.products(brand_id);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_type ON public.expenses(expense_type_id);

-- تحديث الإحصائيات
ANALYZE;
SQL
```

---

## المرحلة 6: بناء ونشر الواجهة

### 6.1 نسخ المشروع إلى السيرفر

```bash
# من جهازك المحلي
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
```

أو من السيرفر:

```bash
cd /opt
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git accounting-app
cd accounting-app
```

### 6.2 تثبيت الاعتماديات

```bash
cd /opt/accounting-app
npm ci
```

> **ملاحظة**: لا حاجة لتعديل `vite.config.ts` أو إزالة أي حزم — المشروع نظيف وجاهز للبناء.

### 6.3 بناء الواجهة

```bash
VITE_SUPABASE_URL=https://your-domain.com/api \
VITE_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY> \
npm run build
```

### 6.4 نشر الملفات

```bash
sudo mkdir -p /var/www/accounting
sudo cp -r dist/* /var/www/accounting/
sudo chown -R www-data:www-data /var/www/accounting
```

---

## المرحلة 7: إعداد Nginx + SSL

### 7.1 تثبيت Nginx و Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 7.2 إعداد DNS

في لوحة تحكم اسم النطاق (Domain Registrar):
- أضف سجل **A** يشير إلى `YOUR_SERVER_IP`
- مثال: `accounting.yourcompany.com` → `YOUR_SERVER_IP`

### 7.3 إنشاء ملف إعداد Nginx

```bash
sudo nano /etc/nginx/sites-available/accounting
```

المحتوى:

```nginx
# ─────────────────────────────────────────
# النظام المحاسبي — Nginx Configuration
# ─────────────────────────────────────────

# إعادة توجيه HTTP → HTTPS
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # ── SSL (سيتم تعبئتها تلقائياً بواسطة Certbot) ──
    # ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # ── إعدادات SSL ──
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;

    # ── حجم الرفع الأقصى (لصور المنتجات) ──
    client_max_body_size 50M;

    # ── ضغط Gzip ──
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    gzip_min_length 1000;

    # ── الواجهة (React SPA) ──
    location / {
        root /var/www/accounting;
        try_files $uri $uri/ /index.html;

        # تخزين مؤقت للملفات الثابتة
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }

    # ── Supabase API Proxy ──
    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (للـ Realtime)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # ── منع الوصول لملفات حساسة ──
    location ~ /\. {
        deny all;
    }
}
```

### 7.4 تفعيل الموقع

```bash
sudo ln -s /etc/nginx/sites-available/accounting /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### 7.5 الحصول على شهادة SSL

```bash
sudo certbot --nginx -d your-domain.com
```

اختبار التجديد التلقائي:

```bash
sudo certbot renew --dry-run
```

---

## المرحلة 8: نشر Edge Functions

في إعداد Supabase Self-hosted (Docker)، الدوال تعمل عبر حاوية `functions` التي تقرأ الكود من volume مرتبط بمجلد `volumes/functions/`.

### 8.1 نسخ الدوال إلى مجلد Supabase

```bash
# نسخ مجلد الدوال + الملفات المشتركة
cp -r /opt/accounting-app/supabase/functions/* /opt/supabase/docker/volumes/functions/

# إعادة تشغيل حاوية الـ Functions لتحميل الدوال الجديدة
cd /opt/supabase/docker
docker compose restart functions
```

> الدوال متاحة الآن داخلياً على `http://localhost:8000/functions/v1/<function-name>` ومن الخارج عبر `https://your-domain.com/api/functions/v1/<function-name>`.

### 8.2 تهيئة النظام (إنشاء المدير + شجرة الحسابات)

```bash
curl -X POST http://localhost:8000/functions/v1/seed-system \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json"
```

سجّل الدخول بعدها بـ:
- البريد: `admin@system.com`
- كلمة المرور: `Sys@Admin#2025!Reset` (أو ما تم ضبطه في `DEFAULT_ADMIN_PASSWORD`)

**⚠️ غيّر كلمة المرور فوراً بعد أول تسجيل دخول.**

---

## المرحلة 9: النسخ الاحتياطي التلقائي

### 9.1 إنشاء مجلد النسخ الاحتياطي

```bash
sudo mkdir -p /backups/daily /backups/weekly
sudo chown -R deploy:deploy /backups
```

### 9.2 سكريبت النسخ اليومي

```bash
cat > /opt/backup-db.sh << 'SCRIPT'
#!/bin/bash
# ═══════════════════════════════════════
# النسخ الاحتياطي التلقائي لقاعدة البيانات
# ═══════════════════════════════════════

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)
BACKUP_DIR="/backups/daily"
WEEKLY_DIR="/backups/weekly"

# نسخ يومي (Custom format — أسرع في الاستعادة)
docker exec supabase-db pg_dump -U postgres -Fc postgres > "${BACKUP_DIR}/db_${TIMESTAMP}.dump"

# نسخ أسبوعي (كل يوم جمعة — SQL كامل للطوارئ)
if [ "$DAY_OF_WEEK" -eq 5 ]; then
    docker exec supabase-db pg_dump -U postgres --clean --if-exists postgres > "${WEEKLY_DIR}/db_${TIMESTAMP}.sql"
fi

# حذف النسخ اليومية الأقدم من 14 يوم
find "${BACKUP_DIR}" -name "*.dump" -mtime +14 -delete

# حذف النسخ الأسبوعية الأقدم من 90 يوم
find "${WEEKLY_DIR}" -name "*.sql" -mtime +90 -delete

echo "[$(date)] Backup completed: db_${TIMESTAMP}"
SCRIPT

chmod +x /opt/backup-db.sh
```

### 9.3 إعداد Cron Job

```bash
crontab -e
```

أضف:

```cron
# نسخ احتياطي يومي الساعة 2 صباحاً
0 2 * * * /opt/backup-db.sh >> /var/log/db-backup.log 2>&1
```

### 9.4 استعادة من نسخة احتياطية

```bash
# استعادة من Custom format
docker exec -i supabase-db pg_restore -U postgres -d postgres --clean --if-exists < /backups/daily/db_20260321_020000.dump

# استعادة من SQL
docker exec -i supabase-db psql -U postgres -d postgres < /backups/weekly/db_20260321_020000.sql
```

---

## المرحلة 10: أوامر الصيانة والمراقبة

### الأوامر اليومية

```bash
# حالة الخدمات
cd /opt/supabase/docker && docker compose ps

# مشاهدة logs
docker compose logs -f --tail=100
docker compose logs -f supabase-db    # قاعدة البيانات فقط
docker compose logs -f supabase-auth  # المصادقة فقط

# استخدام الموارد
docker stats --no-stream

# مساحة القرص
df -h
du -sh /backups/*
```

### تحديث النظام

```bash
# تحديث الواجهة
cd /opt/accounting-app
git pull
VITE_SUPABASE_URL=https://your-domain.com/api \
VITE_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY> \
npm run build
sudo cp -r dist/* /var/www/accounting/

# تحديث Supabase Docker
cd /opt/supabase/docker
git pull
docker compose pull
docker compose up -d

# تحديث Ubuntu
sudo apt update && sudo apt upgrade -y
```

### إعادة التشغيل

```bash
# إعادة تشغيل Supabase
cd /opt/supabase/docker && docker compose restart

# إعادة تشغيل Nginx
sudo systemctl restart nginx

# إعادة تشغيل السيرفر بالكامل
sudo reboot
```

---

## قائمة فحص الأمان ✅

| البند | الحالة | الأمر |
|-------|--------|-------|
| كلمة مرور PostgreSQL قوية | ☐ | تعديل `.env` |
| JWT_SECRET عشوائي 64+ حرف | ☐ | تعديل `.env` |
| ANON_KEY و SERVICE_ROLE_KEY مولّدة | ☐ | من JWT_SECRET |
| Firewall يسمح فقط 80/443/SSH | ☐ | `sudo ufw status` |
| المنفذ 5432 مغلق من الخارج | ☐ | `sudo ufw status` |
| HTTPS مفعّل بشهادة صالحة | ☐ | `sudo certbot certificates` |
| تجديد SSL تلقائي يعمل | ☐ | `sudo certbot renew --dry-run` |
| حساب المدير تم تغييره | ☐ | تغيير `admin@system.com` |
| النسخ الاحتياطي يعمل | ☐ | `sudo /opt/backup-db.sh` |
| Cron job مفعّل | ☐ | `crontab -l` |
| مستخدم غير root للتشغيل | ☐ | `whoami` → `deploy` |
| SSH بمفتاح فقط (بدون كلمة مرور) | ☐ | تعديل `/etc/ssh/sshd_config` |

---

## البنية النهائية على السيرفر

```
/opt/
├── supabase/docker/          # Supabase Docker (DB + Auth + API + Storage)
│   ├── .env                  # متغيرات البيئة الإنتاجية
│   ├── docker-compose.yml
│   └── volumes/
│       └── db/
│           └── custom-postgresql.conf
│
├── accounting-app/           # كود المشروع
│   ├── supabase/functions/   # Edge Functions
│   ├── public/full-schema.sql
│   └── dist/                 # ملفات البناء
│
└── backup-db.sh              # سكريبت النسخ الاحتياطي

/var/www/accounting/          # ملفات الواجهة (Nginx root)

/backups/
├── daily/                    # نسخ يومية (14 يوم)
└── weekly/                   # نسخ أسبوعية (90 يوم)

/etc/nginx/sites-available/
└── accounting                # إعداد Nginx
```

---

## المنافذ المستخدمة داخلياً

| المنفذ | الخدمة | متاح من الخارج؟ |
|--------|--------|----------------|
| 80 | Nginx (HTTP → HTTPS) | ✅ |
| 443 | Nginx (HTTPS) | ✅ |
| 8000 | Supabase Kong (API) | ❌ (عبر Nginx فقط) |
| 5432 | PostgreSQL | ❌ (داخلي فقط) |
| 9999 | GoTrue (Auth) | ❌ (داخلي فقط) |
| 9000 | Edge Functions (Deno) | ❌ (داخلي فقط، عبر Kong) |
| 3000 | Supabase Studio | ❌ (اختياري — يمكن فتحه عبر SSH tunnel) |

> **للوصول إلى Studio من جهازك**: `ssh -L 3000:localhost:3000 deploy@YOUR_SERVER_IP` ثم افتح `http://localhost:3000`

---

## 🏢 لتشغيل أكثر من شركة على نفس السيرفر

راجع الدليل المنفصل: **[`MULTI_COMPANY_DEPLOY.md`](./MULTI_COMPANY_DEPLOY.md)** لإضافة شركة ثانية (أو أكثر) بعزل كامل عبر Multi-Instance — كل شركة على Subdomain خاص بها مع قاعدة بيانات مستقلة.
