# Hợp đồng giữa CI và dự án: CI chỉ gọi 4 target này.
# Các target dưới đây đang là STUB (chỉ cảnh báo, trả về thành công) để PR đầu tiên chạy được.
# BẮT BUỘC thay bằng lệnh thật sau khi chốt tech stack (Pha 2) và trước khi bắt đầu Pha 5.
# Khi thay xong, cập nhật mục "CI còn STUB" trong PROJECT_STATE.md.

.PHONY: lint test build security

lint:
	@echo "::warning::lint chưa được cấu hình (STUB). Thay bằng lệnh thật ở Pha 2."

test:
	@echo "::warning::test chưa được cấu hình (STUB). Thay bằng lệnh thật ở Pha 2."

build:
	@echo "::warning::build chưa được cấu hình (STUB). Thay bằng lệnh thật ở Pha 2."

security:
	@echo "::warning::security chưa được cấu hình (STUB). Thêm kiểm tra bí mật và phụ thuộc ở Pha 2."
