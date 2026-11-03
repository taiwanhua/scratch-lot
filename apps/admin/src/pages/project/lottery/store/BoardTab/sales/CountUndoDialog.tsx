import { useState } from "react";

import type { SaleUndoBlock } from "@repo/domain/project/lottery";
import {
  type LotteryStoreSaleFieldsFragment,
  useUndoLotteryCountSaleMutation,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { CountStepper } from "@/components/project/lottery/CountStepper/CountStepper";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { SendReversalButton } from "../../forms/SendReversalButton";
import { moneyText } from "../../store-text";
import { useRefreshSales } from "./sales-queries";
import { UNDO_BLOCK_KEYS } from "./sales-text";
import { useSalesText } from "./useSalesText";

export interface CountUndoDialogProps {
  /** [最近售出] 那一列(一次依張數賣出) */
  row: LotteryStoreSaleFieldsFragment;
  /** 看板的分店 */
  orgId: string;
  onClose: () => void;
}

/**
 * 撤銷依張數售出(張數店規格 7.3 第 2 點、13.2;Figma CS-07b):遊戲、這一筆張數、單價,撤幾張(1 到現在可以撤的),
 * 提示「客人有退票的話請改用刷條碼撤銷」,[撤銷 N 張];成功「已撤銷 遊戲 X 1 張,扣回 200」。
 * 不符條件 → 照現況「請改送撤銷售出申請」+ [送撤銷售出申請]。
 */
export const CountUndoDialog = ({
  row,
  orgId,
  onClose,
}: CountUndoDialogProps) => {
  const { t, clock, errorText } = useSalesText();
  const { session } = useSession();
  const refresh = useRefreshSales();
  const sale = row.countSale;
  const [count, setCount] = useState(1);
  const undo = useUndoLotteryCountSaleMutation(
    session.client,
    useMutationFeedback({
      success: t("countUndo.success", {
        code: sale?.gameCode ?? "",
        name: sale?.gameName ?? "",
        count,
        amount: moneyText(count * (sale?.unitPrice ?? 0)),
      }),
      error: errorText,
      onSuccess: () => {
        refresh();
        onClose();
      },
      onError: () => {
        refresh();
      },
    }),
  );
  if (sale == null) {
    return null;
  }
  const block = (row.undoBlock ?? null) as SaleUndoBlock | null;
  const max = Math.max(1, sale.undoableCount);
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={block === null ? t("countUndo.title") : t("undo.blockedTitle")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("sale.cancel")}
          </Button>
          {block === null ? (
            <Button
              color="error"
              disabled={undo.isPending}
              onClick={() => {
                undo.mutate({
                  input: { orgId, refId: sale.refId, count },
                });
              }}
            >
              {t("countUndo.submit", { count })}
            </Button>
          ) : (
            <SendReversalButton ticketId={row.ticketId} orgId={orgId} />
          )}
        </>
      }
    >
      <Stack spacing={2}>
        <Box sx={{ bgcolor: "action.hover", borderRadius: 1, p: 1.5 }}>
          <Stack direction="row" sx={{ justifyContent: "space-between" }}>
            <Typography variant="subtitle1" color="textPrimary">
              {sale.gameCode} {sale.gameName}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {t("card.price", { price: moneyText(sale.unitPrice) })}
            </Typography>
          </Stack>
          <Typography variant="body2" color="textSecondary">
            {t("countUndo.line", {
              time: clock(row.soldAt),
              count: sale.count - sale.undoneCount,
            })}
          </Typography>
        </Box>
        {block === null ? (
          <>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
              <Typography variant="body2" color="textSecondary">
                {t("countUndo.count")}
              </Typography>
              <CountStepper
                value={count}
                min={1}
                max={max}
                onChange={setCount}
                decreaseLabel={t("countUndo.decrease")}
                increaseLabel={t("countUndo.increase")}
                valueLabel={t("countUndo.count")}
              />
              <Typography variant="body2" color="textSecondary">
                {t("countUndo.max", { count: sale.undoableCount })}
              </Typography>
            </Stack>
            <Typography variant="body2" color="textSecondary">
              {t("countUndo.hint", {
                amount: moneyText(count * sale.unitPrice),
                cashPoint: row.cashPoint.name,
              })}
            </Typography>
          </>
        ) : (
          <Typography variant="body2" color="textSecondary">
            {`${t(UNDO_BLOCK_KEYS[block])}${t("undo.sendRequestHint")}`}
          </Typography>
        )}
      </Stack>
    </Dialog>
  );
};
