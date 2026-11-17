-- QLDA-51 (Story E3-2): group_by 'label_ids' trong query v1 của chế độ xem đã lưu (migration
-- 20261115260000_saved_view_group_by_labels.sql). Migration chỉ thay thân hàm kiểm
-- private.saved_view_query_is_valid, không đổi bảng, chính sách hay quyền; chính sách của
-- saved_views đã có test cho từng vai trò ở saved-views.test.sql. Ở đây kiểm: giá trị mới được nhận,
-- giá trị cũ vẫn nhận, giá trị lạ vẫn bị từ chối, quyền thực thi giữ như cũ, và một chế độ xem
-- nhóm theo nhãn đi qua đúng chính sách hiện có (Thành viên tạo riêng được, người ngoài, người bị
-- khóa, anon không).
begin;
\ir _helpers.psql

select plan(16);

select tests.seed_fixture();
-- E13-2: 7 mặc định dùng chung do migration seed có trigger chặn xóa; mở tạm cho phiên dọn.
set local app.saved_views_system_write = 'on';
delete from public.saved_views;
set local app.saved_views_system_write = 'off';

create function tests.q(group_by text)
returns jsonb language sql immutable as $$
  select jsonb_build_object('version', 1, 'filters', '{}'::jsonb, 'sort', '[]'::jsonb,
    'group_by', to_jsonb(group_by), 'columns', '["title","label_ids"]'::jsonb, 'display', 'list');
$$;
create function tests.ins(project text, view_name text, vis text, group_by text)
returns text language sql stable as $$
  select format(
    'insert into public.saved_views (project_id, name, query, visibility) values (%L, %L, %L, %L)',
    tests.uid(project), view_name, tests.q(group_by), vis);
$$;

-- ---------------------------------------------------------------------------
-- Hàm kiểm
-- ---------------------------------------------------------------------------
select ok(private.saved_view_query_is_valid(tests.q('label_ids')), 'group_by label_ids hợp lệ (E3-2)');
select ok(private.saved_view_query_is_valid(tests.q(null)), 'group_by null vẫn hợp lệ');
select ok(private.saved_view_query_is_valid(tests.q('status_id'))
  and private.saved_view_query_is_valid(tests.q('type_id'))
  and private.saved_view_query_is_valid(tests.q('assignee_id'))
  and private.saved_view_query_is_valid(tests.q('priority')),
  'Bốn giá trị group_by cũ vẫn hợp lệ');
select ok(not private.saved_view_query_is_valid(tests.q('label_id')), 'label_id (số ít) không hợp lệ');
select ok(not private.saved_view_query_is_valid(tests.q('created_by')), 'group_by lạ vẫn bị từ chối');
select ok(not private.saved_view_query_is_valid(tests.q('label_ids') || '{"version":2}'::jsonb),
  'Vẫn chỉ nhận version 1');

-- ---------------------------------------------------------------------------
-- Quyền thực thi giữ như migration gốc
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'private.saved_view_query_is_valid(jsonb)', 'execute'),
  'authenticated chạy được hàm kiểm (CHECK gọi bằng quyền người ghi)');
select ok(has_function_privilege('service_role', 'private.saved_view_query_is_valid(jsonb)', 'execute'),
  'service_role chạy được hàm kiểm');
select ok(not has_function_privilege('anon', 'private.saved_view_query_is_valid(jsonb)', 'execute'),
  'anon không chạy được hàm kiểm');
select is((select prosecdef from pg_proc where oid = 'private.saved_view_query_is_valid(jsonb)'::regprocedure),
  true, 'Hàm vẫn SECURITY DEFINER');
select ok((select proconfig from pg_proc where oid = 'private.saved_view_query_is_valid(jsonb)'::regprocedure)
  @> array['search_path=""'], 'Hàm vẫn đặt search_path rỗng');

-- ---------------------------------------------------------------------------
-- Ghi qua chính sách có sẵn
-- ---------------------------------------------------------------------------
select tests.login_as(tests.uid('member_a'));
select lives_ok(tests.ins('project_a', 'm-labels', 'private', 'label_ids'),
  'Thành viên tạo chế độ xem riêng nhóm theo nhãn');
select tests.login_as(tests.uid('pm_a'));
select lives_ok(tests.ins('project_a', 'pm-labels', 'public', 'label_ids'),
  'PM tạo chế độ xem công khai nhóm theo nhãn');
select tests.login_as(tests.uid('outsider'));
select throws_ok(tests.ins('project_a', 'o-labels', 'private', 'label_ids'), '42501', null,
  'Người ngoài không tạo được');
select tests.login_as(tests.uid('locked'));
select throws_ok(tests.ins('project_a', 'l-labels', 'private', 'label_ids'), '42501', null,
  'Người bị khóa không tạo được');
select tests.login_anon();
select throws_ok(tests.ins('project_a', 'a-labels', 'private', 'label_ids'), '42501', null,
  'anon không tạo được');

select * from finish();
rollback;
