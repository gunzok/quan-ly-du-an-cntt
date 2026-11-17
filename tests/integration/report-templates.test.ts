/**
 * Test tích hợp Story E5-2 (QLDA-61) với Supabase cục bộ (cần dịch vụ Storage): template báo cáo
 * /api/v1/report-templates. Gọi thẳng lõi Route Handler với client phiên tạo từ hũ cookie, nên đi
 * qua đủ: Origin, getUser, vai trò qua RLS, schema, kiểm tệp, RLS report_templates và storage.objects.
 *
 * AC1: Admin tải template hợp lệ → lưu ở Storage (bucket riêng tư) và dùng được (tải về đúng byte,
 *      PM đọc được, bật làm template đang dùng).
 * AC2: sai loại, sai MIME, sai chữ ký, quá lớn, macro, ZIP bomb, tên độc hại → bị từ chối, không để
 *      lại dòng hay tệp nào.
 *
 * Tệp là tệp GIẢ sinh trong tests/fixtures/ooxml.ts (R-005). Tài khoản, dự án, template tạo tạm,
 * xóa ở afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import {
  handleDeleteReportTemplate,
  handleDownloadReportTemplate,
  handleListReportTemplates,
  handlePatchReportTemplate,
  handleUploadReportTemplate,
  type ReportTemplateDeps,
} from "@/lib/report-templates/handlers";
import {
  REPORT_TEMPLATE_BUCKET,
  REPORT_TEMPLATE_MAX_BYTES,
  type ReportTemplate,
} from "@/lib/report-templates/model";
import { strings } from "@/lib/strings";
import {
  buildZip,
  docxEntries,
  DOCX_MIME,
  hiddenMacroXlsx,
  macroDocx,
  sampleDocx,
  sampleXlsx,
  XLSX_MIME,
  zipBombDocx,
} from "@/tests/fixtures/ooxml";
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

type Role = "admin" | "pm" | "member" | "viewer" | "outsider" | "locked";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    message_key?: string;
    details?: { field: string; issue: string }[];
  };
}

function deps(jar: CookieJar): ReportTemplateDeps {
  return { session: sessionClient(jar) };
}

const BASE = "/api/v1/report-templates";

function uploadRequest(
  parts: {
    file?: { data: Buffer; name: string; type?: string };
    name?: string;
    extra?: Record<string, string>;
  },
  origin: string | null = APP_ORIGIN,
) {
  const form = new FormData();
  if (parts.file) {
    form.set(
      "file",
      new File([new Uint8Array(parts.file.data)], parts.file.name, {
        type: parts.file.type ?? "",
      }),
    );
  }
  if (parts.name !== undefined) form.set("name", parts.name);
  for (const [k, v] of Object.entries(parts.extra ?? {})) form.set(k, v);
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return new Request(new URL(BASE, APP_ORIGIN), {
    method: "POST",
    headers,
    body: form,
  });
}

function jsonRequest(method: "PATCH" | "DELETE", path: string, body?: unknown) {
  const headers = new Headers({ origin: APP_ORIGIN });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(new URL(path, APP_ORIGIN), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe.skipIf(!enabled)("Template báo cáo (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const createdUsers: string[] = [];
  const createdTemplates: string[] = [];
  const jars = {} as Record<Role, CookieJar>;
  const ids = {} as Record<Role, string>;
  const projectId = randomUUID();

  async function createUser(role: Role) {
    const email = `it-e5-2-${role}-${tag}@example.com`;
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `IT E5-2 ${role} ${tag}` },
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

  async function upload(
    role: Role,
    file: { data: Buffer; name: string; type?: string },
    name?: string,
  ) {
    const res = await handleUploadReportTemplate(
      uploadRequest({ file, name }),
      deps(jars[role]),
    );
    if (res.status === 201) {
      const { data } = (await res.clone().json()) as { data: ReportTemplate };
      createdTemplates.push(data.id);
    }
    return res;
  }

  async function list(role: Role) {
    return handleListReportTemplates(
      new Request(new URL(BASE, APP_ORIGIN)),
      deps(jars[role]),
    );
  }

  async function mine(): Promise<ReportTemplate[]> {
    const res = await list("admin");
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: ReportTemplate[] };
    return data.filter((t) => createdTemplates.includes(t.id));
  }

  async function storedObjects(): Promise<string[]> {
    const { data, error } = await service
      .schema("storage" as never)
      .from("objects")
      .select("name")
      .eq("bucket_id", REPORT_TEMPLATE_BUCKET);
    if (error) {
      // Schema storage không phơi qua PostgREST: dùng API Storage liệt kê hai thư mục.
      const names: string[] = [];
      for (const dir of ["xlsx", "docx"]) {
        const r = await service.storage
          .from(REPORT_TEMPLATE_BUCKET)
          .list(dir, { limit: 1000 });
        if (r.error) throw r.error;
        names.push(...(r.data ?? []).map((o) => `${dir}/${o.name}`));
      }
      return names;
    }
    return ((data ?? []) as { name: string }[]).map((o) => o.name);
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
    const project = await service
      .from("projects")
      .insert({ id: projectId, name: `IT E5-2 ${tag}`, created_by: ids.pm });
    if (project.error) throw project.error;
    // created_by tự thành PM (trigger); thêm các vai trò còn lại. 'locked' là PM rồi bị khóa.
    const members = await service.from("project_members").upsert([
      { project_id: projectId, user_id: ids.pm, role: "pm" },
      { project_id: projectId, user_id: ids.member, role: "member" },
      { project_id: projectId, user_id: ids.viewer, role: "viewer" },
      { project_id: projectId, user_id: ids.locked, role: "pm" },
    ]);
    if (members.error) throw members.error;
    for (const role of Object.keys(emails) as Role[]) {
      jars[role] = await signedIn(emails[role]);
    }
    const lock = await service
      .from("profiles")
      .update({ is_active: false })
      .eq("id", ids.locked);
    if (lock.error) throw lock.error;
  });

  afterAll(async () => {
    if (!service) return;
    if (createdTemplates.length > 0) {
      const { data } = await service
        .from("report_templates")
        .select("storage_path")
        .in("id", createdTemplates);
      const paths = ((data ?? []) as { storage_path: string }[]).map(
        (r) => r.storage_path,
      );
      if (paths.length > 0)
        await service.storage.from(REPORT_TEMPLATE_BUCKET).remove(paths);
      await service
        .from("report_templates")
        .delete()
        .in("id", createdTemplates);
    }
    await service.from("projects").delete().eq("id", projectId);
    for (const id of createdUsers) await service.auth.admin.deleteUser(id);
  });

  it("AC1: Admin tải xlsx hợp lệ → lưu ở Storage riêng tư, tải về đúng byte", async () => {
    const bytes = sampleXlsx();
    const res = await upload("admin", {
      data: bytes,
      name: "Báo cáo tuần.xlsx",
      type: XLSX_MIME,
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: ReportTemplate };
    expect(res.headers.get("location")).toBe(`${BASE}/${data.id}`);
    expect(data).toMatchObject({
      kind: "xlsx",
      name: "Báo cáo tuần",
      size_bytes: bytes.length,
      uploaded_by: { id: ids.admin },
    });
    expect(data).not.toHaveProperty("storage_path");

    // Đường dẫn do máy chủ sinh, không chứa tên tệp người dùng.
    const { data: row } = await service
      .from("report_templates")
      .select("storage_path")
      .eq("id", data.id)
      .single();
    expect(row?.storage_path).toBe(`xlsx/${data.id}.xlsx`);
    expect(await storedObjects()).toContain(`xlsx/${data.id}.xlsx`);

    // Bucket riêng tư: URL công khai không đọc được.
    const publicUrl = service.storage
      .from(REPORT_TEMPLATE_BUCKET)
      .getPublicUrl(row!.storage_path).data.publicUrl;
    expect((await fetch(publicUrl)).ok).toBe(false);

    // Admin và PM tải về đúng byte.
    for (const role of ["admin", "pm"] as Role[]) {
      const dl = await handleDownloadReportTemplate(
        new Request(new URL(`${BASE}/${data.id}/file`, APP_ORIGIN)),
        data.id,
        deps(jars[role]),
      );
      expect(dl.status).toBe(200);
      expect(dl.headers.get("content-type")).toBe(XLSX_MIME);
      expect(dl.headers.get("content-disposition")).toContain("attachment;");
      expect(Buffer.from(await dl.arrayBuffer()).equals(bytes)).toBe(true);
    }
  });

  it("AC1: docx hợp lệ với tên hiển thị riêng; bật một template tự tắt template cùng định dạng", async () => {
    const a = await upload(
      "admin",
      { data: sampleDocx(), name: "mau-a.docx", type: DOCX_MIME },
      "  Mẫu   A ",
    );
    expect(a.status).toBe(201);
    const ta = ((await a.json()) as { data: ReportTemplate }).data;
    expect(ta.name).toBe("Mẫu A");
    const b = await upload("admin", {
      data: sampleDocx(),
      name: "mau-b.docx",
      type: "",
    });
    expect(b.status).toBe(201);
    const tb = ((await b.json()) as { data: ReportTemplate }).data;

    let res = await handlePatchReportTemplate(
      jsonRequest("PATCH", `${BASE}/${ta.id}`, { is_active: true }),
      ta.id,
      deps(jars.admin),
    );
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { data: ReportTemplate }).data.is_active,
    ).toBe(true);

    res = await handlePatchReportTemplate(
      jsonRequest("PATCH", `${BASE}/${tb.id}`, {
        is_active: true,
        name: "Mẫu B mới",
      }),
      tb.id,
      deps(jars.admin),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: ReportTemplate }).data).toMatchObject(
      {
        is_active: true,
        name: "Mẫu B mới",
      },
    );
    const now = await mine();
    expect(now.find((t) => t.id === ta.id)?.is_active).toBe(false);
    expect(now.find((t) => t.id === tb.id)?.is_active).toBe(true);
    // Template xlsx không bị ảnh hưởng.
    const { count } = await service
      .from("report_templates")
      .select("id", { count: "exact", head: true })
      .eq("kind", "docx")
      .eq("is_active", true);
    expect(count).toBe(1);

    res = await handlePatchReportTemplate(
      jsonRequest("PATCH", `${BASE}/${tb.id}`, { is_active: false }),
      tb.id,
      deps(jars.admin),
    );
    expect(
      ((await res.json()) as { data: ReportTemplate }).data.is_active,
    ).toBe(false);
  });

  it.each([
    [
      "sai đuôi (.pdf)",
      { data: sampleDocx(), name: "bao-cao.pdf", type: "application/pdf" },
      422,
      "unsupportedType",
    ],
    [
      "đuôi macro .xlsm",
      { data: sampleXlsx(), name: "bao-cao.xlsm" },
      422,
      "unsupportedType",
    ],
    [
      "đuôi macro .docm",
      { data: macroDocx(), name: "bao-cao.docm" },
      422,
      "unsupportedType",
    ],
    [
      "MIME không khớp đuôi",
      { data: sampleDocx(), name: "bao-cao.docx", type: "text/html" },
      422,
      "mimeMismatch",
    ],
    [
      "sai chữ ký (PDF đổi đuôi)",
      {
        data: Buffer.from("%PDF-1.7\n giả"),
        name: "bao-cao.docx",
        type: DOCX_MIME,
      },
      422,
      "invalidFile",
    ],
    [
      "xlsx đổi đuôi thành docx",
      { data: sampleXlsx(), name: "bao-cao.docx", type: DOCX_MIME },
      422,
      "invalidFile",
    ],
    [
      "docx có macro đổi đuôi",
      { data: macroDocx(), name: "bao-cao.docx", type: DOCX_MIME },
      422,
      "macro",
    ],
    [
      "xlsx có vbaProject.bin ẩn",
      { data: hiddenMacroXlsx(), name: "bao-cao.xlsx", type: XLSX_MIME },
      422,
      "macro",
    ],
    [
      "ZIP bomb",
      { data: zipBombDocx(), name: "bao-cao.docx", type: DOCX_MIME },
      422,
      "zipBomb",
    ],
    [
      "quá lớn",
      {
        data: buildZip([
          ...docxEntries(),
          {
            name: "word/media/big.bin",
            data: Buffer.alloc(REPORT_TEMPLATE_MAX_BYTES),
            store: true,
          },
        ]),
        name: "bao-cao.docx",
        type: DOCX_MIME,
      },
      413,
      "tooLarge",
    ],
    [
      "tên trèo thư mục",
      { data: sampleDocx(), name: "../../etc/passwd.docx", type: DOCX_MIME },
      400,
      "invalidName",
    ],
    [
      "tên có ký tự định hướng giả đuôi",
      { data: sampleDocx(), name: "hoa-don‮xcod.exe.docx", type: DOCX_MIME },
      400,
      "invalidName",
    ],
  ] as const)("AC2: từ chối %s", async (_label, file, status, key) => {
    const before = await storedObjects();
    const res = await upload("admin", { ...file, data: file.data as Buffer });
    expect(res.status).toBe(status);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).toBe(strings.reportTemplates.errors[key]);
    expect(body.error.message_key).toBe(`reportTemplates.errors.${key}`);
    expect((await storedObjects()).length).toBe(before.length);
  });

  it("AC2: thiếu tệp, trường lạ, không phải multipart: 400", async () => {
    let res = await handleUploadReportTemplate(
      uploadRequest({}),
      deps(jars.admin),
    );
    expect(res.status).toBe(400);
    res = await handleUploadReportTemplate(
      uploadRequest({
        file: { data: sampleDocx(), name: "a.docx" },
        extra: { storage_path: "docx/x.docx" },
      }),
      deps(jars.admin),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.details).toEqual([
      { field: "storage_path", issue: "unknown_field" },
    ]);
    res = await handleUploadReportTemplate(
      new Request(new URL(BASE, APP_ORIGIN), {
        method: "POST",
        headers: { origin: APP_ORIGIN, "content-type": "application/json" },
        body: "{}",
      }),
      deps(jars.admin),
    );
    expect(res.status).toBe(400);
  });

  it("Thứ tự lỗi: Origin lạ 403 trước phiên; chưa đăng nhập 401; không phải Admin 403", async () => {
    const file = { data: sampleDocx(), name: "a.docx", type: DOCX_MIME };
    let res = await handleUploadReportTemplate(
      uploadRequest({ file }, "https://evil.example"),
      deps(jars.admin),
    );
    expect(res.status).toBe(403);
    res = await handleUploadReportTemplate(
      uploadRequest({ file }),
      deps(new CookieJar()),
    );
    expect(res.status).toBe(401);
    for (const role of [
      "pm",
      "member",
      "viewer",
      "outsider",
      "locked",
    ] as Role[]) {
      res = await handleUploadReportTemplate(
        uploadRequest({ file }),
        deps(jars[role]),
      );
      expect(res.status, role).toBe(403);
    }
    // Không phải Admin gửi tệp sai: vẫn 403 (vai trò kiểm trước schema/tệp).
    res = await handleUploadReportTemplate(
      uploadRequest({ file: { data: Buffer.from("x"), name: "x.pdf" } }),
      deps(jars.pm),
    );
    expect(res.status).toBe(403);
  });

  it("Đọc: Admin, PM được; Thành viên, Người xem, người ngoài, PM bị khóa 403; chưa đăng nhập 401", async () => {
    expect((await list("admin")).status).toBe(200);
    const pm = await list("pm");
    expect(pm.status).toBe(200);
    const { data } = (await pm.json()) as { data: ReportTemplate[] };
    expect(data.some((t) => createdTemplates.includes(t.id))).toBe(true);
    for (const role of ["member", "viewer", "outsider", "locked"] as Role[]) {
      expect((await list(role)).status, role).toBe(403);
    }
    expect(
      (
        await handleListReportTemplates(
          new Request(new URL(BASE, APP_ORIGIN)),
          deps(new CookieJar()),
        )
      ).status,
    ).toBe(401);

    const id = createdTemplates[0];
    for (const role of ["member", "viewer", "locked"] as Role[]) {
      const dl = await handleDownloadReportTemplate(
        new Request(new URL(`${BASE}/${id}/file`, APP_ORIGIN)),
        id,
        deps(jars[role]),
      );
      expect(dl.status, role).toBe(403);
    }
    // Thành viên gọi thẳng Storage bằng phiên của mình cũng không tải được (RLS storage.objects).
    const { data: row } = await service
      .from("report_templates")
      .select("storage_path")
      .eq("id", id)
      .single();
    const direct = await sessionClient(jars.member)
      .storage.from(REPORT_TEMPLATE_BUCKET)
      .download(row!.storage_path);
    expect(direct.data).toBeNull();
    // PM tải lên thẳng Storage cũng bị chặn.
    const put = await sessionClient(jars.pm)
      .storage.from(REPORT_TEMPLATE_BUCKET)
      .upload(`docx/${randomUUID()}.docx`, sampleDocx(), {
        contentType: DOCX_MIME,
      });
    expect(put.error).not.toBeNull();
  });

  it("PATCH/DELETE: không phải Admin 403; id lạ 404; trường lạ 400", async () => {
    const id = createdTemplates[0];
    let res = await handlePatchReportTemplate(
      jsonRequest("PATCH", `${BASE}/${id}`, { name: "X" }),
      id,
      deps(jars.pm),
    );
    expect(res.status).toBe(403);
    res = await handleDeleteReportTemplate(
      jsonRequest("DELETE", `${BASE}/${id}`),
      id,
      deps(jars.pm),
    );
    expect(res.status).toBe(403);
    const missing = randomUUID();
    res = await handlePatchReportTemplate(
      jsonRequest("PATCH", `${BASE}/${missing}`, { name: "X" }),
      missing,
      deps(jars.admin),
    );
    expect(res.status).toBe(404);
    res = await handleDeleteReportTemplate(
      jsonRequest("DELETE", `${BASE}/not-a-uuid`),
      "not-a-uuid",
      deps(jars.admin),
    );
    expect(res.status).toBe(404);
    res = await handlePatchReportTemplate(
      jsonRequest("PATCH", `${BASE}/${id}`, { kind: "docx" }),
      id,
      deps(jars.admin),
    );
    expect(res.status).toBe(400);
  });

  it("DELETE: Admin xóa dòng và tệp", async () => {
    const res0 = await upload("admin", {
      data: sampleDocx(),
      name: "xoa.docx",
      type: DOCX_MIME,
    });
    const t = ((await res0.json()) as { data: ReportTemplate }).data;
    const path = `docx/${t.id}.docx`;
    expect(await storedObjects()).toContain(path);
    const res = await handleDeleteReportTemplate(
      jsonRequest("DELETE", `${BASE}/${t.id}`),
      t.id,
      deps(jars.admin),
    );
    expect(res.status).toBe(204);
    expect(await storedObjects()).not.toContain(path);
    const { count } = await service
      .from("report_templates")
      .select("id", { count: "exact", head: true })
      .eq("id", t.id);
    expect(count).toBe(0);
    const again = await handleDeleteReportTemplate(
      jsonRequest("DELETE", `${BASE}/${t.id}`),
      t.id,
      deps(jars.admin),
    );
    expect(again.status).toBe(404);
  });
});
