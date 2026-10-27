import { useState } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  TicketGrid,
  type TicketGridCell,
} from "@/components/project/lottery/TicketGrid/TicketGrid";
import { ticketListText } from "@/lib/project/lottery/ticket-list-text";

export interface TransferRowTicketsProps {
  /** 這一列的張號(3 位) */
  ticketNos: readonly string[];
  /** 已點收的張號 */
  receivedTicketNos: readonly string[];
  /** 操作者現在能不能點收(點收關卡的任務在他手上);不能時格子只看 */
  canReceive: boolean;
  isPending: boolean;
  /** 刷到這一張時閃一下 */
  flash?: { ticketNo: string; nonce: number };
  /** 點收這幾張(點選格子 / 其餘全部到齊);成功回 true */
  onReceive: (ticketNos: string[]) => Promise<boolean>;
}

/**
 * 調貨單選張的列逐張點收的格子(專案規格 8.4「點收」;使用者 10/26 定案):已點收的不能選;
 * 點選格子 → [點收選取的 N 張];[其餘全部到齊…] 先確認「確認 054、055、056 這 3 張都到了?」(不限先刷過一張)。
 * 格子沿用 `TicketGrid`(未點收 = 未售的格子、已點收 = 已售 / 不能選的格子;文字由這裡給)。
 */
export const TransferRowTickets = ({
  ticketNos,
  receivedTicketNos,
  canReceive,
  isPending,
  flash,
  onReceive,
}: TransferRowTicketsProps) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.view.grid");
  const [selected, setSelected] = useState<string[]>([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const received = new Set(receivedTicketNos);
  const cells: TicketGridCell[] = ticketNos.map((ticketNo) => ({
    ticketNo,
    state: received.has(ticketNo) ? "sold" : "unsold",
  }));
  const rest = ticketNos.filter((ticketNo) => !received.has(ticketNo));
  const picked = selected.filter((ticketNo) => !received.has(ticketNo));

  const receiveTickets = (target: string[]) => {
    void onReceive(target).then((isDone) => {
      if (isDone) {
        setSelected([]);
        setIsConfirming(false);
      }
    });
  };

  return (
    <Stack spacing={1.5}>
      <TicketGrid
        cells={cells}
        selectableStates={canReceive ? ["unsold"] : []}
        selected={picked}
        onSelectedChange={setSelected}
        legendItems={
          canReceive ? ["unsold", "sold", "selected"] : ["unsold", "sold"]
        }
        labels={{
          unsold: t("notReceived"),
          sold: t("received"),
        }}
        quickSelect={canReceive}
        {...(!canReceive && { summary: false as const })}
        {...(flash !== undefined && { flash })}
      />
      {canReceive && rest.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          <Button
            disabled={picked.length === 0 || isPending}
            onClick={() => {
              receiveTickets(picked);
            }}
          >
            {t("receiveSelected", { count: picked.length })}
          </Button>
          <Button
            variant="outlined"
            disabled={isPending}
            onClick={() => {
              setIsConfirming(true);
            }}
          >
            {t("receiveRest")}
          </Button>
        </Stack>
      )}
      {isConfirming && (
        <Dialog
          open
          onClose={() => {
            setIsConfirming(false);
          }}
          fullWidth
          maxWidth="xs"
          title={t("restTitle")}
          actions={
            <>
              <Button
                variant="text"
                onClick={() => {
                  setIsConfirming(false);
                }}
              >
                {t("cancel")}
              </Button>
              <Button
                disabled={isPending}
                onClick={() => {
                  receiveTickets(rest);
                }}
              >
                {t("restConfirm")}
              </Button>
            </>
          }
        >
          <Typography variant="body2">
            {t("restBody", {
              tickets: ticketListText(rest),
              count: rest.length,
            })}
          </Typography>
        </Dialog>
      )}
    </Stack>
  );
};
