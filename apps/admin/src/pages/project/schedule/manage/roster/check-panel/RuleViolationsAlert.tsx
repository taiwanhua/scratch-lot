import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";

import type { RosterRuleViolationError } from "./check-errors";

/**
 * 存排班被規則擋下(限制)時的說明(規格 14.2「限制 → 不能存」):
 * 「違反限制的規則,不能儲存:」+ 每條「規則名稱:api 的說明」。沒有違反時不畫。
 */
export const RuleViolationsAlert = ({
  violations,
}: {
  violations: readonly RosterRuleViolationError[];
}) => {
  const t = useTranslations("admin.schedule.roster.check");
  const tRules = useTranslations("admin.schedule.rules");
  if (violations.length === 0) {
    return null;
  }
  return (
    <Alert severity="error">
      {t("blockedTitle")}
      {violations.map((violation) => (
        <Box key={`${violation.key}|${violation.message}`}>
          {tRules(`labels.${violation.key}`)}:{violation.message}
        </Box>
      ))}
    </Alert>
  );
};
