# WBS và kế hoạch sprint

Ngày: 2026-11-13 · Pha 4 · Trạng thái: Chờ duyệt
Sinh tự động từ [plan.py](plan.py) (chạy `python3 docs/04-wbs/plan.py [velocity]`); mọi con số do script tính.

## 1. Giả định
| Mục | Giá trị |
|---|---|
| Thang ước lượng | Story point Fibonacci 1, 2, 3, 5, 8; Story trên 8 điểm phải tách |
| Sprint | 1 tuần, bắt đầu thứ Hai 2026-11-16 |
| Velocity giả định | Baseline đã duyệt: 20 điểm mỗi sprint. Lịch dưới đây xếp theo **30 điểm mỗi sprint** (mức cần để giữ hạn 8 tuần sếp đã chọn); chỉ là giả định, hiệu chỉnh từ sprint 2 bằng velocity thật |
| Điểm Story | Ước lượng của Claude, chưa có dữ liệu thật; độ lệch dự kiến lớn ở Gantt, xuất báo cáo, RLS |
| Đường cắt MVP | Story Must; Should làm sau Must nếu còn thời gian; Could, Gantt (E12), E9, E11, E14 ngoài MVP (quyết định của sếp 2026-11-13: giữ hạn 8 tuần, bỏ Gantt khỏi MVP) |

## 2. Tổng điểm
| Epic | Tổng | Must | Should | Could và đợt sau |
|---|---|---|---|---|
| E0 Hạ tầng và chất lượng | 45 | 39 | 6 | 0 |
| E1 Nền tảng, đăng nhập, RBAC | 29 | 27 | 2 | 0 |
| E2 Dự án và task cốt lõi | 34 | 34 | 0 | 0 |
| E3 Chế độ xem và tìm kiếm | 24 | 24 | 0 | 0 |
| E4 Thông báo | 15 | 10 | 5 | 0 |
| E5 Dashboard và báo cáo tiến độ | 29 | 26 | 3 | 0 |
| E6 Nhật ký hoạt động | 10 | 5 | 5 | 0 |
| E7 Template dự án | 8 | 0 | 0 | 8 |
| E8 Quan hệ giữa các task | 13 | 13 | 0 | 0 |
| E10 Đa ngôn ngữ và responsive | 18 | 18 | 0 | 0 |
| E12 Timeline/Gantt (đợt sau) | 29 | 0 | 0 | 29 |
| E13 Chế độ xem đã lưu | 15 | 15 | 0 | 0 |
| **Toàn dự án** | **269** | **211** | **21** | **8** |

Epic ngoài MVP chưa ước lượng: E9 Theo dõi thời gian; E11 Cộng tác mở rộng (bình luận, tệp, thùng rác); E14 Nhập dữ liệu từ OpenProject.

## 3. Kết quả kế hoạch và đánh giá R-003, R-009
- Điểm Must (đường cắt MVP): **211**; với velocity 30 cần **8 sprint (8 tuần)**, kết thúc khoảng 2027-01-08.
- Mục tiêu đã duyệt là MVP **6 đến 8 tuần** (6 đến 8 sprint). Kế hoạch nằm trong mục tiêu, **với điều kiện velocity thật đạt khoảng 30 điểm mỗi sprint** (baseline đã duyệt là 20, rủi ro R-003 còn cao).

### Kịch bản (tính bằng code)
| Kịch bản | Điểm Must | Velocity 20 | Velocity 25 | Velocity 30 |
|---|---|---|---|---|
| Phạm vi đã chốt (Must, không Gantt) | 211 | 12 sprint | 9 sprint | 8 sprint |
| Bỏ thêm chế độ xem đã lưu (E13) | 196 | 11 sprint | 9 sprint | 7 sprint |
| Bỏ thêm E13 và quan hệ giữa task (E8) | 183 | 10 sprint | 8 sprint | 7 sprint |
| Bỏ thêm E13, E8 và Dashboard, báo cáo (E5) | 157 | 9 sprint | 7 sprint | 6 sprint |

Để giữ nguyên phạm vi Must trong 8 sprint cần velocity thật từ khoảng 28 điểm mỗi sprint (tính theo cách xếp Story và phụ thuộc ở trên); nếu velocity thật vẫn là 20 thì cần cắt phạm vi hoặc kéo dài hạn. Quyết định thuộc về sếp ở gate.

### Danh sách cắt dự phòng nếu velocity thật thấp hơn 28 (theo thứ tự cắt, giá trị trên mỗi điểm thấp nhất trước)
| Thứ tự | Story | Điểm | Điểm Must còn lại | Velocity tối thiểu xấp xỉ cho 8 sprint |
|---|---|---|---|---|
| 1 | E13-3 | 5 | 206 | 26 |
| 2 | E8-3 | 3 | 203 | 26 |
| 3 | E10-3 | 5 | 198 | 25 |
| 4 | E5-4 | 8 | 190 | 24 |
| 5 | E13-2 | 5 | 185 | 24 |
| 6 | E13-1 | 5 | 180 | 23 |

Thứ tự này cần sếp xác nhận khi phải cắt; riêng E5-4 (docx) chỉ cắt nếu báo cáo xlsx đã đủ dùng.

## 4. Lịch sprint (velocity 30)
| Sprint | Tuần | Điểm | Story |
|---|---|---|---|
| 1 | 16/11 đến 20/11 | 29 | E0-1, E0-6, E0-8, E1-1, E1-3, E1-2 |
| 2 | 23/11 đến 27/11 | 28 | E10-1, E0-2, E0-3, E1-4, E10-2 |
| 3 | 30/11 đến 04/12 | 29 | E2-1, E2-2, E0-5, E1-5, E1-6, E2-3 |
| 4 | 07/12 đến 11/12 | 27 | E2-4, E2-6, E0-7, E2-5, E2-7, E3-1 |
| 5 | 14/12 đến 18/12 | 26 | E3-3, E6-1, E13-1, E3-2, E3-4 |
| 6 | 21/12 đến 25/12 | 30 | E13-2, E8-1, E13-3, E4-1, E5-1, E5-2 |
| 7 | 28/12 đến 01/01 | 26 | E8-2, E8-3, E10-3, E4-2, E5-3 |
| 8 | 04/01 đến 08/01 | 16 | E0-9, E5-4 |
| 9 | 11/01 đến 15/01 | 21 | E0-10, E0-4, E6-2, E4-3, E1-7, E5-5 |
| 10 | 18/01 đến 22/01 | 8 | E7-1 |
| 11 | 25/01 đến 29/01 | 29 | E12-1, E12-2, E12-3, E12-4 |

Sprint nào chỉ chứa Should hoặc Could nằm sau đường cắt MVP.

## 5. Bảng Story
| Story | Epic | Tên | Điểm | Ưu tiên | Sprint | Phụ thuộc |
|---|---|---|---|---|---|---|
| E0-1 | E0 | Khung Supabase cục bộ, migration đầu tiên và seed | 5 | Must | 1 | không |
| E0-6 | E0 | Quyết định ADR còn mở: email, bộ lập lịch, xuất báo cáo, thư viện UI | 3 | Must | 1 | không |
| E0-8 | E0 | Mockup 6 màn còn thiếu và duyệt từng màn | 5 | Must | 1 | không |
| E1-1 | E1 | Đăng nhập email/mật khẩu, đăng xuất, phiên cookie (S01) | 5 | Must | 1 | E0-1 |
| E1-2 | E1 | Đăng nhập Google | 3 | Must | 1 | E1-1 |
| E1-3 | E1 | Schema người dùng, phòng ban, dự án, thành viên và RLS vai trò theo dự án | 8 | Must | 1 | E0-1 |
| E0-2 | E0 | Môi trường staging, production và CD thật | 5 | Must | 2 | E0-1 |
| E0-3 | E0 | Khung kiểm thử RLS, integration và e2e trong CI | 5 | Must | 2 | E0-1 |
| E1-4 | E1 | Admin mời người dùng, khóa/mở, cấp quyền Admin (S08 v2) | 5 | Must | 2 | E1-1, E1-3 |
| E10-1 | E10 | Khung UI theo design system (token, component nền, sáng/tối) | 8 | Must | 2 | E0-1 |
| E10-2 | E10 | Khung i18n Việt/Anh và lưu lựa chọn | 5 | Must | 2 | E10-1 |
| E0-5 | E0 | Bảo mật nền: CSP, header, giới hạn tần suất, CSRF | 5 | Must | 3 | E0-1 |
| E1-5 | E1 | Danh mục Phòng ban và lọc người dùng theo Phòng ban | 3 | Must | 3 | E1-4 |
| E1-6 | E1 | PM gán vai trò thành viên dự án | 3 | Must | 3 | E1-3, E2-1 |
| E2-1 | E2 | Danh sách dự án, tạo, sửa, lưu trữ dự án (S02) | 5 | Must | 3 | E1-3 |
| E2-2 | E2 | Task: tạo, sửa, xóa vĩnh viễn có xác nhận (API) | 8 | Must | 3 | E1-3 |
| E2-3 | E2 | Trạng thái tùy chỉnh, loại task và nhãn theo dự án | 5 | Must | 3 | E2-1 |
| E0-7 | E0 | Dữ liệu 2.000 task và script hiệu năng | 3 | Must | 4 | E0-1, E2-2 |
| E2-4 | E2 | Subtask tối đa 3 cấp và quy tắc đóng task cha | 5 | Must | 4 | E2-2 |
| E2-5 | E2 | Ngăn chi tiết task (S05 v2) | 5 | Must | 4 | E2-2, E2-3 |
| E2-6 | E2 | Quyền sửa task theo vai trò và kiểm thử | 3 | Must | 4 | E2-2, E1-3 |
| E2-7 | E2 | Giao diện cấu hình dự án: trạng thái, loại task, nhãn | 3 | Must | 4 | E2-3 |
| E3-1 | E3 | Bảng Kanban kéo thả và menu chuyển cột (S03, S09) | 8 | Must | 4 | E2-3, E2-2 |
| E13-1 | E13 | Chế độ xem đã lưu: schema, API, RLS | 5 | Must | 5 | E3-3 |
| E3-2 | E3 | Bảng phân cấp thu gọn, nhóm, chọn cột (S04, S12) | 8 | Must | 5 | E2-4 |
| E3-3 | E3 | Tìm kiếm văn bản có dấu tiếng Việt và bộ lọc | 5 | Must | 5 | E2-2 |
| E3-4 | E3 | Phân trang cursor và hiệu năng 2.000 task | 3 | Must | 5 | E3-3, E0-7 |
| E6-1 | E6 | Ghi nhật ký mọi thay đổi (chỉ INSERT) | 5 | Must | 5 | E2-2 |
| E13-2 | E13 | Chế độ xem mặc định và danh sách chế độ xem (S12) | 5 | Must | 6 | E13-1, E3-2 |
| E13-3 | E13 | Lưu, sửa, xóa, công khai, yêu thích chế độ xem | 5 | Must | 6 | E13-2 |
| E4-1 | E4 | Thông báo trong app | 5 | Must | 6 | E2-2, E0-8 |
| E5-1 | E5 | Dashboard tiến độ (S06) | 5 | Must | 6 | E2-3 |
| E5-2 | E5 | Quản lý template báo cáo (Admin tải lên) | 5 | Must | 6 | E1-3 |
| E8-1 | E8 | Quan hệ giữa task: schema, trigger chống vòng, API | 5 | Must | 6 | E2-2 |
| E10-3 | E10 | Responsive 360 px và kiểm tra trợ năng cho màn chính | 5 | Must | 7 | E3-1, E10-1 |
| E4-2 | E4 | Email giao việc | 5 | Must | 7 | E4-1, E0-6 |
| E5-3 | E5 | Xuất báo cáo xlsx theo template (S07) | 8 | Must | 7 | E5-2, E5-1, E0-6 |
| E8-2 | E8 | Giao diện quản lý quan hệ (S05 v2) | 5 | Must | 7 | E8-1, E2-5 |
| E8-3 | E8 | Cảnh báo task bị chặn | 3 | Must | 7 | E8-1, E3-1 |
| E0-9 | E0 | Bộ test e2e luồng chính (9 luồng) | 8 | Must | 8 | E3-1, E8-2, E5-3 |
| E5-4 | E5 | Xuất báo cáo docx theo template | 8 | Must | 8 | E5-3 |
| E0-10 | E0 | Quy trình migration lên staging/production và sao lưu | 3 | Should | 9 | E0-2 |
| E0-4 | E0 | Giám sát lỗi, uptime và log có cấu trúc | 3 | Should | 9 | E0-2 |
| E1-7 | E1 | Hồ sơ cá nhân và ngôn ngữ ưa thích | 2 | Should | 9 | E1-1, E0-8 |
| E4-3 | E4 | Nhắc hạn bằng bộ lập lịch, tùy chọn bật tắt | 5 | Should | 9 | E4-2 |
| E5-5 | E5 | Kiểm thử xuất 2.000 task và golden file | 3 | Should | 9 | E5-4, E0-7 |
| E6-2 | E6 | Xem và lọc nhật ký | 5 | Should | 9 | E6-1, E0-8 |
| E7-1 | E7 | Lưu dự án thành template và tạo dự án từ template | 8 | Could | 10 | E2-3, E2-4, E0-8 |
| E12-1 | E12 | Spike Gantt: chọn thư viện, prototype 500 task | 5 | Đợt sau | 11 | E2-2 |
| E12-2 | E12 | Gantt: thanh theo ngày, cột tiêu đề, thu phóng, vạch hôm nay (S11) | 8 | Đợt sau | 11 | E12-1, E2-2 |
| E12-3 | E12 | Gantt: kéo chỉnh ngày và kiểm tra BR-13 | 8 | Đợt sau | 11 | E12-2 |
| E12-4 | E12 | Gantt: hiển thị quan hệ và lập lịch | 8 | Đợt sau | 11 | E12-2, E8-1 |

Chi tiết từng Story (câu chuyện, tiêu chí Given/When/Then, tham chiếu, Task) ở thư mục [stories/](stories/).

## 6. Definition of Ready
Story chỉ được kéo vào sprint khi: (1) tiêu chí chấp nhận rõ; (2) màn hình liên quan đã duyệt (xem [review-log.md](../03-design/ui-ux/review-log.md)); (3) đã ước lượng; (4) không bị chặn bởi phụ thuộc chưa xong; (5) các điểm **[CẦN XÁC NHẬN]** liên quan đã được chốt.

## 7. Điểm cần chốt trước khi sprint tương ứng bắt đầu
| Điểm | Chặn Story | Cần trước sprint |
|---|---|---|
| Danh sách loại task và trạng thái mặc định | E2-3 | 3 |
| Cách tìm kiếm có dấu tiếng Việt | E3-3 | 5 |
| Template báo cáo Word/Excel mẫu của công ty (R-005) | E5-2, E5-3, E5-4 | 6 |
| Dịch vụ email (ADR-002) | E4-2 | 7 |
| Quyết định lập lịch Gantt tự động hay thủ công | E12-3, E12-4 | 11 |
| Thuật ngữ chính thức, kiểu quan hệ vào MVP | E8-1, E2-3 | 6 |
| Nhắc hạn trước bao lâu | E4-3 | 9 |
| Mockup 6 màn còn thiếu (E0-8) | E4-1, E5-2, E6-2, E7-1, E1-7 | 1 |
