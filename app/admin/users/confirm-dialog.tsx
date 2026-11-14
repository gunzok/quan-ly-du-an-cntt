"use client";

import { useId } from "react";
import { strings } from "@/lib/strings";
import styles from "./admin-users.module.css";
import { useModal } from "./use-modal";

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  working,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger: boolean;
  working: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useModal(open);
  const titleId = useId();
  const bodyId = useId();

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id={titleId} className={styles.dialogTitle}>
        {title}
      </h2>
      <p id={bodyId} className={styles.muted}>
        {body}
      </p>
      <div role="alert" className={styles.errorText}>
        {error}
      </div>
      <div className={styles.dialogActions}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onCancel}
          disabled={working}
        >
          {strings.adminUsers.confirm.cancel}
        </button>
        <button
          type="button"
          className={danger ? styles.dangerButton : styles.primaryButton}
          onClick={onConfirm}
          disabled={working}
          aria-busy={working || undefined}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
