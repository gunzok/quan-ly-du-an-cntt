-- QLDA-55 (Story E8-1): quan hệ giữa task (FR-10), chống vòng cho quan hệ có thứ tự (BR-05).
-- Thiết kế: docs/03-design/database.md mục 2 (task_relations), 3 (trigger), 4 (chỉ mục), 5 (RLS);
-- api-contract.md mục 3 (POST/DELETE /api/v1/tasks/{id}/relations).
--
-- Quyết định:
--   1. Bốn kiểu theo hợp đồng: relates, blocks, precedes, duplicates. Quan hệ đảo (bị chặn bởi,
--      đứng sau, bị trùng) không lưu, suy ra từ hướng (from/to) ở tầng API. Kiểu nào hiện ở MVP
--      là việc của giao diện (E8-2).
--   2. `relates` đối xứng: chỉ mục duy nhất trên cặp không thứ tự (least, greatest), nên A relates B
--      và B relates A là một quan hệ (thêm lần hai: 23505, API trả 409).
--   3. `blocks` và `precedes` chung MỘT đồ thị khi chống vòng: cả hai đều nghĩa là "from phải
--      xong/đi trước to". A blocks B cùng B precedes A là mâu thuẫn thứ tự giống hệt A blocks B cùng
--      B blocks A, nên tách hai đồ thị sẽ để lọt vòng thật. `relates`, `duplicates` không có thứ tự,
--      không tham gia đồ thị.
--   4. Phát hiện vòng (cả trực tiếp lẫn gián tiếp A→B→C→A): trước khi thêm cạnh from→to, tìm đường
--      từ `to` về `from` bằng CTE đệ quy UNION (không UNION ALL): mỗi task chỉ được thăm một lần, nên
--      truy vấn luôn dừng và chi phí tối đa O(số cạnh có thứ tự trong dự án), không cần giới hạn độ
--      sâu (giới hạn độ sâu sẽ bỏ sót vòng dài). EXISTS dừng ngay khi gặp `from`.
--   5. Đồng thời: hai giao dịch cùng thêm A→B và B→A, mỗi bên không thấy dòng chưa commit của bên
--      kia, sẽ cùng lọt. Trigger lấy khóa tư vấn theo dự án (pg_advisory_xact_lock) trước khi kiểm:
--      giao dịch sau chờ giao dịch trước commit rồi mới kiểm, và vì hàm plpgsql VOLATILE lấy ảnh
--      chụp mới cho từng câu lệnh (READ COMMITTED, mặc định của PostgREST) nên thấy cạnh vừa commit.
--      Khóa chỉ tuần tự hóa việc thêm cạnh có thứ tự trong CÙNG dự án; dự án khác không chờ nhau.
--   6. Hai task phải cùng dự án: kiểm ở trigger (task_relations không lưu project_id để không có hai
--      nguồn sự thật; xóa task thì quan hệ mất theo ON DELETE CASCADE).
--   7. Trigger SECURITY DEFINER (đọc tasks/task_relations không lệ thuộc RLS, để kiểm vòng đúng và
--      nhanh). Vì BEFORE trigger chạy TRƯỚC kiểm RLS WITH CHECK, nếu không cẩn thận thì người ngoài
--      dự án dùng lỗi "khác dự án"/"tạo vòng" để dò quan hệ giữa task họ không thấy. Nên khi người
--      gọi là người dùng cuối (auth.uid() có giá trị), trigger đòi quyền sửa cả hai task TRƯỚC mọi
--      kiểm khác và trả 42501 giống RLS. service_role/migration (auth.uid() null) vẫn qua đủ kiểm
--      cùng dự án và chống vòng.
--   8. RLS: đọc khi thấy được CẢ HAI task (cùng dự án nên tương đương thấy một trong hai, nhưng kiểm
--      cả hai không phụ thuộc trigger 6); tạo/xóa khi có quyền SỬA cả hai task, đúng điều kiện chính
--      sách tasks_update (Admin, PM của dự án, Thành viên là người phụ trách hoặc người tạo).
--      Người xem, người ngoài, người bị khóa: không ghi; người ngoài và người bị khóa không đọc.
--      Không có UPDATE: đổi kiểu hay lag thì xóa rồi tạo lại.
--   9. lag_days chỉ có nghĩa với precedes (khác 0 ở kiểu khác bị từ chối), trong khoảng ±365 ngày.
--  10. KHÔNG gắn trigger nhật ký activity_logs ở Story này (activity_logs_entity_type_check chỉ nhận
--      project, project_member, task); nếu cần, Story sau thêm entity_type và xét cột nhạy cảm.

-- ---------------------------------------------------------------------------
-- 1. Kiểu và bảng
-- ---------------------------------------------------------------------------
create type public.task_relation_kind as enum ('relates', 'blocks', 'precedes', 'duplicates');

create table public.task_relations (
  id uuid primary key default gen_random_uuid(),
  from_task_id uuid not null,
  to_task_id uuid not null,
  kind public.task_relation_kind not null,
  lag_days integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint task_relations_from_task_id_fkey
    foreign key (from_task_id) references public.tasks (id) on delete cascade,
  constraint task_relations_to_task_id_fkey
    foreign key (to_task_id) references public.tasks (id) on delete cascade,
  constraint task_relations_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint task_relations_not_self check (from_task_id <> to_task_id),
  constraint task_relations_unique unique (from_task_id, to_task_id, kind),
  constraint task_relations_lag_days_range check (lag_days between -365 and 365),
  constraint task_relations_lag_days_kind check (kind = 'precedes' or lag_days = 0)
);
comment on table public.task_relations is
  'Quan hệ giữa hai task cùng dự án (FR-10). Không vòng cho blocks + precedes (BR-05, trigger '
  'check_relation). Quan hệ đảo suy ra từ hướng. Xóa task thì quan hệ mất (CASCADE).';
comment on column public.task_relations.kind is
  'relates (đối xứng), blocks (from chặn to), precedes (from đứng trước to), duplicates (from trùng to).';
comment on column public.task_relations.lag_days is
  'Độ trễ (ngày) giữa from và to; chỉ dùng với precedes, kiểu khác luôn 0.';

-- ---------------------------------------------------------------------------
-- 2. Chỉ mục (database.md mục 4)
-- ---------------------------------------------------------------------------
-- task_relations_unique (from_task_id, to_task_id, kind) phục vụ tìm theo from (và đi cạnh khi kiểm
-- vòng); thêm chỉ mục theo to cho chiều ngược và xóa dây chuyền.
create index task_relations_to_task_id_idx on public.task_relations (to_task_id);
-- relates đối xứng: một cặp không thứ tự chỉ một dòng.
create unique index task_relations_relates_pair_key on public.task_relations
  (least(from_task_id, to_task_id), greatest(from_task_id, to_task_id))
  where kind = 'relates';

-- ---------------------------------------------------------------------------
-- 3. Hàm hỗ trợ RLS (SECURITY DEFINER, schema private không phơi qua API)
-- ---------------------------------------------------------------------------
-- Story E2-3 (làm song song, migration 20261115130000 ở nhánh của E2-3) định nghĩa HAI hàm cùng tên, cùng
-- chữ ký, cùng thân. Cả hai migration dùng `create or replace` và revoke/grant giống nhau nên merge
-- theo thứ tự nào kết quả cũng như nhau. Nếu sau này thân hai bản lệch nhau, bản ở migration có dấu
-- thời gian lớn hơn thắng: phải gộp về một.
-- Thấy task: giống chính sách tasks_select.
create or replace function private.can_read_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = target_task_id
      and (private.is_admin() or private.project_role_of(t.project_id) is not null)
  );
$$;

-- Sửa được task: ĐÚNG điều kiện USING của chính sách tasks_update (20261114090000_tasks.sql).
-- Đổi chính sách tasks_update thì phải đổi hàm này theo (test rls-task-relations kiểm cả hai).
create or replace function private.can_edit_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = target_task_id
      and (
        private.is_admin()
        or private.project_role_of(t.project_id) = 'pm'
        or (
          private.project_role_of(t.project_id) = 'member'
          and (t.assignee_id = auth.uid() or t.created_by = auth.uid())
        )
      )
  );
$$;

revoke all on function private.can_read_task(uuid), private.can_edit_task(uuid)
  from public, anon, authenticated;
grant execute on function private.can_read_task(uuid), private.can_edit_task(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Trigger: quyền (chống dò), cùng dự án, chống vòng (BR-05)
-- ---------------------------------------------------------------------------
-- Lỗi máy đọc (P0001), API ánh xạ: task_relation_cross_project → 422, task_relation_cycle → 409.
create or replace function private.check_task_relation()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  from_project uuid;
  to_project uuid;
begin
  -- Quyết định 7: người dùng cuối phải sửa được cả hai task trước khi biết thêm gì về chúng.
  if auth.uid() is not null and not (
    private.can_edit_task(new.from_task_id) and private.can_edit_task(new.to_task_id)
  ) then
    raise exception 'new row violates row-level security policy for table "task_relations"'
      using errcode = '42501';
  end if;

  -- Tự quan hệ: để CHECK task_relations_not_self báo lỗi (23514).
  if new.from_task_id = new.to_task_id then
    return new;
  end if;

  select t.project_id into from_project from public.tasks t where t.id = new.from_task_id;
  select t.project_id into to_project from public.tasks t where t.id = new.to_task_id;
  -- Task không tồn tại: để khóa ngoại báo lỗi (23503).
  if from_project is null or to_project is null then
    return new;
  end if;
  if from_project <> to_project then
    raise exception 'task_relation_cross_project' using errcode = 'P0001';
  end if;

  if new.kind in ('blocks', 'precedes') then
    -- Quyết định 5: tuần tự hóa việc thêm cạnh có thứ tự trong cùng dự án.
    perform pg_advisory_xact_lock(
      hashtextextended('public.task_relations:' || from_project::text, 0)
    );
    -- Quyết định 3, 4: có đường to → … → from qua cạnh blocks/precedes thì cạnh mới đóng vòng.
    -- Khi UPDATE, bỏ chính dòng đang sửa khỏi đồ thị.
    if exists (
      with recursive reach (task_id) as (
        select new.to_task_id
        union
        select r.to_task_id
        from public.task_relations r
        join reach on r.from_task_id = reach.task_id
        where r.kind in ('blocks', 'precedes')
          and (tg_op = 'INSERT' or r.id <> new.id)
      )
      select 1 from reach where reach.task_id = new.from_task_id
    ) then
      raise exception 'task_relation_cycle' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.check_task_relation() from public, anon, authenticated;

create trigger check_relation
  before insert or update of from_task_id, to_task_id, kind on public.task_relations
  for each row execute function private.check_task_relation();

-- ---------------------------------------------------------------------------
-- 5. Quyền bảng (GRANT) — lớp ngoài của RLS
-- ---------------------------------------------------------------------------
-- Thu quyền mặc định của Supabase rồi cấp theo cột. Không có quyền cột: id (mặc định), created_by
-- (luôn auth.uid()), created_at. Không cấp UPDATE (xóa rồi tạo lại).
revoke all on public.task_relations from anon, authenticated;
grant select, delete on public.task_relations to authenticated;
grant insert (from_task_id, to_task_id, kind, lag_days) on public.task_relations to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RLS (database.md mục 5; quyết định 8)
-- ---------------------------------------------------------------------------
alter table public.task_relations enable row level security;

create policy task_relations_select on public.task_relations
  for select to authenticated
  using (private.can_read_task(from_task_id) and private.can_read_task(to_task_id));

create policy task_relations_insert on public.task_relations
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.can_edit_task(from_task_id)
    and private.can_edit_task(to_task_id)
  );

create policy task_relations_delete on public.task_relations
  for delete to authenticated
  using (private.can_edit_task(from_task_id) and private.can_edit_task(to_task_id));
