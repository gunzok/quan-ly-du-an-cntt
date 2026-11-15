# Thiết kế cơ sở dữ liệu

Ngày: 2026-11-13 · Pha 3 · Trạng thái: Chờ duyệt (phần 2: DB và API)
Quy ước: bảng `snake_case` số nhiều, cột `snake_case`, khóa chính `id uuid`, thời gian `timestamptz` (`created_at`, `updated_at`). Postgres chuẩn trên Supabase (ADR-001), không dùng tính năng khó chuyển đi.

## 1. ERD
```mermaid
erDiagram
    departments ||--o{ profiles : "gồm"
    profiles ||--o{ project_members : "tham gia"
    projects ||--o{ project_members : "có"
    projects ||--o{ task_statuses : "định nghĩa"
    projects ||--o{ task_types : "định nghĩa"
    projects ||--o{ labels : "định nghĩa"
    projects ||--o{ tasks : "chứa"
    projects ||--o{ saved_views : "có"
    profiles ||--o{ saved_views : "tạo"
    task_statuses ||--o{ tasks : "trạng thái"
    task_types ||--o{ tasks : "loại"
    tasks ||--o{ tasks : "subtask (parent_id)"
    tasks ||--o{ task_labels : "gắn"
    labels ||--o{ task_labels : "gắn"
    tasks ||--o{ task_relations : "quan hệ"
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
| `departments` | `id`, `name`, `position`, `archived_at` | Phòng ban, danh mục do Admin quản lý (yêu cầu 2026-11-13). Tên duy nhất không phân biệt hoa thường (`departments_name_ci_key`); lưu trữ thay vì xóa, chỉ xóa cứng được phòng ban không còn ai (RLS + `private.department_has_members`) |
| `profiles` | `id` (= `auth.users.id`), `full_name`, `email`, `department_id`, `is_admin`, `locale` (`vi`/`en`), `is_active` | `is_admin` là quyền toàn hệ thống (BR-01 sửa 2026-11-13); vai trò nằm ở `project_members`. Chỉ họ tên, email, số điện thoại, phòng ban (NFR-14); `phone` do chính người dùng nhập, PM và Admin xem được |
| `profile_contacts` | `user_id` (PK, → `profiles`), `phone`, `updated_at` | Số điện thoại tách khỏi `profiles` vì RLS lọc theo hàng (E1-3, PR 14); chỉ chính chủ, PM của dự án chung và Admin đọc; chỉ chính chủ ghi; định dạng `^\+?[0-9][0-9 .()-]{5,19}$` |
| `projects` | `id`, `name`, `description`, `start_date`, `end_date`, `status` (`active`/`archived`), `created_by`, `template_id` | FR-03 |
| `project_members` | `project_id`, `user_id`, `role` (`pm`/`member`/`viewer`), `joined_at` | Khóa chính (`project_id`, `user_id`); vai trò theo từng dự án (BR-01), quyết định ai thấy dự án (BR-10) |
| `task_types` | `id`, `project_id`, `name`, `is_milestone`, `color`, `position`, `created_at`, `updated_at` | Loại task (FR-23); mặc định Task, Bug, Milestone (`is_milestone`), Phase (sếp chốt 2026-11-15). Tên duy nhất trong dự án không phân biệt hoa thường; màu `#RRGGBB`; `position` là số thực. E2-3 (PR 30) |
| `saved_views` | `id`, `project_id` (null nếu toàn cục), `owner_id`, `name`, `query jsonb` (bộ lọc, sắp xếp, nhóm, cột, chế độ hiển thị), `visibility` (`private`/`public`), `is_favorite` | Chế độ xem đã lưu (FR-19); chế độ xem mặc định tạo bằng seed, không sửa được |
| `task_statuses` | `id`, `project_id`, `name`, `category` (enum `task_status_category`: `todo`/`in_progress`/`done`), `color`, `position`, `created_at`, `updated_at` | Trạng thái tùy chỉnh (FR-06); `category` để tính tiến độ và đặt `completed_at`. Mặc định theo OpenProject (sếp chốt 2026-11-15): Mới (todo), Đang thực hiện, Đang kiểm thử, Cần phản hồi (in_progress), Đã xong, Đã đóng, Từ chối (done). Danh sách mặc định nằm duy nhất trong `private.seed_project_defaults()` (trigger AFTER INSERT trên `projects`, migration backfill dự án có sẵn). E2-3 |
| `labels` | `id`, `project_id`, `name`, `color`, `created_at`, `updated_at` | FR-06; tên duy nhất trong dự án không phân biệt hoa thường |
| `tasks` | `id`, `project_id`, `parent_id`, `depth` (1-3), `type_id`, `title`, `description`, `assignee_id`, `created_by`, `priority` (`low`/`medium`/`high`/`urgent`), `start_date`, `due_date`, `status_id`, `position`, `completed_at` | `depth` ≤ 3 (FR-07); `start_date` ≤ `due_date` (BR-13); hai ngày cho Gantt (FR-20, FR-21). Đã tạo ở E2-2 (`20261114090000_tasks.sql`): `position` là `double precision` (kéo thả chèn giữa không đánh số lại); `parent_id`/`depth` có cột nhưng chưa có trigger (E2-4 đang làm). E2-3 (`20261115130000`): `status_id`, `type_id` NOT NULL (backfill), **khóa ngoại kép** `(project_id, status_id) → task_statuses (project_id, id)` và tương tự cho loại (khai báo, không bỏ sót đường ghi nào, Postgres chặn xóa trạng thái đang dùng); trigger `apply_task_config` chỉ thêm mặc định (trạng thái todo đầu tiên, loại đầu tiên); `completed_at` do trigger đặt theo nhóm `done` của trạng thái (trình duyệt không có quyền cột này); quyền cột trình duyệt thêm INSERT/UPDATE `type_id`, `status_id`. E2-1: `projects` có ràng buộc `description` ≤ 5000 ký tự, chỉ mục `projects_status_created_idx`, hàm `public.project_stats(uuid[], date)` (SECURITY INVOKER nên RLS vẫn áp dụng; số thành viên, số task, số task đã xong theo `completed_at`, số task trễ hạn, vai trò của người gọi; hiệu năng chưa đo); trigger `check_assignee`: người được giao phải là PM hoặc Thành viên đang hoạt động của dự án; quyền cột cho trình duyệt chỉ gồm `project_id` (khi tạo), `title`, `description`, `assignee_id`, `priority`, `start_date`, `due_date`, `position` |
| `task_labels` | `task_id`, `label_id` | Nhiều nhiều; nhãn phải cùng dự án với task (trigger `check_task_label_project`); hàm `public.set_task_labels()` thay toàn bộ nhãn của task |
| `task_relations` | `id`, `from_task_id`, `to_task_id`, `kind` (enum `task_relation_kind`: `relates`/`blocks`/`precedes`/`duplicates`), `lag_days` (±365, chỉ cho `precedes`, còn lại phải bằng 0), `created_by`, `created_at` | E8-1 (PR 29). Thay `task_dependencies`; quan hệ đảo (bị chặn bởi, đứng sau, bị trùng) suy ra từ `kind`. CHECK không tự quan hệ; UNIQUE (from, to, kind); `relates` đối xứng nhờ chỉ mục duy nhất trên `(least, greatest)`; hai khóa ngoại `ON DELETE CASCADE`. Cả 4 kiểu vào MVP. Không có UPDATE (xóa rồi tạo lại) |
| `notifications` | `id`, `user_id`, `type`, `task_id`, `payload jsonb`, `read_at`, `created_at` | FR-11 |
| `notification_preferences` | `user_id`, `type`, `email_enabled` | FR-12 |
| `activity_logs` | `id`, `project_id`, `actor_id`, `entity_type`, `entity_id`, `action`, `changes jsonb` (trước, sau), `created_at` | Chỉ INSERT (BR-09). E6-1 (PR 28): ghi bằng trigger AFTER (`private.log_activity()`) trên `projects`, `project_members`, `tasks`; UPDATE, DELETE, TRUNCATE bị chặn bằng trigger kể cả `service_role`; không khóa ngoại (nhật ký sống lâu hơn dòng được ghi); `actor_id` null khi thao tác bằng service role; `entity_type` chỉ nhận project, project_member, task (nhật ký quan hệ, nhãn, cấu hình chưa có); chỉ PM của dự án và Admin đọc được |
| `project_templates` | `id`, `name`, `structure jsonb` (trạng thái, nhãn, cây task), `created_by` | FR-04 |
| `report_templates` | `id`, `kind` (`xlsx`/`docx`), `name`, `storage_path`, `uploaded_by`, `is_active` | Template công ty (BR-08); tệp ở Storage |
| `report_exports` | `id`, `project_id`, `template_id`, `format`, `period_start`, `period_end`, `requested_by`, `created_at` | Ghi ai xuất báo cáo nào |

## 3. Ràng buộc và trigger
- `tasks.depth`: trigger đặt `depth = parent.depth + 1`; từ chối nếu vượt 3 (E2-4, đang làm).
- `task_relations` (E8-1): trigger `check_task_relation` (BEFORE INSERT/UPDATE, SECURITY DEFINER) theo thứ tự: (1) người dùng cuối phải sửa được **cả hai** task (42501, để lỗi "vòng" hay "khác dự án" không dò được task người gọi không thấy); (2) cùng dự án (`task_relation_cross_project` → 422); (3) chống vòng (BR-05, `task_relation_cycle` → 409) bằng CTE đệ quy. `blocks` và `precedes` dùng **chung một đồ thị** (cả hai nghĩa "from đi trước to"), `relates` và `duplicates` không tính; khóa tư vấn `pg_advisory_xact_lock` theo dự án để hai yêu cầu đồng thời không tạo vòng. Đường hệ thống (`auth.uid()` null) vẫn qua kiểm cùng dự án và chống vòng. Đo: chuỗi 1.000 cạnh, kiểm cạnh đóng vòng dài nhất 0,85 ms.
- `private.can_read_task(uuid)`, `private.can_edit_task(uuid)`: định nghĩa **giống hệt** ở hai migration (E2-3 `20261115130000` và E8-1 `20261115170000`, `create or replace`), phải trùng điều kiện RLS `tasks_select`/`tasks_update`; sửa một bên phải sửa cả bên kia (pgTAP so với UPDATE thật cho 8 persona).
- E2-3: mỗi dự án luôn còn ≥1 trạng thái todo, ≥1 done, ≥1 loại task (trigger khóa dòng dự án để chống đua; xóa dự án thì bỏ qua). `public.delete_task_status()`/`delete_task_type()` (SECURITY INVOKER): có `p_replace_with` thì chuyển task rồi xóa cùng giao dịch, không có mà đang dùng thì `status_in_use`. Đổi `category` của trạng thái cập nhật `completed_at` của các task trong đó (`private.sync_tasks_on_status_category()`, SECURITY DEFINER, chỉ chạy khi RLS đã cho PM/Admin sửa trạng thái).
- `tasks`: kiểm tra `start_date` ≤ `due_date` (BR-13); quy tắc dời ngày task "đứng sau" khi task "đứng trước" đổi ngày phụ thuộc quyết định lập lịch tự động hay thủ công (FR-21, **[CẦN XÁC NHẬN]**).
- BR-04: trigger chặn đặt task cha thuộc trạng thái `done` khi còn subtask chưa `done`.
- `tasks.status_id`, `tasks.type_id` phải thuộc đúng `project_id` của task: đảm bảo bằng khóa ngoại kép (E2-3), không bằng trigger.
- BR-06: không chặn cứng; cảnh báo xử lý ở tầng ứng dụng, đọc từ `task_relations` (kind `blocks`).

## 4. Chỉ mục
| Chỉ mục | Phục vụ |
|---|---|
| `tasks (project_id, status_id, position)` | Kanban |
| `tasks (project_id, assignee_id)` | Lọc theo người phụ trách |
| `tasks (project_id, due_date)` | Nhắc hạn, trễ hạn |
| `tasks (project_id, start_date, due_date)` | Gantt theo khoảng thời gian |
| `task_relations (from_task_id)`, `(to_task_id)` | Tìm quan hệ hai chiều |
| `saved_views (project_id, owner_id)` | Danh sách chế độ xem |
| `tasks (parent_id)` | Subtask |
| Tìm kiếm trên `tasks.title` (E3-3 đang làm) | FR-09; **đã chốt 2026-11-15: tìm bỏ dấu** bằng extension `unaccent` (gõ "bao cao" ra "Báo cáo"), không phân biệt hoa thường, không fuzzy; chỉ mục chọn ở E3-3 (pg_trgm hoặc tsvector) và đo bằng EXPLAIN |
| `projects (status, created_at desc)` (`projects_status_created_idx`) | Danh sách dự án (E2-1) |
| `activity_logs (project_id, created_at desc)`, `(entity_type, entity_id, created_at desc)` | Xem nhật ký dự án, lịch sử một đối tượng (E6-1) |
| `notifications (user_id, read_at, created_at desc)` | Chuông thông báo |
| `project_members (user_id)` | Danh sách dự án của một người |

## 5. Phân quyền hàng (RLS)
Các cột Người xem, Thành viên, PM là vai trò **trong dự án** (`project_members.role`); Admin là `profiles.is_admin` (BR-01 sửa 2026-11-13). Người không thuộc dự án và không phải Admin không thấy dòng nào của dự án đó.
| Bảng | Người xem | Thành viên | PM | Admin |
|---|---|---|---|---|
| `projects` | Đọc dự án mình thuộc | Đọc dự án mình thuộc | Đọc, sửa (kể cả lưu trữ) dự án mình là PM; tạo mới nếu là PM ở ít nhất một dự án; KHÔNG xóa (sếp chốt 2026-11-13) | Toàn quyền, chỉ Admin xóa |
| `project_members` | Đọc cùng dự án | Đọc cùng dự án; không tự nâng vai trò | Thêm, đổi vai trò, gỡ thành viên dự án mình là PM | Toàn quyền |
| `departments` | Đọc | Đọc | Đọc | Đọc, ghi |
| `profile_contacts` | Chỉ của mình | Chỉ của mình | Của mình và thành viên dự án mình là PM | Đọc tất cả; ghi chỉ của mình |
| `tasks` | Đọc | Đọc; sửa task mình phụ trách hoặc tạo (BR-03); tạo task; xóa task mình tạo. Thành viên chỉ phụ trách (không tạo) không giao task đi cho người khác được (WITH CHECK = USING) | Đọc, sửa, xóa mọi task trong dự án | Toàn quyền |
| `activity_logs` | Không | Không | Đọc nhật ký dự án mình thuộc | Đọc tất cả |
| `saved_views` | Đọc chế độ xem công khai; tạo, sửa chế độ xem riêng của mình | Giống Người xem | Giống Thành viên; sửa chế độ xem công khai của dự án | Toàn quyền |
| `task_relations` | Đọc khi thấy cả hai task | Tạo, xóa khi sửa được cả hai task (`private.can_edit_task`); không có UPDATE | Giống Thành viên (sửa được mọi task trong dự án) | Toàn quyền |
| `task_statuses`, `task_types`, `labels` | Đọc | Đọc | Đọc, thêm, sửa, xóa (dự án mình là PM) | Toàn quyền |
| `task_labels` | Đọc theo quyền đọc task | Gắn, gỡ khi sửa được task (BR-03) | Gắn, gỡ mọi task trong dự án | Toàn quyền |
| `profiles` | Đọc mình và người cùng dự án | Giống Người xem; sửa `full_name`, `locale` của mình | **Đọc mọi hồ sơ** (sếp chấp nhận 2026-11-13, để tìm người thêm vào dự án) | Đọc tất cả; đổi `is_admin`, `is_active`, phòng ban qua API máy chủ (khóa service) |
| `report_templates` | Không | Không | Đọc | Toàn quyền |
| `notifications` | Chỉ của mình | Chỉ của mình | Chỉ của mình | Chỉ của mình |
Hai hàm quản trị `admin_list_users` và `admin_update_user` (SECURITY DEFINER, `search_path = ''`, chỉ `service_role` gọi được; migration `20261113150000_admin_users.sql`): khóa hàng mọi Admin đang hoạt động trước khi kiểm quy tắc để số Admin không về 0 khi hai Admin thao tác cùng lúc. Người dùng bị khóa (`is_active = false`) không có quyền gì, kể cả đọc hồ sơ của mình. Hàm hỗ trợ RLS là SECURITY DEFINER trong schema `private` (không phơi qua API). `INSERT ... RETURNING` trên `projects` bị từ chối với PM không phải Admin (policy SELECT chạy trước trigger thêm PM): dùng `public.create_project()` hoặc client tự sinh `id` và đọc lại. Chưa chặn gỡ PM cuối cùng của dự án (trigger để Story sau). Mỗi migration thêm bảng mới phải tự `revoke` quyền mặc định của Supabase rồi `grant` theo cột. `activity_logs` không có chính sách UPDATE/DELETE cho bất kỳ vai trò nào. Mọi chính sách có kiểm thử riêng (xem [test-strategy.md](test-strategy.md)).

Bộ đếm giới hạn tần suất (E0-5): `private.rate_limit_counters` (RLS bật, không chính sách, khóa đã băm HMAC) và hàm `private.rate_limit_hit` qua wrapper `public.rate_limit_hit`, chỉ `service_role` gọi được; tự dọn dòng hết hạn.

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
