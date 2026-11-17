-- Story E3-2 (QLDA-51): bảng phân cấp nhóm được theo NHÃN.
--
-- Bảng phân cấp (S04, S12) nhóm task theo trạng thái, loại, người phụ trách, ưu tiên và nhãn. Trạng
-- thái bảng được thiết kế theo lược đồ query v1 của saved_views để E13-2/E13-3 lưu được; v1 chưa có
-- `label_ids` trong group_by nên migration này thay hàm kiểm private.saved_view_query_is_valid, chỉ
-- thêm 'label_ids' vào danh sách group_by (mở rộng tương thích: mọi query hợp lệ trước đây vẫn hợp
-- lệ, version vẫn là 1). Mọi phần khác giữ nguyên từng dòng như 20261115210000_saved_views.sql.
--
-- Nhóm theo nhãn: task có nhiều nhãn hiện ở mỗi nhóm nhãn của nó; task không nhãn ở nhóm "Không
-- nhãn". Giá trị phải trùng VIEW_GROUP_BY trong lib/saved-views/model.ts.
--
-- Không đổi bảng, chính sách hay quyền: chỉ thay thân hàm (CHECK saved_views_query_valid gọi hàm
-- này). Quyền thực thi cấp lại tường minh như migration gốc.

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
  'Hình dạng hợp lệ của saved_views.query (version 1; group_by có label_ids từ E3-2). Phải trùng lib/saved-views/validate.ts.';

revoke all on function private.saved_view_query_is_valid(jsonb) from public, anon, authenticated;
grant execute on function private.saved_view_query_is_valid(jsonb) to authenticated, service_role;
