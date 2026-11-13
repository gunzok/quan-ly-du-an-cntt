/**
 * Biến môi trường công khai của Supabase.
 *
 * NEXT_PUBLIC_SUPABASE_ANON_KEY: Supabase CLI/Dashboard mới gọi là "publishable key"
 * (sb_publishable_...). Dự án giữ tên biến cũ; cả khóa anon (JWT) lẫn publishable đều dùng được.
 * TUYỆT ĐỐI không đặt khóa service_role/secret vào biến này: nó được đưa ra trình duyệt.
 */
export interface SupabasePublicEnv {
  url: string;
  anonKey: string;
}

/** Nhận diện khóa có quyền service_role (khóa secret mới hoặc JWT role=service_role). */
export function isServiceRoleKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) {
    return true;
  }
  const parts = key.split(".");
  if (parts.length !== 3) {
    return false;
  }
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const payload = JSON.parse(json) as { role?: unknown };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

export function resolveSupabasePublicEnv(
  url: string | undefined,
  anonKey: string | undefined,
): SupabasePublicEnv {
  if (!url || !anonKey) {
    throw new Error(
      'Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY. Xem .env.example và README mục "Chạy ứng dụng cục bộ".',
    );
  }
  if (isServiceRoleKey(anonKey)) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY đang chứa khóa service_role/secret. Chỉ dùng khóa anon/publishable.",
    );
  }
  return { url, anonKey };
}

export function getSupabasePublicEnv(): SupabasePublicEnv {
  // Tham chiếu trực tiếp để Next.js nhúng giá trị NEXT_PUBLIC_* khi build mã trình duyệt.
  return resolveSupabasePublicEnv(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
