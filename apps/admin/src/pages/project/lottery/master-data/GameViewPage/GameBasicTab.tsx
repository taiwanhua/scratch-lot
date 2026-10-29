import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { isTagPaletteKey } from "@repo/domain/tag-palette";
import type { LotteryGameFieldsFragment } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { TagPaletteChip } from "@/components/base/TagPaletteChip/TagPaletteChip";
import { useTemporalText } from "@/hooks/base/useTemporalText";

export interface GameBasicTabProps {
  game: LotteryGameFieldsFragment;
}

/**
 * 遊戲詳情的「基本資料」分頁:新增 / 編輯頁的欄位唯讀呈現(電腦三欄、平板兩欄、手機單欄,RW-03)。
 */
export const GameBasicTab = ({ game }: GameBasicTabProps) => {
  const t = useTranslations("admin.lotteryMasterData");
  const temporal = useTemporalText();
  const empty = t("gameView.empty");
  const dateOf = (value: unknown) => (value ? temporal(value, "date") : empty);

  const rows: { key: string; value: ReactNode }[] = [
    { key: "gameCode", value: game.gameCode },
    { key: "name", value: game.name },
    { key: "status", value: t(`status.${game.status}`) },
    { key: "unitPrice", value: game.unitPrice.toLocaleString("en-US") },
    { key: "ticketsPerBook", value: game.ticketsPerBook },
    { key: "bookPrice", value: game.bookPrice.toLocaleString("en-US") },
    { key: "defaultRate", value: game.defaultRate },
    { key: "launchedAt", value: dateOf(game.launchedAt) },
    { key: "discontinuedAt", value: dateOf(game.discontinuedAt) },
    { key: "claimDeadline", value: dateOf(game.claimDeadline) },
    {
      key: "note",
      value: game.note ?? empty,
    },
  ];

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, 1fr)",
            md: "repeat(3, 1fr)",
          },
        }}
      >
        {rows.map((row) => (
          <Stack key={row.key} spacing={0.5}>
            <Typography variant="caption" color="textSecondary">
              {t(`gameForm.fields.${row.key}`)}
            </Typography>
            <Typography variant="body2">{row.value}</Typography>
          </Stack>
        ))}
      </Box>
      <Stack spacing={0.5} sx={{ alignItems: "flex-start" }}>
        <Typography variant="caption" color="textSecondary">
          {t("gameForm.sections.color")}
        </Typography>
        {isTagPaletteKey(game.color) ? (
          <TagPaletteChip paletteKey={game.color} />
        ) : (
          <Typography variant="body2">{empty}</Typography>
        )}
      </Stack>
    </Stack>
  );
};
