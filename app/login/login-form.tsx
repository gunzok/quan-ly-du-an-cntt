"use client";

import { useActionState } from "react";
import type { FieldIssue } from "@/lib/api/errors";
import { signIn, type SignInState } from "@/lib/auth/actions";
import { EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH } from "@/lib/auth/validate";
import { strings } from "@/lib/strings";
import styles from "./login.module.css";

const initialState: SignInState = {};

function fieldIssue(state: SignInState, field: string): FieldIssue | undefined {
  return state.error?.details?.find((d) => d.field === field)?.issue;
}

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const emailIssue = fieldIssue(state, "email");
  const passwordIssue = fieldIssue(state, "password");

  return (
    <form action={formAction} className={styles.form} noValidate>
      <div className={styles.field}>
        <label htmlFor="email" className={styles.label}>
          {strings.login.emailLabel}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          maxLength={EMAIL_MAX_LENGTH}
          defaultValue={state.email}
          key={state.email ?? ""}
          className={styles.input}
          aria-invalid={emailIssue ? true : undefined}
          aria-describedby={emailIssue ? "email-error" : undefined}
        />
        {emailIssue && (
          <p id="email-error" className={styles.fieldError}>
            {strings.errors.field[emailIssue]}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="password" className={styles.label}>
          {strings.login.passwordLabel}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={PASSWORD_MAX_LENGTH}
          className={styles.input}
          aria-invalid={passwordIssue ? true : undefined}
          aria-describedby={passwordIssue ? "password-error" : undefined}
        />
        {passwordIssue && (
          <p id="password-error" className={styles.fieldError}>
            {strings.errors.field[passwordIssue]}
          </p>
        )}
      </div>

      <div role="alert" className={styles.formError}>
        {state.error?.message}
      </div>

      <button
        type="submit"
        className={styles.primaryButton}
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {pending ? strings.login.submitting : strings.login.submit}
      </button>
    </form>
  );
}
