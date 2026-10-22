import { useTranslations } from "use-intl";

import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { formatCount } from "../purchasing-keys";
import {
  BooksInput,
  type CandidateListProps,
  ExcessTag,
  GameLabel,
} from "./CandidateTable";
import { salesText } from "./requisition-form";

/**
 * 平板 / 手機版的遊戲卡片(Figma PU-02 平板 127:26386、手機 127:26700):
 * 遊戲名稱與「叫幾本」同一列,下一列「庫存 N 張 · 在途 N 本 · 近 7 天 · 近 30 天」,超過時加提醒。
 */
export const CandidateCards = ({
  rows,
  counts,
  isLoading,
  onChangeBooks,
}: CandidateListProps) => {
  const t = useTranslations("admin.lotteryPurchasing.create");
  if (isLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary">
        {t("empty")}
      </Typography>
    );
  }
  return (
    <Stack spacing={1.5}>
      {rows.map((row) => (
        <Card key={row.gameId} variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", justifyContent: "space-between" }}
            >
              <GameLabel row={row} />
              <BooksInput
                row={row}
                counts={counts}
                onChangeBooks={onChangeBooks}
              />
            </Stack>
            <Typography variant="body2" color="textSecondary">
              {t("cardFacts", {
                stock: formatCount(row.stockTickets),
                inTransit: formatCount(row.inTransitBooks),
                sold7: salesText(row.sold7),
                sold30: salesText(row.sold30),
              })}
            </Typography>
            <ExcessTag row={row} counts={counts} />
          </Stack>
        </Card>
      ))}
    </Stack>
  );
};
