import type { ApiErrorDetail } from "@/lib/api/errors";

/** Giới hạn độ dài theo RFC 5321 (email) và giới hạn hợp lý cho mật khẩu. */
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MAX_LENGTH = 256;

// Kiểm tra hình thức cơ bản: một @, phần tên miền có dấu chấm, không khoảng trắng.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LoginInput {
  email: string;
  password: string;
}

export type LoginValidation =
  { ok: true; data: LoginInput } | { ok: false; details: ApiErrorDetail[] };

/** Đọc dữ liệu thô từ FormData (hoặc nguồn tương tự). Giá trị không phải chuỗi coi như rỗng. */
export function readLoginForm(form: Pick<FormData, "get">): {
  email: unknown;
  password: unknown;
} {
  return { email: form.get("email"), password: form.get("password") };
}

/**
 * Schema phía máy chủ cho form đăng nhập. Không tin dữ liệu từ giao diện.
 * Email được cắt khoảng trắng và đưa về chữ thường; mật khẩu giữ nguyên.
 */
export function validateLoginInput(raw: {
  email: unknown;
  password: unknown;
}): LoginValidation {
  const details: ApiErrorDetail[] = [];

  const email =
    typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  if (email === "") {
    details.push({ field: "email", issue: "required" });
  } else if (email.length > EMAIL_MAX_LENGTH) {
    details.push({ field: "email", issue: "too_long" });
  } else if (!EMAIL_PATTERN.test(email)) {
    details.push({ field: "email", issue: "invalid_format" });
  }

  const password = typeof raw.password === "string" ? raw.password : "";
  if (password === "") {
    details.push({ field: "password", issue: "required" });
  } else if (password.length > PASSWORD_MAX_LENGTH) {
    details.push({ field: "password", issue: "too_long" });
  }

  if (details.length > 0) {
    return { ok: false, details };
  }
  return { ok: true, data: { email, password } };
}
