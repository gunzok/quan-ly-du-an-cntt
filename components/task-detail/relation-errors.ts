import type { ApiError } from "@/lib/api/errors";
import { apiErrorText } from "@/lib/i18n/api-error";
import type { Messages } from "@/lib/i18n/messages/vi";
import { relationErrorKind } from "@/lib/task-relations/relation-ui";

/**
 * Câu giải thích dễ hiểu cho lỗi thêm/bỏ quan hệ (Story E8-2): 409 vòng nói rõ "tạo vòng", 409
 * trùng, 422 tự quan hệ / khác dự án, 403 thiếu quyền sửa cả hai task, 404. Lỗi khác: thông điệp
 * chung của API theo ngôn ngữ giao diện.
 */
export function relationErrorText(t: Messages, error: ApiError): string {
  const kind = relationErrorKind(error);
  return kind === "other"
    ? apiErrorText(t, error)
    : t.taskRelationsUi.errors[kind];
}
