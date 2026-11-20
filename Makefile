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
	e2e-install test-e2e perf-seed perf-clean perf perf-report \
	deploy-smoke check-migrations lint-workflows db-backup email-dispatch reminders-run

# Lỗi mức này trở lên trong pnpm audit sẽ làm security đỏ.
AUDIT_LEVEL ?= high

# Định dạng đo ở perf-report (cách nhau bằng dấu phẩy).
PERF_REPORT_FORMATS ?= xlsx,docx

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
# Ngoại lệ audit có hạn (auditConfig.ignoreGhsas trong pnpm-workspace.yaml): chỉ GHSA-fc5q-39xc-vjpf
# (picomatch, chỉ công cụ phát triển), rà lại trước 2026-12-18 — xem docs/03-design/security.md mục 7.
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
# SUPABASE_SERVICE_ROLE_KEY (khóa của stack CỤC BỘ, chỉ phía máy chủ, không vào bundle) cho API
# quản trị mà màn /admin/users gọi.
# Đăng nhập có giới hạn tần suất (E0-5): mỗi lần chạy dùng RATE_LIMIT_SECRET ngẫu nhiên để bộ đếm
# không cộng dồn giữa các lần chạy lại hay giữa các worktree dùng chung stack.
# Email (luồng 7 ở tests/e2e/flows/): ứng dụng bật worker gửi email vào Mailpit cục bộ, CRON_SECRET
# ngẫu nhiên mỗi lần chạy (test gọi /api/internal/email/dispatch như pg_cron), APP_BASE_URL trỏ server e2e.
# E2E_ARGS: tham số thêm cho Playwright, ví dụ E2E_ARGS=--project=flows chỉ chạy 9 luồng chính (E0-9).
E2E_ARGS ?=
test-e2e: check-pnpm check-supabase
	@eval "$$(supabase status -o env 2>/dev/null)"; \
	if [ -z "$$API_URL" ] || [ -z "$$ANON_KEY" ] || [ -z "$$SERVICE_ROLE_KEY" ]; then \
		echo "::error::Không đọc được URL/khóa từ supabase status. Chạy make db-start trước."; \
		exit 1; fi; \
	unset NODE_ENV; \
	export NEXT_PUBLIC_SUPABASE_URL="$$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$$ANON_KEY" E2E_PORT="$(E2E_PORT)"; \
	export SUPABASE_SERVICE_ROLE_KEY="$$SERVICE_ROLE_KEY" RATE_LIMIT_SECRET="e2e-$$(date +%s)-$$$$"; \
	export E2E_RELAXED_LOGIN_RATE_LIMIT=1; \
	export CRON_SECRET="e2e-cron-$$(openssl rand -hex 16)" EMAIL_PROVIDER=mailpit MAILPIT_URL="$$MAILPIT_URL"; \
	export APP_BASE_URL="http://localhost:$(E2E_PORT)"; \
	pnpm build && pnpm exec playwright test $(E2E_ARGS)

# ---------------------------------------------------------------------------
# Hiệu năng (Story E0-7, NFR-02). KHÔNG chạy trong CI mặc định (tốn vài phút); chạy cục bộ trước
# mỗi lần phát hành. Cần stack đang chạy và SEED_PASSWORD (shell hoặc .env.local) như db-seed.
# Chỉ đụng dự án "[PERF] Dự án 2000 task" và tài khoản perf-*@example.com: không reset CSDL, không
# đổi mật khẩu persona của db-seed (an toàn trên stack dùng chung).
# ---------------------------------------------------------------------------

# Tạo dự án perf (PERF_TASKS task, mặc định 2000) với 12 tài khoản giả. Chạy lại không nhân đôi.
perf-seed: check-supabase
	node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file-if-exists=.env.local scripts/perf/seed.ts

# Xóa dự án perf và tài khoản perf (nhật ký activity_logs vẫn giữ, bảng chỉ thêm theo BR-09).
perf-clean: check-supabase
	node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file-if-exists=.env.local scripts/perf/seed.ts --clean

# Đo P50/P95/P99 các API chính bằng phiên PM perf; thoát khác 0 khi P95 vượt ngưỡng
# (scripts/perf/stats.ts; chỉnh bằng PERF_P95_MS, PERF_THRESHOLDS). Mặc định build rồi tự bật
# `next start` ở PERF_PORT (3200); đặt PERF_BASE_URL để đo ứng dụng đang chạy sẵn (bỏ bước build).
# RATE_LIMIT_SECRET ngẫu nhiên như test-e2e để bộ đếm giới hạn tần suất không cộng dồn giữa các lần.
perf: check-pnpm check-supabase
	@eval "$$(supabase status -o env 2>/dev/null)"; \
	if [ -z "$$API_URL" ] || [ -z "$$ANON_KEY" ] || [ -z "$$SERVICE_ROLE_KEY" ]; then \
		echo "::error::Không đọc được URL/khóa từ supabase status. Chạy make db-start trước."; \
		exit 1; fi; \
	unset NODE_ENV; \
	export NEXT_PUBLIC_SUPABASE_URL="$$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$$ANON_KEY"; \
	export SUPABASE_SERVICE_ROLE_KEY="$$SERVICE_ROLE_KEY" RATE_LIMIT_SECRET="perf-$$(date +%s)-$$$$"; \
	if [ -z "$$PERF_BASE_URL" ]; then pnpm build || exit 1; fi; \
	node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file-if-exists=.env.local scripts/perf/measure.ts

# Đo xuất báo cáo xlsx và docx trên dự án perf 2.000 task (Story E5-3, E5-4, E5-5; NFR-03 < 30 giây):
# thời gian, bộ nhớ, số dòng. Cần make perf-seed trước; không cần SEED_PASSWORD (tạo PM tạm).
# PERF_REPORT_ITERATIONS (mặc định 5, tối đa 10), PERF_REPORT_FORMATS (mặc định xlsx,docx).
perf-report: check-pnpm check-supabase
	@eval "$$(supabase status -o env 2>/dev/null)"; \
	if [ -z "$$API_URL" ] || [ -z "$$ANON_KEY" ] || [ -z "$$SERVICE_ROLE_KEY" ]; then \
		echo "::error::Không đọc được URL/khóa từ supabase status. Chạy make db-start trước."; \
		exit 1; fi; \
	SUPABASE_URL="$$API_URL" SUPABASE_ANON_KEY="$$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$$SERVICE_ROLE_KEY" PERF_REPORT=1 PERF_REPORT_FORMATS="$(PERF_REPORT_FORMATS)" \
	pnpm exec vitest run tests/integration/reports-perf.test.ts --silent=false

# ---------------------------------------------------------------------------
# Triển khai (Story E0-2, E0-10). Hướng dẫn đầy đủ: docs/05-ops/README.md.
# ---------------------------------------------------------------------------

# Kiểm tra khói một bản đang chạy (cục bộ hoặc đã triển khai), không cần đăng nhập. Ví dụ:
#   make deploy-smoke URL=http://127.0.0.1:3100
#   make deploy-smoke URL=https://<tên>.vercel.app
# Tùy chọn: SMOKE_SUPABASE_URL, SMOKE_SUPABASE_ANON_KEY (xem đầu scripts/deploy/smoke.ts).
deploy-smoke:
	@test -n "$(URL)" || { echo "::error::Thiếu URL. Ví dụ: make deploy-smoke URL=http://127.0.0.1:3100"; exit 1; }
	node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/deploy/smoke.ts "$(URL)"

# Quy tắc migration so với nhánh gốc: không sửa/xóa migration đã merge, tên đúng dạng, không trùng
# và (cảnh báo) không lùi timestamp. MIGRATIONS_BASE mặc định origin/main.
MIGRATIONS_BASE ?= origin/main
check-migrations:
	node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/deploy/check-migrations.ts "$(MIGRATIONS_BASE)" HEAD

# Kiểm cú pháp workflow GitHub Actions (CI cài actionlint ghim phiên bản trong job lint).
lint-workflows:
	@command -v actionlint >/dev/null 2>&1 || { \
		echo "::error::Thiếu actionlint. Cài: brew install actionlint (hoặc tải bản phát hành tại https://github.com/rhysd/actionlint/releases)"; \
		exit 1; }
	actionlint

# Sao lưu tay CSDL staging/production về máy (ngoài repo). Cần Supabase CLI + Docker và chuỗi
# kết nối Session pooler (SUPABASE_DB_URL hoặc nhập ẩn). Ví dụ: make db-backup DEPLOY_ENV=production
db-backup:
	@test -n "$(DEPLOY_ENV)" || { echo "::error::Thiếu DEPLOY_ENV. Ví dụ: make db-backup DEPLOY_ENV=production"; exit 1; }
	scripts/deploy/backup.sh "$(DEPLOY_ENV)"

# ---------------------------------------------------------------------------
# Email (Story E4-2). Chạy tay worker gửi email một lần: gọi /api/internal/email/dispatch của
# ứng dụng đang chạy (mặc định http://localhost:3000, đổi bằng EMAIL_DISPATCH_URL) với CRON_SECRET
# (shell hoặc .env.local; ứng dụng phải chạy với cùng giá trị). Cục bộ email vào Mailpit
# http://127.0.0.1:54324. Môi trường thật do pg_cron + pg_net gọi (migration 20261115370000).
# ---------------------------------------------------------------------------
email-dispatch:
	node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file-if-exists=.env.local scripts/email-dispatch.ts

# ---------------------------------------------------------------------------
# Nhắc hạn (Story E4-3). Chạy tay public.run_due_reminders() một lần trên Supabase CỤC BỘ (khóa
# service_role lấy từ supabase status, không in ra). REMINDERS_NOW=<ISO 8601> giả lập "bây giờ",
# ví dụ: make reminders-run REMINDERS_NOW=2026-11-24T08:00:00+07:00; REMINDERS_PROJECT_ID=<uuid> chỉ
# xét một dự án. Môi trường thật do pg_cron chạy
# 01:00 UTC = 08:00 giờ Việt Nam (migration 20261115390000, docs/05-ops/nhac-han.md).
# ---------------------------------------------------------------------------
reminders-run: check-supabase
	@eval "$$(supabase status -o env 2>/dev/null)"; \
	if [ -z "$$API_URL" ] || [ -z "$$SERVICE_ROLE_KEY" ]; then \
		echo "::error::Không đọc được URL/khóa từ supabase status. Chạy make db-start trước."; \
		exit 1; fi; \
	SUPABASE_URL="$$API_URL" SUPABASE_SERVICE_ROLE_KEY="$$SERVICE_ROLE_KEY" REMINDERS_NOW="$(REMINDERS_NOW)" \
	REMINDERS_PROJECT_ID="$(REMINDERS_PROJECT_ID)" \
	node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/reminders-run.ts
