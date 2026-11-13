# ADR-004: Thư viện xuất báo cáo xlsx và docx theo template

- **Trạng thái**: Đã chấp nhận (2026-11-13)
- **Ngày**: 2026-11-13
- **Người quyết định**: Justin Tran (chủ dự án)

## Bối cảnh

PM xuất báo cáo tiến độ ra Excel và Word theo template công ty (FR-14, FR-15, BR-08, E5-3, E5-4). Chạy trên Vercel (hàm serverless có giới hạn thời gian và bộ nhớ, R-006); mục tiêu dự án 2.000 task dưới 30 giây (NFR-03). Template thật của công ty chưa có (R-005). Repo công khai nên ưu tiên giấy phép mở.

## Các phương án đã xét

| Phương án | Ưu điểm | Nhược điểm |
|---|---|---|
| A: `docx-templates` (docx) + `exceljs` (xlsx) | Giấy phép MIT theo nguồn tra cứu (docx-templates); điền dữ liệu vào template bằng JavaScript; không có phần trả phí | `exceljs`: chưa xác minh bảo trì và giấy phép trong đợt tra này; điền vào template xlsx có sẵn có thể mất một số định dạng phức tạp |
| B: `docxtemplater` (docx) + `exceljs` | Cốt lõi MIT, được bảo trì tích cực | Một số module (ví dụ hình ảnh, bảng nâng cao) là bản PRO trả phí, chưa xác minh chi tiết; một người bảo trì chính |
| C: Dịch vụ tạo báo cáo bên ngoài hoặc dùng LibreOffice trong container | Giữ nguyên định dạng tốt nhất | Thêm hạ tầng, chi phí, vượt ngân sách 25 USD/tháng; không hợp serverless |

## Quyết định (đề xuất)

Thử **A** trước bằng spike nhỏ ở đầu Story E5-3: điền dữ liệu giả vào template mẫu xlsx và docx, đo thời gian với 2.000 task. Nếu đạt NFR-03 và giữ đúng định dạng của template thật thì chốt A; nếu không, đổi sang B (kiểm tra chi tiết phần trả phí) trước khi viết tiếp.

Điều kiện đi kèm:
- Chạy trong Route Handler với runtime Node, không dùng Edge runtime.
- Kiểm tra giấy phép từng thư viện ở kho chính thức trước khi thêm vào `package.json` (CI quét phụ thuộc).
- Tệp template lưu ở Supabase Storage, chỉ Admin tải lên (BR-08).

## Hệ quả

- Dễ hơn: báo cáo sinh hoàn toàn bằng TypeScript, kiểm thử bằng tệp chuẩn (golden file).
- Khó hơn hoặc rủi ro mới: R-006 (giới hạn serverless) và R-005 (chưa có template thật) vẫn mở; có thể phải đổi thư viện sau spike.

## Điều kiện xem xét lại

- Spike không đạt NFR-03 hoặc không giữ đúng định dạng template thật.
- Hàm serverless hết thời gian với dự án lớn (khi đó xem lại ADR-001).

## Nguồn tham khảo

- docxtemplater: MIT cho phần cốt lõi, có module PRO trả phí — [trang dự án](https://www.docxtemplater.com/faq), [GitHub](https://github.com/open-xml-templating/docxtemplater) — ngày tra 2026-11-13.
- docx-templates: MIT, bảo trì "healthy" theo [Snyk Advisor](https://dev.snyk.io/advisor/npm-package/docx-templates) (có thể cũ) — ngày tra 2026-11-13.
- exceljs: **chưa xác minh** (tra cứu không trả về kết quả).
