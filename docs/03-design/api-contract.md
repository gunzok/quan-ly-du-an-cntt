# Hợp đồng API

Ngày: 2026-11-13 · Pha 3 · Trạng thái: Chờ duyệt (phần 2: DB và API)
Quy ước: REST `/api/v1/<tài-nguyên>` (số nhiều, kebab-case), JSON, UTF-8. Xác thực bằng cookie phiên Supabase. Mọi endpoint kiểm tra vai trò ở máy chủ, RLS kiểm lần hai.

## 1. Quy ước chung
- **Thành công**: `200` (đọc, sửa), `201` (tạo, kèm `Location`), `204` (xóa).
- **Phân trang**: `?limit=50&cursor=<mã>`; phản hồi `{ "data": [...], "next_cursor": "..." | null }`. `limit` tối đa 100.
- **Sắp xếp, lọc**: `?sort=due_date`, `?status_id=...&assignee_id=...&priority=...&label_id=...&due_after=...&due_before=...&q=<từ khóa>`. `status_id` nhận nhiều id ngăn bằng dấu phẩy (tối đa 20); `due_after`, `due_before` (`YYYY-MM-DD`) tính cả hai đầu, loại task không có hạn, `due_after` > `due_before` là `400`; `q` tối đa 200 ký tự, bỏ dấu, không phân biệt hoa thường, mọi từ phải có, rỗng thì bỏ qua (E3-3). `sort` chưa làm. Đã làm ở E13-2 (PR 47): `sort=created_at|-created_at|updated_at|-updated_at` (con trỏ ghi trường sắp xếp, dùng sai trường thì `400`; thay cho `sort=due_date` ở trên), `assignee_id=me`, `created_by=<uuid|me>`, `open=true` (chưa hoàn thành), `overdue=true` (trễ hạn theo giờ Asia/Ho_Chi_Minh, hạn hôm nay chưa trễ). E3-4 (PR 49): `limit` tối đa 500 (mặc định 50). E8-3 (PR 52): task trả `blocked`, `blocked_by` (tối đa 5 id), `blocked_by_count`; `PATCH` đưa task chưa xong sang nhóm done khi còn task chặn mở vẫn `200` kèm `warnings: [{code: "blocked_by_open_task", task_ids}]`.
- **Thời gian**: ISO 8601 UTC; ngày: `YYYY-MM-DD`.
- **Phiên bản**: tiền tố `/api/v1`; thay đổi phá vỡ tương thích thì lên `/api/v2`.

## 2. Cấu trúc lỗi thống nhất
```json
{
  "error": {
    "code": "validation_failed",
    "message": "Dữ liệu không hợp lệ",
    "details": [{ "field": "title", "issue": "required" }],
    "request_id": "9f2c...",
    "message_key": "tasks.errors.invalid"
  }
}
```
| HTTP | `code` | Khi nào |
|---|---|---|
| 400 | `validation_failed` | Sai định dạng, thiếu trường |
| 401 | `unauthenticated` | Chưa đăng nhập, phiên hết hạn |
| 403 | `forbidden` | Đúng người nhưng không đủ quyền (vai trò, BR-02, BR-03, BR-07) |
| 404 | `not_found` | Không tồn tại, hoặc người dùng không được thấy (không lộ sự tồn tại, BR-10) |
| 409 | `conflict` | Vòng quan hệ (BR-05), vòng cha-con của subtask, trùng tên/quan hệ, PM cuối cùng, khóa chết hoặc lỗi tuần tự hóa (thử lại) |
| 422 | `business_rule_violated` | Vượt 3 cấp subtask, đóng task cha khi subtask chưa xong (BR-04, kèm `task_ids` tối đa 5 id chưa xong), cha không thấy hoặc khác dự án, vi phạm quy tắc nghiệp vụ khác (đã chốt theo ticket E2-4, thay bản đầu ghi 409) |
| 429 | `rate_limited` | Gọi quá nhiều |
| 500 | `internal_error` | Lỗi hệ thống, chỉ trả `request_id` |

`message` luôn tiếng Việt (không phá khách API). Từ E10-2, `error.message_key` (tùy chọn) là đường dẫn khóa trong từ điển giao diện (`lib/i18n/messages`), tự gắn một chỗ ở `apiErrorBody()` bằng cách tra ngược thông điệp; giao diện dịch theo `message_key`, rồi theo `message`, rồi theo `code`. `message_key` chỉ là khóa từ điển công khai, không chứa dữ liệu.

## 3. Danh sách endpoint
Vai trò: **A** Admin (toàn hệ thống), **P** PM, **M** Thành viên, **V** Người xem; P, M, V là vai trò **trong từng dự án** của người gọi (BR-01 sửa 2026-11-13). Quyền chỉ áp dụng trong dự án mà người đó là thành viên (Admin thấy tất cả).

| Phương thức, đường dẫn | Mô tả | Quyền | FR |
|---|---|---|---|
| `PATCH /api/v1/me` | Đã làm đủ ở E1-7 (PR 55): nhận `{full_name?, phone?, locale?}`, ít nhất một trường (thân rỗng `400`); từ chối trường lạ (`email`, `is_admin`, `is_active`, `department_id`); `full_name` 1..100 ký tự (NFC, chặn ký tự điều khiển và ký tự định hướng); `phone` đúng định dạng `profile_contacts`, `null` hoặc `""` là xóa; ghi bằng client phiên (RLS, quyền cột), không service_role; phản hồi chỉ chứa trường đã gửi, cookie `qlda_locale` chỉ khi đổi `locale`. Giao diện sáng/tối KHÔNG qua API: cookie `qlda_theme` theo trình duyệt (không thêm cột). Ghi `profiles` và `profile_contacts` là hai câu lệnh, chưa nguyên tử | A P M V | FR-17 |
| `GET /api/v1/me` | Hồ sơ của tôi (E1-7): `{id, email, full_name, phone, locale, is_admin, department {id, name}\|null, projects [{project_id, name, status, role}]}`; chưa đăng nhập `401`, bị khóa `403` | A P M V | FR-17 |
| `GET /api/v1/users` | Danh sách người dùng (`?department_id=`, `?q=`, phân trang cursor), có `department`, số dự án tham gia và `status` (`active`/`locked`/`invited`) | A (đầy đủ); P M V (trong dự án chung) | FR-02 |
| `GET/POST /api/v1/departments`, `PATCH /api/v1/departments/{id}` | Danh mục phòng ban (`?include_archived=`; PATCH `{name?, position?, archived?}`; tên duy nhất không phân biệt hoa thường: trùng thì `409`; không có DELETE, chỉ lưu trữ). `GET /api/v1/users?department_id=<uuid>\|none` lọc theo phòng ban; gán phòng ban đã lưu trữ: `400` | đọc: tất cả; ghi: A | FR-02 |
| `POST /api/v1/users/invitations` | Mời người dùng (`email`, `full_name?`, `department_id?`). Mời mới: `201` + `Location`; email đang chờ nhận lời mời: gửi lại, `200`; email đã có tài khoản dùng: `409` | A | FR-02 |
| `PATCH /api/v1/users/{id}` | Đổi phòng ban, cấp hoặc thu quyền Admin, khóa/mở (`is_active`, `is_admin`, `department_id`). Khóa xóa phiên và ban ở Auth. Tự khóa, tự thu quyền, khóa hoặc thu quyền Admin cuối cùng: `409` | A | FR-02 |
| `GET /api/v1/projects` | Dự án của tôi (E2-1). `?status=active\|archived` (mặc định `active`), `?q=` (lọc tên, chứa chuỗi, tối đa vài trăm ký tự), `?limit=`, `?cursor=` (cursor `(created_at, id)`). Mỗi dự án có `my_role`, `member_count`, `task_count`, `done_task_count`, `overdue_task_count`, `progress` (0-100, tính theo `completed_at`), `members_preview` (tối đa 3, PM trước); phản hồi thêm `counts: { active, archived }` cho nhãn tab | A P M V | FR-03 |
| `POST /api/v1/projects` | Tạo dự án (kèm `template_id` tùy chọn) | A P | FR-03, FR-04 |
| `GET/PATCH /api/v1/projects/{id}` | Xem, sửa dự án | đọc: tất cả trong dự án; sửa: A P | FR-03 |
| `DELETE /api/v1/projects/{id}` | Xóa vĩnh viễn (BR-11); PM dùng `PATCH` đặt `status = archived` để lưu trữ | A (chỉ Admin, sếp chốt 2026-11-13) | FR-03 |
| `GET /api/v1/projects/{id}/members`, `GET .../members/{user_id}` | Danh sách thành viên (PM trước, rồi Thành viên, Người xem), mỗi dòng có `user {id, full_name, email, is_active, department}` (E1-6) | A P M V | FR-02 |
| `PUT /api/v1/projects/{id}/members/{user_id}` | Thêm thành viên hoặc đổi vai trò (`{role}`: `pm`/`member`/`viewer`). Thêm mới `201` + `Location`; đổi hoặc PUT lại cùng vai trò `200` (idempotent). Người đích bị khóa hoặc không tồn tại `422`; hạ PM cuối cùng `409`; vai trò được kiểm trước schema | A P (PM của dự án đó) | FR-02, FR-03 |
| `DELETE /api/v1/projects/{id}/members/{user_id}` | Bỏ thành viên (`204`; không phải thành viên `404`; PM cuối cùng `409`). Task của người bị gỡ giữ nguyên `assignee_id` | A P | FR-03 |
| `GET /api/v1/users/search?q=&exclude_project_id=&limit=` | Tìm người để thêm vào dự án: chỉ id, `full_name`, `email`, phòng ban; người đang hoạt động; `q` 2 đến 100 ký tự (ILIKE, chưa bỏ dấu); tối đa 20 dòng. **Ngoại lệ có chủ ý** của quy tắc "không trả email ngoài dự án chung": PM xem được mọi hồ sơ (sếp chốt 2026-11-13) | A, PM của ≥1 dự án (M, V: `403`) | FR-02 |
| `GET/POST /api/v1/projects/{id}/statuses` | Trạng thái tùy chỉnh (`name`, `category`: `todo`/`in_progress`/`done`, `color`, `position`). Đã làm (E2-3) | đọc: tất cả; ghi: A P | FR-06 |
| `PATCH/DELETE /api/v1/statuses/{id}` | Sửa, xóa trạng thái. `DELETE ...?replace_with=<uuid>` chuyển task sang trạng thái khác rồi xóa cùng giao dịch; đang dùng mà không có `replace_with`: `409`; thay thế sai, hoặc xóa trạng thái cuối của nhóm todo/done: `422`; tên trùng: `409` | A P | FR-06 |
| `GET/POST /api/v1/projects/{id}/labels`, `PATCH/DELETE /api/v1/labels/{id}` | Nhãn (E2-3) | đọc: tất cả; ghi: A P | FR-06 |
| `GET/POST /api/v1/projects/{id}/task-types`, `PATCH/DELETE /api/v1/task-types/{id}` | Loại task (`name`, `is_milestone`, `color`, `position`); xóa có `?replace_with=` như trạng thái (E2-3) | đọc: tất cả; ghi: A P | FR-23 |
| `GET /api/v1/projects/{id}/tasks` | Danh sách, Kanban, tìm kiếm, lọc. Đã làm (E2-2, E2-3): phân trang cursor `(created_at, id)` mới nhất trước, lọc `assignee_id`, `status_id`, `priority`, `label_id`; tìm kiếm bỏ dấu `q`, `status_id` nhiều giá trị, `due_after`/`due_before` (E3-3, xem mục 1). Task trả `status_id`, `type_id`, `label_ids`, `parent_id`, `depth`; `POST/PATCH` nhận `status_id`, `type_id`, `label_ids` (thuộc dự án khác: `422`) và `parent_id` (E2-4: cha không thấy hoặc khác dự án `422`, vượt 3 cấp `422`, vòng `409`, không sửa được cha `403`, đóng cha khi con chưa xong `422` kèm `task_ids`). Chưa có lọc `parent_id` (E2-5 cần) | A P M V | FR-08, FR-09 |
| `POST /api/v1/projects/{id}/tasks` | Tạo task hoặc subtask (`parent_id`) | A P M | FR-05, FR-07 |
| `GET /api/v1/tasks/{id}` | Chi tiết task (E2-5): thêm `parent {id,title}\|null`, `subtasks[]` (cây con tóm tắt theo thứ tự cây, tối đa 200, `subtasks_truncated`), `permissions {can_edit, can_delete, can_reassign, can_add_subtask}` của người gọi (chỉ để khóa giao diện; PATCH/DELETE/POST vẫn tự kiểm, RLS quyết định cuối). Quan hệ lấy qua `/tasks/{id}/relations` | A P M V | FR-05 |
| `PATCH /api/v1/tasks/{id}` | Sửa, đổi trạng thái, kéo thả (`status_id`, `position`). `expected_updated_at` (tùy chọn, E2-5): lệch `updated_at` hiện tại thì `409` (`message_key` `taskDetail.errors.stale`), không ghi, kiểm nguyên tử trong câu UPDATE; không gửi thì người sửa sau thắng. Kanban (E3-1) chèn `position` vào điểm giữa hai thẻ hàng xóm, chỉ PATCH một task; hai hàng xóm trùng position thì dãn tối đa 20 thẻ có quyền sửa; đổi thứ tự trong cột không ghi nhật ký (position bị loại khỏi `activity_logs`), đổi cột thì có | A P; M nếu phụ trách hoặc tạo (BR-03) | FR-05, FR-08 |
| `DELETE /api/v1/tasks/{id}` | Xóa vĩnh viễn. **Từ QLDA-81 (PR 61): task còn việc con (bất kỳ cấp) bị từ chối `422` (`business_rule_violated`) kèm `subtask_count`**; phải xóa hoặc chuyển việc con trước (`parent_id` đổi bằng PATCH). Xóa cả dự án và xóa tài khoản vẫn dây chuyền bình thường | A P; M nếu mình tạo | FR-05 |
| `GET /api/v1/tasks/{id}/relations` | Quan hệ cả hai chiều (E8-1). Mỗi phần tử: `id`, `kind`, `direction` (`outgoing`/`incoming`), `relation` (kiểu hiển thị: `relates`, `blocks`, `blocked_by`, `precedes`, `follows`, `duplicates`, `duplicated_by`), `lag_days`, `task` `{id, title, status_id}`, `created_by`, `created_at` | A P M V (thấy cả hai task) | FR-10 |
| `GET /api/v1/tasks/{id}/relations/{relation_id}` | Một quan hệ (đích của `Location` khi tạo) | giống trên | FR-10 |
| `POST /api/v1/tasks/{id}/relations` | Đặt quan hệ (`kind`: `relates`/`blocks`/`precedes`/`duplicates`, `to_task_id`, `lag_days?` chỉ cho `precedes`, ±365). `201` + `Location`. Tự quan hệ hoặc khác dự án: `422`; trùng hoặc tạo vòng: `409` (`blocks` và `precedes` chung một đồ thị) | A P M (có quyền sửa cả hai task) | FR-10 |
| `DELETE /api/v1/tasks/{id}/relations/{relation_id}` | Bỏ quan hệ (`204`), gọi được từ task ở đầu nào của quan hệ | giống trên | FR-10 |
| `GET /api/v1/projects/{id}/gantt` | Dữ liệu Gantt: task có `start_date`, `due_date`, quan hệ, theo khoảng thời gian (`from`, `to`) | A P M V | FR-20 |
| `GET/POST /api/v1/projects/{id}/views`, `GET /api/v1/views/{id}` | Chế độ xem đã lưu (E13-1). `POST {name, query, visibility?}` → `201` + `Location`; trùng tên (không phân biệt hoa thường, theo chủ sở hữu) `409`. Mỗi chế độ xem trả `is_favorite` (của người gọi) và `can_edit`. `query` v1 = `{version: 1, filters, sort, group_by, columns, display}`, `filters` dùng đúng tham số của `GET /tasks` (`status_id` dạng mảng); khóa lạ `400` | đọc: A P M V (riêng tư chỉ chủ sở hữu); ghi: mọi vai trò cho chế độ xem riêng; PM, Admin cho công khai | FR-19 |
| `PATCH/DELETE /api/v1/views/{id}` | Sửa (`{name?, query?, visibility?, is_favorite?}`), xóa chế độ xem; không áp dụng cho chế độ xem mặc định. Body chỉ có `is_favorite` thì chỉ cần quyền đọc. Chỉ chủ sở hữu được đổi công khai về riêng tư | chủ sở hữu; PM, Admin với chế độ xem công khai | FR-19 |
| `GET /api/v1/task-types` | Loại task của dự án (`?project_id=`); đã làm ở E2-3 | A P M V | FR-23 |
| `GET /api/v1/notifications` | Thông báo của tôi (E4-1, PR 43): `?limit=1..50`, `?cursor=`, `?unread=true|false`; phản hồi `{data, next_cursor, unread_count}`, mỗi thông báo có `task_visible` (false thì `title`, `status_name`, `actor` là null, chống lộ khi mất quyền). Loại: `task_assigned`, `task_status_changed`. Không ai tự tạo, chỉ trigger | A P M V | FR-11 |
| `GET /api/v1/notifications/unread-count` | Số chưa đọc (nhẹ, chuông poll 60 giây) | A P M V | FR-11 |
| `POST /api/v1/notifications/read-all` | Đánh dấu tất cả đã đọc | A P M V | FR-11 |
| `POST /api/v1/notifications/{id}/read` | Đánh dấu đã đọc | A P M V | FR-11 |
| `GET/PUT /api/v1/me/notification-preferences` | Bật tắt email theo loại (E4-2, PR 62). E4-3 (PR 66) thêm loại `task_due_soon` (nhắc hạn, mặc định bật); thông báo có thêm `due_date`, `days_left`. Mặc định khi chưa lưu: giao việc bật, đổi trạng thái tắt. Client phiên, từ chối trường lạ | A P M V | FR-12 |
| `POST /api/internal/email/dispatch` (GET cho Vercel Cron) | Worker gửi email trong hàng đợi `email_outbox`, **không phải API người dùng**: không phiên, không kiểm Origin (proxy bỏ qua `/api/internal/`); xác thực bằng `Authorization: Bearer <CRON_SECRET>` (≥ 32 ký tự, so khớp thời gian hằng), thiếu cấu hình thì từ chối mọi lời gọi. Thử lại tối đa 3 lần (giãn cách 1, 5, 15 phút) | máy gọi (pg_cron + pg_net, Vercel Cron) | FR-12 |
| `GET /api/v1/projects/{id}/dashboard` | Số liệu tiến độ (E5-1, hàm SQL `public.project_dashboard(project, today)` SECURITY INVOKER, một lời gọi): tổng, đã xong, đang làm, trễ hạn (`due_date` < hôm nay giờ Việt Nam và chưa xong), không hạn, bị chặn, phần trăm hoàn thành (cùng công thức S02), phân bố theo trạng thái (kèm nhóm), loại, ưu tiên, người phụ trách (kể cả chưa giao và người đã bị gỡ), 10 task trễ hạn sớm nhất. Chưa có xu hướng theo tuần. Đo 2.000 task: P95 259 ms | A P M V thuộc dự án (người ngoài `404`) | FR-13 |
| `POST /api/v1/projects/{id}/reports` | Xuất báo cáo (`format`: `xlsx`/`docx`, kỳ báo cáo). **xlsx đã làm ở E5-3 (PR 63)**: thứ tự kiểm Origin → phiên → 404 → vai trò 403 → schema 400 (kỳ ngược hoặc > 366 ngày) → giới hạn `export` 10/10 phút `429` → `422` (`report_template_missing` khi không có template đang dùng, template hỏng, kỳ > 10.000 task); trần 25 giây `504 report_timeout`; thành công `200` tệp `attachment` và ghi `report_exports`. Quy ước ô giữ chỗ: [report-template-xlsx.md](report-template-xlsx.md). `GET /api/v1/report-templates/sample?format=xlsx` (A, P) tải template xlsx MẪU. **docx đã làm ở E5-4 (PR 67)**: cùng thứ tự kiểm, lỗi và quyền; `422 report_template_missing` theo định dạng; quy ước ô giữ chỗ docx: [report-template-docx.md](report-template-docx.md); `GET /api/v1/report-templates/sample?format=docx` tải template docx MẪU. Đo 2.000 task: xlsx P50 136 ms (RSS đỉnh 218 MB), docx P50 465 ms (RSS đỉnh 399 MB). Đo 2.000 task: P50 146 ms | A P | FR-14, FR-15 |
| `GET /api/v1/projects/{id}/activity` | Nhật ký dự án (E6-2, PR 51): mới nhất trước, con trỏ `[created_at, id]`; lọc `actor_id`, `from`/`to` (`YYYY-MM-DD` giờ Việt Nam, tính cả hai đầu), `entity_type`, `action`, `limit` 1..100; `changes` chỉ trường trong danh sách cho phép, mô tả chỉ báo "đã sửa", id đổi thành `{id, name}` (đã xóa thì `name: null`); email chỉ cho Admin hoặc thành viên hiện tại | A P (Thành viên, Người xem `403`; người ngoài `404`) | FR-16 |
| `GET /api/v1/tasks/{id}/activity` | Nhật ký một task (E6-2): chỉ `limit`, `cursor` | A P | FR-16 |
| `GET/POST /api/v1/project-templates` | Template dự án | đọc: A P; ghi: A P | FR-04 |
| `GET/POST /api/v1/report-templates`, `PATCH/DELETE /api/v1/report-templates/{id}`, `GET /api/v1/report-templates/{id}/file` | Template báo cáo (E5-2, PR 48): `POST` multipart `file`, `name?`; kiểm phía máy chủ đuôi, MIME, chữ ký OOXML, macro, ZIP bomb (giải nén thật có trần), tên tệp do máy chủ sinh UUID; giới hạn 4 MiB (Vercel chặn thân 4,5 MB); `413 payload_too_large`, `422` sai loại/chữ ký/macro; mỗi định dạng tối đa một template đang dùng; `DELETE` xóa thật (dòng và tệp); tải tệp qua API (không URL ký) | đọc: A P; ghi: A | BR-08 |

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
