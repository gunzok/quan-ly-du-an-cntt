/**
 * Test tích hợp Story E13-2 (QLDA-54) với Supabase cục bộ: 7 chế độ xem mặc định dùng chung.
 *
 * AC1: dự án mới (và dự án có sẵn) mở danh sách chế độ xem → có đủ 7 mặc định.
 * AC2: thử sửa, xóa chế độ xem mặc định → bị từ chối (API 403 cho mọi vai trò; service_role đi
 * thẳng PostgREST cũng bị trigger chặn).
 * Mỗi chế độ xem mặc định, dùng bằng phiên của người mở, trả đúng task trên tập dữ liệu biết trước:
 * `me` là người mở; "Quá hạn" tính hôm nay theo giờ Việt Nam (kiểm ở ranh giới 17:00 UTC).
 *
 * Chạy: make db-start && make test-integration. Tài khoản và dự án tạo tạm, xóa ở afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { viewTaskListParams } from "@/lib/saved-views/apply";
import { DEFAULT_VIEWS, type DefaultViewKey } from "@/lib/saved-views/defaults";
import {
  handleDeleteView,
  handleListViews,
  handlePatchView,
} from "@/lib/saved-views/handlers";
import type { SavedView } from "@/lib/saved-views/model";
import { strings } from "@/lib/strings";
import { handleListTasks } from "@/lib/tasks/handlers";
import type { TaskListResponse } from "@/lib/tasks/model";
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

const get = (path: string) => new Request(new URL(path, APP_ORIGIN));
function send(method: "PATCH" | "DELETE", path: string, body?: unknown) {
  const headers = new Headers({ origin: APP_ORIGIN });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(new URL(path, APP_ORIGIN), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** 23:59:59 ngày 17/11 giờ Việt Nam (UTC+7) và 00:00:00 ngày 18/11. */
const VN_LATE_17 = new Date("2026-11-17T16:59:59Z");
const VN_START_18 = new Date("2026-11-17T17:00:00Z");

describe.skipIf(!enabled)("7 chế độ xem mặc định (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  const projects: string[] = [];
  let project: string;
  const task: Record<string, string> = {};

  const email = (label: string) => `it-e13-2-${label}-${tag}@example.com`;

  async function createUser(label: string) {
    const { data, error } = await service.auth.admin.createUser({
      email: email(label),
      password,
      email_confirm: true,
      user_metadata: { full_name: `IT ${label} ${tag}` },
    });
    if (error) throw error;
    created.push(data.user.id);
    users[label] = data.user.id;
  }

  async function newProject(owner: string): Promise<string> {
    const id = randomUUID();
    const { error } = await service
      .from("projects")
      .insert({
        id,
        name: `IT E13-2 ${tag} ${projects.length}`,
        created_by: owner,
      });
    if (error) throw error;
    projects.push(id);
    return id;
  }

  const listViews = (who: string, projectId = project) =>
    handleListViews(get(`/api/v1/projects/${projectId}/views`), projectId, {
      session: sessionClient(jars[who]),
    });

  async function defaultsOf(who: string, projectId = project) {
    const res = await listViews(who, projectId);
    expect(res.status).toBe(200);
    return (await json<{ data: SavedView[] }>(res)).data.filter(
      (v) => v.is_default && v.project_id === null,
    );
  }

  const byKey = (key: DefaultViewKey) =>
    DEFAULT_VIEWS.find((d) => d.key === key)!;

  /** Mở chế độ xem mặc định bằng phiên của `who`, gọi GET /tasks đúng bộ lọc và sắp xếp của nó. */
  async function openView(
    who: string,
    key: DefaultViewKey,
    now: Date = VN_START_18,
    extra = "",
  ): Promise<{ status: number; keys: string[] }> {
    const view = (await defaultsOf(who)).find((v) => v.id === byKey(key).id);
    expect(view, key).toBeDefined();
    const qs = viewTaskListParams(view!.query.filters, view!.query.sort);
    const res = await handleListTasks(
      get(`/api/v1/projects/${project}/tasks?${qs}${extra}`),
      project,
      { session: sessionClient(jars[who]), now: () => now },
    );
    if (res.status !== 200) return { status: res.status, keys: [] };
    const body = await json<TaskListResponse>(res);
    const names = new Map(Object.entries(task).map(([k, id]) => [id, k]));
    return {
      status: 200,
      keys: body.data.map((t) => names.get(t.id) ?? `?${t.id}`),
    };
  }
  const sorted = (keys: string[]) => [...keys].sort();

  beforeAll(async () => {
    assertLocalSupabase();
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const label of [
      "admin",
      "pm",
      "member",
      "viewer",
      "outsider",
      "locked",
    ]) {
      await createUser(label);
    }
    const admin = await service
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", users.admin);
    if (admin.error) throw admin.error;

    project = await newProject(users.pm);
    const members = await service.from("project_members").insert([
      { project_id: project, user_id: users.member, role: "member" },
      { project_id: project, user_id: users.viewer, role: "viewer" },
      { project_id: project, user_id: users.locked, role: "member" },
    ]);
    if (members.error) throw members.error;

    const statuses = await service
      .from("task_statuses")
      .select("id, category, position")
      .eq("project_id", project)
      .order("position");
    if (statuses.error) throw statuses.error;
    const todo = statuses.data.find((s) => s.category === "todo")!.id;
    const done = statuses.data.find((s) => s.category === "done")!.id;

    // Tập dữ liệu biết trước. Hôm nay (giờ VN) trong test là 17/11 hoặc 18/11 tùy đồng hồ.
    const rows: {
      key: string;
      created_by: string;
      assignee_id: string | null;
      due_date: string | null;
      status_id: string;
      created_at: string;
    }[] = [
      // Hạn 17/11: quá hạn khi hôm nay giờ VN là 18/11, chưa khi là 17/11.
      {
        key: "a",
        created_by: users.pm,
        assignee_id: users.member,
        due_date: "2026-11-17",
        status_id: todo,
        created_at: "2026-01-01T00:00:00Z",
      },
      // Hạn 18/11: chưa quá hạn ở cả hai đồng hồ.
      {
        key: "b",
        created_by: users.member,
        assignee_id: users.member,
        due_date: "2026-11-18",
        status_id: todo,
        created_at: "2026-01-02T00:00:00Z",
      },
      // Đã xong: không thuộc chế độ xem "đang mở".
      {
        key: "c",
        created_by: users.member,
        assignee_id: users.pm,
        due_date: null,
        status_id: done,
        created_at: "2026-01-03T00:00:00Z",
      },
      // Đã xong, hạn đã qua: không quá hạn.
      {
        key: "d",
        created_by: users.pm,
        assignee_id: null,
        due_date: "2026-10-01",
        status_id: done,
        created_at: "2026-01-04T00:00:00Z",
      },
      // Hạn 10/11: quá hạn ở cả hai đồng hồ.
      {
        key: "e",
        created_by: users.member,
        assignee_id: users.pm,
        due_date: "2026-11-10",
        status_id: todo,
        created_at: "2026-01-05T00:00:00Z",
      },
    ];
    for (const r of rows) {
      const id = randomUUID();
      const { key, ...fields } = r;
      const { error } = await service.from("tasks").insert({
        id,
        project_id: project,
        title: `IT E13-2 ${key} ${tag}`,
        ...fields,
      });
      if (error) throw error;
      task[key] = id;
    }
    // Hoạt động gần nhất: cập nhật lần lượt b → a → e (updated_at do trigger đặt now()).
    for (const key of ["b", "a", "e"]) {
      await new Promise((r) => setTimeout(r, 15));
      const { error } = await service
        .from("tasks")
        .update({ title: `IT E13-2 ${key} ${tag} (sửa)` })
        .eq("id", task[key]);
      if (error) throw error;
    }

    for (const label of Object.keys(users)) {
      const jar = new CookieJar();
      const result = await signInWithPassword(sessionClient(jar), {
        email: email(label),
        password,
      });
      expect(result.ok).toBe(true);
      jars[label] = jar;
    }
    const lock = await service
      .from("profiles")
      .update({ is_active: false })
      .eq("id", users.locked);
    if (lock.error) throw lock.error;
  });

  afterAll(async () => {
    if (!service) return;
    for (const id of projects)
      await service.from("projects").delete().eq("id", id);
    for (const id of created) await service.auth.admin.deleteUser(id);
  });

  it("AC1: dự án mới và dự án có sẵn đều có đủ 7 mặc định, đúng như định nghĩa", async () => {
    const fresh = await newProject(users.pm);
    for (const [who, projectId] of [
      ["pm", fresh],
      ["pm", project],
      ["member", project],
      ["viewer", project],
      ["admin", fresh],
    ] as const) {
      const views = await defaultsOf(who, projectId);
      expect(views.map((v) => v.id).sort(), `${who}`).toEqual(
        DEFAULT_VIEWS.map((d) => d.id).sort(),
      );
      for (const def of DEFAULT_VIEWS) {
        const v = views.find((x) => x.id === def.id)!;
        expect(v).toMatchObject({
          name: def.name,
          query: def.query,
          visibility: "public",
          owner_id: null,
          is_default: true,
          can_edit: false,
        });
      }
    }
  });

  it("người ngoài dự án, người bị khóa: 404 (không lộ dự án)", async () => {
    expect((await listViews("outsider")).status).toBe(404);
    expect((await listViews("locked")).status).toBe(404);
  });

  it("AC2: sửa, xóa mặc định bị từ chối với mọi vai trò; service_role cũng bị trigger chặn", async () => {
    const id = byKey("allOpen").id;
    for (const who of ["pm", "admin", "member", "viewer"]) {
      for (const body of [
        { name: "Đổi" },
        { query: { filters: {} } },
        { visibility: "private" },
      ]) {
        const res = await handlePatchView(
          send("PATCH", `/api/v1/views/${id}`, body),
          id,
          { session: sessionClient(jars[who]) },
        );
        expect(res.status, `${who} ${JSON.stringify(body)}`).toBe(403);
        const err = (await json<{ error: { message: string } }>(res)).error;
        expect(err.message).toBe(strings.savedViews.errors.defaultReadOnly);
      }
      const del = await handleDeleteView(
        send("DELETE", `/api/v1/views/${id}`),
        id,
        { session: sessionClient(jars[who]) },
      );
      expect(del.status, who).toBe(403);
    }

    const upd = await service
      .from("saved_views")
      .update({ name: "Đổi bằng service_role" })
      .eq("id", id)
      .select("id");
    expect(upd.error?.code).toBe("P0001");
    expect(upd.error?.message).toBe("saved_view_default_immutable");
    const del = await service.from("saved_views").delete().eq("id", id);
    expect(del.error?.code).toBe("P0001");
    const after = await service
      .from("saved_views")
      .select("name, query")
      .eq("id", id)
      .single();
    expect(after.data).toEqual({
      name: byKey("allOpen").name,
      query: byKey("allOpen").query,
    });
  });

  it("yêu thích mặc định là của từng người (Người xem dùng được)", async () => {
    const id = byKey("overdue").id;
    const res = await handlePatchView(
      send("PATCH", `/api/v1/views/${id}`, { is_favorite: true }),
      id,
      { session: sessionClient(jars.viewer) },
    );
    expect(res.status).toBe(200);
    expect(
      (await defaultsOf("viewer")).find((v) => v.id === id)?.is_favorite,
    ).toBe(true);
    expect(
      (await defaultsOf("member")).find((v) => v.id === id)?.is_favorite,
    ).toBe(false);
  });

  it("Tất cả đang mở, Tóm tắt: đúng tập task", async () => {
    expect(sorted((await openView("member", "allOpen")).keys)).toEqual([
      "a",
      "b",
      "e",
    ]);
    expect(sorted((await openView("viewer", "summary")).keys)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("Hoạt động gần nhất, Mới tạo: đúng thứ tự (API sắp theo updated_at/created_at), kể cả qua con trỏ", async () => {
    expect((await openView("member", "latestActivity")).keys).toEqual([
      "e",
      "a",
      "b",
    ]);
    expect((await openView("member", "recentlyCreated")).keys).toEqual([
      "e",
      "b",
      "a",
    ]);

    // Phân trang 1 task/trang theo -updated_at: con trỏ mang trường sắp xếp.
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i += 1) {
      const qs: string = `open=true&sort=-updated_at&limit=1${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await handleListTasks(
        get(`/api/v1/projects/${project}/tasks?${qs}`),
        project,
        { session: sessionClient(jars.member) },
      );
      expect(res.status).toBe(200);
      const body: TaskListResponse = await json<TaskListResponse>(res);
      seen.push(...body.data.map((t) => t.id));
      cursor = body.next_cursor;
      if (!cursor) break;
    }
    expect(seen).toEqual([task.e, task.a, task.b]);
    // Tăng dần cũng đúng.
    const asc = await handleListTasks(
      get(`/api/v1/projects/${project}/tasks?open=true&sort=created_at`),
      project,
      { session: sessionClient(jars.member) },
    );
    expect((await json<TaskListResponse>(asc)).data.map((t) => t.id)).toEqual([
      task.a,
      task.b,
      task.e,
    ]);
  });

  it("Quá hạn: hôm nay theo giờ Việt Nam, ranh giới 17:00 UTC; đã xong và hạn hôm nay không tính", async () => {
    // 23:59:59 ngày 17/11 giờ VN (UTC vẫn 17/11): chỉ e quá hạn; a hạn đúng hôm nay.
    expect(
      sorted((await openView("member", "overdue", VN_LATE_17)).keys),
    ).toEqual(["e"]);
    // 00:00 ngày 18/11 giờ VN (UTC vẫn là 17/11): a thành quá hạn.
    expect(
      sorted((await openView("member", "overdue", VN_START_18)).keys),
    ).toEqual(["a", "e"]);
  });

  it("Tạo bởi tôi, Giao cho tôi: `me` là người đang mở", async () => {
    expect(sorted((await openView("member", "createdByMe")).keys)).toEqual([
      "b",
      "e",
    ]);
    expect((await openView("pm", "createdByMe")).keys).toEqual(["a"]);
    expect((await openView("viewer", "createdByMe")).keys).toEqual([]);

    expect(sorted((await openView("member", "assignedToMe")).keys)).toEqual([
      "a",
      "b",
    ]);
    // c giao cho PM nhưng đã xong.
    expect((await openView("pm", "assignedToMe")).keys).toEqual(["e"]);
    expect((await openView("admin", "assignedToMe")).keys).toEqual([]);
  });

  it("API danh sách task: tham số mới kiểm chặt (400), cũ không đổi", async () => {
    for (const qs of [
      "open=false",
      "overdue=1",
      "assignee_id=ME",
      "created_by=abc",
      "sort=due_date",
      "sort=-updated_at&cursor=" +
        Buffer.from(JSON.stringify(["2026-01-01T00:00:00Z", task.a])).toString(
          "base64url",
        ),
    ]) {
      const res = await handleListTasks(
        get(`/api/v1/projects/${project}/tasks?${qs}`),
        project,
        { session: sessionClient(jars.member) },
      );
      expect(res.status, qs).toBe(400);
    }
    // Người ngoài: 404 trước khi kiểm tham số.
    const out = await handleListTasks(
      get(`/api/v1/projects/${project}/tasks?assignee_id=me`),
      project,
      { session: sessionClient(jars.outsider) },
    );
    expect(out.status).toBe(404);
  });
});
