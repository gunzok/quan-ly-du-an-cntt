-- QLDA-78 (Story E7-1): lưu dự án thành template và tạo dự án từ template (FR-04, UC-04, BR-08).
-- Thiết kế: docs/03-design/database.md (project_templates, structure jsonb), api-contract.md
-- (/api/v1/project-templates), security.md (dữ liệu không tin cậy), ui-ux/screens.md S13, S17.
--
-- Quyết định:
--   1. Phạm vi chia sẻ (BR-08 "template công ty"): template DÙNG CHUNG cho mọi Admin và PM (đang là
--      PM ở ít nhất một dự án, tức là người được tạo dự án, private.can_create_project). Chỉ NGƯỜI
--      TẠO hoặc Admin đổi tên, lưu trữ, xóa. Thành viên, Người xem, người ngoài, người bị khóa: không
--      thấy gì. Hệ quả: tiêu đề, mô tả task của dự án nguồn lộ cho mọi PM; giao diện nhắc điều đó
--      trước khi lưu, và chỉ PM của dự án nguồn hoặc Admin được lưu (họ vốn đọc được mọi task).
--   2. Không ai INSERT trực tiếp (không cấp quyền): template chỉ sinh từ dự án thật qua
--      public.save_project_as_template (SECURITY DEFINER) để `structure` luôn do máy chủ dựng từ dữ
--      liệu người lưu có quyền đọc. Cột `structure` không cấp quyền SELECT cho trình duyệt; tóm tắt
--      (số trạng thái, loại, nhãn, task) là cột sinh (generated) đọc được.
--   3. `structure` (version 1) KHÔNG chứa id thật của dự án nguồn; tham chiếu bằng khóa cục bộ
--      (s1, y1, l1, t1...). Chỉ chứa: trạng thái (tên, nhóm, màu, thứ tự; "mặc định" = trạng thái
--      todo đầu tiên theo thứ tự, nên giữ thứ tự là giữ mặc định), loại task (tên, mốc, màu, thứ
--      tự), nhãn (tên, màu), cây task (cha, tiêu đề, mô tả, loại, trạng thái, ưu tiên, nhãn, thứ tự,
--      offset ngày bắt đầu/hạn so với ngày bắt đầu dự án nếu dự án có ngày bắt đầu). KHÔNG sao chép
--      người phụ trách, người tạo, bình luận, tệp, nhật ký, thông báo, thành viên, quan hệ task.
--   4. `structure` là dữ liệu KHÔNG TIN CẬY khi nhân bản (có thể bị service_role/khôi phục sao lưu
--      sửa tay): private.project_template_structure_error kiểm schema CHẶT (đúng bộ khóa, kiểu, độ
--      dài, màu, enum, khóa duy nhất, cha xuất hiện TRƯỚC con nên không có vòng, ≤ 3 cấp, nhãn tham
--      chiếu đúng, ≤ 2.000 task, ≤ 4 MiB). Dùng làm CHECK của bảng VÀ kiểm lại ngay trước khi chèn.
--      Không có trường nào về người, vai trò hay quyền nên nhân bản không thể leo thang quyền; mọi
--      trigger hiện có trên tasks (3 cấp, cùng dự án, vị trí, nhật ký) vẫn chạy khi chèn.
--   5. Giới hạn: 2.000 task (bằng cỡ dự án đo hiệu năng NFR-02), 50 trạng thái, 50 loại, 200 nhãn,
--      50 nhãn mỗi task, 4 MiB. Vượt: lỗi `template_too_many_tasks` / `template_too_large` (API 422).
--   6. Tạo dự án từ template: public.create_project_from_template (SECURITY DEFINER, search_path
--      rỗng) trong MỘT giao dịch: kiểm quyền tạo dự án (Admin hoặc PM ở ≥ 1 dự án, như
--      projects_insert), chèn dự án (người tạo thành PM qua trigger add_creator_as_pm), thay trạng
--      thái và loại mặc định bằng của template, chèn nhãn, chèn cây task theo từng cấp (cha trước
--      con) để trigger check_task_tree tính depth và kiểm cha như mọi đường ghi khác. Template đã lưu
--      trữ không dùng để tạo được.
--   7. projects.template_id KHÔNG có khóa ngoại: chỉ để tra cứu nguồn gốc. Khóa ngoại ON DELETE SET
--      NULL sẽ làm xóa template sinh một UPDATE trên mọi dự án đã tạo từ nó (nhật ký activity_logs
--      ghi người xóa template vào dự án họ không thuộc, đổi updated_at).
--   8. Tên template 1..200 ký tự, duy nhất không phân biệt hoa thường (API 409). Lưu trữ bằng
--      `archived_at` (ẩn khỏi hộp thoại tạo dự án, khôi phục được); xóa là xóa thật.

-- ---------------------------------------------------------------------------
-- 1. Kiểm schema structure (quyết định 3, 4, 5)
-- ---------------------------------------------------------------------------
-- Trả null khi hợp lệ, hoặc mã lý do ngắn. IMMUTABLE (chỉ đọc tham số) để dùng được trong CHECK.
create or replace function private.project_template_structure_error(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_count integer;
  v_ok boolean;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return 'not_object';
  end if;
  if octet_length(p::text) > 4194304 then
    return 'too_large';
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(p) k)
     is distinct from array['labels', 'statuses', 'task_types', 'tasks', 'version'] then
    return 'bad_keys';
  end if;
  if p -> 'version' is distinct from '1'::jsonb then
    return 'bad_version';
  end if;
  if jsonb_typeof(p -> 'statuses') <> 'array' or jsonb_typeof(p -> 'task_types') <> 'array'
     or jsonb_typeof(p -> 'labels') <> 'array' or jsonb_typeof(p -> 'tasks') <> 'array' then
    return 'bad_sections';
  end if;

  -- Trạng thái: 1..50, đủ nhóm todo và done.
  v_count := jsonb_array_length(p -> 'statuses');
  if v_count < 1 or v_count > 50 then
    return 'statuses_count';
  end if;
  select coalesce(bool_and(
           jsonb_typeof(e) = 'object'
           and (select array_agg(k order by k) from jsonb_object_keys(e) k)
               = array['category', 'color', 'key', 'name', 'position']
           and jsonb_typeof(e -> 'key') = 'string' and (e ->> 'key') ~ '^s[0-9]{1,5}$'
           and jsonb_typeof(e -> 'name') = 'string'
           and char_length(btrim(e ->> 'name')) between 1 and 100
           and jsonb_typeof(e -> 'category') = 'string'
           and (e ->> 'category') in ('todo', 'in_progress', 'done')
           and jsonb_typeof(e -> 'color') = 'string' and (e ->> 'color') ~ '^#[0-9A-Fa-f]{6}$'
           and case when jsonb_typeof(e -> 'position') = 'number'
                    then abs((e ->> 'position')::numeric) < 1e300 else false end
         ), false)
         and count(distinct e ->> 'key') = count(*)
         and count(distinct lower(btrim(e ->> 'name'))) = count(*)
         and bool_or(e ->> 'category' = 'todo')
         and bool_or(e ->> 'category' = 'done')
    into v_ok
  from jsonb_array_elements(p -> 'statuses') e;
  if not coalesce(v_ok, false) then
    return 'statuses_invalid';
  end if;

  -- Loại task: 1..50.
  v_count := jsonb_array_length(p -> 'task_types');
  if v_count < 1 or v_count > 50 then
    return 'task_types_count';
  end if;
  select coalesce(bool_and(
           jsonb_typeof(e) = 'object'
           and (select array_agg(k order by k) from jsonb_object_keys(e) k)
               = array['color', 'is_milestone', 'key', 'name', 'position']
           and jsonb_typeof(e -> 'key') = 'string' and (e ->> 'key') ~ '^y[0-9]{1,5}$'
           and jsonb_typeof(e -> 'name') = 'string'
           and char_length(btrim(e ->> 'name')) between 1 and 100
           and jsonb_typeof(e -> 'is_milestone') = 'boolean'
           and jsonb_typeof(e -> 'color') = 'string' and (e ->> 'color') ~ '^#[0-9A-Fa-f]{6}$'
           and case when jsonb_typeof(e -> 'position') = 'number'
                    then abs((e ->> 'position')::numeric) < 1e300 else false end
         ), false)
         and count(distinct e ->> 'key') = count(*)
         and count(distinct lower(btrim(e ->> 'name'))) = count(*)
    into v_ok
  from jsonb_array_elements(p -> 'task_types') e;
  if not coalesce(v_ok, false) then
    return 'task_types_invalid';
  end if;

  -- Nhãn: 0..200.
  if jsonb_array_length(p -> 'labels') > 200 then
    return 'labels_count';
  end if;
  select coalesce(bool_and(
           jsonb_typeof(e) = 'object'
           and (select array_agg(k order by k) from jsonb_object_keys(e) k)
               = array['color', 'key', 'name']
           and jsonb_typeof(e -> 'key') = 'string' and (e ->> 'key') ~ '^l[0-9]{1,5}$'
           and jsonb_typeof(e -> 'name') = 'string'
           and char_length(btrim(e ->> 'name')) between 1 and 100
           and jsonb_typeof(e -> 'color') = 'string' and (e ->> 'color') ~ '^#[0-9A-Fa-f]{6}$'
         ), true)
         and count(distinct e ->> 'key') = count(*)
         and count(distinct lower(btrim(e ->> 'name'))) = count(*)
    into v_ok
  from jsonb_array_elements(p -> 'labels') e;
  if not coalesce(v_ok, false) then
    return 'labels_invalid';
  end if;

  -- Task: 0..2000, từng phần tử đúng khuôn.
  v_count := jsonb_array_length(p -> 'tasks');
  if v_count > 2000 then
    return 'too_many_tasks';
  end if;
  if v_count = 0 then
    return null;
  end if;
  select coalesce(bool_and(
           jsonb_typeof(e) = 'object'
           and (select array_agg(k order by k) from jsonb_object_keys(e) k)
               = array['description', 'due_offset', 'key', 'labels', 'parent', 'position',
                       'priority', 'start_offset', 'status', 'title', 'type']
           and jsonb_typeof(e -> 'key') = 'string' and (e ->> 'key') ~ '^t[0-9]{1,5}$'
           and jsonb_typeof(e -> 'parent') in ('null', 'string')
           and jsonb_typeof(e -> 'title') = 'string'
           and char_length(btrim(e ->> 'title')) between 1 and 500
           and (jsonb_typeof(e -> 'description') = 'null' or (
             jsonb_typeof(e -> 'description') = 'string'
             and char_length(e ->> 'description') <= 10000))
           and jsonb_typeof(e -> 'type') = 'string'
           and jsonb_typeof(e -> 'status') = 'string'
           and jsonb_typeof(e -> 'priority') = 'string'
           and (e ->> 'priority') in ('low', 'medium', 'high', 'urgent')
           and case when jsonb_typeof(e -> 'position') = 'number'
                    then abs((e ->> 'position')::numeric) < 1e300 else false end
           and jsonb_typeof(e -> 'labels') = 'array'
           and jsonb_array_length(e -> 'labels') <= 50
           and case jsonb_typeof(e -> 'start_offset')
                 when 'null' then true
                 when 'number' then (e ->> 'start_offset') ~ '^-?[0-9]{1,4}$'
                   and abs((e ->> 'start_offset')::numeric) <= 3650
                 else false end
           and case jsonb_typeof(e -> 'due_offset')
                 when 'null' then true
                 when 'number' then (e ->> 'due_offset') ~ '^-?[0-9]{1,4}$'
                   and abs((e ->> 'due_offset')::numeric) <= 3650
                 else false end
         ), false)
         and count(distinct e ->> 'key') = count(*)
    into v_ok
  from jsonb_array_elements(p -> 'tasks') e;
  if not coalesce(v_ok, false) then
    return 'tasks_invalid';
  end if;

  -- Ngày bắt đầu không sau hạn (BR-13) khi có cả hai.
  if exists (
    select 1 from jsonb_array_elements(p -> 'tasks') e
    where jsonb_typeof(e -> 'start_offset') = 'number' and jsonb_typeof(e -> 'due_offset') = 'number'
      and (e ->> 'start_offset')::integer > (e ->> 'due_offset')::integer
  ) then
    return 'tasks_dates';
  end if;

  -- Loại, trạng thái, nhãn tham chiếu đúng khóa đã khai báo; nhãn trong một task không lặp.
  if exists (
    select 1 from jsonb_array_elements(p -> 'tasks') e
    where not exists (select 1 from jsonb_array_elements(p -> 'statuses') s
                      where s ->> 'key' = e ->> 'status')
       or not exists (select 1 from jsonb_array_elements(p -> 'task_types') y
                      where y ->> 'key' = e ->> 'type')
       or exists (select 1 from jsonb_array_elements(e -> 'labels') l
                  where jsonb_typeof(l) <> 'string'
                     or not exists (select 1 from jsonb_array_elements(p -> 'labels') d
                                    where d ->> 'key' = l #>> '{}'))
       or (select count(distinct l #>> '{}') from jsonb_array_elements(e -> 'labels') l)
          <> jsonb_array_length(e -> 'labels')
  ) then
    return 'tasks_refs';
  end if;

  -- Cha phải xuất hiện TRƯỚC con trong mảng (không vòng, chèn được theo thứ tự) và tối đa 3 cấp.
  with recursive t as (
    select e, ord from jsonb_array_elements(p -> 'tasks') with ordinality x (e, ord)
  ),
  bad_parent as (
    select 1 from t c
    where jsonb_typeof(c.e -> 'parent') = 'string'
      and not exists (select 1 from t pa where pa.e ->> 'key' = c.e ->> 'parent' and pa.ord < c.ord)
  ),
  tree (k, depth) as (
    select t.e ->> 'key', 1 from t where jsonb_typeof(t.e -> 'parent') = 'null'
    union all
    select t.e ->> 'key', tree.depth + 1
    from t join tree on t.e ->> 'parent' = tree.k
    where tree.depth < 4
  )
  select not exists (select 1 from bad_parent)
         and coalesce((select max(depth) from tree), 1) <= 3
    into v_ok;
  if not v_ok then
    return 'tasks_tree';
  end if;

  return null;
end;
$$;
revoke all on function private.project_template_structure_error(jsonb) from public, anon, authenticated;
-- CHECK của bảng chạy bằng quyền người ghi (UPDATE đổi tên cũng kiểm lại): hàm thuần, chỉ đọc
-- tham số, nên cấp cho authenticated và service_role là vô hại.
grant execute on function private.project_template_structure_error(jsonb) to authenticated, service_role;

comment on function private.project_template_structure_error(jsonb) is
  'Kiểm schema chặt project_templates.structure (version 1); null = hợp lệ, ngược lại mã lý do.';

-- ---------------------------------------------------------------------------
-- 2. Bảng
-- ---------------------------------------------------------------------------
create table public.project_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  structure jsonb not null,
  status_count integer generated always as (
    case when jsonb_typeof(structure -> 'statuses') = 'array'
         then jsonb_array_length(structure -> 'statuses') else 0 end
  ) stored,
  task_type_count integer generated always as (
    case when jsonb_typeof(structure -> 'task_types') = 'array'
         then jsonb_array_length(structure -> 'task_types') else 0 end
  ) stored,
  label_count integer generated always as (
    case when jsonb_typeof(structure -> 'labels') = 'array'
         then jsonb_array_length(structure -> 'labels') else 0 end
  ) stored,
  task_count integer generated always as (
    case when jsonb_typeof(structure -> 'tasks') = 'array'
         then jsonb_array_length(structure -> 'tasks') else 0 end
  ) stored,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint project_templates_name_length
    check (char_length(btrim(name)) between 1 and 200 and name = btrim(name)),
  constraint project_templates_structure_valid
    check (private.project_template_structure_error(structure) is null)
);

comment on table public.project_templates is
  'Template dự án (FR-04, BR-08): trạng thái, loại task, nhãn, cây task. Dùng chung cho Admin và PM; '
  'chỉ người tạo hoặc Admin đổi tên, lưu trữ, xóa. Chỉ sinh qua public.save_project_as_template.';
comment on column public.project_templates.structure is
  'Version 1, khóa cục bộ (s/y/l/t + số), không id thật, không người. Xem '
  'private.project_template_structure_error. Trình duyệt không đọc trực tiếp.';
comment on column public.project_templates.archived_at is
  'Đã lưu trữ: ẩn khỏi hộp thoại tạo dự án, không tạo dự án mới từ template này được.';

create unique index project_templates_name_ci_key on public.project_templates (lower(btrim(name)));
create index project_templates_created_by_idx on public.project_templates (created_by);
create index project_templates_archived_created_idx
  on public.project_templates (archived_at, created_at desc);

create trigger set_updated_at before update on public.project_templates
  for each row execute function public.set_updated_at();

-- projects.template_id: chỉ tra cứu, không khóa ngoại (quyết định 7). Trình duyệt không ghi được
-- (không nằm trong quyền cột INSERT/UPDATE của projects).
alter table public.projects add column template_id uuid;
comment on column public.projects.template_id is
  'Template dùng lúc tạo dự án (E7-1). Không khóa ngoại: xóa template không đụng dự án.';

-- ---------------------------------------------------------------------------
-- 3. Quyền theo cột (quyết định 2)
-- ---------------------------------------------------------------------------
revoke all on public.project_templates from public, anon, authenticated;
grant select (id, name, status_count, task_type_count, label_count, task_count, created_by,
  created_at, updated_at, archived_at) on public.project_templates to authenticated;
grant update (name, archived_at) on public.project_templates to authenticated;
grant delete on public.project_templates to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS (quyết định 1)
-- ---------------------------------------------------------------------------
alter table public.project_templates enable row level security;

create policy project_templates_select on public.project_templates
  for select to authenticated
  using ((select private.can_create_project()));

create policy project_templates_update on public.project_templates
  for update to authenticated
  using (
    (select private.is_admin())
    or (created_by = (select auth.uid()) and (select private.can_create_project()))
  )
  with check (
    (select private.is_admin())
    or (created_by = (select auth.uid()) and (select private.can_create_project()))
  );

create policy project_templates_delete on public.project_templates
  for delete to authenticated
  using (
    (select private.is_admin())
    or (created_by = (select auth.uid()) and (select private.can_create_project()))
  );

-- ---------------------------------------------------------------------------
-- 5. Lưu dự án thành template
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: dựng structure từ dữ liệu dự án và chèn (trình duyệt không có quyền INSERT).
-- Thứ tự kiểm (giống API): người dùng đang hoạt động; dự án không thấy được (không thuộc dự án và
-- không phải Admin, hoặc không tồn tại): `project_not_found` P0002 (API 404, không lộ sự tồn tại);
-- không phải PM của dự án và không phải Admin: 42501 (API 403); quá 2.000 task:
-- `template_too_many_tasks` P0001 (API 422, DETAIL = số task); structure vượt giới hạn khác:
-- `template_too_large` P0001 (API 422); tên trùng: 23505 (API 409).
create or replace function public.save_project_as_template(p_project_id uuid, p_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.project_role;
  v_admin boolean;
  v_start date;
  v_count integer;
  v_structure jsonb;
  v_error text;
  v_id uuid := gen_random_uuid();
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  v_admin := private.is_admin();
  v_role := private.project_role_of(p_project_id);
  select p.start_date into v_start from public.projects p where p.id = p_project_id;
  if not found or (not v_admin and v_role is null) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not v_admin and v_role is distinct from 'pm' then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select count(*) into v_count from public.tasks t where t.project_id = p_project_id;
  if v_count > 2000 then
    raise exception 'template_too_many_tasks' using errcode = 'P0001', detail = v_count::text;
  end if;

  with s as (
    select s.*, row_number() over (order by s.position, s.created_at, s.id) as n
    from public.task_statuses s where s.project_id = p_project_id
  ),
  y as (
    select y.*, row_number() over (order by y.position, y.created_at, y.id) as n
    from public.task_types y where y.project_id = p_project_id
  ),
  l as (
    select l.*, row_number() over (order by lower(l.name), l.created_at, l.id) as n
    from public.labels l where l.project_id = p_project_id
  ),
  -- Cha trước con: sắp theo cấp rồi thứ tự.
  t as (
    select t.*, row_number() over (order by t.depth, t.position, t.created_at, t.id) as n
    from public.tasks t where t.project_id = p_project_id
  )
  select jsonb_build_object(
    'version', 1,
    'statuses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', 's' || s.n, 'name', s.name, 'category', s.category, 'color', s.color,
        'position', s.position) order by s.n)
      from s), '[]'::jsonb),
    'task_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', 'y' || y.n, 'name', y.name, 'is_milestone', y.is_milestone, 'color', y.color,
        'position', y.position) order by y.n)
      from y), '[]'::jsonb),
    'labels', coalesce((
      select jsonb_agg(jsonb_build_object('key', 'l' || l.n, 'name', l.name, 'color', l.color)
        order by l.n)
      from l), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', 't' || t.n,
        'parent', case when pa.n is null then null else 't' || pa.n end,
        'title', t.title,
        'description', t.description,
        'type', 'y' || y.n,
        'status', 's' || s.n,
        'priority', t.priority,
        'labels', coalesce((
          select jsonb_agg('l' || l.n order by l.n)
          from public.task_labels tl join l on l.id = tl.label_id
          where tl.task_id = t.id), '[]'::jsonb),
        'position', t.position,
        'start_offset', case when v_start is not null and abs(t.start_date - v_start) <= 3650
                             then t.start_date - v_start end,
        'due_offset', case when v_start is not null and abs(t.due_date - v_start) <= 3650
                           then t.due_date - v_start end
      ) order by t.n)
      from t
      left join t pa on pa.id = t.parent_id
      join s on s.id = t.status_id
      join y on y.id = t.type_id), '[]'::jsonb)
  ) into v_structure;

  v_error := private.project_template_structure_error(v_structure);
  if v_error = 'too_many_tasks' then
    raise exception 'template_too_many_tasks' using errcode = 'P0001', detail = v_count::text;
  elsif v_error is not null then
    raise exception 'template_too_large' using errcode = 'P0001', detail = v_error;
  end if;

  insert into public.project_templates (id, name, structure, created_by)
  values (v_id, btrim(p_name), v_structure, auth.uid());

  -- Chỉ trả id: không đưa structure về trình duyệt (API đọc lại các cột được phép qua RLS).
  return v_id;
end;
$$;
revoke all on function public.save_project_as_template(uuid, text) from public, anon, authenticated;
grant execute on function public.save_project_as_template(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Tạo dự án từ template (quyết định 4, 6)
-- ---------------------------------------------------------------------------
-- Lỗi: không được tạo dự án 42501 (API 403); template không thấy, không tồn tại hoặc đã lưu trữ:
-- `template_not_found` P0002 (API 422 trên trường template_id); structure sai schema:
-- `template_invalid` P0001 (API 422). Ràng buộc dự án (tên, ngày) như create_project (23514).
create or replace function public.create_project_from_template(
  p_template_id uuid,
  p_name text,
  p_description text default null,
  p_start_date date default null,
  p_end_date date default null
)
returns public.projects
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_structure jsonb;
  v_error text;
  v_project_id uuid := gen_random_uuid();
  v_status_ids jsonb;
  v_type_ids jsonb;
  v_label_ids jsonb;
  v_task_ids jsonb;
  v_depth integer;
  v_row public.projects;
begin
  if auth.uid() is null or not coalesce(private.can_create_project(), false) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select pt.structure into v_structure
  from public.project_templates pt
  where pt.id = p_template_id and pt.archived_at is null;
  if not found then
    raise exception 'template_not_found' using errcode = 'P0002';
  end if;

  -- Dữ liệu không tin cậy: kiểm lại dù đã có CHECK (khôi phục sao lưu, service_role sửa tay).
  v_error := private.project_template_structure_error(v_structure);
  if v_error is not null then
    raise exception 'template_invalid' using errcode = 'P0001', detail = v_error;
  end if;

  insert into public.projects (id, name, description, start_date, end_date, template_id, created_by)
  values (v_project_id, p_name, p_description, p_start_date, p_end_date, p_template_id, auth.uid());

  -- Trạng thái, loại: trigger seed_config_defaults đã thêm mặc định. Đổi tên mặc định để tên của
  -- template không đụng chỉ mục duy nhất, chèn của template, rồi xóa mặc định (template luôn có
  -- ≥ 1 todo, ≥ 1 done, ≥ 1 loại nên trigger "còn cái cuối" cho qua).
  select jsonb_object_agg(e ->> 'key', gen_random_uuid()) into v_status_ids
  from jsonb_array_elements(v_structure -> 'statuses') e;
  select jsonb_object_agg(e ->> 'key', gen_random_uuid()) into v_type_ids
  from jsonb_array_elements(v_structure -> 'task_types') e;
  select coalesce(jsonb_object_agg(e ->> 'key', gen_random_uuid()), '{}'::jsonb) into v_label_ids
  from jsonb_array_elements(v_structure -> 'labels') e;
  select coalesce(jsonb_object_agg(e ->> 'key', gen_random_uuid()), '{}'::jsonb) into v_task_ids
  from jsonb_array_elements(v_structure -> 'tasks') e;

  update public.task_statuses s set name = '~' || s.id::text where s.project_id = v_project_id;
  update public.task_types y set name = '~' || y.id::text where y.project_id = v_project_id;

  insert into public.task_statuses (id, project_id, name, category, color, position)
  select (v_status_ids ->> (e ->> 'key'))::uuid, v_project_id, btrim(e ->> 'name'),
         (e ->> 'category')::public.task_status_category, e ->> 'color', (e ->> 'position')::float8
  from jsonb_array_elements(v_structure -> 'statuses') e;

  insert into public.task_types (id, project_id, name, is_milestone, color, position)
  select (v_type_ids ->> (e ->> 'key'))::uuid, v_project_id, btrim(e ->> 'name'),
         (e ->> 'is_milestone')::boolean, e ->> 'color', (e ->> 'position')::float8
  from jsonb_array_elements(v_structure -> 'task_types') e;

  delete from public.task_statuses s
  where s.project_id = v_project_id
    and s.id not in (select v.value::uuid from jsonb_each_text(v_status_ids) v);
  delete from public.task_types y
  where y.project_id = v_project_id
    and y.id not in (select v.value::uuid from jsonb_each_text(v_type_ids) v);

  insert into public.labels (id, project_id, name, color)
  select (v_label_ids ->> (e ->> 'key'))::uuid, v_project_id, btrim(e ->> 'name'), e ->> 'color'
  from jsonb_array_elements(v_structure -> 'labels') e;

  -- Cây task: chèn từng cấp (cha đã có khi chèn con) để trigger check_task_tree kiểm như mọi đường
  -- ghi khác. Người phụ trách luôn trống; người tạo là người gọi (mặc định auth.uid()).
  for v_depth in 1..3 loop
    with recursive t as (
      select e from jsonb_array_elements(v_structure -> 'tasks') e
    ),
    tree (e, depth) as (
      select t.e, 1 from t where jsonb_typeof(t.e -> 'parent') = 'null'
      union all
      select t.e, tree.depth + 1
      from t join tree on t.e ->> 'parent' = tree.e ->> 'key'
      where tree.depth < 3
    )
    insert into public.tasks (id, project_id, parent_id, title, description, type_id, status_id,
                              priority, position, start_date, due_date)
    select (v_task_ids ->> (e ->> 'key'))::uuid,
           v_project_id,
           case when jsonb_typeof(e -> 'parent') = 'string'
                then (v_task_ids ->> (e ->> 'parent'))::uuid end,
           btrim(e ->> 'title'),
           e ->> 'description',
           (v_type_ids ->> (e ->> 'type'))::uuid,
           (v_status_ids ->> (e ->> 'status'))::uuid,
           (e ->> 'priority')::public.task_priority,
           (e ->> 'position')::float8,
           case when p_start_date is not null and jsonb_typeof(e -> 'start_offset') = 'number'
                then p_start_date + (e ->> 'start_offset')::integer end,
           case when p_start_date is not null and jsonb_typeof(e -> 'due_offset') = 'number'
                then p_start_date + (e ->> 'due_offset')::integer end
    from tree
    where tree.depth = v_depth;
  end loop;

  insert into public.task_labels (task_id, label_id)
  select (v_task_ids ->> (e ->> 'key'))::uuid, (v_label_ids ->> (l #>> '{}'))::uuid
  from jsonb_array_elements(v_structure -> 'tasks') e,
       jsonb_array_elements(e -> 'labels') l;

  select * into v_row from public.projects p where p.id = v_project_id;
  return v_row;
end;
$$;
revoke all on function public.create_project_from_template(uuid, text, text, date, date)
  from public, anon, authenticated;
grant execute on function public.create_project_from_template(uuid, text, text, date, date)
  to authenticated;
