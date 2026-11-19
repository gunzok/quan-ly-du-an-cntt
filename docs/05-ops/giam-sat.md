# Đề xuất giám sát lỗi, uptime và log (E0-4)

Story E0-4 (Should, phụ thuộc E0-2). Tài liệu này là **đề xuất để sếp chọn**, chưa cài gì: chọn xong mới làm E0-4 (viết ADR, cài, test). Yêu cầu nền: [system-design.md mục 7](../03-design/system-design.md#7-logging-và-giám-sát), NFR-04 (uptime khoảng 99% giờ 7h-19h ngày làm việc), NFR-12 (dưới 25 USD/tháng), NFR-14 (dữ liệu cá nhân).

> Giá và giới hạn gói miễn phí dưới đây **chưa xác minh** từ trang chính thức (R-008). Đối chiếu trước khi đăng ký.

## 1. Cần giám sát gì

| Nhu cầu | Tiêu chí E0-4 | Câu hỏi trả lời |
|---|---|---|
| Uptime | AC2: cảnh báo khi uptime giờ hành chính dưới 99% | App còn mở được không? Supabase có bị tạm dừng không? |
| Lỗi máy chủ | AC1: lỗi phía máy chủ ghi log có `request_id` và gửi cảnh báo | Có lỗi 5xx nào, ở đâu, lặp bao nhiêu lần? |
| Log có cấu trúc | system-design mục 7 | Tra lại một yêu cầu cụ thể theo `request_id` người dùng báo |

Hiện trạng mã: phản hồi lỗi API đã có `request_id` (`lib/api/errors.ts`, `lib/api/csrf.ts`); chưa có log JSON tập trung, chưa có cảnh báo.

## 2. Phương án

### Uptime

| Công cụ | Gói miễn phí (chưa xác minh) | Ghi chú |
|---|---|---|
| **UptimeRobot** | 50 monitor, chu kỳ 5 phút, cảnh báo email | Dễ dùng nhất; trang trạng thái công khai tùy chọn. Gói Free có hạn chế dùng thương mại hay không: **cần đọc điều khoản** |
| Better Stack (Uptime) | Khoảng 10 monitor, chu kỳ 3 phút | Gộp được với log nếu dùng Better Stack Logs |
| Workflow GitHub Actions theo lịch | Miễn phí (repo công khai) | Chạy `scripts/deploy/smoke.ts` mỗi 15-30 phút; lịch cron của GitHub có thể trễ, không hợp làm uptime chính xác, chỉ làm dự phòng |

Điểm kiểm: `GET <APP_URL>/login` mong đợi 200 (trang công khai, không cần đăng nhập). Kiểm thêm `GET https://<ref>.supabase.co/auth/v1/health` (cần header `apikey` khóa anon) để biết Supabase staging/Free có bị tạm dừng. Giờ hành chính: đặt cửa sổ bảo trì ngoài 7h-19h để số uptime phản ánh đúng NFR-04.

### Theo dõi lỗi

| Công cụ | Gói miễn phí (chưa xác minh) | Ghi chú |
|---|---|---|
| **Sentry** (Developer) | Khoảng 5.000 lỗi/tháng, 1 người dùng | SDK chính thức cho Next.js; gom lỗi trùng, cảnh báo email. Cần: tắt gửi IP/cookie/body (`sendDefaultPii: false`), lọc header `authorization`/`cookie`, thêm miền `*.ingest.sentry.io` vào CSP `connect-src` (proxy.ts) nếu bật phía trình duyệt |
| Vercel Observability / Logs | Có sẵn trên Vercel; Hobby giữ log ngắn (khoảng 1 giờ), Pro dài hơn | Không cần cài thêm, nhưng không gửi cảnh báo lỗi theo mặc định ở gói thấp |
| Better Stack Logs (qua Vercel Log Drain) | Khoảng 1-3 GB/tháng | Log Drain của Vercel có thể yêu cầu gói Pro: **cần kiểm** |

### Log có cấu trúc

Không cần dịch vụ ngoài cho bước đầu: một hàm ghi `console.log(JSON.stringify({ level, msg, request_id, route, status, duration_ms }))` trong handler API; Vercel thu log stdout. Quy tắc: không ghi mật khẩu, token, cookie, email, số điện thoại, nội dung task (NFR-14). `request_id` trả về trong body lỗi (đã có) để người dùng báo lại.

## 3. Đề xuất của agent

Tối thiểu, **0 USD**, đủ AC1 và AC2:

1. **UptimeRobot Free**: 2 monitor cho `<APP_URL production>/login` và `auth/v1/health` của Supabase production, chu kỳ 5 phút, cảnh báo email sếp + người trực. Thêm 1 monitor staging (tùy chọn).
2. **Sentry Developer** chỉ phía máy chủ (route handler, server component) để giảm rủi ro dữ liệu cá nhân và không phải nới CSP trình duyệt; lỗi gom theo `request_id`.
3. **Log JSON** qua stdout (Vercel Logs) như mục 2.

Lý do: cả ba miễn phí, cài trong khoảng 3 điểm Story, không đổi kiến trúc; nếu sau này lên Vercel Pro có thể thêm Log Drain. Phương án thay thế gọn một nhà cung cấp: Better Stack (uptime + log) + Sentry.

## 4. Cần sếp quyết

- Chọn công cụ (hoặc đồng ý đề xuất mục 3) → phiên điều phối ghi ADR.
- Email/kênh nhận cảnh báo và người trực trong giờ hành chính.
- Có cho phép gửi thông tin lỗi (đường dẫn, stack trace, không dữ liệu cá nhân) sang dịch vụ nước ngoài như Sentry không (NFR-14).

Sau khi có quyết định, E0-4 cần: ADR, biến môi trường mới (ví dụ `SENTRY_DSN`) bổ sung vào [README mục 7](README.md#7-bước-5-biến-môi-trường-trên-vercel), sửa CSP nếu cần, test cho log JSON có `request_id`.
