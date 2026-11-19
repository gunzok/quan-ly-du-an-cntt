import { getLocale } from "@/lib/i18n/server";
import { handleSampleTemplate } from "@/lib/reports/handlers";
import { createClient } from "@/lib/supabase/server";

/** GET /api/v1/report-templates/sample?format=xlsx — Admin, PM: tải template mẫu (Story E5-3). */
export async function GET(request: Request) {
  const [session, locale] = await Promise.all([createClient(), getLocale()]);
  return handleSampleTemplate(request, { session, locale });
}
