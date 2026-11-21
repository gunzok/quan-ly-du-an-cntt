"use client";

import { ToastProvider } from "@/components/ui/toast";
import { useStrings } from "@/lib/i18n/client";
import { ProjectTemplatesPanel } from "./templates-panel";

/** Nội dung trang /project-templates (S17, Story E7-1): tiêu đề và bảng template dự án. */
export function ProjectTemplatesScreen() {
  return (
    <ToastProvider>
      <Screen />
    </ToastProvider>
  );
}

function Screen() {
  const t = useStrings().projectTemplates;
  return (
    <div className="flex flex-col gap-5 px-4 py-6 sm:px-8">
      <header className="flex flex-col gap-2">
        <span className="label flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block size-1.5 rounded-pill bg-accent"
          />
          {t.eyebrow}
        </span>
        <h1 className="font-display text-display-sm">
          {t.heading}
          <span aria-hidden="true" className="text-accent">
            .
          </span>
        </h1>
      </header>
      <ProjectTemplatesPanel />
    </div>
  );
}
