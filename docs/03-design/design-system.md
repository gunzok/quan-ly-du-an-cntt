# Design system

Ngày: 2026-11-13 · Pha 3 · Trạng thái: Chờ duyệt (phần 4: design system + chiến lược test)
Quyết định của sếp: phong cách tối giản, gọn, nhiều thông tin (kiểu Linear); bảng màu A Xanh dương; chế độ sáng và tối theo hệ thống; phông Inter. Tỷ lệ tương phản bên dưới tính bằng code theo công thức WCAG 2.1 (chữ thường cần từ 4,5:1, thành phần giao diện và viền điều khiển từ 3:1).

## 1. Màu (token)
Đặt tên: `--color-<vai-trò>`; giá trị đổi theo chế độ sáng, tối.

| Token | Sáng | Tối | Dùng cho |
|---|---|---|---|
| `--color-bg` | `#FFFFFF` | `#0B1220` | Nền trang |
| `--color-bg-subtle` | `#F8FAFC` | `#111A2E` | Thanh bên, cột Kanban |
| `--color-bg-muted` | `#F1F5F9` | `#182238` | Hover, nền nhóm |
| `--color-text` | `#0F172A` | `#E5E7EB` | Chữ chính |
| `--color-text-muted` | `#475569` | `#9CA3AF` | Chữ phụ, nhãn |
| `--color-primary` | `#1D4ED8` | `#60A5FA` | Nút chính, liên kết, tiêu điểm |
| `--color-on-primary` | `#FFFFFF` | `#0B1220` | Chữ trên nút chính |
| `--color-accent` | `#0EA5E9` | `#38BDF8` | Điểm nhấn trang trí (không dùng cho chữ) |
| `--color-success` | `#15803D` | `#4ADE80` | Hoàn thành, thành công |
| `--color-warning` | `#B45309` | `#FBBF24` | Cảnh báo, sắp đến hạn, task bị chặn |
| `--color-danger` | `#B91C1C` | `#F87171` | Lỗi, trễ hạn, xóa |
| `--color-border` | `#E2E8F0` | `#243049` | Đường kẻ trang trí |
| `--color-border-strong` | `#64748B` | `#7C8AA5` | Viền ô nhập, nút phụ (điều khiển) |

**Tương phản đã tính** (chữ thường cần ≥ 4,5:1):
| Cặp | Sáng | Tối |
|---|---|---|
| `text` / `bg` | 17,85 | 15,12 |
| `text-muted` / `bg` | 7,58 | 7,37 |
| `text-muted` / `bg-muted` | 6,92 | 6,24 |
| `primary` / `bg` | 6,70 | 7,36 |
| `on-primary` / `primary` | 6,70 | 7,36 |
| `success` / `bg` | 5,02 | 10,74 |
| `warning` / `bg` | 5,02 | 11,22 |
| `danger` / `bg` | 6,47 | 6,77 |
| `success` / `bg-muted` (thấp nhất) | 4,58 | 9,10 |
| `border-strong` / `bg` (điều khiển, cần ≥ 3) | 4,76 | 5,38 |

`--color-border` cố ý nhạt vì chỉ là đường kẻ trang trí; không dùng làm viền duy nhất cho ô nhập. Đường viền của điều khiển dùng `--color-border-strong`.

Nguyên tắc: không dùng màu làm tín hiệu duy nhất (mức ưu tiên, trạng thái luôn đi kèm biểu tượng hoặc chữ).

## 2. Chữ
Phông Inter (có dấu tiếng Việt), tải qua `next/font`, dự phòng `system-ui, sans-serif`.
| Token | Cỡ / dòng | Đậm | Dùng cho |
|---|---|---|---|
| `text-xs` | 12 / 16 | 500 | Nhãn, thời gian |
| `text-sm` | 14 / 20 | 400, 500 | Nội dung, bảng (mặc định, mật độ cao) |
| `text-base` | 16 / 24 | 400 | Mô tả task, ô nhập trên điện thoại |
| `text-lg` | 18 / 28 | 600 | Tiêu đề phần |
| `text-xl` | 24 / 32 | 600 | Tiêu đề trang |
Chữ phải thu phóng được đến 200% mà không mất nội dung.

## 3. Khoảng cách, bo góc, bóng
- Đơn vị cơ sở 4 px: `space-1`=4, `2`=8, `3`=12, `4`=16, `6`=24, `8`=32.
- Bo góc: `radius-sm`=4 (nhãn), `radius-md`=6 (nút, ô nhập), `radius-lg`=8 (thẻ, hộp thoại).
- Bóng rất nhẹ (chỉ cho menu, hộp thoại); danh sách và thẻ dùng viền thay bóng (phong cách gọn).

## 4. Thành phần và trạng thái
| Thành phần | Biến thể | Trạng thái bắt buộc |
|---|---|---|
| Button | chính, phụ, nguy hiểm, văn bản | mặc định, hover, focus, active, disabled, đang tải |
| Input, Textarea, Select | thường, lỗi | mặc định, focus, lỗi (kèm thông báo), disabled |
| Checkbox, Switch | | chọn, chưa chọn, focus, disabled |
| Badge nhãn, Badge trạng thái, Badge ưu tiên | màu theo token + biểu tượng | |
| Avatar, Avatar nhóm | | có ảnh, chữ cái đầu |
| Thẻ task (Kanban) | thu gọn | mặc định, hover, đang kéo, bị chặn (biểu tượng cảnh báo), trễ hạn |
| Hàng task (danh sách) | | mặc định, chọn, hover, bị chặn, trễ hạn |
| Cột Kanban | | thường, đang kéo thả vào, rỗng |
| Ngăn chi tiết task (drawer) | | đang tải, lỗi, chỉ đọc (Người xem) |
| Hộp thoại xác nhận | | dùng cho xóa vĩnh viễn (BR-11) |
| Toast | thành công, lỗi, cảnh báo | tự đóng, đóng được bằng bàn phím |
| Tab, Điều hướng thanh bên | | đang chọn, focus |
| Trạng thái rỗng, Skeleton, Màn lỗi | | bắt buộc cho mọi danh sách |

## 5. Trợ năng
- Vòng focus 2 px màu `--color-primary`, cách 2 px, luôn thấy khi dùng bàn phím.
- Vùng bấm tối thiểu 44 × 44 px trên điện thoại (NFR-10, từ 360 px).
- Kanban kéo thả có cách thay thế bằng bàn phím và menu "Chuyển đến cột".
- Tôn trọng `prefers-reduced-motion` và `prefers-color-scheme`; người dùng đổi chế độ bằng tay và được nhớ.
- Mọi biểu tượng có nhãn chữ hoặc `aria-label`; thông báo toast dùng `role="status"`.
- Axe tự động trong E2E (xem [test-strategy.md](test-strategy.md)).

## 6. Đặt tên và triển khai
- Token là biến CSS `--color-*`, `--space-*`, `--radius-*`; component PascalCase, file kebab-case (`task-card.tsx`).
- Chuỗi giao diện chỉ qua file ngôn ngữ vi, en (NFR-11), không gõ cứng trong component.
- Thư viện UI: đề xuất Tailwind CSS cùng bộ thành phần nền tảng trợ năng (kiểu shadcn/ui, Radix). **[CẦN XÁC NHẬN]** chốt bằng ADR-005 trước khi code giao diện.
