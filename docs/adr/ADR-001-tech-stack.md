# ADR-001: Chọn tech stack

- **Trạng thái**: Đã chấp nhận
- **Ngày**: 2026-11-13
- **Người quyết định**: Justin Tran (chủ dự án)

## Bối cảnh

App quản lý dự án CNTT nội bộ, dưới 100 người dùng, web responsive, giao diện Việt và Anh. Cần đăng nhập email và Google, 4 vai trò, gửi email, xuất báo cáo xlsx/docx theo template, dashboard. Ràng buộc: TypeScript toàn bộ, dịch vụ quản lý, phụ thuộc nhà cung cấp mức vừa với dữ liệu là Postgres chuẩn, hạ tầng dưới 25 USD/tháng, một người làm cùng Claude, MVP 6 đến 8 tuần (NFR-04, NFR-09, NFR-12; chi tiết ở [business-analysis.md](../02-ba/business-analysis.md)).

## Các phương án đã xét

| Phương án | Ưu điểm | Nhược điểm | Điểm |
|---|---|---|---|
| A: Next.js + Supabase + Vercel | Có sẵn đăng nhập và phân quyền theo hàng (RLS); Postgres chuẩn; nhanh nhất ra MVP | Vercel Hobby không dùng cho thương mại; Supabase Free tạm dừng; lên gói trả phí dễ vượt 25 USD | 84,0 |
| B: Next.js tự quản + Neon + Render | Rẻ nhất, ít khóa nhà cung cấp, tiến trình Node chạy dài cho xuất báo cáo | Tự dựng đăng nhập, RBAC, email nên chậm hơn | 80,0 |
| C: React + Convex | Thời gian thực sẵn | Không phải Postgres chuẩn, trái ràng buộc | 70,0 |

Chi tiết và nguồn giá: [tech-stack-matrix.md](../02-ba/tech-stack-matrix.md); tính điểm từ [stack.json](../02-ba/stack.json).

## Quyết định

Chọn **A: Next.js (TypeScript) + Supabase (Postgres, Auth, Storage) + Vercel**. Sếp chọn A dù A và B sát điểm, vì ưu tiên ra MVP đúng hạn.

Điều kiện đi kèm để giữ ngân sách (NFR-12):
- Khi vận hành thật, chọn nơi host Next.js phù hợp giấy phép thương mại (Vercel Pro, hoặc nơi khác) và cân nhắc Supabase Pro; chi phí này vượt 25 USD thì phải được sếp duyệt riêng, không tự nâng gói.
- Chỉ dùng tính năng Supabase chuyển được: Postgres chuẩn, SQL migration nằm trong repo, không phụ thuộc hàm riêng không chuyển được.

## Hệ quả

- Điều trở nên dễ hơn: đăng nhập email và Google, phân quyền cho 4 vai trò bằng RLS, lưu tệp cho đợt sau, nhanh ra MVP.
- Điều trở nên khó hơn hoặc rủi ro mới: sai luật RLS có thể làm rò dữ liệu, cần kiểm thử phân quyền cho 4 vai trò (NFR-06); xuất báo cáo trên hàm serverless có giới hạn thời gian và bộ nhớ (R-006); chi phí có thể vượt ngân sách khi lên gói trả phí (R-008).

## Điều kiện xem xét lại

- Chi phí hạ tầng thực tế vượt 25 USD/tháng và sếp không chấp nhận.
- Kiểm thử RLS cho thấy luật phân quyền vượt khả năng một người bảo trì.
- Xuất báo cáo nặng không chạy được trong giới hạn hàm serverless (khi đó xem xét phương án B hoặc một dịch vụ xuất file riêng).
- Có yêu cầu đặt dữ liệu ở máy chủ trong nước hoặc tự host (NFR-14).

## Nguồn tham khảo

- Giá và giới hạn các dịch vụ: xem mục 4 của [tech-stack-matrix.md](../02-ba/tech-stack-matrix.md) (chưa xác minh từ trang chính thức) — ngày tra 2026-11-13.
