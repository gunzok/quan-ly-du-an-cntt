# Nghiên cứu phong cách: Samuel Oktavianus (Dribbble samoctav)

Ngày: 2026-11-13 · Pha 3 (bổ sung) · Trạng thái: Đã duyệt (2026-11-13)
Yêu cầu của sếp: nghiên cứu phong cách https://dribbble.com/samoctav, áp dụng vào app và đưa vào design system.

## 1. Nguồn
| Nguồn | Nội dung | Cách lấy |
|---|---|---|
| 3 ảnh chụp màn hình sếp gửi (2026-11-13) | 30 shot dự án "ordivalabs" (thương hiệu ORDIVA, tự động hóa phòng thí nghiệm y sinh) | Sếp chụp từ Dribbble |
| [Shot 27819600](https://dribbble.com/shots/27819600-ordivalabs-Biotech-Laboratory-Automation-Process-Section-UI) | "ordivalabs: Biotech Laboratory Automation - Process Section UI" | Đường dẫn hiện trên thanh trạng thái trong ảnh 2 |
| [Shot 27819605](https://dribbble.com/shots/27819605-ordivalabs-Biotech-Meets-Robotics-Autonomous-Lab-Website-UI) | "ordivalabs: Biotech Meets Robotics - Autonomous Lab Website UI" | Đường dẫn hiện trên thanh trạng thái trong ảnh 3 |
| [Hồ sơ Dribbble](https://dribbble.com/samoctav), [Behance](https://www.behance.net/samueloktavianus) | Nhà thiết kế web, UI/UX mảng y sinh và y tế, ở Singapore | Kết quả tìm kiếm web; môi trường không mở được trang trực tiếp |

Giới hạn: chỉ phân tích các shot của dự án ordivalabs (trong ảnh sếp gửi), chưa xem các dự án khác. Tên ORDIVA, logo, ảnh robot và ảnh 3D thuộc về tác giả và khách hàng của họ. App **chỉ học nguyên tắc** (màu, chữ, bố cục, cách trình bày số liệu), không sao chép tên, logo, hình minh họa hay bố cục trang cụ thể.

## 2. Màu (đo bằng Python trên ảnh)
Cách đo: thu nhỏ ảnh, gom các điểm ảnh cùng nhóm màu rồi lấy trung bình.
| Màu | Mã đo được | Số điểm ảnh mẫu | Vai trò quan sát được |
|---|---|---|---|
| Xanh điện (electric blue) | `#2054F0` | 49.953 | Màu chính: nền khung, nút, chữ tiêu đề, nét bản vẽ |
| Hồng | `#E56DAF` | 8.487 | Điểm nhấn nhỏ: dấu chấm cuối tiêu đề, chấm trước nhãn, nhãn "Status: OK", 1 thanh số liệu, chi tiết trong ảnh |
| Đen gần tuyệt đối | `#030304` | 19.475 | Nền trình bày, nền chế độ tối |
| Trắng xám | `#F8F8F8` | nhiều nhất cả 3 ảnh | Nền thẻ, nền trang |
| Xanh nhạt ngả tím | `#CDDBF2` | 6.991 | Nền chuyển màu nhẹ quanh khung trắng |

Quan sát thêm: có dải chuyển màu xanh → tím → hồng ở nền khung lớn; xám trung tính dùng cho thanh số liệu thứ ba và chữ phụ.

## 3. Đặc điểm phong cách (quan sát trực tiếp trên ảnh)
| # | Đặc điểm | Ví dụ trong ảnh |
|---|---|---|
| 1 | Tiêu đề lớn, nét mảnh (light hoặc regular), chữ hoa đầu từ, kết thúc bằng **dấu chấm màu hồng** | "Science In Constant Motion.", "Has Arrived." |
| 2 | Có lúc dùng tiêu đề chữ in hoa rất lớn, đậm | "THE AGE OF BIO AUTOMATION" |
| 3 | **Nhãn nhỏ phông mono, in hoa, giãn chữ**, có chấm hồng phía trước | "● AUTONOMOUS LAB SYSTEM", "● THE NUMBERS" |
| 4 | **Đánh số kỹ thuật** dạng `01 / PREPARATION`, `001 / PREPARE`, `LAB / 001` | Mục quy trình, danh sách |
| 5 | **Hình nét bản vẽ kỹ thuật (blueprint)**: lưới, vòng tròn ngắm, đường kích thước; nét trắng trên nền xanh hoặc nét xanh trên nền trắng | Hầu hết các shot |
| 6 | **Số liệu lớn kèm chú thích mono nhỏ** | "22.6M APPLICATIONS", "96.2% SAMPLE PREPARATION", "87.8x" |
| 7 | **Thanh tiến độ mảnh** xanh, hồng, xám, có thang 0–100 và vạch đánh dấu | "The Statistics": 10x, 99.8%, 21.8M |
| 8 | **Hàng thông số khóa và giá trị** phông mono, ngăn bằng đường kẻ mảnh | "AREA 96.16 CM", "SPEED 15 MP/S" |
| 9 | Danh sách có đường kẻ mảnh và mũi tên ↗ ở cuối dòng | "01 BIOTECH STUFF ↗" |
| 10 | Bộ biểu tượng nét mảnh màu xanh, có **chấm hồng** làm điểm nhấn, nhãn in hoa giãn chữ | PREPARE, TRANSFER, PROCESS, ANALYZE |
| 11 | Nút chính màu xanh đặc, bo góc nhỏ, có "→"; nút phụ viền xanh mảnh; ô tìm kiếm là ô vuông viền | "Explore …  →", "Contact →" |
| 12 | Nhãn dạng viên thuốc (pill) màu hồng | "Status: OK", "● LAB / 001", "A NEW MODEL" |
| 13 | Menu có dấu "+" phía trước | "+ Technology", "+ Process" |
| 14 | **Khung trắng đặt trong khung màu lớn** (xanh hoặc chuyển màu) bo góc lớn; thẻ bên trong bo góc nhỏ, gần như không có bóng, chia cột bằng đường kẻ dọc mảnh | Trang chủ, khối thống kê |
| 15 | Chú giải bằng ô vuông màu (xanh, hồng, xám) kèm mã | "ODV-448", "ODV-152", "ODV-112" |
| 16 | Nhiều khoảng trắng, chữ nội dung nhỏ, mật độ vừa | Mọi shot |

Phông chữ: ảnh không ghi tên phông nên em không xác định được. Nhìn thấy hai nhóm: chữ không chân dạng grotesk (nét mảnh ở tiêu đề) và chữ mono cho nhãn, số.

## 4. Áp dụng vào app quản lý dự án
Đặt tên phong cách: **"Blueprint"** (bản vẽ kỹ thuật). Giữ quyết định đã duyệt: gọn, nhiều thông tin, sáng và tối, Inter, đạt WCAG 2.1 AA.

| Đặc điểm (mục 3) | Áp dụng trong app | Màn hình |
|---|---|---|
| 1, 2 | Tiêu đề trang dùng Inter Tight nét 300–400, chấm hồng cuối tiêu đề lớn (chỉ trang tổng quan, đăng nhập, trạng thái rỗng); bảng và form giữ Inter 14px | S01, S02, S06 |
| 3, 4 | Nhãn nhóm, tiêu đề cột Kanban, mã task dùng JetBrains Mono in hoa: `01 / CẦN LÀM`, `QLDA-128` | S03, S04, S05, S11 |
| 5 | Lưới bản vẽ chỉ dùng ở nền đăng nhập, khung trang, trạng thái rỗng; **không** dùng trong bảng dữ liệu để giữ mật độ | S01, trạng thái rỗng |
| 6, 7 | Ô KPI: số lớn kèm chú thích mono; thanh tiến độ mảnh 4px có thang và vạch kế hoạch | S06, S02 |
| 8 | Ngăn chi tiết task: thuộc tính dạng hàng khóa và giá trị, kẻ mảnh | S05 |
| 9, 13 | Danh sách dự án, menu thanh bên có số thứ tự và ↗ hoặc "+" | S02, thanh bên |
| 10 | Bộ biểu tượng nét 1,5px (Lucide), chấm hồng chỉ cho trạng thái "mới" hoặc "cần chú ý" | Toàn app |
| 11, 12 | Nút theo token mới; nhãn pill cho trạng thái và nhãn | Toàn app |
| 14 | Khung ứng dụng: thanh bên và nội dung đặt trong khung trắng bo 20px trên nền xanh nhạt (màn hình rộng từ 1280px trở lên); thẻ trong bo 6–10px, dùng viền, không bóng | Khung chung |
| 15 | Chú giải biểu đồ bằng ô vuông màu kèm chữ | S06, S11 |

Màu hồng: tương phản trên nền trắng chỉ 2,94:1, **không dùng cho chữ, cũng không làm tín hiệu duy nhất**. Chữ màu hồng dùng biến thể đậm `#B0256E` (6,30:1). Chi tiết token ở [design-system.md](design-system.md).
