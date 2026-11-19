"use client";

import { useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useStrings } from "@/lib/i18n/client";

/**
 * QLDA-81: task còn việc con thì không xóa được (máy chủ cũng từ chối, 422). Nút "Xóa task" vẫn
 * hiện để người dùng biết vì sao, nhưng hộp thoại chỉ giải thích và dẫn tới danh sách việc con,
 * không có nút xác nhận xóa.
 *
 * Liên kết là `<a href="#…">` tới tiêu đề mục Việc con (vẫn chạy khi mở trong thẻ mới hay không có
 * JavaScript). Bấm thì đóng hộp thoại rồi chuyển focus tới tiêu đề đó thay vì trả focus về nút
 * "Xóa task" (Radix mặc định trả về nút mở).
 */
export function DeleteBlockedDialog({
  taskTitle,
  subtaskCount,
  subtasksAnchorId,
}: {
  taskTitle: string;
  subtaskCount: number;
  /** id của tiêu đề mục Việc con (tabIndex -1, nhận focus được). */
  subtasksAnchorId: string;
}) {
  const strings = useStrings();
  const t = strings.taskDelete;
  const [open, setOpen] = useState(false);
  const goToSubtasks = useRef(false);

  function viewSubtasks(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    goToSubtasks.current = true;
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="danger">{strings.taskDetail.delete.action}</Button>
      </DialogTrigger>
      <DialogContent
        role="alertdialog"
        showClose={false}
        onCloseAutoFocus={(event) => {
          if (!goToSubtasks.current) return;
          goToSubtasks.current = false;
          const target = document.getElementById(subtasksAnchorId);
          if (!target) return;
          event.preventDefault();
          target.focus();
          target.scrollIntoView({ block: "start" });
        }}
      >
        <DialogTitle>{t.blockedTitle(taskTitle)}</DialogTitle>
        <DialogDescription>{t.blockedBody(subtaskCount)}</DialogDescription>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button variant="secondary">{strings.ui.close}</Button>
          </DialogClose>
          <a
            href={`#${subtasksAnchorId}`}
            onClick={viewSubtasks}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-solid border-transparent bg-primary px-3.5 py-2 font-sans text-sm font-medium text-on-primary no-underline hover:bg-primary-hover sm:min-h-9"
          >
            {t.viewSubtasks}
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
