# PROJECT_STATE: Quản lý Dự án CNTT
> Claude đọc file này đầu mỗi phiên, cập nhật ở mỗi gate.

| Mục | Giá trị |
|---|---|
| Slug / Team key | quan-ly-du-an-cntt / QLDA |
| Linear Team, Project | Team `QLDA` · Project [Quản lý Dự án CNTT](https://linear.app/justintran/project/quan-ly-du-an-cntt-c429c5997d32) (P-QLDA-5) · issue QLDA-1 đến QLDA-11 (pha), Epic QLDA-12 đến QLDA-26, Story QLDA-27 đến QLDA-78; Cycles 1 tuần từ 16/11/2026, thang Fibonacci |
| Repo | [gunzok/quan-ly-du-an-cntt](https://github.com/gunzok/quan-ly-du-an-cntt) (public) |
| Ngày khởi tạo | 2026-11-12 |
| Pha hiện tại | 5 Phát triển, sprint 1 xong (làm sớm từ 13/11/2026), đang vào sprint 2 |

## Gate
| Pha | Trạng thái | Ngày duyệt | Ghi chú |
|---|---|---|---|
| 0 Khởi tạo | Đã duyệt | 2026-11-12 | Repo chuyển public để bật gate (R-001 đã đóng) |
| 1 Khảo sát | Đã duyệt | 2026-11-13 (duyệt lại sau điều chỉnh OpenProject) | [requirements.md](docs/01-discovery/requirements.md) mục 0b: điều chỉnh theo OpenProject (Gantt vào MVP, chế độ xem đã lưu, vai trò theo dự án, nhập dữ liệu đợt sau); duyệt lại cùng gate Pha 3 |
| 2 BA + stack | Đã duyệt | 2026-11-13 (duyệt lại sau điều chỉnh OpenProject) | [business-analysis.md](docs/02-ba/business-analysis.md), [tech-stack-matrix.md](docs/02-ba/tech-stack-matrix.md), [ADR-001](docs/adr/ADR-001-tech-stack.md); CI thật: PR 5 do agent Opus 5.5 làm trong Orca, đã rà (5 check xanh, chạy lại cục bộ: lint, test, security qua, build qua khi bỏ NODE_ENV) |
| 3 Thiết kế | Đã duyệt | 2026-11-13 | [docs/03-design](docs/03-design/): đủ 4 phần (kiến trúc và bảo mật; DB và API; UI/UX 12 màn; design system và chiến lược test). Các điểm [CẦN XÁC NHẬN] trong tài liệu chốt trước khi code phần liên quan ở Pha 5 |
| 4 WBS | Đã duyệt | 2026-11-13 | [wbs.md](docs/04-wbs/wbs.md), [stories/](docs/04-wbs/stories/), [plan.py](docs/04-wbs/plan.py): 52 Story, 269 điểm (Must 211), sprint 1 tuần từ 16/11/2026; sếp chọn giữ hạn 8 tuần và bỏ Gantt khỏi MVP; cần velocity thật khoảng 28-30 điểm mỗi sprint (baseline 20), R-003 vẫn cao |
| 5 Phát triển | Đang làm | Gate sprint 1: **đã duyệt 2026-11-18** | Sprint 1 xong (13/11/2026): 6 Story, 29 điểm (E0-1, E0-6, E0-8, E1-1, E1-2, E1-3), velocity thực tế 29 so với kế hoạch 29 (baseline 20; cần khoảng 26 cho 7 sprint còn lại). Làm sớm (14-15/11/2026), đã merge: E0-3 (PR 18), E1-4 (PR 20), E2-2 (PR 21, 8 điểm), E0-5 (PR 23, 5), E1-5 (PR 24, 3), E10-1 (PR 22, 8), E1-8 (PR 26, 3; số Story phát sinh, E1-7 trong WBS là hồ sơ cá nhân), E2-1 (PR 27, 5), E6-1 (PR 28, 5), E2-3 (PR 30, 5), E8-1 (PR 29, 5), E3-3 (PR 32, 5), E2-4 (PR 33, 5), E1-6 (PR 34, 3), E13-1 (PR 35, 5), E0-7 (PR 37, 3), E10-2 (PR 36, 5), E2-5 (PR 40, 5), E5-1 (PR 39, 5), E3-1 (PR 41, 8), E8-2 (PR 42, 5), E2-6 (PR 45, 3), E3-2 (PR 44, 8), E4-1 (PR 43, 5), E13-2 (PR 47, 5), E5-2 (PR 48, 5), E3-4 (PR 49, 3), E13-3 (PR 50, 5), E6-2 (PR 51, 5), E8-3 (PR 52, 3), E1-7 (PR 55, 2), E10-3 (PR 56, 5): tổng 158 điểm sau sprint 1 (kế hoạch sprint 2 là 21-30 điểm; làm sớm hơn lịch nhiều sprint). Kiểm thử trên main: pgTAP 1314, integration 307, e2e 83. Hiệu năng 2.000 task: RLS đọc tính một lần mỗi truy vấn (E3-4), mở Kanban/Danh sách dưới 1 giây. Chore ổn định e2e (PR 53). Còn lại: E1-7, E10-3, E0-9 và nhóm xuất báo cáo (E5-3, E5-4, cần template thật), E4-2/E4-3 (cần tên miền email), E7-1, E0-2 (staging, CD), E0-4, E0-10 |
| 6 Nghiệm thu, bàn giao | Chưa bắt đầu | | |
Trạng thái: Chưa bắt đầu · Đang làm · Chờ duyệt · Đã duyệt · Cần rà soát.

## Quyết định
| Hạng mục | Quyết định | Nguồn |
|---|---|---|
| Tech stack | Next.js (TypeScript) + Supabase (Postgres, Auth, Storage) + Vercel; sếp chọn phương án A (84 điểm, B 80 điểm) | ADR-001 (2026-11-13) |
| Quy tắc nghiệp vụ đã chốt | Subtask tối đa 3 cấp; Thành viên chỉ sửa task mình phụ trách hoặc tạo; task bị chặn chỉ cảnh báo, vẫn cho hoàn thành | business-analysis.md |
| Nơi làm code | IDE Orca. Repo code: `~/orca/projects/app-quanlyduan` (origin = gunzok/quan-ly-du-an-cntt); worktree/nhánh code nằm local trong `~/orca/workspaces/app-quanlyduan/`. Nhánh chỉ đẩy lên GitHub khi mở PR để CI chạy và merge; main được kéo về Orca sau khi merge. Bản clone `~/Projects/quan-ly-du-an-cntt` dùng cho tài liệu và PROJECT_STATE | Sếp yêu cầu 2026-11-13 |
| Quy ước đặt tên | Định danh kỹ thuật tiếng Anh không dấu; tài liệu, issue, PR tiếng Việt | Skill |
| Màu, phong cách | **Blueprint (v2, sếp duyệt 2026-11-13)** theo nghiên cứu Dribbble samoctav: xanh điện #2054F0 màu chính, hồng #E56DAF chỉ trang trí (chữ hồng #B0256E); Inter (nội dung), Inter Tight (tiêu đề), JetBrains Mono (nhãn, mã, số); nhãn đánh số kỹ thuật; đường kẻ mảnh thay bóng; lưới bản vẽ chỉ trang trí; sáng và tối theo hệ thống; WCAG AA tính bằng code. Thay cho v1 (kiểu Linear, #1D4ED8). Token trong app/globals.css | [style-research-samoctav.md](docs/03-design/style-research-samoctav.md), [design-system.md](docs/03-design/design-system.md) |
| Loại task, trạng thái mặc định | Loại task: Task, Bug, Milestone, Phase. Trạng thái **theo OpenProject** (sếp chốt 2026-11-15, thay bản 2026-11-13 gồm Cần làm, Đang làm, Chờ review, Hoàn thành): Mới (todo), Đang thực hiện, Đang kiểm thử, Cần phản hồi (in_progress), Đã xong, Đã đóng, Từ chối (done). PM sửa được theo từng dự án; đã code ở E2-3 | Sếp chốt ở S19 (2026-11-13) và 2026-11-15 |
| Tìm kiếm | Tìm bỏ dấu bằng extension `unaccent` (gõ "bao cao" ra "Báo cáo"), không phân biệt hoa thường, không fuzzy | Sếp chốt 2026-11-15 (E3-3) |
| Xóa task cha còn việc con | **Chặn xóa** khi còn con (phải xóa hoặc chuyển con trước), thay cho xóa dây chuyền; ngoại lệ xóa cả dự án và xóa tài khoản. Việc làm: QLDA-81 | Sếp chốt 2026-11-18 |
| Chế độ xem mặc định Tóm tắt | Giữ như hiện tại: mọi task nhóm theo trạng thái (dashboard S06 đã có tổng quan); không làm trang báo cáo riêng | Sếp chốt 2026-11-18 |
| Làm trước khi chưa có thông tin thật | Báo cáo xlsx/docx bằng template mẫu giả (E5-3, E5-4, E5-5; khi có template thật chỉ tải lên và chỉnh ánh xạ); email giao việc và nhắc hạn qua giao diện EmailSender (Resend) thử bằng Mailpit (E4-2, E4-3; tên miền và khóa Resend cấp sau); chuẩn bị staging/CD (E0-2, E0-4, E0-10: mã, workflow, tài liệu vận hành; sếp tự tạo tài khoản Supabase/Vercel và duyệt chi phí R-008) | Sếp chốt 2026-11-18 |
| Kiểu quan hệ task | Đủ 4 kiểu vào MVP: liên quan, chặn, đứng trước, trùng lặp; `blocks` và `precedes` chung một đồ thị chống vòng | Triển khai ở E8-1 (PR 29), theo danh sách kiểu của câu hỏi mở Pha 1; sếp xem lại nếu muốn bớt kiểu |
| ADR-002 đến ADR-005 | Đã duyệt 2026-11-13: email Resend (cần tên miền), lập lịch Supabase pg_cron (nhắc 1 và 3 ngày, 08:00 giờ Việt Nam), xuất báo cáo docx-templates + exceljs (spike ở E5-3), giao diện Tailwind + shadcn/ui | Story E0-6 |
| Quy ước đặt tên (Pha 3) | DB snake_case số nhiều; API REST /api/v1/<tài-nguyên>; file kebab-case, component PascalCase; nhánh type/QLDA-123-slug, Conventional Commits | Pha 3 (2026-11-13) |
| Tham chiếu OpenProject | Team đang dùng OpenProject; giống thuật ngữ và chức năng, giữ giao diện hiện đại v1. Team dùng hằng ngày: Work packages (bảng, phân cấp, quan hệ, bộ lọc đã lưu), Gantt, Boards. Không cần theo dõi thời gian và chi phí. Vai trò theo từng dự án. Nhập dữ liệu từ OpenProject làm sau MVP. Không sao chép mã, logo, tên OpenProject | Sếp quyết định 2026-11-13 |
| Thang ước lượng, độ dài sprint | Story point Fibonacci 1-8; sprint 1 tuần bắt đầu thứ Hai 16/11/2026; velocity baseline 20 điểm, lịch xếp theo 30 để kịp 8 tuần (hiệu chỉnh từ sprint 2); danh sách cắt dự phòng ở wbs.md | Pha 4 (2026-11-13) |
| Loại app, quy mô | Nội bộ một công ty, dưới 100 người, web responsive, Việt + Anh | Pha 1 (A1-A5) |
| Phạm vi MVP | Dự án/task, Kanban + danh sách, vai trò theo từng dự án (PM, Thành viên, Người xem) cộng Admin toàn hệ thống, xuất báo cáo xlsx/docx theo template, thông báo app + email, nhãn/ưu tiên/trạng thái, tìm kiếm, dashboard, subtask, nhật ký, template dự án, quan hệ giữa task, chế độ xem đã lưu, bảng phân cấp. Đợt sau: Gantt (E12, chuyển lại ở gate Pha 4), theo dõi thời gian, bình luận, tệp đính kèm, thùng rác, nhập dữ liệu từ OpenProject | Pha 1 (điều chỉnh 2026-11-13, cần duyệt lại) |
| Điều phối agent tự động | Phiên điều phối dùng Monitor theo dõi worktree Orca (`watch-agents.sh`, mỗi 20 giây): khi agent xong thì tự rà diff, chạy lại lệnh, merge khi 5 check xanh và đủ điều kiện, cập nhật Linear, rồi giao Story kế tiếp mà không chờ sếp hỏi. Chỉ dừng để hỏi khi cần quyết định nghiệp vụ, thay đổi nhạy cảm lệch thiết kế, chi phí, hoặc bí mật. Monitor hết hạn mỗi 30 phút nên phải bật lại | Sếp yêu cầu 2026-11-13 |
| Cách làm việc liên quan đến code | Mọi việc code của dự án (dựng khung, Makefile thật, tính năng, test, sửa lỗi) giao cho agent riêng chạy song song, dùng mô hình Opus 5.5 (`claude-opus-5-5`). Chỉ song song khi các việc không đụng cùng file; việc phụ thuộc nhau chạy tuần tự. Phiên chính điều phối, rà kết quả và merge. Tài liệu, Linear, gate do phiên chính làm | Sếp yêu cầu 2026-11-13 |
| Triển khai, ngân sách, nhân sự | Cloud PaaS, dưới 25 USD/tháng, một người cùng Claude, MVP 6-8 tuần | Pha 1 (C4, D1-D3) |
| Repo | Public (gói Free không bật được gate với repo private), squash merge, approval PR = 0 (làm một mình). Không commit bí mật, dữ liệu khách hàng | Pha 0 |
| Gate GitHub | `main` bảo vệ: bắt buộc PR, check `ci-gate`, branch cập nhật, giải quyết comment, cấm force push, áp dụng cả admin. Environment `production` cần `gunzok` duyệt | Pha 0 |

## Rủi ro
| Mã | Mô tả | Xác suất | Ảnh hưởng | Xử lý | Trạng thái |
|---|---|---|---|---|---|
| R-001 | Repo private trên gói GitHub Free không bật được branch protection và environment có người duyệt | Cao | Cao | Chuyển repo sang public (sếp duyệt 2026-11-12), bật lại bảo vệ và kiểm tra bằng `gh api` | Đã đóng |
| R-002 | Repo public: mã nguồn ai cũng xem được, rủi ro lộ bí mật hoặc dữ liệu thật | Trung bình | Cao | Không commit bí mật; dùng GitHub secret scanning và biến môi trường; xem lại khi có dữ liệu thật (Pha 3 threat model) | Mở |
| R-003 | Phạm vi lớn so với hạn 8 tuần, một người làm; MVP Must 211 điểm cần velocity thật khoảng 28-30 điểm mỗi sprint (baseline 20) | Cao | Cao | Đã bỏ Gantt khỏi MVP; hiệu chỉnh velocity sau sprint 1 và 2; danh sách cắt dự phòng ở wbs.md (E13-3, E8-3, E10-3, E5-4...) | Mở, cao |
| R-009 | Muốn giống OpenProject (sản phẩm lớn, nhiều năm phát triển) nên kỳ vọng của team về độ giống có thể vượt MVP | Cao | Trung bình | Giống thuật ngữ và chức năng đã chọn, không giống mọi chi tiết; lấy ảnh màn hình thật của team để xác định phần dùng nhiều nhất | Mở |
| R-004 | Bình luận bị để đợt sau dù mục tiêu là cộng tác PM và team kỹ thuật | Trung bình | Trung bình | Xác nhận ở gate Pha 1 | Mở |
| R-005 | Chưa có template báo cáo Word/Excel của công ty | Cao | Cao | Sếp cung cấp mẫu trước Pha 3 | Mở |
| R-006 | Xuất Word/Excel trên Vercel (serverless) có giới hạn thời gian, bộ nhớ | Trung bình | Trung bình | Thử nghiệm sớm ở Pha 3-5 với dự án 2.000 task (NFR-03); nếu không đạt thì xem lại ADR-001 | Mở |
| R-007 | MVP xóa task/dự án vĩnh viễn vì thùng rác để đợt sau (BR-11) | Trung bình | Trung bình | Có hộp xác nhận, nhật ký ghi lại; xem lại sau MVP | Mở |
| R-008 | Giá, giới hạn gói Supabase/Vercel/Neon/Render chưa xác minh từ trang chính thức; Vercel Hobby cấm dùng thương mại, lên Pro/Supabase Pro dễ vượt 25 USD/tháng | Cao | Trung bình | Đối chiếu trang giá chính thức trước khi mua gói; sếp duyệt riêng khi chi phí vượt 25 USD (ADR-001) | Mở |

## UI/UX
Canvas: https://claude.ai/artifact/6TYQPPKUomg2eNFQ139uGW, trang "Blueprint (đã duyệt)". Bản cũ giữ ở trang "Bản cũ trước Blueprint (lưu trữ)". File: `docs/03-design/ui-ux/mockups/v3/bp-*.dc.html`.

| Màn hình | Phiên bản | Trạng thái | Ngày |
|---|---|---|---|
| S01 Đăng nhập | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S02 Danh sách dự án | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S03 Bảng Kanban | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S04 Danh sách task và bộ lọc | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S05 Chi tiết task | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S06 Dashboard tiến độ | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S07 Xuất báo cáo | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S08 Quản lý người dùng (có Phòng ban) | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S09 Kanban điện thoại | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S10 Kanban chế độ tối | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S11 Gantt | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S12 Chế độ xem đã lưu | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S13 Tạo dự án và chọn template | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S14 Tạo task nhanh | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S15 Nhật ký hoạt động | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S16 Thông báo và cài đặt email | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S17 Quản lý template dự án và báo cáo | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S18 Hồ sơ cá nhân | Blueprint (v3) | Đã duyệt | 2026-11-13 |
| S19 Cấu hình dự án: trạng thái, loại task, nhãn | Blueprint (v3) | Đã duyệt | 2026-11-13 |

## Hạn chế đã biết
- Cycles Linear chưa bật (bật ở Team settings nếu muốn dùng).
- CI thật đã vào `main` qua PR 5 (2026-11-13); Dependabot PR 1 đã đóng vì trùng.
- Build cục bộ cần `NODE_ENV` không bị đặt sai (nếu shell đặt `NODE_ENV=development` thì `next build` lỗi; CI không bị). Chạy `env -u NODE_ENV make build`.

## CI còn STUB
Không còn (PR 5 đã merge): lint (ESLint, Prettier, tsc), test (Vitest), build (next build), security (gitleaks toàn lịch sử + pnpm audit mức high). Từ PR 18 CI có thêm `test-db` (pgTAP trên Supabase cục bộ), `e2e` (Playwright + axe trên /login), tổng 7 check, `ci-gate` vẫn là check bắt buộc duy nhất. `make test-integration` giờ báo lỗi (đỏ) nếu chưa chạy `make db-start`, không còn bỏ qua im lặng. Deploy staging/production vẫn là STUB trong `cd.yml` (E0-2).

## Câu hỏi mở
- Cần bật Cycles Linear không, và độ dài sprint (1 hay 2 tuần)?
- Template báo cáo tiến độ hiện dùng (file mẫu)? Ngưỡng số cho thước đo thành công?
- OpenProject: ảnh chụp các màn team dùng nhiều nhất, danh sách module đang bật, phiên bản, gói (Community hay Enterprise).
- Thuật ngữ chính thức: giữ tiếng Anh (Work package, Type, Status...) hay tiếng Việt; kiểu quan hệ vào MVP (liên quan, chặn, đứng trước, trùng lặp); Gantt lập lịch tự động hay thủ công; loại task mặc định (Task, Bug, Milestone, Phase).
- Các câu BA còn mở: RPO/RTO, quy định dữ liệu cá nhân, thời điểm nhắc hạn; email, bộ lập lịch, thư viện xuất báo cáo, thư viện UI, thư viện Gantt cần ADR.

## Bước tiếp theo
0. Đã xong: E0-3, E1-4, E2-2, E0-5, E1-5, E10-1, E1-8, E2-1, E6-1, E2-3, E8-1, E3-3, E2-4, E1-6, E13-1, E0-7, E10-2, E2-5, E5-1, E3-1, E8-2, E2-6, E3-2, E4-1, E13-2, E5-2, E3-4, E13-3, E6-2, E8-3, E1-7, E10-3. Còn lại: E0-9 (bộ e2e 9 luồng; luồng xuất báo cáo chờ E5-3), E7-1 (template dự án, Could), và các Story cần quyết định của sếp: E5-3, E5-4, E5-5 (template báo cáo thật, R-005), E4-2, E4-3 (tên miền email, ADR-002), E0-2, E0-4, E0-10 (staging, CD: OAuth Google, chi phí Vercel/Supabase, R-008).

1. Kế tiếp (tự giao khi agent xong, tránh đụng cùng file): E1-6 (PM gán vai trò thành viên, dùng chung UI cấu hình dự án), E10-2 (i18n; chạm `lib/strings.ts` nên làm sau khi E3-3, E2-4 merge), E2-6 (phần lớn đã có test trong E2-2: rà trước khi giao), E8-2 (giao diện quan hệ), E0-7 (dữ liệu 2.000 task để đo hiệu năng), E6-2. Cần Story mới: gửi lại lời mời cho tài khoản chưa có mật khẩu và quên mật khẩu (xem mục dưới).
2. Sếp gửi template báo cáo Word/Excel (trước sprint 6), ảnh chụp OpenProject, chốt loại task và trạng thái mặc định (trước sprint 3), kiểu quan hệ vào MVP.
3. Sau sprint 1 và 2: tính velocity thật, đánh giá lại R-003, dùng danh sách cắt dự phòng nếu cần.
4. Xem Dependabot PR 6 (TypeScript 5.9.3 lên 6.0.3) và PR 7 (React 19.3.1) trước khi merge.

## Việc phát sinh từ E1-4 (chưa có Story)
- Trang nhận lời mời / đặt mật khẩu: **đã làm ở E1-8 (PR 26)**. Còn lại: (a) nếu `verifyOtp` xong mà `updateUser` lỗi thì token đã dùng và Admin gửi lại lời mời gặp `409` (cần Story gửi lại lời mời hoặc quên mật khẩu cho tài khoản chưa có mật khẩu); (b) TTL link mời mặc định 1 giờ, nên cân nhắc 86400; (c) cấu hình Supabase dự án thật: Site URL, mẫu email "Invite user" (`supabase/templates/invite.html`), mật khẩu tối thiểu 12; (d) đăng nhập Google của người được mời chưa kiểm với OAuth client thật.
- Test e2e `accept-invite.spec.ts` chập chờn đã sửa ở E2-6 (PR 45: chờ hydrate trước khi điền form, tài khoản tạm). Giới hạn đăng nhập `loginIp` 50 lần/5 phút dùng chung nhóm `ip:unknown` cho cả bộ e2e (53 test): đã nới CHỈ khi chạy test-e2e cục bộ và trên CI (cờ `E2E_RELAXED_LOGIN_RATE_LIMIT`, không bật được trên Vercel); các spec còn lại vẫn dùng persona seed và SEED_PASSWORD.
- E2-3: tạo/sửa task kèm nhãn là hai lệnh (sửa task rồi `set_task_labels`), không cùng giao dịch; nhật ký (E6) chưa ghi thay đổi `task_labels`, cấu hình, quan hệ. E8-1: thông điệp lỗi quan hệ ở `lib/task-relations/messages.ts`, cần chuyển vào `lib/strings.ts`; `GET /tasks/{id}` chưa kèm quan hệ (E8-2).
- E2-1: `project_stats` đã đo ở E0-7 (27 ms trong CSDL với 2.000 task, do RLS tính quyền từng dòng; đề xuất cho E3-4 viết lại `tasks_select`); tiến độ dự án tính theo `completed_at` (đã đặt bởi trigger từ E2-3).
- E2-4: xóa task cha vẫn xóa dây chuyền mọi hậu duệ (ON DELETE CASCADE từ E2-2): **sếp đã chốt chặn xóa khi còn con (2026-11-18), đang làm QLDA-81**. Mã lỗi BR-04 và vượt 3 cấp là 422 (không phải 409 như hợp đồng bản đầu, đã sửa tài liệu). Chưa có lọc `parent_id` trong danh sách task (đã có từ E2-5). Gắn việc con vào task P đòi quyền sửa P.
- E1-6: khóa tài khoản (E1-4) không bị chặn khi người đó là PM hoạt động cuối của một dự án, dự án đó chỉ còn Admin quản lý được; chưa có Story. `GET /api/v1/users/search` trả email cho PM (ngoại lệ có chủ ý theo quyết định 2026-11-13).
- E13-1: chế độ xem "Giao cho tôi", "Tạo bởi tôi", "Quá hạn" (E13-2) cần mở rộng bộ lọc API danh sách task và hàm CHECK `saved_view_query_is_valid`; `saved_view` chưa có trong `activity_logs`.
- E3-3: tìm kiếm dùng hàm SECURITY DEFINER `search_task_ids` (chỉ trả id khi người gọi thấy dự án) để dùng được chỉ mục trigram dưới RLS; từ khóa phổ biến vẫn tốn vài chục ms vì chỉ mục GIN không chia theo dự án (E3-4 cân nhắc `btree_gin`).
- E3-1, E3-2: Kanban và bảng danh sách tải hết task bằng ~20 lượt gọi API tuần tự rồi nhóm ở trình duyệt (mở bảng 2.000 task khoảng 2,4 đến 3 giây); E3-4 cần API trả trang lớn hơn hoặc sắp theo position, hoặc gọi song song. Thanh tab con của trang dashboard (`components/dashboard/project-views-nav.tsx`) trùng với thanh chính thức `components/project-shell/project-header.tsx`, nên gộp. Migration có thứ tự timestamp: E3-2 `20261115260000` phải áp trước E4-1 `20261115270000`.
- Quy trình giao agent: `orca worktree create --agent` có lần chỉ tạo worktree mà không mở terminal agent (không báo lỗi); phải kiểm terminal agent có chạy, nếu không dùng `orca agent launch --worktree branch:<nhánh>`. Agent có thể dừng chờ phê duyệt lệnh bị gắn cờ: đọc màn hình bằng `orca terminal read --screen`.
- Cần xác nhận kiểm Origin (chống CSRF) đúng khi chạy sau proxy Vercel (E0-5 gom tiện ích dùng chung).
- Chưa chặn gỡ PM cuối cùng của dự án (trigger ở Story sau).
- GitHub secret scanning + push protection: sếp bật tay (E0-5, chưa làm).
- E0-5: đăng nhập fail-closed nên Vercel (Production và Preview) bắt buộc có `SUPABASE_SERVICE_ROLE_KEY`; nên đặt `RATE_LIMIT_SECRET`. Root layout render động (mất PPR) vì CSP nonce.
- E2-2: Thành viên chỉ phụ trách (không tạo) task không giao task đi được; Người xem không nhận việc; thành viên bị gỡ khỏi dự án vẫn giữ `assignee_id` cũ; dự án archived chưa chặn sửa task. Sếp quyết nếu muốn nới.
- E10-1: biểu tượng (Lucide hay SVG tự vẽ) chưa chốt; `lib/admin/users/policy.ts` và `lib/api/request.ts` đã dùng chung `lib/api/csrf.ts`.
- E1-5: `GET /api/v1/users` vẫn chỉ Admin (hợp đồng ghi P/M/V xem người trong dự án chung, chưa làm).
- Kho local dùng chung một stack Supabase: bản `admin_list_users` cũ/lệch của worktree khác làm test-db cục bộ đỏ; CI dựng stack mới nên đúng.
- Dọn: nâng `lib/admin/users/validate.ts` dùng chung `lib/api/request.ts` (isUuid, unknownFields).

## Retro sprint 1 (2026-11-13)
- Giữ: agent Opus 5.5 trong Orca làm song song, phiên điều phối rà độc lập (chạy lại lệnh, không chỉ tin báo cáo); test pgTAP và test tích hợp bắt lỗi thật.
- Bỏ: để nhiều worktree dùng chung một stack Supabase cục bộ mà không báo nhau. E1-3 reset DB làm E1-1 gặp vòng chuyển hướng (đã sửa bằng `getUser()`); từ nay chỉ một agent reset DB tại một thời điểm hoặc chạy test không reset.
- Thử: giao Story khi phụ thuộc đã merge, không chờ hết sprint; velocity tính khi cuối sprint.
- Rủi ro: R-003 còn cao (velocity 29 đạt mức cần, nhưng các Story sau phức tạp hơn: báo cáo, quan hệ, chế độ xem); R-008 chi phí; chưa kiểm chứng Google thật.

## Việc phát sinh từ đợt E4-1 đến E8-3 (2026-11-17)
- E4-1: lỗi khi tạo thông báo không bị nuốt (không khối EXCEPTION), nên lỗi lập trình trong trigger làm thao tác sửa task cũng lỗi, chỉ lộ ra ở test; đổi trạng thái hàng loạt hoặc kéo qua lại trên Kanban tạo nhiều thông báo (chưa gộp, chưa chống spam); `task_id` NOT NULL nên loại thông báo không gắn task cần migration nới; job dọn thông báo đã đọc sau 90 ngày chờ pg_cron (cùng E4-3).
- E5-2: chưa có template Word/Excel thật (R-005), mọi kiểm thử dùng tệp OOXML giả ở `tests/fixtures/ooxml.ts`; giới hạn tệp 4 MiB; mỗi định dạng một template đang dùng; xóa là xóa thật nên E5-3 đặt `report_exports.template_id` `ON DELETE SET NULL`; CI test-db và e2e nay giữ dịch vụ `storage-api`.
- E13-2: "Tóm tắt" hiện là mọi task nhóm theo trạng thái; OpenProject có trang báo cáo riêng, sếp xác nhận. E13-3: đổi riêng tư ↔ công khai không hỏi xác nhận.
- E3-4: từ nay sửa chính sách RLS đọc phải giữ `project_role_of` và `my_project_ids` đồng bộ; migration có thứ tự timestamp (…290000 E13-2, …300000 E5-2, …310000 E3-4, …330000 E8-3).
- E6-2: tab Nhật ký hỏi `GET .../activity?limit=1` một lần để ẩn với Thành viên (có thể truyền `canViewActivity` từ trang). E8-3: `precedes` không chặn; mở lại task chặn trên Kanban chỉ hiện lại "Bị chặn" sau lần tải sau.
- E2E: giới hạn `loginEmail` (10 lần/15 phút mỗi email) vẫn áp trong chế độ nới của test-e2e; lượt chạy cả bộ cục bộ có lúc 7 đến 9 spec persona đăng nhập bị đẩy về /login (chạy riêng thì xanh, CI xanh). Nên chuyển spec persona sang `storageState`. `tests/integration` để lại tài khoản `it-*` trên CSDL dùng chung. Nhiều phiên cùng `db-seed` với SEED_PASSWORD khác nhau làm spec persona đỏ chéo nhau.
- Thanh tab con của trang dashboard (`components/dashboard/project-views-nav.tsx`) trùng `components/project-shell/project-header.tsx`, nên gộp.
- E1-7: ghi `profiles` (tên, ngôn ngữ) và `profile_contacts` (số điện thoại) là hai câu lệnh riêng, lỗi giữa chừng để lại lưu một phần (cân nhắc hàm RPC); giao diện sáng/tối lưu cookie `qlda_theme` theo trình duyệt, không đồng bộ giữa thiết bị.
- E10-3: tiêu đề task trong bảng Danh sách bị cắt "…" trên điện thoại (mất chữ), cần thiết kế chọn xuống dòng, tooltip hay giữ nguyên. Spec `responsive-a11y.spec.ts` phải được bổ sung khi thêm màn mới.
