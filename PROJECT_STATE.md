# PROJECT_STATE: Quản lý Dự án CNTT
> Claude đọc file này đầu mỗi phiên, cập nhật ở mỗi gate.

| Mục | Giá trị |
|---|---|
| Slug / Team key | quan-ly-du-an-cntt / QLDA |
| Linear Team, Project | Team `QLDA` · Project [Quản lý Dự án CNTT](https://linear.app/justintran/project/quan-ly-du-an-cntt-c429c5997d32) (P-QLDA-5) · issue QLDA-1 đến QLDA-11 |
| Repo | [gunzok/quan-ly-du-an-cntt](https://github.com/gunzok/quan-ly-du-an-cntt) (private) |
| Ngày khởi tạo | 2026-11-12 |
| Pha hiện tại | 0 Khởi tạo |

## Gate
| Pha | Trạng thái | Ngày duyệt | Ghi chú |
|---|---|---|---|
| 0 Khởi tạo | Chờ duyệt | | Còn 2 hạn chế bảo vệ GitHub (xem dưới) |
| 1 Khảo sát | Chưa bắt đầu | | |
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
| Repo | Private, squash merge, approval PR = 0 (làm một mình) | Pha 0 |

## Rủi ro
| Mã | Mô tả | Xác suất | Ảnh hưởng | Xử lý | Trạng thái |
|---|---|---|---|---|---|
| R-001 | Repo private trên gói GitHub Free không bật được branch protection và environment có người duyệt, nên merge gate và deploy gate chưa có hiệu lực | Cao | Cao | Chọn: nâng GitHub Pro, hoặc chuyển repo public, hoặc tự giữ kỷ luật (không push thẳng main) | Mở |

## UI/UX
| Màn hình | Phiên bản | Trạng thái | Ngày |
|---|---|---|---|

## Hạn chế đã biết
- Branch protection `main` chưa bật (GitHub trả 403: cần Pro hoặc repo public). `ci-gate` chưa là điều kiện bắt buộc để merge.
- Environment `staging`/`production` có người duyệt chưa tạo được (HTTP 422, cùng nguyên nhân gói GitHub). Deploy gate chưa có hiệu lực.
- Cycles Linear chưa bật (cần bật tay ở Team settings nếu muốn dùng).

## CI còn STUB
lint · test · build · security

## Câu hỏi mở
- Xử lý R-001 theo hướng nào (Pro / public / tự giữ kỷ luật)?

## Bước tiếp theo
1. Duyệt gate Pha 0 và quyết định R-001.
2. Pha 1 Khảo sát: mục tiêu, ≥10 câu lựa chọn, đề xuất tính năng, chốt phạm vi MVP.
