# Design system

Phiên bản: **v2 "Blueprint"** · Ngày: 2026-11-13 · Pha 3 (bổ sung) · Trạng thái: **Đã duyệt** (sếp duyệt 2026-11-13)
- v1 (đã duyệt 2026-11-13): tối giản kiểu Linear, xanh dương `#1D4ED8`, Inter. Toàn bộ giá trị v1 vẫn còn trong lịch sử git (commit `fe70395`).
- v2: sếp yêu cầu áp dụng phong cách Dribbble samoctav. Nghiên cứu và nguồn ở [style-research-samoctav.md](style-research-samoctav.md).

Không đổi so với v1: gọn, nhiều thông tin; sáng và tối theo hệ thống; Inter cho nội dung; WCAG 2.1 AA. Tỷ lệ tương phản bên dưới tính bằng Python theo công thức WCAG 2.1 (chữ thường cần từ 4,5:1, chữ lớn và thành phần giao diện từ 3:1).

## 0. Nguyên tắc Blueprint
1. **Xanh điện là màu chính, hồng là điểm nhấn nhỏ.** Hồng chiếm dưới 5% bề mặt: chấm trước nhãn, chấm cuối tiêu đề lớn, vạch "hôm nay", huy hiệu "mới".
2. **Chữ hai lớp:** Inter Tight nét mảnh cho tiêu đề lớn, Inter cho nội dung, JetBrains Mono in hoa cho nhãn, mã, số liệu.
3. **Đánh số kỹ thuật:** `01 / CẦN LÀM`, `QLDA-128`, `DỰ ÁN / 004`.
4. **Đường kẻ mảnh thay cho bóng.** Thẻ dùng viền 1px; bóng chỉ cho menu nổi và hộp thoại.
5. **Lưới bản vẽ chỉ để trang trí** ở đăng nhập, khung trang, trạng thái rỗng. Không đặt sau bảng dữ liệu.
6. **Số liệu là nhân vật chính:** số lớn, chú thích mono nhỏ, thanh tiến độ mảnh có thang.

## 1. Màu (token)
Đặt tên: `--color-<vai-trò>`; giá trị đổi theo chế độ sáng, tối. Nguồn màu gốc đo từ ảnh: xanh `#2054F0`, hồng `#E56DAF`, đen `#030304`, xanh nhạt `#CDDBF2`.

| Token | Sáng | Tối | Dùng cho |
|---|---|---|---|
| `--color-bg` | `#FFFFFF` | `#05060A` | Nền vùng nội dung |
| `--color-bg-subtle` | `#F7F8FA` | `#0D1020` | Thanh bên, cột Kanban |
| `--color-bg-muted` | `#EEF2FD` | `#161B33` | Hover, hàng được chọn, nền nhóm |
| `--color-canvas` | `#CDDBF2` | `#030304` | Nền ngoài khung ứng dụng (màn rộng) |
| `--color-text` | `#0A0F1F` | `#E8EAF2` | Chữ chính |
| `--color-text-muted` | `#4A5163` | `#9AA2B8` | Chữ phụ, nhãn |
| `--color-primary` | `#2054F0` | `#7B97FF` | Nút chính, liên kết, tiêu điểm, thanh tiến độ |
| `--color-primary-hover` | `#1840C8` | `#9DB2FF` | Hover nút chính |
| `--color-on-primary` | `#FFFFFF` | `#05060A` | Chữ trên nút chính |
| `--color-brand` | `#2054F0` | `#2054F0` | Khối màu lớn (thẻ KPI nổi bật, đầu trang đăng nhập), giống nhau ở 2 chế độ |
| `--color-on-brand` | `#FFFFFF` | `#FFFFFF` | Chữ trên khối brand |
| `--color-accent` | `#E56DAF` | `#F07DBA` | Hồng trang trí: chấm, vạch, viền huy hiệu. **Không dùng cho chữ** |
| `--color-accent-text` | `#B0256E` | `#F28CC4` | Chữ màu hồng (nhãn "Mới", số cần chú ý) |
| `--color-success` | `#137035` | `#4ADE80` | Hoàn thành |
| `--color-warning` | `#A34A06` | `#FBBF24` | Sắp đến hạn, task bị chặn |
| `--color-danger` | `#C0262D` | `#F87171` | Lỗi, trễ hạn, xóa |
| `--color-border` | `#E3E7EF` | `#232A45` | Đường kẻ trang trí, viền thẻ |
| `--color-border-strong` | `#6B7385` | `#7D87A6` | Viền ô nhập, nút phụ (điều khiển) |
| `--color-blueprint` | `rgb(32 84 240 / 0.10)` | `rgb(123 151 255 / 0.10)` | Nét lưới bản vẽ (trang trí) |

**Tương phản đã tính:**
| Cặp | Sáng | Tối | Yêu cầu |
|---|---|---|---|
| `text` / `bg` | 19,07 | 16,86 | 4,5 |
| `text-muted` / `bg` | 7,93 | 7,94 | 4,5 |
| `text-muted` / `bg-muted` | 7,08 | 6,65 | 4,5 |
| `primary` / `bg` | 5,85 | 7,44 | 4,5 |
| `primary` / `bg-subtle` | 5,51 | 6,94 | 4,5 |
| `primary` / `bg-muted` | 5,23 | 6,23 | 4,5 |
| `on-primary` / `primary` | 5,85 | 7,44 | 4,5 |
| `on-primary` / `primary-hover` | 8,06 | 9,88 | 4,5 |
| `on-brand` / `brand` | 5,85 | 5,85 | 4,5 |
| `accent-text` / `bg` | 6,30 | 8,99 | 4,5 |
| `success` / `bg` (thấp nhất: trên `bg-muted`) | 6,18 (5,52) | 11,62 (9,73) | 4,5 |
| `warning` / `bg` (thấp nhất: trên `bg-muted`) | 5,93 (5,30) | 12,13 (10,16) | 4,5 |
| `danger` / `bg` (thấp nhất: trên `bg-muted`) | 5,90 (5,27) | 7,32 (6,13) | 4,5 |
| `border-strong` / `bg` | 4,76 | 5,68 | 3 (điều khiển) |
| `text` / `canvas` | 13,63 | 17,16 | 4,5 |
| `accent` / `bg` | **2,94** | 8,05 | Chỉ trang trí |
| `accent` / `brand` | **1,99** | 2,33 | Chỉ trang trí |

Quy tắc rút ra:
- `--color-accent` (hồng) ở chế độ sáng **không đạt 3:1**, nên chỉ làm chấm và vạch trang trí, luôn đi kèm chữ hoặc biểu tượng. Chữ hồng dùng `--color-accent-text`.
- Trên khối `--color-brand` chỉ đặt chữ trắng (`--color-on-brand`); xanh nhạt `#CDDBF2` trên brand chỉ đạt 4,18, nên chỉ dùng cho chữ lớn từ 24px.
- Không dùng màu làm tín hiệu duy nhất (ưu tiên, trạng thái luôn có biểu tượng hoặc chữ).

**Màu biểu đồ** (theo thứ tự chuỗi): `primary`, `accent`, `#8A93A6` (xám), `#9DB2FF` (xanh nhạt). Mọi chuỗi có chú giải ô vuông kèm chữ; trên biểu đồ đường, mỗi chuỗi có ký hiệu điểm khác nhau.

## 2. Chữ
Cả 3 phông đã kiểm tra có bộ ký tự `vietnamese` trong dữ liệu `next/font` (Next 16.4.6). Tải qua `next/font/google`, dự phòng `system-ui, sans-serif` và `ui-monospace, monospace`.

| Biến phông | Phông | Dùng cho |
|---|---|---|
| `--font-sans` | Inter | Nội dung, bảng, form (mặc định) |
| `--font-display` | Inter Tight | Tiêu đề trang, số KPI lớn |
| `--font-mono` | JetBrains Mono | Nhãn in hoa, mã task, ngày, số trong bảng |

| Token | Phông | Cỡ / dòng | Đậm | Giãn chữ | Dùng cho |
|---|---|---|---|---|---|
| `label` | mono | 11 / 16 | 500 | +0,08em, in hoa | Nhãn nhóm `● TIẾN ĐỘ`, tiêu đề cột `01 / CẦN LÀM` |
| `code` | mono | 12 / 16 | 400 | 0 | Mã task `QLDA-128`, ngày, giá trị thông số |
| `text-xs` | sans | 12 / 16 | 500 | 0 | Thời gian, chú thích |
| `text-sm` | sans | 14 / 20 | 400, 500 | 0 | Nội dung, bảng (mặc định) |
| `text-base` | sans | 16 / 24 | 400 | 0 | Mô tả task, ô nhập trên điện thoại |
| `text-lg` | sans | 18 / 28 | 600 | 0 | Tiêu đề phần |
| `display-sm` | display | 28 / 32 | 400 | -0,02em | Tiêu đề trang |
| `display-lg` | display | 44 / 48 | 300 | -0,03em | Số KPI, tiêu đề đăng nhập |

- Tiêu đề lớn (`display-lg`, tiêu đề trang tổng quan) có thể kết thúc bằng dấu chấm màu `--color-accent`, bọc trong `<span aria-hidden="true">` để trình đọc màn hình không đọc thừa.
- Nhãn in hoa dùng `text-transform: uppercase` trên chuỗi gốc (không gõ sẵn chữ hoa trong file ngôn ngữ).
- Chữ phải thu phóng được đến 200% mà không mất nội dung.

## 3. Khoảng cách, bo góc, đường kẻ, bóng
- Đơn vị cơ sở 4px: `space-1`=4, `2`=8, `3`=12, `4`=16, `6`=24, `8`=32, `12`=48.
- Bo góc: `radius-sm`=4 (nhãn, ô check), `radius-md`=6 (nút, ô nhập), `radius-lg`=10 (thẻ, hộp thoại), `radius-xl`=20 (khung ứng dụng, khối brand), `radius-pill`=999 (huy hiệu).
- Đường kẻ: 1px `--color-border` cho thẻ và hàng; thanh tiến độ cao 4px; nét lưới bản vẽ 1px, ô lưới 24px.
- Bóng: `shadow-pop` = `0 8px 24px rgb(10 15 31 / 0.12)`, chỉ cho menu nổi, hộp thoại, thẻ đang kéo.
- Khung ứng dụng (từ 1280px): nền `--color-canvas`, khung trong `--color-bg` bo `radius-xl`, cách mép 12px. Dưới 1280px khung tràn hết màn, không bo.

## 4. Thành phần và trạng thái
| Thành phần | Biến thể | Trạng thái bắt buộc | Ghi chú Blueprint |
|---|---|---|---|
| Button | chính, phụ (viền), nguy hiểm, văn bản | mặc định, hover, focus, active, disabled, đang tải | Nút điều hướng có "→" phía sau |
| Input, Textarea, Select | thường, lỗi | mặc định, focus, lỗi (kèm thông báo), disabled | Ô tìm kiếm có biểu tượng trong ô vuông viền |
| Checkbox, Switch | | chọn, chưa chọn, focus, disabled | |
| Badge nhãn, Badge trạng thái, Badge ưu tiên | pill, màu theo token kèm biểu tượng | | Huy hiệu "Mới" viền hồng, chữ `accent-text` |
| Section label | | | Phông mono in hoa, chấm hồng phía trước, có thể kèm số `01 /` |
| Stat (ô KPI) | thường, brand | | Số `display-lg` kèm chú thích `label` và thanh tiến độ tùy chọn |
| Progress bar | xanh, hồng, xám | | Cao 4px, nền `bg-muted`, vạch kế hoạch 1px, có `aria-valuenow` |
| Spec row (hàng thuộc tính) | | chỉ đọc, sửa được | Khóa mono in hoa bên trái, giá trị bên phải, kẻ mảnh |
| Avatar, Avatar nhóm | | có ảnh, chữ cái đầu | |
| Thẻ task (Kanban) | thu gọn | mặc định, hover, đang kéo, bị chặn (biểu tượng cảnh báo), trễ hạn | Mã task mono ở dòng đầu |
| Hàng task (danh sách) | | mặc định, chọn, hover, bị chặn, trễ hạn | |
| Cột Kanban | | thường, đang kéo thả vào, rỗng | Tiêu đề `01 / CẦN LÀM` kèm số lượng |
| Ngăn chi tiết task (drawer) | | đang tải, lỗi, chỉ đọc (Người xem) | Thuộc tính dùng Spec row |
| Hộp thoại xác nhận | | dùng cho xóa vĩnh viễn (BR-11) | |
| Toast | thành công, lỗi, cảnh báo | tự đóng, đóng được bằng bàn phím | |
| Tab, Điều hướng thanh bên | | đang chọn, focus | Mục đang chọn: nền `bg-muted`, vạch trái 2px `primary` |
| Trạng thái rỗng, Skeleton, Màn lỗi | | bắt buộc cho mọi danh sách | Trạng thái rỗng dùng lưới bản vẽ và tiêu đề có chấm hồng |

Biểu tượng: bộ Lucide nét 1,5px, cỡ 16px trong bảng, 20px ở điều hướng **[CẦN XÁC NHẬN cùng ADR-005]**.

## 5. Trợ năng
- Vòng focus 2px màu `--color-primary`, cách 2px, luôn thấy khi dùng bàn phím.
- Vùng bấm tối thiểu 44 × 44px trên điện thoại (NFR-10, từ 360px).
- Kanban kéo thả có cách thay thế bằng bàn phím và menu "Chuyển đến cột".
- Tôn trọng `prefers-reduced-motion` và `prefers-color-scheme`; người dùng đổi chế độ bằng tay và được nhớ (thuộc tính `data-theme` trên `<html>`).
- Mọi biểu tượng có nhãn chữ hoặc `aria-label`; thông báo toast dùng `role="status"`; chấm hồng và lưới bản vẽ đặt `aria-hidden="true"`.
- Axe tự động trong E2E (xem [test-strategy.md](test-strategy.md)).

## 6. Đặt tên và triển khai
- Token là biến CSS `--color-*`, `--font-*`, `--space-*`, `--radius-*`, `--shadow-*`, khai báo trong [app/globals.css](../../app/globals.css); phông nạp trong [app/layout.tsx](../../app/layout.tsx).
- Component PascalCase, file kebab-case (`task-card.tsx`).
- Chuỗi giao diện chỉ qua file ngôn ngữ vi, en (NFR-11), không gõ cứng trong component.
- Thư viện UI: đề xuất Tailwind CSS cùng bộ thành phần nền tảng trợ năng (kiểu shadcn/ui, Radix), ánh xạ token ở trên vào theme Tailwind. **[CẦN XÁC NHẬN]** chốt bằng ADR-005 trước khi code giao diện.
- Mockup tham chiếu: 19 màn `bp-*.dc.html` trong [mockups/v3](ui-ux/mockups/v3/) (cùng nội dung với canvas UI/UX) và trang style guide [blueprint-preview.html](ui-ux/mockups/v3/blueprint-preview.html).
