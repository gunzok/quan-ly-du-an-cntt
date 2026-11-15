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
| `PATCH /api/v1/me` | Đổi tên, số điện thoại, ngôn ngữ, giao diện sáng/tối | A P M V | FR-17 |
| `GET /api/v1/users` | Danh sách người dùng (`?department_id=`, `?q=`, phân trang cursor), có `department`, số dự án tham gia và `status` (`active`/`locked`/`invited`) | A (đầy đủ); P M V (trong dự án chung) | FR-02 |
| `GET/POST /api/v1/departments`, `PATCH /api/v1/departments/{id}` | Danh mục phòng ban (`?include_archived=`; PATCH `{name?, position?, archived?}`; tên duy nhất không phân biệt hoa thường: trùng thì `409`; không có DELETE, chỉ lưu trữ). `GET /api/v1/users?department_id=<uuid>\|none` lọc theo phòng ban; gán phòng ban đã lưu trữ: `400` | đọc: tất cả; ghi: A | FR-02 |
| `POST /api/v1/users/invitations` | Mời người dùng (`email`, `full_name?`, `department_id?`). Mời mới: `201` + `Location`; email đang chờ nhận lời mời: gửi lại, `200`; email đã có tài khoản dùng: `409` | A | FR-02 |
| `PATCH /api/v1/users/{id}` | Đổi phòng ban, cấp hoặc thu quyền Admin, khóa/mở (`is_active`, `is_admin`, `department_id`). Khóa xóa phiên và ban ở Auth. Tự khóa, tự thu quyền, khóa hoặc thu quyền Admin cuối cùng: `409` | A | FR-02 |
| `GET /api/v1/projects` | Dự án của tôi (E2-1). `?status=active\|archived` (mặc định `active`), `?q=` (lọc tên, chứa chuỗi, tối đa vài trăm ký tự), `?limit=`, `?cursor=` (cursor `(created_at, id)`). Mỗi dự án có `my_role`, `member_count`, `task_count`, `done_task_count`, `overdue_task_count`, `progress` (0-100, tính theo `completed_at`), `members_preview` (tối đa 3, PM trước); phản hồi thêm `counts: { active, archived }` cho nhãn tab | A P M V | FR-03 |
| `POST /api/v1/projects` | Tạo dự án (kèm `template_id` tùy chọn) | A P | FR-03, FR-04 |
| `GET/PATCH /api/v1/projects/{id}` | Xem, sửa dự án | đọc: tất cả trong dự án; sửa: A P | FR-03 |
| `DELETE /api/v1/projects/{id}` | Xóa vĩnh viễn (BR-11); PM dùng `PATCH` đặt `status = archived` để lưu trữ | A (chỉ Admin, sếp chốt 2026-11-13) | FR-03 |
| `PUT /api/v1/projects/{id}/members/{user_id}` | Thêm thành viên hoặc đổi vai trò trong dự án (`role`: `pm`/`member`/`viewer`) | A P (PM của dự án đó) | FR-02, FR-03 |
| `DELETE /api/v1/projects/{id}/members/{user_id}` | Bỏ thành viên | A P | FR-03 |
| `GET/POST /api/v1/projects/{id}/statuses` | Trạng thái tùy chỉnh (`name`, `category`: `todo`/`in_progress`/`done`, `color`, `position`). Đã làm (E2-3) | đọc: tất cả; ghi: A P | FR-06 |
| `PATCH/DELETE /api/v1/statuses/{id}` | Sửa, xóa trạng thái. `DELETE ...?replace_with=<uuid>` chuyển task sang trạng thái khác rồi xóa cùng giao dịch; đang dùng mà không có `replace_with`: `409`; thay thế sai, hoặc xóa trạng thái cuối của nhóm todo/done: `422`; tên trùng: `409` | A P | FR-06 |
| `GET/POST /api/v1/projects/{id}/labels`, `PATCH/DELETE /api/v1/labels/{id}` | Nhãn (E2-3) | đọc: tất cả; ghi: A P | FR-06 |
| `GET/POST /api/v1/projects/{id}/task-types`, `PATCH/DELETE /api/v1/task-types/{id}` | Loại task (`name`, `is_milestone`, `color`, `position`); xóa có `?replace_with=` như trạng thái (E2-3) | đọc: tất cả; ghi: A P | FR-23 |
| `GET /api/v1/projects/{id}/tasks` | Danh sách, Kanban, tìm kiếm, lọc. Đã làm (E2-2, E2-3): phân trang cursor `(created_at, id)` mới nhất trước, lọc `assignee_id`, `status_id`, `priority`, `label_id`; tìm kiếm bỏ dấu `q` và lọc đầy đủ ở E3-3 (đang làm). Task trả `status_id`, `type_id`, `label_ids`; `POST/PATCH` nhận `status_id`, `type_id`, `label_ids` (thuộc dự án khác: `422`) | A P M V | FR-08, FR-09 |
| `POST /api/v1/projects/{id}/tasks` | Tạo task hoặc subtask (`parent_id`) | A P M | FR-05, FR-07 |
| `GET /api/v1/tasks/{id}` | Chi tiết task, subtask, phụ thuộc | A P M V | FR-05 |
| `PATCH /api/v1/tasks/{id}` | Sửa, đổi trạng thái, kéo thả (`status_id`, `position`) | A P; M nếu phụ trách hoặc tạo (BR-03) | FR-05, FR-08 |
| `DELETE /api/v1/tasks/{id}` | Xóa vĩnh viễn | A P; M nếu mình tạo | FR-05 |
| `GET /api/v1/tasks/{id}/relations` | Quan hệ cả hai chiều (E8-1). Mỗi phần tử: `id`, `kind`, `direction` (`outgoing`/`incoming`), `relation` (kiểu hiển thị: `relates`, `blocks`, `blocked_by`, `precedes`, `follows`, `duplicates`, `duplicated_by`), `lag_days`, `task` `{id, title, status_id}`, `created_by`, `created_at` | A P M V (thấy cả hai task) | FR-10 |
| `GET /api/v1/tasks/{id}/relations/{relation_id}` | Một quan hệ (đích của `Location` khi tạo) | giống trên | FR-10 |
| `POST /api/v1/tasks/{id}/relations` | Đặt quan hệ (`kind`: `relates`/`blocks`/`precedes`/`duplicates`, `to_task_id`, `lag_days?` chỉ cho `precedes`, ±365). `201` + `Location`. Tự quan hệ hoặc khác dự án: `422`; trùng hoặc tạo vòng: `409` (`blocks` và `precedes` chung một đồ thị) | A P M (có quyền sửa cả hai task) | FR-10 |
| `DELETE /api/v1/tasks/{id}/relations/{relation_id}` | Bỏ quan hệ (`204`), gọi được từ task ở đầu nào của quan hệ | giống trên | FR-10 |
| `GET /api/v1/projects/{id}/gantt` | Dữ liệu Gantt: task có `start_date`, `due_date`, quan hệ, theo khoảng thời gian (`from`, `to`) | A P M V | FR-20 |
| `GET/POST /api/v1/projects/{id}/views` | Chế độ xem đã lưu (riêng, công khai, yêu thích) và chế độ xem mặc định | đọc: A P M V; ghi: mọi vai trò cho chế độ xem riêng; PM cho công khai | FR-19 |
| `PATCH/DELETE /api/v1/views/{id}` | Sửa, xóa chế độ xem (không áp dụng cho chế độ xem mặc định) | chủ sở hữu; PM với chế độ xem công khai | FR-19 |
| `GET /api/v1/task-types` | Loại task của dự án (`?project_id=`); đã làm ở E2-3 | A P M V | FR-23 |
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
- Giới hạn tần suất (E0-5, `lib/api/rate-limit.ts`, bộ đếm cửa sổ cố định trong Postgres): `/api/v1/*` 300 yêu cầu/phút/người dùng; xuất báo cáo 10 lần/10 phút/người dùng (để sẵn); đăng nhập 50 lần/5 phút/IP và 10 lần/15 phút/email; trang nhận lời mời (`/auth/accept-invite`, E1-8) 20 lần/15 phút/IP (`acceptInviteIp`). Vượt ngưỡng: `429 rate_limited` kèm `Retry-After`. Lỗi bộ đếm: API fail-open có ghi log, đăng nhập fail-closed.
- Mọi yêu cầu ghi (POST, PUT, PATCH, DELETE) tới `/api/*` phải có header `Origin` trùng origin ứng dụng, proxy kiểm trước cả phiên; sai thì `403 forbidden`.
- Lỗi nghiệp vụ của task: `422` cho BR-13 (`start_date` > `due_date`) và người được giao không phải PM/Thành viên đang hoạt động của dự án.
- Phản hồi 404 thay vì 403 cho tài nguyên người dùng không được thấy (BR-10).
- Không trả `email` của người dùng ngoài dự án chung với người gọi.
