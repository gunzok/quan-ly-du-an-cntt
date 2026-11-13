# Thiết kế cơ sở dữ liệu

Ngày: 2026-11-13 · Pha 3 · Trạng thái: Chờ duyệt (phần 2: DB và API)
Quy ước: bảng `snake_case` số nhiều, cột `snake_case`, khóa chính `id uuid`, thời gian `timestamptz` (`created_at`, `updated_at`). Postgres chuẩn trên Supabase (ADR-001), không dùng tính năng khó chuyển đi.

## 1. ERD
```mermaid
erDiagram
    profiles ||--o{ project_members : "tham gia"
    projects ||--o{ project_members : "có"
    projects ||--o{ task_statuses : "định nghĩa"
    projects ||--o{ labels : "định nghĩa"
    projects ||--o{ tasks : "chứa"
    task_statuses ||--o{ tasks : "trạng thái"
    tasks ||--o{ tasks : "subtask (parent_id)"
    tasks ||--o{ task_labels : "gắn"
    labels ||--o{ task_labels : "gắn"
    tasks ||--o{ task_dependencies : "bị chặn bởi"
    profiles ||--o{ tasks : "phụ trách"
    profiles ||--o{ notifications : "nhận"
    profiles ||--o{ notification_preferences : "cấu hình"
    projects ||--o{ activity_logs : "ghi"
    profiles ||--o{ activity_logs : "thực hiện"
    project_templates ||--o{ projects : "tạo từ"
    report_templates ||--o{ report_exports : "dùng"
    projects ||--o{ report_exports : "xuất"
```

## 2. Từ điển dữ liệu
| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `profiles` | `id` (= `auth.users.id`), `full_name`, `email`, `role` (`admin`/`pm`/`member`/`viewer`), `locale` (`vi`/`en`), `is_active` | Vai trò toàn hệ thống (BR-01). Chỉ họ tên, email (NFR-14) |
| `projects` | `id`, `name`, `description`, `start_date`, `end_date`, `status` (`active`/`archived`), `created_by`, `template_id` | FR-03 |
| `project_members` | `project_id`, `user_id`, `joined_at` | Khóa chính (`project_id`, `user_id`); quyết định ai thấy dự án (BR-10) |
| `task_statuses` | `id`, `project_id`, `name`, `category` (`todo`/`in_progress`/`done`), `position` | Trạng thái tùy chỉnh (FR-06); `category` để tính tiến độ |
| `labels` | `id`, `project_id`, `name`, `color` | FR-06 |
| `tasks` | `id`, `project_id`, `parent_id`, `depth` (1-3), `title`, `description`, `assignee_id`, `created_by`, `priority` (`low`/`medium`/`high`/`urgent`), `due_date`, `status_id`, `position`, `completed_at` | `depth` ≤ 3 (FR-07) |
| `task_labels` | `task_id`, `label_id` | Nhiều nhiều |
| `task_dependencies` | `task_id`, `blocked_by_task_id` | Không vòng (BR-05); không tự chặn chính mình |
| `notifications` | `id`, `user_id`, `type`, `task_id`, `payload jsonb`, `read_at`, `created_at` | FR-11 |
| `notification_preferences` | `user_id`, `type`, `email_enabled` | FR-12 |
| `activity_logs` | `id`, `project_id`, `actor_id`, `entity_type`, `entity_id`, `action`, `changes jsonb` (trước, sau), `created_at` | Chỉ INSERT (BR-09) |
| `project_templates` | `id`, `name`, `structure jsonb` (trạng thái, nhãn, cây task), `created_by` | FR-04 |
| `report_templates` | `id`, `kind` (`xlsx`/`docx`), `name`, `storage_path`, `uploaded_by`, `is_active` | Template công ty (BR-08); tệp ở Storage |
| `report_exports` | `id`, `project_id`, `template_id`, `format`, `period_start`, `period_end`, `requested_by`, `created_at` | Ghi ai xuất báo cáo nào |

## 3. Ràng buộc và trigger
- `tasks.depth`: trigger đặt `depth = parent.depth + 1`; từ chối nếu vượt 3.
- `task_dependencies`: trigger từ chối vòng phụ thuộc (BR-05) bằng truy vấn đệ quy.
- BR-04: trigger chặn đặt task cha thuộc trạng thái `done` khi còn subtask chưa `done`.
- `tasks.status_id` phải thuộc đúng `project_id` của task.
- BR-06: không chặn cứng; cảnh báo xử lý ở tầng ứng dụng, đọc từ `task_dependencies`.

## 4. Chỉ mục
| Chỉ mục | Phục vụ |
|---|---|
| `tasks (project_id, status_id, position)` | Kanban |
| `tasks (project_id, assignee_id)` | Lọc theo người phụ trách |
| `tasks (project_id, due_date)` | Nhắc hạn, trễ hạn |
| `tasks (parent_id)` | Subtask |
| `tasks` GIN trên `to_tsvector('simple', title \|\| ' ' \|\| coalesce(description,''))` | Tìm kiếm (FR-09); cấu hình tiếng Việt cần kiểm chứng, **[CẦN XÁC NHẬN]** cách xử lý dấu |
| `activity_logs (project_id, created_at desc)` | Xem nhật ký |
| `notifications (user_id, read_at, created_at desc)` | Chuông thông báo |
| `project_members (user_id)` | Danh sách dự án của một người |

## 5. Phân quyền hàng (RLS)
| Bảng | Người xem | Thành viên | PM | Admin |
|---|---|---|---|---|
| `projects` | Đọc dự án mình thuộc | Đọc dự án mình thuộc | Đọc, sửa dự án mình thuộc, tạo mới | Toàn quyền |
| `tasks` | Đọc | Đọc; sửa task mình phụ trách hoặc tạo (BR-03); tạo task | Đọc, sửa mọi task trong dự án | Toàn quyền |
| `activity_logs` | Không | Không | Đọc nhật ký dự án mình thuộc | Đọc tất cả |
| `profiles` | Đọc tên người cùng dự án | Giống Người xem; sửa hồ sơ của mình | Giống Thành viên | Toàn quyền, đổi vai trò |
| `report_templates` | Không | Không | Đọc | Toàn quyền |
| `notifications` | Chỉ của mình | Chỉ của mình | Chỉ của mình | Chỉ của mình |
`activity_logs` không có chính sách UPDATE/DELETE cho bất kỳ vai trò nào. Mọi chính sách có kiểm thử riêng (xem [test-strategy.md](test-strategy.md)).

## 6. Migration
- Mỗi thay đổi là một tệp SQL trong `supabase/migrations/` (đặt tên theo thời gian), chạy được từ đầu trên CSDL trống.
- Không sửa migration đã merge; thay đổi mới là migration mới.
- Seed dữ liệu giả ở `supabase/seed.sql`, không dữ liệu thật (repo công khai).
- Trước khi chạy migration ở production phải qua staging và có bản sao lưu (NFR-05).

## 7. Lưu trữ và xóa dữ liệu
- MVP xóa task, dự án vĩnh viễn (BR-11, R-007); xóa dự án xóa theo task, nhãn, trạng thái, thành viên (`ON DELETE CASCADE`). Nhật ký của dự án bị xóa vẫn giữ được hay không: **[CẦN XÁC NHẬN]**.
- Người dùng bị khóa: giữ hồ sơ (`is_active = false`), không xóa để giữ lịch sử.
- Thời gian lưu nhật ký và thông báo: **[CẦN XÁC NHẬN]** (đề xuất nhật ký 24 tháng, thông báo đã đọc 90 ngày).
- Sao lưu: RPO 24 giờ, RTO 4 giờ là đề xuất (NFR-05, chưa xác nhận); chính sách sao lưu của từng gói Supabase chưa xác minh từ trang chính thức, cần kiểm tra trước khi vận hành thật (R-008).
