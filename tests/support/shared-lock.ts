import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Khóa liên tiến trình cho test chạm TRẠNG THÁI TOÀN HỆ THỐNG trên CSDL cục bộ dùng chung (QLDA-56).
 *
 * Vì sao cần: vài thứ trong CSDL không chia theo dự án hay tài khoản tạm nên test chạy song song
 * (worker Vitest/Playwright, hoặc worktree khác dùng chung stack) giẫm lên nhau:
 * - "email-outbox": worker gửi email (`email_outbox_claim`) nhận MỌI dòng đang chờ, không lọc người
 *   nhận. Test A gọi worker thì gửi mất dòng mà test B đang chờ kiểm (B thấy `sent` thay vì `pending`).
 * - "report-templates": mỗi định dạng chỉ có MỘT template đang dùng cho cả hệ thống; test bật template
 *   của mình thì tắt template của test khác.
 *
 * Cách làm: `mkdir` là thao tác nguyên tử trên cùng máy nên thư mục `<tmpdir>/qlda-test-lock-<tên>`
 * đóng vai khóa. Chủ khóa ghi pid + token; tiến trình chủ đã chết, hoặc khóa giữ quá STALE_MS, thì
 * người sau được giành lại (không kẹt vĩnh viễn khi test bị Ctrl-C). Chỉ dùng trong test, không đụng
 * mã sản phẩm. CI mỗi job một máy nên khóa chỉ có tác dụng giữa các worker trong job.
 */
export type SharedLockName = "email-outbox" | "report-templates";

/** Giữ khóa lâu hơn mức này coi như bị bỏ rơi (test dài nhất giữ khóa vài chục giây). */
const STALE_MS = 10 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lockDir(name: SharedLockName): string {
  return join(tmpdir(), `qlda-test-lock-${name}`);
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: tiến trình còn sống nhưng của người dùng khác.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Khóa bị bỏ rơi: chủ đã chết, quá hạn, hoặc thư mục mồ côi (chủ chết trước khi kịp ghi tệp). */
async function isAbandoned(dir: string): Promise<boolean> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(dir);
  } catch {
    return false; // vừa được nhả: thử lại ngay
  }
  const age = Date.now() - info.mtimeMs;
  if (age > STALE_MS) return true;
  try {
    const [pid] = (await readFile(join(dir, "owner"), "utf8")).split(" ");
    return !processAlive(Number(pid));
  } catch {
    return age > 5000;
  }
}

/**
 * Chờ tới khi giữ được khóa, trả hàm nhả. Hàm nhả chỉ xóa khóa nếu vẫn là của mình (không xóa nhầm
 * khóa người khác đã giành sau khi mình bị coi là bỏ rơi).
 */
export async function acquireSharedLock(
  name: SharedLockName,
  { timeoutMs = 5 * 60 * 1000 }: { timeoutMs?: number } = {},
): Promise<() => Promise<void>> {
  const dir = lockDir(name);
  const token = randomUUID();
  const started = Date.now();
  for (;;) {
    try {
      await mkdir(dir);
      await writeFile(join(dir, "owner"), `${process.pid} ${token}`);
      return async () => {
        try {
          const owner = await readFile(join(dir, "owner"), "utf8");
          if (owner.endsWith(token)) await rm(dir, { recursive: true });
        } catch {
          // Đã bị giành hoặc đã xóa: không còn gì để nhả.
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (await isAbandoned(dir)) {
      await rm(dir, { recursive: true, force: true });
      continue;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `Chờ khóa test "${name}" quá ${timeoutMs} ms (thư mục ${dir}). Xóa thư mục nếu chắc không còn test nào chạy.`,
      );
    }
    await sleep(150 + Math.random() * 250);
  }
}

/** Chạy `fn` khi đang giữ khóa; luôn nhả kể cả khi `fn` ném lỗi. */
export async function withSharedLock<T>(
  name: SharedLockName,
  fn: () => Promise<T>,
): Promise<T> {
  const release = await acquireSharedLock(name);
  try {
    return await fn();
  } finally {
    await release();
  }
}
