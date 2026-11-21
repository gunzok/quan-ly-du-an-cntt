# Chiến lược kiểm thử

Ngày: 2026-11-13 · Pha 3 · Trạng thái: Chờ duyệt (phần 4: design system + chiến lược test)
Liên quan: NFR-01, NFR-02, NFR-03, NFR-06, NFR-08, NFR-13. Các ngưỡng đánh dấu "đề xuất" do Claude đề xuất, sếp chỉnh được.

## 1. Cấp kiểm thử
| Cấp | Phạm vi | Công cụ | Chạy khi |
|---|---|---|---|
| Unit | Hàm nghiệp vụ thuần trong `lib/` (tính tiến độ, kiểm vòng phụ thuộc, quy tắc BR) | Vitest (đã có) | Mọi PR, `make test` |
| Phân quyền (RLS) | Mỗi chính sách RLS, mỗi vai trò trong dự án (PM, Thành viên, Người xem), Admin, người ngoài dự án, mỗi bảng | Supabase CLI + pgTAP hoặc Vitest với CSDL cục bộ | Mọi PR |
| Integration | Route Handler `/api/v1` với CSDL Supabase cục bộ, kiểm lỗi, mã trạng thái | Vitest + Supabase CLI | Mọi PR |
| E2E | Luồng chính trên trình duyệt (xem mục 4) | Playwright | Mọi PR (luồng chính), đêm (đầy đủ) |
| Hiệu năng | 2.000 task: API P95 dưới 500 ms, xuất báo cáo dưới 30 giây | Script tải + dữ liệu seed | Trước mỗi lần phát hành |
| Trợ năng | Axe tự động trên các màn chính, kiểm tra bàn phím | `@axe-core/playwright` | E2E |
| Bộ component | Token, tương phản, focus, 360 px, hộp thoại và toast của `/dev/ui` (sáng/tối) | `pnpm test:ui-kit` (Playwright, `next dev`) | Cục bộ, không chạy trong CI |
| UAT | Người dùng thật (PM, vài thành viên) | Kịch bản có sẵn | Trước release production |

## 2. Ngưỡng chất lượng (đề xuất)
- Độ phủ dòng cho `lib/` (logic nghiệp vụ): từ 80%; CI đỏ khi giảm dưới ngưỡng, bật khi có đủ mã ở Pha 5.
- Mỗi chính sách RLS có ít nhất một test cho vai trò được phép và một test cho vai trò bị từ chối (NFR-06). Không merge bảng mới thiếu test RLS.
- Mọi quy tắc BR-xx có test nghiệp vụ tương ứng, truy vết ở ma trận (cột Test, điền ở Pha 5).
- Lỗi trợ năng mức nghiêm trọng (axe critical, serious) trên màn chính làm CI đỏ.
- Bài test không được là test giả luôn xanh; test mới đi cùng thay đổi hành vi.

## 3. Dữ liệu test
- Dùng dữ liệu giả sinh ra (`supabase/seed.sql`, script tạo 2.000 task), không dữ liệu thật; repo công khai (R-002).
- Hiệu năng (E0-7, PR 37): `make perf-seed` tạo dự án 2.000 task (3 cấp 400/800/800, 12 tài khoản `perf-*@example.com`, 20 nhãn, 600 quan hệ đủ 4 kiểu, đi qua trigger thật, idempotent; `make perf-clean` xóa), `make perf` đo P50/P95/P99 qua HTTP thật bằng phiên PM perf. Ngưỡng P95 (đề xuất): danh sách task (trang đầu, cursor, tìm `q` có dấu và không dấu, lọc kết hợp), `GET /projects`, `GET /projects/{id}` dưới 500 ms (NFR-02, NFR-16); `GET /tasks/{id}` và `/relations` dưới 300 ms (chặt hơn để bắt hồi quy). Số đo 2026-11-15 (M1 Pro, Supabase cục bộ, `next start`): danh sách task 38 đến 67 ms, `GET /projects` 151 ms, `GET /tasks/{id}` 38 ms. Đo tuần tự một luồng; giới hạn 300 request/phút làm mỗi lần đo mất 2 đến 3 phút. Workflow `perf.yml` chỉ chạy tay, số trên runner chung chỉ để tham khảo. Đề xuất cho E3-4: viết lại RLS `tasks_select` để quyền tính một lần mỗi truy vấn (hiện `project_stats` mất 27 ms trong CSDL vì tính quyền từng dòng).
- Tài khoản test cho 4 vai trò nằm trong seed; mật khẩu test đặt ở biến môi trường, không commit.
- Template báo cáo mẫu trong `tests/fixtures/` (khi sếp cung cấp mẫu thật, R-005, thay bằng bản đã ẩn thông tin nhạy cảm).
- Báo cáo xuất ra so sánh với tệp chuẩn (golden file) cho một dự án seed cố định.

## 4. Luồng E2E bắt buộc
1. Đăng nhập email và Google (mô phỏng), đăng xuất.
2. Admin mời người dùng; PM gán vai trò trong dự án; Người xem không thấy nút sửa. Cùng một người là PM ở dự án A, Người xem ở dự án B (vai trò theo dự án).
3. PM tạo dự án từ template, thêm thành viên.
4. Tạo task, subtask 3 cấp (cấp 4 bị từ chối), giao việc, đặt hạn.
5. Kéo thả Kanban; chuyển danh sách; tìm kiếm và lọc.
6. Đặt quan hệ chặn và đứng trước, thử tạo vòng (bị từ chối), hoàn thành task bị chặn (có cảnh báo); lưu và dùng lại chế độ xem (luồng Gantt: đợt sau cùng E12).
7. Nhận thông báo trong app; bật tắt email.
8. Xem dashboard; xuất xlsx và docx theo template.
9. Đổi ngôn ngữ Việt/English; kiểm tra màn 360 px.

Bộ 9 luồng (E0-9, PR 69): mỗi luồng một spec ở `tests/e2e/flows/` (project Playwright `flows`, chạy riêng bằng `make test-e2e E2E_ARGS=--project=flows`), dùng tài khoản tạm. `make test-e2e` bật worker email vào Mailpit cục bộ (`CRON_SECRET` ngẫu nhiên, `EMAIL_PROVIDER=mailpit`, `APP_BASE_URL`) để luồng 7 gọi `/api/internal/email/dispatch` như pg_cron. Giới hạn đã ghi: Google chỉ mô phỏng một phần (magic link bị giới hạn 2 email/giờ trên stack cục bộ dùng chung; Google thật chỉ kiểm ở staging); luồng 3 đã có lưu template và tạo dự án từ template (E7-1, PR 71); phần Gantt của luồng 6 để E12. Quy ước mới: test chạm trạng thái toàn hệ thống (worker email, template đang dùng) phải giữ khóa liên tiến trình ở `tests/support/shared-lock.ts`.
Quy ước viết e2e (E2-6, PR 45): chờ hydrate (`tests/e2e/hydration.ts`) trước khi điền form đăng nhập; ưu tiên tài khoản tạm tạo bằng khóa service thay persona seed; ma trận quyền task ở `supabase/tests/database/task-permissions-matrix.test.sql` (12 persona × 19 thao tác) và `tests/integration/task-permissions.test.ts`. Giới hạn đăng nhập theo IP (50 lần/5 phút) bị nới CHỈ khi chạy `make test-e2e` (biến `E2E_RELAXED_LOGIN_RATE_LIMIT=1`, từ chối nếu có dấu hiệu Vercel hoặc Supabase không cục bộ; `lib/api/e2e-rate-limit.ts` có test); không đổi ngưỡng ở production.
Dữ liệu tạm e2e (chore, PR 53): `tests/e2e/temp-data.ts` (`createTempUsers`, `cleanupTempData`, `sweepStaleTempData` dọn đồ sót > 2 giờ; email `e2e-<story>-<vai trò>-<tag>.com`, dự án `E2E <tag> ...`; từ chối xóa persona seed), `signInWithPassword` trong `tests/e2e/login.ts` (luôn chờ hydrate); so khớp email/tên bằng `exact: true` hoặc theo ô (getByText khớp chuỗi con làm spec đỏ khi CSDL dùng chung có tài khoản tạm). Giới hạn `loginEmail` 10 lần/15 phút mỗi email vẫn giữ trong chế độ nới; E0-9 đã chuyển hầu hết spec sang tài khoản tạm (đăng nhập một lần mỗi tài khoản), chỉ còn `projects.spec` và `admin-departments.spec` dùng persona seed vì kiểm chính dữ liệu seed (tối đa 3 lần mỗi email).
Rà 360 px và trợ năng (E10-3, PR 56): `tests/e2e/responsive-a11y.spec.ts` quét từng màn và từng hộp thoại/menu ở 360 px, sáng và tối, vai trò PM, Người xem, Admin và khách: không phần tử nào thò khỏi khung nhìn (trừ vùng cuộn ngang có chủ ý), vùng bấm ≥ 44 × 44 px theo bounding box (ngoại lệ có chú thích: liên kết trong câu, sr-only), axe WCAG 2.2 AA không critical/serious, vòng focus khi Tab, tương phản khi rê chuột, `prefers-reduced-motion`, bàn phím ảo mở (viewport 360 × 360). Spec mới thêm màn mới cần thêm vào danh sách màn của spec này. Chưa quyết: tiêu đề task trong bảng Danh sách bị cắt "…" trên điện thoại (cần thiết kế chọn xuống dòng, tooltip hay giữ nguyên).

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
