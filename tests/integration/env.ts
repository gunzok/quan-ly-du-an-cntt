/** Biến cần để chạy test tích hợp với Supabase cục bộ (make test-integration tự đặt). */
export const INTEGRATION_ENV = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export function missingIntegrationEnv(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return INTEGRATION_ENV.filter((name) => !env[name]);
}
