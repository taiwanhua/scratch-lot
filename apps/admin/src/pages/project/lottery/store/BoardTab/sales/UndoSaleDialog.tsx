import type { SaleUndoBlock } from "@repo/domain/project/lottery";
import {
  useLotteryStoreSaleQuery,
  useUndoLotteryTicketSaleMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { SendReversalButton } from "../../forms/SendReversalButton";
import { moneyText } from "../../store-text";
import { useRefreshSales } from "./sales-queries";
import { UNDO_BLOCK_KEYS } from "./sales-text";
import { useSalesText } from "./useSalesText";

export interface UndoSaleDialogProps {
  ticketId: string;
  /** 看板的分店([送撤銷售出申請] 帶入新增頁) */
  orgId: string;
  onClose: () => void;
}

/**
 * 撤銷售出確認視窗(Figma ST-08a / 08b;規格 6.3「當下撤銷」):售出提示的 [撤銷]、[最近售出] 每列的 [撤銷]、
 * 展開卡片的 [撤銷售出] 都先開這個。符合條件(自己賣的、30 分鐘內、班開著、之後沒有異動)→ [撤銷];
 * 不符 → 「請改送撤銷售出申請」+ [送撤銷售出申請](開撤銷售出申請新增頁並帶入這一張;沒有新增權限時不顯示)。
 */
export const UndoSaleDialog = ({
  ticketId,
  orgId,
  onClose,
}: UndoSaleDialogProps) => {
  const { t, clock, errorText } = useSalesText();
  const { session } = useSession();
  const refresh = useRefreshSales();
  const query = useLotteryStoreSaleQuery(
    session.client,
    { ticketId },
    { staleTime: 0 },
  );
  const sale = query.data?.lotteryStoreSale.item ?? null;
  const undo = useUndoLotteryTicketSaleMutation(
    session.client,
    useMutationFeedback({
      success: t("undo.success"),
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
  if (sale === null) {
    return null;
  }
  const block = (sale.undoBlock ?? null) as SaleUndoBlock | null;
  const line = t("undo.line", {
    key: sale.ticketKey,
    amount: moneyText(sale.amount),
    time: clock(sale.soldAt),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={block === null ? t("undo.title") : t("undo.blockedTitle")}
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
                  input: { ticketId: sale.ticketId, version: sale.version },
                });
              }}
            >
              {t("undo.submit")}
            </Button>
          ) : (
            <SendReversalButton ticketId={sale.ticketId} orgId={orgId} />
          )}
        </>
      }
    >
      <Stack spacing={1}>
        <Typography variant="body1">{line}</Typography>
        <Typography variant="body2" color="text.secondary">
          {block === null
            ? t("undo.hint", {
                amount: moneyText(sale.amount),
                cashPoint: sale.cashPoint.name,
              })
            : `${t(UNDO_BLOCK_KEYS[block])}${t("undo.sendRequestHint")}`}
        </Typography>
      </Stack>
    </Dialog>
  );
};
