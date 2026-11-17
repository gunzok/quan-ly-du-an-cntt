import type { Locale } from "@/lib/i18n/config";
import { formatCalendarDate } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages";
import type {
  ActivityChange,
  ActivityEntry,
  ActivityPerson,
  ActivityRef,
  ActivityValue,
} from "./model";

/**
 * Dựng câu dễ đọc cho một bản ghi nhật ký (Story E6-2). Hàm thuần, không gọi mạng: mọi tên đã có
 * trong phần tử API trả về. Ví dụ (vi):
 *   actor   "Nguyễn Minh Anh"
 *   summary "đổi trạng thái task “Thiết kế Kanban”"
 *   details ["Trạng thái: Cần làm → Đang làm"]
 * Đối tượng đã xóa hiện chữ "đã xóa" thay cho tên; người làm null là "Hệ thống".
 */
export interface ActivityMessage {
  actor: string;
  summary: string;
  details: string[];
}

type T = Messages["activity"];

function isPerson(v: ActivityValue): v is ActivityPerson {
  return typeof v === "object" && v !== null && "full_name" in v;
}

function isRef(v: ActivityValue): v is ActivityRef {
  return typeof v === "object" && v !== null && "name" in v;
}

export function personName(p: ActivityPerson | null, t: T): string {
  if (!p) return t.system;
  return p.full_name ?? t.unknownUser;
}

/** Giá trị một trường → chữ hiển thị. */
export function formatValue(
  change: Pick<ActivityChange, "kind">,
  value: ActivityValue,
  strings: Messages,
  locale: Locale,
): string {
  const t = strings.activity;
  if (value === null) {
    return change.kind === "person" ? t.unassigned : t.emptyValue;
  }
  if (isPerson(value)) return value.full_name ?? t.unknownUser;
  if (isRef(value)) {
    if (value.name !== null) return value.name;
    if (change.kind === "status") return t.deletedStatus;
    if (change.kind === "type") return t.deletedType;
    return t.deletedTask;
  }
  switch (change.kind) {
    case "date":
      return formatCalendarDate(value, locale) ?? value;
    case "priority":
      return (strings.ui.priority as Record<string, string>)[value] ?? value;
    case "project_status":
      return (t.projectStatus as Record<string, string>)[value] ?? value;
    case "role":
      return (strings.projects.roles as Record<string, string>)[value] ?? value;
    default:
      return value;
  }
}

function fieldLabel(change: ActivityChange, t: T): string {
  return (t.fields as Record<string, string>)[change.field] ?? change.field;
}

/** Dòng chi tiết cho từng trường. */
export function changeLines(
  entry: ActivityEntry,
  strings: Messages,
  locale: Locale,
): string[] {
  const t = strings.activity;
  return entry.changes
    .filter(
      // Tạo việc con: task cha đã nằm trong câu tóm tắt.
      (c) => !(entry.action === "create" && c.field === "parent_id"),
    )
    .map((c) => {
      const label = fieldLabel(c, t);
      if (c.kind === "redacted") return t.descriptionChanged(label);
      const after = formatValue(c, c.after, strings, locale);
      if (entry.action === "create") return t.fieldSet(label, after);
      return t.fieldChange(
        label,
        formatValue(c, c.before, strings, locale),
        after,
      );
    });
}

function summary(
  entry: ActivityEntry,
  strings: Messages,
  locale: Locale,
): string {
  const t = strings.activity;
  const fields = entry.changes.map((c) => c.field);
  const only = fields.length === 1 ? fields[0] : null;

  if (entry.entity_type === "task") {
    const title = entry.entity_name ?? t.unknownTask;
    if (entry.action === "delete") return t.task.delete(title);
    if (entry.action === "create") {
      const parent = entry.changes.find((c) => c.field === "parent_id");
      return parent && parent.after !== null
        ? t.task.createSub(
            title,
            formatValue(parent, parent.after, strings, locale),
          )
        : t.task.create(title);
    }
    if (only === "status_id") return t.task.status(title);
    if (only === "assignee_id") return t.task.assign(title);
    if (only === "title") return t.task.rename(title);
    return t.task.update(title);
  }

  if (entry.entity_type === "project") {
    const name = entry.entity_name ?? t.unknownProject;
    if (entry.action === "delete") return t.project.delete(name);
    if (entry.action === "create") return t.project.create(name);
    if (only === "status") {
      const status = entry.changes[0].after;
      if (status === "archived") return t.project.archive(name);
      if (status === "active") return t.project.unarchive(name);
    }
    return t.project.update(name);
  }

  const member = entry.entity_name ?? t.unknownUser;
  if (entry.action === "delete") return t.member.delete(member);
  if (entry.action === "create") {
    const role = entry.changes.find((c) => c.field === "role");
    return t.member.create(
      member,
      role ? formatValue(role, role.after, strings, locale) : t.emptyValue,
    );
  }
  return t.member.update(member);
}

export function describeActivity(
  entry: ActivityEntry,
  strings: Messages,
  locale: Locale,
): ActivityMessage {
  const t = strings.activity;
  let details = changeLines(entry, strings, locale);
  // Thêm thành viên: vai trò đã có trong câu tóm tắt.
  if (entry.entity_type === "project_member" && entry.action === "create") {
    details = [];
  }
  return {
    actor: personName(entry.actor, t),
    summary: summary(entry, strings, locale),
    details,
  };
}
