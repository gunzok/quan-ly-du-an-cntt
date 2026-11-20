import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireSharedLock, withSharedLock } from "./shared-lock";

// Dùng tên khóa thật nhưng chỉ khi không có test tích hợp nào đang giữ: test này chạy trong
// `make test` (không cần stack) nên bình thường không ai giữ.
const NAME = "report-templates" as const;
const dir = join(tmpdir(), `qlda-test-lock-${NAME}`);

describe("khóa liên tiến trình cho test (tests/support/shared-lock.ts)", () => {
  it("hai lượt cùng lúc chạy nối tiếp, không chồng nhau", async () => {
    const events: string[] = [];
    const job = (id: string) =>
      withSharedLock(NAME, async () => {
        events.push(`vào ${id}`);
        await new Promise((r) => setTimeout(r, 50));
        events.push(`ra ${id}`);
      });
    await Promise.all([job("a"), job("b")]);
    expect(events).toHaveLength(4);
    expect(events[1]).toBe(events[0].replace("vào", "ra"));
    expect(events[3]).toBe(events[2].replace("vào", "ra"));
  });

  it("nhả khóa kể cả khi hàm ném lỗi", async () => {
    await expect(
      withSharedLock(NAME, async () => {
        throw new Error("hỏng");
      }),
    ).rejects.toThrow("hỏng");
    const release = await acquireSharedLock(NAME, { timeoutMs: 2000 });
    await release();
  });

  it("khóa của tiến trình đã chết được giành lại", async () => {
    const release = await acquireSharedLock(NAME, { timeoutMs: 2000 });
    await release();
    await mkdir(dir);
    // pid không tồn tại (lớn hơn giới hạn pid của hệ điều hành thông dụng).
    await writeFile(join(dir, "owner"), "999999999 token-cu");
    const again = await acquireSharedLock(NAME, { timeoutMs: 2000 });
    await again();
    await rm(dir, { recursive: true, force: true });
  });
});
