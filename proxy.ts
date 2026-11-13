import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Next.js 16: "Middleware" đổi tên thành "Proxy" (file proxy.ts ở gốc dự án).
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Bỏ qua tài nguyên tĩnh và ảnh; mọi đường dẫn khác đi qua kiểm tra phiên.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
