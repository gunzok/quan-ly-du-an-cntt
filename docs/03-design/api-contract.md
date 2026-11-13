# Hợp đồng API

Ngày: 2026-11-13 · Pha 3 · Trạng thái: Chờ duyệt (phần 2: DB và API)
Quy ước: REST `/api/v1/<tài-nguyên>` (số nhiều, kebab-case), JSON, UTF-8. Xác thực bằng cookie phiên Supabase. Mọi endpoint kiểm tra vai trò ở máy chủ, RLS kiểm lần hai.

## 1. Quy ước chung
- **Thành công**: `200` (đọc, sửa), `201` (tạo, kèm `Location`), `204` (xóa).
- **Phân trang**: `?limit=50&cursor=<mã>`; phản hồi `{ "data": [...], "next_cursor": "..." | null }`. `limit` tối đa 100.
- **Sắp xếp, lọc**: `?sort=due_date`, `?status_id=...&assignee_id=...&priority=...&label_id=...&due_before=...&q=<từ khóa>`.
- **Thời gian**: ISO 8601 UTC; ngày: `YYYY-MM-DD`.
- **Phiên bản**: tiền tố `/api/v1`; thay đổi phá vỡ tương thích thì lên `/api/v2`.

## 2. Cấu trúc lỗi thống nhất
```json
{
  "error": {
    "code": "validation_failed",
    "message": "Dữ liệu không hợp lệ",
    "details": [{ "field": "title", "issue": "required" }],
    "request_id": "9f2c..."
  }
}
```
| HTTP | `code` | Khi nào |
|---|---|---|
| 400 | `validation_failed` | Sai định dạng, thiếu trường |
| 401 | `unauthenticated` | Chưa đăng nhập, phiên hết hạn |
| 403 | `forbidden` | Đúng người nhưng không đủ quyền (vai trò, BR-02, BR-03, BR-07) |
| 404 | `not_found` | Không tồn tại, hoặc người dùng không được thấy (không lộ sự tồn tại, BR-10) |
| 409 | `conflict` | Vòng quan hệ (BR-05), vượt 3 cấp subtask, đóng task cha khi subtask chưa xong (BR-04) |
| 422 | `business_rule_violated` | Vi phạm quy tắc nghiệp vụ khác |
| 429 | `rate_limited` | Gọi quá nhiều |
| 500 | `internal_error` | Lỗi hệ thống, chỉ trả `request_id` |

## 3. Danh sách endpoint
Vai trò: **A** Admin (toàn hệ thống), **P** PM, **M** Thành viên, **V** Người xem; P, M, V là vai trò **trong từng dự án** của người gọi (BR-01 sửa 2026-11-13). Quyền chỉ áp dụng trong dự án mà người đó là thành viên (Admin thấy tất cả).

| Phương thức, đường dẫn | Mô tả | Quyền | FR |
|---|---|---|---|
| `GET /api/v1/me` | Hồ sơ người đang đăng nhập | A P M V | FR-01 |
| `PATCH /api/v1/me` | Đổi ngôn ngữ, tên | A P M V | FR-17 |
| `GET /api/v1/users` | Danh sách người dùng (`?department_id=`, `?q=`), có `department` và số dự án tham gia | A (đầy đủ); P M V (trong dự án chung) | FR-02 |
| `GET/POST/PATCH /api/v1/departments` | Danh mục phòng ban | đọc: tất cả; ghi: A | FR-02 |
| `POST /api/v1/users/invitations` | Mời người dùng, gán vai trò | A | FR-02 |
| `PATCH /api/v1/users/{id}` | Đổi phòng ban, cấp hoặc thu quyền Admin, khóa/mở | A | FR-02 |
| `GET /api/v1/projects` | Dự án của tôi | A P M V | FR-03 |
| `POST /api/v1/projects` | Tạo dự án (kèm `template_id` tùy chọn) | A P | FR-03, FR-04 |
| `GET/PATCH /api/v1/projects/{id}` | Xem, sửa dự án | đọc: tất cả trong dự án; sửa: A P | FR-03 |
| `DELETE /api/v1/projects/{id}` | Xóa vĩnh viễn (BR-11) | A P | FR-03 |
| `PUT /api/v1/projects/{id}/members/{user_id}` | Thêm thành viên hoặc đổi vai trò trong dự án (`role`: `pm`/`member`/`viewer`) | A P (PM của dự án đó) | FR-02, FR-03 |
| `DELETE /api/v1/projects/{id}/members/{user_id}` | Bỏ thành viên | A P | FR-03 |
| `GET/POST /api/v1/projects/{id}/statuses` | Trạng thái tùy chỉnh | đọc: tất cả; ghi: A P | FR-06 |
| `GET/POST /api/v1/projects/{id}/labels` | Nhãn | đọc: tất cả; ghi: A P | FR-06 |
| `GET /api/v1/projects/{id}/tasks` | Danh sách, Kanban, tìm kiếm, lọc | A P M V | FR-08, FR-09 |
| `POST /api/v1/projects/{id}/tasks` | Tạo task hoặc subtask (`parent_id`) | A P M | FR-05, FR-07 |
| `GET /api/v1/tasks/{id}` | Chi tiết task, subtask, phụ thuộc | A P M V | FR-05 |
| `PATCH /api/v1/tasks/{id}` | Sửa, đổi trạng thái, kéo thả (`status_id`, `position`) | A P; M nếu phụ trách hoặc tạo (BR-03) | FR-05, FR-08 |
| `DELETE /api/v1/tasks/{id}` | Xóa vĩnh viễn | A P; M nếu mình tạo | FR-05 |
| `POST /api/v1/tasks/{id}/relations` | Đặt quan hệ (`kind`: `relates`/`blocks`/`precedes`/`duplicates`, `to_task_id`, `lag_days`) | A P M (có quyền sửa cả hai task) | FR-10 |
| `DELETE /api/v1/tasks/{id}/relations/{relation_id}` | Bỏ quan hệ | giống trên | FR-10 |
| `GET /api/v1/projects/{id}/gantt` | Dữ liệu Gantt: task có `start_date`, `due_date`, quan hệ, theo khoảng thời gian (`from`, `to`) | A P M V | FR-20 |
| `GET/POST /api/v1/projects/{id}/views` | Chế độ xem đã lưu (riêng, công khai, yêu thích) và chế độ xem mặc định | đọc: A P M V; ghi: mọi vai trò cho chế độ xem riêng; PM cho công khai | FR-19 |
| `PATCH/DELETE /api/v1/views/{id}` | Sửa, xóa chế độ xem (không áp dụng cho chế độ xem mặc định) | chủ sở hữu; PM với chế độ xem công khai | FR-19 |
| `GET /api/v1/task-types` | Loại task của dự án (`?project_id=`) | A P M V | FR-23 |
| `GET /api/v1/notifications` | Thông báo của tôi | A P M V | FR-11 |
| `POST /api/v1/notifications/{id}/read` | Đánh dấu đã đọc | A P M V | FR-11 |
| `GET/PUT /api/v1/me/notification-preferences` | Bật tắt email theo loại | A P M V | FR-12 |
| `GET /api/v1/projects/{id}/dashboard` | Số liệu tiến độ | A P V (và M thuộc dự án) | FR-13 |
| `POST /api/v1/projects/{id}/reports` | Xuất báo cáo (`format`: `xlsx`/`docx`, kỳ báo cáo) | A P | FR-14, FR-15 |
| `GET /api/v1/projects/{id}/activity` | Nhật ký dự án | A P | FR-16 |
| `GET /api/v1/tasks/{id}/activity` | Nhật ký một task | A P | FR-16 |
| `GET/POST /api/v1/project-templates` | Template dự án | đọc: A P; ghi: A P | FR-04 |
| `GET/POST /api/v1/report-templates` | Template báo cáo (tải lên) | đọc: A P; ghi: A | BR-08 |

Ghi chú: đăng nhập, đăng xuất, đăng nhập Google do Supabase Auth xử lý, không viết endpoint riêng ngoài trang gọi lại (`/auth/callback`).

## 4. Ví dụ
**Tạo task**: `POST /api/v1/projects/{id}/tasks`
```json
{ "title": "Thiết kế bảng Kanban", "assignee_id": "6c1e...", "priority": "high",
  "due_date": "2026-12-05", "status_id": "a31f...", "label_ids": ["f2d0..."] }
```
Phản hồi `201`:
```json
{ "data": { "id": "b7d4...", "project_id": "0e91...", "parent_id": null, "depth": 1,
  "title": "Thiết kế bảng Kanban", "priority": "high", "due_date": "2026-12-05",
  "assignee_id": "6c1e...", "status_id": "a31f...", "blocked": false,
  "created_at": "2026-11-13T03:10:00Z" } }
```

**Đặt quan hệ gây vòng**: `POST /api/v1/tasks/{A}/relations` với `{ "kind": "blocks", "to_task_id": "{B}" }` khi B đã chặn A → `409`:
```json
{ "error": { "code": "conflict", "message": "Quan hệ này tạo vòng", "request_id": "1b8a..." } }
```

**Kéo thả Kanban**: `PATCH /api/v1/tasks/{id}` với `{ "status_id": "c90a...", "position": 3 }`. Nếu task còn bị chặn bởi task chưa xong, phản hồi vẫn `200` kèm `"warnings": [{ "code": "blocked_by_open_task", "task_ids": ["..."] }]` (BR-06).

**Xuất báo cáo**: `POST /api/v1/projects/{id}/reports` với `{ "format": "xlsx", "period_start": "2026-11-01", "period_end": "2026-11-30" }`. Phản hồi `200` là tệp (`Content-Disposition: attachment`). Quá thời gian chờ: `504` với `code: "report_timeout"` (R-006). Thiếu template: `422` `code: "report_template_missing"`.

## 5. Bảo mật API
- Kiểm tra đầu vào bằng schema (ví dụ thư viện Zod) ở mọi endpoint; từ chối trường lạ.
- Giới hạn tần suất theo người dùng; xuất báo cáo giới hạn chặt hơn (NFR-03).
- Phản hồi 404 thay vì 403 cho tài nguyên người dùng không được thấy (BR-10).
- Không trả `email` của người dùng ngoài dự án chung với người gọi.
