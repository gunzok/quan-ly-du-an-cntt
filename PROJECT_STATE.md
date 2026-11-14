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
| 5 Phát triển | Đang làm | | Sprint 1 xong (13/11/2026): 6 Story, 29 điểm (E0-1, E0-6, E0-8, E1-1, E1-2, E1-3), velocity thực tế 29 so với kế hoạch 29 (baseline 20; cần khoảng 26 cho 7 sprint còn lại). Sprint 2 (đang chạy, sớm): xong E0-3 (QLDA-34, PR 18) và E1-4 (QLDA-36, PR 20, 5 điểm, pgTAP 147, integration 26); đang làm E10-1 (QLDA-30), E2-2 (QLDA-38), E0-5 (QLDA-44) |
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
| Loại task, trạng thái mặc định | Loại task: Task, Bug, Milestone, Phase. Trạng thái: Cần làm, Đang làm, Chờ review, Hoàn thành | Sếp chốt ở S19, 2026-11-13 |
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
0. E0-3 và E1-4 đã xong; E10-1, E2-2, E0-5 đang chạy. Kế tiếp tự giao: E1-5 (phòng ban, lọc), E2-1 (danh sách dự án, S02); E0-2 (môi trường staging, CD) chờ quyết định của sếp; sếp cần cung cấp OAuth client Google cho staging, tên miền email (ADR-002), và quyết định chi phí Vercel/Supabase (R-008).
1. Pha 5 sprint 1: rà PR của E1-1 và E1-3 khi agent xong (E1-3 là thay đổi phân quyền, nhạy cảm, cần sếp nhìn kỹ), merge khi 5 check xanh, rồi giao E1-2 (đăng nhập Google). 
2. Sếp gửi template báo cáo Word/Excel (trước sprint 6), ảnh chụp OpenProject, chốt loại task và trạng thái mặc định (trước sprint 3), kiểu quan hệ vào MVP.
3. Sau sprint 1 và 2: tính velocity thật, đánh giá lại R-003, dùng danh sách cắt dự phòng nếu cần.
4. Xem Dependabot PR 6 (TypeScript 5.9.3 lên 6.0.3) và PR 7 (React 19.3.1) trước khi merge.

## Việc phát sinh từ E1-4 (chưa có Story)
- Trang nhận lời mời / đặt mật khẩu (`/auth/accept-invite`): link mời mặc định của Supabase chưa có trang đích; người được mời hiện chưa có đường vào ứng dụng. Cần tạo Story (gợi ý sprint 2-3) và kiểm đăng nhập Google của người được mời.
- Cần xác nhận kiểm Origin (chống CSRF) đúng khi chạy sau proxy Vercel (E0-5 gom tiện ích dùng chung).
- Chưa chặn gỡ PM cuối cùng của dự án (trigger ở Story sau).
- GitHub secret scanning + push protection: sếp/điều phối bật tay (E0-5).

## Retro sprint 1 (2026-11-13)
- Giữ: agent Opus 5.5 trong Orca làm song song, phiên điều phối rà độc lập (chạy lại lệnh, không chỉ tin báo cáo); test pgTAP và test tích hợp bắt lỗi thật.
- Bỏ: để nhiều worktree dùng chung một stack Supabase cục bộ mà không báo nhau. E1-3 reset DB làm E1-1 gặp vòng chuyển hướng (đã sửa bằng `getUser()`); từ nay chỉ một agent reset DB tại một thời điểm hoặc chạy test không reset.
- Thử: giao Story khi phụ thuộc đã merge, không chờ hết sprint; velocity tính khi cuối sprint.
- Rủi ro: R-003 còn cao (velocity 29 đạt mức cần, nhưng các Story sau phức tạp hơn: báo cáo, quan hệ, chế độ xem); R-008 chi phí; chưa kiểm chứng Google thật.
