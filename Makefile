# Hợp đồng giữa CI và dự án: CI chỉ gọi 4 target lint, test, build, security
# (sau bước `make install`). Chạy cục bộ y hệt CI:
#   make install && make lint && make test && make build && make security
#
# Yêu cầu: Node theo .nvmrc, pnpm theo trường packageManager trong package.json,
# gitleaks (cho target security). Thiếu công cụ thì target báo lỗi kèm cách cài, không bỏ qua.

.PHONY: install lint test build security check-pnpm check-gitleaks \
	check-supabase db-start db-stop db-reset db-seed db-test test-integration

# Lỗi mức này trở lên trong pnpm audit sẽ làm security đỏ.
AUDIT_LEVEL ?= high

# Phiên bản pnpm lấy từ trường packageManager (chỉ dùng cho thông báo cài đặt).
PNPM_VERSION := $(shell sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' package.json)

check-pnpm:
	@command -v pnpm >/dev/null 2>&1 || { \
		echo "::error::Thiếu pnpm. Cài: npm install -g pnpm@$(PNPM_VERSION) (hoặc xem https://pnpm.io/installation)"; \
		exit 1; }

check-gitleaks:
	@command -v gitleaks >/dev/null 2>&1 || { \
		echo "::error::Thiếu gitleaks. Cài: brew install gitleaks (macOS) hoặc tải bản phát hành tại https://github.com/gitleaks/gitleaks/releases"; \
		exit 1; }

install: check-pnpm
	pnpm install --frozen-lockfile

# ESLint (cấu hình Next.js) + kiểm tra định dạng Prettier + kiểm tra kiểu TypeScript
lint: check-pnpm
	pnpm lint
	pnpm format:check
	pnpm typecheck

test: check-pnpm
	pnpm test

build: check-pnpm
	pnpm build

# Quét bí mật trong toàn bộ lịch sử git + quét lỗ hổng phụ thuộc
security: check-pnpm check-gitleaks
	gitleaks git --redact --no-banner .
	pnpm audit --audit-level $(AUDIT_LEVEL)

# ---------------------------------------------------------------------------
# Target phụ cho phát triển cục bộ (CI KHÔNG gọi). Cần Supabase CLI + Docker đang chạy.
# Xem README.md mục "Chạy cục bộ".
# ---------------------------------------------------------------------------
check-supabase:
	@command -v supabase >/dev/null 2>&1 || { \
		echo "::error::Thiếu Supabase CLI. Cài: brew install supabase/tap/supabase (xem https://supabase.com/docs/guides/local-development/cli/getting-started)"; \
		exit 1; }
	@docker info >/dev/null 2>&1 || { \
		echo "::error::Docker chưa chạy. Bật Docker Desktop hoặc Colima (colima start) rồi chạy lại."; \
		exit 1; }

# Khởi động stack Supabase cục bộ và áp migration (lần đầu sẽ kéo image, khá lâu).
db-start: check-supabase
	supabase start

db-stop: check-supabase
	supabase stop

# Dựng lại CSDL cục bộ từ đầu: chạy toàn bộ migration rồi supabase/seed.sql.
# Xóa sạch dữ liệu cục bộ, kể cả tài khoản thử (chạy lại db-seed sau đó).
db-reset: check-supabase
	supabase db reset

# Tạo/cập nhật tài khoản thử cho 4 persona. Cần SEED_PASSWORD (shell hoặc .env.local).
db-seed: check-supabase
	node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file-if-exists=.env.local scripts/seed-local-users.ts

# Chạy test pgTAP trong supabase/tests/ trên stack cục bộ.
db-test: check-supabase
	supabase test db

# Test tích hợp đăng nhập và quản trị người dùng (tests/integration/) trên stack cục bộ. Lấy URL và khóa từ
# `supabase status` (không in ra màn hình). `make test` không có các biến này sẽ bỏ qua nhóm test đó.
test-integration: check-pnpm check-supabase
	@eval "$$(supabase status -o env 2>/dev/null)"; \
	SUPABASE_URL="$$API_URL" SUPABASE_ANON_KEY="$$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$$SERVICE_ROLE_KEY" MAILPIT_URL="$$MAILPIT_URL" \
	pnpm exec vitest run tests/integration
