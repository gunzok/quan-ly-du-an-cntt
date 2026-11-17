/**
 * Một lời thông báo cho trình đọc màn hình. `id` tăng mỗi lần có lời mới để nút chữ được THAY
 * (key mới), nhờ vậy hai lời giống hệt nhau liên tiếp ("Bạn có 1 thông báo mới.") vẫn được đọc
 * lại: vùng live chỉ đọc khi nội dung bên trong đổi.
 */
export interface Announcement {
  id: number;
  text: string;
}

/**
 * Vùng aria-live (polite). Vùng phải có sẵn trong DOM TRƯỚC khi chữ được chèn vào (trình đọc màn
 * hình bỏ qua vùng live mới tạo kèm sẵn nội dung), nên luôn render, chỉ thay phần chữ bên trong.
 */
export function LiveAnnouncer({
  announcement,
  testId,
}: {
  announcement: Announcement | null;
  testId?: string;
}) {
  return (
    <span
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid={testId}
    >
      {announcement ? (
        <span key={announcement.id}>{announcement.text}</span>
      ) : null}
    </span>
  );
}
