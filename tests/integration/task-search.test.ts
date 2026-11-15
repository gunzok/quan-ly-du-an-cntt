/**
 * Test tích hợp Story E3-3 (QLDA-48) với Supabase cục bộ: GET /api/v1/projects/{id}/tasks với
 * `q` (bỏ dấu tiếng Việt, không phân biệt hoa thường, mọi từ phải có) và bộ lọc kết hợp AND
 * (assignee_id, status_id nhiều giá trị, priority, label_id, due_after, due_before). Gọi thẳng lõi
 * Route Handler với client phiên tạo từ hũ cookie: đi qua getUser, RLS, schema và hàm
 * public.search_tasks (migration 20261115180000_task_search.sql).
 *
 * Chạy: make db-start && make test-integration. Tài khoản và dự án tạo tạm, xóa ở afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { handleListTasks } from "@/lib/tasks/handlers";
import type { TaskListResponse } from "@/lib/tasks/model";
import { SEARCH_Q_MAX_LENGTH } from "@/lib/tasks/search";
import { missingIntegrationEnv } from "./env";
import {
  APP_ORIGIN,
  CookieJar,
  SERVICE_ROLE_KEY,
  SUPABASE_URL,
  assertLocalSupabase,
  serverClient as sessionClient,
} from "./helpers";

const enabled = missingIntegrationEnv().length === 0;

let service: SupabaseClient;

interface ErrorBody {
  error: {
    code: string;
    details?: { field: string; issue: string }[];
    request_id: string;
  };
}

describe.skipIf(!enabled)("Tìm kiếm và lọc task (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  let projectA: string;
  let projectB: string;
  /** Tên ngắn -> id task (dự án A trừ khi ghi rõ). */
  const task: Record<string, string> = {};
  let todo: string;
  let doing: string;
  let done: string;
  let labelX: string;
  let labelY: string;

  async function createUser(label: string) {
    const { data, error } = await service.auth.admin.createUser({
      email: `it-e3-3-${label}-${tag}@example.com`,
      password,
      email_confirm: true,
      user_metadata: { full_name: `IT ${label} ${tag}` },
    });
    if (error) throw error;
    created.push(data.user.id);
    users[label] = data.user.id;
  }

  async function signIn(label: string) {
    const jar = new CookieJar();
    const result = await signInWithPassword(sessionClient(jar), {
      email: `it-e3-3-${label}-${tag}@example.com`,
      password,
    });
    expect(result.ok).toBe(true);
    jars[label] = jar;
  }

  function list(
    who: string,
    params: Record<string, string> | string = {},
    projectId = projectA,
  ) {
    const qs = new URLSearchParams(params).toString();
    return handleListTasks(
      new Request(
        new URL(
          `/api/v1/projects/${projectId}/tasks${qs ? `?${qs}` : ""}`,
          APP_ORIGIN,
        ),
      ),
      projectId,
      { session: sessionClient(jars[who]) },
    );
  }

  /** Tên ngắn của các task trả về, đã sắp. */
  async function names(
    params: Record<string, string>,
    who = "member",
  ): Promise<string[]> {
    const res = await list(who, { limit: "100", ...params });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TaskListResponse;
    const byId = Object.fromEntries(
      Object.entries(task).map(([k, v]) => [v, k]),
    );
    return body.data.map((t) => byId[t.id] ?? `?${t.title}`).sort();
  }

  async function expect400(
    params: Record<string, string> | string,
    field: string,
    issue: string,
  ) {
    const res = await list("member", params);
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details).toContainEqual({ field, issue });
  }

  beforeAll(async () => {
    assertLocalSupabase();
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const label of ["pm", "member", "member2", "viewer", "outsider"]) {
      await createUser(label);
    }
    projectA = randomUUID();
    projectB = randomUUID();
    const projects = await service.from("projects").insert([
      { id: projectA, name: `IT E3-3 A ${tag}`, created_by: users.pm },
      { id: projectB, name: `IT E3-3 B ${tag}`, created_by: users.outsider },
    ]);
    if (projects.error) throw projects.error;
    const members = await service.from("project_members").insert([
      { project_id: projectA, user_id: users.member, role: "member" },
      { project_id: projectA, user_id: users.member2, role: "member" },
      { project_id: projectA, user_id: users.viewer, role: "viewer" },
    ]);
    if (members.error) throw members.error;

    // Trạng thái mặc định do trigger tạo khi tạo dự án (E2-3).
    const statuses = await service
      .from("task_statuses")
      .select("id, category, position")
      .eq("project_id", projectA)
      .order("position");
    if (statuses.error) throw statuses.error;
    const cat = (c: string) => statuses.data.find((s) => s.category === c)!.id;
    todo = cat("todo");
    doing = cat("in_progress");
    done = cat("done");
    const labels = await service
      .from("labels")
      .insert([
        { project_id: projectA, name: `X ${tag}` },
        { project_id: projectA, name: `Y ${tag}` },
      ])
      .select("id, name");
    if (labels.error) throw labels.error;
    labelX = labels.data.find((l) => l.name.startsWith("X"))!.id;
    labelY = labels.data.find((l) => l.name.startsWith("Y"))!.id;

    // AC2: "target" khớp mọi điều kiện của bộ lọc kết hợp; mỗi task "miss_*" chỉ khác target
    // đúng một điều kiện, nên kết quả chỉ còn target khi mọi điều kiện được áp cùng lúc (AND).
    const base = {
      project_id: projectA,
      created_by: users.pm,
      title: "Báo cáo nghiệm thu",
      description: null as string | null,
      assignee_id: users.member as string | null,
      status_id: doing,
      priority: "high",
      due_date: "2026-12-10" as string | null,
    };
    const rows: Record<string, Partial<typeof base>> = {
      target: {},
      target_todo: { status_id: todo },
      miss_q: { title: "Kế hoạch nghiệm thu" },
      miss_assignee: { assignee_id: users.member2 },
      miss_status: { status_id: done },
      miss_priority: { priority: "low" },
      miss_label: {},
      miss_due_early: { due_date: "2026-11-30" },
      miss_due_late: { due_date: "2026-12-21" },
      miss_due_null: { due_date: null },
      // AC1: dữ liệu tiếng Việt cho tìm kiếm (không gán người, không nhãn, không hạn).
      dang_ky: { title: "Đăng ký tên miền", assignee_id: null, due_date: null },
      uu_tien: {
        title: "Sửa lỗi giao diện",
        description: "Ưu tiên xử lý trước Tết, ơn trời",
        assignee_id: null,
        due_date: null,
      },
      may_chu: {
        title: "Nâng cấp MÁY CHỦ dự phòng",
        assignee_id: null,
        due_date: null,
      },
      percent: {
        title: "Hoàn thành 100% kiểm thử",
        assignee_id: null,
        due_date: null,
      },
      underscore: {
        title: "Đổi tên biến a_b",
        assignee_id: null,
        due_date: null,
      },
      backslash: {
        title: "Đường dẫn C:\\temp",
        assignee_id: null,
        due_date: null,
      },
    };
    for (const [key, override] of Object.entries(rows)) {
      const id = randomUUID();
      const { error } = await service
        .from("tasks")
        .insert({ id, ...base, ...override });
      if (error) throw error;
      task[key] = id;
    }
    const taskLabels = await service.from("task_labels").insert(
      Object.keys(rows)
        .filter((k) => k.startsWith("target") || k.startsWith("miss_"))
        .map((k) => ({
          task_id: task[k],
          label_id: k === "miss_label" ? labelY : labelX,
        })),
    );
    if (taskLabels.error) throw taskLabels.error;

    // Dự án B (người ngoài là PM): cùng tiêu đề để chứng minh không lộ chéo dự án.
    const b = randomUUID();
    const insertB = await service.from("tasks").insert({
      id: b,
      project_id: projectB,
      created_by: users.outsider,
      title: "Báo cáo nghiệm thu dự án B",
    });
    if (insertB.error) throw insertB.error;
    task.b_report = b;

    for (const label of Object.keys(users)) await signIn(label);
  });

  afterAll(async () => {
    if (!service) return;
    for (const id of [projectA, projectB]) {
      if (id) await service.from("projects").delete().eq("id", id);
    }
    for (const id of created) await service.auth.admin.deleteUser(id);
  });

  // =========================================================================
  // AC1: có dấu, không dấu, hoa thường
  // =========================================================================
  describe("AC1: tìm bỏ dấu, không phân biệt hoa thường", () => {
    const reports = [
      "miss_assignee",
      "miss_due_early",
      "miss_due_late",
      "miss_due_null",
      "miss_label",
      "miss_priority",
      "miss_status",
      "target",
      "target_todo",
    ];

    it.each([
      ["bao cao", reports],
      ["Báo cáo", reports],
      ["BÁO CÁO", reports],
      ["BAO CAO", reports],
      ["báo cao", reports],
    ])('q=%s khớp mọi task tiêu đề "Báo cáo ..."', async (q, expected) => {
      expect(await names({ q })).toEqual(expected);
    });

    it.each([
      ["dang ky", ["dang_ky"]],
      ["ĐĂNG KÝ", ["dang_ky"]],
      ["đăng", ["dang_ky"]],
      ["Dang", ["dang_ky"]],
    ])("đ/Đ, ă, dấu sắc: q=%s", async (q, expected) => {
      expect(await names({ q })).toEqual(expected);
    });

    it.each([
      ["uu tien", ["uu_tien"]],
      ["ƯU TIÊN", ["uu_tien"]],
      ["on troi", ["uu_tien"]],
      ["ơn trời", ["uu_tien"]],
      ["xu ly truoc tet", ["uu_tien"]],
    ])("ư, ơ, dấu thanh trong mô tả: q=%s", async (q, expected) => {
      expect(await names({ q })).toEqual(expected);
    });

    it.each([
      ["may chu", ["may_chu"]],
      ["máy chủ", ["may_chu"]],
      ["Máy Chủ Dự Phòng", ["may_chu"]],
      ["nang cap", ["may_chu"]],
    ])(
      "chữ hoa trong dữ liệu, dấu hỏi, ngã, nặng: q=%s",
      async (q, expected) => {
        expect(await names({ q })).toEqual(expected);
      },
    );

    it("mọi từ khóa phải có (AND), không phụ thuộc thứ tự", async () => {
      expect(await names({ q: "nghiem thu ke hoach" })).toEqual(["miss_q"]);
      expect(await names({ q: "ke hoach nghiem thu" })).toEqual(["miss_q"]);
      expect(await names({ q: "bao cao tet" })).toEqual([]);
    });

    it("ký tự % _ \\ được hiểu theo nghĩa đen", async () => {
      expect(await names({ q: "%" })).toEqual(["percent"]);
      expect(await names({ q: "100%" })).toEqual(["percent"]);
      expect(await names({ q: "_" })).toEqual(["underscore"]);
      expect(await names({ q: "a_b" })).toEqual(["underscore"]);
      expect(await names({ q: "\\" })).toEqual(["backslash"]);
      expect(await names({ q: "c:\\temp" })).toEqual(["backslash"]);
      expect(await names({ q: "*" })).toEqual([]);
      expect(await names({ q: "a%b" })).toEqual([]);
    });

    it("q rỗng hoặc chỉ khoảng trắng: như không tìm", async () => {
      const all = await names({});
      expect(all.length).toBe(16);
      expect(await names({ q: "" })).toEqual(all);
      expect(await names({ q: "   " })).toEqual(all);
    });

    it("phân trang con trỏ vẫn chạy khi có q", async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const params: Record<string, string> = { q: "bao cao", limit: "4" };
        if (cursor) params.cursor = cursor;
        const res = await list("member", params);
        expect(res.status).toBe(200);
        const body = (await res.json()) as TaskListResponse;
        seen.push(...body.data.map((t) => t.id));
        cursor = body.next_cursor;
      } while (cursor);
      expect(seen.length).toBe(9);
      expect(new Set(seen).size).toBe(9);
    });

    it("kết quả tìm vẫn kèm đủ nhãn của task", async () => {
      const res = await list("member", { q: "bao cao", label_id: labelY });
      const body = (await res.json()) as TaskListResponse;
      expect(body.data.map((t) => t.id)).toEqual([task.miss_label]);
      expect(body.data[0].label_ids).toEqual([labelY]);
    });

    it("Người xem cũng tìm được", async () => {
      expect(await names({ q: "dang ky" }, "viewer")).toEqual(["dang_ky"]);
    });
  });

  // =========================================================================
  // AC2: nhiều bộ lọc khớp TẤT CẢ
  // =========================================================================
  describe("AC2: bộ lọc kết hợp AND", () => {
    const all = () => ({
      q: "bao cao",
      assignee_id: users.member,
      status_id: `${doing},${todo}`,
      priority: "high",
      label_id: labelX,
      due_after: "2026-12-01",
      due_before: "2026-12-20",
    });

    it("mọi bộ lọc cùng lúc: chỉ còn task khớp tất cả", async () => {
      expect(await names(all())).toEqual(["target", "target_todo"]);
    });

    it("bỏ từng bộ lọc thì task chỉ lệch đúng điều kiện đó xuất hiện lại", async () => {
      const cases: [keyof ReturnType<typeof all>, string[]][] = [
        ["q", ["miss_q"]],
        ["assignee_id", ["miss_assignee"]],
        ["status_id", ["miss_status"]],
        ["priority", ["miss_priority"]],
        ["label_id", ["miss_label"]],
        ["due_after", ["miss_due_early"]],
        ["due_before", ["miss_due_late"]],
      ];
      for (const [drop, extra] of cases) {
        const params: Record<string, string> = all();
        delete params[drop];
        expect(await names(params), `bỏ ${drop}`).toEqual(
          ["target", "target_todo", ...extra].sort(),
        );
      }
    });

    it("status_id một giá trị và nhiều giá trị", async () => {
      const base = { ...all() };
      expect(await names({ ...base, status_id: todo })).toEqual([
        "target_todo",
      ]);
      expect(
        await names({ ...base, status_id: `${done},${doing},${todo}` }),
      ).toEqual(["miss_status", "target", "target_todo"]);
    });

    it("không có q: bộ lọc vẫn kết hợp AND trên bảng tasks", async () => {
      const params: Record<string, string> = all();
      delete params.q;
      expect(await names(params)).toEqual(["miss_q", "target", "target_todo"]);
    });

    it("hạn tính cả hai đầu, task không có hạn bị loại", async () => {
      expect(
        await names({ due_after: "2026-12-10", due_before: "2026-12-10" }),
      ).toEqual([
        "miss_assignee",
        "miss_label",
        "miss_priority",
        "miss_q",
        "miss_status",
        "target",
        "target_todo",
      ]);
      expect(await names({ due_before: "2026-11-30" })).toEqual([
        "miss_due_early",
      ]);
      expect(await names({ due_after: "2026-12-21" })).toEqual([
        "miss_due_late",
      ]);
    });
  });

  // =========================================================================
  // Schema 400, thứ tự kiểm, RLS
  // =========================================================================
  describe("Tham số sai: 400", () => {
    it("q quá dài", async () => {
      await expect400(
        { q: "a".repeat(SEARCH_Q_MAX_LENGTH + 1) },
        "q",
        "too_long",
      );
      const res = await list("member", {
        q: "a".repeat(SEARCH_Q_MAX_LENGTH),
      });
      expect(res.status).toBe(200);
    });

    it("q có ký tự điều khiển, q lặp", async () => {
      await expect400({ q: "a\u0000b" }, "q", "invalid_format");
      await expect400({ q: "a\nb" }, "q", "invalid_format");
      await expect400("q=a&q=b", "q", "invalid_value");
    });

    it("status_id, hạn sai; tham số lạ", async () => {
      await expect400(
        { status_id: `${todo},abc` },
        "status_id",
        "invalid_format",
      );
      await expect400(
        { due_after: "2026-13-01" },
        "due_after",
        "invalid_format",
      );
      await expect400(
        { due_after: "2026-12-02", due_before: "2026-12-01" },
        "due_before",
        "invalid_value",
      );
      await expect400({ due_from: "2026-12-01" }, "due_from", "unknown_field");
    });

    it("chưa đăng nhập: 401 trước khi kiểm tham số", async () => {
      jars.anon = new CookieJar();
      const res = await list("anon", { q: "a".repeat(500) });
      expect(res.status).toBe(401);
    });
  });

  describe("RLS quyết định thấy gì", () => {
    it("người ngoài dự án: 404 dù từ khóa khớp, kể cả tham số sai", async () => {
      expect((await list("outsider", { q: "bao cao" })).status).toBe(404);
      expect(
        (await list("outsider", { q: "a".repeat(SEARCH_Q_MAX_LENGTH + 1) }))
          .status,
      ).toBe(404);
    });

    it("gọi thẳng RPC search_tasks bằng phiên người ngoài: tập rỗng", async () => {
      const { data, error } = await sessionClient(jars.outsider).rpc(
        "search_tasks",
        { p_project_id: projectA, p_q: "bao cao" },
      );
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("thành viên A tìm ở dự án B: 404; ở A không lẫn task của B", async () => {
      expect((await list("member", { q: "bao cao" }, projectB)).status).toBe(
        404,
      );
      expect(await names({ q: "du an b" })).toEqual([]);
      const { data } = await sessionClient(jars.member).rpc("search_tasks", {
        p_project_id: projectB,
        p_q: "bao cao",
      });
      expect(data).toEqual([]);
    });

    it("PM dự án B (người ngoài A) tìm ở B thấy task của B", async () => {
      const res = await list("outsider", { q: "nghiem thu" }, projectB);
      expect(res.status).toBe(200);
      const body = (await res.json()) as TaskListResponse;
      expect(body.data.map((t) => t.id)).toEqual([task.b_report]);
    });
  });
});
