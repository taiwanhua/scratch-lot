import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Typography } from "@repo/ui/typography";

import {
  type DayOffViolationTextInput,
  useDayOffViolationText,
} from "@/hooks/project/schedule/useDayOffViolationText/useDayOffViolationText";

export interface DayOffBlockedAlertProps {
  /** 存檔被擋下的違反(api `extensions.violations`);空陣列不顯示 */
  violations: readonly DayOffViolationTextInput[];
}

/** 違反限制、沒存進去時,在對話框裡逐條列出原因(規格 14.6「違反限制 → 不存,提示原因」)。 */
export const DayOffBlockedAlert = ({ violations }: DayOffBlockedAlertProps) => {
  const t = useTranslations("admin.schedule.dayOffs.dialog");
  const violationText = useDayOffViolationText();
  if (violations.length === 0) {
    return null;
  }
  return (
    <Alert severity="error">
      <Typography variant="body2">{t("blocked")}</Typography>
      {violations.map((violation) => (
        <Typography
          key={`${violation.key}-${violation.from ?? ""}`}
          variant="body2"
        >
          {violationText(violation)}
        </Typography>
      ))}
    </Alert>
  );
};
