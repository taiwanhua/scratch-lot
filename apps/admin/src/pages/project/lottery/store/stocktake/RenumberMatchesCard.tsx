import { useTranslations } from "use-intl";

import { displayBookNo } from "@repo/domain/project/lottery";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { ReviewLine, StocktakeReview } from "./stocktake-model";

export interface RenumberMatchesCardProps {
  matches: StocktakeReview["renumberMatches"];
}

/**
 * 差異核對的「自動對號 N 張(不算差異)」(張數店規格 9.3 第 2 點;補點編號才有):實際在、系統預設帶入的張號 ↔
 * 實際不在、系統記未售的張(同遊戲同位置、可跨本);核准時才寫,不動現金。沒有 → 不顯示。
 */
export const RenumberMatchesCard = ({ matches }: RenumberMatchesCardProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake.renumber");
  const tStock = useTranslations("admin.lotteryStore.stocktake.stock");
  if (matches.length === 0) {
    return null;
  }
  return (
    <Card sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
      <Stack spacing={1}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t("matchedTitle", { count: matches.length })}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          {t("matchedHint")}
        </Typography>
        {matches.map((match) => (
          <Typography key={`${match.bookNo}#${match.ticketNo}`} variant="body2">
            {t("matchedRow", {
              place: match.cashPointName ?? tStock("name"),
              game: `${match.gameCode} ${match.gameName}`,
              ticketNo: match.ticketNo,
              bookNo: displayBookNo(match.bookNo),
              partnerNo: match.partnerTicketNo,
              partnerBookNo: displayBookNo(match.partnerBookNo),
            })}
          </Typography>
        ))}
      </Stack>
    </Card>
  );
};

/** 這本還有待標註(補點編號):不在的張可以 [標跳號](張數店規格 9.3 第 3 點)。 */
export const PendingSkipHint = ({ line }: { line: ReviewLine }) => {
  const t = useTranslations("admin.lotteryStore.stocktake.review");
  if (
    line.pendingSkipCount === 0 ||
    !line.diffs.some((diff) => diff.kind === "missing")
  ) {
    return null;
  }
  return (
    <Typography variant="caption" color="textSecondary">
      {t("skipHint", { count: line.pendingSkipCount })}
    </Typography>
  );
};
