"use client";

import { useEffect, useRef } from "react";

/**
 * Mở/đóng <dialog> gốc theo prop `open` bằng showModal(): trình duyệt tự giữ focus trong hộp
 * thoại, Esc đóng (sự kiện cancel), và trả focus về nút đã mở khi đóng.
 */
export function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);
  return ref;
}
