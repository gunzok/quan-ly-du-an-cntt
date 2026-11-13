# Chiến lược kiểm thử

Ngày: 2026-11-13 · Pha 3 · Trạng thái: Chờ duyệt (phần 4: design system + chiến lược test)
Liên quan: NFR-01, NFR-02, NFR-03, NFR-06, NFR-08, NFR-13. Các ngưỡng đánh dấu "đề xuất" do Claude đề xuất, sếp chỉnh được.

## 1. Cấp kiểm thử
| Cấp | Phạm vi | Công cụ | Chạy khi |
|---|---|---|---|
| Unit | Hàm nghiệp vụ thuần trong `lib/` (tính tiến độ, kiểm vòng phụ thuộc, quy tắc BR) | Vitest (đã có) | Mọi PR, `make test` |
| Phân quyền (RLS) | Mỗi chính sách RLS, mỗi vai trò, mỗi bảng | Supabase CLI + pgTAP hoặc Vitest với CSDL cục bộ | Mọi PR |
| Integration | Route Handler `/api/v1` với CSDL Supabase cục bộ, kiểm lỗi, mã trạng thái | Vitest + Supabase CLI | Mọi PR |
| E2E | Luồng chính trên trình duyệt (xem mục 4) | Playwright | Mọi PR (luồng chính), đêm (đầy đủ) |
| Hiệu năng | 2.000 task: API P95 dưới 500 ms, xuất báo cáo dưới 30 giây | Script tải + dữ liệu seed | Trước mỗi lần phát hành |
| Trợ năng | Axe tự động trên các màn chính, kiểm tra bàn phím | `@axe-core/playwright` | E2E |
| UAT | Người dùng thật (PM, vài thành viên) | Kịch bản có sẵn | Trước release production |

## 2. Ngưỡng chất lượng (đề xuất)
- Độ phủ dòng cho `lib/` (logic nghiệp vụ): từ 80%; CI đỏ khi giảm dưới ngưỡng, bật khi có đủ mã ở Pha 5.
- Mỗi chính sách RLS có ít nhất một test cho vai trò được phép và một test cho vai trò bị từ chối (NFR-06). Không merge bảng mới thiếu test RLS.
- Mọi quy tắc BR-xx có test nghiệp vụ tương ứng, truy vết ở ma trận (cột Test, điền ở Pha 5).
- Lỗi trợ năng mức nghiêm trọng (axe critical, serious) trên màn chính làm CI đỏ.
- Bài test không được là test giả luôn xanh; test mới đi cùng thay đổi hành vi.

## 3. Dữ liệu test
- Dùng dữ liệu giả sinh ra (`supabase/seed.sql`, script tạo 2.000 task), không dữ liệu thật; repo công khai (R-002).
- Tài khoản test cho 4 vai trò nằm trong seed; mật khẩu test đặt ở biến môi trường, không commit.
- Template báo cáo mẫu trong `tests/fixtures/` (khi sếp cung cấp mẫu thật, R-005, thay bằng bản đã ẩn thông tin nhạy cảm).
- Báo cáo xuất ra so sánh với tệp chuẩn (golden file) cho một dự án seed cố định.

## 4. Luồng E2E bắt buộc
1. Đăng nhập email và Google (mô phỏng), đăng xuất.
2. Admin mời người dùng, gán vai trò; Người xem không thấy nút sửa.
3. PM tạo dự án từ template, thêm thành viên.
4. Tạo task, subtask 3 cấp (cấp 4 bị từ chối), giao việc, đặt hạn.
5. Kéo thả Kanban; chuyển danh sách; tìm kiếm và lọc.
6. Đặt phụ thuộc, thử tạo vòng (bị từ chối), hoàn thành task bị chặn (có cảnh báo).
7. Nhận thông báo trong app; bật tắt email.
8. Xem dashboard; xuất xlsx và docx theo template.
9. Đổi ngôn ngữ Việt/English; kiểm tra màn 360 px.

## 5. Môi trường
| Môi trường | Dùng cho |
|---|---|
| CI (GitHub Actions) | unit, RLS, integration, e2e luồng chính, bảo mật |
| Local | Supabase CLI chạy cục bộ, dữ liệu seed |
| Staging | UAT, kiểm thử tích hợp email thật, hiệu năng |
| Production | Chỉ kiểm tra khói sau phát hành |

## 6. Tiêu chí vào và ra UAT
**Vào UAT**: tất cả Epic MVP đã merge; CI xanh; kiểm thử RLS, e2e luồng chính đạt; hiệu năng đạt NFR-02, NFR-03; có template báo cáo thật; môi trường staging chạy ổn.
**Ra UAT** (đủ để release production): không còn lỗi mức nghiêm trọng hoặc cao đang mở; PM xác nhận báo cáo xuất ra đúng template; các câu BA còn mở đã chốt (RPO/RTO, dữ liệu cá nhân, nhắc hạn); sếp ký duyệt.

## 7. Báo lỗi và theo dõi
Lỗi ghi thành issue Linear nhãn `Bug`, gắn Epic; mức độ: nghiêm trọng (mất dữ liệu, lộ dữ liệu, sai phân quyền), cao, trung bình, thấp. Lỗi bảo mật (nhãn `Security`) xử lý trước mọi việc khác.
