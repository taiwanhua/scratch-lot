import { useTranslations } from "use-intl";

import { allocationExcessOf } from "@repo/domain/project/lottery";
import { Alert } from "@repo/ui/alert";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

/** 一個遊戲:分店的預計要給本數 / 已給 / 在途,與這張單要給的本數。 */
export interface AllocationWarningItem {
  key: string;
  /** 遊戲名稱(例「5164 發大財」) */
  label: string;
  plannedBooks: number | null;
  givenBooks: number;
  inTransitBooks: number;
  /** 這張單給這家店幾本(整本) */
  books: number;
}

/** 超過預計要給本數的那幾個遊戲(超過幾本);沒超過的不列。 */
export const allocationWarningsOf = (
  items: readonly AllocationWarningItem[],
): { key: string; label: string; excess: number }[] =>
  items.flatMap((item) => {
    const excess = allocationExcessOf(item);
    return excess > 0 ? [{ key: item.key, label: item.label, excess }] : [];
  });

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
