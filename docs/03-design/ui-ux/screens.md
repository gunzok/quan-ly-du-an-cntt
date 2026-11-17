# Danh sách màn hình

Ngày: 2026-11-13 · Pha 3 · Mockup v1 và v2: canvas "Quản lý Dự án CNTT - UI/UX" (xem link trong [review-log.md](review-log.md)); mã nguồn mockup ở [mockups/v1/](mockups/v1/).
Chỉ màn có trạng thái "Đã duyệt" trong [review-log.md](review-log.md) mới được code.

| Mã | Màn | Mục đích | Use case, Epic | Actor | Mockup |
|---|---|---|---|---|---|
| S01 | Đăng nhập | Vào hệ thống bằng email/mật khẩu hoặc Google, đổi ngôn ngữ | UC-01, UC-13, E1, E10 | Mọi vai trò | `Main.dc.html` |
| S02 | Danh sách dự án | Xem dự án của mình, tiến độ, trễ hạn, tạo dự án | UC-03, UC-04, E2 | Mọi vai trò | `Projects.dc.html`. Đã code ở E2-1 (PR 27): là trang chủ `/` sau đăng nhập; tab Đang hoạt động / Đã lưu trữ có số đếm, tìm theo tên, tiến độ tính theo `completed_at` nên hiện 0% cho đến khi E2-3 (đã merge) cho task vào trạng thái nhóm done |
| S03 | Bảng Kanban | Xem, kéo thả task theo trạng thái, lọc nhanh | UC-05, UC-06, E2, E3 | Mọi vai trò (Người xem chỉ đọc) | `Kanban.dc.html`. Đã code ở E3-1 (PR 41): trang dự án `/projects/{id}` là bảng Kanban; kéo thả bằng -kit (chuột, chạm giữ 250 ms, bàn phím), menu "Chuyển đến cột", lọc nhanh và tìm bỏ dấu; Người xem chỉ đọc; tải hết task rồi nhóm ở trình duyệt (mỗi cột hiện 50 thẻ đầu), cần API sắp theo position nếu chậm (E3-4) |
| S04 | Danh sách task và bộ lọc | Xem task dạng bảng, subtask 3 cấp, tìm kiếm, lọc | UC-05, UC-07, E3 | Mọi vai trò | `List.dc.html`. Đã code ở E3-2 (PR 44): `/projects/{id}/list`, bảng phân cấp 3 cấp thu gọn/mở rộng, nhóm theo trạng thái, loại, người, ưu tiên, nhãn, chọn cột, sắp xếp, ảo hóa từ 200 hàng; trạng thái bảng theo đúng lược đồ query v1 của chế độ xem đã lưu |
| S05 | Chi tiết task (v2) | Sửa task: loại, ngày bắt đầu, ngày kết thúc, việc con, nhiều kiểu quan hệ, cảnh báo bị chặn, nhật ký task | UC-05, UC-08, UC-12, E2, E6, E8 | PM, Thành viên, Admin | `mockups/v2/TaskDetail.dc.html` (v1 giữ ở `mockups/v1/`). Đã code ở E2-5 (PR 40): `/projects/{id}/tasks/{taskId}`, ngăn phải từ lg, toàn trang trên điện thoại; lưu theo từng trường kèm Hoàn tác và `409` khi sửa đồng thời; mô tả là văn bản thuần; nhật ký ẩn đến E6-2; quan hệ thêm/bỏ ở E8-2 (PR 42, hộp thoại chọn kiểu và task đích bằng combobox) |
| S06 | Dashboard tiến độ | % hoàn thành, trễ hạn, phân bố, theo người | UC-10, E5 | PM, Người xem, Admin | `Dashboard.dc.html`. Đã code ở E5-1 (PR 39): `/projects/{id}/dashboard`, biểu đồ CSS/SVG tự viết kèm bảng thay thế, màu đạt AA; chưa có xu hướng theo tuần |
| S07 | Xuất báo cáo | Chọn định dạng, kỳ, template, tải file | UC-11, E5 | PM, Admin | `Report.dc.html` |
| S08 | Quản lý người dùng (v2) | Mời, gán phòng ban, cấp quyền Admin, khóa/mở; hiển thị Phòng ban, số dự án tham gia; bộ lọc Phòng ban (có "Chưa gán phòng ban"), nút "Quản lý phòng ban" (thêm, đổi tên, lưu trữ), nút "Đổi" gán phòng ban trong ô Phòng ban (E1-5) | UC-02, E1 | Admin | `mockups/v2/Admin.dc.html` |
| S09 | Kanban trên điện thoại | Dùng được từ 360 px, vùng bấm 44 px, thay kéo thả bằng menu | FR-18, NFR-10, E10 | Mọi vai trò | `Mobile.dc.html`. Đã code ở E3-1: 360 px cột cuộn ngang có điểm dừng và dải chip chọn cột |
| S10 | Kanban chế độ tối | Kiểm tra token chế độ tối | NFR-11 liên quan chế độ sáng/tối | Mọi vai trò | `KanbanDark.dc.html` |
| S11 | Gantt (đã duyệt, code đợt sau, E12 ngoài MVP) | Xem task theo ngày bắt đầu, kết thúc, quan hệ đứng trước/đứng sau, kéo chỉnh ngày | UC-15, FR-20, E12 | PM, Thành viên (Người xem chỉ đọc) | `Gantt.dc.html` (v1) |
| S12 | Chế độ xem đã lưu và mặc định | Dùng, tạo, lưu chế độ xem; bảng phân cấp | UC-14, UC-16, FR-19, FR-22, E13, E3 | Mọi vai trò | `ListViews.dc.html` (v1). Đã code: menu chế độ xem trên `/projects/{id}/list` với 7 mặc định, `?view={id}`, yêu thích (E13-2, PR 47); lưu, đổi tên, cập nhật, công khai/riêng tư, xóa (E13-3, PR 50: chỉ PM/Admin chọn Công khai, chỉ chủ sở hữu chuyển về riêng tư, mặc định và công khai của người khác chỉ đọc). Kanban chưa gắn menu |


| S13 | Tạo dự án và chọn template | Tạo dự án, chọn dự án trống hoặc template | UC-03, UC-04, E2, E7 | PM, Admin | `mockups/v3/CreateProject.dc.html` |
| S14 | Tạo task nhanh | Hộp thoại tạo task với loại, trạng thái, người, ưu tiên, ngày, nhãn | UC-05, E2 | PM, Thành viên | `mockups/v3/QuickTask.dc.html` |
| S15 | Nhật ký hoạt động | Xem và lọc nhật ký dự án | UC-12, FR-16, E6 | PM, Admin | `mockups/v3/Activity.dc.html`. Đã code ở E6-2 (PR 51): `/projects/{id}/activity` (tab "Nhật ký", chỉ PM/Admin) và mục "04 / Nhật ký" trong chi tiết task |

| S16 | Thông báo và cài đặt email | Ngăn thông báo, bật tắt email theo loại | UC-09, FR-11, FR-12, E4 | Mọi vai trò | `mockups/v3/Notifications.dc.html`. Đã code phần chuông và ngăn thông báo ở E4-1 (PR 43): chuông ở khung ứng dụng, poll số chưa đọc 60 giây, ngăn phải lọc Chưa đọc/Tất cả, đánh dấu đã đọc từng cái và tất cả, thời gian giờ Việt Nam; cài đặt email chờ E4-2 |

| S17 | Quản lý template dự án và báo cáo | Admin tải lên và bật template báo cáo; danh sách template dự án | BR-08, FR-04, E5, E7 | Admin, PM | `mockups/v3/Templates.dc.html`. Đã code tab Template báo cáo ở E5-2 (PR 48): `/admin/report-templates` (Admin), tải lên bằng nút, bàn phím và kéo thả, giới hạn 4 MB (không phải 5 MB vì Vercel chặn thân 4,5 MB); tab Template dự án chờ E7-1 |

| S18 | Hồ sơ cá nhân (v2) | Tên, số điện thoại, ngôn ngữ, giao diện, vai trò trong từng dự án | FR-17, E1 | Mọi vai trò | `mockups/v3/Profile-v2.dc.html` (v1 giữ ở `Profile.dc.html`, đã có sửa nên xem v2) |
| S19 | Cấu hình dự án | Trạng thái, loại task, nhãn | FR-06, E2 (Story E2-7) | PM, Admin | `mockups/v3/ProjectSettings.dc.html`. Đã code ở E2-3 (PR 30): `/projects/{id}/settings`, lối vào là link "Cấu hình" trên thẻ dự án; còn thiếu AC "cột mới hiện ở Kanban" (chờ S03) |
| S20 | Nhận lời mời | Người được mời đặt mật khẩu và vào ứng dụng | FR-02, E1-8 | Người được mời | Đã code ở E1-8 (PR 26): `/auth/accept-invite`, dựng từ `components/ui` theo design system; chưa có mockup riêng |

## Màn đã có mockup ở S13 đến S19 (E0-8); còn thiếu
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
