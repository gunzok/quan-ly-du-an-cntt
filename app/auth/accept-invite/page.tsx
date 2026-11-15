import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { readTokenHashParam } from "@/lib/auth/accept-invite";
import { getStrings } from "@/lib/i18n/server";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { AcceptInviteForm, InvalidInvite } from "./accept-invite-form";

export async function generateMetadata(): Promise<Metadata> {
  const strings = await getStrings();
  return {
    title: `${strings.acceptInvite.pageTitle} · ${strings.app.name}`,
    // Trang mang token mời trên URL: không cho máy tìm kiếm lập chỉ mục.
    robots: { index: false, follow: false },
  };
}

/**
 * Trang nhận lời mời và đặt mật khẩu (Story E1-7, QLDA-80). Công khai (proxy cho qua khi chưa
 * đăng nhập; đã đăng nhập thì về `/`). GET chỉ hiển thị form, KHÔNG gọi Supabase Auth nên không
 * tiêu token (xem lib/auth/accept-invite.ts). Bố cục theo /login, dùng components/ui (E10-1).
 */
export default async function AcceptInvitePage({
  searchParams,
}: PageProps<"/auth/accept-invite">) {
  const strings = await getStrings();
  return (
    <div className="flex min-h-screen bg-canvas p-0 sm:p-3">
      <main className="flex flex-1 items-center justify-center bg-bg px-4 py-10 sm:rounded-xl sm:border sm:border-solid sm:border-border sm:px-8">
        <section
          aria-labelledby="accept-invite-heading"
          className="flex w-full max-w-sm min-w-0 flex-col gap-6"
        >
          <LanguageSwitcher />
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center rounded-md bg-brand font-mono text-xs text-on-brand"
            >
              {strings.app.logoLetters}
            </span>
            <span className="text-sm font-medium text-text">
              {strings.app.name}
            </span>
          </div>
          <Suspense fallback={null}>
            <InviteContent searchParams={searchParams} />
          </Suspense>
        </section>
      </main>
    </div>
  );
}

async function InviteContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const tokenHash = readTokenHashParam((await searchParams).token_hash);
  return tokenHash ? (
    <AcceptInviteForm tokenHash={tokenHash} />
  ) : (
    <InvalidInvite />
  );
}
