#!/usr/bin/env bash
# Sao lưu tay CSDL Supabase staging/production về MÁY CỦA SẾP (Story E0-10, NFR-05).
# Dùng trước khi duyệt triển khai production khi gói Supabase không có sao lưu tự động
# (BACKUP_STRATEGY=manual), hoặc bất cứ khi nào muốn có bản riêng. Quy trình đầy đủ và cách
# khôi phục: docs/05-ops/migration-va-sao-luu.md.
#
# Cách chạy (Supabase CLI + Docker đang chạy, như make db-start):
#   make db-backup DEPLOY_ENV=production
#   # hoặc: scripts/deploy/backup.sh production [thư-mục-đích]
#
# Chuỗi kết nối lấy từ biến SUPABASE_DB_URL; không có thì hỏi (gõ ẩn, không lưu lịch sử shell).
# Dùng chuỗi "Session pooler" (cổng 5432) trong Dashboard > Connect.
#
# An toàn: bản sao lưu chứa DỮ LIỆU THẬT (tên, email, số điện thoại). Script từ chối ghi vào thư
# mục của repo (repo công khai), đặt quyền 700/600, không in chuỗi kết nối. Không tải lên đâu cả.
set -euo pipefail

usage() {
  echo "Cách dùng: $0 <staging|production> [thư-mục-đích]" >&2
  exit 2
}

env_name="${1:-}"
case "$env_name" in
  staging | production) ;;
  *) usage ;;
esac

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out_dir="${2:-$HOME/qlda-backups/${env_name}-${stamp}}"

repo_root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || true)"
mkdir -p "$out_dir"
out_abs="$(cd "$out_dir" && pwd -P)"
if [ -n "$repo_root" ]; then
  repo_abs="$(cd "$repo_root" && pwd -P)"
  case "$out_abs/" in
    "$repo_abs"/*)
      echo "Từ chối: $out_abs nằm trong repo (công khai). Chọn thư mục ngoài repo." >&2
      rmdir "$out_abs" 2>/dev/null || true
      exit 1
      ;;
  esac
fi
chmod 700 "$out_abs"
umask 077

db_url="${SUPABASE_DB_URL:-}"
if [ -z "$db_url" ]; then
  printf 'Dán chuỗi kết nối Session pooler của dự án %s (gõ ẩn): ' "$env_name" >&2
  IFS= read -rs db_url
  echo >&2
fi
case "$db_url" in
  postgres://* | postgresql://*) ;;
  *)
    echo "Chuỗi kết nối phải bắt đầu bằng postgresql://" >&2
    exit 1
    ;;
esac
case "$db_url" in
  *127.0.0.1* | *localhost*)
    echo "Cảnh báo: chuỗi kết nối trỏ vào máy cục bộ, không phải dự án $env_name." >&2
    ;;
esac

command -v supabase >/dev/null 2>&1 || {
  echo "Thiếu Supabase CLI. Cài: brew install supabase/tap/supabase" >&2
  exit 1
}

echo "Sao lưu $env_name vào $out_abs ..."
# Theo hướng dẫn sao lưu của Supabase: vai trò, lược đồ, dữ liệu tách 3 tệp.
supabase db dump --remote="$db_url" --role-only -f "$out_abs/roles.sql"
supabase db dump --remote="$db_url" -f "$out_abs/schema.sql"
supabase db dump --remote="$db_url" --data-only --use-copy -f "$out_abs/data.sql"

(
  cd "$out_abs"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 roles.sql schema.sql data.sql >SHA256SUMS
  else
    sha256sum roles.sql schema.sql data.sql >SHA256SUMS
  fi
)
chmod 600 "$out_abs"/*

echo "Xong. Tệp (chứa dữ liệu thật, giữ kín, không gửi qua chat/email):"
ls -l "$out_abs"
echo "Lưu ý: tệp trong Supabase Storage (template báo cáo) KHÔNG nằm trong bản sao lưu này."
