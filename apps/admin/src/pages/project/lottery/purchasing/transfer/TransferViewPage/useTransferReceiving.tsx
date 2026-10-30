import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

import {
  type LotteryTransferReceivingFieldsFragment,
  type ReceiveLotteryTransferBookMutation,
  useLotterySettlementQuery,
  useLotteryTransferReceivingQuery,
  useReceiveLotteryTransferBookMutation,
  useReceiveLotteryTransferTicketsMutation,
} from "@repo/graphql";

import type { BookListRow } from "@/components/project/lottery/BookGroupList/BookGroupList";
import type { ReceiveScanOutcome } from "@/components/project/lottery/ReceiveBooksPanel/ReceiveBooksPanel";
import { useFlashTarget } from "@/hooks/base/useFlashTarget";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { ticketListText } from "@/lib/project/lottery/ticket-list-text";

import { TRANSFER_MODULE_KEY } from "../transfer-keys";
import { TransferRowTickets } from "./TransferRowTickets";
import {
  type TransferWrongStoreInfo,
  transferReceiveErrorOf,
} from "./transfer-receive-error";
import { isPartialRow } from "./transfer-unreceived";

type Row = LotteryTransferReceivingFieldsFragment["rows"][number];
type ReceivedPayload =
  ReceiveLotteryTransferBookMutation["receiveLotteryTransferBook"];

interface Flash {
  rowId: string;
  ticketNo: string;
}

/**
 * 調貨單檢視頁的點收(專案規格 8.4;使用者 10/26 定案):刷條碼(整本的列整列、選張的列只點收刷到的那一張 →
 * 那一列自動展開、捲到並閃一下)、格子上點收(點選格子 / 其餘全部到齊)、「這一次」點收的列
 * ([完成這次點收] 用)、每一列的狀態與展開的格子。送錯分店交給 `onWrongStore`(頁面開彈窗)。
 */
export const useTransferReceiving = (
  id: string,
  data: LotteryTransferReceivingFieldsFragment | null,
  onWrongStore: (code: string, info: TransferWrongStoreInfo) => void,
) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.view");
  const tReceive = useTranslations("admin.lotteryPurchasing.receive");
  const showSnackbar = useSnackbar();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const receive = useReceiveLotteryTransferBookMutation(session.client);
  const receiveTickets = useReceiveLotteryTransferTicketsMutation(
    session.client,
  );
  const [thisTime, setThisTime] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const { target: flash, flash: flashRow } = useFlashTarget<Flash>();
  useEffect(() => {
    if (flash === null) {
      return;
    }
    const panel = document.querySelector(
      `[data-row-panel="${CSS.escape(flash.rowId)}"]`,
    );
    if (panel !== null && typeof panel.scrollIntoView === "function") {
      panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [flash]);

  /** 點收成功:記進「這一次」、換上 api 回的點收區塊;刷到選張的列 → 展開並閃一下。 */
  const applyReceived = (result: ReceivedPayload, scanned: boolean) => {
    const { rowId, ticketNos } = result;
    setThisTime((current) => new Set([...current, rowId]));
    queryClient.setQueryData(
      useLotteryTransferReceivingQuery.getKey({ submissionId: id }),
      { lotteryTransferReceiving: result.receiving },
    );
    void queryClient.invalidateQueries({
      queryKey: useLotterySettlementQuery.getKey({
        moduleKey: TRANSFER_MODULE_KEY,
        refId: id,
      }),
    });
    const row = result.receiving.rows.find((item) => item.rowId === rowId);
    const first = ticketNos.at(0);
    if (!scanned || row === undefined || !isPartialRow(row)) {
      return;
    }
    if (first !== undefined) {
      setExpanded((current) => new Set([...current, rowId]));
      flashRow({ rowId, ticketNo: first });
    }
  };

  /** 點收失敗的提示:選張的列同一張再刷 →「這張已經點收」。 */
  const errorText = (
    parsed: ReturnType<typeof transferReceiveErrorOf>,
  ): string =>
    parsed.reason === "TRANSFER_ALREADY_RECEIVED" && parsed.ticketNos.length > 0
      ? tReceive("errors.ticketAlreadyReceived", {
          count: parsed.ticketNos.length,
          tickets: ticketListText(parsed.ticketNos),
        })
      : tReceive(`errors.${parsed.reason}`);

  const onScan = async (
    code: string,
    gameId: string | null,
  ): Promise<ReceiveScanOutcome> => {
    try {
      const result = await receive.mutateAsync({
        input: { submissionId: id, code, gameId },
      });
      applyReceived(result.receiveLotteryTransferBook, true);
      return { kind: "received" };
    } catch (error) {
      const parsed = transferReceiveErrorOf(error);
      if (parsed.wrongStore !== null) {
        onWrongStore(code, parsed.wrongStore);
        return { kind: "failed", message: null };
      }
      const message = errorText(parsed);
      return parsed.gameIds.length > 0
        ? { kind: "ambiguous_game", gameIds: parsed.gameIds, message }
        : { kind: "failed", message };
    }
  };

  /** 格子上點收(點選格子 / 其餘全部到齊);成功回 true。 */
  const onReceiveTickets = async (
    rowId: string,
    ticketNos: string[],
  ): Promise<boolean> => {
    try {
      const result = await receiveTickets.mutateAsync({
        input: { submissionId: id, rowId, ticketNos },
      });
      applyReceived(result.receiveLotteryTransferTickets, false);
      showSnackbar(
        "success",
        t("grid.receivedCount", { count: ticketNos.length }),
      );
      return true;
    } catch (error) {
      showSnackbar("error", errorText(transferReceiveErrorOf(error)));
      return false;
    }
  };

  const isPending = receive.isPending || receiveTickets.isPending;
  const canReceive = data?.canReceive ?? false;
  const toggle = (rowId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(rowId)) {
        next.add(rowId);
      }
      return next;
    });
  };

  /** 列的狀態:已點收;選張的列「部分點收 9 / 12」「未點收 0 / 10」;整本的列「未點收」。 */
  const statusOf = (row: Row): Pick<BookListRow, "status" | "statusLabel"> => {
    if (row.received) {
      return { status: "received" };
    }
    if (!isPartialRow(row)) {
      return { status: "notReceived" };
    }
    const counts = { received: row.receivedTickets, total: row.tickets };
    return row.receivedTickets > 0
      ? { status: "partial", statusLabel: t("rowStatus.partial", counts) }
      : {
          status: "notReceived",
          statusLabel: t("rowStatus.notReceived", counts),
        };
  };

  /** 一列在點收區塊的狀態與展開的格子(選張、已出貨的列才有格子)。 */
  const rowReceivingOf = (
    row: Row,
  ): Pick<BookListRow, "status" | "statusLabel" | "panel"> => {
    const isOpen = expanded.has(row.rowId);
    return {
      ...statusOf(row),
      ...(isPartialRow(row) &&
        row.shipped && {
          panel: {
            isOpen,
            toggleLabel: isOpen ? t("grid.collapse") : t("grid.expand"),
            onToggle: () => {
              toggle(row.rowId);
            },
            content: (
              <TransferRowTickets
                ticketNos={row.ticketNos}
                receivedTicketNos={row.receivedTicketNos}
                canReceive={canReceive && !row.received}
                isPending={isPending}
                {...(flash?.rowId === row.rowId && {
                  flash: { ticketNo: flash.ticketNo, nonce: flash.nonce },
                })}
                onReceive={(ticketNos) =>
                  onReceiveTickets(row.rowId, ticketNos)
                }
              />
            ),
          },
        }),
    };
  };

  return {
    onScan,
    rowReceivingOf,
    isPending,
    thisTime,
    resetThisTime: () => {
      setThisTime(new Set());
    },
  };
};
