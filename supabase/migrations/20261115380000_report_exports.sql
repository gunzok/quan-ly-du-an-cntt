-- QLDA-67 (Story E5-3): nhật ký xuất báo cáo (report_exports) cho POST /api/v1/projects/{id}/reports.
-- Thiết kế: docs/03-design/database.md (report_exports), api-contract.md (Xuất báo cáo), ADR-004.
--
-- Quyết định:
--   1. Mỗi lần xuất THÀNH CÔNG ghi một dòng (ai, dự án, template, định dạng, kỳ). Không lưu tệp đã
--      sinh (tệp trả thẳng về trình duyệt, không ở Storage).
--   2. template_id ON DELETE SET NULL (E5-2 xóa template là xóa thật): giữ lịch sử xuất.
--      project_id ON DELETE CASCADE (xóa dự án là xóa hẳn mọi dữ liệu dự án, như task, nhật ký
--      dự án). requested_by ON DELETE SET NULL (xóa hẳn tài khoản).
--   3. Quyền: đọc và thêm chỉ PM của dự án (đang hoạt động) và Admin (đang hoạt động); thêm thì
--      requested_by phải là chính mình. KHÔNG ai sửa hay xóa (không cấp quyền UPDATE/DELETE, không
--      có chính sách), kể cả Admin; chỉ xóa theo dây chuyền khi xóa dự án.
--   4. Kỳ báo cáo: period_start <= period_end, dài tối đa 366 ngày (khớp kiểm ở API).

create table public.report_exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  template_id uuid references public.report_templates (id) on delete set null,
  format text not null check (format in ('xlsx', 'docx')),
  period_start date not null,
  period_end date not null,
  requested_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint report_exports_period_order check (period_start <= period_end),
  constraint report_exports_period_length check (period_end - period_start <= 365)
);

comment on table public.report_exports is
  'Nhật ký xuất báo cáo (E5-3, FR-14/FR-15): ai xuất báo cáo nào. Chỉ thêm; PM của dự án và Admin đọc.';
comment on column public.report_exports.template_id is
  'Template đang dùng lúc xuất; null khi template đã bị Admin xóa (giữ lịch sử).';

create index report_exports_project_created_idx
  on public.report_exports (project_id, created_at desc);
create index report_exports_template_idx on public.report_exports (template_id);
create index report_exports_requested_by_idx on public.report_exports (requested_by);

-- ---------------------------------------------------------------------------
-- Quyền theo cột: chỉ đọc và thêm; không UPDATE, không DELETE.
-- ---------------------------------------------------------------------------
revoke all on public.report_exports from public, anon, authenticated;
grant select on public.report_exports to authenticated;
grant insert (id, project_id, template_id, format, period_start, period_end, requested_by)
  on public.report_exports to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.report_exports enable row level security;

-- private.is_admin() và private.project_role_of() (SECURITY DEFINER, search_path rỗng, đã có từ
-- 20261113120000) đều coi người bị khóa là không có quyền.
create policy report_exports_select on public.report_exports
  for select to authenticated
  using (
    (select private.is_admin())
    or private.project_role_of(project_id) = 'pm'
  );

create policy report_exports_insert on public.report_exports
  for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and (
      (select private.is_admin())
      or private.project_role_of(project_id) = 'pm'
    )
  );
