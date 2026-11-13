-- QLDA-27 (Story E0-1): thành phần nền dùng chung cho các migration sau.
-- Chỉ tạo extension, kiểu enum dùng chung và hàm tiện ích. KHÔNG tạo bảng nghiệp vụ
-- (bảng do Story E1-3, E2-2... tạo). Migration đã merge thì không sửa; thay đổi là migration mới.

-- ---------------------------------------------------------------------------
-- 1. Extension
-- ---------------------------------------------------------------------------
-- unaccent: bỏ dấu tiếng Việt để tìm kiếm task gõ không dấu vẫn khớp (FR-09,
-- database.md mục 4 chỉ mục tìm kiếm). Đặt trong schema `extensions` theo quy ước Supabase.
-- Không thêm:
--   * pgcrypto: khóa chính dùng gen_random_uuid(), có sẵn trong lõi Postgres từ bản 13.
--   * pg_trgm: thiết kế hiện chỉ có GIN trên tsvector; thêm khi Story tìm kiếm (E3) cần.
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- 2. Kiểu enum dùng chung (database.md mục 2)
-- ---------------------------------------------------------------------------
-- Vai trò theo từng dự án (BR-01), dùng cho project_members.role.
create type public.project_role as enum ('pm', 'member', 'viewer');

-- Mức ưu tiên task, dùng cho tasks.priority.
create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');

-- ---------------------------------------------------------------------------
-- 3. Hàm tiện ích cho trigger
-- ---------------------------------------------------------------------------
-- Gán updated_at = now() mỗi khi cập nhật dòng. Cách dùng ở bảng có cột updated_at:
--   create trigger set_updated_at before update on public.<bang>
--     for each row execute function public.set_updated_at();
-- search_path rỗng để tránh bị chiếm quyền qua search_path (khuyến nghị bảo mật Supabase).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger BEFORE UPDATE: gán updated_at = now(). Dùng chung cho mọi bảng có cột updated_at.';
