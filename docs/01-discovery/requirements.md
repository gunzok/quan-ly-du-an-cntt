# Khảo sát yêu cầu: Quản lý Dự án CNTT

Ngày: 2026-11-13 · Pha 1 · Trạng thái: Đã duyệt (2026-11-13)

## 0. Bảng Epic đã duyệt
| Epic | MVP? |
|---|---|
| E1 Nền tảng, đăng nhập, RBAC | Có |
| E2 Dự án và task cốt lõi (nhãn, ưu tiên, trạng thái, subtask) | Có |
| E3 Chế độ xem và tìm kiếm (Kanban, danh sách, bộ lọc) | Có |
| E4 Thông báo (trong app, email) | Có |
| E5 Dashboard và báo cáo (xlsx, docx theo template) | Có |
| E6 Nhật ký hoạt động | Có |
| E7 Template dự án | Có |
| E8 Phụ thuộc giữa các task | Có |
| E10 Đa ngôn ngữ (Việt/Anh) và responsive | Có |
| E9 Theo dõi thời gian | Đợt sau |
| E11 Cộng tác mở rộng (bình luận, tệp đính kèm, thùng rác) | Đợt sau |
| E12 Timeline/Gantt | Đợt sau |

## 1. Mục tiêu kinh doanh
| Hạng mục | Nội dung (nguyên văn trả lời của sếp) |
|---|---|
| Vấn đề cần giải quyết | "Làm app quản lý dự án giống asana hoặc clickup" |
| Người dùng chính, người được lợi | "PM là người dùng chính, team kỹ thuật cùng sử dụng, export được báo cáo tiến độ dự án theo template." |
| Thước đo thành công 3-6 tháng | "Tất cả" trong ba phương án: team dùng hằng ngày và bỏ Excel; giảm thời gian họp và báo cáo thủ công; thấy sớm dự án trễ hạn, vượt ngân sách |
| Nếu không làm | "Vẫn dùng Jira/Linear/Excel" |

Thước đo chưa có con số. Cần chốt ngưỡng ở Pha 2 (ví dụ tỷ lệ team dùng hằng ngày, số giờ báo cáo tiết kiệm mỗi tuần).

## 2. Persona
| Persona | Vai trò | Nhu cầu chính |
|---|---|---|
| PM | Người dùng chính | Lập dự án và task, giao việc, theo dõi tiến độ, xuất báo cáo theo template |
| Thành viên kỹ thuật | Người dùng thường xuyên | Xem việc được giao, cập nhật trạng thái, chia subtask |
| Người xem | Ban lãnh đạo, khách hàng nội bộ | Xem dashboard, không sửa |
| Admin | Quản trị | Quản lý người dùng, quyền, cấu hình |

## 3. Hỏi đáp khảo sát (16 câu)
| Mã | Câu hỏi | Trả lời |
|---|---|---|
| A1 | Loại tổ chức dùng app | Nội bộ một công ty/team |
| A2 | Quy mô người dùng sau 12 tháng | Dưới 100 người |
| A3 | Thiết bị chính | Web, responsive dùng được trên điện thoại |
| A5 | Ngôn ngữ và thị trường | Tiếng Việt và tiếng Anh (i18n từ đầu) |
| B1 | Chức năng lõi MVP | Dự án, task, giao việc, hạn chót; Bảng Kanban và danh sách; Xuất báo cáo tiến độ theo template. (Không chọn: Sprint và backlog) |
| B2 | Đăng nhập, phân quyền | RBAC cơ bản: Admin, PM, Thành viên, Người xem |
| B3 | Tích hợp ngoài | Không tích hợp ngoài; chỉ email thông báo |
| B4 | AI | Không trong MVP |
| B5 | Thông báo | Trong app và email |
| B6 | Định dạng xuất báo cáo | Excel (.xlsx) và Word (.docx) theo template công ty |
| C1 | Dữ liệu nhạy cảm | Nội bộ thông thường |
| C3 | Sẵn sàng, hiệu năng | Giờ hành chính, chấp nhận bảo trì ngắn (uptime khoảng 99%, trang tải dưới 2 giây) |
| C4 | Nơi triển khai | Cloud PaaS/serverless quản lý sẵn |
| D1 | Ngân sách hạ tầng/tháng | Dưới 25 USD |
| D2 | Hạn MVP | 6 đến 8 tuần |
| D3 | Ai phát triển | Sếp làm một mình cùng Claude |

Câu hỏi nhóm A4 (mức thành thạo công nghệ), B7 (offline), C2 (tuân thủ), D4 (doanh thu) chưa hỏi vì ít ảnh hưởng với app nội bộ; ghi vào câu hỏi mở nếu cần.

## 4. Đề xuất tính năng bổ sung và quyết định
| # | Tính năng | MoSCoW đề xuất | Phức tạp | Quyết định của sếp |
|---|---|---|---|---|
| 1 | Bình luận và @mention | Must | Trung bình | Đợt sau (không chọn) |
| 2 | Nhãn, ưu tiên, trạng thái tùy chỉnh | Must | Thấp | MVP |
| 3 | Tìm kiếm và bộ lọc | Must | Trung bình | MVP |
| 4 | Dashboard tiến độ | Should | Trung bình | MVP |
| 5 | Subtask | Should | Thấp | MVP |
| 6 | Nhật ký hoạt động | Should | Thấp | MVP |
| 7 | Tệp đính kèm | Should | Trung bình | Đợt sau (không chọn) |
| 8 | Thùng rác và khôi phục | Should | Thấp | Đợt sau (không chọn) |
| 9 | Template dự án | Could | Thấp | MVP |
| 10 | Phụ thuộc giữa các task | Could | Trung bình | MVP |
| 11 | Timeline/Gantt | Could | Cao | MVP lúc chọn; chuyển sang đợt sau khi duyệt gate (giảm R-003) |
| 12 | Theo dõi thời gian | Could | Trung bình | MVP lúc chọn; chuyển sang đợt sau khi duyệt gate (giảm R-003) |

## 5. Phạm vi MVP
**Trong phạm vi (In scope)**
- Dự án, task, giao việc, hạn chót; xem dạng Kanban và danh sách.
- Đăng nhập và RBAC bốn vai trò (Admin, PM, Thành viên, Người xem).
- Xuất báo cáo tiến độ ra Excel và Word theo template công ty (cần template mẫu từ sếp).
- Thông báo trong app và email.
- Nhãn, mức ưu tiên, trạng thái tùy chỉnh; tìm kiếm và bộ lọc; dashboard tiến độ.
- Subtask; nhật ký hoạt động; template dự án; phụ thuộc giữa task.
- Giao diện tiếng Việt và tiếng Anh; responsive trên điện thoại.

**Ngoài phạm vi MVP (đợt sau)**
- Timeline/Gantt; theo dõi thời gian (chuyển sang đợt sau khi duyệt gate, 2026-11-13).
- Bình luận và @mention; tệp đính kèm; thùng rác và khôi phục; sprint và backlog.
- Tích hợp GitHub, Jira, Linear, Excel import; thông báo Zalo/Slack; AI; app mobile native; đa khách hàng (SaaS); SSO.

## 6. Ràng buộc
- Một người phát triển cùng Claude; hạn 6 đến 8 tuần; hạ tầng dưới 25 USD/tháng, cloud PaaS.
- Repo public, nên không commit bí mật và dữ liệu thật (R-002).
- Approval PR = 0; `main` được bảo vệ bằng `ci-gate`.

## 7. Rủi ro phát hiện ở Pha 1
| Mã | Mô tả | Xử lý đề xuất |
|---|---|---|
| R-003 | Phạm vi lớn so với hạn 6 đến 8 tuần và một người làm | Đã xử lý ở gate: chuyển Gantt và theo dõi thời gian sang đợt sau. Còn lại phụ thuộc task, template dự án; đánh giá lại ở Pha 4 khi ước lượng |
| R-004 | Bình luận (Must theo đề xuất) bị để đợt sau, trong khi mục tiêu là cộng tác PM và team kỹ thuật | Xác nhận ở gate có chấp nhận không |
| R-005 | Template báo cáo Word/Excel của công ty chưa có; thiếu mẫu thì không thiết kế được tính năng xuất | Sếp cung cấp template mẫu trước Pha 3 |
| R-006 | Xuất Word/Excel trên PaaS serverless có giới hạn thời gian và bộ nhớ | Đánh giá ở Pha 2 khi chọn stack |

## 8. Câu hỏi mở
- Template báo cáo tiến độ hiện dùng là gì (file mẫu)?
- Ngưỡng số cho các thước đo thành công?
- Có cần theo dõi ngân sách dự án (chi phí) không, vì thước đo thành công nhắc "vượt ngân sách"? Hiện chưa có tính năng nào về chi phí.
- Sprint và backlog không được chọn: team kỹ thuật làm việc theo mô hình nào (Kanban liên tục hay sprint)?
