/**
 * Chuỗi tiếng Việt cho mã PHÍA MÁY CHỦ không gắn với giao diện: thông điệp lỗi API (`message`
 * luôn tiếng Việt cho khách API, kèm `message_key` để giao diện dịch), Server Action, proxy.
 *
 * Giao diện KHÔNG import file này (ESLint chặn trong app/ và components/): Server Component dùng
 * getStrings() (lib/i18n/server.ts), Client Component dùng useStrings() (lib/i18n/client.tsx).
 * Thêm chuỗi mới vào lib/i18n/messages/vi.ts và en.ts (Story E10-2).
 */
export { vi as strings } from "@/lib/i18n/messages/vi";
