"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { AlertIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import {
  submitAcceptInvite,
  type AcceptInviteState,
} from "@/lib/auth/accept-invite-action";
import { signInWithGoogle } from "@/lib/auth/actions";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { useStrings } from "@/lib/i18n/client";

const initialState: AcceptInviteState = {};

function Heading({ children }: { children: string }) {
  return (
    <h1
      id="accept-invite-heading"
      className="m-0 font-display text-display-sm text-text"
    >
      {children}
      <span aria-hidden="true" className="text-accent">
        .
      </span>
    </h1>
  );
}

/** Link giả, hết hạn hoặc đã dùng: cùng một thông báo (không lộ tài khoản có tồn tại không). */
export function InvalidInvite() {
  const strings = useStrings();
  const t = strings.acceptInvite;
  return (
    <div className="flex flex-col gap-4">
      <p className="label m-0">{t.eyebrow}</p>
      <Heading>{t.invalidHeading}</Heading>
      <div
        role="alert"
        className="flex gap-2.5 rounded-md border border-solid border-border bg-bg-subtle p-3 text-sm text-text"
      >
        <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="flex flex-col gap-2">
          <p className="m-0">{t.invalidBody}</p>
          <p className="m-0 font-medium">{t.invalidAction}</p>
        </div>
      </div>
      <p className="m-0 text-sm text-text-muted">{t.invalidHintSignedUp}</p>
      <Link
        href={LOGIN_PATH}
        className="self-start text-sm font-medium text-primary underline underline-offset-2"
      >
        {t.backToLogin}
      </Link>
    </div>
  );
}

function SubmitButton() {
  const strings = useStrings();
  const t = strings.acceptInvite;
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} loadingText={t.submitting}>
      {t.submit}
    </Button>
  );
}

function GoogleButton() {
  const strings = useStrings();
  const t = strings.acceptInvite;
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="secondary"
      loading={pending}
      loadingText={t.googleRedirecting}
      aria-describedby="accept-invite-google-hint"
    >
      {t.google}
    </Button>
  );
}

/**
 * Form đặt mật khẩu. token_hash đi trong ô ẩn (POST), máy chủ kiểm lại mọi thứ
 * (lib/auth/accept-invite-action.ts). Lỗi link chuyển sang InvalidInvite. Không đặt maxLength:
 * trình duyệt sẽ cắt ngầm mật khẩu dán vào; máy chủ báo lỗi "quá dài" rõ ràng thay vì vậy.
 */
export function AcceptInviteForm({ tokenHash }: { tokenHash: string }) {
  const strings = useStrings();
  const t = strings.acceptInvite;
  const [state, formAction] = useActionState(submitAcceptInvite, initialState);

  if (state.linkInvalid) {
    return <InvalidInvite />;
  }

  const passwordError = state.fieldErrors?.password
    ? t.fieldErrors.password[state.fieldErrors.password]
    : undefined;
  const confirmError = state.fieldErrors?.confirm
    ? t.fieldErrors.confirm[state.fieldErrors.confirm]
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="label m-0">{t.eyebrow}</p>
        <Heading>{t.heading}</Heading>
        <p className="m-0 text-sm text-text-muted">{t.subtitle}</p>
      </div>

      <form action={formAction} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <Field
          label={t.passwordLabel}
          hint={t.passwordHint}
          error={passwordError}
        >
          {(control) => (
            <Input
              {...control}
              name="password"
              type="password"
              autoComplete="new-password"
              required
            />
          )}
        </Field>
        <Field label={t.confirmLabel} error={confirmError}>
          {(control) => (
            <Input
              {...control}
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              required
            />
          )}
        </Field>

        <div role="alert" className="text-sm text-danger empty:hidden">
          {state.formError ? t.errors[state.formError] : null}
        </div>

        <SubmitButton />
      </form>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="label">{t.divider}</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form action={signInWithGoogle} className="flex flex-col gap-2">
        <GoogleButton />
        <p
          id="accept-invite-google-hint"
          className="m-0 text-xs text-text-muted"
        >
          {t.googleHint}
        </p>
      </form>
    </div>
  );
}
