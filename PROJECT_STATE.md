# PROJECT_STATE: Quản lý Dự án CNTT
> Claude đọc file này đầu mỗi phiên, cập nhật ở mỗi gate.

| Mục | Giá trị |
|---|---|
| Slug / Team key | quan-ly-du-an-cntt / QLDA |
| Linear Team, Project | Team `QLDA` · Project [Quản lý Dự án CNTT](https://linear.app/justintran/project/quan-ly-du-an-cntt-c429c5997d32) (P-QLDA-5) · issue QLDA-1 đến QLDA-11 |
| Repo | [gunzok/quan-ly-du-an-cntt](https://github.com/gunzok/quan-ly-du-an-cntt) (public) |
| Ngày khởi tạo | 2026-11-12 |
| Pha hiện tại | 1 Khảo sát |

## Gate
| Pha | Trạng thái | Ngày duyệt | Ghi chú |
|---|---|---|---|
| 0 Khởi tạo | Đã duyệt | 2026-11-12 | Repo chuyển public để bật gate (R-001 đã đóng) |
| 1 Khảo sát | Chờ duyệt | | [requirements.md](docs/01-discovery/requirements.md): 16 câu, 12 tính năng đề xuất, phạm vi MVP |
| 2 BA + stack | Chưa bắt đầu | | |
| 3 Thiết kế | Chưa bắt đầu | | |
| 4 WBS | Chưa bắt đầu | | |
| 5 Phát triển | Chưa bắt đầu | | |
| 6 Nghiệm thu, bàn giao | Chưa bắt đầu | | |
Trạng thái: Chưa bắt đầu · Đang làm · Chờ duyệt · Đã duyệt · Cần rà soát.

## Quyết định
| Hạng mục | Quyết định | Nguồn |
|---|---|---|
| Tech stack | Chưa chốt (Pha 2) | ADR-001 |
| Quy ước đặt tên | Định danh kỹ thuật tiếng Anh không dấu; tài liệu, issue, PR tiếng Việt | Skill |
| Màu, phong cách | Chưa chốt (Pha 3) | |
| Thang ước lượng, độ dài sprint | Chưa chốt (Pha 4); Cycles Linear đề xuất 1 tuần | |
| Loại app, quy mô | Nội bộ một công ty, dưới 100 người, web responsive, Việt + Anh | Pha 1 (A1-A5) |
| Phạm vi MVP | Dự án/task, Kanban + danh sách, RBAC 4 vai trò, xuất báo cáo xlsx/docx theo template, thông báo app + email, nhãn/ưu tiên/trạng thái, tìm kiếm, dashboard, subtask, nhật ký, template dự án, phụ thuộc task, Gantt, theo dõi thời gian | Pha 1 (chờ duyệt) |
| Triển khai, ngân sách, nhân sự | Cloud PaaS, dưới 25 USD/tháng, một người cùng Claude, MVP 6-8 tuần | Pha 1 (C4, D1-D3) |
| Repo | Public (gói Free không bật được gate với repo private), squash merge, approval PR = 0 (làm một mình). Không commit bí mật, dữ liệu khách hàng | Pha 0 |
| Gate GitHub | `main` bảo vệ: bắt buộc PR, check `ci-gate`, branch cập nhật, giải quyết comment, cấm force push, áp dụng cả admin. Environment `production` cần `gunzok` duyệt | Pha 0 |

## Rủi ro
| Mã | Mô tả | Xác suất | Ảnh hưởng | Xử lý | Trạng thái |
|---|---|---|---|---|---|
| R-001 | Repo private trên gói GitHub Free không bật được branch protection và environment có người duyệt | Cao | Cao | Chuyển repo sang public (sếp duyệt 2026-11-12), bật lại bảo vệ và kiểm tra bằng `gh api` | Đã đóng |
| R-002 | Repo public: mã nguồn ai cũng xem được, rủi ro lộ bí mật hoặc dữ liệu thật | Trung bình | Cao | Không commit bí mật; dùng GitHub secret scanning và biến môi trường; xem lại khi có dữ liệu thật (Pha 3 threat model) | Mở |
| R-003 | Phạm vi lớn so với hạn 6-8 tuần, một người làm (Gantt, theo dõi thời gian, phụ thuộc task, template dự án) | Cao | Cao | Cân nhắc đưa Gantt và theo dõi thời gian sang đợt sau, hoặc kéo dài hạn | Mở |
| R-004 | Bình luận bị để đợt sau dù mục tiêu là cộng tác PM và team kỹ thuật | Trung bình | Trung bình | Xác nhận ở gate Pha 1 | Mở |
| R-005 | Chưa có template báo cáo Word/Excel của công ty | Cao | Cao | Sếp cung cấp mẫu trước Pha 3 | Mở |
| R-006 | Xuất Word/Excel trên PaaS serverless có giới hạn thời gian, bộ nhớ | Trung bình | Trung bình | Đánh giá khi chọn stack ở Pha 2 | Mở |

## UI/UX
| Màn hình | Phiên bản | Trạng thái | Ngày |
|---|---|---|---|

## Hạn chế đã biết
- Cycles Linear chưa bật (bật ở Team settings nếu muốn dùng).
- `ci-gate` hiện chạy trên Makefile STUB nên chưa chặn được lỗi thật (xem mục dưới).
- Dependabot PR 1 (nâng `actions/checkout` 4 lên 7) chưa xem xét.

## CI còn STUB
lint · test · build · security

## Câu hỏi mở
- Cần bật Cycles Linear không, và độ dài sprint (1 hay 2 tuần)?
- Template báo cáo tiến độ hiện dùng (file mẫu)? Ngưỡng số cho thước đo thành công? Có cần theo dõi chi phí/ngân sách dự án không?

## Bước tiếp theo
1. Duyệt gate Pha 1 (xem R-003, R-004), duyệt bảng Epic, tạo Epic trên Linear.
2. Pha 2 BA + stack: use case, BR, NFR, chấm điểm stack, ADR, thay Makefile STUB.
