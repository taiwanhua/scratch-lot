import { useState } from "react";

import {
  COUNT_SALE_TOO_BUSY,
  LOTTERY_FIELD_CATEGORY_KEYS,
} from "@repo/domain/project/lottery-fields";
import { useSellLotteryTicketsByCountMutation } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { CountStepper } from "@/components/project/lottery/CountStepper/CountStepper";
import { ReasonFields } from "@/components/project/lottery/ReasonFields/ReasonFields";
import {
  type ReasonValue,
  missingReasonFields,
  reasonInputOf,
} from "@/components/project/lottery/ReasonFields/reason-value";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { moneyText } from "../../store-text";
import { useRefreshSales } from "./sales-queries";
import { useSalesText } from "./useSalesText";

/** 這個收銀點有未售的一個遊戲(看板的遊戲合計)。 */
export interface CountSaleGame {
  gameId: string;
  gameCode: string;
  gameName: string;
  unitPrice: number;
  /** 這個收銀點這個遊戲的未售張數(張數上限) */
  remaining: number;
}

export interface CountSaleDialogProps {
  orgId: string;
  localCashPointId: string;
  cashPointName: string;
  /** 「負責人 王小明 · 08:02 開班 · 這一班的錢」 */
  shiftText: string;
  /** 這台有未售的遊戲(依遊戲代號) */
  games: readonly CountSaleGame[];
  onClose: () => void;
}

interface Line {
  key: number;
  gameId: string;
  count: number;
}

/**
 * 依張數標記售出(張數店規格 7.2、13.1;Figma CS-03 / CS-03b):本機收銀點、自己開的班才有,錢算這一班。
 * 上方灰底收銀點與負責人;可加好幾列「遊戲 × 張數」(遊戲只列這台有未售的、寫剩 N 張;張數 1 到剩幾張;
 * 同一個遊戲不能兩列)、合計自動算、原因(欄位管理「依張數售出原因」,預設「太忙沒刷」);手機全螢幕。
 * 一次送出;成功提示「已依張數標記售出 遊戲 X × 3 張、遊戲 Y × 1 張,合計 800」。
 */
export const CountSaleDialog = ({
  orgId,
  localCashPointId,
  cashPointName,
  shiftText,
  games,
  onClose,
}: CountSaleDialogProps) => {
  const { t, errorText } = useSalesText();
  const { session } = useSession();
  const refresh = useRefreshSales();
  const isMobile = useBreakpointDown("sm");
  const [lines, setLines] = useState<Line[]>(() => [
    { key: 1, gameId: games[0]?.gameId ?? "", count: 1 },
  ]);
  const [reason, setReason] = useState<ReasonValue>({
    reasonKey: COUNT_SALE_TOO_BUSY,
    reasonNote: "",
  });
  const [invalid, setInvalid] = useState<string[]>([]);
  const gameOf = (gameId: string) =>
    games.find((game) => game.gameId === gameId);
  const chosen = lines.filter((line) => gameOf(line.gameId) !== undefined);
  const totalCount = chosen.reduce((sum, line) => sum + line.count, 0);
  const totalAmount = chosen.reduce(
    (sum, line) => sum + line.count * (gameOf(line.gameId)?.unitPrice ?? 0),
    0,
  );
  const show = useSnackbar();
  const sell = useSellLotteryTicketsByCountMutation(session.client, {
    onSuccess: (data) => {
      const items = data.sellLotteryTicketsByCount.items;
      refresh();
      onClose();
      show(
        "success",
        t("countSale.success", {
          lines: items
            .map((item) =>
              t("countSale.successLine", {
                code: item.gameCode,
                name: item.gameName,
                count: item.count,
              }),
            )
            .join(t("countSale.successSeparator")),
          amount: moneyText(items.reduce((sum, item) => sum + item.amount, 0)),
        }),
        { title: t("countSale.successTitle") },
      );
    },
    onError: (error) => {
      refresh();
      show("error", errorText(error));
    },
  });
  const unused = (except: string) =>
    games.filter(
      (game) =>
        game.gameId === except ||
        !lines.some((line) => line.gameId === game.gameId),
    );
  const update = (key: number, patch: Partial<Line>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };
  const nextGame = unused("").at(0);
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="xs"
      title={t("countSale.title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("sale.cancel")}
          </Button>
          <Button
            disabled={sell.isPending || chosen.length === 0}
            onClick={() => {
              const missing = missingReasonFields(reason);
              setInvalid(missing);
              if (missing.length > 0) {
                return;
              }
              sell.mutate({
                input: {
                  orgId,
                  localCashPointId,
                  lines: chosen.map((line) => ({
                    gameId: line.gameId,
                    count: line.count,
                  })),
                  ...reasonInputOf(reason),
                },
              });
            }}
          >
            {t("countSale.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2}>
        <Box sx={{ bgcolor: "action.hover", borderRadius: 1, p: 1.5 }}>
          <Stack direction="row" sx={{ justifyContent: "space-between" }}>
            <Typography variant="subtitle1" color="textPrimary">
              {cashPointName}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {t("header.local")}
            </Typography>
          </Stack>
          <Typography variant="body2" color="textSecondary">
            {shiftText}
          </Typography>
        </Box>
        {lines.map((line, index) => {
          const game = gameOf(line.gameId);
          return (
            <Stack
              key={line.key}
              direction="row"
              spacing={1.5}
              sx={{ alignItems: "center" }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <SelectField
                  label={t("countSale.game")}
                  value={line.gameId}
                  fullWidth
                  options={unused(line.gameId).map((option) => ({
                    value: option.gameId,
                    label: t("countSale.gameOption", {
                      code: option.gameCode,
                      name: option.gameName,
                      remaining: option.remaining,
                    }),
                  }))}
                  onChange={(gameId: string) => {
                    update(line.key, { gameId, count: 1 });
                  }}
                />
              </Box>
              <CountStepper
                value={line.count}
                min={1}
                max={game?.remaining ?? 1}
                onChange={(count) => {
                  update(line.key, { count });
                }}
                decreaseLabel={t("countSale.decrease", { line: index + 1 })}
                increaseLabel={t("countSale.increase", { line: index + 1 })}
                valueLabel={t("countSale.count", { line: index + 1 })}
              />
              <Typography
                variant="body2"
                color="textSecondary"
                sx={{ minWidth: 56, textAlign: "right" }}
              >
                {t("card.price", {
                  price: moneyText(line.count * (game?.unitPrice ?? 0)),
                })}
              </Typography>
            </Stack>
          );
        })}
        {nextGame === undefined ? null : (
          <Box>
            <Button
              size="small"
              variant="text"
              onClick={() => {
                setLines((current) => [
                  ...current,
                  {
                    key: Math.max(...current.map((line) => line.key)) + 1,
                    gameId: nextGame.gameId,
                    count: 1,
                  },
                ]);
              }}
            >
              {t("countSale.addLine")}
            </Button>
          </Box>
        )}
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          <Typography variant="body2" color="textSecondary">
            {t("countSale.total")}
          </Typography>
          <Typography variant="subtitle1">
            {t("countSale.totalValue", {
              count: totalCount,
              amount: moneyText(totalAmount),
            })}
          </Typography>
        </Stack>
        <ReasonFields
          categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.countSaleReason}
          label={t("countSale.reason")}
          value={reason}
          onChange={setReason}
          invalid={invalid}
        />
        <Typography variant="body2" color="textSecondary">
          {t("countSale.hint", {
            name: cashPointName,
            amount: moneyText(totalAmount),
          })}
        </Typography>
      </Stack>
    </Dialog>
  );
};
