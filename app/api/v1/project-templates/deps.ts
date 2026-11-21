import type { ProjectTemplateDeps } from "@/lib/project-templates/handlers";
import { createClient } from "@/lib/supabase/server";

/** Chỉ client phiên (cookie người gọi): RLS project_templates là lớp chặn thứ hai. */
export async function projectTemplateDeps(): Promise<ProjectTemplateDeps> {
  return { session: await createClient() };
}
