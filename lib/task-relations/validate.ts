import type { ApiErrorDetail } from "@/lib/api/errors";
import {
  isPlainObject,
  isUuid,
  unknownFields,
  type Validation,
} from "@/lib/api/request";
import { TASK_RELATION_KINDS, type TaskRelationKind } from "./model";

/**
 * Schema phía máy chủ cho POST /api/v1/tasks/{id}/relations (viết tay, không thêm thư viện).
 * Từ chối trường lạ (`unknown_field`), không tin kiểu dữ liệu từ trình duyệt. Giới hạn khớp ràng
 * buộc CHECK trong migration 20261115170000_task_relations.sql.
 */

/** |lag_days| tối đa (ngày), khớp task_relations_lag_days_range. */
export const LAG_DAYS_MAX_ABS = 365;
/** Thân request nhỏ: ba trường ngắn. */
export const RELATION_BODY_MAX_BYTES = 1024;

const CREATE_FIELDS = ["kind", "to_task_id", "lag_days"] as const;

export interface RelationCreateInput {
  kind: TaskRelationKind;
  to_task_id: string;
  lag_days: number;
}

export function validateRelationCreate(
  body: unknown,
): Validation<RelationCreateInput> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details: ApiErrorDetail[] = unknownFields(
    Object.keys(body),
    CREATE_FIELDS,
  );

  let kind: TaskRelationKind | undefined;
  if (body.kind === undefined || body.kind === null) {
    details.push({ field: "kind", issue: "required" });
  } else if (
    typeof body.kind !== "string" ||
    !TASK_RELATION_KINDS.includes(body.kind as TaskRelationKind)
  ) {
    details.push({ field: "kind", issue: "invalid_value" });
  } else {
    kind = body.kind as TaskRelationKind;
  }

  let toTaskId: string | undefined;
  if (body.to_task_id === undefined || body.to_task_id === null) {
    details.push({ field: "to_task_id", issue: "required" });
  } else if (!isUuid(body.to_task_id)) {
    details.push({ field: "to_task_id", issue: "invalid_format" });
  } else {
    toTaskId = body.to_task_id.toLowerCase();
  }

  let lagDays = 0;
  if (body.lag_days !== undefined) {
    const v = body.lag_days;
    if (
      typeof v !== "number" ||
      !Number.isInteger(v) ||
      Math.abs(v) > LAG_DAYS_MAX_ABS
    ) {
      details.push({ field: "lag_days", issue: "invalid_value" });
    } else if (v !== 0 && kind !== undefined && kind !== "precedes") {
      // lag_days chỉ có nghĩa với precedes (task_relations_lag_days_kind).
      details.push({ field: "lag_days", issue: "invalid_value" });
    } else {
      lagDays = v === 0 ? 0 : v; // bỏ -0
    }
  }

  if (details.length > 0 || !kind || !toTaskId) {
    return { ok: false, details };
  }
  return { ok: true, data: { kind, to_task_id: toTaskId, lag_days: lagDays } };
}
