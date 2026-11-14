import type { AdminDeps } from "@/lib/admin/users/handlers";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Client phiên (cookie người gọi) + client service_role tạo lười, chỉ sau khi xác minh Admin. */
export async function adminDeps(): Promise<AdminDeps> {
  return { session: await createClient(), service: createServiceRoleClient };
}
