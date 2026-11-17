/**
 * Test tích hợp Story E3-4 (QLDA-52, AC2) với Supabase cục bộ: phân trang con trỏ của
 * GET /api/v1/projects/{id}/tasks không trùng, không sót khi cuộn qua nhiều trang:
 *   - nhiều task trùng created_at (con trỏ phải phân định bằng id);
 *   - task bị thêm, xóa, sửa giữa các trang;
 *   - limit tối đa 500 (E3-4), 501 bị từ chối;
 *   - con trỏ kết hợp bộ lọc và tìm kiếm (đường RPC search_tasks).
 *
 * Ngữ nghĩa con trỏ (keyset theo created_at giảm dần, id giảm dần): mỗi task tồn tại suốt lúc cuộn
 * xuất hiện ĐÚNG một lần; task bị xóa trước khi tới trang của nó thì không xuất hiện; task mới tạo
 * (created_at mới hơn trang đã qua) không chen vào các trang sau, sẽ thấy khi tải lại từ đầu.
 *
 * Gọi thẳng lõi Route Handler với client phiên (RLS thật). Tài khoản, dự án tạo tạm, xóa ở afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { handleListTasks } from "@/lib/tasks/handlers";
import type { TaskListResponse } from "@/lib/tasks/model";
import { LIST_LIMIT_MAX } from "@/lib/tasks/validate";
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

/** Cuộn hết với trang nhỏ (limit=1) là hàng chục request: cả bộ chạy song song cần hơn 5 s mặc định. */
const PAGINATION_TIMEOUT_MS = 30_000;

describe.skipIf(!enabled)(
  "E3-4: con trỏ danh sách task (Supabase cục bộ)",
  () => {
    const tag = randomUUID().slice(0, 8);
    const password = `It-${randomUUID()}`;
    const created: string[] = [];
    const users: Record<string, string> = {};
    const jars: Record<string, CookieJar> = {};
    const projects: string[] = [];

    async function createUser(label: string) {
      const email = `it-e3-4-${label}-${tag}@example.com`;
      const { data, error } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: `IT ${label} ${tag}` },
      });
      if (error) throw error;
      created.push(data.user.id);
      users[label] = data.user.id;
      const jar = new CookieJar();
      const result = await signInWithPassword(sessionClient(jar), {
        email,
        password,
      });
      expect(result.ok).toBe(true);
      jars[label] = jar;
    }

    /** Dự án mới do pm tạo, viewer là Người xem. */
    async function newProject(): Promise<string> {
      const id = randomUUID();
      const { error } = await service.from("projects").insert({
        id,
        name: `IT E3-4 ${tag} ${projects.length}`,
        created_by: users.pm,
      });
      if (error) throw error;
      projects.push(id);
      const m = await service
        .from("project_members")
        .insert({ project_id: id, user_id: users.viewer, role: "viewer" });
      if (m.error) throw m.error;
      return id;
    }

    /** Thêm task bằng khóa service; createdAt có thì ghi đè created_at (giả lập trùng thời điểm). */
    async function addTasks(
      projectId: string,
      titles: string[],
      createdAt?: string,
    ): Promise<string[]> {
      const { data, error } = await service
        .from("tasks")
        .insert(
          titles.map((title) => ({
            project_id: projectId,
            title,
            created_by: users.pm,
          })),
        )
        .select("id");
      if (error) throw error;
      const ids = (data ?? []).map((r) => r.id as string);
      if (createdAt) {
        const u = await service
          .from("tasks")
          .update({ created_at: createdAt })
          .in("id", ids);
        if (u.error) throw u.error;
      }
      return ids;
    }

    /** Thứ tự đúng theo CSDL (created_at giảm dần, id giảm dần), đọc bằng khóa service. */
    async function expectedOrder(projectId: string): Promise<string[]> {
      const { data, error } = await service
        .from("tasks")
        .select("id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => r.id as string);
    }

    async function page(
      who: string,
      projectId: string,
      params: Record<string, string>,
    ): Promise<TaskListResponse> {
      const qs = new URLSearchParams(params);
      const res = await handleListTasks(
        new Request(
          new URL(`/api/v1/projects/${projectId}/tasks?${qs}`, APP_ORIGIN),
        ),
        projectId,
        { session: sessionClient(jars[who]) },
      );
      expect(res.status).toBe(200);
      return (await res.json()) as TaskListResponse;
    }

    /** Cuộn hết; giữa các trang gọi between(sốTrangĐãĐọc, idĐãThấy). */
    async function walk(
      who: string,
      projectId: string,
      params: Record<string, string>,
      between?: (pagesRead: number, seen: string[]) => Promise<void>,
    ): Promise<{ ids: string[]; pages: number[] }> {
      const ids: string[] = [];
      const pages: number[] = [];
      let cursor: string | null = null;
      do {
        const body: TaskListResponse = await page(
          who,
          projectId,
          cursor ? { ...params, cursor } : params,
        );
        ids.push(...body.data.map((t) => t.id));
        pages.push(body.data.length);
        cursor = body.next_cursor;
        if (cursor && between) await between(pages.length, ids);
        if (pages.length > 200) throw new Error("Quá nhiều trang");
      } while (cursor);
      return { ids, pages };
    }

    const dupes = (ids: string[]) =>
      ids.filter((id, i) => ids.indexOf(id) !== i);

    beforeAll(async () => {
      assertLocalSupabase();
      service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await createUser("pm");
      await createUser("viewer");
    });

    afterAll(async () => {
      if (!service) return;
      for (const id of projects)
        await service.from("projects").delete().eq("id", id);
      for (const id of created) await service.auth.admin.deleteUser(id);
    });

    it(
      "nhiều task trùng created_at: mọi cỡ trang đều đủ, không trùng, đúng thứ tự",
      async () => {
        const pid = await newProject();
        // 10 task cùng một thời điểm, 8 task cùng thời điểm có micro giây, 5 task mỗi task một lần chèn.
        await addTasks(
          pid,
          Array.from({ length: 10 }, (_, i) => `Cùng giờ ${i}`),
          "2026-01-01T00:00:00+00:00",
        );
        await addTasks(
          pid,
          Array.from({ length: 8 }, (_, i) => `Micro ${i}`),
          "2026-01-02T03:04:05.123456+00:00",
        );
        for (let i = 0; i < 5; i++) await addTasks(pid, [`Riêng ${i}`]);
        const expected = await expectedOrder(pid);
        expect(expected.length).toBe(23);

        for (const limit of [1, 3, 4, 7, 10, 23, LIST_LIMIT_MAX]) {
          for (const who of ["pm", "viewer"]) {
            const { ids, pages } = await walk(who, pid, {
              limit: String(limit),
            });
            expect(dupes(ids), `limit=${limit}`).toEqual([]);
            expect(ids, `limit=${limit} ${who}`).toEqual(expected);
            // Không có trang rỗng thừa ở cuối (kể cả khi số task chia hết cho limit).
            expect(pages.length).toBe(Math.ceil(expected.length / limit));
            expect(pages.every((n) => n > 0 && n <= limit)).toBe(true);
          }
          // sort=created_at (E13-2, tăng dần): cùng tập, thứ tự ngược, vẫn không trùng.
          const asc = await walk("pm", pid, {
            limit: String(limit),
            sort: "created_at",
          });
          expect(asc.ids, `sort=created_at limit=${limit}`).toEqual(
            [...expected].reverse(),
          );
        }
      },
      PAGINATION_TIMEOUT_MS,
    );

    it(
      "thêm, xóa, sửa task giữa các trang: không trùng, không sót task còn tồn tại",
      async () => {
        const pid = await newProject();
        await addTasks(
          pid,
          Array.from({ length: 12 }, (_, i) => `Lô ${i}`),
          "2026-02-01T00:00:00+00:00",
        );
        for (let i = 0; i < 8; i++) await addTasks(pid, [`Lẻ ${i}`]);
        const initial = await expectedOrder(pid);
        expect(initial.length).toBe(20);

        const deleted = new Set<string>();
        const addedNewer: string[] = [];
        let addedOlder: string[] = [];
        const { ids } = await walk(
          "pm",
          pid,
          { limit: "4" },
          async (pagesRead, seen) => {
            if (pagesRead === 1) {
              // Xóa một task đã thấy và một task chưa tới.
              const unseen = initial.filter((id) => !seen.includes(id));
              const victims = [seen[0], unseen[unseen.length - 1]];
              const d = await service.from("tasks").delete().in("id", victims);
              if (d.error) throw d.error;
              victims.forEach((v) => deleted.add(v));
              // Task mới (created_at bây giờ, mới hơn mọi trang đã qua).
              addedNewer.push(
                ...(await addTasks(pid, ["Mới 1", "Mới 2", "Mới 3"])),
              );
              // Task "cũ" chèn vào vùng chưa cuộn tới (created_at trùng lô đang đọc dở).
              addedOlder = await addTasks(
                pid,
                ["Cũ 1", "Cũ 2"],
                "2026-02-01T00:00:00+00:00",
              );
            }
            if (pagesRead === 2) {
              // Sửa task đã thấy và task chưa thấy: khóa sắp xếp (created_at, id) không đổi.
              const unseen = initial.filter(
                (id) => !seen.includes(id) && !deleted.has(id),
              );
              const u = await service
                .from("tasks")
                .update({ title: "Đã sửa", position: 1 })
                .in("id", [seen[seen.length - 1], unseen[0]]);
              if (u.error) throw u.error;
            }
          },
        );

        expect(dupes(ids)).toEqual([]);
        // Mọi task ban đầu không bị xóa đều thấy (đúng một lần vì không trùng).
        for (const id of initial.filter((x) => !deleted.has(x)))
          expect(ids).toContain(id);
        // Task bị xóa trước khi tới trang của nó: không xuất hiện.
        expect(ids).not.toContain(initial[initial.length - 1]);
        // Task mới hơn trang đã qua không chen vào sau.
        for (const id of addedNewer) expect(ids).not.toContain(id);
        // Thứ tự trả về khớp thứ tự CSDL của những gì đã thấy (không nhảy lùi).
        const final = await expectedOrder(pid);
        const seenInitial = ids.filter((id) => initial.includes(id));
        expect(seenInitial).toEqual(
          initial.filter((id) => seenInitial.includes(id)),
        );
        // Task chèn với created_at cũ: mỗi task xuất hiện tối đa một lần (thấy hay không tùy id so
        // với con trỏ lúc chèn), không bao giờ lặp.
        for (const id of addedOlder) {
          expect(ids.filter((x) => x === id).length).toBeLessThanOrEqual(1);
        }

        // Tải lại từ đầu thấy đúng hiện trạng: đủ task mới, không còn task đã xóa.
        const reload = await walk("pm", pid, { limit: "4" });
        expect(reload.ids).toEqual(final);
        for (const id of deleted) expect(reload.ids).not.toContain(id);
        for (const id of [...addedNewer, ...addedOlder])
          expect(reload.ids).toContain(id);
      },
      PAGINATION_TIMEOUT_MS,
    );

    it("limit: tối đa 500, 501 và 0 bị từ chối 400; trang 500 trả đủ, next_cursor null", async () => {
      const pid = await newProject();
      await addTasks(
        pid,
        Array.from({ length: 30 }, (_, i) => `Giới hạn ${i}`),
        "2026-03-01T00:00:00+00:00",
      );
      const body = await page("pm", pid, { limit: "500" });
      expect(body.data.length).toBe(30);
      expect(body.next_cursor).toBeNull();
      // Mặc định vẫn 50 (tương thích ngược).
      expect((await page("pm", pid, {})).data.length).toBe(30);

      for (const limit of ["501", "0", "1000"]) {
        const res = await handleListTasks(
          new Request(
            new URL(`/api/v1/projects/${pid}/tasks?limit=${limit}`, APP_ORIGIN),
          ),
          pid,
          { session: sessionClient(jars.pm) },
        );
        expect(res.status).toBe(400);
        const err = (await res.json()) as {
          error: { code: string; details?: { field: string }[] };
        };
        expect(err.error.code).toBe("validation_failed");
        expect(err.error.details?.map((d) => d.field)).toContain("limit");
      }
    });

    it(
      "con trỏ kết hợp lọc trạng thái và tìm kiếm (RPC search_tasks): không trùng, không sót",
      async () => {
        const pid = await newProject();
        await addTasks(
          pid,
          Array.from({ length: 9 }, (_, i) => `Máy chủ ${i}`),
          "2026-04-01T00:00:00+00:00",
        );
        await addTasks(
          pid,
          Array.from({ length: 6 }, (_, i) => `Khác ${i}`),
          "2026-04-01T00:00:00+00:00",
        );
        await addTasks(
          pid,
          Array.from({ length: 4 }, (_, i) => `Máy chủ lẻ ${i}`),
        );

        const all = await expectedOrder(pid);
        const { data: rows, error } = await service
          .from("tasks")
          .select("id, title, status_id")
          .eq("project_id", pid);
        if (error) throw error;
        const titleOf = new Map(
          (rows ?? []).map((r) => [r.id as string, r.title as string]),
        );
        const wantSearch = all.filter((id) =>
          titleOf.get(id)!.startsWith("Máy chủ"),
        );
        expect(wantSearch.length).toBe(13);

        const search = await walk("viewer", pid, { q: "may chu", limit: "2" });
        expect(dupes(search.ids)).toEqual([]);
        expect(search.ids).toEqual(wantSearch);

        const status = (rows ?? [])[0].status_id as string;
        const wantStatus = all.filter(
          (id) => (rows ?? []).find((r) => r.id === id)!.status_id === status,
        );
        const filtered = await walk("pm", pid, {
          status_id: status,
          limit: "5",
        });
        expect(dupes(filtered.ids)).toEqual([]);
        expect(filtered.ids).toEqual(wantStatus);
      },
      PAGINATION_TIMEOUT_MS,
    );
  },
);
