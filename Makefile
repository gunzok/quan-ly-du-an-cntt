# Hợp đồng giữa CI và dự án: CI chỉ gọi các target dưới đây (sau bước `make install`).
#
# 1. Không cần Supabase (job lint, test, build, security):
#      make install && make lint && make test && make build && make security
#    `make test` chạy unit test; nhóm test cần stack (tests/integration/) tự BỎ QUA có thông báo.
#
# 2. Cần Supabase CLI + Docker (job test-db, e2e). CI dựng stack rồi seed tài khoản thử:
#      make db-start && SEED_PASSWORD=... make db-seed
#      make test-db             # pgTAP: RLS và schema (supabase/tests/database/)
#      make test-integration    # Vitest + Supabase cục bộ (tests/integration/), thiếu stack thì ĐỎ
#      make e2e-install         # một lần: tải Chromium cho Playwright
#      SEED_PASSWORD=... make test-e2e   # build + next start + Playwright, quét axe (tests/e2e/)
#
# Yêu cầu: Node theo .nvmrc, pnpm theo trường packageManager trong package.json,
# gitleaks (cho target security), Supabase CLI + Docker (cho nhóm 2).
# Thiếu công cụ thì target báo lỗi kèm cách cài, không bỏ qua.

.PHONY: install lint test build security check-pnpm check-gitleaks \
	check-supabase db-start db-stop db-reset db-seed db-test test-db test-integration \
	e2e-install test-e2e

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
# Target cần Supabase CLI + Docker đang chạy (CI job test-db và e2e cũng gọi các target này).
# Xem README.md mục "Chạy cục bộ".
# ---------------------------------------------------------------------------

# Tham số thêm cho `supabase start`. CI dùng -x để bỏ các dịch vụ test không cần (nhanh hơn).
SUPABASE_START_ARGS ?=

# Cổng `next start` khi chạy e2e (khác 3000 để không đụng `pnpm dev`).
E2E_PORT ?= 3100

# Tham số thêm cho `playwright install` (CI dùng --with-deps để cài thư viện hệ thống).
PLAYWRIGHT_INSTALL_ARGS ?=

check-supabase:
	@command -v supabase >/dev/null 2>&1 || { \
		echo "::error::Thiếu Supabase CLI. Cài: brew install supabase/tap/supabase (xem https://supabase.com/docs/guides/local-development/cli/getting-started)"; \
		exit 1; }
	@docker info >/dev/null 2>&1 || { \
		echo "::error::Docker chưa chạy. Bật Docker Desktop hoặc Colima (colima start) rồi chạy lại."; \
		exit 1; }

# Khởi động stack Supabase cục bộ và áp migration (lần đầu sẽ kéo image, khá lâu).
db-start: check-supabase
	supabase start $(SUPABASE_START_ARGS)

db-stop: check-supabase
	supabase stop

# Dựng lại CSDL cục bộ từ đầu: chạy toàn bộ migration rồi supabase/seed.sql.
# Xóa sạch dữ liệu cục bộ, kể cả tài khoản thử (chạy lại db-seed sau đó).
db-reset: check-supabase
	supabase db reset

# Tạo/cập nhật tài khoản thử cho 4 persona. Cần SEED_PASSWORD (shell hoặc .env.local).
db-seed: check-supabase
	node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file-if-exists=.env.local scripts/seed-local-users.ts

# Chạy test pgTAP (RLS, schema) trong supabase/tests/ trên stack cục bộ. db-test là tên cũ.
test-db: check-supabase
	supabase test db

db-test: test-db

# Test tích hợp (tests/integration/) trên stack cục bộ. Lấy URL và khóa từ `supabase status`
# (không in ra màn hình). Gọi target này mà stack chưa chạy thì ĐỎ, không lặng lẽ bỏ qua;
# riêng `make test` không có các biến này sẽ bỏ qua nhóm test đó.
test-integration: check-pnpm check-supabase
	@eval "$$(supabase status -o env 2>/dev/null)"; \
	if [ -z "$$API_URL" ] || [ -z "$$ANON_KEY" ] || [ -z "$$SERVICE_ROLE_KEY" ]; then \
		echo "::error::Không đọc được URL/khóa từ supabase status. Chạy make db-start trước."; \
		exit 1; fi; \
	SUPABASE_URL="$$API_URL" SUPABASE_ANON_KEY="$$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$$SERVICE_ROLE_KEY" MAILPIT_URL="$$MAILPIT_URL" \
	pnpm exec vitest run tests/integration

# Tải Chromium cho Playwright (chỉ chromium, đúng phiên bản @playwright/test trong lockfile).
e2e-install: check-pnpm
	pnpm exec playwright install $(PLAYWRIGHT_INSTALL_ARGS) chromium

# E2E (tests/e2e/): build ứng dụng trỏ vào Supabase cục bộ rồi chạy Playwright (Playwright tự bật
# `next start` ở cổng E2E_PORT). Cần stack đang chạy, tài khoản thử đã seed (make db-seed) và
# SEED_PASSWORD (shell hoặc .env.local). Ghi đè thư mục .next của `make build`.
test-e2e: check-pnpm check-supabase
	@eval "$$(supabase status -o env 2>/dev/null)"; \
	if [ -z "$$API_URL" ] || [ -z "$$ANON_KEY" ] || [ -z "$$SERVICE_ROLE_KEY" ]; then \
		echo "::error::Không đọc được URL/khóa từ supabase status. Chạy make db-start trước."; \
		exit 1; fi; \
	unset NODE_ENV; \
	export NEXT_PUBLIC_SUPABASE_URL="$$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$$ANON_KEY" E2E_PORT="$(E2E_PORT)"; \
	export SUPABASE_SERVICE_ROLE_KEY="$$SERVICE_ROLE_KEY"; \
	pnpm build && pnpm exec playwright test
