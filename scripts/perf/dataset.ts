/**
 * Sinh dữ liệu giả cho dự án hiệu năng (Story E0-7, QLDA-50): hàm THUẦN, tất định theo `seed`,
 * không đụng mạng hay CSDL để test được nhanh. scripts/perf/sql.ts đổi kết quả sang SQL,
 * scripts/perf/seed.ts chạy SQL đó qua psql (đi qua mọi trigger thật).
 *
 * Quy tắc dữ liệu (khớp trigger của E2-2, E2-3, E2-4, E8-1):
 *   - Cây task tối đa 3 cấp: cấp 1 khoảng 20%, cấp 2 khoảng 40%, còn lại cấp 3; cha cấp d-1.
 *   - Task ở nhóm done thì mọi hậu duệ cũng done (BR-04: không đóng cha khi con còn mở). Một số
 *     cây con "đã xong" trọn vẹn, có completed_at trong quá khứ; task chưa xong một số trễ hạn.
 *   - Người phụ trách là PM hoặc Thành viên của dự án (Người xem không nhận việc).
 *   - Quan hệ blocks/precedes/duplicates luôn đi từ task có chỉ số nhỏ sang chỉ số lớn (đồ thị có
 *     hướng không vòng), relates không trùng cặp không thứ tự.
 *   - Trạng thái, loại theo danh sách mặc định E2-3 (private.seed_project_defaults).
 * Mọi dữ liệu là giả: email @example.com (RFC 2606), họ tên có chữ "Hiệu năng".
 *
 * Viết bằng TypeScript chỉ dùng cú pháp xóa được kiểu để Node chạy trực tiếp.
 */

export type StatusCategory = "todo" | "in_progress" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";
export type RelationKind = "blocks" | "precedes" | "relates" | "duplicates";

/** Đủ 4 kiểu quan hệ (enum public.task_relation_kind). */
export const RELATION_KINDS: readonly RelationKind[] = [
  "blocks",
  "precedes",
  "relates",
  "duplicates",
];

/** Danh sách trạng thái mặc định E2-3 (tên phải khớp private.seed_project_defaults). */
export const DEFAULT_STATUSES: readonly {
  name: string;
  category: StatusCategory;
}[] = [
  { name: "Mới", category: "todo" },
  { name: "Đang thực hiện", category: "in_progress" },
  { name: "Đang kiểm thử", category: "in_progress" },
  { name: "Cần phản hồi", category: "in_progress" },
  { name: "Đã xong", category: "done" },
  { name: "Đã đóng", category: "done" },
  { name: "Từ chối", category: "done" },
];

/** Loại task mặc định E2-3. */
export const DEFAULT_TYPES = ["Task", "Bug", "Milestone", "Phase"] as const;

export const LABEL_NAMES: readonly string[] = [
  "Hạ tầng",
  "Bảo mật",
  "Giao diện",
  "Cơ sở dữ liệu",
  "Hiệu năng",
  "Tài liệu",
  "Kiểm thử",
  "Khẩn cấp",
  "Khách hàng",
  "Nội bộ",
  "Mạng",
  "Máy chủ",
  "Sao lưu",
  "Đào tạo",
  "Pháp lý",
  "Mua sắm",
  "Báo cáo",
  "Tích hợp",
  "Di động",
  "Hỗ trợ",
];

const LABEL_COLORS = [
  "#2054F0",
  "#137035",
  "#C0262D",
  "#7C3AED",
  "#D97706",
  "#4B5563",
  "#0E7490",
  "#BE185D",
];

const VERBS = [
  "Cài đặt",
  "Cấu hình",
  "Kiểm thử",
  "Nâng cấp",
  "Rà soát",
  "Thiết kế",
  "Triển khai",
  "Sửa lỗi",
  "Đồng bộ",
  "Tối ưu",
  "Viết tài liệu",
  "Đánh giá",
  "Chuẩn bị",
  "Sao lưu",
  "Di chuyển",
];

const OBJECTS = [
  "máy chủ ứng dụng",
  "cơ sở dữ liệu khách hàng",
  "tường lửa",
  "cổng thanh toán",
  "hệ thống thư điện tử",
  "ứng dụng di động",
  "giao diện quản trị",
  "báo cáo tháng",
  "mạng nội bộ",
  "phần mềm kế toán",
  "kho lưu trữ tài liệu",
  "dịch vụ xác thực",
  "bảng điều khiển",
  "máy trạm",
  "đường truyền dự phòng",
];

const CONTEXTS = [
  "cho phòng Kế toán",
  "tại chi nhánh Đà Nẵng",
  "giai đoạn 2",
  "theo yêu cầu khách hàng",
  "trước kỳ kiểm toán",
  "ở trụ sở Hà Nội",
  "cho đợt phát hành tháng sau",
  "tại văn phòng Huế",
  "cho nhóm Hỗ trợ",
  "",
];

const DESCRIPTIONS = [
  "Phối hợp với nhóm hạ tầng, kiểm tra nhật ký hệ thống trước khi bàn giao.",
  "Ghi lại các bước thực hiện và kết quả kiểm thử vào tài liệu dự án.",
  "Ưu tiên xử lý trong tuần; báo PM nếu phát sinh chi phí ngoài kế hoạch.",
  "Đối chiếu với yêu cầu nghiệp vụ đã chốt, cập nhật ước lượng nếu cần.",
  "Cần xác nhận lịch bảo trì với bộ phận vận hành trước khi làm.",
];

/** Trạng thái task cấp 2-3 ngoài cây "đã xong": nghiêng về việc đang mở như dự án đang chạy. */
const OPEN_HEAVY_STATUSES = [
  "Mới",
  "Mới",
  "Mới",
  "Đang thực hiện",
  "Đang thực hiện",
  "Đang thực hiện",
  "Đang kiểm thử",
  "Cần phản hồi",
  "Đã xong",
  "Đã xong",
  "Đã đóng",
];

/** Hai từ khóa đo tìm kiếm: có dấu và không dấu, khớp OBJECTS[0]. */
export const SEARCH_QUERIES = { accented: "máy chủ", plain: "may chu" };

export interface PerfDatasetConfig {
  /** 0 = bộ dữ liệu chính (`make perf-seed`); số khác cho test, mỗi số một dự án và bộ tài khoản riêng. */
  dataset: number;
  taskCount: number;
  /** Số Thành viên (không gồm PM và Người xem). */
  memberCount: number;
  labelCount: number;
  relationCount: number;
  /** Hạt giống PRNG: cùng cấu hình thì cùng dữ liệu. */
  seed: number;
  /** Mốc "hôm nay" để tính ngày, trễ hạn, completed_at. */
  anchor: Date;
}

export const MAX_DATASET = 0xffff;

export function defaultConfig(
  overrides: Partial<PerfDatasetConfig> = {},
): PerfDatasetConfig {
  const taskCount = overrides.taskCount ?? 2000;
  return {
    dataset: 0,
    taskCount,
    memberCount: 10,
    labelCount: LABEL_NAMES.length,
    relationCount: Math.ceil(taskCount * 0.3),
    seed: 20261115,
    anchor: new Date(),
    ...overrides,
  };
}

export function assertConfig(c: PerfDatasetConfig): void {
  const int = (v: number, min: number, max: number, name: string) => {
    if (!Number.isInteger(v) || v < min || v > max) {
      throw new Error(`${name} phải là số nguyên trong [${min}, ${max}].`);
    }
  };
  int(c.dataset, 0, MAX_DATASET, "dataset");
  int(c.taskCount, 6, 100_000, "taskCount");
  int(c.memberCount, 1, 99, "memberCount");
  int(c.labelCount, 1, LABEL_NAMES.length, "labelCount");
  // Quan hệ lấy ngẫu nhiên giữa các cặp; giữ thưa để sinh nhanh và không cạn cặp.
  int(c.relationCount, 0, c.taskCount * 2, "relationCount");
  if (Number.isNaN(c.anchor.getTime())) throw new Error("anchor không hợp lệ.");
}

// ---------------------------------------------------------------------------
// Định danh cố định (idempotent: chạy lại chèn trùng khóa thì bỏ qua)
// ---------------------------------------------------------------------------
const hex = (n: number, width: number) => n.toString(16).padStart(width, "0");

/** UUID cố định dạng 9e7fDDDD-KKKK-4000-8000-IIIIIIIIIIII (D dataset, K loại, I chỉ số). */
export function perfUuid(dataset: number, kind: number, index: number): string {
  return `9e7f${hex(dataset, 4)}-${hex(kind, 4)}-4000-8000-${hex(index, 12)}`;
}

export const projectId = (dataset: number) => perfUuid(dataset, 0, 0);
export const taskId = (dataset: number, index: number) =>
  perfUuid(dataset, 1, index);
export const labelId = (dataset: number, index: number) =>
  perfUuid(dataset, 2, index);

export function projectName(dataset: number): string {
  return dataset === 0
    ? "[PERF] Dự án 2000 task"
    : `[PERF] Dự án thử ${hex(dataset, 4)}`;
}

// ---------------------------------------------------------------------------
// Tài khoản giả
// ---------------------------------------------------------------------------
export type PerfRole = "pm" | "member" | "viewer";

export interface PerfUser {
  key: string;
  email: string;
  fullName: string;
  role: PerfRole;
}

export function perfUsers(
  c: Pick<PerfDatasetConfig, "dataset" | "memberCount">,
): PerfUser[] {
  const prefix = c.dataset === 0 ? "perf" : `perf-${hex(c.dataset, 4)}`;
  const users: PerfUser[] = [
    {
      key: "pm",
      email: `${prefix}-pm@example.com`,
      fullName: "Quản lý Hiệu năng",
      role: "pm",
    },
  ];
  for (let i = 1; i <= c.memberCount; i++) {
    const n = String(i).padStart(2, "0");
    users.push({
      key: `member${n}`,
      email: `${prefix}-member${n}@example.com`,
      fullName: `Thành viên Hiệu năng ${n}`,
      role: "member",
    });
  }
  users.push({
    key: "viewer",
    email: `${prefix}-viewer@example.com`,
    fullName: "Người xem Hiệu năng",
    role: "viewer",
  });
  return users;
}

// ---------------------------------------------------------------------------
// PRNG tất định (mulberry32)
// ---------------------------------------------------------------------------
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1));
  const pick = <T>(list: readonly T[]): T => list[int(0, list.length - 1)];
  return { next, int, pick };
}

// ---------------------------------------------------------------------------
// Dữ liệu
// ---------------------------------------------------------------------------
export interface PerfTask {
  index: number;
  id: string;
  parentIndex: number | null;
  depth: 1 | 2 | 3;
  title: string;
  description: string | null;
  /** key của PerfUser (pm, memberNN) hoặc null. */
  assignee: string | null;
  createdBy: string;
  priority: Priority;
  startDate: string | null;
  dueDate: string | null;
  status: string;
  type: (typeof DEFAULT_TYPES)[number];
  completedAt: string | null;
  createdAt: string;
  position: number;
}

export interface PerfLabel {
  index: number;
  id: string;
  name: string;
  color: string;
}

export interface PerfRelation {
  from: number;
  to: number;
  kind: RelationKind;
  lagDays: number;
}

export interface PerfDataset {
  config: PerfDatasetConfig;
  projectId: string;
  projectName: string;
  users: PerfUser[];
  labels: PerfLabel[];
  tasks: PerfTask[];
  taskLabels: { task: number; label: number }[];
  relations: PerfRelation[];
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Ngày dạng YYYY-MM-DD theo UTC của mốc. */
export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function statusCategory(name: string): StatusCategory {
  const s = DEFAULT_STATUSES.find((x) => x.name === name);
  if (!s)
    throw new Error(`Trạng thái không có trong danh sách mặc định: ${name}`);
  return s.category;
}

/** Số task mỗi cấp: cấp 1 khoảng 20%, cấp 2 khoảng 40%, cấp 3 phần còn lại. */
export function levelSizes(taskCount: number): [number, number, number] {
  const l1 = Math.max(1, Math.round(taskCount * 0.2));
  const l2 = Math.max(1, Math.round(taskCount * 0.4));
  return [l1, l2, taskCount - l1 - l2];
}

export function generateDataset(config: PerfDatasetConfig): PerfDataset {
  assertConfig(config);
  const c = config;
  const rng = createRng(c.seed ^ (c.dataset * 0x9e3779b1));
  const users = perfUsers(c);
  const assignable = users.filter((u) => u.role !== "viewer").map((u) => u.key);
  const anchorMs = Date.UTC(
    c.anchor.getUTCFullYear(),
    c.anchor.getUTCMonth(),
    c.anchor.getUTCDate(),
  );
  // created_at, completed_at luôn trước thời điểm chạy (mốc hôm nay 00:00 UTC trừ 1 giờ).
  const nowCap = anchorMs - HOUR;

  const labels: PerfLabel[] = LABEL_NAMES.slice(0, c.labelCount).map(
    (name, i) => ({
      index: i,
      id: labelId(c.dataset, i),
      name,
      color: LABEL_COLORS[i % LABEL_COLORS.length],
    }),
  );

  const [l1, l2] = levelSizes(c.taskCount);
  const tasks: PerfTask[] = [];
  // Cây con "đã xong trọn vẹn": khoảng 20% task cấp 1 và toàn bộ hậu duệ.
  const doneRoot: boolean[] = [];

  for (let i = 0; i < c.taskCount; i++) {
    let depth: 1 | 2 | 3;
    let parentIndex: number | null;
    if (i < l1) {
      depth = 1;
      parentIndex = null;
    } else if (i < l1 + l2) {
      depth = 2;
      parentIndex = (i - l1) % l1;
    } else {
      depth = 3;
      parentIndex = l1 + ((i - l1 - l2) % l2);
    }
    const root =
      depth === 1
        ? i
        : depth === 2
          ? (parentIndex as number)
          : (tasks[parentIndex as number].parentIndex as number);
    if (depth === 1) doneRoot[i] = rng.next() < 0.2;

    const parent = parentIndex === null ? null : tasks[parentIndex];
    // Cha tạo trước con; gốc rải trong 180 ngày gần đây. Cộng i ms để không trùng thời điểm.
    const createdMs = Math.min(
      nowCap - (c.taskCount - i),
      parent
        ? Date.parse(parent.createdAt) + rng.int(1, 240) * HOUR
        : anchorMs - rng.int(30, 180) * DAY + rng.int(0, 23) * HOUR,
    );
    const createdAt = new Date(createdMs + (i % 1000)).toISOString();

    const verb = rng.pick(VERBS);
    const object = rng.pick(OBJECTS);
    const context = rng.pick(CONTEXTS);
    const title = `${verb} ${object}${context ? ` ${context}` : ""} (#${i + 1})`;
    const description = rng.next() < 0.4 ? rng.pick(DESCRIPTIONS) : null;

    let startDate: string | null = null;
    let dueDate: string | null = null;
    if (rng.next() < 0.9) {
      const dueMs = anchorMs + rng.int(-30, 90) * DAY;
      const startMs = Math.min(dueMs, anchorMs - rng.int(0, 60) * DAY);
      startDate = isoDate(startMs);
      dueDate = isoDate(dueMs);
    }

    let status: string;
    if (doneRoot[root]) {
      status = rng.pick(["Đã xong", "Đã xong", "Đã đóng", "Từ chối"]);
    } else if (depth === 1) {
      status = rng.pick([
        "Mới",
        "Đang thực hiện",
        "Đang thực hiện",
        "Cần phản hồi",
      ]);
    } else {
      // Task cấp 2 có thể done chỉ khi mọi con done; điều chỉnh sau khi sinh đủ cây (bên dưới).
      status = rng.pick(OPEN_HEAVY_STATUSES);
    }

    const completedAt =
      statusCategory(status) === "done"
        ? new Date(
            Math.min(nowCap, createdMs + rng.int(1, 30) * DAY),
          ).toISOString()
        : null;

    const type: PerfTask["type"] =
      depth === 1
        ? rng.next() < 0.6
          ? "Phase"
          : "Task"
        : rng.next() < 0.05
          ? "Milestone"
          : rng.next() < 0.25
            ? "Bug"
            : "Task";

    const assignee = rng.next() < 0.85 ? rng.pick(assignable) : null;
    tasks.push({
      index: i,
      id: taskId(c.dataset, i),
      parentIndex,
      depth,
      title,
      description,
      assignee,
      // Người tạo: người phụ trách (nếu có) hoặc PM, như khi PM giao việc.
      createdBy: assignee ?? "pm",
      priority: rng.pick([
        "low",
        "medium",
        "medium",
        "high",
        "urgent",
      ] as const),
      startDate,
      dueDate,
      status,
      type,
      completedAt,
      createdAt,
      position: i,
    });
  }

  // BR-04: task done mà còn con chưa done thì mở lại (về "Đang thực hiện"). Duyệt từ cấp sâu
  // lên để cấp 1 thấy trạng thái cuối của cấp 2.
  const children = new Map<number, PerfTask[]>();
  for (const t of tasks) {
    if (t.parentIndex !== null) {
      const list = children.get(t.parentIndex) ?? [];
      list.push(t);
      children.set(t.parentIndex, list);
    }
  }
  for (const depth of [2, 1] as const) {
    for (const t of tasks) {
      if (t.depth !== depth || statusCategory(t.status) !== "done") continue;
      const open = (children.get(t.index) ?? []).some(
        (ch) => statusCategory(ch.status) !== "done",
      );
      if (open) {
        t.status = "Đang thực hiện";
        t.completedAt = null;
      }
    }
  }

  // Nhãn: 0, 1 hoặc 2 nhãn mỗi task (trung bình khoảng 1).
  const taskLabels: { task: number; label: number }[] = [];
  for (const t of tasks) {
    const k = [0, 1, 1, 2][t.index % 4];
    const first = rng.int(0, labels.length - 1);
    for (let j = 0; j < Math.min(k, labels.length); j++) {
      taskLabels.push({
        task: t.index,
        label: (first + j * 7) % labels.length,
      });
    }
  }

  // Quan hệ: from < to (theo chỉ số) cho mọi kiểu có hướng, nên blocks + precedes không vòng.
  // QLDA-43: relationCount ≥ 4 thì luôn đủ 4 kiểu: quan hệ thứ k < 4 lấy kiểu RELATION_KINDS[k]
  // (phân bổ xác định), phần còn lại ngẫu nhiên. Vẫn rút rng.pick(kinds) ở mọi lượt để chuỗi số
  // ngẫu nhiên (cặp task, lag) giữ nguyên như trước; chỉ kiểu của tối đa 4 quan hệ đầu đổi.
  const relations: PerfRelation[] = [];
  const seen = new Set<string>();
  const kinds: RelationKind[] = [
    "blocks",
    "blocks",
    "precedes",
    "precedes",
    "relates",
    "relates",
    "duplicates",
  ];
  let guard = 0;
  while (relations.length < c.relationCount) {
    if (++guard > c.relationCount * 50) {
      throw new Error("Không sinh đủ quan hệ khác nhau; giảm relationCount.");
    }
    const a = rng.int(0, c.taskCount - 1);
    // Ưu tiên task gần nhau (cùng giai đoạn) như dữ liệu thật; vẫn có cặp xa.
    const b =
      rng.next() < 0.7 ? a + rng.int(1, 40) : rng.int(0, c.taskCount - 1);
    if (b >= c.taskCount || a === b) continue;
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    const randomKind = rng.pick(kinds);
    const kind =
      relations.length < RELATION_KINDS.length
        ? RELATION_KINDS[relations.length]
        : randomKind;
    // relates: một cặp không thứ tự; kiểu khác: (from, to, kind) duy nhất.
    const key =
      kind === "relates" ? `r:${from}:${to}` : `${kind}:${from}:${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    relations.push({
      from,
      to,
      kind,
      lagDays: kind === "precedes" ? rng.int(0, 5) : 0,
    });
  }

  return {
    config: c,
    projectId: projectId(c.dataset),
    projectName: projectName(c.dataset),
    users,
    labels,
    tasks,
    taskLabels,
    relations,
  };
}

// ---------------------------------------------------------------------------
// Kiểm tính hợp lệ (dùng trong test và trước khi ghi CSDL)
// ---------------------------------------------------------------------------
export interface TreeNode {
  id: string;
  parentId: string | null;
  depth: number;
}

/** Lỗi cây task: cha không tồn tại, depth sai so với cha, vượt 3 cấp. Rỗng = hợp lệ. */
export function treeErrors(nodes: readonly TreeNode[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const errors: string[] = [];
  for (const n of nodes) {
    if (n.depth < 1 || n.depth > 3)
      errors.push(`${n.id}: depth ${n.depth} ngoài 1-3`);
    if (n.parentId === null) {
      if (n.depth !== 1) errors.push(`${n.id}: gốc nhưng depth ${n.depth}`);
      continue;
    }
    const p = byId.get(n.parentId);
    if (!p) errors.push(`${n.id}: cha ${n.parentId} không có trong dự án`);
    else if (n.depth !== p.depth + 1) {
      errors.push(`${n.id}: depth ${n.depth} nhưng cha depth ${p.depth}`);
    }
  }
  return errors;
}

export interface Edge {
  from: string;
  to: string;
  kind: string;
}

/** Có vòng trong đồ thị blocks + precedes (BR-05)? Duyệt DFS ba màu, không đệ quy. */
export function hasDependencyCycle(edges: readonly Edge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== "blocks" && e.kind !== "precedes") continue;
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  const color = new Map<string, 1 | 2>(); // 1 đang duyệt, 2 xong
  for (const start of adj.keys()) {
    if (color.has(start)) continue;
    const stack: [string, number][] = [[start, 0]];
    color.set(start, 1);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const next = (adj.get(top[0]) ?? [])[top[1]++];
      if (next === undefined) {
        color.set(top[0], 2);
        stack.pop();
      } else if (color.get(next) === 1) {
        return true;
      } else if (!color.has(next)) {
        color.set(next, 1);
        stack.push([next, 0]);
      }
    }
  }
  return false;
}

/** Task done mà còn hậu duệ trực tiếp chưa done (vi phạm BR-04). */
export function openChildrenOfDone(
  rows: readonly { id: string; parentId: string | null; done: boolean }[],
): string[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const bad = new Set<string>();
  for (const r of rows) {
    if (r.parentId && !r.done && byId.get(r.parentId)?.done)
      bad.add(r.parentId);
  }
  return [...bad];
}
