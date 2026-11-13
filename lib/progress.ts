/**
 * Tính phần trăm hoàn thành (0–100, làm tròn số nguyên) từ số việc đã xong và tổng số việc.
 * Tổng bằng 0 được coi là 0%. Ném lỗi khi đầu vào không hợp lệ.
 */
export function calcProgressPercent(done: number, total: number): number {
  if (!Number.isInteger(done) || !Number.isInteger(total)) {
    throw new RangeError("done và total phải là số nguyên");
  }
  if (done < 0 || total < 0) {
    throw new RangeError("done và total không được âm");
  }
  if (done > total) {
    throw new RangeError("done không được lớn hơn total");
  }
  if (total === 0) {
    return 0;
  }
  return Math.round((done / total) * 100);
}
