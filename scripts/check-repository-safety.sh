#!/usr/bin/env bash
set -euo pipefail

scan_root="${1:-.}"

if ! command -v rg >/dev/null 2>&1; then
  echo "ERROR: ripgrep (rg) is required." >&2
  exit 2
fi

findings=0

report_paths() {
  local label="$1"
  local paths="$2"

  if [[ -z "$paths" ]]; then
    return
  fi

  findings=1
  while IFS= read -r path; do
    [[ -n "$path" ]] && printf 'FOUND [%s] %s\n' "$label" "$path"
  done <<< "$paths"
}

scan_content() {
  local label="$1"
  local pattern="$2"
  local paths

  paths="$(rg -l --hidden --pcre2 "$pattern" "$scan_root" \
    -g '!.git/**' \
    -g '!node_modules/**' \
    -g '!dist/**' \
    -g '!coverage/**' \
    -g '!*.lock' 2>/dev/null || true)"
  report_paths "$label" "$paths"
}

sensitive_names="$(rg --files --hidden "$scan_root" \
  -g '!.git/**' \
  -g '!node_modules/**' \
  -g '!dist/**' \
  -g '!coverage/**' \
  -g '.env' \
  -g '.env.*' \
  -g '.npmrc' \
  -g '.netrc' \
  -g '*.pem' \
  -g '*.key' \
  -g '*.p12' \
  -g '*.pfx' \
  -g '*.dump' \
  -g '*.sql.gz' \
  -g '*service-role*' \
  -g '*service_role*' \
  -g '*credentials*.json' 2>/dev/null || true)"
report_paths "sensitive filename" "$sensitive_names"

platform_named_paths="$(rg --files --hidden "$scan_root" \
  -g '!.git/**' \
  -g '!node_modules/**' \
  -g '!dist/**' \
  -g '!docs/archive/**' 2>/dev/null \
  | rg -i '(^|/)(\.lovable)(/|$)|lovable|gptengineer' \
  | rg -v '(^|/)docs/LOVABLE_DECOUPLING_PLAN\.md$' || true)"
report_paths "platform-named path" "$platform_named_paths"

platform_content="$(rg -l --hidden --pcre2 \
  '(?i)lovable(?:\.dev|project|[-_]tagger)?|gptengineer|LOVABLE_|lovable_schema' \
  "$scan_root" \
  -g '!.git/**' \
  -g '!node_modules/**' \
  -g '!dist/**' \
  -g '!docs/archive/**' \
  -g '!docs/LOVABLE_DECOUPLING_PLAN.md' \
  -g '!docs/DEPENDENCY_SECURITY_PLAN.md' \
  -g '!docs/SALES_REPORT_IMPROVEMENT_TRACKER.md' \
  -g '!docs/PLATFORM_REFERENCE_AUDIT.md' \
  -g '!scripts/check-repository-safety.sh' \
  -g '!supabase/migrations/20260419170758_1e4296a7-5cfa-429f-86d4-8cd8fe59158e.sql' \
  -g '!supabase/migrations/20260907091000_neutral_migration_tracking.sql' 2>/dev/null || true)"
report_paths "unexpected platform reference" "$platform_content"

scan_content "private key" '-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'
scan_content "database URI with password" '(?i)(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^[:space:]\/:@]+:[^[:space:]\/@]+@'
scan_content "GitHub token" '(?:github_pat_[A-Za-z0-9_]{40,}|gh[pousr]_[A-Za-z0-9]{20,})'
scan_content "npm token" 'npm_[A-Za-z0-9]{30,}'
scan_content "OpenAI-style secret" 'sk-(?:proj-)?[A-Za-z0-9_-]{20,}'
scan_content "AWS access key" '(?:AKIA|ASIA)[A-Z0-9]{16}'
scan_content "Google API key" 'AIza[0-9A-Za-z_-]{35}'
scan_content "Stripe live secret" 'sk_live_[0-9A-Za-z]{20,}'
scan_content "Telegram bot token" '[0-9]{8,10}:[A-Za-z0-9_-]{35}'
scan_content "JWT-like token" 'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}'
scan_content "high-risk literal assignment" '(?i)(?:service_role_key|supabase_service_role_key|database_password|postgres_password|jwt_secret|github_token|cloudflare_api_token|smtp_pass(?:word)?)['"'"']?\s*[:=]\s*['"'"'][^'"'"'[:space:]$<{][^'"'"']{7,}['"'"']'

if [[ "$findings" -ne 0 ]]; then
  echo "Secret-safety scan failed. Values were intentionally not printed." >&2
  exit 1
fi

echo "Secret-safety scan passed: no blocked filenames or recognized secret patterns found."
