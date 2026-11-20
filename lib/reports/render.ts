import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { scalarValues, sectionValues, type ReportData } from "./placeholders";
import { fillDocxTemplate } from "./docx-fill";
import { fillXlsxTemplate } from "./xlsx-fill";

/** Dữ liệu báo cáo + template xlsx → tệp xlsx (Story E5-3). Không đụng CSDL: test gọi thẳng. */
export async function renderXlsxReport(
  template: Uint8Array,
  data: ReportData,
  locale: Locale,
): Promise<Buffer> {
  const t = getMessages(locale);
  return fillXlsxTemplate(
    template,
    { scalars: scalarValues(data, t), sections: sectionValues(data, t) },
    {
      locale,
      emptyText: {
        tasks: t.reports.xlsx.noTasks,
        statuses: t.reports.xlsx.noData,
        assignees: t.reports.xlsx.noData,
      },
    },
  );
}

/** Dữ liệu báo cáo + template docx → tệp docx (Story E5-4). Không đụng CSDL: test gọi thẳng. */
export async function renderDocxReport(
  template: Uint8Array,
  data: ReportData,
  locale: Locale,
): Promise<Buffer> {
  const t = getMessages(locale);
  return fillDocxTemplate(
    template,
    { scalars: scalarValues(data, t), sections: sectionValues(data, t) },
    {
      locale,
      emptyText: {
        tasks: t.reports.xlsx.noTasks,
        statuses: t.reports.xlsx.noData,
        assignees: t.reports.xlsx.noData,
      },
    },
  );
}
