# Nhật ký duyệt UI/UX

Quy trình: mỗi màn được sếp duyệt riêng (Duyệt, Chỉnh nhỏ, Không duyệt). Chỉnh nhỏ hoặc không duyệt thì làm phiên bản mới (v2, v3), không sửa đè bản cũ. Chỉ màn "Đã duyệt" mới được code.

Canvas mockup v1: https://claude.ai/artifact/6TYQPPKUomg2eNFQ139uGW (riêng tư, chỉ chủ tài khoản mở được).

| Màn | Phiên bản | Ngày | Quyết định | Phản hồi |
|---|---|---|---|---|
| S01 Đăng nhập | v1 | 2026-11-13 | Đã duyệt (sau khi sếp chuyển hướng sang OpenProject, duyệt lại cùng ngày) | "Nghiên cứu chức năng và giao diện OpenProject để làm theo tương tự, team đang dùng công cụ này nên muốn chuyển đổi mà không phải làm quen lại từ đầu." Sau đó chọn: giống thuật ngữ và chức năng, giữ giao diện hiện đại v1. S01 chờ duyệt lại |
| S02 Danh sách dự án | v1 | 2026-11-13 | Đã duyệt | |
| S03 Bảng Kanban | v1 | 2026-11-13 | Đã duyệt | |
| S04 Danh sách task và bộ lọc | v1 | 2026-11-13 | Đã duyệt | Thêm cột Loại, ngày bắt đầu, chế độ xem đã lưu sẽ làm ở S12 (màn mới) thay vì sửa S04 |
| S05 Chi tiết task | v1 | 2026-11-13 | Thay bằng v2 | Cần loại task, ngày bắt đầu, nhiều kiểu quan hệ theo OpenProject |
| S05 Chi tiết task | v2 | 2026-11-13 | Đã duyệt | Thêm Loại, Ngày bắt đầu, mục Quan hệ nhiều kiểu |
| S06 Dashboard tiến độ | v1 | 2026-11-13 | Đã duyệt | |
| S07 Xuất báo cáo | v1 | 2026-11-13 | Đã duyệt | Nội dung báo cáo vẫn chờ template mẫu (R-005) |
| S08 Quản lý người dùng | v1 | 2026-11-13 | Thay bằng v2 | "Quản lý người dùng hiển thị cả bộ phận làm việc của người dùng đó theo tên Phòng ban"; vai trò chuyển sang theo dự án |
| S08 Quản lý người dùng | v2 | 2026-11-13 | Đã duyệt | Thêm cột Phòng ban, Quyền (Admin/Không), Dự án tham gia; lọc theo Phòng ban |
| S09 Kanban trên điện thoại | v1 | 2026-11-13 | Đã duyệt | |
| S10 Kanban chế độ tối | v1 | 2026-11-13 | Đã duyệt | |
| S11 Gantt | v1 | 2026-11-13 | Đã duyệt | Mới: team dùng Gantt hằng ngày |
| S12 Chế độ xem đã lưu và mặc định | v1 | 2026-11-13 | Đã duyệt | Mới: theo OpenProject |
| Style guide, S06 Dashboard, S03 Kanban | v3 (Blueprint) | 2026-11-13 | Chờ duyệt | "Nghiên cứu phong cách dribbble.com/samoctav và áp dụng vào thiết kế app, đưa vào system design". File: [mockups/v3/blueprint-preview.html](mockups/v3/blueprint-preview.html), có nút chuyển sáng, tối |
| Cả 12 màn trên canvas (S01 đến S12) | Đổi màu Blueprint | 2026-11-13 | Chờ duyệt | "Sử dụng luôn artifact quản lý dự án CNTT này, chỉ thay đổi thiết kế màu sắc, không thay đổi chức năng hệ thống". Chỉ đổi mã màu theo design-system v2 (đã kiểm tra bằng code: ngoài mã màu, nội dung không đổi); hồng chỉ ở huy hiệu thông báo, vạch hôm nay (Gantt), chuỗi Chờ review (Dashboard). Bản mockup v1, v2 trong repo cập nhật theo |
| S01 đến S12 | v3 Blueprint toàn diện (xem thử) | 2026-11-13 | Chờ duyệt | "Thay đổi toàn diện để xem thử review trước khi duyệt áp dụng". 12 artboard `bp-*.dc.html` trên trang "Blueprint toàn diện (xem thử)" của canvas; bản đã duyệt giữ nguyên ở trang "Đã duyệt". Thay đổi: phông 3 lớp, nhãn mono đánh số, khung app, ô KPI số lớn, thanh tiến độ mảnh, hàng thuộc tính, lưới bản vẽ, mã task trên thẻ. Không đổi màn hình, luồng, chức năng. S13 đến S19 (mới thêm vào canvas) chưa có bản Blueprint |
| S01 đến S19 | Blueprint (v3) | 2026-11-13 | Đã duyệt | "Duyệt, làm hết các màn hình". Design system v2 Blueprint đã duyệt; làm thêm bản Blueprint cho S13 đến S19 (màn bổ sung sprint 1, E0-8); nối liên kết Thông báo, Nhật ký, Template, Hồ sơ giữa các màn. Trang Blueprint là trang chính của canvas, bản cũ chuyển sang trang lưu trữ |
