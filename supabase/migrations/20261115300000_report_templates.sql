-- QLDA-61 (Story E5-2): quản lý template báo cáo xlsx/docx do Admin tải lên (BR-08, FR-14, FR-15).
-- Thiết kế: docs/03-design/database.md (report_templates, ma trận RLS), api-contract.md
-- (GET/POST /api/v1/report-templates), security.md F4 (tải template độc hại), ADR-004.
-- R-005: chưa có template thật của công ty; test dùng tệp giả sinh trong tests/fixtures/.
--
-- Quyết định:
--   1. Siêu dữ liệu ở bảng public.report_templates; tệp ở bucket Storage RIÊNG TƯ `report-templates`
--      (không public, không URL công khai). Tệp chỉ đọc qua API máy chủ bằng client phiên (RLS
--      storage.objects), bước xuất báo cáo E5-3/E5-4 đọc theo đúng cách đó.
--   2. Đường dẫn tệp do MÁY CHỦ sinh: `<kind>/<uuid>.<kind>`; không dùng tên tệp người dùng. CHECK
--      ràng buộc định dạng và khớp `kind`; chính sách Storage cũng chỉ nhận đúng định dạng này.
--   3. Mỗi định dạng (`kind`) tối đa MỘT template đang dùng (chỉ mục duy nhất một phần), để E5-3/E5-4
--      chọn template không mơ hồ (mockup S17: "chỉ có một bản bật cho mỗi định dạng"). Bật một
--      template thì tắt template cùng định dạng trong cùng giao dịch (hàm set_report_template_active,
--      SECURITY INVOKER nên RLS vẫn áp dụng).
--   4. Xóa là xóa thật (dòng + tệp), không có trạng thái "lưu trữ" riêng: "Ngừng dùng" (is_active =
--      false) đã là cách giữ lại template cũ; xóa dành cho tệp tải nhầm. E5-3 thêm report_exports thì
--      khóa ngoại tới report_templates nên là ON DELETE SET NULL để giữ lịch sử xuất.
--   5. Quyền (database.md mục 5): Admin toàn quyền; PM (ở ít nhất một dự án, đang hoạt động) chỉ đọc
--      siêu dữ liệu và tệp; Thành viên, Người xem, người ngoài, người bị khóa, anon: không gì cả.
--      Tệp trong Storage không sửa đè được (không có chính sách UPDATE), chỉ thêm và xóa.
--   6. Thêm cột size_bytes, created_at, updated_at so với database.md (hiển thị và sắp xếp).

-- ---------------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------------
create table public.report_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('xlsx', 'docx')),
  name text not null check (char_length(btrim(name)) between 1 and 200 and name = btrim(name)),
  storage_path text not null unique,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 4194304),
  uploaded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_templates_storage_path_format check (
    storage_path ~ '^(xlsx|docx)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(xlsx|docx)$'
    and split_part(storage_path, '/', 1) = kind
    and storage_path like '%.' || kind
  )
);

comment on table public.report_templates is
  'Template báo cáo công ty (BR-08). Tệp ở bucket Storage riêng tư report-templates; chỉ Admin ghi.';
comment on column public.report_templates.storage_path is
  'Đường dẫn trong bucket report-templates, máy chủ sinh: <kind>/<uuid>.<kind>.';
comment on column public.report_templates.is_active is
  'Template đang dùng cho xuất báo cáo; mỗi kind tối đa một (report_templates_one_active_per_kind).';

create unique index report_templates_one_active_per_kind
  on public.report_templates (kind) where is_active;
create index report_templates_uploaded_by_idx on public.report_templates (uploaded_by);

create trigger set_updated_at before update on public.report_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Quyền theo cột
-- ---------------------------------------------------------------------------
revoke all on public.report_templates from public, anon, authenticated;
grant select on public.report_templates to authenticated;
grant insert (id, kind, name, storage_path, size_bytes, uploaded_by) on public.report_templates
  to authenticated;
grant update (name, is_active) on public.report_templates to authenticated;
grant delete on public.report_templates to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Hàm hỗ trợ RLS
-- ---------------------------------------------------------------------------
-- Đọc template báo cáo: Admin đang hoạt động, hoặc đang là PM ở ít nhất một dự án và chưa bị khóa.
create or replace function private.can_read_report_templates()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin() or exists (
    select 1
    from public.project_members m
    join public.profiles p on p.id = m.user_id
    where m.user_id = auth.uid() and m.role = 'pm' and p.is_active
  );
$$;

revoke all on function private.can_read_report_templates() from public, anon, authenticated;
grant execute on function private.can_read_report_templates() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS bảng
-- ---------------------------------------------------------------------------
alter table public.report_templates enable row level security;

create policy report_templates_select on public.report_templates
  for select to authenticated
  using ((select private.can_read_report_templates()));

create policy report_templates_insert_admin on public.report_templates
  for insert to authenticated
  with check ((select private.is_admin()) and uploaded_by = (select auth.uid()));

create policy report_templates_update_admin on public.report_templates
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy report_templates_delete_admin on public.report_templates
  for delete to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- 5. Bật/tắt template (một template đang dùng mỗi kind)
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: chạy bằng quyền người gọi, RLS và quyền cột ở trên vẫn quyết định. Hai câu
-- UPDATE trong một giao dịch: chỉ mục duy nhất một phần kiểm từng dòng ngay lập tức nên không gộp
-- thành một câu được. Hai Admin bật cùng lúc hai template cùng kind: câu thứ hai gặp 23505 (API trả
-- 409, thử lại). Trả dòng sau khi đổi; không thấy hoặc không có quyền: không trả dòng nào.
create or replace function public.set_report_template_active(p_id uuid, p_active boolean)
returns setof public.report_templates
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_kind text;
begin
  if p_active is null then
    raise exception 'p_active is required' using errcode = '22004';
  end if;
  select t.kind into v_kind from public.report_templates t where t.id = p_id for update;
  if v_kind is null then
    return;
  end if;
  if p_active then
    update public.report_templates t
       set is_active = false
     where t.kind = v_kind and t.is_active and t.id <> p_id;
  end if;
  return query
    update public.report_templates t
       set is_active = p_active
     where t.id = p_id
    returning t.*;
end;
$$;

revoke all on function public.set_report_template_active(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_report_template_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Storage: bucket riêng tư và chính sách
-- ---------------------------------------------------------------------------
-- Giới hạn kích thước và kiểu MIME ở bucket là lớp chặn thứ hai (API kiểm trước, kỹ hơn). Cột
-- file_size_limit/allowed_mime_types do dịch vụ Storage thêm: chỉ đặt khi cột có.
insert into storage.buckets (id, name, public)
values ('report-templates', 'report-templates', false)
on conflict (id) do update set public = false;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    execute $sql$
      update storage.buckets
         set file_size_limit = 4194304,
             allowed_mime_types = array[
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
               'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
             ]
       where id = 'report-templates'
    $sql$;
  end if;
end;
$$;

-- Đọc tệp: giống đọc siêu dữ liệu (Admin, PM).
create policy report_templates_objects_select on storage.objects
  for select to authenticated
  using (bucket_id = 'report-templates' and (select private.can_read_report_templates()));

-- Thêm tệp: chỉ Admin, chỉ đúng định dạng đường dẫn do máy chủ sinh.
create policy report_templates_objects_insert_admin on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'report-templates'
    and (select private.is_admin())
    and name ~ '^(xlsx|docx)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(xlsx|docx)$'
    and split_part(name, '/', 1) = substring(name from '\.([a-z]+)$')
  );

-- Xóa tệp: chỉ Admin. Không có chính sách UPDATE: không ai ghi đè được tệp đã tải lên.
create policy report_templates_objects_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'report-templates' and (select private.is_admin()));
