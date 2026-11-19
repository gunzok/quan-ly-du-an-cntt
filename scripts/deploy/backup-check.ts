/**
 * Kiểm tra bản sao lưu Supabase còn mới trước khi chạy migration production (Story E0-10,
 * NFR-05; docs/05-ops/migration-va-sao-luu.md). Đọc JSON danh sách bản sao lưu từ stdin, ví dụ:
 *
 *   supabase backups list --remote="$SUPABASE_PROJECT_REF" -o json \
 *     | node scripts/deploy/backup-check.ts --max-age-hours 26
 *
 * Đạt khi dự án bật PITR, hoặc có bản sao lưu trạng thái COMPLETED trong N giờ gần nhất
 * (mặc định 26: lịch sao lưu hằng ngày của gói Pro + 2 giờ dư). Gói Free không có bản sao lưu tự
 * động nên kiểm tra này ĐỎ; khi đó dùng BACKUP_STRATEGY=manual (sao lưu tay bằng
 * scripts/deploy/backup.sh trước khi duyệt).
 *
 * CHƯA KIỂM CHỨNG với dự án thật (chưa có tài khoản): định dạng JSON lấy theo Management API
 * `GET /v1/projects/{ref}/database/backups` ({ pitr_enabled, backups: [{ status, inserted_at }] });
 * bộ đọc chấp nhận vài biến thể tên trường và báo rõ khi không hiểu, không đoán bừa là đạt.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface BackupVerdict {
  ok: boolean;
  message: string;
}

interface RawBackup {
  status?: unknown;
  inserted_at?: unknown;
  created_at?: unknown;
  completed_at?: unknown;
}

function backupTime(b: RawBackup): number | null {
  for (const v of [b.completed_at, b.inserted_at, b.created_at]) {
    if (typeof v === "string") {
      const t = Date.parse(v);
      if (Number.isFinite(t)) return t;
    }
  }
  return null;
}

export function evaluateBackups(
  json: string,
  options: { now: number; maxAgeHours: number },
): BackupVerdict {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return {
      ok: false,
      message:
        "Không đọc được JSON danh sách bản sao lưu (thiếu SUPABASE_ACCESS_TOKEN hoặc sai SUPABASE_PROJECT_REF?).",
    };
  }
  const obj = (data && typeof data === "object" ? data : {}) as {
    pitr_enabled?: unknown;
    backups?: unknown;
  };
  if (obj.pitr_enabled === true) {
    return { ok: true, message: "Dự án bật PITR (khôi phục theo thời điểm)." };
  }
  const list = Array.isArray(data)
    ? data
    : Array.isArray(obj.backups)
      ? obj.backups
      : null;
  if (!list) {
    return {
      ok: false,
      message:
        "JSON không có danh sách backups. Kiểm tra định dạng `supabase backups list -o json`.",
    };
  }
  const completed = (list as RawBackup[])
    .filter(
      (b) =>
        b &&
        typeof b === "object" &&
        String(b.status ?? "").toUpperCase() === "COMPLETED",
    )
    .map(backupTime)
    .filter((t): t is number => t !== null);
  if (completed.length === 0) {
    return {
      ok: false,
      message:
        "Không có bản sao lưu hoàn tất nào (gói Free không có sao lưu tự động: dùng BACKUP_STRATEGY=manual và sao lưu tay).",
    };
  }
  const latest = Math.max(...completed);
  const ageHours = (options.now - latest) / 3_600_000;
  const when = new Date(latest).toISOString();
  return ageHours <= options.maxAgeHours
    ? {
        ok: true,
        message: `Bản sao lưu mới nhất ${when} (${ageHours.toFixed(1)} giờ trước).`,
      }
    : {
        ok: false,
        message: `Bản sao lưu mới nhất ${when} đã ${ageHours.toFixed(1)} giờ, vượt ${options.maxAgeHours} giờ. Sao lưu tay trước khi migrate.`,
      };
}

function main(): void {
  const args = process.argv.slice(2);
  const i = args.indexOf("--max-age-hours");
  const maxAgeHours = i >= 0 ? Number(args[i + 1]) : 26;
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error("--max-age-hours phải là số dương.");
  }
  const verdict = evaluateBackups(readFileSync(0, "utf8"), {
    now: Date.now(),
    maxAgeHours,
  });
  const prefix = process.env.GITHUB_ACTIONS
    ? verdict.ok
      ? "::notice::"
      : "::error::"
    : verdict.ok
      ? "ĐẠT: "
      : "LỖI: ";
  console.log(`${prefix}${verdict.message}`);
  if (!verdict.ok) process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
