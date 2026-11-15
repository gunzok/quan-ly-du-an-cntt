import type { DepartmentDeps } from "@/lib/departments/handlers";
import { createClient } from "@/lib/supabase/server";

/** Chỉ client phiên (cookie người gọi): RLS departments là lớp chặn thứ hai, không cần service_role. */
export async function departmentDeps(): Promise<DepartmentDeps> {
  return { session: await createClient() };
}
