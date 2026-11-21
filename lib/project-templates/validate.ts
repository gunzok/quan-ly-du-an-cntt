import type { ApiErrorDetail } from "@/lib/api/errors";
import {
  isPlainObject,
  unknownFields,
  type Validation,
} from "@/lib/api/request";
import { PROJECT_TEMPLATE_NAME_MAX } from "./model";

/**
 * Kiểm đầu vào thuần (không I/O) cho /api/v1/project-templates và
 * POST /api/v1/projects/{id}/templates. Từ chối trường lạ (`unknown_field`).
 */

export const PROJECT_TEMPLATE_BODY_MAX_BYTES = 2048;

// Ký tự điều khiển C0/C1, ký tự định hướng (bidi), ký tự không độ rộng.
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/;

/** Chuẩn hóa tên: NFC, gộp khoảng trắng, cắt hai đầu. */
export function normalizeTemplateName(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function readName(
  value: unknown,
  details: ApiErrorDetail[],
): string | undefined {
  if (value === undefined || value === null) {
    details.push({ field: "name", issue: "required" });
    return undefined;
  }
  if (typeof value !== "string") {
    details.push({ field: "name", issue: "invalid_value" });
    return undefined;
  }
  if (FORBIDDEN_CHARS.test(value)) {
    details.push({ field: "name", issue: "invalid_format" });
    return undefined;
  }
  const name = normalizeTemplateName(value);
  if (name === "") {
    details.push({ field: "name", issue: "required" });
    return undefined;
  }
  if (name.length > PROJECT_TEMPLATE_NAME_MAX) {
    details.push({ field: "name", issue: "too_long" });
    return undefined;
  }
  return name;
}

/** POST /api/v1/projects/{id}/templates { name } */
export function validateTemplateSave(
  body: unknown,
): Validation<{ name: string }> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details = unknownFields(Object.keys(body), ["name"]);
  const name = readName(body.name, details);
  return details.length > 0 || name === undefined
    ? { ok: false, details }
    : { ok: true, data: { name } };
}

export interface ProjectTemplatePatch {
  name?: string;
  archived?: boolean;
}

/** PATCH /api/v1/project-templates/{id} { name?, archived? }: ít nhất một trường. */
export function validateTemplatePatch(
  body: unknown,
): Validation<ProjectTemplatePatch> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details = unknownFields(Object.keys(body), ["name", "archived"]);
  const patch: ProjectTemplatePatch = {};
  if ("name" in body) {
    const name = readName(body.name, details);
    if (name !== undefined) patch.name = name;
  }
  if ("archived" in body) {
    if (typeof body.archived === "boolean") patch.archived = body.archived;
    else details.push({ field: "archived", issue: "invalid_value" });
  }
  if (details.length === 0 && Object.keys(patch).length === 0) {
    details.push({ field: "body", issue: "required" });
  }
  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: patch };
}

/** GET /api/v1/project-templates?include_archived=true|false */
export function validateTemplateListQuery(
  params: URLSearchParams,
): Validation<{ includeArchived: boolean }> {
  const details = unknownFields(new Set(params.keys()), ["include_archived"]);
  const values = params.getAll("include_archived");
  let includeArchived = false;
  if (values.length > 1) {
    details.push({ field: "include_archived", issue: "invalid_value" });
  } else if (values.length === 1) {
    if (values[0] === "true") includeArchived = true;
    else if (values[0] !== "false") {
      details.push({ field: "include_archived", issue: "invalid_value" });
    }
  }
  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: { includeArchived } };
}
