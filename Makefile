# Hợp đồng giữa CI và dự án: CI chỉ gọi 4 target lint, test, build, security
# (sau bước `make install`). Chạy cục bộ y hệt CI:
#   make install && make lint && make test && make build && make security
#
# Yêu cầu: Node theo .nvmrc, pnpm theo trường packageManager trong package.json,
# gitleaks (cho target security). Thiếu công cụ thì target báo lỗi kèm cách cài, không bỏ qua.

.PHONY: install lint test build security check-pnpm check-gitleaks

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
