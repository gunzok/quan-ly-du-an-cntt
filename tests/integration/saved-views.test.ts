/**
 * Test tích hợp Story E13-1 (QLDA-53) với Supabase cục bộ: API chế độ xem đã lưu. Gọi thẳng lõi
 * Route Handler với client phiên tạo từ hũ cookie (giống trình duyệt): đi qua Origin, getUser,
 * vai trò qua RLS, schema, RLS và CHECK trong CSDL.
 *
 * AC1: bộ lọc đang bật → lưu → có chế độ xem riêng của tôi.
 * AC2 (BR-12): chế độ xem công khai, người khác mở → dùng bộ lọc của nó gọi GET danh sách task bằng
 * phiên của CHÍNH người đó → chỉ thấy task họ đủ quyền.
 *
 * Chạy: make db-start && make test-integration. Tài khoản và dự án tạo tạm, xóa ở afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { viewTaskListParams } from "@/lib/saved-views/apply";
import {
  handleCreateView,
  handleDeleteView,
  handleGetView,
  handleListViews,
  handlePatchView,
  type ViewDeps,
} from "@/lib/saved-views/handlers";
import {
  VIEW_COLUMNS,
  VIEW_DISPLAYS,
  VIEW_GROUP_BY,
  VIEW_SORT_FIELDS,
  type SavedView,
} from "@/lib/saved-views/model";
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
const t = strings.savedViews.errors;

let service: SupabaseClient;

function deps(jar: CookieJar): ViewDeps {
  return { session: sessionClient(jar) };
}

function get(path: string) {
  return new Request(new URL(path, APP_ORIGIN));
}

function send(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  origin: string | null = APP_ORIGIN,
) {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  if (origin) headers.set("origin", origin);
  return new Request(new URL(path, APP_ORIGIN), {
    method,
    headers,
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: { field: string; issue: string }[];
    request_id: string;
  };
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const body = await json<ErrorBody>(res);
  expect(body.error.code).toBe(code);
  expect(body.error.request_id.length).toBeGreaterThan(0);
  return body.error;
}

describe.skipIf(!enabled)("API chế độ xem đã lưu (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  let projectA: string;
  let projectB: string;
  let statusTodoA: string;
  let statusTodoB: string;
  const tasks: Record<string, string> = {};

  async function createUser(label: string) {
    const { data, error } = await service.auth.admin.createUser({
      email: `it-e13-1-${label}-${tag}@example.com`,
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
      email: `it-e13-1-${label}-${tag}@example.com`,
      password,
    });
    expect(result.ok).toBe(true);
    jars[label] = jar;
  }

  const list = (who: string, projectId = projectA, qs = "") =>
    handleListViews(
      get(`/api/v1/projects/${projectId}/views${qs}`),
      projectId,
      deps(jars[who]),
    );
  const create = (
    who: string,
    body: unknown,
    projectId = projectA,
    origin?: string | null,
  ) =>
    handleCreateView(
      send("POST", `/api/v1/projects/${projectId}/views`, body, origin),
      projectId,
      deps(jars[who]),
    );
  const getView = (who: string, id: string) =>
    handleGetView(get(`/api/v1/views/${id}`), id, deps(jars[who]));
  const patch = (
    who: string,
    id: string,
    body: unknown,
    origin?: string | null,
  ) =>
    handlePatchView(
      send("PATCH", `/api/v1/views/${id}`, body, origin),
      id,
      deps(jars[who]),
    );
  const remove = (who: string, id: string, origin?: string | null) =>
    handleDeleteView(
      send("DELETE", `/api/v1/views/${id}`, undefined, origin),
      id,
      deps(jars[who]),
    );

  async function createOk(who: string, body: unknown, projectId = projectA) {
    const res = await create(who, body, projectId);
    expect(res.status).toBe(201);
    return (await json<{ data: SavedView }>(res)).data;
  }

  async function names(who: string, projectId = projectA) {
    const res = await list(who, projectId);
    expect(res.status).toBe(200);
    return (await json<{ data: SavedView[] }>(res)).data.map((v) => v.name);
  }

  /** Mở chế độ xem bằng phiên của `who` rồi dùng bộ lọc của nó gọi GET danh sách task. */
  async function openAndList(who: string, viewId: string) {
    const res = await getView(who, viewId);
    if (res.status !== 200) return { status: res.status, ids: [] as string[] };
    const view = (await json<{ data: SavedView }>(res)).data;
    const projectId = view.project_id ?? projectA;
    const qs = viewTaskListParams(view.query.filters).toString();
    const tasksRes = await handleListTasks(
      get(`/api/v1/projects/${projectId}/tasks?${qs}`),
      projectId,
      { session: sessionClient(jars[who]) },
    );
    if (tasksRes.status !== 200) {
      return { status: tasksRes.status, ids: [] as string[] };
    }
    const body = await json<TaskListResponse>(tasksRes);
    return { status: 200, ids: body.data.map((x) => x.id).sort() };
  }

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
      "leaver",
      "outsider",
      "locked",
    ]) {
      await createUser(label);
    }
    const { error: adminError } = await service
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", users.admin);
    if (adminError) throw adminError;

    projectA = randomUUID();
    projectB = randomUUID();
    const projects = await service.from("projects").insert([
      { id: projectA, name: `IT E13-1 A ${tag}`, created_by: users.pm },
      { id: projectB, name: `IT E13-1 B ${tag}`, created_by: users.outsider },
    ]);
    if (projects.error) throw projects.error;
    const members = await service.from("project_members").insert([
      { project_id: projectA, user_id: users.member, role: "member" },
      { project_id: projectA, user_id: users.viewer, role: "viewer" },
      { project_id: projectA, user_id: users.leaver, role: "member" },
      { project_id: projectA, user_id: users.locked, role: "member" },
    ]);
    if (members.error) throw members.error;

    const statuses = await service
      .from("task_statuses")
      .select("id, project_id, position")
      .in("project_id", [projectA, projectB])
      .eq("category", "todo")
      .order("position");
    if (statuses.error) throw statuses.error;
    statusTodoA = statuses.data.find((s) => s.project_id === projectA)!.id;
    statusTodoB = statuses.data.find((s) => s.project_id === projectB)!.id;

    const rows = [
      { key: "a_high", project_id: projectA, priority: "high" },
      { key: "a_high2", project_id: projectA, priority: "high" },
      { key: "a_low", project_id: projectA, priority: "low" },
      { key: "b_high", project_id: projectB, priority: "high" },
    ];
    for (const r of rows) {
      const id = randomUUID();
      const { error } = await service.from("tasks").insert({
        id,
        project_id: r.project_id,
        priority: r.priority,
        title: `IT E13-1 ${r.key} ${tag}`,
        created_by: r.project_id === projectA ? users.pm : users.outsider,
      });
      if (error) throw error;
      tasks[r.key] = id;
    }

    for (const label of Object.keys(users)) await signIn(label);
    const { error: lockError } = await service
      .from("profiles")
      .update({ is_active: false })
      .eq("id", users.locked);
    if (lockError) throw lockError;
  });

  afterAll(async () => {
    if (!service) return;
    for (const id of [projectA, projectB]) {
      if (id) await service.from("projects").delete().eq("id", id);
    }
    for (const id of created) await service.auth.admin.deleteUser(id);
  });

  it("chưa đăng nhập: 401 ở mọi endpoint", async () => {
    jars.anon = new CookieJar();
    const id = randomUUID();
    for (const res of [
      await list("anon"),
      await create("anon", { name: "x", query: {} }),
      await getView("anon", id),
      await patch("anon", id, { name: "x" }),
      await remove("anon", id),
    ]) {
      const error = await expectError(res, 401, "unauthenticated");
      expect(error.message).toBe(strings.api.unauthenticated);
    }
  });

  it("Origin lạ: 403 trước mọi kiểm khác", async () => {
    const id = randomUUID();
    await expectError(
      await create(
        "pm",
        { name: "x", query: {} },
        projectA,
        "https://evil.example",
      ),
      403,
      "forbidden",
    );
    await expectError(
      await patch("pm", id, { name: "x" }, "https://evil.example"),
      403,
      "forbidden",
    );
    await expectError(
      await remove("pm", id, "https://evil.example"),
      403,
      "forbidden",
    );
  });

  it("AC1: bộ lọc đang bật, lưu → có chế độ xem riêng của tôi", async () => {
    const res = await create("member", {
      name: "  Việc ưu tiên   cao ",
      query: {
        filters: {
          priority: "high",
          status_id: [statusTodoA.toUpperCase()],
          q: "  IT  ",
        },
        sort: [{ field: "due_date", direction: "asc" }],
        group_by: "assignee_id",
        columns: ["title", "priority", "due_date"],
        display: "board",
      },
    });
    expect(res.status).toBe(201);
    const view = (await json<{ data: SavedView }>(res)).data;
    expect(res.headers.get("location")).toBe(`/api/v1/views/${view.id}`);
    expect(view).toMatchObject({
      project_id: projectA,
      owner_id: users.member,
      name: "Việc ưu tiên cao",
      visibility: "private",
      is_default: false,
      is_favorite: false,
      can_edit: true,
    });
    // Chuẩn hóa: đủ 6 khóa, uuid chữ thường, q đã cắt.
    expect(view.query).toEqual({
      version: 1,
      filters: { priority: "high", status_id: [statusTodoA], q: "IT" },
      sort: [{ field: "due_date", direction: "asc" }],
      group_by: "assignee_id",
      columns: ["title", "priority", "due_date"],
      display: "board",
    });

    expect(await names("member")).toContain("Việc ưu tiên cao");
    // Riêng tư: chỉ chủ sở hữu thấy; người khác (kể cả PM, Admin) nhận 404, không lộ sự tồn tại.
    for (const who of ["pm", "viewer", "admin"]) {
      expect(await names(who)).not.toContain("Việc ưu tiên cao");
      await expectError(await getView(who, view.id), 404, "not_found");
      await expectError(
        await patch(who, view.id, { is_favorite: true }),
        404,
        "not_found",
      );
    }
    expect((await getView("member", view.id)).status).toBe(200);

    // Dùng lại: áp bộ lọc vào danh sách task bằng phiên của chủ sở hữu.
    const used = await openAndList("member", view.id);
    expect(used).toEqual({
      status: 200,
      ids: [tasks.a_high, tasks.a_high2].sort(),
    });
  });

  it("AC2 (BR-12): người khác mở chế độ xem công khai chỉ thấy task họ đủ quyền", async () => {
    const pub = await createOk("pm", {
      name: "Ưu tiên cao (công khai)",
      visibility: "public",
      query: { filters: { priority: "high" } },
    });
    expect(pub.can_edit).toBe(true);
    // Chế độ xem chỉ lưu cách xem: không có danh sách task nào trong dữ liệu trả về.
    expect(Object.keys(pub.query).sort()).toEqual(
      ["columns", "display", "filters", "group_by", "sort", "version"].sort(),
    );
    expect(JSON.stringify(pub)).not.toContain(tasks.a_high);

    const expected = [tasks.a_high, tasks.a_high2].sort();
    // Mọi vai trò trong dự án và Admin: thấy đúng task RLS cho họ đọc (task dự án B không lọt vào
    // dù cũng ưu tiên cao).
    for (const who of ["pm", "member", "viewer", "admin"]) {
      expect(await openAndList(who, pub.id)).toEqual({
        status: 200,
        ids: expected,
      });
    }
    // Thành viên, Người xem thấy chế độ xem nhưng không sửa được.
    const asViewer = (
      await json<{ data: SavedView }>(await getView("viewer", pub.id))
    ).data;
    expect(asViewer.can_edit).toBe(false);

    // Người ngoài, người bị khóa: không mở được chế độ xem, cũng không đọc được task.
    for (const who of ["outsider", "locked"]) {
      expect(await openAndList(who, pub.id)).toEqual({ status: 404, ids: [] });
      await expectError(await list(who), 404, "not_found");
    }

    // Người vừa bị gỡ khỏi dự án: mất quyền ngay, dù trước đó mở được.
    expect((await openAndList("leaver", pub.id)).status).toBe(200);
    const { error } = await service
      .from("project_members")
      .delete()
      .eq("project_id", projectA)
      .eq("user_id", users.leaver);
    if (error) throw error;
    expect(await openAndList("leaver", pub.id)).toEqual({
      status: 404,
      ids: [],
    });
  });

  it("AC2: id trạng thái của dự án khác trong bộ lọc chỉ cho kết quả rỗng (kiểm lúc dùng)", async () => {
    // Lưu chỉ kiểm định dạng uuid; trạng thái thuộc dự án B vẫn lưu được.
    const view = await createOk("pm", {
      name: "Trạng thái của dự án khác",
      visibility: "public",
      query: { filters: { status_id: [statusTodoB] } },
    });
    expect(await openAndList("member", view.id)).toEqual({
      status: 200,
      ids: [],
    });
  });

  it("tạo: riêng tư cho mọi vai trò; công khai chỉ PM và Admin", async () => {
    await createOk("viewer", { name: "Của người xem", query: {} });
    await createOk("admin", {
      name: "Công khai của Admin",
      query: {},
      visibility: "public",
    });
    for (const who of ["member", "viewer"]) {
      const error = await expectError(
        await create(who, { name: "x", query: {}, visibility: "public" }),
        403,
        "forbidden",
      );
      expect(error.message).toBe(t.publicForbidden);
    }
    // Vai trò 403 đứng trước schema 400.
    await expectError(
      await create("member", { visibility: "public", extra: 1 }),
      403,
      "forbidden",
    );
    for (const who of ["outsider", "locked"]) {
      await expectError(
        await create(who, { name: "x", query: {} }),
        404,
        "not_found",
      );
    }
    await expectError(
      await create("pm", { name: "x", query: {} }, "not-a-uuid"),
      404,
      "not_found",
    );
    const listing = await names("viewer");
    expect(listing).toContain("Công khai của Admin");
    expect(listing).toContain("Của người xem");
  });

  it("sửa: chủ sở hữu (riêng tư), PM và Admin (công khai); Thành viên bị từ chối", async () => {
    const mine = await createOk("member", { name: "Của tôi", query: {} });
    const renamed = await patch("member", mine.id, {
      name: "Của tôi (đổi)",
      query: { display: "gantt" },
    });
    expect(renamed.status).toBe(200);
    const data = (await json<{ data: SavedView }>(renamed)).data;
    expect(data.name).toBe("Của tôi (đổi)");
    expect(data.query.display).toBe("gantt");

    // Thành viên tự công khai: 403.
    const error = await expectError(
      await patch("member", mine.id, { visibility: "public" }),
      403,
      "forbidden",
    );
    expect(error.message).toBe(t.publicForbidden);

    const pmPublic = await createOk("pm", {
      name: "Công khai của PM",
      visibility: "public",
      query: {},
    });
    // E13-3 AC2 (làm sẵn ở tầng API): Thành viên sửa chế độ xem công khai của PM bị từ chối.
    for (const body of [
      { name: "x" },
      { query: {} },
      { visibility: "private" },
    ]) {
      const e = await expectError(
        await patch("member", pmPublic.id, body),
        403,
        "forbidden",
      );
      expect(e.message).toBe(t.publicForbidden);
    }
    await expectError(await remove("member", pmPublic.id), 403, "forbidden");
    await expectError(await remove("viewer", pmPublic.id), 403, "forbidden");

    // Admin sửa công khai của PM; PM sửa công khai của Admin.
    expect(
      (await patch("admin", pmPublic.id, { name: "Đổi bởi Admin" })).status,
    ).toBe(200);
    const adminPublic = await createOk("admin", {
      name: "Công khai khác của Admin",
      visibility: "public",
      query: {},
    });
    expect(
      (await patch("pm", adminPublic.id, { query: { display: "board" } }))
        .status,
    ).toBe(200);

    // Không ai biến chế độ xem công khai của người khác thành riêng tư.
    const e2 = await expectError(
      await patch("pm", adminPublic.id, { visibility: "private" }),
      403,
      "forbidden",
    );
    expect(e2.message).toBe(t.privatizeForbidden);
    // Chủ sở hữu thì được: đổi về riêng tư rồi công khai lại.
    const priv = await patch("admin", adminPublic.id, {
      visibility: "private",
    });
    expect(priv.status).toBe(200);
    expect((await json<{ data: SavedView }>(priv)).data.visibility).toBe(
      "private",
    );
    await expectError(await getView("pm", adminPublic.id), 404, "not_found");
    expect(
      (await patch("admin", adminPublic.id, { visibility: "public" })).status,
    ).toBe(200);
    expect((await getView("pm", adminPublic.id)).status).toBe(200);
  });

  it("yêu thích là của riêng từng người, kể cả với chế độ xem công khai", async () => {
    const pub = await createOk("pm", {
      name: "Để yêu thích",
      visibility: "public",
      query: {},
    });
    const fav = await patch("viewer", pub.id, { is_favorite: true });
    expect(fav.status).toBe(200);
    expect((await json<{ data: SavedView }>(fav)).data.is_favorite).toBe(true);
    // Gửi lại: vẫn 200 (đã yêu thích).
    expect((await patch("viewer", pub.id, { is_favorite: true })).status).toBe(
      200,
    );

    const of = async (who: string) => {
      const res = await list(who);
      const views = (await json<{ data: SavedView[] }>(res)).data;
      return views.find((v) => v.id === pub.id)?.is_favorite;
    };
    expect(await of("viewer")).toBe(true);
    expect(await of("member")).toBe(false);
    expect(await of("pm")).toBe(false);

    // Kèm sửa tên thì cần quyền sửa: Người xem bị 403, không đổi gì (kể cả dấu yêu thích).
    await expectError(
      await patch("viewer", pub.id, { is_favorite: false, name: "x" }),
      403,
      "forbidden",
    );
    expect(await of("viewer")).toBe(true);
    const unfav = await patch("viewer", pub.id, { is_favorite: false });
    expect((await json<{ data: SavedView }>(unfav)).data.is_favorite).toBe(
      false,
    );
    expect(await of("viewer")).toBe(false);
  });

  it("chế độ xem mặc định: đọc, yêu thích được; sửa, xóa bị từ chối (cơ chế cho E13-2)", async () => {
    const { data, error } = await service
      .from("saved_views")
      .insert({
        project_id: projectA,
        owner_id: null,
        name: `Mặc định ${tag}`,
        query: {
          version: 1,
          filters: {},
          sort: [],
          group_by: null,
          columns: ["title"],
          display: "list",
        },
        visibility: "public",
        is_default: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    const id = data.id as string;

    const res = await list("viewer");
    const views = (await json<{ data: SavedView[] }>(res)).data;
    expect(views[0]).toMatchObject({ id, is_default: true, can_edit: false });

    for (const who of ["pm", "admin"]) {
      const e = await expectError(
        await patch(who, id, { name: "Đổi" }),
        403,
        "forbidden",
      );
      expect(e.message).toBe(t.defaultReadOnly);
      const d = await expectError(await remove(who, id), 403, "forbidden");
      expect(d.message).toBe(t.defaultReadOnly);
    }
    expect((await patch("member", id, { is_favorite: true })).status).toBe(200);
    expect((await getView("member", id)).status).toBe(200);
  });

  it("ca biên: tên trùng, tên quá dài, query lạ, trường lạ, thân quá lớn, tham số lạ", async () => {
    await createOk("member", { name: "Trùng tên", query: {} });
    const dup = await expectError(
      await create("member", { name: "  TRÙNG   TÊN ", query: {} }),
      409,
      "conflict",
    );
    expect(dup.message).toBe(t.nameExists);
    // Người khác dùng cùng tên: được.
    await createOk("viewer", { name: "Trùng tên", query: {} });

    const long = await expectError(
      await create("member", { name: "a".repeat(101), query: {} }),
      400,
      "validation_failed",
    );
    expect(long.details).toContainEqual({ field: "name", issue: "too_long" });
    await createOk("member", { name: "ă".repeat(100), query: {} });

    const bad = await expectError(
      await create("member", {
        name: "Lạ",
        query: { filters: { limit: "5", priority: "x" }, extra: true },
      }),
      400,
      "validation_failed",
    );
    expect(bad.details).toEqual(
      expect.arrayContaining([
        { field: "query.extra", issue: "unknown_field" },
        { field: "query.filters.limit", issue: "unknown_field" },
      ]),
    );
    const badValue = await expectError(
      await create("member", {
        name: "Lạ 2",
        query: { filters: { due_after: "2026-02-30" } },
      }),
      400,
      "validation_failed",
    );
    expect(badValue.details).toEqual([
      { field: "query.filters.due_after", issue: "invalid_format" },
    ]);
    for (const extra of [
      { owner_id: users.viewer },
      { is_default: true },
      { project_id: projectB },
    ]) {
      await expectError(
        await create("member", { name: "x", query: {}, ...extra }),
        400,
        "validation_failed",
      );
    }
    const mine = await createOk("member", { name: "Để sửa", query: {} });
    await expectError(
      await patch("member", mine.id, { project_id: projectB }),
      400,
      "validation_failed",
    );
    await expectError(
      await patch("member", mine.id, {}),
      400,
      "validation_failed",
    );
    await expectError(
      await patch("member", mine.id, { name: "Trùng tên" }),
      409,
      "conflict",
    );
    await expectError(
      await create(
        "member",
        `{"name":"x","query":{"filters":{"q":"${"a".repeat(9000)}"}}}`,
      ),
      400,
      "validation_failed",
    );
    await expectError(
      await create("member", "{không phải json"),
      400,
      "validation_failed",
    );
    await expectError(
      await list("member", projectA, "?x=1"),
      400,
      "validation_failed",
    );
    await expectError(await getView("member", "not-a-uuid"), 404, "not_found");
    await expectError(await getView("member", randomUUID()), 404, "not_found");
  });

  it("mọi giá trị cột, sắp xếp, nhóm, kiểu hiển thị của API đều được CSDL nhận (khớp CHECK)", async () => {
    await createOk("pm", {
      name: "Đủ cột",
      query: {
        columns: [...VIEW_COLUMNS],
        filters: {
          q: "x",
          status_id: [statusTodoA],
          assignee_id: users.member,
          priority: "urgent",
          label_id: randomUUID(),
          due_after: "2026-01-01",
          due_before: "2026-12-31",
        },
      },
    });
    for (let i = 0; i < VIEW_SORT_FIELDS.length; i += 3) {
      await createOk("pm", {
        name: `Sắp xếp ${i}`,
        query: {
          sort: VIEW_SORT_FIELDS.slice(i, i + 3).map((field) => ({
            field,
            direction: "desc",
          })),
        },
      });
    }
    for (const group_by of VIEW_GROUP_BY) {
      await createOk("pm", { name: `Nhóm ${group_by}`, query: { group_by } });
    }
    for (const display of VIEW_DISPLAYS) {
      await createOk("pm", { name: `Hiển thị ${display}`, query: { display } });
    }
  });

  it("xóa: 204 rồi 404; xóa dự án xóa theo chế độ xem và dấu yêu thích", async () => {
    const mine = await createOk("member", { name: "Sẽ xóa", query: {} });
    const res = await remove("member", mine.id);
    expect(res.status).toBe(204);
    await expectError(await getView("member", mine.id), 404, "not_found");
    await expectError(await remove("member", mine.id), 404, "not_found");

    const temp = randomUUID();
    const { error } = await service
      .from("projects")
      .insert({ id: temp, name: `IT E13-1 tạm ${tag}`, created_by: users.pm });
    if (error) throw error;
    const view = await createOk(
      "pm",
      { name: "Trong dự án tạm", visibility: "public", query: {} },
      temp,
    );
    expect((await patch("pm", view.id, { is_favorite: true })).status).toBe(
      200,
    );
    await service.from("projects").delete().eq("id", temp);
    const left = await service
      .from("saved_views")
      .select("id")
      .eq("id", view.id);
    expect(left.data).toEqual([]);
    const favs = await service
      .from("saved_view_favorites")
      .select("view_id")
      .eq("view_id", view.id);
    expect(favs.data).toEqual([]);
  });
});
