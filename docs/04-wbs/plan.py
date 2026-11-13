#!/usr/bin/env python3
"""Sinh docs/04-wbs/wbs.md và docs/04-wbs/stories/*.md từ dữ liệu Story bên dưới.

Cách dùng: python3 docs/04-wbs/plan.py [velocity] [số-điểm-mỗi-sprint]
Mọi con số (tổng điểm, số sprint, kịch bản) do script này tính, không tính tay.
Điểm Story là ước lượng của Claude (Fibonacci 1, 2, 3, 5, 8), cần hiệu chỉnh từ sprint 2.
"""
import json
import math
import os
import sys
from collections import OrderedDict, defaultdict

VELOCITY = int(sys.argv[1]) if len(sys.argv) > 1 else 30
BASELINE = 20
START = "2026-11-16"
HERE = os.path.dirname(os.path.abspath(__file__))

EPICS = OrderedDict([
    ("E0", ("Hạ tầng và chất lượng", "(mới)")),
    ("E1", ("Nền tảng, đăng nhập, RBAC", "QLDA-12")),
    ("E2", ("Dự án và task cốt lõi", "QLDA-13")),
    ("E3", ("Chế độ xem và tìm kiếm", "QLDA-14")),
    ("E4", ("Thông báo", "QLDA-15")),
    ("E5", ("Dashboard và báo cáo tiến độ", "QLDA-16")),
    ("E6", ("Nhật ký hoạt động", "QLDA-17")),
    ("E7", ("Template dự án", "QLDA-18")),
    ("E8", ("Quan hệ giữa các task", "QLDA-19")),
    ("E10", ("Đa ngôn ngữ và responsive", "QLDA-20")),
    ("E12", ("Timeline/Gantt (đợt sau)", "QLDA-23")),
    ("E13", ("Chế độ xem đã lưu", "QLDA-24")),
])
OUT_OF_MVP = [("E9", "Theo dõi thời gian", "QLDA-21"), ("E11", "Cộng tác mở rộng (bình luận, tệp, thùng rác)", "QLDA-22"),
              ("E14", "Nhập dữ liệu từ OpenProject", "QLDA-25")]
MO = {"M": "Must", "S": "Should", "C": "Could", "W": "Đợt sau"}

# (id, epic, tiêu đề, điểm, MoSCoW, wave, phụ thuộc, tham chiếu, màn, actor, việc, giá trị, [tiêu chí], [task])
ST = [
("E0-1", "E0", "Khung Supabase cục bộ, migration đầu tiên và seed", 5, "M", 1, [], "NFR-13; database.md mục 6", "-",
 "lập trình viên", "chạy Supabase cục bộ với migration và seed giả", "phát triển và kiểm thử không đụng dữ liệu thật",
 ["**Given** máy sạch, **When** chạy `supabase start` và áp migration, **Then** CSDL có các thành phần nền (extension, kiểu enum, hàm tiện ích).",
  "**Given** seed giả, **When** chạy lại từ đầu, **Then** kết quả giống nhau và không có dữ liệu thật (repo công khai)."],
 ["Cài Supabase CLI, tạo `supabase/`", "Viết migration khởi tạo", "Viết seed giả có tài khoản cho 4 vai trò", "Ghi hướng dẫn chạy cục bộ vào README"]),
("E0-6", "E0", "Quyết định ADR còn mở: email, bộ lập lịch, xuất báo cáo, thư viện UI", 3, "M", 1, [], "system-design.md mục 9; design-system.md mục 6", "-",
 "chủ dự án", "chốt các quyết định kiến trúc còn mở bằng ADR", "không bị chặn khi code thông báo, báo cáo, giao diện",
 ["**Given** bốn vấn đề còn mở, **When** hoàn tất, **Then** có ADR-002 đến ADR-005 ở trạng thái Đã chấp nhận, kèm nguồn và giá đã tra.",
  "**Given** ngân sách dưới 25 USD/tháng, **When** chọn dịch vụ, **Then** ADR ghi chi phí và điều kiện xem xét lại."],
 ["Tra giá, giới hạn gói từng dịch vụ", "Thử nhanh xuất xlsx/docx trên mẫu", "Viết bốn ADR", "Sếp duyệt"]),
("E0-8", "E0", "Mockup 6 màn còn thiếu và duyệt từng màn", 5, "M", 1, [], "screens.md mục chưa có mockup", "6 màn mới",
 "chủ dự án", "xem và duyệt mockup các màn còn thiếu (tạo dự án và template, tạo task nhanh, nhật ký, thông báo, quản lý template, hồ sơ cá nhân)", "các Story liên quan đủ điều kiện sẵn sàng (DoR)",
 ["**Given** 6 màn chưa có mockup, **When** hoàn tất, **Then** mỗi màn có bản v1 trong canvas và quyết định trong `review-log.md`.",
  "**Given** màn không được duyệt, **When** làm lại, **Then** tạo phiên bản mới, không sửa đè."],
 ["Làm mockup trong canvas (phiên điều phối, không giao agent)", "Gửi sếp duyệt từng màn", "Cập nhật `screens.md`, `review-log.md`"]),
("E10-1", "E10", "Khung UI theo design system (token, component nền, sáng/tối)", 8, "M", 1, ["E0-1"], "design-system.md; NFR-10", "mọi màn",
 "lập trình viên", "có khung giao diện với token màu, chữ, component nền và chế độ sáng tối", "mọi màn sau dùng chung một bộ thành phần",
 ["**Given** chế độ hệ thống sáng hoặc tối, **When** mở trang, **Then** token màu đúng bảng đã duyệt và tương phản đạt WCAG AA.",
  "**Given** bàn phím, **When** tab qua các component nền, **Then** vòng focus 2 px luôn thấy."],
 ["Chốt thư viện UI theo ADR (E0-6)", "Khai báo token CSS và phông Inter", "Dựng Button, Input, Select, Badge, Avatar, Toast, Dialog", "Trang kiểm tra component (storybook nhẹ hoặc trang nội bộ)"]),
("E1-1", "E1", "Đăng nhập email/mật khẩu, đăng xuất, phiên cookie (S01)", 5, "M", 1, ["E0-1"], "FR-01; NFR-06, NFR-07", "S01",
 "người dùng", "đăng nhập bằng email và mật khẩu rồi đăng xuất", "dùng hệ thống an toàn",
 ["**Given** tài khoản hợp lệ, **When** đăng nhập đúng, **Then** vào hệ thống và có phiên cookie httpOnly.",
  "**Given** sai mật khẩu, **When** đăng nhập, **Then** báo lỗi chung, không lộ tài khoản có tồn tại hay không."],
 ["Cấu hình Supabase Auth và `@supabase/ssr`", "Trang đăng nhập theo S01", "Middleware bảo vệ trang", "Test đăng nhập, đăng xuất, hết phiên"]),
("E1-3", "E1", "Schema người dùng, phòng ban, dự án, thành viên và RLS vai trò theo dự án", 8, "M", 1, ["E0-1"], "FR-02; BR-01, BR-02, BR-10; NFR-06; database.md mục 2, 5", "-",
 "quản trị hệ thống", "có dữ liệu người dùng và vai trò theo từng dự án được bảo vệ bằng RLS", "mỗi người chỉ thấy đúng dự án của mình",
 ["**Given** người có vai trò khác nhau ở hai dự án, **When** truy vấn, **Then** chỉ thấy và làm được đúng theo vai trò từng dự án.",
  "**Given** người không thuộc dự án và không phải Admin, **When** truy vấn, **Then** không nhận dòng nào của dự án đó."],
 ["Migration `profiles`, `departments`, `projects`, `project_members`", "Viết chính sách RLS", "Test RLS cho PM, Thành viên, Người xem, Admin, người ngoài", "Seed dữ liệu giả"]),
("E0-2", "E0", "Môi trường staging, production và CD thật", 5, "M", 2, ["E0-1"], "system-design.md mục 8; deploy gate Pha 0; R-008", "-",
 "chủ dự án", "merge vào main tự triển khai staging và tag triển khai production sau khi duyệt", "phát hành an toàn, có kiểm soát",
 ["**Given** merge vào main, **When** CD chạy, **Then** staging cập nhật và kiểm tra khói qua.",
  "**Given** tag `v*.*.*`, **When** CD chạy, **Then** dừng chờ duyệt environment `production` rồi mới triển khai."],
 ["Tạo hai dự án Supabase, dự án Vercel (sếp duyệt chi phí, R-008)", "Đặt biến môi trường, GitHub Secrets", "Thay STUB trong `cd.yml`", "Kiểm tra khói sau triển khai"]),
("E0-3", "E0", "Khung kiểm thử RLS, integration và e2e trong CI", 5, "M", 2, ["E0-1"], "test-strategy.md; NFR-06", "-",
 "lập trình viên", "có khung test RLS, integration, e2e chạy trong CI", "mọi Story sau có chỗ viết test và CI chặn lỗi",
 ["**Given** một PR, **When** CI chạy, **Then** test RLS và integration chạy với Supabase cục bộ.",
  "**Given** test e2e mẫu, **When** CI chạy, **Then** Playwright chạy được một luồng đăng nhập mẫu."],
 ["Cài đặt Supabase CLI trong CI", "Cấu hình Vitest integration", "Cấu hình Playwright và axe", "Cập nhật `Makefile`, `ci.yml`"]),
("E1-2", "E1", "Đăng nhập Google", 3, "M", 2, ["E1-1"], "FR-01", "S01",
 "người dùng", "đăng nhập bằng tài khoản Google", "không phải nhớ thêm mật khẩu",
 ["**Given** tài khoản Google đã được mời, **When** chọn Google, **Then** vào hệ thống đúng vai trò.",
  "**Given** tài khoản Google chưa được mời, **When** đăng nhập, **Then** bị từ chối kèm hướng dẫn liên hệ Admin."],
 ["Bật nhà cung cấp Google ở Supabase", "Nút Google ở S01", "Chặn tài khoản chưa mời", "Test luồng (mô phỏng)"]),
("E1-4", "E1", "Admin mời người dùng, khóa/mở, cấp quyền Admin (S08 v2)", 5, "M", 2, ["E1-1", "E1-3"], "FR-02; S08 v2", "S08",
 "Admin", "mời người dùng, khóa hoặc mở tài khoản, cấp quyền Admin", "kiểm soát ai được dùng hệ thống",
 ["**Given** Admin, **When** mời một email, **Then** người đó nhận email mời và tài khoản ở trạng thái chờ.",
  "**Given** tài khoản bị khóa, **When** đăng nhập, **Then** bị từ chối nhưng lịch sử vẫn giữ."],
 ["API `/api/v1/users`, `/users/invitations`", "Màn S08 v2", "Dùng khóa service_role chỉ phía máy chủ", "Test phân quyền: chỉ Admin"]),
("E2-1", "E2", "Danh sách dự án, tạo, sửa, lưu trữ dự án (S02)", 5, "M", 2, ["E1-3"], "FR-03; BR-10; S02", "S02",
 "PM", "xem, tạo, sửa và lưu trữ dự án", "quản lý các dự án của mình",
 ["**Given** PM, **When** tạo dự án, **Then** dự án có PM là thành viên với vai trò PM.",
  "**Given** người dùng, **When** mở danh sách, **Then** chỉ thấy dự án mình thuộc (Admin thấy tất cả)."],
 ["API `/api/v1/projects`", "Màn S02", "Thanh tiến độ và đếm trễ hạn", "Test quyền"]),
("E2-2", "E2", "Task: tạo, sửa, xóa vĩnh viễn có xác nhận (API)", 8, "M", 2, ["E1-3"], "FR-05; BR-03, BR-11; api-contract.md mục 3", "-",
 "PM, Thành viên", "tạo, sửa, xóa task với người phụ trách, ưu tiên, ngày bắt đầu và kết thúc", "theo dõi công việc",
 ["**Given** thành viên dự án, **When** tạo task đủ tên, **Then** task lưu và hiện trong danh sách.",
  "**Given** ngày kết thúc sớm hơn ngày bắt đầu, **When** lưu, **Then** bị từ chối (BR-13)."],
 ["Migration `tasks`", "API `/projects/{id}/tasks`, `/tasks/{id}`", "Kiểm tra đầu vào bằng schema", "Test API và RLS"]),
("E1-5", "E1", "Danh mục Phòng ban và lọc người dùng theo Phòng ban", 3, "M", 3, ["E1-4"], "FR-02; S08 v2", "S08",
 "Admin", "quản lý danh mục Phòng ban và lọc người dùng theo Phòng ban", "tổ chức người dùng theo đơn vị",
 ["**Given** Admin, **When** thêm Phòng ban, **Then** gán được cho người dùng.",
  "**Given** danh sách người dùng, **When** lọc theo Phòng ban, **Then** chỉ hiện người thuộc phòng ban đó."],
 ["API `/api/v1/departments`", "Bộ lọc ở S08 v2", "Test"]),
("E1-6", "E1", "PM gán vai trò thành viên dự án", 3, "M", 3, ["E1-3", "E2-1"], "FR-02, FR-03; BR-01", "-",
 "PM", "thêm thành viên vào dự án và gán vai trò PM, Thành viên hoặc Người xem", "đúng người, đúng quyền ở từng dự án",
 ["**Given** PM của dự án, **When** thêm thành viên, **Then** người đó thấy dự án với đúng vai trò.",
  "**Given** người không phải PM của dự án, **When** thử gán vai trò, **Then** bị từ chối."],
 ["API `PUT /projects/{id}/members/{user_id}`", "Giao diện thành viên dự án", "Test"]),
("E2-3", "E2", "Trạng thái tùy chỉnh, loại task và nhãn theo dự án", 5, "M", 3, ["E2-1"], "FR-06, FR-23; database.md", "-",
 "PM", "cấu hình trạng thái, loại task, nhãn cho dự án", "phù hợp quy trình từng dự án",
 ["**Given** dự án mới, **When** tạo xong, **Then** có trạng thái, loại task mặc định (**[CẦN XÁC NHẬN]** danh sách).",
  "**Given** trạng thái đang có task, **When** xóa, **Then** yêu cầu chuyển task sang trạng thái khác."],
 ["Migration `task_statuses`, `task_types`, `labels`", "API và giao diện cấu hình", "Test"]),
("E2-4", "E2", "Subtask tối đa 3 cấp và quy tắc đóng task cha", 5, "M", 3, ["E2-2"], "FR-07; BR-04", "-",
 "PM, Thành viên", "chia task thành việc con tối đa 3 cấp", "chia nhỏ công việc kỹ thuật",
 ["**Given** task cấp 3, **When** tạo việc con, **Then** bị từ chối (vượt 3 cấp).",
  "**Given** task cha còn việc con chưa xong, **When** đóng task cha, **Then** bị từ chối (BR-04)."],
 ["Trigger `depth` và kiểm tra đóng task cha", "API `parent_id`", "Test"]),
("E2-6", "E2", "Quyền sửa task theo vai trò và kiểm thử", 3, "M", 3, ["E2-2", "E1-3"], "BR-02, BR-03", "-",
 "PM", "Thành viên chỉ sửa task mình phụ trách hoặc tạo, Người xem chỉ đọc", "kiểm soát thay đổi",
 ["**Given** Thành viên, **When** sửa task của người khác, **Then** bị từ chối.",
  "**Given** Người xem, **When** thử sửa, **Then** bị từ chối ở cả API và RLS."],
 ["Chính sách RLS `tasks`", "Kiểm tra ở Route Handler", "Test đủ ma trận vai trò"]),
("E0-5", "E0", "Bảo mật nền: CSP, header, giới hạn tần suất, CSRF", 5, "M", 3, ["E0-1"], "security.md mục 3; NFR-06, NFR-07", "-",
 "chủ dự án", "có lớp bảo vệ nền cho mọi API và trang", "giảm rủi ro tấn công phổ biến",
 ["**Given** trang bất kỳ, **When** kiểm tra header, **Then** có CSP chặt, `X-Content-Type-Options`, HSTS.",
  "**Given** gọi API quá nhiều, **When** vượt ngưỡng, **Then** nhận 429 với `rate_limited`."],
 ["CSP và header an toàn", "Giới hạn tần suất", "Kiểm tra origin và CSRF cho thao tác ghi", "Bật GitHub secret scanning, kiểm tra"]),
("E12-1", "E12", "Spike Gantt: chọn thư viện, prototype 500 task", 5, "W", 3, ["E2-2"], "NFR-15; FR-20", "S11",
 "chủ dự án", "chọn thư viện Gantt và kiểm chứng hiệu năng", "tránh làm Gantt từ đầu hoặc chọn nhầm",
 ["**Given** 500 task, **When** render prototype, **Then** dưới 2 giây ở P95 (NFR-15).",
  "**Given** kết quả, **When** xong, **Then** có ADR thư viện Gantt và điều kiện xem xét lại."],
 ["Khảo sát 2-3 thư viện, ghi giấy phép (chú ý giấy phép với dự án công khai)", "Prototype 500 task", "Đo hiệu năng", "Viết ADR"]),
("E2-5", "E2", "Ngăn chi tiết task (S05 v2)", 5, "M", 4, ["E2-2", "E2-3"], "S05 v2; FR-05", "S05",
 "PM, Thành viên", "mở ngăn chi tiết để xem và sửa task", "không phải rời danh sách",
 ["**Given** một task, **When** mở chi tiết, **Then** thấy loại, trạng thái, người phụ trách, ngày, nhãn, mô tả, việc con.",
  "**Given** Người xem, **When** mở chi tiết, **Then** các trường ở chế độ chỉ đọc."],
 ["Giao diện ngăn chi tiết theo S05 v2", "Trạng thái tải, lỗi, chỉ đọc", "Test e2e mở và sửa"]),
("E3-1", "E3", "Bảng Kanban kéo thả và menu chuyển cột (S03, S09)", 8, "M", 4, ["E2-3", "E2-2"], "FR-08; S03, S09", "S03, S09",
 "PM, Thành viên", "xem task dạng Kanban và kéo thả đổi trạng thái", "cập nhật tiến độ nhanh",
 ["**Given** thành viên có quyền sửa, **When** kéo thẻ sang cột khác, **Then** trạng thái đổi và có nhật ký.",
  "**Given** điện thoại hoặc bàn phím, **When** dùng menu Chuyển đến cột, **Then** đổi trạng thái không cần kéo thả."],
 ["Giao diện cột và thẻ", "Kéo thả có thay thế bàn phím", "Cập nhật `position` và `status_id`", "Test e2e"]),
("E3-3", "E3", "Tìm kiếm văn bản có dấu tiếng Việt và bộ lọc", 5, "M", 4, ["E2-2"], "FR-09; database.md mục 4", "S04",
 "mọi vai trò", "tìm task theo từ khóa và lọc theo người, trạng thái, ưu tiên, nhãn, hạn", "tìm đúng việc nhanh",
 ["**Given** task có tiêu đề có dấu, **When** tìm không dấu hoặc có dấu, **Then** vẫn ra kết quả (**[CẦN XÁC NHẬN]** cách xử lý dấu).",
  "**Given** nhiều bộ lọc, **When** áp dụng, **Then** kết quả khớp tất cả điều kiện."],
 ["Chỉ mục tìm kiếm", "API `?q=` và bộ lọc", "Giao diện thanh lọc", "Test"]),
("E6-1", "E6", "Ghi nhật ký mọi thay đổi (chỉ INSERT)", 5, "M", 4, ["E2-2"], "FR-16; BR-09", "-",
 "PM", "mọi thay đổi dự án, task được ghi lại", "biết ai đổi gì, khi nào",
 ["**Given** sửa một task, **When** lưu, **Then** có bản ghi gồm người, thời gian, trước và sau.",
  "**Given** bất kỳ vai trò, **When** thử sửa hoặc xóa bản ghi nhật ký, **Then** bị từ chối (BR-09)."],
 ["Migration `activity_logs`, RLS chỉ INSERT", "Ghi nhật ký ở lớp nghiệp vụ", "Test"]),
("E0-7", "E0", "Dữ liệu 2.000 task và script hiệu năng", 3, "M", 4, ["E0-1", "E2-2"], "NFR-02, NFR-03, NFR-15, NFR-16", "-",
 "lập trình viên", "có dữ liệu giả 2.000 task và script đo", "kiểm hiệu năng sớm",
 ["**Given** CSDL cục bộ, **When** chạy script seed, **Then** có dự án 2.000 task phân cấp, quan hệ, nhãn.",
  "**Given** script đo, **When** chạy, **Then** in P95 của các API chính."],
 ["Script seed lớn", "Script đo API", "Ghi ngưỡng vào `test-strategy.md`"]),
("E3-2", "E3", "Bảng phân cấp thu gọn, nhóm, chọn cột (S04, S12)", 8, "M", 5, ["E2-4"], "FR-22; S04, S12", "S04, S12",
 "mọi vai trò", "xem task dạng bảng phân cấp, nhóm theo thuộc tính, chọn cột", "nhìn cấu trúc công việc như OpenProject",
 ["**Given** task cha-con, **When** thu gọn hoặc mở rộng, **Then** hàng con ẩn hoặc hiện đúng.",
  "**Given** nhóm theo trạng thái, **When** bật, **Then** hiện nhóm có thể thu gọn."],
 ["Giao diện bảng phân cấp", "Chọn cột, nhóm, sắp xếp", "Test e2e"]),
("E3-4", "E3", "Phân trang cursor và hiệu năng 2.000 task", 3, "M", 5, ["E3-3", "E0-7"], "NFR-02, NFR-16", "-",
 "mọi vai trò", "danh sách tải nhanh với dự án lớn", "dùng mượt khi dữ liệu tăng",
 ["**Given** dự án 2.000 task, **When** gọi danh sách, **Then** P95 dưới 500 ms.",
  "**Given** phân trang cursor, **When** cuộn tiếp, **Then** không trùng, không sót."],
 ["Phân trang cursor", "Chỉ mục bổ sung nếu cần", "Chạy script hiệu năng"]),
("E13-1", "E13", "Chế độ xem đã lưu: schema, API, RLS", 5, "M", 5, ["E3-3"], "FR-19; BR-12", "S12",
 "mọi vai trò", "lưu bộ lọc, sắp xếp, nhóm, cột thành chế độ xem", "dùng lại cách xem quen thuộc",
 ["**Given** bộ lọc đang bật, **When** lưu, **Then** có chế độ xem riêng của tôi.",
  "**Given** chế độ xem công khai, **When** người khác mở, **Then** chỉ thấy task họ đủ quyền (BR-12)."],
 ["Migration `saved_views`, RLS", "API `/projects/{id}/views`", "Test"]),
("E13-2", "E13", "Chế độ xem mặc định và danh sách chế độ xem (S12)", 5, "M", 5, ["E13-1", "E3-2"], "FR-19; S12", "S12",
 "mọi vai trò", "dùng các chế độ xem mặc định như OpenProject", "quen ngay khi chuyển sang",
 ["**Given** dự án mới, **When** mở, **Then** có 7 chế độ xem mặc định (Tất cả đang mở, Hoạt động gần nhất, Mới tạo, Quá hạn, Tóm tắt, Tạo bởi tôi, Giao cho tôi).",
  "**Given** chế độ xem mặc định, **When** thử sửa, **Then** không sửa được."],
 ["Seed 7 chế độ xem mặc định", "Giao diện menu chế độ xem S12", "Test"]),
("E8-1", "E8", "Quan hệ giữa task: schema, trigger chống vòng, API", 5, "M", 5, ["E2-2"], "FR-10; BR-05", "-",
 "PM, Thành viên", "đặt quan hệ giữa các task", "thấy việc nào liên quan, chặn hoặc đứng trước việc nào",
 ["**Given** hai task, **When** đặt quan hệ chặn, **Then** quan hệ đảo (bị chặn bởi) hiển thị ở task kia.",
  "**Given** quan hệ gây vòng, **When** lưu, **Then** bị từ chối 409."],
 ["Migration `task_relations`, trigger", "API quan hệ", "Test vòng và quyền"]),
("E0-9", "E0", "Bộ test e2e luồng chính (9 luồng)", 8, "M", 8, ["E3-1", "E8-2", "E5-3"], "test-strategy.md mục 4", "-",
 "chủ dự án", "có test e2e bảo vệ các luồng chính", "phát hành tự tin",
 ["**Given** 9 luồng trong `test-strategy.md`, **When** CI chạy, **Then** tất cả đạt.",
  "**Given** lỗi trợ năng mức nghiêm trọng, **When** axe quét, **Then** CI đỏ."],
 ["Viết 9 luồng Playwright", "Tích hợp axe", "Ổn định test (không chập chờn)"]),
("E8-2", "E8", "Giao diện quản lý quan hệ (S05 v2)", 5, "M", 6, ["E8-1", "E2-5"], "FR-10; S05 v2", "S05",
 "PM, Thành viên", "thêm và xóa quan hệ ở ngăn chi tiết", "quản lý quan hệ nhanh",
 ["**Given** ngăn chi tiết, **When** thêm quan hệ, **Then** chọn loại và task đích, hiển thị ngay.",
  "**Given** Người xem, **When** mở, **Then** không thấy nút thêm hoặc xóa."],
 ["Giao diện danh sách quan hệ", "Chọn loại quan hệ", "Test e2e"]),
("E8-3", "E8", "Cảnh báo task bị chặn", 3, "M", 6, ["E8-1", "E3-1"], "BR-06", "S03, S05",
 "Thành viên", "thấy cảnh báo khi task bị chặn bởi task chưa xong", "tránh làm sai thứ tự mà vẫn linh hoạt",
 ["**Given** task bị chặn, **When** hiển thị, **Then** có biểu tượng và chữ cảnh báo.",
  "**Given** task bị chặn, **When** đánh dấu hoàn thành, **Then** vẫn được, kèm cảnh báo (BR-06)."],
 ["Tính cờ `blocked` ở API", "Cảnh báo ở Kanban và chi tiết", "Test"]),
("E4-1", "E4", "Thông báo trong app", 5, "M", 6, ["E2-2", "E0-8"], "FR-11", "ngăn thông báo (mới)",
 "mọi vai trò", "nhận thông báo trong app khi được giao việc, task đổi trạng thái", "không bỏ sót việc",
 ["**Given** được giao task, **When** có người giao, **Then** thông báo hiện ở chuông.",
  "**Given** thông báo, **When** bấm đánh dấu đã đọc, **Then** số chưa đọc giảm."],
 ["Migration `notifications`", "API thông báo", "Giao diện chuông và ngăn", "Test"]),
("E5-1", "E5", "Dashboard tiến độ (S06)", 5, "M", 6, ["E2-3"], "FR-13; S06", "S06",
 "PM, Người xem", "xem phần trăm hoàn thành, trễ hạn, phân bố, theo người", "nắm tiến độ không cần họp",
 ["**Given** dự án, **When** mở dashboard, **Then** số liệu khớp dữ liệu task.",
  "**Given** dự án chưa có task, **When** mở, **Then** trạng thái rỗng có hướng dẫn."],
 ["API `/projects/{id}/dashboard`", "Giao diện S06", "Test số liệu"]),
("E5-2", "E5", "Quản lý template báo cáo (Admin tải lên)", 5, "M", 6, ["E1-3"], "BR-08; FR-14, FR-15; R-005", "-",
 "Admin", "tải lên và quản lý template báo cáo xlsx, docx của công ty", "báo cáo đúng mẫu",
 ["**Given** Admin, **When** tải template hợp lệ, **Then** lưu ở Storage và dùng được.",
  "**Given** tệp sai loại hoặc quá lớn, **When** tải lên, **Then** bị từ chối."],
 ["Bảng `report_templates`, Storage", "API và giao diện (cần mockup E0-8)", "Kiểm tra loại và kích thước tệp"]),
("E12-2", "E12", "Gantt: thanh theo ngày, cột tiêu đề, thu phóng, vạch hôm nay (S11)", 8, "W", 6, ["E12-1", "E2-2"], "FR-20; S11", "S11",
 "PM, Thành viên", "xem task theo thời gian trên Gantt", "thấy lịch tổng thể",
 ["**Given** dự án có task, **When** mở Gantt, **Then** thanh nằm đúng ngày bắt đầu và kết thúc.",
  "**Given** 500 task, **When** mở, **Then** dưới 2 giây ở P95 (NFR-15)."],
 ["API `/projects/{id}/gantt`", "Giao diện theo thư viện đã chọn (ADR)", "Thu phóng, hôm nay", "Test"]),
("E13-3", "E13", "Lưu, sửa, xóa, công khai, yêu thích chế độ xem", 5, "M", 6, ["E13-2"], "FR-19", "S12",
 "mọi vai trò", "quản lý chế độ xem của mình", "giữ cách xem riêng",
 ["**Given** chế độ xem riêng, **When** đặt công khai, **Then** người khác trong dự án thấy được.",
  "**Given** chế độ xem công khai của PM, **When** Thành viên thử sửa, **Then** bị từ chối."],
 ["API `PATCH`, `DELETE` view", "Giao diện lưu, đổi tên, yêu thích", "Test quyền"]),
("E2-7", "E2", "Giao diện cấu hình dự án: trạng thái, loại task, nhãn", 3, "M", 4, ["E2-3"], "FR-06", "(cần mockup nhỏ)",
 "PM", "cấu hình trạng thái, loại task, nhãn bằng giao diện", "không phải nhờ Admin",
 ["**Given** PM, **When** thêm trạng thái, **Then** cột mới hiện ở Kanban.",
  "**Given** Thành viên, **When** mở cấu hình, **Then** chỉ đọc."],
 ["Màn cấu hình dự án", "Kết nối API E2-3", "Test"]),
("E10-2", "E10", "Khung i18n Việt/Anh và lưu lựa chọn", 5, "M", 2, ["E10-1"], "FR-17; NFR-11; S01", "S01",
 "người dùng", "đổi giữa Tiếng Việt và English, được nhớ", "dùng bằng ngôn ngữ quen",
 ["**Given** người dùng, **When** chọn English, **Then** giao diện đổi và được nhớ ở lần sau.",
  "**Given** CI, **When** quét, **Then** không còn chuỗi giao diện gõ cứng ngoài file ngôn ngữ."],
 ["Chọn thư viện i18n theo ADR", "File ngôn ngữ vi, en", "Kiểm tra chuỗi gõ cứng trong lint", "Test"]),
("E4-2", "E4", "Email giao việc", 5, "M", 7, ["E4-1", "E0-6"], "FR-12; ADR-002", "-",
 "Thành viên", "nhận email khi được giao việc", "biết ngay cả khi không mở app",
 ["**Given** người nhận bật email, **When** được giao việc, **Then** nhận email có tên task và liên kết.",
  "**Given** email lỗi, **When** gửi, **Then** thử lại tối đa 3 lần, thao tác chính không hỏng."],
 ["Tích hợp dịch vụ email theo ADR-002", "Mẫu email Việt, English", "Thử lại và log lỗi", "Test"]),
("E5-3", "E5", "Xuất báo cáo xlsx theo template (S07)", 8, "M", 7, ["E5-2", "E5-1", "E0-6"], "FR-14; S07; NFR-03", "S07",
 "PM", "xuất báo cáo tiến độ ra Excel theo template công ty", "gửi báo cáo không làm tay",
 ["**Given** dự án, kỳ và template, **When** xuất xlsx, **Then** tệp đúng mẫu và dữ liệu khớp.",
  "**Given** thiếu template, **When** xuất, **Then** báo `report_template_missing`."],
 ["API `POST /projects/{id}/reports`", "Điền dữ liệu vào template theo ADR-004", "Hộp thoại S07", "Test golden file"]),
("E12-3", "E12", "Gantt: kéo chỉnh ngày và kiểm tra BR-13", 8, "W", 7, ["E12-2"], "FR-20, FR-21; BR-13", "S11",
 "PM, Thành viên", "kéo thanh để đổi ngày bắt đầu và kết thúc", "lập lịch trực quan",
 ["**Given** quyền sửa, **When** kéo thanh, **Then** ngày đổi và ghi nhật ký.",
  "**Given** ngày kết thúc sớm hơn bắt đầu, **When** kéo, **Then** bị từ chối (BR-13)."],
 ["Kéo thả và gọi API", "Kiểm tra BR-13 hai lớp", "Ghi nhật ký", "Test"]),
("E10-3", "E10", "Responsive 360 px và kiểm tra trợ năng cho màn chính", 5, "M", 7, ["E3-1", "E10-1"], "FR-18; NFR-10", "S09",
 "mọi vai trò", "dùng tốt trên điện thoại và bằng bàn phím", "dùng ở mọi nơi",
 ["**Given** màn rộng 360 px, **When** mở màn chính, **Then** không tràn ngang, vùng bấm từ 44 px.",
  "**Given** axe, **When** quét, **Then** không còn lỗi critical, serious."],
 ["Rà từng màn ở 360 px", "Sửa lỗi axe", "Thêm vào e2e"]),
("E0-4", "E0", "Giám sát lỗi, uptime và log có cấu trúc", 3, "S", 7, ["E0-2"], "system-design.md mục 7; NFR-04", "-",
 "chủ dự án", "biết sớm khi hệ thống lỗi hoặc ngừng", "đạt uptime giờ hành chính",
 ["**Given** lỗi phía máy chủ, **When** xảy ra, **Then** ghi log có `request_id` và gửi cảnh báo.",
  "**Given** uptime dưới 99% giờ hành chính, **When** đo, **Then** có cảnh báo."],
 ["Chọn công cụ miễn phí (ADR, **[CẦN XÁC NHẬN]**)", "Log JSON có request_id", "Kiểm tra uptime"]),
("E0-10", "E0", "Quy trình migration lên staging/production và sao lưu", 3, "S", 7, ["E0-2"], "database.md mục 6; NFR-05", "-",
 "chủ dự án", "chạy migration an toàn và có sao lưu", "không mất dữ liệu khi đổi lược đồ",
 ["**Given** migration mới, **When** lên staging trước, **Then** qua kiểm tra rồi mới lên production.",
  "**Given** sự cố, **When** khôi phục, **Then** đạt RPO, RTO đã chốt (NFR-05, **[CẦN XÁC NHẬN]**)."],
 ["Tài liệu quy trình", "Thử khôi phục từ sao lưu", "Gắn vào CD"]),
("E6-2", "E6", "Xem và lọc nhật ký", 5, "S", 7, ["E6-1", "E0-8"], "UC-12", "nhật ký (mới)",
 "PM", "xem nhật ký dự án và task, lọc theo người, thời gian", "truy vết thay đổi",
 ["**Given** PM, **When** mở nhật ký, **Then** thấy danh sách thay đổi mới nhất trước.",
  "**Given** bộ lọc người hoặc thời gian, **When** áp dụng, **Then** kết quả khớp."],
 ["API `/projects/{id}/activity`", "Giao diện nhật ký", "Test"]),
("E12-4", "E12", "Gantt: hiển thị quan hệ và lập lịch", 8, "W", 8, ["E12-2", "E8-1"], "FR-20, FR-21; BR-13", "S11",
 "PM", "thấy mũi tên quan hệ đứng trước/đứng sau và dời ngày theo quy tắc lập lịch", "lịch tự cập nhật",
 ["**Given** quan hệ đứng trước, **When** hiển thị Gantt, **Then** có mũi tên nối đúng.",
  "**Given** task đứng trước dời ngày, **When** lập lịch tự động bật, **Then** task đứng sau dời theo (theo quyết định **[CẦN XÁC NHẬN]**)."],
 ["Vẽ quan hệ trên Gantt", "Quy tắc lập lịch", "Test"]),
("E4-3", "E4", "Nhắc hạn bằng bộ lập lịch, tùy chọn bật tắt", 5, "S", 8, ["E4-2"], "FR-11, FR-12; ADR-003", "-",
 "Thành viên", "nhận nhắc hạn đúng thời điểm và bật tắt theo loại", "không trễ hạn vì quên",
 ["**Given** task sắp đến hạn, **When** đến thời điểm nhắc (**[CẦN XÁC NHẬN]** trước bao lâu), **Then** gửi nhắc trong app và email.",
  "**Given** tắt nhắc, **When** đến hạn, **Then** không gửi email."],
 ["Bộ lập lịch theo ADR-003", "Bảng cấu hình `notification_preferences`", "Test"]),
("E5-4", "E5", "Xuất báo cáo docx theo template", 8, "M", 8, ["E5-3"], "FR-15; NFR-03", "S07",
 "PM", "xuất báo cáo tiến độ ra Word theo mẫu công ty", "báo cáo đúng mẫu để gửi lãnh đạo",
 ["**Given** dự án, kỳ và template docx, **When** xuất, **Then** tệp đúng mẫu, dữ liệu khớp.",
  "**Given** dự án 2.000 task, **When** xuất, **Then** dưới 30 giây (NFR-03)."],
 ["Điền dữ liệu vào template docx", "Mở rộng hộp thoại S07", "Test golden file"]),
("E5-5", "E5", "Kiểm thử xuất 2.000 task và golden file", 3, "S", 9, ["E5-4", "E0-7"], "NFR-03", "-",
 "chủ dự án", "kiểm chứng xuất báo cáo nhanh và đúng với dự án lớn", "đảm bảo NFR-03",
 ["**Given** 2.000 task, **When** xuất xlsx và docx, **Then** dưới 30 giây.",
  "**Given** tệp chuẩn, **When** so sánh, **Then** khớp."],
 ["Tạo dự án mẫu lớn", "Đo thời gian", "Lưu golden file"]),
("E1-7", "E1", "Hồ sơ cá nhân và ngôn ngữ ưa thích", 2, "S", 9, ["E1-1", "E0-8"], "FR-17", "hồ sơ (mới)",
 "người dùng", "xem và sửa hồ sơ, ngôn ngữ ưa thích", "dùng theo ý mình",
 ["**Given** người dùng, **When** đổi tên hiển thị, **Then** lưu và hiển thị.",
  "**Given** đổi ngôn ngữ ưa thích, **When** đăng nhập lại, **Then** giữ lựa chọn."],
 ["Màn hồ sơ", "API `PATCH /me`", "Test"]),
("E7-1", "E7", "Lưu dự án thành template và tạo dự án từ template", 8, "C", 9, ["E2-3", "E2-4", "E0-8"], "FR-04; UC-04", "hộp thoại mới",
 "PM", "lưu dự án thành template và tạo dự án mới từ template", "tạo dự án nhanh",
 ["**Given** dự án, **When** lưu thành template, **Then** có template chứa trạng thái, nhãn, cây task.",
  "**Given** template, **When** tạo dự án mới, **Then** cấu trúc được nhân bản."],
 ["Bảng `project_templates`", "API và hộp thoại", "Test"]),
]


def plan(velocity):
    """Xếp Story vào sprint: Must trước, tôn trọng phụ thuộc, sức chứa = velocity."""
    byid = {s[0]: s for s in ST}
    pts = {s[0]: s[3] for s in ST}
    placed = {}
    sprints = []
    for tier in ("M", "S", "C", "W"):
        remaining = [s[0] for s in sorted([s for s in ST if s[4] == tier], key=lambda s: (s[5], s[0]))]
        if not remaining:
            continue
        sprints.append([])
        while remaining:
            cur = sprints[-1]
            load = sum(pts[i] for i in cur)
            progress = False
            for sid in list(remaining):
                if load + pts[sid] <= velocity and all(d in placed for d in byid[sid][6]):
                    cur.append(sid)
                    placed[sid] = len(sprints)
                    load += pts[sid]
                    remaining.remove(sid)
                    progress = True
            if remaining and not progress:
                sprints.append([])
    return placed, sprints


def sprint_count_must(velocity):
    placed, sprints = plan(velocity)
    last = max(placed[s[0]] for s in ST if s[4] == "M")
    return last


def main():
    pts = {s[0]: s[3] for s in ST}
    total = sum(pts.values())
    must = sum(s[3] for s in ST if s[4] == "M")
    should = sum(s[3] for s in ST if s[4] == "S")
    could = sum(s[3] for s in ST if s[4] == "C")
    placed, sprints = plan(VELOCITY)
    must_sprints = max(placed[s[0]] for s in ST if s[4] == "M")

    def week(n):
        from datetime import date, timedelta
        y, m, d = [int(x) for x in START.split("-")]
        start = date(y, m, d) + timedelta(days=7 * (n - 1))
        return start, start + timedelta(days=4)

    byep = defaultdict(lambda: [0, 0, 0, 0])
    for s in ST:
        e = byep[s[1]]
        e[0] += s[3]
        e[{"M": 1, "S": 2, "C": 3, "W": 3}[s[4]]] += s[3]

    L = []
    A = L.append
    A("# WBS và kế hoạch sprint\n")
    A("Ngày: 2026-11-13 · Pha 4 · Trạng thái: Chờ duyệt")
    A("Sinh tự động từ [plan.py](plan.py) (chạy `python3 docs/04-wbs/plan.py [velocity]`); mọi con số do script tính.\n")
    A("## 1. Giả định")
    A("| Mục | Giá trị |\n|---|---|")
    A("| Thang ước lượng | Story point Fibonacci 1, 2, 3, 5, 8; Story trên 8 điểm phải tách |")
    A("| Sprint | 1 tuần, bắt đầu thứ Hai %s |" % START)
    A("| Velocity giả định | Baseline đã duyệt: %d điểm mỗi sprint. Lịch dưới đây xếp theo **%d điểm mỗi sprint** (mức cần để giữ hạn 8 tuần sếp đã chọn); chỉ là giả định, hiệu chỉnh từ sprint 2 bằng velocity thật |" % (BASELINE, VELOCITY))
    A("| Điểm Story | Ước lượng của Claude, chưa có dữ liệu thật; độ lệch dự kiến lớn ở Gantt, xuất báo cáo, RLS |")
    A("| Đường cắt MVP | Story Must; Should làm sau Must nếu còn thời gian; Could, Gantt (E12), E9, E11, E14 ngoài MVP (quyết định của sếp 2026-11-13: giữ hạn 8 tuần, bỏ Gantt khỏi MVP) |\n")
    A("## 2. Tổng điểm")
    A("| Epic | Tổng | Must | Should | Could và đợt sau |\n|---|---|---|---|---|")
    for k in EPICS:
        t = byep[k]
        A("| %s %s | %d | %d | %d | %d |" % (k, EPICS[k][0], t[0], t[1], t[2], t[3]))
    A("| **Toàn dự án** | **%d** | **%d** | **%d** | **%d** |" % (total, must, should, could))
    A("\nEpic ngoài MVP chưa ước lượng: " + "; ".join("%s %s" % (a, b) for a, b, c in OUT_OF_MVP) + ".\n")
    A("## 3. Kết quả kế hoạch và đánh giá R-003, R-009")
    A("- Điểm Must (đường cắt MVP): **%d**; với velocity %d cần **%d sprint (%d tuần)**, kết thúc khoảng %s." % (must, VELOCITY, must_sprints, must_sprints, week(must_sprints)[1]))
    A("- Mục tiêu đã duyệt là MVP **6 đến 8 tuần** (6 đến 8 sprint). %s" % (
        "**Kế hoạch hiện tại vượt mục tiêu.**" if must_sprints > 8 else "Kế hoạch nằm trong mục tiêu, **với điều kiện velocity thật đạt khoảng %d điểm mỗi sprint** (baseline đã duyệt là %d, rủi ro R-003 còn cao)." % (VELOCITY, BASELINE)))
    A("\n### Kịch bản (tính bằng code)")
    A("| Kịch bản | Điểm Must | Velocity %d | Velocity 25 | Velocity 30 |\n|---|---|---|---|---|" % BASELINE)

    def scen(skip_epics):
        keep = [s for s in ST if s[4] == "M" and s[1] not in skip_epics]
        return sum(s[3] for s in keep), keep

    def sprints_needed(keep_ids, vel):
        global ST
        saved = ST
        ST = [s for s in saved if s[0] in keep_ids]
        try:
            # bỏ phụ thuộc vào Story đã cắt
            fixed = []
            for s in ST:
                fixed.append(tuple(list(s[:6]) + [[d for d in s[6] if d in keep_ids]] + list(s[7:])))
            ST = fixed
            p, _ = plan(vel)
            return max(p.values())
        finally:
            ST = saved

    cases = [("Phạm vi đã chốt (Must, không Gantt)", []),
             ("Bỏ thêm chế độ xem đã lưu (E13)", ["E13"]),
             ("Bỏ thêm E13 và quan hệ giữa task (E8)", ["E13", "E8"]),
             ("Bỏ thêm E13, E8 và Dashboard, báo cáo (E5)", ["E13", "E8", "E5"])]
    for name, skip in cases:
        p, keep = scen(skip)
        ids = {s[0] for s in keep}
        row = [name, str(p)]
        for vel in (BASELINE, 25, 30):
            row.append("%d sprint" % sprints_needed(ids, vel))
        A("| " + " | ".join(row) + " |")
    full_ids = {s[0] for s in ST if s[4] == "M"}
    need = next((v for v in range(BASELINE, 120) if sprints_needed(full_ids, v) <= 8), None)
    A("\nĐể giữ nguyên phạm vi Must trong 8 sprint cần velocity thật từ khoảng %s điểm mỗi sprint (tính theo cách xếp Story và phụ thuộc ở trên); nếu velocity thật vẫn là %d thì cần cắt phạm vi hoặc kéo dài hạn. Quyết định thuộc về sếp ở gate.\n" % (need, BASELINE))
    A("### Danh sách cắt dự phòng nếu velocity thật thấp hơn %s (theo thứ tự cắt, giá trị trên mỗi điểm thấp nhất trước)" % need)
    A("| Thứ tự | Story | Điểm | Điểm Must còn lại | Velocity tối thiểu xấp xỉ cho 8 sprint |\n|---|---|---|---|---|")
    cut = ["E13-3", "E8-3", "E10-3", "E5-4", "E13-2", "E13-1"]
    left = must
    for i, cid in enumerate(cut, 1):
        left -= pts[cid]
        A("| %d | %s | %d | %d | %d |" % (i, cid, pts[cid], left, math.ceil(left / 8)))
    A("\nThứ tự này cần sếp xác nhận khi phải cắt; riêng E5-4 (docx) chỉ cắt nếu báo cáo xlsx đã đủ dùng.\n")
    A("## 4. Lịch sprint (velocity %d)" % VELOCITY)
    A("| Sprint | Tuần | Điểm | Story |\n|---|---|---|---|")
    for i, sp in enumerate(sprints, 1):
        a, b = week(i)
        A("| %d | %s đến %s | %d | %s |" % (i, a.strftime("%d/%m"), b.strftime("%d/%m"), sum(pts[x] for x in sp), ", ".join(sp)))
    A("\nSprint nào chỉ chứa Should hoặc Could nằm sau đường cắt MVP.\n")
    A("## 5. Bảng Story")
    A("| Story | Epic | Tên | Điểm | Ưu tiên | Sprint | Phụ thuộc |\n|---|---|---|---|---|---|---|")
    for s in sorted(ST, key=lambda s: (placed[s[0]], s[0])):
        A("| %s | %s | %s | %d | %s | %d | %s |" % (s[0], s[1], s[2], s[3], MO[s[4]], placed[s[0]], ", ".join(s[6]) or "không"))
    A("\nChi tiết từng Story (câu chuyện, tiêu chí Given/When/Then, tham chiếu, Task) ở thư mục [stories/](stories/).\n")
    A("## 6. Definition of Ready")
    A("Story chỉ được kéo vào sprint khi: (1) tiêu chí chấp nhận rõ; (2) màn hình liên quan đã duyệt (xem [review-log.md](../03-design/ui-ux/review-log.md)); (3) đã ước lượng; (4) không bị chặn bởi phụ thuộc chưa xong; (5) các điểm **[CẦN XÁC NHẬN]** liên quan đã được chốt.")
    A("\n## 7. Điểm cần chốt trước khi sprint tương ứng bắt đầu")
    A("| Điểm | Chặn Story | Cần trước sprint |\n|---|---|---|")
    A("| Danh sách loại task và trạng thái mặc định | E2-3 | %d |" % placed["E2-3"])
    A("| Cách tìm kiếm có dấu tiếng Việt | E3-3 | %d |" % placed["E3-3"])
    A("| Template báo cáo Word/Excel mẫu của công ty (R-005) | E5-2, E5-3, E5-4 | %d |" % placed["E5-2"])
    A("| Dịch vụ email (ADR-002) | E4-2 | %d |" % placed["E4-2"])
    A("| Quyết định lập lịch Gantt tự động hay thủ công | E12-3, E12-4 | %d |" % placed["E12-3"])
    A("| Thuật ngữ chính thức, kiểu quan hệ vào MVP | E8-1, E2-3 | %d |" % placed["E8-1"])
    A("| Nhắc hạn trước bao lâu | E4-3 | %d |" % placed["E4-3"])
    A("| Mockup 6 màn còn thiếu (E0-8) | E4-1, E5-2, E6-2, E7-1, E1-7 | %d |" % placed["E0-8"])
    open(os.path.join(HERE, "wbs.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")

    # Story chi tiết theo Epic
    for k, (name, parent) in EPICS.items():
        out = ["# %s %s\n" % (k, name), "Epic Linear: %s. Sinh tự động từ [plan.py](../plan.py).\n" % parent]
        for s in [x for x in ST if x[1] == k]:
            out.append("## %s %s\n" % (s[0], s[2]))
            out.append("**Epic**: %s %s" % (k, name))
            out.append("**Ưu tiên (MoSCoW)**: %s" % MO[s[4]])
            out.append("**Ước lượng**: %d điểm" % s[3])
            out.append("**Sprint đề xuất**: %d" % placed[s[0]])
            out.append("**Phụ thuộc**: %s\n" % (", ".join(s[6]) or "không"))
            out.append("### Câu chuyện\n")
            out.append("Là **%s**, tôi muốn **%s** để **%s**.\n" % (s[9], s[10], s[11]))
            out.append("### Tiêu chí chấp nhận\n")
            for i, a in enumerate(s[12], 1):
                out.append("%d. %s" % (i, a))
            out.append("\n### Tham chiếu\n")
            out.append("- Yêu cầu và quy tắc: %s" % s[7])
            out.append("- Màn hình: %s" % s[8])
            out.append("\n### Việc kỹ thuật (Task)\n")
            for t in s[13]:
                out.append("- [ ] %s" % t)
            out.append("- [ ] Viết test cho từng tiêu chí chấp nhận")
            out.append("- [ ] Cập nhật tài liệu nếu thay đổi thiết kế\n")
        open(os.path.join(HERE, "stories", "%s.md" % k), "w", encoding="utf-8").write("\n".join(out) + "\n")
    json.dump([{"id": s[0], "epic": s[1], "title": s[2], "points": s[3], "moscow": MO[s[4]], "deps": s[6], "sprint": placed[s[0]]} for s in ST],
              open(os.path.join(HERE, "stories.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("Tổng %d điểm; Must %d; Should %d; Could %d; %d sprint Must (velocity %d)" % (total, must, should, could, must_sprints, VELOCITY))


if __name__ == "__main__":
    main()
