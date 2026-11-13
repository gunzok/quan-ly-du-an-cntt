import { missingIntegrationEnv } from "./env";

/**
 * Chạy một lần ở tiến trình chính của Vitest: báo rõ khi test tích hợp bị bỏ qua
 * (log trong file test bị bỏ qua toàn bộ không được Vitest in ra).
 */
export default function setup() {
  const missing = missingIntegrationEnv();
  if (missing.length > 0) {
    console.warn(
      `\n[test tích hợp] BỎ QUA tests/integration/*: thiếu ${missing.join(", ")} ` +
        '(không có Supabase cục bộ). Xem số test "skipped" ở dòng tổng kết. ' +
        "Chạy cục bộ: make db-start && make test-integration\n",
    );
  }
}
