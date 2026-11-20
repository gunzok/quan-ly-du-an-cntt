/**
 * Chạy tay hàm nhắc hạn một lần (Story E4-3): `make reminders-run`.
 * Gọi RPC public.run_due_reminders(p_now) của Supabase CỤC BỘ bằng khóa service_role (Makefile lấy
 * URL và khóa từ `supabase status`, không in ra). Môi trường thật do pg_cron chạy lúc 01:00 UTC
 * (08:00 giờ Việt Nam), xem docs/05-ops/nhac-han.md.
 *
 * REMINDERS_NOW (tùy chọn, ISO 8601, ví dụ 2026-11-24T08:00:00+07:00): giả lập "bây giờ" để thử với
 * một ngày cố định; bỏ trống = thời điểm hiện tại. Hàm chống trùng nên chạy lại không nhắc lần hai.
 * REMINDERS_PROJECT_ID (tùy chọn, UUID): chỉ xét một dự án.
 * Sau đó `make email-dispatch` (ứng dụng đang chạy) để gửi email nhắc vào Mailpit.
 */
export {};

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY. Chạy qua `make reminders-run` (lấy từ supabase status).",
  );
  process.exit(1);
}

const rawNow = process.env.REMINDERS_NOW?.trim();
let pNow: string | undefined;
if (rawNow) {
  const parsed = new Date(rawNow);
  if (Number.isNaN(parsed.getTime())) {
    console.error(
      `REMINDERS_NOW không phải thời điểm hợp lệ: ${rawNow.slice(0, 60)}`,
    );
    process.exit(1);
  }
  pNow = parsed.toISOString();
}

const projectId = process.env.REMINDERS_PROJECT_ID?.trim() || undefined;
if (
  projectId &&
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    projectId,
  )
) {
  console.error("REMINDERS_PROJECT_ID không phải UUID.");
  process.exit(1);
}

const response = await fetch(
  `${url.replace(/\/$/, "")}/rest/v1/rpc/run_due_reminders`,
  {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...(pNow ? { p_now: pNow } : {}),
      ...(projectId ? { p_project_id: projectId } : {}),
    }),
  },
).catch((error: unknown) => {
  console.error(
    `Không gọi được Supabase: ${String((error as Error)?.message ?? error)}. Đã chạy make db-start chưa?`,
  );
  process.exit(1);
});
const body = await response.text();
if (!response.ok) {
  console.error(`${response.status} ${body.slice(0, 300)}`);
  process.exit(1);
}
console.log(
  `Nhắc hạn${pNow ? ` (p_now = ${pNow})` : ""}: ${body} thông báo mới.`,
);
