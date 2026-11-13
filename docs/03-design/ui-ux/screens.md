# Danh sách màn hình

Ngày: 2026-11-13 · Pha 3 · Mockup v1 và v2: canvas "Quản lý Dự án CNTT - UI/UX" (xem link trong [review-log.md](review-log.md)); mã nguồn mockup ở [mockups/v1/](mockups/v1/).
Chỉ màn có trạng thái "Đã duyệt" trong [review-log.md](review-log.md) mới được code.

| Mã | Màn | Mục đích | Use case, Epic | Actor | Mockup |
|---|---|---|---|---|---|
| S01 | Đăng nhập | Vào hệ thống bằng email/mật khẩu hoặc Google, đổi ngôn ngữ | UC-01, UC-13, E1, E10 | Mọi vai trò | `Main.dc.html` |
| S02 | Danh sách dự án | Xem dự án của mình, tiến độ, trễ hạn, tạo dự án | UC-03, UC-04, E2 | Mọi vai trò | `Projects.dc.html` |
| S03 | Bảng Kanban | Xem, kéo thả task theo trạng thái, lọc nhanh | UC-05, UC-06, E2, E3 | Mọi vai trò (Người xem chỉ đọc) | `Kanban.dc.html` |
| S04 | Danh sách task và bộ lọc | Xem task dạng bảng, subtask 3 cấp, tìm kiếm, lọc | UC-05, UC-07, E3 | Mọi vai trò | `List.dc.html` |
| S05 | Chi tiết task (v2) | Sửa task: loại, ngày bắt đầu, ngày kết thúc, việc con, nhiều kiểu quan hệ, cảnh báo bị chặn, nhật ký task | UC-05, UC-08, UC-12, E2, E6, E8 | PM, Thành viên, Admin | `mockups/v2/TaskDetail.dc.html` (v1 giữ ở `mockups/v1/`) |
| S06 | Dashboard tiến độ | % hoàn thành, trễ hạn, phân bố, theo người | UC-10, E5 | PM, Người xem, Admin | `Dashboard.dc.html` |
| S07 | Xuất báo cáo | Chọn định dạng, kỳ, template, tải file | UC-11, E5 | PM, Admin | `Report.dc.html` |
| S08 | Quản lý người dùng (v2) | Mời, gán phòng ban, cấp quyền Admin, khóa/mở; hiển thị Phòng ban, số dự án tham gia | UC-02, E1 | Admin | `mockups/v2/Admin.dc.html` |
| S09 | Kanban trên điện thoại | Dùng được từ 360 px, vùng bấm 44 px, thay kéo thả bằng menu | FR-18, NFR-10, E10 | Mọi vai trò | `Mobile.dc.html` |
| S10 | Kanban chế độ tối | Kiểm tra token chế độ tối | NFR-11 liên quan chế độ sáng/tối | Mọi vai trò | `KanbanDark.dc.html` |
| S11 | Gantt | Xem task theo ngày bắt đầu, kết thúc, quan hệ đứng trước/đứng sau, kéo chỉnh ngày | UC-15, FR-20, E12 | PM, Thành viên (Người xem chỉ đọc) | `Gantt.dc.html` (v1) |
| S12 | Chế độ xem đã lưu và mặc định | Dùng, tạo, lưu chế độ xem; bảng phân cấp | UC-14, UC-16, FR-19, FR-22, E13, E3 | Mọi vai trò | `ListViews.dc.html` (v1) |

## Chưa có mockup (sẽ làm theo quy trình duyệt từng màn trước khi code)
- Hộp thoại tạo dự án, chọn template (UC-03, UC-04).
- Hộp thoại tạo task nhanh (UC-05).
- Màn nhật ký hoạt động của dự án (UC-12).
- Ngăn thông báo và cài đặt thông báo email (UC-09).
- Màn quản lý template dự án và template báo cáo (UC-04, BR-08).
- Màn hồ sơ cá nhân, đổi ngôn ngữ, chế độ sáng/tối.

## Trạng thái bắt buộc cho mọi màn danh sách và trang
| Trạng thái | Yêu cầu |
|---|---|
| Đang tải | Skeleton, không giật bố cục |
| Rỗng | Thông điệp, hành động tiếp theo (ví dụ "Tạo task đầu tiên") |
| Lỗi | Thông điệp dễ hiểu, nút thử lại, không lộ chi tiết kỹ thuật |
| Chỉ đọc (Người xem) | Ẩn hoặc vô hiệu hóa nút sửa, kèm giải thích |
| Không có quyền | Hiển thị "không tìm thấy" (BR-10), không lộ sự tồn tại |

Mockup v1 hiện mới thể hiện trạng thái có dữ liệu; trạng thái rỗng, tải, lỗi sẽ được bổ sung cho các màn đã duyệt trước khi code.
