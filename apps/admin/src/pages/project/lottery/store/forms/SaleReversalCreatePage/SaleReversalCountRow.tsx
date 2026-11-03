import { useEffect } from "react";
import { useTranslations } from "use-intl";

import { useLotteryStoreSaleReversalOptionsQuery } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { CountStepper } from "@/components/project/lottery/CountStepper/CountStepper";
import { useSession } from "@/hooks/base/useSession";

import type { ReversalCountRow } from "../sale-reversal-form";

export interface SaleReversalCountRowProps {
  orgId: string;
  row: ReversalCountRow;
  /** 這家店啟用中的收銀點 */
  cashPoints: readonly { id: string; name: string }[];
  /** 這台裝置的本機收銀點(選項標「(本機)」) */
  localCashPointId: string | null;
  /** 沒選遊戲時標紅 */
  error: boolean;
  onChange: (row: ReversalCountRow) => void;
  onRemove: () => void;
}

/**
 * 撤銷售出申請「依遊戲 + 張數」的一列(張數店規格 7.3 第 3 點、13.2;Figma CS-14):收銀點(預設本機)、遊戲
 * (只列這台有系統預設帶入的已售的)、張數(加減按鈕 1 到「最多 N 張」,N = 這台這個遊戲的已售·未對號張數)。
 * 送出時系統挑這台最近的已售·未對號;張數不夠時伺服器擋下並告訴還有幾張。
 */
export const SaleReversalCountRow = ({
  orgId,
  row,
  cashPoints,
  localCashPointId,
  error,
  onChange,
  onRemove,
}: SaleReversalCountRowProps) => {
  const t = useTranslations("admin.lotteryStore.saleReversal");
  const { session } = useSession();
  const options = useLotteryStoreSaleReversalOptionsQuery(
    session.client,
    { orgId, cashPointId: row.cashPointId },
    { enabled: orgId !== "" && row.cashPointId !== "", staleTime: 0 },
  );
  const games = options.data?.lotteryStoreSaleReversalOptions.games ?? [];
  const game = games.find((item) => item.gameId === row.gameId) ?? null;
  const max = game?.available ?? 0;
  // 帶入的列(依張數撤銷不符條件)只有遊戲 id:讀到選項後補單價、張數不超過最多幾張
  useEffect(() => {
    if (game === null) {
      return;
    }
    const count = Math.min(Math.max(row.count, 1), Math.max(game.available, 1));
    if (
      game.unitPrice !== row.unitPrice ||
      game.gameCode !== row.gameCode ||
      count !== row.count
    ) {
      onChange({
        ...row,
        gameCode: game.gameCode,
        gameName: game.gameName,
        unitPrice: game.unitPrice,
        count,
      });
    }
  }, [game, row, onChange]);
  return (
    <Stack
      direction={{ xs: "column", md: "row" }}
      spacing={2}
      sx={{ alignItems: { md: "center" } }}
    >
      <SelectField
        label={t("countCashPoint")}
        value={row.cashPointId}
        required
        fullWidth
        options={cashPoints.map((point) => ({
          value: point.id,
          label:
            point.id === localCashPointId
              ? t("localCashPoint", { name: point.name })
              : point.name,
        }))}
        onChange={(next: string) => {
          onChange({
            ...row,
            cashPointId: next,
            gameId: "",
            gameCode: "",
            gameName: "",
            unitPrice: 0,
          });
        }}
      />
      <SelectField
        label={t("countGame")}
        value={game === null ? "" : row.gameId}
        required
        fullWidth
        error={error && row.gameId === ""}
        helperText={
          games.length === 0 && !options.isLoading
            ? t("countNoGames")
            : undefined
        }
        options={games.map((item) => ({
          value: item.gameId,
          label: t("countGameOption", {
            gameCode: item.gameCode,
            gameName: item.gameName,
          }),
        }))}
        onChange={(next: string) => {
          const picked = games.find((item) => item.gameId === next);
          onChange({
            ...row,
            gameId: next,
            gameCode: picked?.gameCode ?? "",
            gameName: picked?.gameName ?? "",
            unitPrice: picked?.unitPrice ?? 0,
            count: 1,
          });
        }}
      />
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", flexShrink: 0 }}
      >
        <CountStepper
          value={row.count}
          min={1}
          max={Math.max(max, 1)}
          onChange={(count) => {
            onChange({ ...row, count });
          }}
          decreaseLabel={t("countDecrease")}
          increaseLabel={t("countIncrease")}
          valueLabel={t("countValue")}
        />
        <Typography
          variant="body2"
          color="textSecondary"
          sx={{ whiteSpace: "nowrap" }}
        >
          {t("countMax", { count: max })}
        </Typography>
        <Button variant="text" size="small" onClick={onRemove}>
          {t("remove")}
        </Button>
      </Stack>
    </Stack>
  );
};
