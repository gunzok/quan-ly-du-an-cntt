import type { ReportTemplateDeps } from "@/lib/report-templates/handlers";
import { createClient } from "@/lib/supabase/server";

/** Chỉ client phiên (cookie người gọi): RLS report_templates và storage.objects là lớp chặn thứ hai. */
export async function reportTemplateDeps(): Promise<ReportTemplateDeps> {
  return { session: await createClient() };
}
