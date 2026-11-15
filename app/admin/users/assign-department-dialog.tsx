"use client";

import { useId, useState, type FormEvent } from "react";
import type { ApiError } from "@/lib/api/errors";
import { patchUser } from "@/lib/admin/users/client-api";
import { displayName } from "@/lib/admin/users/format";
import type { AdminUser } from "@/lib/admin/users/model";
import type { Department } from "@/lib/departments/model";
import { strings } from "@/lib/strings";
import styles from "./admin-users.module.css";
import { useModal } from "./use-modal";

const t = strings.adminUsers.assign;

/**
 * Hộp thoại đổi phòng ban của một người (S08). Danh sách chọn gồm phòng ban đang dùng và phòng ban
 * hiện tại của người đó (kể cả khi đã lưu trữ, để giữ nguyên được).
 */
export function AssignDepartmentDialog({
  user,
  departments,
  onClose,
  onAssigned,
}: {
  user: AdminUser | null;
  departments: Department[];
  onClose: () => void;
  onAssigned: (user: AdminUser) => void;
}) {
  const ref = useModal(user !== null);
  const ids = { title: useId(), desc: useId(), select: useId() };
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function close() {
    if (submitting) return;
    setError(null);
    onClose();
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;
    const value = String(
      new FormData(e.currentTarget).get("department_id") ?? "",
    );
    setSubmitting(true);
    setError(null);
    const result = await patchUser(user.id, {
      department_id: value === "" ? null : value,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onAssigned(result.data.data);
  }

  const options = departments.filter(
    (d) => !d.archived || d.id === user?.department?.id,
  );

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
      {user && (
        <form
          key={user.id}
          className={styles.form}
          onSubmit={onSubmit}
          noValidate
        >
          <h2 id={ids.title} className={styles.dialogTitle}>
            {t.title(displayName(user))}
          </h2>
          <p id={ids.desc} className={styles.muted}>
            {t.description}
          </p>
          <div className={styles.field}>
            <label htmlFor={ids.select} className={styles.fieldLabel}>
              {t.label}
            </label>
            <select
              id={ids.select}
              name="department_id"
              defaultValue={user.department?.id ?? ""}
              className={styles.input}
              aria-invalid={error?.details?.length ? true : undefined}
            >
              <option value="">{t.none}</option>
              {options.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.archived
                    ? `${d.name}${strings.adminUsers.archivedSuffix}`
                    : d.name}
                </option>
              ))}
            </select>
          </div>
          <div role="alert" className={styles.errorText}>
            {error?.message}
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
      )}
    </dialog>
  );
}
