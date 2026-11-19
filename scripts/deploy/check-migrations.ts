/**
 * Kiểm tra quy tắc migration trước khi merge/triển khai (Story E0-2 và E0-10, database.md mục 6;
 * quy trình ở docs/05-ops/migration-va-sao-luu.md).
 *
 * So thư mục supabase/migrations giữa BASE (ví dụ origin/main) và HEAD:
 *   - ĐỎ khi sửa, xóa hoặc đổi tên migration đã có ở BASE (đã merge, có thể đã chạy trên
 *     staging/production; muốn đổi thì viết migration mới).
 *   - ĐỎ khi tên tệp sai dạng `<14 chữ số>_<tên_thường>.sql` hoặc trùng timestamp.
 *   - CẢNH BÁO (ĐỎ nếu --strict) khi migration mới có timestamp không lớn hơn migration mới nhất
 *     ở BASE: `supabase db push` lên staging/production sẽ từ chối ("insert before the last
 *     migration"). Cách sửa trước khi merge: đổi tên tệp sang timestamp mới hơn.
 *
 * Cách chạy:
 *   make check-migrations                       # BASE mặc định origin/main
 *   node scripts/deploy/check-migrations.ts <base> [head] [--strict]
 *
 * Chỉ đọc git, không chạm CSDL. Cú pháp TypeScript xóa được kiểu để Node chạy trực tiếp.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MIGRATIONS_DIR = "supabase/migrations";
export const MIGRATION_NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;

export interface ChangedFile {
  /** Chữ cái trạng thái của `git diff --name-status` (A, M, D, R, C, T). */
  status: string;
  path: string;
  /** Đường dẫn cũ khi đổi tên/sao chép. */
  from?: string;
}

export interface MigrationReport {
  errors: string[];
  warnings: string[];
  added: string[];
}

const baseName = (path: string) => path.split("/").pop() ?? path;

/** Phân tích đầu ra `git diff --name-status -z` (trường cách nhau bởi NUL). */
export function parseNameStatus(output: string): ChangedFile[] {
  const fields = output.split("\0").filter((f) => f.length > 0);
  const files: ChangedFile[] = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++];
    const letter = status[0];
    if (letter === "R" || letter === "C") {
      const from = fields[i++];
      const path = fields[i++];
      files.push({ status: letter, path, from });
    } else {
      files.push({ status: letter, path: fields[i++] });
    }
  }
  return files;
}

export function checkMigrations(input: {
  baseFiles: string[];
  headFiles: string[];
  changes: ChangedFile[];
  strict?: boolean;
}): MigrationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const inDir = (p: string | undefined) =>
    Boolean(p && p.startsWith(`${MIGRATIONS_DIR}/`));

  for (const change of input.changes) {
    if (!inDir(change.path) && !inDir(change.from)) continue;
    if (change.status === "A") continue;
    const name = baseName(change.from ?? change.path);
    const verb =
      change.status === "D"
        ? "xóa"
        : change.status === "R"
          ? "đổi tên"
          : change.status === "C"
            ? null
            : "sửa";
    if (verb && (change.status !== "R" || inDir(change.from))) {
      errors.push(
        `Không được ${verb} migration đã merge: ${name}. Viết migration MỚI để thay đổi lược đồ.`,
      );
    }
  }

  const baseSet = new Set(input.baseFiles.map(baseName));
  const added = input.headFiles.map(baseName).filter((n) => !baseSet.has(n));
  const seen = new Map<string, string>();
  for (const name of input.headFiles.map(baseName)) {
    const match = MIGRATION_NAME.exec(name);
    if (!match) {
      if (!baseSet.has(name)) {
        errors.push(
          `Tên migration sai dạng: ${name} (cần <YYYYMMDDHHMMSS>_<ten_khong_dau>.sql).`,
        );
      }
      continue;
    }
    const other = seen.get(match[1]);
    if (other) {
      errors.push(`Trùng timestamp ${match[1]}: ${other} và ${name}.`);
    }
    seen.set(match[1], name);
  }

  const latestBase = input.baseFiles
    .map(baseName)
    .map((n) => MIGRATION_NAME.exec(n)?.[1])
    .filter((t): t is string => Boolean(t))
    .sort()
    .pop();
  if (latestBase) {
    for (const name of added) {
      const ts = MIGRATION_NAME.exec(name)?.[1];
      if (ts && ts <= latestBase) {
        const message = `Migration mới ${name} có timestamp ${ts} không lớn hơn migration mới nhất đã merge (${latestBase}). \`supabase db push\` lên staging/production sẽ từ chối; đổi tên tệp sang timestamp lớn hơn ${latestBase} trước khi merge.`;
        (input.strict ? errors : warnings).push(message);
      }
    }
  }
  return { errors, warnings, added };
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function listMigrations(ref: string): string[] {
  return git(["ls-tree", "--name-only", `${ref}`, `${MIGRATIONS_DIR}/`])
    .split("\n")
    .filter(Boolean);
}

function main(): void {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const [base = "origin/main", head = "HEAD"] = args.filter(
    (a) => !a.startsWith("--"),
  );
  let mergeBase: string;
  try {
    mergeBase = git(["merge-base", base, head]).trim();
  } catch {
    throw new Error(
      `Không tìm được điểm chung giữa ${base} và ${head}. Chạy \`git fetch origin main\` (CI: fetch-depth đủ sâu) rồi thử lại.`,
    );
  }
  const changes = parseNameStatus(
    git([
      "diff",
      "--name-status",
      "-z",
      "-M",
      mergeBase,
      head,
      "--",
      MIGRATIONS_DIR,
    ]),
  );
  const report = checkMigrations({
    baseFiles: listMigrations(base),
    headFiles: listMigrations(head),
    changes,
    strict,
  });
  const gha = Boolean(process.env.GITHUB_ACTIONS);
  for (const w of report.warnings) {
    console.log(gha ? `::warning::${w}` : `CẢNH BÁO: ${w}`);
  }
  for (const e of report.errors) {
    console.log(gha ? `::error::${e}` : `LỖI: ${e}`);
  }
  const summary = report.added.length
    ? `Migration mới so với ${base}: ${report.added.join(", ")}`
    : `Không có migration mới so với ${base}.`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Kiểm tra migration\n\n${summary}\n\n${[...report.errors, ...report.warnings].map((m) => `- ${m}`).join("\n")}\n`,
    );
  }
  if (report.errors.length) process.exit(1);
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
