# Nhắc hạn: bật và kiểm tra pg_cron (Story E4-3, QLDA-74)

Nhắc hạn chạy hoàn toàn trong CSDL: job `pg_cron` tên `qlda-due-reminders` gọi `public.run_due_reminders()` mỗi ngày lúc **01:00 UTC = 08:00 giờ Việt Nam**. Hàm tạo thông báo `task_due_soon` trong app; người nhận bật email "Nhắc hạn" thì trigger E4-2 ghi thêm hàng `email_outbox`, job `qlda-email-dispatch` (mỗi phút, xem [README mục email](README.md)) gửi đi. Nhắc hạn **không cần bí mật hay biến môi trường mới**.

Migration: `supabase/migrations/20261115390000_due_reminders.sql` (đầu tệp ghi đủ quyết định).

## 1. Quy tắc nhắc (tóm tắt)

| Mục | Quy tắc |
|---|---|
| Mốc | 3 ngày và 1 ngày lịch trước hạn (`due_date` = hôm nay + 3 hoặc + 1), "hôm nay" theo giờ Việt Nam. Chạy cả cuối tuần. Không bù mốc đã lỡ khi job không chạy |
| Người nhận | Chỉ người phụ trách, đang hoạt động, còn là thành viên dự án (hoặc Admin) |
| Không nhắc | Task đã xong, không có hạn, không người phụ trách; dự án đã lưu trữ |
| Chống trùng | Sổ `public.task_due_reminders`, khóa (task, người nhận, hạn, mốc). Chạy lại không nhắc lần hai; dời hạn sang ngày khác thì nhắc theo hạn mới |
| Email | Công tắc "Nhắc hạn" ở `/profile` → "Email thông báo", mặc định **bật**. Lúc gửi kiểm lại: task chưa xong, dự án chưa lưu trữ, hạn còn trong 0 đến 3 ngày; không đạt thì bỏ (`reminder_stale`) |
| Quá hạn | Chưa nhắc task quá hạn (`task_overdue`): ngoài phạm vi Story, xem quyết định 2 trong migration |

## 2. Bật pg_cron trên Supabase (staging, production)

Migration tự chạy `create extension if not exists pg_cron` và `cron.schedule(...)`. Trên Supabase hosted, extension được phép bật qua migration; nếu `supabase db push` báo lỗi quyền với `pg_cron`, bật tay rồi push lại:

1. Supabase Dashboard (đúng dự án) → **Database → Extensions** → tìm `pg_cron` → **Enable** (schema mặc định `pg_catalog`). Làm tương tự `pg_net` nếu chưa bật (cần cho job email E4-2).
2. Chạy lại `supabase db push` (hoặc để CD áp migration, [README](README.md)).
3. **SQL Editor**, kiểm tra:

   ```sql
   -- pg_cron chạy theo giờ GMT/UTC: phải ra GMT (hoặc UTC). Khác thì lịch '0 1 * * *' không còn là 08:00 giờ VN.
   show cron.timezone;

   -- Job đã đăng ký, đang bật.
   select jobid, jobname, schedule, command, active from cron.job
   where jobname in ('qlda-due-reminders', 'qlda-email-dispatch');
   ```

   Kỳ vọng `qlda-due-reminders | 0 1 * * * | select public.run_due_reminders() | t`.

4. Sau 08:00 giờ VN của ngày kế tiếp, xem kết quả lần chạy:

   ```sql
   select jobid, status, return_message, start_time, end_time
   from cron.job_run_details
   where jobid = (select jobid from cron.job where jobname = 'qlda-due-reminders')
   order by start_time desc limit 5;
   ```

   `status = succeeded`, `return_message` là `1 row` (số thông báo nằm trong kết quả hàm, không in ở đây).

`cron.timezone` của Supabase cục bộ là `GMT` (đã kiểm 2026-11-20, pg_cron 1.6.4). Bản hosted **[CHƯA KIỂM CHỨNG]** khi chưa có dự án thật: chạy bước 3 khi tạo staging.

## 3. Chạy tay và thử

- **Cục bộ**: `make reminders-run` (gọi hàm với thời điểm hiện tại). Giả lập một ngày cố định: `make reminders-run REMINDERS_NOW=2026-11-24T08:00:00+07:00`; thêm `REMINDERS_PROJECT_ID=<uuid>` để chỉ xét một dự án. Sau đó `make email-dispatch` (ứng dụng đang chạy, cùng `CRON_SECRET`) để email nhắc vào Mailpit http://127.0.0.1:54324.
- **Staging/production** (SQL Editor, vai trò postgres): `select public.run_due_reminders();` (một dự án: `select public.run_due_reminders(now(), '<project_id>');`). Chạy lại an toàn (chống trùng). Chỉ `service_role` và `postgres` gọi được hàm; trình duyệt không gọi được.
- **Tạm dừng nhắc** (ví dụ sự cố email): `select cron.alter_job((select jobid from cron.job where jobname = 'qlda-due-reminders'), active := false);` Bật lại với `active := true`. Mốc của những ngày tạm dừng không được bù.

## 4. Vận hành

- Sổ `task_due_reminders` mỗi task tối đa vài dòng, tự xóa theo task (ON DELETE CASCADE). Chưa cần job dọn.
- Hạn mức email Resend miễn phí 100 email/ngày (ADR-002): mỗi task đang mở có hạn tạo tối đa 2 email nhắc cho người phụ trách. Theo dõi số dòng `email_outbox` loại `task_due_soon` mỗi ngày nếu sắp chạm hạn mức.
- Đổi giờ nhắc: tạo migration mới gọi `cron.alter_job(..., schedule := '<cron UTC>')`, không sửa migration cũ.
