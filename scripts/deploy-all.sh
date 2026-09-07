#!/usr/bin/env bash
# ============================================================
#  سكربت النشر الشامل — Farida + Alibea
#  يسحب أي تعديلات من المستودع، يطبّق الميجريشن،
#  ينشر Edge Functions، ثم يبني وينشر الواجهة للشركتين.
#
#  الاستخدام:
#    cd /opt/accounting-app
#    chmod +x scripts/deploy-all.sh
#    ./scripts/deploy-all.sh                 # النشر الكامل
#    ./scripts/deploy-all.sh --skip-db       # بدون ميجريشن
#    ./scripts/deploy-all.sh --skip-functions
#    ./scripts/deploy-all.sh --only farida   # شركة واحدة فقط
#    ./scripts/deploy-all.sh --baseline-db   # أول مرة على قاعدة قائمة
#    ./scripts/deploy-all.sh --no-pull       # بدون git pull
#    ./scripts/deploy-all.sh --dry-run       # تحقق من الإعدادات دون تعديل الإنتاج
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/accounting-app}"

# name : docker_dir : www_dir : api_url : publishable_key_environment_variable
COMPANIES=(
  "farida:/opt/supabase-farida:/var/www/farida:https://farida.alibea2020.com/api:FARIDA_SUPABASE_PUBLISHABLE_KEY"
  "alibea:/opt/supabase-alibea:/var/www/alibea:https://alibea.alibea2020.com/api:ALIBEA_SUPABASE_PUBLISHABLE_KEY"
)

DO_PULL=true
DO_DB=true
DO_FUNCTIONS=true
DO_BUILD=true
BASELINE_DB=false
ONLY=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-pull) DO_PULL=false ;;
    --skip-db) DO_DB=false ;;
    --skip-functions) DO_FUNCTIONS=false ;;
    --skip-build) DO_BUILD=false ;;
    --baseline-db) BASELINE_DB=true ;;
    --dry-run) DRY_RUN=true ;;
    --only)
      [[ $# -ge 2 ]] || { echo "❌ الخيار --only يحتاج اسم شركة" >&2; exit 1; }
      ONLY="$2"
      shift
      ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "❌ خيار غير معروف: $1" >&2; exit 1 ;;
  esac
  shift
done

log()  { echo -e "\n\033[1;36m▶ $*\033[0m"; }
ok()   { echo -e "\033[1;32m✅ $*\033[0m"; }
warn() { echo -e "\033[1;33m⚠️  $*\033[0m"; }
die()  { echo -e "\033[1;31m❌ $*\033[0m" >&2; exit 1; }

if [[ -n "$ONLY" && "$ONLY" != "farida" && "$ONLY" != "alibea" ]]; then
  die "قيمة --only غير صحيحة: $ONLY (المتاح: farida أو alibea)"
fi

if [[ "$DRY_RUN" == true ]]; then
  [[ "$DO_BUILD" == true ]] || die "لا يمكن استخدام --dry-run مع --skip-build"
  DO_PULL=false
  DO_DB=false
  DO_FUNCTIONS=false
fi

cd "$APP_DIR" || die "المجلد غير موجود: $APP_DIR"

# ------------------------------------------------------------
# 1) سحب التحديثات مع حفظ التعديلات المحلية
# ------------------------------------------------------------
BEFORE_SHA="$(git rev-parse HEAD)"

if [[ "$DO_PULL" == true ]]; then
  log "سحب التحديثات من المستودع"
  STASHED=false
  if [[ -n "$(git status --porcelain)" ]]; then
    warn "توجد تعديلات محلية — سيتم حفظها في stash"
    git add -A
    git stash push -m "auto-deploy-$(date +%F-%H%M%S)" >/dev/null
    STASHED=true
  fi

  git pull --rebase || die "فشل git pull — حُلّ المشكلة يدوياً ثم أعد التشغيل"

  if [[ "$STASHED" == true ]]; then
    if git stash pop; then
      ok "تم إعادة تطبيق التعديلات المحلية"
    else
      die "تعارض عند إعادة تطبيق التعديلات المحلية.
حُلّ التعارض يدوياً ثم: git add -A && git stash drop
أو للتخلي عن تعديلاتك المحلية: git checkout -- . && git stash drop"
    fi
  fi
  ok "الكود محدّث: $(git rev-parse --short HEAD)"
else
  warn "تم تخطي git pull"
fi

AFTER_SHA="$(git rev-parse HEAD)"

changed_files() {
  [[ "$BEFORE_SHA" == "$AFTER_SHA" ]] && return 0
  git diff --name-only "$BEFORE_SHA" "$AFTER_SHA"
}

# ------------------------------------------------------------
# 2) الميجريشن
# ------------------------------------------------------------
if [[ "$DO_DB" == true ]]; then
  log "تطبيق ميجريشن قواعد البيانات"
  chmod +x scripts/migrate-all-companies.sh
  migration_args=()
  if [[ "$BASELINE_DB" == true ]]; then
    migration_args+=(--baseline-current)
  fi
  if [[ -n "$ONLY" ]]; then
    migration_args+=(--only "$ONLY")
  fi
  ./scripts/migrate-all-companies.sh "${migration_args[@]}"
  ok "الميجريشن انتهى"
else
  warn "تم تخطي الميجريشن"
fi

# ------------------------------------------------------------
# 3) نشر Edge Functions لكل شركة
# ------------------------------------------------------------
# يبحث عن مجلد يحتوي ملف compose فعلي (قد يكون داخل docker/ أو supabase/docker/)
find_compose_dir() {
  local base="$1" d
  for d in "$base" "$base/docker" "$base/supabase/docker" "$base/supabase"; do
    for f in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do
      [[ -f "$d/$f" ]] && { echo "$d"; return 0; }
    done
  done
  return 1
}

# يجد حاوية الدوال: أولاً عبر compose، وإن تعذّر فعبر اسم الحاوية
find_functions_container() {
  local compose_dir="$1" base="$2" cid=""
  if [[ -n "$compose_dir" ]]; then
    cid="$(cd "$compose_dir" && sudo docker compose ps -q functions 2>/dev/null | head -1)"
  fi
  if [[ -z "$cid" ]]; then
    local pat
    pat="$(basename "$base")"
    cid="$(sudo docker ps -q --filter "name=functions" 2>/dev/null | while read -r c; do
      n="$(sudo docker inspect --format '{{.Name}}' "$c")"
      case "$n" in *"$pat"*) echo "$c";; esac
    done | head -1)"
  fi
  if [[ -z "$cid" ]]; then
    cid="$(sudo docker ps -q --filter "name=edge-functions" 2>/dev/null | head -1)"
  fi
  echo "$cid"
}

deploy_functions() {
  local name="$1" docker_dir="$2"
  local target container_id mounted_target compose_dir=""

  if [[ ! -d "$docker_dir" ]]; then
    warn "[$name] مجلد Supabase غير موجود: $docker_dir — تخطي الدوال"
    return 0
  fi

  compose_dir="$(find_compose_dir "$docker_dir" || true)"
  [[ -n "$compose_dir" ]] && log "[$name] ملف compose في: $compose_dir" \
    || warn "[$name] لم أجد ملف compose — سأتعامل مع الحاوية مباشرة"

  container_id="$(find_functions_container "$compose_dir" "$docker_dir")"
  [[ -n "$container_id" ]] || die "[$name] حاوية functions غير موجودة أو متوقفة.
تحقق: sudo docker ps --format '{{.Names}}' | grep -i function"

  mounted_target="$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Source}}{{end}}{{end}}' "$container_id")"
  [[ -n "$mounted_target" ]] || die "[$name] لا يوجد volume مربوط إلى /home/deno/functions داخل حاوية functions"
  target="$mounted_target"

  log "[$name] نسخ الدوال إلى المسار الفعلي: $target"
  sudo mkdir -p "$target"
  # main/index.ts موجود في المستودع وهو الراوتر المطلوب لتشغيل الدوال الذاتية.
  sudo cp -r supabase/functions/. "$target"/
  sudo chmod -R a+rX "$target"

  [[ -f "$target/main/index.ts" ]] \
    || die "[$name] فشل نسخ راوتر الدوال main/index.ts"
  [[ -f "$target/telegram-publish/index.ts" ]] \
    || die "[$name] فشل نسخ telegram-publish/index.ts"

  if [[ -n "$compose_dir" ]]; then
    ( cd "$compose_dir" && sudo docker compose restart functions >/dev/null ) \
      || die "[$name] فشل إعادة تشغيل خدمة functions — تحقق: cd $compose_dir && docker compose logs functions"
    container_id="$(find_functions_container "$compose_dir" "$docker_dir")"
  else
    sudo docker restart "$container_id" >/dev/null \
      || die "[$name] فشل إعادة تشغيل حاوية functions"
  fi

  for _ in {1..20}; do
    if sudo docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null | grep -q true; then
      break
    fi
    sleep 1
  done

  sudo docker exec "$container_id" test -f /home/deno/functions/main/index.ts \
    || die "[$name] main/index.ts غير ظاهر داخل الحاوية"
  sudo docker exec "$container_id" test -f /home/deno/functions/telegram-publish/index.ts \
    || die "[$name] telegram-publish/index.ts غير ظاهر داخل الحاوية"
  ok "[$name] Edge Functions محدّثة"
}


# ------------------------------------------------------------
# 4) البناء والنشر
# ------------------------------------------------------------
build_and_deploy() {
  local name="$1" www_dir="$2" api_url="$3" anon_key="$4"
  local main_asset site_url served_asset

  log "[$name] بناء الواجهة"
  VITE_SUPABASE_URL="$api_url" \
  VITE_SUPABASE_PUBLISHABLE_KEY="$anon_key" \
  npm run build || die "[$name] فشل البناء"

  [[ -f dist/index.html ]] || die "[$name] مجلد dist غير صالح"

  main_asset="$(sed -n 's/.*src="\/\([^\"]*index-[^\"]*\.js\)".*/\1/p' dist/index.html | head -1)"
  [[ -n "$main_asset" && -f "dist/$main_asset" ]] \
    || die "[$name] تعذر تحديد ملف JavaScript الرئيسي داخل البناء"
  grep -Fq "$api_url" "dist/$main_asset" \
    || die "[$name] البناء لا يحتوي API الصحيح: $api_url — تم إيقاف النشر"

  ok "[$name] تم التحقق من API داخل البناء: $api_url"

  if [[ "$DRY_RUN" == true ]]; then
    warn "[$name] وضع dry-run — لم يتم تعديل $www_dir"
    return 0
  fi

  # Nginx must be able to traverse every generated directory and read every
  # static file. This also prevents rsync -a from copying a restrictive build
  # root mode (for example mktemp's 0700) onto the live document root.
  find dist -type d -exec chmod 0755 {} +
  find dist -type f -exec chmod 0644 {} +

  # rsync --delay-updates keeps the currently served files in place until all
  # replacement files have been transferred. It also removes stale hashed assets.
  if [[ -d "$www_dir" && -w "$www_dir" ]]; then
    rsync -a --delete-delay --delay-updates dist/ "$www_dir"/
  else
    sudo mkdir -p "$www_dir"
    sudo rsync -a --delete-delay --delay-updates dist/ "$www_dir"/
    sudo chown -R www-data:www-data "$www_dir"
  fi

  cmp -s dist/index.html "$www_dir/index.html" \
    || die "[$name] ملف index.html المنشور لا يطابق البناء"
  [[ -f "$www_dir/$main_asset" ]] \
    || die "[$name] ملف JavaScript الرئيسي غير موجود بعد النشر"
  grep -Fq "$api_url" "$www_dir/$main_asset" \
    || die "[$name] الملف المنشور لا يحتوي API الصحيح"

  site_url="${api_url%/api}"
  served_asset=""
  for _ in {1..10}; do
    served_asset="$(curl -fsS --retry 2 --connect-timeout 10 "$site_url/" \
      | sed -n 's/.*src="\/\([^\"]*index-[^\"]*\.js\)".*/\1/p' \
      | head -1)"
    [[ "$served_asset" == "$main_asset" ]] && break
    sleep 1
  done
  [[ "$served_asset" == "$main_asset" ]] \
    || die "[$name] النطاق يقدم بناء مختلفاً (المتوقع: $main_asset، الفعلي: ${served_asset:-غير معروف})"

  ok "[$name] تم النشر والتحقق من النطاق: $site_url"
}

# تثبيت الحزم مرة واحدة
if [[ "$DO_BUILD" == true ]]; then
  log "تثبيت الحزم"
  [[ -f package-lock.json ]] || die "package-lock.json غير موجود — أُوقف النشر لضمان ثبات الحزم"
  npm ci || die "فشل npm ci — لم يتم تغيير ملفات الإنتاج"
  [[ -x node_modules/.bin/vite ]] \
    || die "npm ci انتهى دون تثبيت أداة vite — أُوقف النشر لأن الحزم غير مكتملة"
  ok "الحزم جاهزة (npm ci)"
fi


for entry in "${COMPANIES[@]}"; do
  IFS=':' read -r name docker_dir www_dir api_scheme api_rest publishable_key_var <<< "$entry"
  api_url="$api_scheme:$api_rest"
  publishable_key="${!publishable_key_var:-}"

  if [[ -n "$ONLY" && "$ONLY" != "$name" ]]; then
    continue
  fi

  echo -e "\n\033[1;35m🏢 $name\033[0m"
  if [[ "$DO_FUNCTIONS" == true ]]; then
    deploy_functions "$name" "$docker_dir"
  fi
  if [[ "$DO_BUILD" == true ]]; then
    [[ -n "$publishable_key" ]] \
      || die "[$name] متغير البيئة $publishable_key_var غير مضبوط — أُوقف البناء دون تغيير ملفات الإنتاج"
    build_and_deploy "$name" "$www_dir" "$api_url" "$publishable_key"
  fi
done

echo ""
if [[ "$DRY_RUN" == true ]]; then
  ok "انتهى فحص dry-run بنجاح — لم تتغير ملفات الإنتاج"
else
  ok "انتهى النشر بنجاح 🎉"
  if [[ -n "$ONLY" ]]; then
    echo "افتح موقع $ONLY واعمل Ctrl+F5 لتجاوز الكاش."
  else
    echo "افتح الموقعين واعمل Ctrl+F5 لتجاوز الكاش."
  fi
fi
