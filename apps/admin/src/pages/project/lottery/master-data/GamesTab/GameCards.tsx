import { useTranslations } from "use-intl";

import type { LotteryGameFieldsFragment } from "@repo/graphql";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { TagPaletteChip } from "@/components/project/TagPaletteChip/TagPaletteChip";
import { isTagPaletteKey } from "@/lib/project/tag-palettes";

import { GameStatusTag } from "../GameStatusTag/GameStatusTag";

export interface GameCardsProps {
  rows: readonly LotteryGameFieldsFragment[];
  isLoading: boolean;
  /** 點卡片進詳情;沒綁詳情頁 = undefined(卡片不能點) */
  onOpen?: (row: LotteryGameFieldsFragment) => void;
}

/**
 * 手機版的遊戲列表(規格 16.0 / RW-01:表格在手機改成卡片):
 * 代號 + 名稱 + 顏色 + 狀態一行,面額 × 張數 · 整本金額一行。
 */
export const GameCards = ({ rows, isLoading, onOpen }: GameCardsProps) => {
  const t = useTranslations("admin.lotteryMasterData");
  if (isLoading) {
    return <CircularProgress aria-label={t("gameForm.loading")} />;
  }
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("games.empty")}
      </Typography>
    );
  }
  return (
    <Stack spacing={1.5} sx={{ height: "100%", overflow: "auto" }}>
      {rows.map((row) => (
        <Card
          key={row.id}
          variant="outlined"
          role={onOpen === undefined ? undefined : "button"}
          tabIndex={onOpen === undefined ? undefined : 0}
          onClick={() => onOpen?.(row)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onOpen?.(row);
            }
          }}
          sx={{
            p: 2,
            flexShrink: 0,
            cursor: onOpen === undefined ? "default" : "pointer",
          }}
        >
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography variant="subtitle2" sx={{ flex: 1 }}>
                {row.gameCode} {row.name}
              </Typography>
              {isTagPaletteKey(row.color) && (
                <TagPaletteChip paletteKey={row.color} />
              )}
              <GameStatusTag status={row.status} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {t("gameView.summary", {
                unitPrice: row.unitPrice.toLocaleString("en-US"),
                tickets: row.ticketsPerBook,
                bookPrice: row.bookPrice.toLocaleString("en-US"),
                rate: row.defaultRate,
              })}
            </Typography>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
};
