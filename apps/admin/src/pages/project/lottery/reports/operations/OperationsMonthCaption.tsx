import { useTranslations } from "use-intl";

import { Tag } from "@repo/ui/tag";

import type { ReportMonthCaptionProps } from "@/lib/base/reports/report-registry";

import { useOperationsPeriods } from "./useOperationsPeriods";

/**
 * 營運報表月份格子下方的「已關帳 / 尚未關帳」(Figma RE-03 `129:421`;規格 11.1):關帳依序,
 * 月份 ≤ 最後一個已關帳月份 = 已關帳。還沒選分店(查不到)時不顯示。
 */
export const OperationsMonthCaption = ({
  month,
  input,
}: ReportMonthCaptionProps) => {
  const t = useTranslations("admin.lotteryReports.operations.closing");
  const periods = useOperationsPeriods(input);
  const data = periods.data?.lotteryOperationsReportPeriods;
  if (data === undefined) return null;
  const closed =
    data.closedThrough !== null &&
    data.closedThrough !== undefined &&
    month <= data.closedThrough;
  return (
    <Tag
      tone={closed ? "success" : "warning"}
      label={closed ? t("closed") : t("open")}
    />
  );
};
