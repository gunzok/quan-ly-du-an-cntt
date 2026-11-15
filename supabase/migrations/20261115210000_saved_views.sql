-- QLDA-53 (Story E13-1): chế độ xem đã lưu (FR-19, BR-12). Chỉ schema, RLS, API; chưa giao diện.
-- Thiết kế: docs/03-design/database.md mục 2 (saved_views), 4 (chỉ mục), 5 (RLS);
-- api-contract.md mục 3 (GET/POST /projects/{id}/views, GET/PATCH/DELETE /views/{id}).
--
-- Quyết định:
--   1. Chế độ xem chỉ lưu CÁCH XEM (`query`: bộ lọc, sắp xếp, nhóm, cột, kiểu hiển thị), KHÔNG lưu
--      danh sách task (BR-12). Khi dùng, API danh sách task chạy bằng phiên của người mở, nên RLS
--      của tasks vẫn quyết định thấy gì.
--   2. `query` có hình dạng cố định (đủ 6 khóa, khóa lạ bị từ chối) kiểm bằng CHECK gọi hàm thuần
--      `private.saved_view_query_is_valid` (IMMUTABLE), cộng giới hạn 8 KB. API chuẩn hóa và kiểm
--      giống hệt (lib/saved-views/validate.ts) rồi mới ghi; CHECK là lưới đỡ cho mọi đường ghi.
--      id trạng thái, nhãn, người trong bộ lọc chỉ kiểm ĐỊNH DẠNG uuid lúc lưu; có thuộc dự án hay
--      không thì lúc dùng mới có ý nghĩa (trạng thái/nhãn có thể bị xóa, người có thể rời dự án sau
--      khi lưu); API danh sách task luôn lọc trong đúng dự án nên id lạ chỉ cho kết quả rỗng.
--   3. Chế độ xem mặc định: cờ `is_default`, `owner_id` null, luôn `public`; do hệ thống tạo (seed,
--      E13-2), trình duyệt không có quyền cột `is_default` và RLS loại hẳn dòng mặc định khỏi
--      UPDATE/DELETE. `project_id` chỉ được null với chế độ xem mặc định (mẫu dùng chung mọi dự án);
--      chế độ xem do người dùng tạo luôn thuộc một dự án.
--   4. Quyền (BR-01, BR-10):
--        - Riêng tư: chỉ chủ sở hữu đọc, sửa, xóa, và chỉ khi còn thuộc dự án (hoặc là Admin).
--          Admin KHÔNG đọc chế độ xem riêng tư của người khác.
--        - Công khai: mọi người thấy dự án (thành viên mọi vai trò, Admin) đọc được; chỉ PM của dự
--          án và Admin tạo, sửa, xóa (kể cả của PM khác).
--        - Đổi công khai → riêng tư: chỉ chủ sở hữu (WITH CHECK đòi owner_id = người gọi), để PM
--          khác hay Admin không biến chế độ xem của người khác thành riêng tư của người đó.
--        - Người bị khóa: không có quyền gì (private.project_role_of, private.is_admin trả null/false).
--   5. `project_id`, `owner_id`, `is_default` không đổi sau khi tạo: trình duyệt không có quyền cột,
--      thêm trigger `guard_saved_view_identity` chặn cả service_role.
--   6. Tên 1..100 ký tự (sau btrim), duy nhất theo (project_id, owner_id) không phân biệt hoa thường
--      (NULLS NOT DISTINCT để chế độ xem mặc định cũng không trùng tên). Hai PM vẫn có thể cùng đặt
--      một tên cho hai chế độ xem công khai (đúng yêu cầu "duy nhất theo chủ sở hữu").
--   7. Yêu thích là của TỪNG người (kể cả với chế độ xem công khai và mặc định): bảng riêng
--      `saved_view_favorites (view_id, user_id)` thay cho cột `is_favorite` trong database.md. Chỉ
--      đánh dấu được chế độ xem mình đọc được; chỉ đọc/xóa dấu của mình.
--   8. Xóa dự án xóa theo chế độ xem (CASCADE) và dấu yêu thích (CASCADE theo chế độ xem). Xóa hồ sơ
--      xóa theo chế độ xem của người đó (hồ sơ thường bị khóa chứ không xóa, database.md mục 7).
--   9. Chưa ghi activity_logs (entity_type chưa nhận saved_view); chưa giới hạn số chế độ xem mỗi
--      người.

-- ---------------------------------------------------------------------------
-- 1. Kiểm hình dạng query (hàm thuần, dùng trong CHECK)
-- ---------------------------------------------------------------------------
-- Giá trị cho phép phải trùng lib/saved-views/model.ts (test tích hợp ghi đủ mọi giá trị để phát
-- hiện lệch). Bộ lọc theo đúng quy tắc của GET /api/v1/projects/{id}/tasks (lib/tasks/validate.ts,
-- lib/tasks/search.ts): q 1..200 ký tự không ký tự điều khiển; status_id 1..20 uuid không trùng;
-- assignee_id, label_id là uuid; priority trong enum; due_after ≤ due_before, ngày YYYY-MM-DD có
-- thật. uuid lưu chữ thường (API chuẩn hóa).
create or replace function private.saved_view_query_is_valid(p_query jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  date_re constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  filters jsonb;
  item jsonb;
  key text;
  val jsonb;
  n integer;
  due_after date;
  due_before date;
begin
  if p_query is null or jsonb_typeof(p_query) <> 'object' then
    return false;
  end if;
  if octet_length(p_query::text) > 8192 then
    return false;
  end if;
  -- Đủ đúng 6 khóa.
  if not (p_query ?& array['version', 'filters', 'sort', 'group_by', 'columns', 'display'])
     or (select count(*) from jsonb_object_keys(p_query)) <> 6 then
    return false;
  end if;

  if p_query -> 'version' <> '1'::jsonb then
    return false;
  end if;

  if jsonb_typeof(p_query -> 'display') <> 'string'
     or p_query ->> 'display' not in ('list', 'board', 'gantt') then
    return false;
  end if;

  if jsonb_typeof(p_query -> 'group_by') <> 'null' and (
       jsonb_typeof(p_query -> 'group_by') <> 'string'
       or p_query ->> 'group_by' not in ('status_id', 'type_id', 'assignee_id', 'priority')) then
    return false;
  end if;

  -- Cột hiển thị: mảng chuỗi trong danh sách, không trùng.
  if jsonb_typeof(p_query -> 'columns') <> 'array'
     or jsonb_array_length(p_query -> 'columns') > 13 then
    return false;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_query -> 'columns') e
    where jsonb_typeof(e) <> 'string'
       or e #>> '{}' not in ('title', 'status_id', 'type_id', 'priority', 'assignee_id',
                             'created_by', 'start_date', 'due_date', 'label_ids', 'parent_id',
                             'created_at', 'updated_at', 'completed_at')
  ) or (
    select count(distinct e) <> count(*) from jsonb_array_elements(p_query -> 'columns') e
  ) then
    return false;
  end if;

  -- Sắp xếp: tối đa 3 tiêu chí {field, direction}, không trùng field.
  if jsonb_typeof(p_query -> 'sort') <> 'array'
     or jsonb_array_length(p_query -> 'sort') > 3 then
    return false;
  end if;
  for item in select e from jsonb_array_elements(p_query -> 'sort') e loop
    if jsonb_typeof(item) <> 'object'
       or not (item ?& array['field', 'direction'])
       or (select count(*) from jsonb_object_keys(item)) <> 2
       or jsonb_typeof(item -> 'field') <> 'string'
       or jsonb_typeof(item -> 'direction') <> 'string'
       or item ->> 'field' not in ('created_at', 'updated_at', 'title', 'priority', 'status_id',
                                   'type_id', 'assignee_id', 'start_date', 'due_date', 'position')
       or item ->> 'direction' not in ('asc', 'desc') then
      return false;
    end if;
  end loop;
  if (select count(distinct e -> 'field') <> count(*) from jsonb_array_elements(p_query -> 'sort') e) then
    return false;
  end if;

  -- Bộ lọc.
  filters := p_query -> 'filters';
  if jsonb_typeof(filters) <> 'object' then
    return false;
  end if;
  for key, val in select k, v from jsonb_each(filters) as f(k, v) loop
    case key
      when 'q' then
        if jsonb_typeof(val) <> 'string'
           or char_length(val #>> '{}') not between 1 and 200
           or val #>> '{}' <> btrim(val #>> '{}')
           or val #>> '{}' ~ '[\x01-\x1f\x7f]' then
          return false;
        end if;
      when 'status_id' then
        if jsonb_typeof(val) <> 'array' then
          return false;
        end if;
        n := jsonb_array_length(val);
        if n not between 1 and 20
           or exists (select 1 from jsonb_array_elements(val) e
                      where jsonb_typeof(e) <> 'string' or e #>> '{}' !~ uuid_re)
           or (select count(distinct e) from jsonb_array_elements(val) e) <> n then
          return false;
        end if;
      when 'assignee_id', 'label_id' then
        if jsonb_typeof(val) <> 'string' or val #>> '{}' !~ uuid_re then
          return false;
        end if;
      when 'priority' then
        if jsonb_typeof(val) <> 'string'
           or val #>> '{}' not in ('low', 'medium', 'high', 'urgent') then
          return false;
        end if;
      when 'due_after', 'due_before' then
        if jsonb_typeof(val) <> 'string' or val #>> '{}' !~ date_re then
          return false;
        end if;
        begin
          -- Ngày có thật (không nhận 2026-02-30), năm 1900..9999 như API.
          -- Dạng ISO YYYY-MM-DD đọc giống nhau với mọi DateStyle; ngày không có thật thì lỗi.
          if extract(year from (val #>> '{}')::date) not between 1900 and 9999 then
            return false;
          end if;
        exception when others then
          return false;
        end;
      else
        return false;
    end case;
  end loop;
  due_after := (filters ->> 'due_after')::date;
  due_before := (filters ->> 'due_before')::date;
  if due_after is not null and due_before is not null and due_after > due_before then
    return false;
  end if;

  return true;
end;
$$;
comment on function private.saved_view_query_is_valid(jsonb) is
  'Hình dạng hợp lệ của saved_views.query (version 1). Phải trùng lib/saved-views/validate.ts.';

-- ---------------------------------------------------------------------------
-- 2. Bảng
-- ---------------------------------------------------------------------------
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade,
  owner_id uuid default auth.uid() references public.profiles (id) on delete cascade,
  name text not null,
  query jsonb not null,
  visibility text not null default 'private',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_views_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint saved_views_visibility_check check (visibility in ('private', 'public')),
  constraint saved_views_query_valid check (private.saved_view_query_is_valid(query)),
  -- Mặc định: không chủ sở hữu, công khai, có thể dùng chung (project_id null).
  -- Do người dùng tạo: có chủ sở hữu và dự án.
  constraint saved_views_default_shape check (
    (is_default and owner_id is null and visibility = 'public')
    or (not is_default and owner_id is not null and project_id is not null)
  )
);
comment on table public.saved_views is
  'Chế độ xem đã lưu (FR-19): chỉ lưu cách xem (query), không lưu danh sách task (BR-12). '
  'Mặc định (is_default) do hệ thống tạo, không sửa/xóa qua API.';
comment on column public.saved_views.project_id is
  'Dự án; null chỉ cho chế độ xem mặc định dùng chung mọi dự án.';
comment on column public.saved_views.query is
  '{version:1, filters, sort, group_by, columns, display}; xem private.saved_view_query_is_valid.';

-- Danh sách chế độ xem theo dự án và chủ sở hữu (database.md mục 4) do chỉ mục duy nhất này phục
-- vụ (hai cột đầu là project_id, owner_id).
create unique index saved_views_project_owner_name_ci_key
  on public.saved_views (project_id, owner_id, lower(btrim(name))) nulls not distinct;
-- Xóa dây chuyền từ profiles.
create index saved_views_owner_id_idx on public.saved_views (owner_id);

create trigger set_updated_at before update on public.saved_views
  for each row execute function public.set_updated_at();

create table public.saved_view_favorites (
  view_id uuid not null references public.saved_views (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (view_id, user_id)
);
comment on table public.saved_view_favorites is
  'Chế độ xem yêu thích của từng người (kể cả chế độ xem công khai, mặc định).';
create index saved_view_favorites_user_id_idx on public.saved_view_favorites (user_id);

-- ---------------------------------------------------------------------------
-- 3. Trigger: project_id, owner_id, is_default không đổi (mọi đường ghi, kể cả service_role)
-- ---------------------------------------------------------------------------
create or replace function private.guard_saved_view_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_id is distinct from old.project_id
     or new.owner_id is distinct from old.owner_id
     or new.is_default is distinct from old.is_default then
    raise exception 'saved_view_identity_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger guard_saved_view_identity before update on public.saved_views
  for each row execute function private.guard_saved_view_identity();

revoke all on function private.saved_view_query_is_valid(jsonb), private.guard_saved_view_identity()
  from public, anon, authenticated;
-- CHECK gọi hàm với quyền của người ghi: trình duyệt và đường hệ thống (seed chế độ xem mặc định
-- bằng service_role, E13-2) cần quyền chạy. Hàm thuần, không đọc bảng nào.
grant execute on function private.saved_view_query_is_valid(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Quyền bảng (GRANT) — lớp ngoài của RLS
-- ---------------------------------------------------------------------------
-- Không có quyền cột: id, owner_id (mặc định auth.uid()), is_default, created_at, updated_at;
-- project_id chỉ khi tạo.
revoke all on public.saved_views, public.saved_view_favorites from anon, authenticated;

grant select, delete on public.saved_views to authenticated;
grant insert (project_id, name, query, visibility) on public.saved_views to authenticated;
grant update (name, query, visibility) on public.saved_views to authenticated;

-- Dấu yêu thích: user_id luôn là người gọi (mặc định auth.uid()), không sửa dòng.
grant select, delete on public.saved_view_favorites to authenticated;
grant insert (view_id) on public.saved_view_favorites to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
alter table public.saved_views enable row level security;
alter table public.saved_view_favorites enable row level security;

-- Đọc: phải thấy dự án (thành viên đang hoạt động hoặc Admin); mặc định dùng chung thì mọi người
-- đang hoạt động; trong đó chỉ chế độ xem công khai hoặc của chính mình.
create policy saved_views_select on public.saved_views
  for select to authenticated
  using (
    (case
       when project_id is null then is_default and (select private.is_active_user())
       else (select private.is_admin()) or private.project_role_of(project_id) is not null
     end)
    and (visibility = 'public' or owner_id = (select auth.uid()))
  );

-- Tạo: riêng tư cho mọi vai trò trong dự án (và Admin); công khai chỉ PM của dự án và Admin.
create policy saved_views_insert on public.saved_views
  for insert to authenticated
  with check (
    not is_default
    and owner_id = (select auth.uid())
    and (
      (visibility = 'private'
        and ((select private.is_admin()) or private.project_role_of(project_id) is not null))
      or (visibility = 'public'
        and ((select private.is_admin()) or private.project_role_of(project_id) = 'pm'))
    )
  );

-- Sửa: riêng tư của mình (còn thuộc dự án); công khai nếu là PM của dự án hoặc Admin. Kết quả sau
-- khi sửa: riêng tư thì phải là của mình (chặn PM/Admin biến chế độ xem của người khác thành riêng
-- tư), công khai thì phải là PM/Admin (chặn Thành viên tự công khai).
create policy saved_views_update on public.saved_views
  for update to authenticated
  using (
    not is_default
    and (
      (visibility = 'private' and owner_id = (select auth.uid())
        and ((select private.is_admin()) or private.project_role_of(project_id) is not null))
      or (visibility = 'public'
        and ((select private.is_admin()) or private.project_role_of(project_id) = 'pm'))
    )
  )
  with check (
    not is_default
    and (
      (visibility = 'private' and owner_id = (select auth.uid())
        and ((select private.is_admin()) or private.project_role_of(project_id) is not null))
      or (visibility = 'public'
        and ((select private.is_admin()) or private.project_role_of(project_id) = 'pm'))
    )
  );

create policy saved_views_delete on public.saved_views
  for delete to authenticated
  using (
    not is_default
    and (
      (visibility = 'private' and owner_id = (select auth.uid())
        and ((select private.is_admin()) or private.project_role_of(project_id) is not null))
      or (visibility = 'public'
        and ((select private.is_admin()) or private.project_role_of(project_id) = 'pm'))
    )
  );

-- Yêu thích: chỉ dấu của mình; chỉ đánh dấu chế độ xem mình đọc được (truy vấn con chịu RLS
-- saved_views_select của người gọi).
create policy saved_view_favorites_select on public.saved_view_favorites
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_user()));
create policy saved_view_favorites_insert on public.saved_view_favorites
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select private.is_active_user())
    and exists (select 1 from public.saved_views v where v.id = view_id)
  );
create policy saved_view_favorites_delete on public.saved_view_favorites
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_user()));
