#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$APP_DIR/supabase/migrations}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-postgres}"
FARIDA_DB_CONTAINER="${FARIDA_DB_CONTAINER:-farida-db}"
ALIBEA_DB_CONTAINER="${ALIBEA_DB_CONTAINER:-alibea-db}"
TRACKING_TABLE="public.app_schema_migrations"
TRACKING_MIGRATION="${TRACKING_MIGRATION:-$MIGRATIONS_DIR/20260907091000_neutral_migration_tracking.sql}"

# Usage:
#   ./scripts/migrate-all-companies.sh
#   ./scripts/migrate-all-companies.sh --baseline-current
#   ./scripts/migrate-all-companies.sh --prepare-tracking
#   ./scripts/migrate-all-companies.sh --only farida
#   ./scripts/migrate-all-companies.sh --only alibea
#
# First use on an existing production database:
#   1) Pull the latest code.
#   2) Run with --baseline-current once to record existing migration files
#      as already applied WITHOUT re-running old migrations.
#   3) On future pulls, run without --baseline-current.

COMPANIES=(
  "Farida:$FARIDA_DB_CONTAINER"
  "Alibea:$ALIBEA_DB_CONTAINER"
)

BASELINE_CURRENT=false
PREPARE_TRACKING=false
ONLY=""

print_help() {
  printf '%s\n' \
    'Usage: scripts/migrate-all-companies.sh [options]' \
    '' \
    'Options:' \
    '  --baseline-current   Record current files without executing them' \
    '  --prepare-tracking   Prepare neutral migration tracking only' \
    '  --only COMPANY       Limit execution to farida or alibea' \
    '  -h, --help           Show this help'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --baseline-current) BASELINE_CURRENT=true ;;
    --prepare-tracking) PREPARE_TRACKING=true ;;
    --only)
      [[ $# -ge 2 ]] || { echo "❌ الخيار --only يحتاج اسم شركة" >&2; exit 1; }
      ONLY="$2"
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *) echo "❌ خيار غير معروف: $1" >&2; exit 1 ;;
  esac
  shift
done

if [[ -n "$ONLY" && "$ONLY" != "farida" && "$ONLY" != "alibea" ]]; then
  echo "❌ قيمة --only غير صحيحة: $ONLY (المتاح: farida أو alibea)" >&2
  exit 1
fi

if [[ "$BASELINE_CURRENT" == true && "$PREPARE_TRACKING" == true ]]; then
  echo "❌ لا يمكن جمع --baseline-current مع --prepare-tracking" >&2
  exit 1
fi

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "❌ Migrations directory not found: $MIGRATIONS_DIR" >&2
  exit 1
fi

run_sql() {
  local container="$1"
  docker exec -i "$container" psql -U "$DB_USER" -v ON_ERROR_STOP=1 -d "$DB_NAME"
}

run_sql_scalar() {
  local container="$1"
  local sql="$2"
  docker exec -i "$container" psql -U "$DB_USER" -v ON_ERROR_STOP=1 -d "$DB_NAME" -tAc "$sql"
}

ensure_tracking_table() {
  local container="$1"
  [[ -f "$TRACKING_MIGRATION" ]] || {
    echo "❌ Tracking migration not found: $TRACKING_MIGRATION" >&2
    return 1
  }
  run_sql "$container" < "$TRACKING_MIGRATION" >/dev/null
}

has_existing_app_data() {
  local container="$1"
  local exists
  exists=$(run_sql_scalar "$container" "SELECT to_regclass('public.products') IS NOT NULL;")
  [[ "$exists" == "t" ]]
}

has_any_recorded_migration() {
  local container="$1"
  local count
  count=$(run_sql_scalar "$container" "SELECT COUNT(*) FROM $TRACKING_TABLE;")
  [[ "$count" != "0" ]]
}

is_applied() {
  local container="$1"
  local version="$2"
  local exists
  exists=$(run_sql_scalar "$container" "SELECT EXISTS (SELECT 1 FROM $TRACKING_TABLE WHERE version = '$version');")
  [[ "$exists" == "t" ]]
}

record_migration() {
  local container="$1"
  local version="$2"
  local filename="$3"
  local checksum="$4"
  run_sql "$container" <<SQL >/dev/null
INSERT INTO $TRACKING_TABLE (version, filename, checksum)
VALUES ('$version', '$filename', '$checksum')
ON CONFLICT (version) DO NOTHING;
SQL
}

apply_migration() {
  local container="$1"
  local file="$2"
  local filename version checksum
  filename=$(basename "$file")
  version="${filename%.sql}"
  checksum=$(sha256sum "$file" | awk '{print $1}')

  if is_applied "$container" "$version"; then
    echo "   ⏭️  $filename"
    return
  fi

  echo "   ▶️  $filename"
  {
    echo "BEGIN;"
    cat "$file"
    echo "INSERT INTO $TRACKING_TABLE (version, filename, checksum) VALUES ('$version', '$filename', '$checksum');"
    echo "COMMIT;"
  } | run_sql "$container" >/dev/null
}

echo "🔧 Applying migrations safely to all companies..."
echo "📁 $MIGRATIONS_DIR"

shopt -s nullglob
migration_files=("$MIGRATIONS_DIR"/*.sql)

if [[ ${#migration_files[@]} -eq 0 ]]; then
  echo "❌ No migration files found." >&2
  exit 1
fi

for company in "${COMPANIES[@]}"; do
  name="${company%%:*}"
  container="${company#*:}"
  if [[ -n "$ONLY" && "${name,,}" != "$ONLY" ]]; then
    continue
  fi
  echo ""
  echo "🏢 $name ($container)"

  ensure_tracking_table "$container"

  if [[ "$PREPARE_TRACKING" == true ]]; then
    echo "   ✅ Neutral migration tracking prepared"
    continue
  fi

  if [[ "$BASELINE_CURRENT" == true ]]; then
    echo "   📌 Baselining current migration files without executing them..."
    for file in "${migration_files[@]}"; do
      filename=$(basename "$file")
      version="${filename%.sql}"
      checksum=$(sha256sum "$file" | awk '{print $1}')
      record_migration "$container" "$version" "$filename" "$checksum"
    done
    echo "   ✅ Baseline complete"
    continue
  fi

  if has_existing_app_data "$container" && ! has_any_recorded_migration "$container"; then
    echo "   ❌ Existing database detected but no migration history found." >&2
    echo "   لحماية بياناتك لن يتم إعادة تشغيل كل الهجرات القديمة." >&2
    echo "   شغّل مرة واحدة أولاً:" >&2
    echo "   ./scripts/migrate-all-companies.sh --baseline-current" >&2
    exit 1
  fi

  for file in "${migration_files[@]}"; do
    apply_migration "$container" "$file"
  done
  echo "   ✅ $name done"
done

if [[ "$PREPARE_TRACKING" == true ]]; then
  echo "🎉 Neutral migration tracking is ready"
else
  echo "🎉 All companies are up to date"
fi
