-- QLDA-52 (Story E3-4): chính sách RLS ĐỌC các bảng theo dự án tính quyền MỘT lần mỗi truy vấn.
-- Thiết kế: docs/03-design/database.md mục 5, security.md (NFR-02: 2.000 task).
--
-- Vấn đề: các chính sách SELECT dạng `private.project_role_of(project_id) is not null` gọi hàm
-- SECURITY DEFINER (không inline được) cho TỪNG dòng: đếm 2.000 task mất ~45 ms trong CSDL, trang
-- danh sách 100 task ~60 ms (phải lọc rồi sắp cả 2.000 dòng), task_labels/task_relations còn gọi
-- private.can_read_task từng dòng.
--
-- Quyết định:
--   1. Hàm `private.my_project_ids()` (STABLE, SECURITY DEFINER, search_path rỗng) trả tập id dự án
--      mà người đang đăng nhập là thành viên (mọi vai trò) và chưa bị khóa; `private.my_pm_project_ids()`
--      như vậy nhưng chỉ vai trò PM. Chính sách dùng `project_id in (select private.my_project_ids())`:
--      truy vấn con không tương quan nên Postgres tính MỘT lần (hashed SubPlan) rồi tra băm từng dòng.
--   2. KHÔNG đổi ngữ nghĩa: `x in (select private.my_project_ids())` ⇔ `private.project_role_of(x) is not null`
--      vì cả hai đọc cùng điều kiện (project_members.user_id = auth.uid() và profiles.is_active),
--      project_members.role NOT NULL, project_id các bảng đều NOT NULL. Tương tự
--      `x in (select private.my_pm_project_ids())` ⇔ `private.project_role_of(x) = 'pm'`.
--      Admin vẫn là `(select private.is_admin())` (đã là InitPlan). Test chứng minh tương đương:
--      supabase/tests/database/rls-project-scope.test.sql.
--   3. Chỉ viết lại chính sách SELECT (đường đọc nóng): tasks, task_statuses, task_types, labels,
--      projects, project_members, activity_logs (PM), task_labels, task_relations. Chính sách
--      INSERT/UPDATE/DELETE giữ nguyên (chỉ chạm vài dòng mỗi lệnh; can_edit_task phải khớp
--      tasks_update như ghi chú ở 20261115170000_task_relations.sql).
--   4. task_labels, task_relations: thay private.can_read_task(id) (SECURITY DEFINER, gọi từng dòng)
--      bằng `exists (select 1 from public.tasks t where t.id = ... and <điều kiện đọc task>)`.
--      Truy vấn con trên tasks chạy với quyền người gọi nên tasks_select cũng áp dụng; điều kiện
--      trùng nhau nên kết quả giống hệt can_read_task. private.can_read_task giữ nguyên (API và
--      trigger khác còn dùng).
--   5. Hàm mới chỉ cấp EXECUTE cho authenticated (anon không có chính sách nào trên các bảng này).

-- ---------------------------------------------------------------------------
-- 1. Hàm tập dự án của người gọi
-- ---------------------------------------------------------------------------
create or replace function private.my_project_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.project_id
  from public.project_members m
  join public.profiles p on p.id = m.user_id
  where m.user_id = (select auth.uid())
    and p.is_active;
$$;
comment on function private.my_project_ids() is
  'Id các dự án người đang đăng nhập là thành viên (mọi vai trò), rỗng nếu bị khóa. Tương đương project_role_of(x) is not null (QLDA-52).';

create or replace function private.my_pm_project_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.project_id
  from public.project_members m
  join public.profiles p on p.id = m.user_id
  where m.user_id = (select auth.uid())
    and m.role = 'pm'
    and p.is_active;
$$;
comment on function private.my_pm_project_ids() is
  'Id các dự án người đang đăng nhập là PM, rỗng nếu bị khóa. Tương đương project_role_of(x) = ''pm'' (QLDA-52).';

revoke all on function private.my_project_ids(), private.my_pm_project_ids()
  from public, anon, authenticated;
grant execute on function private.my_project_ids(), private.my_pm_project_ids()
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Chính sách SELECT theo dự án (thay trong một giao dịch: không có lúc bảng thiếu chính sách)
-- ---------------------------------------------------------------------------
drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using ((select private.is_admin()) or project_id in (select private.my_project_ids()));

drop policy task_statuses_select on public.task_statuses;
create policy task_statuses_select on public.task_statuses
  for select to authenticated
  using ((select private.is_admin()) or project_id in (select private.my_project_ids()));

drop policy task_types_select on public.task_types;
create policy task_types_select on public.task_types
  for select to authenticated
  using ((select private.is_admin()) or project_id in (select private.my_project_ids()));

drop policy labels_select on public.labels;
create policy labels_select on public.labels
  for select to authenticated
  using ((select private.is_admin()) or project_id in (select private.my_project_ids()));

drop policy projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using ((select private.is_admin()) or id in (select private.my_project_ids()));

drop policy project_members_select on public.project_members;
create policy project_members_select on public.project_members
  for select to authenticated
  using ((select private.is_admin()) or project_id in (select private.my_project_ids()));

drop policy activity_logs_select on public.activity_logs;
create policy activity_logs_select on public.activity_logs
  for select to authenticated
  using ((select private.is_admin()) or project_id in (select private.my_pm_project_ids()));

drop policy task_labels_select on public.task_labels;
create policy task_labels_select on public.task_labels
  for select to authenticated
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id
        and ((select private.is_admin()) or t.project_id in (select private.my_project_ids()))
    )
  );

drop policy task_relations_select on public.task_relations;
create policy task_relations_select on public.task_relations
  for select to authenticated
  using (
    exists (
      select 1 from public.tasks t
      where t.id = from_task_id
        and ((select private.is_admin()) or t.project_id in (select private.my_project_ids()))
    )
    and exists (
      select 1 from public.tasks t
      where t.id = to_task_id
        and ((select private.is_admin()) or t.project_id in (select private.my_project_ids()))
    )
  );
