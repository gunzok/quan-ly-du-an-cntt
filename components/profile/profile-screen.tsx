"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n/client";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { apiErrorText } from "@/lib/i18n/api-error";
import type { Messages } from "@/lib/i18n/messages";
import type { MeProfile } from "@/lib/me/load";
import { patchMe } from "@/lib/profile/client-api";
import {
  FULL_NAME_MAX,
  PHONE_MAX,
  normalizeFullName,
  normalizePhone,
  type ProfileFieldIssue,
} from "@/lib/profile/rules";
import { applyTheme, THEMES, type Theme } from "@/lib/profile/theme";

type FieldErrors = { full_name?: string; phone?: string };

function nameError(t: Messages["profile"], issue: ProfileFieldIssue) {
  if (issue === "required") return t.errors.fullNameRequired;
  if (issue === "too_long") return t.errors.fullNameTooLong;
  return t.errors.fullNameInvalid;
}

/** Nhóm lựa chọn dạng nút liền nhau, dùng radio thật (mũi tên chuyển lựa chọn, Tab vào nhóm). */
function ChoiceGroup<T extends string>({
  legend,
  hint,
  name,
  options,
  value,
  onChange,
  label,
  lang,
}: {
  legend: string;
  hint: string;
  name: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: (value: T) => string;
  lang?: (value: T) => string;
}) {
  const hintId = useId();
  return (
    <fieldset
      className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
      aria-describedby={hintId}
    >
      <legend className="mb-1.5 p-0 text-sm font-medium text-text">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option}
            lang={lang?.(option)}
            className={cn(
              "relative inline-flex min-h-11 cursor-pointer items-center rounded-md border border-solid px-3.5 text-sm sm:min-h-9",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary has-[:focus-visible]:outline-solid",
              option === value
                ? "border-primary bg-bg-muted font-semibold text-primary"
                : "border-border-strong bg-bg text-text hover:bg-bg-muted",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={option === value}
              onChange={() => onChange(option)}
              className="absolute inset-0 m-0 cursor-pointer opacity-0"
            />
            {label(option)}
          </label>
        ))}
      </div>
      <p id={hintId} className="m-0 text-xs font-normal text-text-muted">
        {hint}
      </p>
    </fieldset>
  );
}

/**
 * Màn hồ sơ cá nhân S18 (Story E1-7, mockup v3 Profile-v2.dc.html): sửa tên hiển thị, số điện
 * thoại, ngôn ngữ (lưu hồ sơ qua PATCH /api/v1/me), giao diện sáng/tối (cookie trình duyệt); email,
 * phòng ban, vai trò theo dự án chỉ đọc. Lưu xong làm mới Server Component để khung ứng dụng hiện
 * tên mới và cả trang đổi ngôn ngữ ngay.
 */
export function ProfileScreen({
  profile,
  initialTheme,
}: {
  profile: MeProfile;
  initialTheme: Theme;
}) {
  const { t: strings } = useI18n();
  const t = strings.profile;
  const router = useRouter();
  const [saved, setSaved] = useState({
    full_name: profile.full_name,
    phone: profile.phone ?? "",
    locale: profile.locale,
    theme: initialTheme,
  });
  const [fullName, setFullName] = useState(profile.full_name);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [locale, setLocale] = useState<Locale>(profile.locale);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<"idle" | "saved" | "failed">("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setStatus("idle");
    setFailure(null);

    const name = normalizeFullName(fullName);
    const tel = normalizePhone(phone);
    const nextErrors: FieldErrors = {};
    if (!name.ok) nextErrors.full_name = nameError(t, name.issue);
    if (!tel.ok) nextErrors.phone = t.errors.phoneInvalid;
    setErrors(nextErrors);
    if (!name.ok || !tel.ok) {
      const first = !name.ok ? "profile-full-name" : "profile-phone";
      document
        .querySelector<HTMLInputElement>(`[data-field="${first}"]`)
        ?.focus();
      return;
    }

    const body: Parameters<typeof patchMe>[0] = {};
    if (name.value !== saved.full_name) body.full_name = name.value;
    if ((tel.value ?? "") !== saved.phone) body.phone = tel.value;
    if (locale !== saved.locale) body.locale = locale;

    startTransition(async () => {
      if (Object.keys(body).length > 0) {
        const result = await patchMe(body);
        if (!result.ok) {
          const fieldErrors: FieldErrors = {};
          for (const d of result.error.details ?? []) {
            if (d.field === "full_name") {
              fieldErrors.full_name = nameError(
                t,
                d.issue === "too_long" || d.issue === "required"
                  ? d.issue
                  : "invalid_format",
              );
            }
            if (d.field === "phone") fieldErrors.phone = t.errors.phoneInvalid;
          }
          setErrors(fieldErrors);
          setFailure(
            Object.keys(fieldErrors).length > 0
              ? null
              : apiErrorText(strings, result.error),
          );
          setStatus("failed");
          return;
        }
      }
      if (theme !== saved.theme) applyTheme(theme);
      setFullName(name.value);
      setPhone(tel.value ?? "");
      setSaved({
        full_name: name.value,
        phone: tel.value ?? "",
        locale,
        theme,
      });
      setStatus("saved");
      // Tên mới ở khung ứng dụng, ngôn ngữ mới ở cả trang (kể cả <html lang>).
      if (body.full_name !== undefined || body.locale !== undefined) {
        router.refresh();
      }
    });
  }

  const roleLabel = (role: MeProfile["projects"][number]["role"]) =>
    strings.projects.roles[role];
  const displayName = saved.full_name || profile.email;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-8">
      <header className="flex flex-col gap-4">
        <h1 className="font-display text-display-sm">
          {t.pageTitle}
          <span aria-hidden="true" className="text-accent">
            .
          </span>
        </h1>
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={displayName} size="lg" className="shrink-0" />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-base font-semibold [overflow-wrap:anywhere]">
              {displayName}
            </span>
            <span className="text-sm text-text-muted [overflow-wrap:anywhere]">
              {t.departmentLabel}: {profile.department?.name ?? t.noDepartment}
            </span>
            {profile.is_admin ? (
              <span className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                {t.systemRole}:
                <Badge tone="primary">{strings.projects.roles.admin}</Badge>
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <form
        noValidate
        onSubmit={submit}
        aria-labelledby="profile-form-heading"
        className="flex flex-col gap-4 rounded-lg border border-solid border-border p-4 sm:p-5"
      >
        <h2 id="profile-form-heading" className="m-0 text-base font-semibold">
          {t.formHeading}
        </h2>
        <Field
          label={t.fullName}
          hint={t.fullNameHint}
          error={errors.full_name}
        >
          {(control) => (
            <Input
              {...control}
              data-field="profile-full-name"
              name="full_name"
              autoComplete="name"
              maxLength={FULL_NAME_MAX + 20}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          )}
        </Field>
        <Field label={t.email}>
          {(control) => (
            <Input
              {...control}
              type="email"
              readOnly
              value={profile.email}
              className="bg-bg-subtle text-text-muted"
            />
          )}
        </Field>
        <Field label={t.phone} hint={t.phoneHint} error={errors.phone}>
          {(control) => (
            <Input
              {...control}
              data-field="profile-phone"
              type="tel"
              name="phone"
              inputMode="tel"
              autoComplete="tel"
              maxLength={PHONE_MAX + 10}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          )}
        </Field>
        <ChoiceGroup<Locale>
          legend={t.language}
          hint={t.languageHint}
          name="locale"
          options={LOCALES}
          value={locale}
          onChange={setLocale}
          label={(value) => strings.language[value]}
          lang={(value) => value}
        />
        <ChoiceGroup<Theme>
          legend={t.theme}
          hint={t.themeHint}
          name="theme"
          options={THEMES}
          value={theme}
          onChange={setTheme}
          label={(value) => t.themes[value]}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button type="submit" loading={pending} loadingText={t.saving}>
            {t.save}
          </Button>
          <p role="status" className="m-0 text-sm text-text-muted">
            {status === "saved" && !pending ? t.saved : ""}
          </p>
        </div>
        {failure ? (
          <p role="alert" className="m-0 text-sm text-danger">
            {failure}
          </p>
        ) : null}
      </form>

      <section
        aria-labelledby="profile-roles-heading"
        className="flex flex-col gap-2 rounded-lg border border-solid border-border p-4 sm:p-5"
      >
        <h2 id="profile-roles-heading" className="m-0 text-base font-semibold">
          {t.rolesHeading}
        </h2>
        <p className="m-0 text-xs text-text-muted">{t.rolesHint}</p>
        {profile.projects.length === 0 ? (
          <p className="m-0 py-2 text-sm text-text-muted">{t.rolesEmpty}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {profile.projects.map((project) => (
              <li
                key={project.project_id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-0 border-t border-solid border-border py-1.5 text-sm"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <Link
                    href={`/projects/${project.project_id}`}
                    className="inline-flex min-h-11 items-center [overflow-wrap:anywhere] sm:min-h-9"
                  >
                    {project.name}
                  </Link>
                  {project.status === "archived" ? (
                    <Badge tone="neutral">{t.archived}</Badge>
                  ) : null}
                </span>
                <span className="text-text-muted">
                  {roleLabel(project.role)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
