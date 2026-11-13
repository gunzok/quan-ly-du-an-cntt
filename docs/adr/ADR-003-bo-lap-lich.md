# ADR-003: Bộ lập lịch nhắc hạn

- **Trạng thái**: Đề xuất (chờ sếp duyệt)
- **Ngày**: 2026-11-13
- **Người quyết định**: Justin Tran (chủ dự án)

## Bối cảnh

Cần chạy tác vụ định kỳ để nhắc task sắp đến hạn và gửi email tóm tắt (FR-11, FR-12, E4-3). Ngân sách dưới 25 USD/tháng (NFR-12); hạ tầng là Vercel và Supabase (ADR-001). Thời điểm nhắc (trước bao lâu) chưa chốt.

## Các phương án đã xét

| Phương án | Ưu điểm | Nhược điểm |
|---|---|---|
| A: Supabase `pg_cron` + `pg_net` gọi Route Handler hoặc Edge Function | Không giới hạn tần suất nêu trong tài liệu; chạy gần dữ liệu; một nơi quản lý cùng migration | Cần bật hai extension; gọi HTTP có kèm bí mật; lịch chạy theo UTC |
| B: Vercel Cron | Cấu hình ngay trong `vercel.json` | Gói Hobby chỉ chạy một lần mỗi ngày với độ chính xác theo giờ (±59 phút) và Hobby cấm dùng thương mại (R-008); gói Pro tốn thêm tiền |
| C: GitHub Actions theo lịch | Miễn phí | Độ trễ và độ tin cậy kém, không phù hợp nghiệp vụ chính |

## Quyết định (đề xuất)

Chọn **A: Supabase `pg_cron` + `pg_net`**, gọi một Route Handler nội bộ `/api/internal/reminders` kèm bí mật dùng chung trong header (so khớp phía máy chủ, không vào repo). Lịch: một lần mỗi ngày làm việc lúc 08:00 giờ Việt Nam (01:00 UTC); Route Handler tính task đến hạn trong ngưỡng nhắc rồi tạo thông báo và gửi một email tóm tắt cho mỗi người.

Điều kiện đi kèm:
- Route Handler idempotent (không gửi trùng khi chạy lại).
- Ngưỡng nhắc mặc định 1 ngày và 3 ngày trước hạn **[CẦN XÁC NHẬN]**.
- Migration tạo job nằm trong `supabase/migrations/`.

## Hệ quả

- Dễ hơn: lịch nằm cùng nơi với dữ liệu, kiểm thử bằng cách gọi trực tiếp Route Handler.
- Khó hơn hoặc rủi ro mới: phụ thuộc `pg_cron` trên gói Supabase đang dùng (cần xác minh bật được ở staging và production); bí mật gọi nội bộ phải xoay vòng định kỳ.

## Điều kiện xem xét lại

- `pg_cron` không bật được trên gói Supabase thực tế.
- Cần nhắc theo giờ riêng từng người (khi đó xem lại tần suất).

## Nguồn tham khảo

- [Supabase: Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions) — ngày tra 2026-11-13.
- [Vercel: Cron jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) — Hobby một lần mỗi ngày; ngày tra 2026-11-13.
