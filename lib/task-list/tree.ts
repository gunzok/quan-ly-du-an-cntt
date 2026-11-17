import {
  VIEW_ME,
  type SavedViewFilters,
  type SavedViewSort,
  type ViewGroupBy,
  type ViewSortField,
} from "@/lib/saved-views/model";
import type { Task, TaskPriority } from "@/lib/tasks/model";

/**
 * Dựng bảng phân cấp (Story E3-2): lọc, sắp xếp anh em, nhóm theo thuộc tính, rồi làm phẳng cây
 * thành danh sách hàng theo trạng thái thu gọn. Thuần, không I/O, để test đơn vị.
 *
 * - Cây theo parent_id. Task có cha không tải được (không thấy theo RLS) thành gốc.
 * - Lọc khi KHÔNG nhóm: hiện task khớp kèm tổ tiên của nó làm hàng ngữ cảnh (`context`), giữ được
 *   cấu trúc. Khi nhóm: chỉ task khớp; cha-con chỉ nối khi cả hai cùng nhóm.
 * - Thu gọn theo id task và khóa nhóm, độc lập với bộ lọc: lọc xong vẫn giữ (AC1).
 * - Nhóm theo nhãn: task nhiều nhãn hiện ở mỗi nhóm nhãn; khóa hàng gồm khóa nhóm nên không trùng.
 */

/** Giá trị nhóm "không có" (chưa giao, không nhãn, không loại...). */
export const NONE_GROUP = "__none__";

export interface ListContext {
  /** Thứ tự trạng thái (position) theo id. */
  statusOrder: ReadonlyMap<string, number>;
  typeOrder: ReadonlyMap<string, number>;
  labelOrder: ReadonlyMap<string, number>;
  /** Tên thành viên theo user_id; thiếu = người ngoài dự án. */
  memberName: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------------------
// Lọc: cùng ngữ nghĩa với GET /api/v1/projects/{id}/tasks (lib/tasks/validate.ts, search.ts)
// ---------------------------------------------------------------------------
/**
 * `matchIds`: id task máy chủ trả cho từ khóa q (bỏ dấu ở CSDL); null = không tìm theo từ khóa.
 * `who` (E13-2): người đang xem (giá trị `me`) và hôm nay YYYY-MM-DD giờ Việt Nam (`overdue`).
 */
export function matchesListFilters(
  task: Task,
  f: SavedViewFilters,
  matchIds: ReadonlySet<string> | null,
  who: { me: string; today: string } = { me: "", today: "" },
): boolean {
  if (f.status_id && !(task.status_id && f.status_id.includes(task.status_id)))
    return false;
  const person = (v: string) => (v === VIEW_ME ? who.me : v);
  if (f.assignee_id && task.assignee_id !== person(f.assignee_id)) return false;
  if (f.created_by && task.created_by !== person(f.created_by)) return false;
  if ((f.open || f.overdue) && task.completed_at) return false;
  if (f.overdue && !(task.due_date && task.due_date < who.today)) return false;
  if (f.priority && task.priority !== f.priority) return false;
  if (f.label_id && !task.label_ids.includes(f.label_id)) return false;
  if (f.due_after && !(task.due_date && task.due_date >= f.due_after))
    return false;
  if (f.due_before && !(task.due_date && task.due_date <= f.due_before))
    return false;
  if (matchIds && !matchIds.has(task.id)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Sắp xếp
// ---------------------------------------------------------------------------
const PRIORITY_RANK: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
};

const collator = new Intl.Collator("vi", {
  sensitivity: "base",
  numeric: true,
});

type Key = string | number | null;

function sortKey(task: Task, field: ViewSortField, ctx: ListContext): Key {
  switch (field) {
    case "title":
      return task.title;
    case "priority":
      return PRIORITY_RANK[task.priority];
    case "status_id":
      return task.status_id
        ? (ctx.statusOrder.get(task.status_id) ?? null)
        : null;
    case "type_id":
      return task.type_id ? (ctx.typeOrder.get(task.type_id) ?? null) : null;
    case "assignee_id":
      return task.assignee_id
        ? (ctx.memberName.get(task.assignee_id) ?? null)
        : null;
    case "position":
      return task.position;
    default:
      return task[field];
  }
}

function compareKeys(a: Key, b: Key): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/** Thứ tự mặc định và tiêu chí phụ: tạo trước đứng trước, rồi id (ổn định). */
function compareDefault(a: Task, b: Task): number {
  if (a.created_at !== b.created_at)
    return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Bộ so sánh anh em. Giá trị trống luôn ở cuối, bất kể chiều sắp. */
export function taskComparator(
  sort: readonly SavedViewSort[],
  ctx: ListContext,
): (a: Task, b: Task) => number {
  return (a, b) => {
    for (const { field, direction } of sort) {
      const ka = sortKey(a, field, ctx);
      const kb = sortKey(b, field, ctx);
      if (ka === null && kb === null) continue;
      if (ka === null) return 1;
      if (kb === null) return -1;
      const c = compareKeys(ka, kb);
      if (c !== 0) return direction === "asc" ? c : -c;
    }
    return compareDefault(a, b);
  };
}

// ---------------------------------------------------------------------------
// Nhóm
// ---------------------------------------------------------------------------
/** Giá trị nhóm của task (nhiều giá trị khi nhóm theo nhãn). */
export function groupValues(task: Task, groupBy: ViewGroupBy): string[] {
  switch (groupBy) {
    case "label_ids":
      return task.label_ids.length > 0 ? task.label_ids : [NONE_GROUP];
    case "priority":
      return [task.priority];
    default:
      return [task[groupBy] ?? NONE_GROUP];
  }
}

/** Thứ tự nhóm: theo cấu hình dự án, ưu tiên cao trước, tên người; "không có" luôn cuối. */
export function groupComparator(
  groupBy: ViewGroupBy,
  ctx: ListContext,
): (a: string, b: string) => number {
  const rank = (v: string): Key => {
    if (v === NONE_GROUP) return null;
    switch (groupBy) {
      case "status_id":
        return ctx.statusOrder.get(v) ?? Number.MAX_SAFE_INTEGER;
      case "type_id":
        return ctx.typeOrder.get(v) ?? Number.MAX_SAFE_INTEGER;
      case "label_ids":
        return ctx.labelOrder.get(v) ?? Number.MAX_SAFE_INTEGER;
      case "priority":
        return -PRIORITY_RANK[v as TaskPriority];
      case "assignee_id":
        // Người ngoài dự án (không còn tên) sau người có tên.
        return ctx.memberName.get(v) ?? "￿";
    }
  };
  return (a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra === null || rb === null) {
      return ra === rb ? 0 : ra === null ? 1 : -1;
    }
    const c = compareKeys(ra, rb);
    return c !== 0 ? c : a < b ? -1 : a > b ? 1 : 0;
  };
}

// ---------------------------------------------------------------------------
// Dựng hàng
// ---------------------------------------------------------------------------
export interface GroupRow {
  kind: "group";
  key: string;
  value: string;
  /** Số task khớp trong nhóm. */
  count: number;
  collapsed: boolean;
}

export interface TaskRow {
  kind: "task";
  /** Duy nhất trong bảng (có khóa nhóm khi nhóm theo nhãn). */
  key: string;
  task: Task;
  /** Cấp hiển thị 1..3 (theo cây đang hiện, không theo depth trong CSDL). */
  level: number;
  /** Số con đang có trong cây hiện tại. */
  childCount: number;
  expanded: boolean;
  /** Tổ tiên hiện để giữ cấu trúc, bản thân không khớp bộ lọc. */
  context: boolean;
}

export type ListRow = GroupRow | TaskRow;

export interface BuildInput {
  tasks: readonly Task[];
  /** Id task khớp bộ lọc; null = không lọc (mọi task khớp). */
  matched: ReadonlySet<string> | null;
  sort: readonly SavedViewSort[];
  groupBy: ViewGroupBy | null;
  /** Id task đang thu gọn. */
  collapsed: ReadonlySet<string>;
  /** Khóa nhóm đang thu gọn. */
  collapsedGroups: ReadonlySet<string>;
  ctx: ListContext;
}

export interface BuildResult {
  rows: ListRow[];
  /** Số task khớp (không tính hàng ngữ cảnh, không đếm trùng khi nhóm theo nhãn). */
  matchCount: number;
}

export function buildRows(input: BuildInput): BuildResult {
  const { tasks, matched, groupBy, collapsed, collapsedGroups, ctx } = input;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const isMatch = (t: Task) => matched === null || matched.has(t.id);
  const compare = taskComparator(input.sort, ctx);
  const matchCount =
    matched === null ? tasks.length : tasks.filter(isMatch).length;

  if (!groupBy) {
    const included = new Set<string>();
    for (const t of tasks) {
      if (!isMatch(t)) continue;
      // Thêm task và tổ tiên (dừng khi gặp tổ tiên đã thêm hoặc vòng lỗi).
      let cur: Task | undefined = t;
      while (cur && !included.has(cur.id)) {
        included.add(cur.id);
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
      }
    }
    const members = tasks.filter((t) => included.has(t.id));
    const rows: ListRow[] = [];
    flattenTree(members, "", compare, collapsed, isMatch, rows);
    return { rows, matchCount };
  }

  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!isMatch(t)) continue;
    for (const v of groupValues(t, groupBy)) {
      const list = groups.get(v);
      if (list) list.push(t);
      else groups.set(v, [t]);
    }
  }
  const rows: ListRow[] = [];
  const order = [...groups.keys()].sort(groupComparator(groupBy, ctx));
  for (const value of order) {
    const members = groups.get(value)!;
    const key = `group:${value}`;
    const isCollapsed = collapsedGroups.has(value);
    rows.push({
      kind: "group",
      key,
      value,
      count: members.length,
      collapsed: isCollapsed,
    });
    if (!isCollapsed) {
      flattenTree(members, `${value}/`, compare, collapsed, isMatch, rows);
    }
  }
  return { rows, matchCount };
}

function flattenTree(
  members: readonly Task[],
  keyPrefix: string,
  compare: (a: Task, b: Task) => number,
  collapsed: ReadonlySet<string>,
  isMatch: (t: Task) => boolean,
  out: ListRow[],
): void {
  const ids = new Set(members.map((t) => t.id));
  const children = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const t of members) {
    if (t.parent_id && ids.has(t.parent_id) && t.parent_id !== t.id) {
      const list = children.get(t.parent_id);
      if (list) list.push(t);
      else children.set(t.parent_id, [t]);
    } else {
      roots.push(t);
    }
  }
  for (const list of children.values()) list.sort(compare);
  roots.sort(compare);

  const seen = new Set<string>();
  const visit = (t: Task, level: number) => {
    if (seen.has(t.id)) return; // phòng dữ liệu vòng (CSDL đã chặn)
    seen.add(t.id);
    const kids = children.get(t.id) ?? [];
    const expanded = !collapsed.has(t.id);
    out.push({
      kind: "task",
      key: `${keyPrefix}${t.id}`,
      task: t,
      level,
      childCount: kids.length,
      expanded,
      context: !isMatch(t),
    });
    if (expanded) for (const k of kids) visit(k, level + 1);
  };
  for (const r of roots) visit(r, 1);
}

/** Id mọi task có ít nhất một con đã tải (cho "Thu gọn tất cả"). */
export function parentIds(tasks: readonly Task[]): Set<string> {
  const ids = new Set(tasks.map((t) => t.id));
  const out = new Set<string>();
  for (const t of tasks) {
    if (t.parent_id && ids.has(t.parent_id)) out.add(t.parent_id);
  }
  return out;
}
