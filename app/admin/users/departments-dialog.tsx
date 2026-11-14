"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import type { ApiError } from "@/lib/api/errors";
import {
  createDepartment,
  patchDepartment,
} from "@/lib/departments/client-api";
import type { Department } from "@/lib/departments/model";
import { DEPARTMENT_NAME_MAX_LENGTH } from "@/lib/departments/validate";
import { strings } from "@/lib/strings";
import styles from "./admin-users.module.css";
import { useModal } from "./use-modal";

const t = strings.departments;

/** Thông điệp lỗi cho ô tên: trùng tên dùng thông điệp máy chủ; còn lại theo loại lỗi trường. */
function nameErrorOf(error: ApiError | null): string | null {
  if (!error) return null;
  if (error.code === "conflict") return error.message;
  const issue = error.details?.find((d) => d.field === "name")?.issue;
  if (!issue) return null;
  if (issue === "required" || issue === "too_long") {
    return strings.errors.field[issue];
  }
  return strings.errors.field.invalid_value;
}

/** Lỗi không gắn với ô nào (mạng, quyền, lỗi hệ thống). */
function generalErrorOf(error: ApiError | null): string | null {
  if (!error || nameErrorOf(error)) return null;
  return error.message;
}

/**
 * Hộp thoại danh mục phòng ban cho Admin (S08): thêm, đổi tên, lưu trữ/dùng lại.
 * Không có xóa: phòng ban đang có người không được xóa cứng; lưu trữ để ẩn khỏi danh sách chọn.
 */
export function DepartmentsDialog({
  open,
  departments,
  onClose,
  onChanged,
}: {
  open: boolean;
  departments: Department[];
  onClose: () => void;
  onChanged: (department: Department) => void;
}) {
  const ref = useModal(open);
  const ids = { title: useId(), desc: useId(), add: useId(), status: useId() };
  const [addError, setAddError] = useState<ApiError | null>(null);
  const [adding, setAdding] = useState(false);
  const [addKey, setAddKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{
    id: string;
    error: ApiError;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  function close() {
    if (adding || busyId) return;
    setAddError(null);
    setRowError(null);
    setEditingId(null);
    setStatus("");
    setAddKey((k) => k + 1);
    onClose();
  }

  /** Trả focus về nút của một dòng sau khi đóng ô sửa (dòng có thể đã đổi vị trí). */
  function focusRowButton(id: string, action: "rename" | "archive") {
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-dept="${id}"][data-action="${action}"]`,
        )
        ?.focus();
    });
  }

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "");
    setAdding(true);
    setAddError(null);
    setStatus("");
    const result = await createDepartment({ name });
    setAdding(false);
    if (!result.ok) {
      setAddError(result.error);
      addInputRef.current?.focus();
      return;
    }
    onChanged(result.data.data);
    setStatus(t.done.added(result.data.data.name));
    setAddKey((k) => k + 1);
    requestAnimationFrame(() => addInputRef.current?.focus());
  }

  async function onRename(e: FormEvent<HTMLFormElement>, dept: Department) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "");
    setBusyId(dept.id);
    setRowError(null);
    setStatus("");
    const result = await patchDepartment(dept.id, { name });
    setBusyId(null);
    if (!result.ok) {
      setRowError({ id: dept.id, error: result.error });
      return;
    }
    onChanged(result.data.data);
    setEditingId(null);
    setStatus(t.done.renamed(result.data.data.name));
    focusRowButton(dept.id, "rename");
  }

  async function onToggleArchive(dept: Department) {
    setBusyId(dept.id);
    setRowError(null);
    setStatus("");
    const result = await patchDepartment(dept.id, {
      archived: !dept.archived,
    });
    setBusyId(null);
    if (!result.ok) {
      setRowError({ id: dept.id, error: result.error });
      return;
    }
    onChanged(result.data.data);
    setStatus(
      result.data.data.archived
        ? t.done.archived(result.data.data.name)
        : t.done.restored(result.data.data.name),
    );
    focusRowButton(dept.id, "archive");
  }

  const addNameError = nameErrorOf(addError);

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles.dialogWide}`}
      aria-labelledby={ids.title}
      aria-describedby={ids.desc}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <h2 id={ids.title} className={styles.dialogTitle}>
        {t.title}
      </h2>
      <p id={ids.desc} className={styles.muted}>
        {t.description}
      </p>

      <form
        key={addKey}
        className={styles.inlineForm}
        onSubmit={onAdd}
        noValidate
      >
        <div className={styles.field}>
          <label htmlFor={ids.add} className={styles.fieldLabel}>
            {t.addLabel}
          </label>
          <input
            ref={addInputRef}
            id={ids.add}
            name="name"
            type="text"
            autoComplete="off"
            required
            maxLength={DEPARTMENT_NAME_MAX_LENGTH}
            className={styles.input}
            aria-invalid={addNameError ? true : undefined}
            aria-describedby={addNameError ? `${ids.add}-error` : undefined}
          />
        </div>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={adding}
          aria-busy={adding || undefined}
        >
          {adding ? t.adding : t.add}
        </button>
      </form>
      {addNameError && (
        <p id={`${ids.add}-error`} className={styles.errorText}>
          {addNameError}
        </p>
      )}
      <div role="alert" className={styles.errorText}>
        {generalErrorOf(addError)}
      </div>

      <p
        id={ids.status}
        role="status"
        aria-live="polite"
        className={styles.dialogStatus}
      >
        {status}
      </p>

      {departments.length === 0 ? (
        <p className={styles.muted}>{t.empty}</p>
      ) : (
        <ul ref={listRef} className={styles.deptList} aria-label={t.listLabel}>
          {departments.map((dept) => (
            <DepartmentItem
              key={dept.id}
              dept={dept}
              editing={editingId === dept.id}
              busy={busyId === dept.id}
              error={rowError?.id === dept.id ? rowError.error : null}
              onEdit={() => {
                setRowError(null);
                setEditingId(dept.id);
              }}
              onCancelEdit={() => {
                setRowError(null);
                setEditingId(null);
                focusRowButton(dept.id, "rename");
              }}
              onRename={(e) => onRename(e, dept)}
              onToggleArchive={() => onToggleArchive(dept)}
            />
          ))}
        </ul>
      )}

      <div className={styles.dialogActions}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={close}
          disabled={adding || busyId !== null}
        >
          {t.close}
        </button>
      </div>
    </dialog>
  );
}

function DepartmentItem({
  dept,
  editing,
  busy,
  error,
  onEdit,
  onCancelEdit,
  onRename,
  onToggleArchive,
}: {
  dept: Department;
  editing: boolean;
  busy: boolean;
  error: ApiError | null;
  onEdit: () => void;
  onCancelEdit: () => void;
  onRename: (e: FormEvent<HTMLFormElement>) => void;
  onToggleArchive: () => void;
}) {
  const inputId = useId();
  const nameError = nameErrorOf(error);
  const general = generalErrorOf(error);

  return (
    <li className={styles.deptItem}>
      <span
        className={`${styles.deptName} ${dept.archived ? styles.deptArchived : ""}`}
      >
        {dept.name}
        {dept.archived && (
          <span className={styles.badge}>{t.archivedBadge}</span>
        )}
      </span>
      {!editing && (
        <span className={styles.actions}>
          <button
            type="button"
            className={styles.linkButton}
            data-dept={dept.id}
            data-action="rename"
            aria-label={t.renameAction(dept.name)}
            onClick={onEdit}
            disabled={busy}
          >
            {t.rename}
          </button>
          <button
            type="button"
            className={`${styles.linkButton} ${dept.archived ? "" : styles.linkDanger}`}
            data-dept={dept.id}
            data-action="archive"
            aria-label={
              dept.archived
                ? t.restoreAction(dept.name)
                : t.archiveAction(dept.name)
            }
            onClick={onToggleArchive}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {dept.archived ? t.restore : t.archive}
          </button>
        </span>
      )}
      {editing && (
        <form className={styles.deptEdit} onSubmit={onRename} noValidate>
          <label htmlFor={inputId} className={styles.visuallyHidden}>
            {t.renameLabel(dept.name)}
          </label>
          <input
            id={inputId}
            name="name"
            type="text"
            autoComplete="off"
            autoFocus
            required
            defaultValue={dept.name}
            maxLength={DEPARTMENT_NAME_MAX_LENGTH}
            className={styles.input}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${inputId}-error` : undefined}
            onKeyDown={(e) => {
              // Esc trong ô sửa chỉ hủy sửa, không đóng cả hộp thoại.
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onCancelEdit();
              }
            }}
          />
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? t.saving : t.save}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onCancelEdit}
            disabled={busy}
          >
            {t.cancel}
          </button>
        </form>
      )}
      {nameError && editing && (
        <p id={`${inputId}-error`} className={styles.errorText}>
          {nameError}
        </p>
      )}
      {(general || (nameError && !editing)) && (
        <p role="alert" className={styles.errorText}>
          {general ?? nameError}
        </p>
      )}
    </li>
  );
}
