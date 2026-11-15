/**
 * Đổi PerfDataset sang SQL chạy bằng psql (vai trò postgres của stack CỤC BỘ). Story E0-7.
 *
 * - Ghi qua INSERT hàng loạt nhưng KHÔNG tắt trigger: check_task_tree đặt depth và kiểm 3 cấp,
 *   check_task_assignee, apply_task_config (trạng thái/loại cùng dự án, completed_at),
 *   check_label_project, check_relation (cùng dự án, không vòng), log_activity... đều chạy.
 * - Idempotent: khóa cố định + ON CONFLICT DO NOTHING; chạy lại không nhân đôi.
 * - Cả lần seed là MỘT giao dịch: lỗi giữa chừng thì không để lại dữ liệu dở dang.
 * - Không đụng dữ liệu ngoài dự án perf và tài khoản perf (không TRUNCATE, không reset).
 */
import type { PerfDataset } from "./dataset.ts";

/** Chuỗi SQL đã thoát dấu nháy đơn; null thành NULL. */
export function lit(value: string | number | null): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Số không hợp lệ: ${value}`);
    return String(value);
  }
  if (value.includes("\0")) throw new Error("Chuỗi chứa ký tự NUL.");
  return `'${value.replace(/'/g, "''")}'`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uuid(value: string): string {
  if (!UUID_RE.test(value)) throw new Error(`UUID không hợp lệ: ${value}`);
  return `'${value}'::uuid`;
}

/** Ghép danh sách dòng VALUES thành nhiều lô để mỗi câu lệnh không quá dài. */
function batched(
  rows: string[],
  size: number,
  render: (chunk: string) => string,
): string {
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(render(rows.slice(i, i + size).join(",\n  ")));
  }
  return out.join("\n");
}

/**
 * SQL seed. userIds: key của PerfUser → id trong auth.users (đã tạo qua Auth Admin API).
 * In ra một dòng JSON số liệu ở cuối (psql -At).
 */
export function buildSeedSql(
  ds: PerfDataset,
  userIds: Record<string, string>,
): string {
  const pid = uuid(ds.projectId);
  const user = (key: string | null) => {
    if (key === null) return "null";
    const id = userIds[key];
    if (!id) throw new Error(`Thiếu id tài khoản cho ${key}`);
    return uuid(id);
  };
  const pm = ds.users.find((u) => u.role === "pm");
  if (!pm) throw new Error("Bộ dữ liệu thiếu PM.");

  const anchor = ds.config.anchor;
  const start = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 6, 1),
  );
  const end = new Date(
    Date.UTC(anchor.getUTCFullYear() + 1, anchor.getUTCMonth(), 1),
  );

  const parts: string[] = [];
  parts.push(`\\set ON_ERROR_STOP on
set client_min_messages = warning;
begin;
-- Một tiến trình seed tại một thời điểm cho dự án này.
select pg_advisory_xact_lock(hashtextextended('perf-seed:' || ${lit(ds.projectId)}, 0));

-- Dự án: trigger add_creator_as_pm thêm PM, seed_config_defaults thêm trạng thái/loại mặc định.
insert into public.projects (id, name, description, start_date, end_date, status, created_by)
values (${pid}, ${lit(ds.projectName)},
  ${lit("Dữ liệu giả để đo hiệu năng (Story E0-7). Tạo bằng make perf-seed, xóa bằng make perf-clean.")},
  ${lit(start.toISOString().slice(0, 10))}, ${lit(end.toISOString().slice(0, 10))}, 'active', ${user(pm.key)})
on conflict (id) do nothing;

-- Dự án cô lập: chỉ tài khoản perf của chính bộ dữ liệu này.
insert into public.project_members (project_id, user_id, role)
values
  ${ds.users.map((u) => `(${pid}, ${user(u.key)}, ${lit(u.role)}::public.project_role)`).join(",\n  ")}
on conflict (project_id, user_id) do nothing;

insert into public.labels (id, project_id, name, color)
values
  ${ds.labels.map((l) => `(${uuid(l.id)}, ${pid}, ${lit(l.name)}, ${lit(l.color)})`).join(",\n  ")}
on conflict do nothing;

create temp table perf_tasks (
  id uuid primary key,
  parent_id uuid,
  depth smallint not null,
  title text not null,
  description text,
  assignee_id uuid,
  created_by uuid,
  priority public.task_priority not null,
  start_date date,
  due_date date,
  status_name text not null,
  type_name text not null,
  completed_at timestamptz,
  created_at timestamptz not null,
  position double precision not null
) on commit drop;
`);

  const taskRows = ds.tasks.map((t) =>
    [
      uuid(t.id),
      t.parentIndex === null ? "null" : uuid(ds.tasks[t.parentIndex].id),
      t.depth,
      lit(t.title),
      lit(t.description),
      user(t.assignee),
      user(t.createdBy),
      `${lit(t.priority)}::public.task_priority`,
      t.startDate === null ? "null" : `${lit(t.startDate)}::date`,
      t.dueDate === null ? "null" : `${lit(t.dueDate)}::date`,
      lit(t.status),
      lit(t.type),
      t.completedAt === null ? "null" : `${lit(t.completedAt)}::timestamptz`,
      `${lit(t.createdAt)}::timestamptz`,
      t.position,
    ].join(", "),
  );
  parts.push(
    batched(
      taskRows.map((r) => `(${r})`),
      500,
      (chunk) => `insert into perf_tasks values\n  ${chunk};`,
    ),
  );

  // Chèn theo từng cấp để trigger check_task_tree thấy cha đã có. depth gửi kèm nhưng trigger
  // tự tính lại từ cha (giá trị cuối là của trigger).
  for (const depth of [1, 2, 3]) {
    parts.push(`
insert into public.tasks (id, project_id, parent_id, depth, type_id, title, description, assignee_id,
  created_by, priority, start_date, due_date, status_id, position, completed_at, created_at)
select p.id, ${pid}, p.parent_id, p.depth, ty.id, p.title, p.description, p.assignee_id,
  p.created_by, p.priority, p.start_date, p.due_date, s.id, p.position, p.completed_at, p.created_at
from perf_tasks p
join public.task_statuses s on s.project_id = ${pid} and s.name = p.status_name
join public.task_types ty on ty.project_id = ${pid} and ty.name = p.type_name
where p.depth = ${depth}
order by p.position
on conflict (id) do nothing;`);
  }

  parts.push(`
-- Mọi task phải vào được (tên trạng thái/loại khớp danh sách mặc định E2-3).
do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
  from perf_tasks p
  where not exists (select 1 from public.tasks t where t.id = p.id);
  if v_missing > 0 then
    raise exception 'perf_seed: % task không chèn được (thiếu trạng thái/loại mặc định?)', v_missing;
  end if;
end;
$$;
`);

  if (ds.taskLabels.length > 0) {
    parts.push(
      batched(
        ds.taskLabels.map(
          (tl) =>
            `(${uuid(ds.tasks[tl.task].id)}, ${uuid(ds.labels[tl.label].id)})`,
        ),
        1000,
        (chunk) =>
          `insert into public.task_labels (task_id, label_id) values\n  ${chunk}\non conflict do nothing;`,
      ),
    );
  }

  if (ds.relations.length > 0) {
    parts.push(
      batched(
        ds.relations.map(
          (r) =>
            `(${uuid(ds.tasks[r.from].id)}, ${uuid(ds.tasks[r.to].id)}, ${lit(r.kind)}::public.task_relation_kind, ${r.lagDays}, ${user(pm.key)})`,
        ),
        500,
        (chunk) =>
          `insert into public.task_relations (from_task_id, to_task_id, kind, lag_days, created_by) values\n  ${chunk}\non conflict do nothing;`,
      ),
    );
  }

  parts.push(`
-- Cô lập: không ai ngoài tài khoản perf thuộc dự án này.
do $$
begin
  if exists (
    select 1 from public.project_members m
    where m.project_id = ${pid}
      and m.user_id not in (${ds.users.map((u) => user(u.key)).join(", ")})
  ) then
    raise exception 'perf_seed: dự án perf có thành viên ngoài bộ tài khoản perf';
  end if;
end;
$$;

commit;

select json_build_object(
  'tasks', (select count(*) from public.tasks where project_id = ${pid}),
  'depth', (select json_object_agg(depth, n) from (
      select depth, count(*) n from public.tasks where project_id = ${pid} group by depth) d),
  'members', (select count(*) from public.project_members where project_id = ${pid}),
  'labels', (select count(*) from public.labels where project_id = ${pid}),
  'task_labels', (select count(*) from public.task_labels tl
      join public.tasks t on t.id = tl.task_id where t.project_id = ${pid}),
  'relations', (select count(*) from public.task_relations r
      join public.tasks t on t.id = r.from_task_id where t.project_id = ${pid}),
  'done', (select count(*) from public.tasks where project_id = ${pid} and completed_at is not null),
  'overdue', (select count(*) from public.tasks where project_id = ${pid}
      and completed_at is null and due_date < current_date)
);
`);
  return parts.join("\n");
}

/** SQL xóa dự án perf (xóa dây chuyền task, nhãn, quan hệ, thành viên). */
export function buildCleanSql(projectIdValue: string): string {
  return `\\set ON_ERROR_STOP on
set client_min_messages = warning;
delete from public.projects where id = ${uuid(projectIdValue)};
`;
}
