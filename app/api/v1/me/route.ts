import { handlePatchMe } from "@/lib/me/handlers";
import { createClient } from "@/lib/supabase/server";

/** PATCH /api/v1/me { locale } — người đang đăng nhập đổi ngôn ngữ của mình (Story E10-2). */
export async function PATCH(request: Request) {
  return handlePatchMe(request, { session: await createClient() });
}
