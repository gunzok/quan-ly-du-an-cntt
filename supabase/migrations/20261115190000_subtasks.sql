-- QLDA-42 (Story E2-4): subtask tối đa 3 cấp (FR-07) và quy tắc đóng task cha (BR-04).
-- Thiết kế: docs/03-design/database.md mục 2 (tasks.parent_id, depth), mục 3 (trigger depth, BR-04);
-- api-contract.md mục 3 (POST /projects/{id}/tasks với parent_id, PATCH /tasks/{id}).
--
-- Quyết định:
--   1. Độ sâu LƯU ở cột tasks.depth (đã có từ E2-2, CHECK 1..3), không tính lại bằng CTE đệ quy mỗi
--      lần đọc: API trả depth ngay, lọc/sắp theo cấp không cần đệ quy. Trigger BEFORE đặt
--      depth = depth cha + 1 (gốc = 1); trình duyệt không có quyền cột depth. Khi một task đổi cha,
--      trigger AFTER cập nhật depth của con, con lại cập nhật cháu (tối đa 2 bậc vì cây ≤ 3 cấp).
--      Đánh đổi: chuyển một cây phải ghi lại mọi hậu duệ (≤ vài chục dòng trong thực tế) và mỗi
--      dòng hậu duệ có một bản ghi nhật ký "depth" (activity_logs); đổi lại đọc rẻ và đơn giản.
--   2. Kiểm khi tạo hoặc đổi cha (mọi đường ghi, kể cả service_role), theo thứ tự:
--        a. (người dùng cuối, auth.uid() có giá trị, chỉ khi INSERT) quyền tạo task trong dự án,
--           TRƯỚC mọi kiểm khác, lỗi 42501 giống RLS: người ngoài không dùng lỗi cha/con để dò task
--           của dự án mình không thấy (BEFORE trigger chạy trước WITH CHECK của RLS). UPDATE đã qua
--           USING của RLS nên người gọi chắc chắn sửa được dòng này.
--        b. cha phải tồn tại và CÙNG dự án: không có hoặc khác dự án đều báo MỘT lỗi
--           `parent_not_in_project` (không phân biệt hai trường hợp, không lộ task dự án khác);
--        c. (người dùng cuối) phải có quyền SỬA task cha (giống tasks_update, BR-03), lỗi 42501
--           `parent_not_editable`: gắn việc con làm đổi nghĩa task cha (chặn đóng cha, BR-04), nên
--           không cho Thành viên gắn việc con vào task người khác mà mình không sửa được. Giống E8-1
--           (quan hệ cần quyền sửa cả hai task). KHÔNG đòi quyền với cha CŨ khi gỡ/chuyển đi.
--        d. không tự làm cha của mình, không tạo vòng (cha mới là hậu duệ của chính task): lỗi
--           `task_parent_cycle`;
--        e. depth mới ≤ 3 VÀ depth mới + chiều cao cây con ≤ 3 (kiểm cả chiều dưới khi chuyển cây):
--           lỗi `subtask_depth_exceeded`.
--      Đổi project_id (chỉ service_role làm được) của task đang có con: `task_has_subtasks`.
--   3. Đồng thời (READ COMMITTED, mặc định PostgREST): hai lần chuyển cây cùng lúc (A vào dưới B
--      và B vào dưới A; hoặc chuyển P xuống sâu trong khi tạo con dưới P) đều có thể lọt nếu mỗi
--      bên chỉ thấy dữ liệu đã commit. Dùng khóa tư vấn MỘT khóa toàn cục cho "cấu trúc cây":
--        - UPDATE có đổi parent_id: khóa ĐỘC QUYỀN ở trigger mức CÂU LỆNH (BEFORE ... FOR EACH
--          STATEMENT), tức là TRƯỚC khi câu lệnh khóa dòng nào. Vì vậy hai lần chuyển cây không
--          thể giữ dòng của nhau rồi chờ khóa tư vấn (không khóa chết), dù cùng một cây.
--        - INSERT có parent_id: khóa CHIA SẺ ở trigger dòng. Tạo việc con không chờ nhau, chỉ chờ
--          lần chuyển cây đang chạy (và ngược lại). Dòng mới chưa ai thấy nên không gây khóa chết.
--      Sau khi có khóa, mỗi câu lệnh trong hàm plpgsql VOLATILE lấy ảnh chụp mới nên thấy thay đổi
--      vừa commit của giao dịch trước. Đánh đổi: chuyển cây tuần tự hóa trên toàn hệ thống (thao tác
--      hiếm, giao dịch vài ms); chọn khóa toàn cục vì khóa theo dự án phải lấy ở trigger dòng, tức
--      SAU khi dòng đã bị khóa, và hai lần chuyển trong cùng một cây khi đó có thể khóa chết.
--   4. BR-04: trigger AFTER UPDATE OF status_id trên tasks. Đưa task vào trạng thái thuộc nhóm done
--      (đổi status_id sang một trạng thái done, kể cả từ done này sang done khác) thì MỌI hậu duệ
--      (không chỉ con trực tiếp) phải ở nhóm done; "Đã đóng", "Từ chối" là nhóm done nên tính là
--      xong. Lỗi P0001 `parent_has_open_subtasks`, DETAIL = tối đa 5 id hậu duệ chưa xong (cách nhau
--      dấu phẩy, nông trước) để API trả 422 kèm danh sách. Người gọi sửa được task cha thì cùng dự
--      án nên thấy mọi hậu duệ (RLS đọc theo dự án): danh sách id không lộ gì.
--      AFTER (không BEFORE): trigger AFTER chạy khi câu lệnh xong nên thấy MỌI dòng câu lệnh đã sửa.
--      Một lệnh chuyển cả cha lẫn con sang done (public.delete_task_status với p_replace_with) vì
--      thế không bị chặn oan do thứ tự xử lý dòng.
--      Đồng thời: trước khi kiểm, khóa FOR SHARE mọi hậu duệ theo thứ tự (depth, id), từ trên xuống.
--      Lệnh mở lại con đang chạy dở thì việc đóng cha CHỜ nó commit rồi kiểm lại trên bản mới nhất
--      (bị từ chối); việc đóng cha khóa trước thì lệnh mở lại con chờ cha commit rồi mới chạy.
--   5. Chỉ chặn HÀNH ĐỘNG đóng cha. Không chặn: mở lại một việc con khi cha đã done, tạo việc con
--      chưa xong dưới cha đã done, chuyển một cây chưa xong vào dưới cha đã done. Các trường hợp
--      này làm cha done mà còn con mở (cha không tự mở lại); giao diện nên hiện cảnh báo. Lý do:
--      ticket yêu cầu mở lại con không bị chặn; tạo/chuyển con được xử lý nhất quán như mở lại.
--      Vì vậy mọi kết quả đồng thời đều tương đương một thứ tự tuần tự hợp lệ.
--   6. PM đổi nhóm của một trạng thái sang done (task_statuses.category): mọi task đang ở trạng thái
--      đó rơi vào done. Nếu một task như thế còn hậu duệ chưa done (hậu duệ ở chính trạng thái đó
--      cũng thành done nên tính là xong) thì CHẶN việc đổi nhóm, cùng lỗi `parent_has_open_subtasks`
--      (API cấu hình trả 422). Chọn chặn thay vì cho qua để BR-04 không có đường vòng.
--   7. Xóa task cha: GIỮ hành vi đã có từ E2-2: khóa ngoại parent_id ON DELETE CASCADE xóa theo mọi
--      hậu duệ, và xóa dây chuyền không qua RLS (Thành viên xóa task mình tạo thì việc con người
--      khác tạo cũng mất). Chưa có quy định nên không đổi ở Story này (câu hỏi ghi trong PR).

-- ---------------------------------------------------------------------------
-- 1. Backfill depth cho dữ liệu đã có (trình duyệt chưa từng ghi được parent_id; service_role thì
--    có thể). Cây sai (vòng, khác dự án, quá 3 cấp) làm migration lỗi: cố ý, phải sửa tay dữ liệu.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from public.tasks c join public.tasks p on p.id = c.parent_id
    where p.project_id <> c.project_id
  ) then
    raise exception 'Có task cha khác dự án với task con; sửa dữ liệu trước khi chạy migration.';
  end if;
end;
$$;

with recursive tree (id, depth) as (
  select t.id, 1 from public.tasks t where t.parent_id is null
  union all
  select c.id, tree.depth + 1
  from public.tasks c
  join tree on c.parent_id = tree.id
  where tree.depth < 4
)
update public.tasks t
set depth = tree.depth
from tree
where tree.id = t.id and t.depth is distinct from tree.depth;

comment on column public.tasks.depth is
  'Cấp subtask 1-3 (gốc = 1). Do trigger check_task_tree đặt và cập nhật; không ghi trực tiếp.';
comment on column public.tasks.parent_id is
  'Task cha cùng dự án (tối đa 3 cấp, không vòng). Xóa cha xóa theo mọi hậu duệ (ON DELETE CASCADE).';

-- ---------------------------------------------------------------------------
-- 2. Khóa cấu trúc cây (quyết định 3)
-- ---------------------------------------------------------------------------
-- Khóa ĐỘC QUYỀN trước khi câu lệnh UPDATE ... parent_id khóa dòng nào.
create or replace function private.lock_task_tree_exclusive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('public.tasks:tree', 0));
  return null;
end;
$$;
revoke all on function private.lock_task_tree_exclusive() from public, anon, authenticated;

create trigger lock_tree_on_move
  before update of parent_id on public.tasks
  for each statement execute function private.lock_task_tree_exclusive();

-- ---------------------------------------------------------------------------
-- 3. Trigger dòng: depth, cùng dự án, quyền với cha, chống vòng, giới hạn 3 cấp (quyết định 1, 2)
-- ---------------------------------------------------------------------------
create or replace function private.check_task_tree()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_project uuid;
  v_parent_depth smallint;
  v_subtree_height integer := 0;
begin
  -- Chỉ depth đổi (trigger AFTER cascade_subtask_depth, hoặc service_role ghi tay): tính lại từ cha.
  if tg_op = 'UPDATE'
     and new.parent_id is not distinct from old.parent_id
     and new.project_id = old.project_id then
    if new.parent_id is null then
      new.depth := 1;
    else
      select p.depth + 1 into new.depth from public.tasks p where p.id = new.parent_id;
    end if;
    return new;
  end if;

  -- 2a. Người ngoài dự án: lỗi giống RLS trước mọi kiểm khác (chống dò).
  -- coalesce: project_role_of() trả null với người ngoài, và "null in (...)" là null chứ không false.
  if tg_op = 'INSERT' and auth.uid() is not null and not coalesce(
    private.is_admin() or private.project_role_of(new.project_id) in ('pm', 'member'), false
  ) then
    raise exception 'new row violates row-level security policy for table "tasks"'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.parent_id is null then
      new.depth := 1;
      return new;
    end if;
    perform pg_advisory_xact_lock_shared(hashtextextended('public.tasks:tree', 0));
  else
    -- UPDATE đổi parent_id (đã có khóa độc quyền mức câu lệnh) hoặc project_id (service_role).
    perform pg_advisory_xact_lock(hashtextextended('public.tasks:tree', 0));
    if new.project_id <> old.project_id and exists (
      select 1 from public.tasks c where c.parent_id = new.id
    ) then
      raise exception 'task_has_subtasks' using errcode = 'P0001';
    end if;
    -- Chiều cao cây con hiện tại (0 nếu không có con), đọc từ depth đã lưu.
    select coalesce(max(d.depth), old.depth) - old.depth into v_subtree_height
    from (
      with recursive sub (id, depth) as (
        select c.id, c.depth from public.tasks c where c.parent_id = new.id
        union
        select c.id, c.depth from public.tasks c join sub on c.parent_id = sub.id
      )
      select sub.depth from sub
    ) d;
  end if;

  if new.parent_id is null then
    new.depth := 1;
    return new;
  end if;

  -- 2b. Cha phải tồn tại và cùng dự án; hai trường hợp chung một lỗi.
  select p.project_id, p.depth into v_parent_project, v_parent_depth
  from public.tasks p where p.id = new.parent_id;
  if v_parent_project is null or v_parent_project <> new.project_id then
    raise exception 'parent_not_in_project' using errcode = 'P0001';
  end if;

  -- 2c. Người dùng cuối phải sửa được task cha.
  if auth.uid() is not null and not private.can_edit_task(new.parent_id) then
    raise exception 'parent_not_editable' using errcode = '42501';
  end if;

  -- 2d. Tự làm cha của mình, hoặc cha mới nằm trong cây con của chính task (đi ngược lên từ cha).
  if new.parent_id = new.id or (tg_op = 'UPDATE' and exists (
    with recursive up (id, parent_id) as (
      select p.id, p.parent_id from public.tasks p where p.id = new.parent_id
      union
      select p.id, p.parent_id from public.tasks p join up on p.id = up.parent_id
    )
    select 1 from up where up.id = new.id
  )) then
    raise exception 'task_parent_cycle' using errcode = 'P0001';
  end if;

  -- 2e. Tối đa 3 cấp, tính cả cây con đi theo.
  new.depth := v_parent_depth + 1;
  if new.depth + v_subtree_height > 3 then
    raise exception 'subtask_depth_exceeded'
      using errcode = 'P0001',
            detail = format('Cấp mới %s, cây con cao thêm %s, tối đa 3.', new.depth, v_subtree_height);
  end if;
  return new;
end;
$$;
revoke all on function private.check_task_tree() from public, anon, authenticated;

-- Thứ tự với apply_task_config, check_assignee (trigger BEFORE chạy theo tên) không quan trọng:
-- các trigger đọc/ghi những cột khác nhau.
create trigger check_task_tree
  before insert or update of parent_id, project_id, depth on public.tasks
  for each row execute function private.check_task_tree();

-- Đổi cha (hoặc depth đổi theo cha): cập nhật depth của con; trigger trên con lại cập nhật cháu.
-- Khai báo theo parent_id, project_id, depth: trigger "UPDATE OF cột" chỉ chạy khi cột có trong SET
-- của câu lệnh, còn depth ở đây thường do trigger BEFORE đổi (câu lệnh chỉ SET parent_id).
create or replace function private.cascade_subtask_depth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks c set depth = new.depth + 1
  where c.parent_id = new.id and c.depth is distinct from new.depth + 1;
  return null;
end;
$$;
revoke all on function private.cascade_subtask_depth() from public, anon, authenticated;

create trigger cascade_subtask_depth
  after update of parent_id, project_id, depth on public.tasks
  for each row
  when (old.depth is distinct from new.depth)
  execute function private.cascade_subtask_depth();

-- ---------------------------------------------------------------------------
-- 4. BR-04 (quyết định 4, 6)
-- ---------------------------------------------------------------------------
-- Hậu duệ chưa xong của các task trong p_task_ids (tối đa p_limit id, nông trước). Khóa FOR SHARE
-- mọi hậu duệ theo thứ tự (depth, id) trước khi đọc trạng thái, để lệnh đổi trạng thái hậu duệ
-- đang chạy dở phải commit xong rồi mới kiểm (câu lệnh sau lấy ảnh chụp mới).
create or replace function private.open_subtask_ids(p_task_ids uuid[], p_limit integer)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  with recursive sub (id) as (
    select c.id from public.tasks c where c.parent_id = any (p_task_ids)
    union
    select c.id from public.tasks c join sub on c.parent_id = sub.id
  )
  select coalesce(array_agg(sub.id), '{}') into v_ids from sub;
  if cardinality(v_ids) = 0 then
    return '{}';
  end if;

  perform 1 from public.tasks t where t.id = any (v_ids) order by t.depth, t.id for share;

  return array(
    select t.id
    from public.tasks t
    join public.task_statuses s on s.id = t.status_id
    where t.id = any (v_ids) and s.category <> 'done'
    order by t.depth, t.id
    limit p_limit
  );
end;
$$;
revoke all on function private.open_subtask_ids(uuid[], integer) from public, anon, authenticated;

create or replace function private.check_parent_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open uuid[];
begin
  if not exists (
    select 1 from public.task_statuses s where s.id = new.status_id and s.category = 'done'
  ) then
    return null;
  end if;
  v_open := private.open_subtask_ids(array[new.id], 5);
  if cardinality(v_open) > 0 then
    raise exception 'parent_has_open_subtasks'
      using errcode = 'P0001', detail = array_to_string(v_open, ',');
  end if;
  return null;
end;
$$;
revoke all on function private.check_parent_close() from public, anon, authenticated;

create trigger check_parent_close
  after update of status_id on public.tasks
  for each row
  when (old.status_id is distinct from new.status_id)
  execute function private.check_parent_close();

-- Đổi nhóm trạng thái sang done (quyết định 6). Tên xếp trước sync_task_completion; trigger AFTER
-- nên đọc được nhóm mới. Hậu duệ ở chính trạng thái này cũng thành done (open_subtask_ids đọc nhóm
-- mới) nên không bị tính là chưa xong.
create or replace function private.check_status_category_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parents uuid[];
  v_open uuid[];
begin
  select coalesce(array_agg(t.id), '{}') into v_parents
  from public.tasks t
  where t.project_id = new.project_id
    and t.status_id = new.id
    and exists (select 1 from public.tasks c where c.parent_id = t.id);
  if cardinality(v_parents) = 0 then
    return null;
  end if;
  v_open := private.open_subtask_ids(v_parents, 5);
  if cardinality(v_open) > 0 then
    raise exception 'parent_has_open_subtasks'
      using errcode = 'P0001', detail = array_to_string(v_open, ',');
  end if;
  return null;
end;
$$;
revoke all on function private.check_status_category_close() from public, anon, authenticated;

create trigger check_category_close
  after update of category on public.task_statuses
  for each row
  when (new.category = 'done' and old.category is distinct from new.category)
  execute function private.check_status_category_close();

-- ---------------------------------------------------------------------------
-- 5. Quyền cột: trình duyệt nay ghi được parent_id (RLS tasks_insert/tasks_update quyết định ai
--    sửa dòng; trigger quyết định cha hợp lệ). depth vẫn không có quyền cột (trigger đặt).
-- ---------------------------------------------------------------------------
grant insert (parent_id) on public.tasks to authenticated;
grant update (parent_id) on public.tasks to authenticated;
