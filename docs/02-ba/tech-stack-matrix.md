# Ma trận chọn tech stack

Ngày: 2026-11-13 · Pha 2 · Trạng thái: Chờ sếp chọn

## 1. Ràng buộc đã chốt
- TypeScript toàn bộ; dịch vụ quản lý (BaaS/PaaS); phụ thuộc nhà cung cấp mức vừa, dữ liệu là Postgres chuẩn.
- Hạ tầng dưới 25 USD/tháng; một người làm cùng Claude; MVP 6 đến 8 tuần; dưới 100 người dùng.
- Cần: đăng nhập email và Google, 4 vai trò, gửi email, xuất xlsx/docx, giao diện Việt/Anh, web responsive.

## 2. Ba phương án
| Lớp | A: Next.js + Supabase + Vercel | B: Next.js tự quản + Neon + Render | C: React + Convex |
|---|---|---|---|
| Frontend | Next.js (React), TypeScript | Next.js (React), TypeScript | React (Vite), TypeScript |
| Backend | Route handler/Server Action của Next.js; Postgres gọi qua Supabase | Next.js full-stack, Drizzle ORM | Hàm Convex (TypeScript) |
| Cơ sở dữ liệu | Supabase Postgres (chuẩn, có RLS) | Neon Postgres (chuẩn) | Cơ sở dữ liệu riêng của Convex (không phải Postgres) |
| Xác thực, phân quyền | Supabase Auth + RLS cho 4 vai trò | Better Auth hoặc Auth.js, tự viết RBAC | Convex Auth hoặc nhà cung cấp ngoài |
| Lưu tệp | Supabase Storage (đợt sau cho tệp đính kèm) | Tự chọn (chưa cần ở MVP) | Convex file storage |
| Hạ tầng chạy | Vercel (frontend, hàm) | Render (một web service Node) | Convex cloud + Vercel hoặc Cloudflare Pages |
| Test | Vitest, Playwright | Vitest, Playwright | Vitest, Playwright |

## 3. Ưu, nhược gắn với yêu cầu
**A: Next.js + Supabase + Vercel**
- Ưu: có sẵn đăng nhập (email, Google), phân quyền theo hàng bằng RLS (khớp 4 vai trò, BR-10), lưu tệp cho đợt sau; dữ liệu là Postgres chuẩn nên chuyển nhà cung cấp được; nhanh nhất để ra MVP (NFR chi phí, E1 rút ngắn).
- Nhược: Vercel gói Hobby giới hạn dùng cá nhân phi thương mại, app của công ty nhiều khả năng cần gói Pro; Supabase gói Free có tạm dừng khi ít hoạt động và không đủ cho vận hành thật; Free + Vercel Pro khoảng 20 USD, thêm Supabase Pro 25 USD thì khoảng 45 USD, vượt ngân sách 25 USD (NFR-12). Chính sách RLS sai có thể gây rò dữ liệu, cần kiểm thử kỹ (NFR-06).

**B: Next.js tự quản + Neon + Render**
- Ưu: rẻ nhất (khoảng 7 USD cho một web service Render gói trả phí cộng Neon Free); ít khóa nhà cung cấp; một tiến trình Node chạy dài nên xuất báo cáo xlsx/docx không vướng giới hạn thời gian của hàm serverless (R-006).
- Nhược: phải tự dựng đăng nhập, RBAC, gửi email, quản lý phiên, nên chậm hơn A (rủi ro với hạn 6 đến 8 tuần); Neon Free giới hạn dung lượng nhỏ; Render gói Free tự ngủ khi nhàn rỗi nên cần gói trả phí.

**C: React + Convex**
- Ưu: cập nhật thời gian thực sẵn, viết nhanh bằng TypeScript.
- Nhược: không phải Postgres chuẩn, trái ràng buộc "dữ liệu là Postgres chuẩn", khó chuyển nhà cung cấp; truy vấn báo cáo và xuất file kém tự nhiên hơn; ít tài liệu và kinh nghiệm hơn A, B.

## 4. Giá và giới hạn (chưa xác minh từ trang chính thức)
Tra ngày 2026-11-13, chủ yếu từ bài viết bên thứ ba, nên ghi **Chưa xác minh**; sếp hoặc Claude cần đối chiếu trang giá chính thức trước khi mua gói.

| Dịch vụ | Điều tra được | Nguồn |
|---|---|---|
| Supabase | Free: 500 MB database, 50K MAU, 2 dự án, tạm dừng sau 7 ngày không dùng. Pro: 25 USD/tháng/tổ chức | [Jetadmin](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/), [Makerkit](https://makerkit.dev/blog/saas/supabase-pricing) |
| Vercel | Hobby chỉ cho dùng cá nhân phi thương mại; Pro khoảng 20 USD/người/tháng. Giới hạn thời gian hàm: nguồn mâu thuẫn (tài liệu chính thức ghi 300 giây cho Hobby) | [Tài liệu Vercel Hobby](https://vercel.com/docs/plans/hobby), [Usage & Pricing for Functions](https://vercel.com/docs/functions/usage-and-pricing) |
| Neon | Free: 100 dự án, 1 GB lưu trữ mỗi dự án, 100 CU-giờ mỗi dự án (FAQ chính thức, cập nhật 2026-10-01). Gói trả phí tính theo mức dùng, chưa xác nhận đơn giá | [Neon FAQ](https://neon.com/faqs/free-plan-limits-and-quotas) |
| Convex | Free/Starter: 0,5 GiB database, 1 GiB băng thông, 1 GiB tệp. Professional: 25 USD/thành viên/tháng | [Convex limits](https://docs.convex.dev/production/state/limits), [Convex pricing](https://www.convex.dev/pricing) |
| Render | Web service Free ngủ sau 15 phút không dùng; Starter 7 USD/tháng; Postgres Free hết hạn (nguồn nói 30 hoặc 90 ngày) | [Render](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026.md) |

## 5. Chấm điểm
Trọng số mặc định (phù hợp 30, tốc độ MVP 20, chi phí 15, năng lực đội và AI 15, mở rộng 10, bảo trì 10). Điểm 1 đến 5 là đánh giá của Claude dựa trên mục 3; phép tính do `score_stack.py` chạy trên [stack.json](stack.json).

| Phương án | Phù hợp (30) | Tốc độ MVP (20) | Chi phí (15) | Đội và AI (15) | Mở rộng (10) | Bảo trì (10) | Tổng /100 |
|---|---|---|---|---|---|---|---|
| A: Next.js + Supabase + Vercel | 4 | 5 | 3 | 5 | 4 | 4 | 84,0 |
| B: Next.js tự quản + Neon + Render | 4 | 3 | 5 | 5 | 3 | 4 | 80,0 |
| C: React + Convex | 2 | 5 | 4 | 4 | 4 | 3 | 70,0 |

Hạng 1 và hạng 2 chênh 4 điểm, tức là sát nhau; phụ thuộc nhiều vào việc sếp coi trọng tốc độ ra MVP (A) hay chi phí và độ độc lập (B). C bị loại vì trái ràng buộc Postgres chuẩn.

## 6. Khuyến nghị
Chọn **A** nếu ưu tiên ra MVP đúng hạn 6 đến 8 tuần. Cách giữ trong ngân sách: bắt đầu với Supabase Free và host Next.js ở nơi không giới hạn phi thương mại (ví dụ Render một web service khoảng 7 USD), hoặc chấp nhận vượt ngân sách một thời gian.

Khuyến nghị A sai nếu:
- Ngân sách dưới 25 USD là cứng và bắt buộc có Supabase Pro (không dùng Free được vì tạm dừng, không sao lưu tốt) cùng Vercel Pro.
- Kiểm thử RLS cho thấy luật phân quyền phức tạp hơn khả năng một người bảo trì.
- Dữ liệu cần ở máy chủ trong nước hoặc tự host (C2 chưa hỏi, NFR-14).

Khuyến nghị chuyển sang B nếu: ngân sách là ràng buộc cứng, hoặc muốn một tiến trình Node chạy dài để xuất báo cáo nặng không lo giới hạn hàm.
