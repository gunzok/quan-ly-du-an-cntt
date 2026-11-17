-- QLDA-54 (Story E13-2): 7 chế độ xem mặc định theo OpenProject (FR-19, S12).
-- Thiết kế: docs/03-design/database.md mục 2 (saved_views); api-contract.md mục 3, 4.
--
-- Quyết định:
--   1. Bảy chế độ xem mặc định là dòng DÙNG CHUNG mọi dự án: is_default = true, owner_id null,
--      project_id null, công khai. Dự án mới và dự án có sẵn đều thấy ngay (GET
--      /projects/{id}/views đã trả mặc định dùng chung từ E13-1), không phải sao chép theo dự án.
--      id cố định (7e0d0000-0000-4000-8000-00000000000N) để giao diện dịch tên theo ngôn ngữ và link
--      ?view={id} giống nhau ở mọi môi trường. Trùng lib/saved-views/defaults.ts.
--   2. Bộ lọc mới để biểu diễn đúng 7 chế độ (mở rộng TƯƠNG THÍCH, version vẫn là 1; mọi query hợp
--      lệ trước đây vẫn hợp lệ); trùng lib/saved-views/validate.ts và GET /tasks:
--        - assignee_id, created_by: uuid hoặc 'me' (người đang mở, đổi thành auth.uid() lúc dùng).
--        - open: true  → task chưa hoàn thành (completed_at null ⇔ trạng thái không thuộc nhóm done,
--          bất biến do trigger E2-3 giữ). Không lưu id trạng thái vì mỗi dự án có trạng thái riêng.
--        - overdue: true → chưa hoàn thành và due_date < hôm nay theo Asia/Ho_Chi_Minh (cùng định
--          nghĩa với dashboard, migration 20261115250000).
--      Sắp xếp theo updated_at/created_at đã có trong lược đồ sort v1; API danh sách task thêm tham
--      số `sort` tương ứng (không đổi CSDL).
--   3. Không ai sửa, xóa mặc định dùng chung qua API: RLS (E13-1) đã loại dòng mặc định khỏi
--      UPDATE/DELETE với authenticated; thêm trigger `guard_default_saved_views` chặn cả service_role
--      (và mọi đường ghi khác) với dòng mặc định dùng chung. Chỉ phiên đặt
--      `set local app.saved_views_system_write = 'on'` (migration sau này, test pgTAP cần dọn) mới
--      sửa, xóa được; PostgREST không cho client đặt GUC này. Mặc định THEO DỰ ÁN (project_id có giá
--      trị, chưa dùng) không bị trigger chặn để xóa dự án vẫn xóa dây chuyền được.
--   4. Thêm dòng mặc định mới không bị chặn ở đây (chỉ hệ thống có quyền: trình duyệt không có quyền
--      cột is_default, RLS insert đòi not is_default).

-- ---------------------------------------------------------------------------
-- 1. Hàm kiểm query: thêm created_by, 'me', open, overdue
-- ---------------------------------------------------------------------------
create or replace function private.saved_view_query_is_valid(p_query jsonb)
returns boolean
language plpgsql
immutable
security definer
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
       or p_query ->> 'group_by' not in ('status_id', 'type_id', 'assignee_id', 'priority',
                                        'label_ids')) then
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
      when 'label_id' then
        if jsonb_typeof(val) <> 'string' or val #>> '{}' !~ uuid_re then
          return false;
        end if;
      when 'assignee_id', 'created_by' then
        -- uuid hoặc 'me' (người đang mở chế độ xem, E13-2).
        if jsonb_typeof(val) <> 'string'
           or (val #>> '{}' !~ uuid_re and val #>> '{}' <> 'me') then
          return false;
        end if;
      when 'open', 'overdue' then
        -- Chỉ nhận true (false không có nghĩa lọc, giữ một cách viết duy nhất), E13-2.
        if val <> 'true'::jsonb then
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
  'Hình dạng hợp lệ của saved_views.query (version 1; group_by label_ids từ E3-2; bộ lọc created_by, me, open, overdue từ E13-2). Phải trùng lib/saved-views/validate.ts.';

revoke all on function private.saved_view_query_is_valid(jsonb) from public, anon, authenticated;
grant execute on function private.saved_view_query_is_valid(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Trigger: mặc định dùng chung không sửa, xóa được (kể cả service_role)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER theo quy ước schema private; chỉ đọc OLD và một GUC, không đọc bảng.
create or replace function private.guard_default_saved_views()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_default and old.project_id is null
     and coalesce(current_setting('app.saved_views_system_write', true), '') <> 'on' then
    raise exception 'saved_view_default_immutable' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
comment on function private.guard_default_saved_views() is
  'Chặn sửa, xóa chế độ xem mặc định dùng chung (E13-2) trừ phiên hệ thống đặt app.saved_views_system_write = on.';

revoke all on function private.guard_default_saved_views() from public, anon, authenticated;

create trigger guard_default_saved_views before update or delete on public.saved_views
  for each row execute function private.guard_default_saved_views();

-- ---------------------------------------------------------------------------
-- 3. Seed 7 chế độ xem mặc định (thứ tự OpenProject; tên tiếng Việt, giao diện dịch theo id)
-- ---------------------------------------------------------------------------
insert into public.saved_views (id, project_id, owner_id, name, query, visibility, is_default)
values
  ('7e0d0000-0000-4000-8000-000000000001', null, null, 'Tất cả đang mở',
   '{"version":1,"filters":{"open":true},"sort":[],"group_by":null,"columns":["title","type_id","status_id","assignee_id","due_date"],"display":"list"}',
   'public', true),
  ('7e0d0000-0000-4000-8000-000000000002', null, null, 'Hoạt động gần nhất',
   '{"version":1,"filters":{"open":true},"sort":[{"field":"updated_at","direction":"desc"}],"group_by":null,"columns":["title","type_id","status_id","assignee_id","updated_at"],"display":"list"}',
   'public', true),
  ('7e0d0000-0000-4000-8000-000000000003', null, null, 'Mới tạo',
   '{"version":1,"filters":{"open":true},"sort":[{"field":"created_at","direction":"desc"}],"group_by":null,"columns":["title","type_id","status_id","assignee_id","created_at"],"display":"list"}',
   'public', true),
  ('7e0d0000-0000-4000-8000-000000000004', null, null, 'Quá hạn',
   '{"version":1,"filters":{"overdue":true},"sort":[{"field":"due_date","direction":"asc"}],"group_by":null,"columns":["title","type_id","status_id","assignee_id","due_date"],"display":"list"}',
   'public', true),
  ('7e0d0000-0000-4000-8000-000000000005', null, null, 'Tóm tắt',
   '{"version":1,"filters":{},"sort":[],"group_by":"status_id","columns":["title","type_id","status_id","assignee_id","priority","due_date"],"display":"list"}',
   'public', true),
  ('7e0d0000-0000-4000-8000-000000000006', null, null, 'Tạo bởi tôi',
   '{"version":1,"filters":{"open":true,"created_by":"me"},"sort":[{"field":"created_at","direction":"desc"}],"group_by":null,"columns":["title","type_id","status_id","assignee_id","due_date","created_at"],"display":"list"}',
   'public', true),
  ('7e0d0000-0000-4000-8000-000000000007', null, null, 'Giao cho tôi',
   '{"version":1,"filters":{"open":true,"assignee_id":"me"},"sort":[{"field":"due_date","direction":"asc"}],"group_by":null,"columns":["title","type_id","status_id","priority","due_date"],"display":"list"}',
   'public', true)
on conflict (id) do nothing;
