import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  type AllocationWarningItem,
  allocationWarningsOf,
} from "./allocation-warnings";

/**
 * 進貨單、調貨單新增頁的「超過預計要給本數只警告」(規格 7.6):已給 + 在途 + 這張單的本數 > 預計時列出,
 * 照樣可以送出。沒有超過的遊戲時不顯示。
 */
export const AllocationWarnings = ({
  items,
}: {
  items: readonly AllocationWarningItem[];
}) => {
  const t = useTranslations("admin.lotteryPurchasing.allocation");
  const warnings = allocationWarningsOf(items);
  if (warnings.length === 0) {
    return null;
  }
  return (
    <Alert severity="warning">
      <Stack spacing={0.25}>
        <Typography variant="body2">{t("title")}</Typography>
        {warnings.map((warning) => (
          <Typography key={warning.key} variant="body2">
            {t("item", { game: warning.label, excess: warning.excess })}
          </Typography>
        ))}
      </Stack>
    </Alert>
  );
};
