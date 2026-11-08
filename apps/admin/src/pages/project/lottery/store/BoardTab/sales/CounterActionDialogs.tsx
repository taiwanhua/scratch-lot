import { useState } from "react";

import { displayBookNo } from "@repo/domain/project/lottery";
import {
  LOTTERY_FIELD_CATEGORY_KEYS,
  MANUAL_SALE_SCAN_FAILED,
} from "@repo/domain/project/lottery-fields";
import { useSellLotteryTicketsMutation } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { ReasonFields } from "@/components/project/lottery/ReasonFields/ReasonFields";
import {
  type ReasonValue,
  missingReasonFields,
  reasonInputOf,
} from "@/components/project/lottery/ReasonFields/reason-value";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { moneyText } from "../../store-text";
import { rangesOf } from "./card-cells";
import { useRefreshSales } from "./sales-queries";
import { useSalesText } from "./useSalesText";

/** 選到的一張(條件更新用的版本)。 */
export interface CounterTicket {
  id: string;
  version: number;
  ticketNo: string;
}

/** 卡片的本(視窗上方的灰底區塊)。 */
export interface CounterBook {
  gameCode: string;
  gameName: string;
  unitPrice: number;
  bookNo: string;
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2 }}>
    <Typography variant="body2" color="textSecondary">
      {label}
    </Typography>
    <Typography variant="body1" sx={{ textAlign: "right" }}>
      {value}
    </Typography>
  </Stack>
);

export interface ManualSaleDialogProps {
  orgId: string;
  localCashPointId: string;
  /** 「店內櫃台(王小明 08:02 開的班)」 */
  cashPointText: string;
  cashPointName: string;
  book: CounterBook;
  tickets: readonly CounterTicket[];
  onClose: () => void;
  onDone: () => void;
}

/**
 * 手動標記售出(Figma ST-07;規格 6.3「手動標記」):選了哪幾張、單張金額、合計、原因(必選,
 * 欄位管理「手動標記原因」,預設「刷不到條碼」);手機全螢幕。錢算本機收銀點這一班。
 */
export const ManualSaleDialog = ({
  orgId,
  localCashPointId,
  cashPointText,
  cashPointName,
  book,
  tickets,
  onClose,
  onDone,
}: ManualSaleDialogProps) => {
  const { t, errorText } = useSalesText();
  const { session } = useSession();
  const refresh = useRefreshSales();
  const isMobile = useBreakpointDown("sm");
  const [reason, setReason] = useState<ReasonValue>({
    reasonKey: MANUAL_SALE_SCAN_FAILED,
    reasonNote: "",
  });
  const [invalid, setInvalid] = useState<string[]>([]);
  const total = book.unitPrice * tickets.length;
  const sell = useSellLotteryTicketsMutation(
    session.client,
    useMutationFeedback({
      success: t("manualSale.success", { count: tickets.length }),
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
      title={t("manualSale.title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("sale.cancel")}
          </Button>
          <Button
            disabled={sell.isPending}
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
                  tickets: tickets.map((ticket) => ({
                    ticketId: ticket.id,
                    version: ticket.version,
                  })),
                  source: "manual",
                  ...reasonInputOf(reason),
                },
              });
            }}
          >
            {t("manualSale.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="textSecondary">
          {t("manualSale.book", {
            code: book.gameCode,
            name: book.gameName,
            bookNo: displayBookNo(book.bookNo),
          })}
        </Typography>
        <Row label={t("manualSale.cashPoint")} value={cashPointText} />
        <Row
          label={t("manualSale.tickets")}
          value={t("manualSale.ticketsValue", {
            ranges: rangesOf(tickets),
            count: tickets.length,
          })}
        />
        <Row
          label={t("manualSale.unitPrice")}
          value={t("card.price", { price: moneyText(book.unitPrice) })}
        />
        <Row
          label={t("manualSale.total")}
          value={t("card.price", { price: moneyText(total) })}
        />
        <ReasonFields
          categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.manualSaleReason}
          label={t("manualSale.reason")}
          value={reason}
          onChange={setReason}
          invalid={invalid}
        />
        <Typography variant="body2" color="textSecondary">
          {t("manualSale.hint", {
            name: cashPointName,
            amount: moneyText(total),
          })}
        </Typography>
      </Stack>
    </Dialog>
  );
};
