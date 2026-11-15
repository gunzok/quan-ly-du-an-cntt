import { vi, type Messages } from "./messages/vi";

/**
 * Khóa thông điệp ổn định = đường dẫn trong từ điển vi, ví dụ "adminUsers.errors.emailExists".
 * API gắn khóa này vào lỗi (`message_key`) để giao diện dịch sang ngôn ngữ của người dùng; khách API
 * khác vẫn đọc `message` tiếng Việt như trước.
 */
let reverseIndex: Map<string, string> | null = null;

function buildIndex(): Map<string, string> {
  const index = new Map<string, string>();
  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") {
      // Chuỗi trùng ở nhiều khóa: giữ khóa gặp đầu tiên (messages.test.ts kiểm bản en cũng trùng).
      if (node !== "" && !index.has(node)) index.set(node, path);
      return;
    }
    if (node && typeof node === "object" && !Array.isArray(node)) {
      for (const [key, value] of Object.entries(node)) {
        walk(value, path ? `${path}.${key}` : key);
      }
    }
  };
  walk(vi, "");
  return index;
}

/** Khóa của một thông điệp tiếng Việt lấy từ từ điển; không có (chuỗi động, chuỗi lạ): undefined. */
export function messageKeyOf(viText: string): string | undefined {
  reverseIndex ??= buildIndex();
  return reverseIndex.get(viText);
}

/** Tra chuỗi theo khóa trong một từ điển; khóa không trỏ tới chuỗi: undefined. */
export function lookupMessage(
  messages: Messages,
  key: string | undefined,
): string | undefined {
  if (!key || key.length > 200) return undefined;
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(node, part)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}
