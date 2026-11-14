import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { strings } from "@/lib/strings";
import { UiKit } from "./ui-kit";

export const metadata: Metadata = {
  title: `${strings.devUi.pageTitle} · ${strings.app.name}`,
  robots: { index: false, follow: false },
};

/**
 * Trang xem thử component nền (Story E10-1). Chỉ có khi `next dev`: bản production (`next build`
 * đặt NODE_ENV=production) trả 404. Vẫn sau proxy đăng nhập như mọi trang khác.
 */
export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <UiKit />;
}
