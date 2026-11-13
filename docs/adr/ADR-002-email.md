# ADR-002: Dịch vụ gửi email

- **Trạng thái**: Đã chấp nhận (2026-11-13)
- **Ngày**: 2026-11-13
- **Người quyết định**: Justin Tran (chủ dự án)

## Bối cảnh

Cần gửi email mời người dùng, thông báo giao việc, nhắc hạn (FR-12, E1-4, E4-2, E4-3). Quy mô dưới 100 người (A2), ngân sách hạ tầng dưới 25 USD/tháng (NFR-12). Phải kiểm soát độ tin cậy gửi, có tên miền công ty, không để mất thao tác chính khi gửi lỗi (system-design.md mục 6).

## Các phương án đã xét

| Phương án | Ưu điểm | Nhược điểm |
|---|---|---|
| A: Resend (API) | Gói miễn phí 3.000 email/tháng, giới hạn 100/ngày, 1 tên miền; SDK TypeScript; Pro 20 USD/tháng nếu cần | Giới hạn 100 email/ngày dễ chạm khi nhắc hạn hàng loạt; cần xác minh tên miền; số liệu chưa xác minh từ trang chính thức |
| B: SMTP mặc định của Supabase | Không cần cấu hình thêm | Chỉ phù hợp thử nghiệm, giới hạn tần suất chặt (chưa xác minh chi tiết); không dùng cho thông báo vận hành |
| C: Amazon SES hoặc nhà cung cấp SMTP khác (Brevo...) | Rẻ ở quy mô lớn, hạn mức rộng | Cấu hình phức tạp hơn (SES cần thoát sandbox), thêm một nhà cung cấp phải theo dõi |

## Quyết định (đề xuất)

Chọn **A: Resend**, đặt sau một giao diện `EmailSender` trong `lib/` để đổi nhà cung cấp mà không sửa nghiệp vụ. Email xác thực và mời của Supabase Auth cũng cấu hình SMTP tùy chỉnh trỏ tới Resend để cùng tên miền và độ tin cậy.

Điều kiện đi kèm:
- Cần một tên miền công ty để xác minh SPF, DKIM (sếp cung cấp quyền DNS). Chưa có thì tạm dùng miền thử của nhà cung cấp ở staging.
- Nhắc hạn gộp thành một email tóm tắt mỗi ngày cho mỗi người (không gửi từng task) để nằm trong 100 email/ngày.
- Gửi lỗi: thử lại tối đa 3 lần, ghi log, không làm hỏng thao tác chính.

## Hệ quả

- Dễ hơn: có một đường gửi duy nhất, dễ kiểm thử bằng bản giả (fake) của `EmailSender`.
- Khó hơn hoặc rủi ro mới: phụ thuộc thêm một nhà cung cấp; cần quản lý khóa API (chỉ ở biến môi trường máy chủ, không vào repo công khai); cần DNS.

## Điều kiện xem xét lại

- Vượt 100 email/ngày thường xuyên hoặc 3.000/tháng.
- Giá hoặc giới hạn gói miễn phí đổi (R-008).
- Sếp không có tên miền để xác minh.

## Nguồn tham khảo

- Resend: giá và giới hạn lấy từ các bài tổng hợp bên thứ ba, **chưa xác minh** từ resend.com/pricing — [Activepieces](https://www.activepieces.com/blog/resend-pricing-2026-free-tier-plans-and-limits.md), [Costbench](https://costbench.com/software/email-api/resend/free-plan/) — ngày tra 2026-11-13.
