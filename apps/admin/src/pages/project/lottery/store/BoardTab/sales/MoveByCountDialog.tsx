import { useState } from "react";

import { useMoveLotteryTicketsByCountMutation } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { CountStepper } from "@/components/project/lottery/CountStepper/CountStepper";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { moneyText } from "../../store-text";
import { useRefreshSales } from "./sales-queries";
import { useSalesText } from "./useSalesText";

export interface MoveByCountDialogProps {
  orgId: string;
  /** 卡片所在的收銀點(從哪台;由卡片帶入、不能改) */
  cashPointId: string;
  cashPointName: string;
  /** 卡片的遊戲與這台這個遊戲的總剩餘(不限這一本;看板的遊戲合計) */
  game: {
    gameId: string;
    gameCode: string;
    gameName: string;
    unitPrice: number;
    remaining: number;
    bookCount: number;
  };
  /** 這家店的收銀點(移到哪台:只列其他收銀點,沒有庫存) */
  cashPoints: readonly { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}

/**
 * [依張數移櫃](張數店規格 7.7、13.1;Figma CS-04;只有張數店,轉換中不顯示):上方灰底「從哪台、哪個遊戲」由卡片帶入;
 * 移到哪台(只列其他收銀點)、張數(加減按鈕,上限 = 來源台這個遊戲的總剩餘);店員拿任意張,張號由系統預設帶入,
 * 之後刷到實體會自動更正。成功「已從 A 台移 3 張遊戲 X 到 B 台」。手機全螢幕。
 */
export const MoveByCountDialog = ({
  orgId,
  cashPointId,
  cashPointName,
  game,
  cashPoints,
  onClose,
  onDone,
}: MoveByCountDialogProps) => {
  const { t, errorText } = useSalesText();
  const { session } = useSession();
  const refresh = useRefreshSales();
  const isMobile = useBreakpointDown("sm");
  const targets = cashPoints.filter((point) => point.id !== cashPointId);
  const [to, setTo] = useState(targets[0]?.id ?? "");
  const [count, setCount] = useState(1);
  const toName = targets.find((point) => point.id === to)?.name ?? "";
  const gameName = `${game.gameCode} ${game.gameName}`;
  const move = useMoveLotteryTicketsByCountMutation(
    session.client,
    useMutationFeedback({
      success: t("moveByCount.success", {
        from: cashPointName,
        to: toName,
        count,
        game: gameName,
      }),
      error: errorText,
      onSuccess: () => {
        refresh();
        onDone();
      },
    }),
  );
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="xs"
      title={t("moveByCount.title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("sale.cancel")}
          </Button>
          <Button
            disabled={move.isPending || to === "" || game.remaining < 1}
            onClick={() => {
              move.mutate({
                input: {
                  orgId,
                  fromCashPointId: cashPointId,
                  toCashPointId: to,
                  gameId: game.gameId,
                  count,
                },
              });
            }}
          >
            {t("moveByCount.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.75}>
        <Box sx={{ bgcolor: "action.hover", borderRadius: 1, p: 1.5 }}>
          <Stack direction="row" sx={{ justifyContent: "space-between" }}>
            <Typography variant="subtitle1" color="textPrimary">
              {gameName}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {t("card.price", { price: moneyText(game.unitPrice) })}
            </Typography>
          </Stack>
          <Typography variant="body2" color="textSecondary">
            {t("moveByCount.from", {
              cashPoint: cashPointName,
              remaining: game.remaining,
              books: game.bookCount,
            })}
          </Typography>
        </Box>
        <SelectField
          label={t("moveByCount.to")}
          value={to}
          fullWidth
          options={targets.map((point) => ({
            value: point.id,
            label: point.name,
          }))}
          onChange={(value: string) => {
            setTo(value);
          }}
        />
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Typography variant="body2" color="textSecondary">
            {t("moveByCount.count")}
          </Typography>
          <CountStepper
            value={count}
            min={1}
            max={Math.max(1, game.remaining)}
            onChange={setCount}
            decreaseLabel={t("moveByCount.decrease")}
            increaseLabel={t("moveByCount.increase")}
            valueLabel={t("moveByCount.count")}
          />
          <Typography variant="body2" color="textSecondary">
            {t("moveByCount.max", { count: game.remaining })}
          </Typography>
        </Stack>
        <Typography variant="body2" color="textSecondary">
          {t("moveByCount.hint", { count, to: toName })}
        </Typography>
      </Stack>
    </Dialog>
  );
};
