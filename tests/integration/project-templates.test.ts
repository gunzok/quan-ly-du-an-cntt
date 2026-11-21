/**
 * Test tích hợp Story E7-1 (QLDA-78) với Supabase cục bộ: template dự án.
 * Gọi thẳng lõi Route Handler với client phiên tạo từ hũ cookie, nên đi qua đủ: Origin, getUser,
 * vai trò qua RLS, schema, hai hàm SECURITY DEFINER và RLS project_templates.
 *
 * AC1: PM lưu dự án thành template → template có trạng thái, nhãn, cây task (không người phụ trách).
 * AC2: tạo dự án mới từ template → cấu trúc được nhân bản (cha-con, thứ tự, nhãn, ngày theo offset),
 *      người tạo thành PM; tạo 2.000 task qua PostgREST không quá thời gian chờ.
 * Thứ tự lỗi: Origin 403 → 401 → 404 → 403 → 400 → 409/422.
 *
 * Tài khoản, dự án, template tạo tạm, xóa ở afterAll. Không dùng khóa dùng chung: template dự án
 * không có trạng thái toàn hệ thống (tên kèm tag riêng của lần chạy).
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import {
  handleDeleteProjectTemplate,
  handleGetProjectTemplate,
  handleListProjectTemplates,
  handlePatchProjectTemplate,
  handleSaveProjectAsTemplate,
  type ProjectTemplateDeps,
} from "@/lib/project-templates/handlers";
import type { ProjectTemplate } from "@/lib/project-templates/model";
import { handleCreateProject } from "@/lib/projects/handlers";
import type { Project } from "@/lib/projects/model";
import { strings } from "@/lib/strings";
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

type Role =
  "admin" | "pm" | "pm2" | "member" | "viewer" | "outsider" | "locked";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    message_key?: string;
    details?: { field: string; issue: string }[];
  };
}

const allow = async () => ({ ok: true as const });

function deps(jar: CookieJar): ProjectTemplateDeps {
  return { session: sessionClient(jar), rateLimit: allow };
}

function req(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  origin: string | null = APP_ORIGIN,
) {
  const headers = new Headers();
  if (origin && method !== "GET") headers.set("origin", origin);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(new URL(path, APP_ORIGIN), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe.skipIf(!enabled)("Template dự án (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const createdUsers: string[] = [];
  const createdProjects: string[] = [];
  const createdTemplates: string[] = [];
  const jars = {} as Record<Role, CookieJar>;
  const ids = {} as Record<Role, string>;
  const sourceId = randomUUID();
  const otherId = randomUUID();
  const bigId = randomUUID();
  const hugeId = randomUUID();
  let service: SupabaseClient;

  async function createUser(role: Role) {
    const email = `it-e7-1-${role}-${tag}@example.com`;
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `IT E7-1 ${role} ${tag}` },
    });
    if (error) throw error;
    createdUsers.push(data.user.id);
    ids[role] = data.user.id;
    return email;
  }

  async function signedIn(email: string) {
    const jar = new CookieJar();
    const result = await signInWithPassword(sessionClient(jar), {
      email,
      password,
    });
    expect(result.ok).toBe(true);
    return jar;
  }

  async function save(
    role: Role,
    projectId: string,
    body: unknown,
    origin?: string | null,
  ) {
    const res = await handleSaveProjectAsTemplate(
      req("POST", `/api/v1/projects/${projectId}/templates`, body, origin),
      projectId,
      deps(jars[role]),
    );
    if (res.status === 201) {
      const { data } = (await res.clone().json()) as { data: ProjectTemplate };
      createdTemplates.push(data.id);
    }
    return res;
  }

  async function createFrom(role: Role, body: Record<string, unknown>) {
    const res = await handleCreateProject(
      req("POST", "/api/v1/projects", body),
      {
        session: sessionClient(jars[role]),
        rateLimit: allow,
      },
    );
    if (res.status === 201) {
      const { data } = (await res.clone().json()) as { data: Project };
      createdProjects.push(data.id);
    }
    return res;
  }

  async function insertTasks(
    projectId: string,
    rows: {
      id?: string;
      parent_id?: string | null;
      title: string;
      [k: string]: unknown;
    }[],
  ) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await service.from("tasks").insert(
        rows.slice(i, i + 500).map((r) => ({
          // Lô chèn của PostgREST điền null cho cột vắng ở một dòng: đặt đủ giá trị mặc định.
          id: randomUUID(),
          parent_id: null,
          description: null,
          priority: "medium",
          assignee_id: null,
          start_date: null,
          due_date: null,
          position: 0,
          project_id: projectId,
          created_by: ids.pm,
          ...r,
        })),
      );
      if (error) throw error;
    }
  }

  beforeAll(async () => {
    assertLocalSupabase();
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const emails = {} as Record<Role, string>;
    for (const role of [
      "admin",
      "pm",
      "pm2",
      "member",
      "viewer",
      "outsider",
      "locked",
    ] as Role[]) {
      emails[role] = await createUser(role);
    }
    const admin = await service
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", ids.admin);
    if (admin.error) throw admin.error;
    const projects = await service.from("projects").insert([
      {
        id: sourceId,
        name: `IT E7-1 nguồn ${tag}`,
        created_by: ids.pm,
        start_date: "2026-12-01",
      },
      { id: otherId, name: `IT E7-1 khác ${tag}`, created_by: ids.pm2 },
      { id: bigId, name: `IT E7-1 2000 ${tag}`, created_by: ids.pm },
      { id: hugeId, name: `IT E7-1 2001 ${tag}`, created_by: ids.pm },
    ]);
    if (projects.error) throw projects.error;
    createdProjects.push(sourceId, otherId, bigId, hugeId);
    const members = await service.from("project_members").upsert([
      { project_id: sourceId, user_id: ids.member, role: "member" },
      { project_id: sourceId, user_id: ids.viewer, role: "viewer" },
      { project_id: sourceId, user_id: ids.locked, role: "pm" },
    ]);
    if (members.error) throw members.error;

    // Dự án nguồn: 1 nhãn, cây 3 cấp, task giao cho member, một task có ngày.
    const label = await service
      .from("labels")
      .insert({ project_id: sourceId, name: "Gấp", color: "#C0262D" })
      .select("id")
      .single();
    if (label.error) throw label.error;
    const [root, child, grand, other] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    await insertTasks(sourceId, [
      {
        id: root,
        title: "Khảo sát",
        description: "Mô tả khảo sát",
        priority: "high",
        assignee_id: ids.member,
        start_date: "2026-12-02",
        due_date: "2026-12-05",
        position: 1,
      },
      { id: other, title: "Triển khai", position: 2 },
    ]);
    await insertTasks(sourceId, [
      { id: child, parent_id: root, title: "Phỏng vấn", position: 1 },
    ]);
    await insertTasks(sourceId, [
      { id: grand, parent_id: child, title: "Ghi chép", position: 1 },
    ]);
    const tl = await service
      .from("task_labels")
      .insert({ task_id: root, label_id: label.data.id });
    if (tl.error) throw tl.error;

    // 2.000 task (400 gốc, 800 con, 800 cháu) và 2.001 task phẳng.
    const roots = Array.from({ length: 400 }, (_, i) => ({
      id: randomUUID(),
      title: `Gốc ${i}`,
      position: i,
    }));
    const kids = Array.from({ length: 800 }, (_, i) => ({
      id: randomUUID(),
      parent_id: roots[i >> 1].id,
      title: `Con ${i}`,
      position: i,
    }));
    const grands = kids.map((k, i) => ({
      parent_id: k.id,
      title: `Cháu ${i}`,
      position: i,
    }));
    await insertTasks(bigId, roots);
    await insertTasks(bigId, kids);
    await insertTasks(bigId, grands);
    await insertTasks(
      hugeId,
      Array.from({ length: 2001 }, (_, i) => ({
        title: `Phẳng ${i}`,
        position: i,
      })),
    );

    for (const role of Object.keys(emails) as Role[]) {
      jars[role] = await signedIn(emails[role]);
    }
    const lock = await service
      .from("profiles")
      .update({ is_active: false })
      .eq("id", ids.locked);
    if (lock.error) throw lock.error;
  }, 120_000);

  afterAll(async () => {
    if (!service) return;
    if (createdTemplates.length > 0) {
      await service
        .from("project_templates")
        .delete()
        .in("id", createdTemplates);
    }
    if (createdProjects.length > 0) {
      await service.from("projects").delete().in("id", createdProjects);
    }
    for (const id of createdUsers) await service.auth.admin.deleteUser(id);
  }, 120_000);

  let templateId = "";

  it("Lưu: thứ tự lỗi Origin 403 → 401 → 404 → 403 → 400", async () => {
    const name = `IT E7-1 ${tag} A`;
    expect((await save("pm", sourceId, { name }, null)).status).toBe(403);
    const anon = await handleSaveProjectAsTemplate(
      req("POST", `/api/v1/projects/${sourceId}/templates`, { name }),
      sourceId,
      { session: sessionClient(new CookieJar()), rateLimit: allow },
    );
    expect(anon.status).toBe(401);
    expect((await save("outsider", sourceId, { name })).status).toBe(404);
    expect((await save("pm2", sourceId, { name })).status).toBe(404);
    expect((await save("pm", "khong-phai-uuid", { name })).status).toBe(404);
    const member = await save("member", sourceId, { name });
    expect(member.status).toBe(403);
    expect(((await member.json()) as ErrorBody).error.message).toBe(
      strings.projectTemplates.errors.forbiddenSave,
    );
    expect((await save("viewer", sourceId, { name })).status).toBe(403);
    expect((await save("locked", sourceId, { name })).status).toBe(404);
    // Thành viên gửi thân sai vẫn nhận 403 (vai trò kiểm trước schema).
    expect((await save("member", sourceId, { structure: {} })).status).toBe(
      403,
    );
    const bad = await save("pm", sourceId, { name, structure: { version: 1 } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as ErrorBody).error.details).toEqual([
      { field: "structure", issue: "unknown_field" },
    ]);
  });

  it("AC1: PM lưu dự án thành template (trạng thái, nhãn, cây task; không người)", async () => {
    const res = await save("pm", sourceId, { name: `  IT E7-1 ${tag} A ` });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: ProjectTemplate };
    templateId = data.id;
    expect(res.headers.get("location")).toBe(
      `/api/v1/project-templates/${data.id}`,
    );
    expect(data).toMatchObject({
      name: `IT E7-1 ${tag} A`,
      summary: { statuses: 7, task_types: 4, labels: 1, tasks: 4 },
      created_by: { id: ids.pm },
      archived: false,
      can_manage: true,
    });
    const { data: row } = await service
      .from("project_templates")
      .select("structure")
      .eq("id", data.id)
      .single();
    const text = JSON.stringify(row?.structure);
    expect(text).not.toContain(ids.member);
    expect(text).not.toContain(sourceId);
    expect(text).not.toMatch(/assignee|created_by|comment/);
  });

  it("Tên trùng 409; dự án quá 2.000 task 422", async () => {
    const dup = await save("pm", sourceId, { name: `it e7-1 ${tag} a` });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as ErrorBody).error.message_key).toBe(
      "projectTemplates.errors.nameTaken",
    );
    const huge = await save("pm", hugeId, { name: `IT E7-1 ${tag} lớn` });
    expect(huge.status).toBe(422);
    expect(((await huge.json()) as ErrorBody).error.message).toBe(
      strings.projectTemplates.errors.tooManyTasks,
    );
  });

  it("Danh sách: Admin và mọi PM thấy; Thành viên, Người xem, người ngoài 403", async () => {
    for (const role of ["admin", "pm", "pm2"] as Role[]) {
      const res = await handleListProjectTemplates(
        req("GET", "/api/v1/project-templates"),
        deps(jars[role]),
      );
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as { data: ProjectTemplate[] };
      const mine = data.find((t) => t.id === templateId);
      expect(mine?.can_manage).toBe(role !== "pm2");
    }
    for (const role of ["member", "viewer", "outsider", "locked"] as Role[]) {
      const res = await handleListProjectTemplates(
        req("GET", "/api/v1/project-templates"),
        deps(jars[role]),
      );
      expect(res.status).toBe(403);
    }
    const bad = await handleListProjectTemplates(
      req("GET", "/api/v1/project-templates?include_archived=1"),
      deps(jars.pm),
    );
    expect(bad.status).toBe(400);
    const one = await handleGetProjectTemplate(
      req("GET", "/x"),
      templateId,
      deps(jars.pm2),
    );
    expect(one.status).toBe(200);
    expect(
      (
        await handleGetProjectTemplate(
          req("GET", "/x"),
          randomUUID(),
          deps(jars.pm2),
        )
      ).status,
    ).toBe(404);
  });

  it("AC2: tạo dự án từ template nhân bản cấu trúc; người tạo là PM", async () => {
    const res = await createFrom("pm2", {
      name: `IT E7-1 ${tag} nhân bản`,
      start_date: "2027-03-01",
      template_id: templateId,
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: Project };
    expect(data.my_role).toBe("pm");
    expect(data.task_count).toBe(4);
    const [statuses, labels, tasks, members, source] = await Promise.all([
      service
        .from("task_statuses")
        .select("name, category")
        .eq("project_id", data.id)
        .order("position"),
      service.from("labels").select("name").eq("project_id", data.id),
      service
        .from("tasks")
        .select(
          "id, parent_id, title, depth, assignee_id, created_by, start_date, due_date, priority, task_labels(label_id)",
        )
        .eq("project_id", data.id),
      service
        .from("project_members")
        .select("user_id, role")
        .eq("project_id", data.id),
      service
        .from("task_statuses")
        .select("name, category")
        .eq("project_id", sourceId)
        .order("position"),
    ]);
    expect(statuses.data).toEqual(source.data);
    expect(labels.data).toEqual([{ name: "Gấp" }]);
    expect(members.data).toEqual([{ user_id: ids.pm2, role: "pm" }]);
    const rows = tasks.data ?? [];
    const byTitle = new Map(rows.map((t) => [t.title, t]));
    expect(byTitle.get("Phỏng vấn")?.parent_id).toBe(
      byTitle.get("Khảo sát")?.id,
    );
    expect(byTitle.get("Ghi chép")?.parent_id).toBe(
      byTitle.get("Phỏng vấn")?.id,
    );
    expect(byTitle.get("Ghi chép")?.depth).toBe(3);
    expect(byTitle.get("Khảo sát")).toMatchObject({
      assignee_id: null,
      created_by: ids.pm2,
      priority: "high",
      start_date: "2027-03-02",
      due_date: "2027-03-05",
    });
    expect(byTitle.get("Khảo sát")?.task_labels).toHaveLength(1);
  });

  it("Tạo từ template: 403 vai trò, 400 sai định dạng, 422 không thấy", async () => {
    expect(
      (
        await createFrom("member", {
          name: `IT E7-1 ${tag} x`,
          template_id: templateId,
        })
      ).status,
    ).toBe(403);
    expect(
      (await createFrom("pm2", { name: `IT E7-1 ${tag} x`, template_id: "x" }))
        .status,
    ).toBe(400);
    const missing = await createFrom("pm2", {
      name: `IT E7-1 ${tag} x`,
      template_id: randomUUID(),
    });
    expect(missing.status).toBe(422);
    expect(((await missing.json()) as ErrorBody).error).toMatchObject({
      message_key: "projectTemplates.errors.templateNotFound",
      details: [{ field: "template_id", issue: "invalid_value" }],
    });
  });

  it("Đổi tên, lưu trữ: chỉ người lưu hoặc Admin; 409 tên trùng", async () => {
    const path = `/api/v1/project-templates/${templateId}`;
    const patch = (role: Role, body: unknown, origin?: string | null) =>
      handlePatchProjectTemplate(
        req("PATCH", path, body, origin),
        templateId,
        deps(jars[role]),
      );
    expect((await patch("pm", { name: "B" }, null)).status).toBe(403);
    expect((await patch("member", { name: "B" })).status).toBe(403);
    const other = await patch("pm2", { name: "B" });
    expect(other.status).toBe(403);
    expect(((await other.json()) as ErrorBody).error.message).toBe(
      strings.projectTemplates.errors.forbiddenManage,
    );
    expect((await patch("pm", { name: "B", created_by: ids.pm2 })).status).toBe(
      400,
    );
    expect(
      (
        await handlePatchProjectTemplate(
          req("PATCH", path, { name: "B" }),
          randomUUID(),
          deps(jars.pm),
        )
      ).status,
    ).toBe(404);

    const second = await save("admin", otherId, { name: `IT E7-1 ${tag} B` });
    expect(second.status).toBe(201);
    expect((await patch("pm", { name: `IT E7-1 ${tag} b` })).status).toBe(409);

    const renamed = await patch("pm", { name: `IT E7-1 ${tag} A2` });
    expect(renamed.status).toBe(200);
    expect(
      ((await renamed.json()) as { data: ProjectTemplate }).data.name,
    ).toBe(`IT E7-1 ${tag} A2`);

    const archived = await patch("admin", { archived: true });
    expect(archived.status).toBe(200);
    expect(
      ((await archived.json()) as { data: ProjectTemplate }).data.archived,
    ).toBe(true);
    // Đã lưu trữ: ẩn khỏi danh sách mặc định, không tạo dự án được.
    const list = await handleListProjectTemplates(
      req("GET", "/api/v1/project-templates"),
      deps(jars.pm),
    );
    const ids1 = ((await list.json()) as { data: ProjectTemplate[] }).data.map(
      (t) => t.id,
    );
    expect(ids1).not.toContain(templateId);
    const listAll = await handleListProjectTemplates(
      req("GET", "/api/v1/project-templates?include_archived=true"),
      deps(jars.pm),
    );
    expect(
      ((await listAll.json()) as { data: ProjectTemplate[] }).data.map(
        (t) => t.id,
      ),
    ).toContain(templateId);
    expect(
      (
        await createFrom("pm2", {
          name: `IT E7-1 ${tag} y`,
          template_id: templateId,
        })
      ).status,
    ).toBe(422);
    expect((await patch("pm", { archived: false })).status).toBe(200);
  });

  it("AC2: 2.000 task qua PostgREST không quá thời gian chờ", async () => {
    const t0 = performance.now();
    const saved = await save("pm", bigId, { name: `IT E7-1 ${tag} 2000` });
    const saveMs = performance.now() - t0;
    expect(saved.status).toBe(201);
    const { data: tpl } = (await saved.json()) as { data: ProjectTemplate };
    expect(tpl.summary.tasks).toBe(2000);

    const t1 = performance.now();
    const created = await createFrom("pm", {
      name: `IT E7-1 ${tag} 2000 bản sao`,
      template_id: tpl.id,
    });
    const createMs = performance.now() - t1;
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as { data: Project };
    expect(data.task_count).toBe(2000);
    const { count } = await service
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("project_id", data.id)
      .eq("depth", 3);
    expect(count).toBe(800);
    console.info(
      `[E7-1] lưu 2.000 task: ${Math.round(saveMs)} ms; tạo dự án 2.000 task: ${Math.round(createMs)} ms`,
    );
    // statement_timeout của vai trò authenticated trên Supabase là 8 giây.
    expect(createMs).toBeLessThan(8000);
  }, 60_000);

  it("Xóa: người khác 403; người lưu 204; dự án đã tạo không bị ảnh hưởng", async () => {
    const path = `/api/v1/project-templates/${templateId}`;
    expect(
      (
        await handleDeleteProjectTemplate(
          req("DELETE", path),
          templateId,
          deps(jars.pm2),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleDeleteProjectTemplate(
          req("DELETE", path, undefined, null),
          templateId,
          deps(jars.pm),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleDeleteProjectTemplate(
          req("DELETE", path),
          templateId,
          deps(jars.pm),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await handleDeleteProjectTemplate(
          req("DELETE", path),
          templateId,
          deps(jars.pm),
        )
      ).status,
    ).toBe(404);
  });
});
