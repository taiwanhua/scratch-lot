import { useState } from "react";

import type { LotteryStoreBoardBookFieldsFragment } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { usePermissions } from "@/hooks/base/usePermissions";

import { CounterScanDialog } from "./CounterScanDialog";
import { MoveByCountDialog } from "./MoveByCountDialog";
import {
  type CountCardAction,
  countCardActionsOf,
  movePauseOf,
} from "./card-cells";
import { useSalesText } from "./useSalesText";

export interface CountCardActionsProps {
  orgId: string;
  book: LotteryStoreBoardBookFieldsFragment;
  /** 卡片所在的收銀點(來源台) */
  point: { id: string; name: string };
  isLocal: boolean;
  /** 這家店的收銀點(移到哪台) */
  cashPoints: readonly { id: string; name: string }[];
  countMode: string;
  /** 進行中的全店重刷(遊戲)/ 補點編號(null) */
  movePauses: readonly { gameId?: string | null }[];
  /** 卡片收銀點這個遊戲的總剩餘與本數(看板的遊戲合計;[依張數移櫃] 的上限) */
  gameTotal?: { remaining: number; bookCount: number };
}

/**
 * 張數店展開卡片底部一排 [收回] [刷條碼移櫃] [依張數移櫃](張數店規格 13.2、13.4;Figma CS-02a / 02b):前兩個開
 * 刷條碼或手輸張號的視窗(`CounterScanDialog`),依張數移櫃輸入張數(`MoveByCountDialog`),都預帶這張卡片的收銀點
 * 與遊戲;轉換中不顯示 [依張數移櫃](9.2)。這個遊戲全店重刷中 / 補點編號中,兩個移櫃按鈕變灰並寫原因(8.5;
 * 後端一律再檢查)。
 */
export const CountCardActions = ({
  orgId,
  book,
  point,
  isLocal,
  cashPoints,
  countMode,
  movePauses,
  gameTotal,
}: CountCardActionsProps) => {
  const { t } = useSalesText();
  const { hasPermission } = usePermissions();
  const [open, setOpen] = useState<CountCardAction | null>(null);
  const actions = countCardActionsOf(countMode, (key) => hasPermission(key));
  const pause = movePauseOf(movePauses, book.gameId);
  if (actions.length === 0) {
    return null;
  }
  const close = () => {
    setOpen(null);
  };
  const labels: Record<CountCardAction, string> = {
    recall: t("expand.recall"),
    move: t("expand.scanMove"),
    byCount: t("expand.moveByCount"),
  };
  let pausedText: string | null = null;
  if (pause === "renumber") {
    pausedText = t("expand.pausedRenumber");
  } else if (pause === "rescan") {
    pausedText = t("expand.pausedRescan", {
      game: `${book.gameCode} ${book.gameName}`,
    });
  }
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
        {actions.map((action) => (
          <Button
            key={action}
            size="small"
            variant="outlined"
            disabled={action !== "recall" && pause !== null}
            onClick={() => {
              setOpen(action);
            }}
          >
            {labels[action]}
          </Button>
        ))}
      </Stack>
      {pausedText === null ? null : (
        <Typography variant="caption" color="textSecondary">
          {pausedText}
        </Typography>
      )}
      {open === "recall" || open === "move" ? (
        <CounterScanDialog
          kind={open}
          orgId={orgId}
          cashPointId={point.id}
          cashPointName={point.name}
          isLocal={isLocal}
          cashPoints={cashPoints}
          onClose={close}
          onDone={close}
        />
      ) : null}
      {open === "byCount" ? (
        <MoveByCountDialog
          orgId={orgId}
          cashPointId={point.id}
          cashPointName={point.name}
          game={{
            gameId: book.gameId,
            gameCode: book.gameCode,
            gameName: book.gameName,
            unitPrice: book.unitPrice,
            remaining: gameTotal?.remaining ?? book.remaining,
            bookCount: gameTotal?.bookCount ?? 1,
          }}
          cashPoints={cashPoints}
          onClose={close}
          onDone={close}
        />
      ) : null}
    </Stack>
  );
};
