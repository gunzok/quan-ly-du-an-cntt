"use client";

import { useId, useState, type FormEvent } from "react";
import type { ApiError, FieldIssue } from "@/lib/api/errors";
import { inviteUser } from "@/lib/admin/users/client-api";
import type { AdminUser } from "@/lib/admin/users/model";
import { FULL_NAME_MAX_LENGTH } from "@/lib/admin/users/validate";
import { EMAIL_MAX_LENGTH } from "@/lib/auth/validate";
import { strings } from "@/lib/strings";
import styles from "./admin-users.module.css";
import { useModal } from "./use-modal";
import type { Department } from "./users-screen";

const t = strings.adminUsers.invite;

function issueOf(
  error: ApiError | null,
  field: string,
): FieldIssue | undefined {
  return error?.details?.find((d) => d.field === field)?.issue;
}

export function InviteDialog({
  open,
  departments,
  onClose,
  onInvited,
}: {
  open: boolean;
  departments: Department[];
  onClose: () => void;
  onInvited: (user: AdminUser) => void;
}) {
  const ref = useModal(open);
  const ids = {
    title: useId(),
    desc: useId(),
    email: useId(),
    name: useId(),
    dept: useId(),
  };
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Đổi key để làm mới form mỗi lần mở lại.
  const [formKey, setFormKey] = useState(0);

  function close() {
    if (submitting) return;
    setError(null);
    setFormKey((k) => k + 1);
    onClose();
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const department = String(form.get("department_id") ?? "");
    const fullName = String(form.get("full_name") ?? "").trim();
    setSubmitting(true);
    setError(null);
    const result = await inviteUser({
      email: String(form.get("email") ?? ""),
      ...(fullName ? { full_name: fullName } : {}),
      ...(department ? { department_id: department } : {}),
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFormKey((k) => k + 1);
    onInvited(result.data.data);
  }

  const emailIssue = issueOf(error, "email");
  const nameIssue = issueOf(error, "full_name");
  const deptIssue = issueOf(error, "department_id");
  // Email đã tồn tại: hiện thông điệp cụ thể dưới ô email thay vì thông điệp chung theo loại lỗi.
  const emailMessage =
    error?.code === "conflict"
      ? error.message
      : emailIssue && strings.errors.field[emailIssue];

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={ids.title}
      aria-describedby={ids.desc}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <form
        key={formKey}
        className={styles.form}
        onSubmit={onSubmit}
        noValidate
      >
        <h2 id={ids.title} className={styles.dialogTitle}>
          {t.title}
        </h2>
        <p id={ids.desc} className={styles.muted}>
          {t.description}
        </p>

        <div className={styles.field}>
          <label htmlFor={ids.email} className={styles.fieldLabel}>
            {t.emailLabel}
          </label>
          <input
            id={ids.email}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            required
            maxLength={EMAIL_MAX_LENGTH}
            className={styles.input}
            aria-invalid={emailMessage ? true : undefined}
            aria-describedby={emailMessage ? `${ids.email}-error` : undefined}
          />
          {emailMessage && (
            <p id={`${ids.email}-error`} className={styles.errorText}>
              {emailMessage}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={ids.name} className={styles.fieldLabel}>
            {t.nameLabel}
          </label>
          <input
            id={ids.name}
            name="full_name"
            type="text"
            autoComplete="off"
            maxLength={FULL_NAME_MAX_LENGTH}
            className={styles.input}
            aria-invalid={nameIssue ? true : undefined}
            aria-describedby={nameIssue ? `${ids.name}-error` : undefined}
          />
          {nameIssue && (
            <p id={`${ids.name}-error`} className={styles.errorText}>
              {strings.errors.field[nameIssue]}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={ids.dept} className={styles.fieldLabel}>
            {t.departmentLabel}
          </label>
          <select
            id={ids.dept}
            name="department_id"
            defaultValue=""
            className={styles.input}
            aria-invalid={deptIssue ? true : undefined}
            aria-describedby={deptIssue ? `${ids.dept}-error` : undefined}
          >
            <option value="">{t.departmentNone}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {deptIssue && (
            <p id={`${ids.dept}-error`} className={styles.errorText}>
              {error?.message}
            </p>
          )}
        </div>

        <div role="alert" className={styles.errorText}>
          {error && !error.details?.length && error.code !== "conflict"
            ? error.message
            : null}
        </div>

        <div className={styles.dialogActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={close}
            disabled={submitting}
          >
            {t.cancel}
          </button>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={submitting}
            aria-busy={submitting || undefined}
          >
            {submitting ? t.submitting : t.submit}
          </button>
        </div>
      </form>
    </dialog>
  );
}
