# ADR-005: Thư viện giao diện

- **Trạng thái**: Đã chấp nhận (2026-11-13)
- **Ngày**: 2026-11-13
- **Người quyết định**: Justin Tran (chủ dự án)

## Bối cảnh

Cần bộ thành phần giao diện khớp [design-system.md](../03-design/design-system.md) (token màu, trợ năng WCAG AA, chế độ sáng tối, vùng bấm 44 px) và mockup đã duyệt. Stack Next.js + TypeScript (ADR-001); một người làm cùng agent AI, nên ưu tiên thư viện phổ biến, ít phụ thuộc runtime và dễ tùy biến.

## Các phương án đã xét

| Phương án | Ưu điểm | Nhược điểm |
|---|---|---|
| A: Tailwind CSS + shadcn/ui (mã sao chép vào repo, nền Radix) | Sở hữu mã từng component, tùy biến theo token; Radix lo vai trò ARIA, focus, bàn phím; cộng đồng lớn, agent AI quen | Mã component nằm trong repo nên phải tự cập nhật; giấy phép Tailwind và Radix chưa xác minh từ kho chính thức trong đợt tra này |
| B: Thư viện trọn gói (Mantine, Chakra...) | Có sẵn nhiều thành phần | Khó khớp token và mockup đã duyệt; phụ thuộc runtime lớn |
| C: Tự viết CSS Modules và component | Kiểm soát hoàn toàn | Tốn công trợ năng (focus, ARIA), chậm với MVP 8 tuần |

## Quyết định (đề xuất)

Chọn **A: Tailwind CSS + shadcn/ui**. Token trong `design-system.md` map sang biến CSS `--color-*` và cấu hình Tailwind; kiểm tra tương phản bằng code vẫn là nguồn thật (không lấy màu mặc định của thư viện). Các thành phần nền trong Story E10-1.

Điều kiện đi kèm:
- Trước khi thêm, kiểm tra tệp LICENSE ở kho chính thức của Tailwind CSS, Radix UI, shadcn/ui (repo công khai).
- Phiên bản ghim trong `pnpm-lock.yaml`; Dependabot theo dõi.

## Hệ quả

- Dễ hơn: dựng nhanh màn đúng mockup, trợ năng nền tốt.
- Khó hơn hoặc rủi ro mới: lệ thuộc mô hình sao chép mã; nâng cấp Tailwind bản chính mới có thể cần sửa component.

## Điều kiện xem xét lại

- Kiểm tra giấy phép phát hiện điều kiện không phù hợp với repo công khai.
- Component nền không đạt kiểm tra axe hoặc tương phản đã duyệt.

## Nguồn tham khảo

- Các bài tổng hợp bên thứ ba, **chưa xác minh** từ kho chính thức: [DesignRevision](https://designrevision.com/compare/radix-ui-vs-shadcn), [PkgPulse](https://www.pkgpulse.com/guides/best-react-component-libraries-2026) — ngày tra 2026-11-13.
