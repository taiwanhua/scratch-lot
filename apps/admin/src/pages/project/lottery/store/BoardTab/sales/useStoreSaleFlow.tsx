import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import {
  INVENTORY_PERMISSIONS,
  STORE_PERMISSIONS,
} from "@repo/domain/project/lottery";
import {
  type LotteryStoreScanQuery,
  useLotteryStoreScanQuery,
  useSellLotteryTicketsMutation,
} from "@repo/graphql";

import { RecoverTicketDialog } from "@/components/project/lottery/RecoverTicketDialog/RecoverTicketDialog";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { storeSalesErrorOf } from "@/lib/project/lottery/store-sales-error";

import { moneyText } from "../../store-text";
import { QuickSaleDialog } from "./QuickSaleDialog";
import { ScanOutcomeDialog, type ScanPrompt } from "./ScanOutcomeDialog";
import { SplitWizardDialog } from "./SplitWizardDialog";
import { UndoSaleDialog } from "./UndoSaleDialog";
import { useRefreshSales } from "./sales-queries";
import { type ScanItem, useBlockedText } from "./scan-place";
import { useSalesText } from "./useSalesText";

/**
 * 拆本後重刷這張用的碼:本號開頭是 0 時用背面編號(帶遊戲代號,同本號對到兩款遊戲也只會是這一款;
 * 第 5、6 段不驗證),否則用正面條碼。
 */
const rescanCodeOf = (item: ScanItem): string =>
  item.bookNo.startsWith("0")
    ? `${item.gameCode}-1-${item.bookNo.slice(1)}-${item.ticketNo}-0-0`
    : `${item.bookNo}${item.ticketNo}`;

type Step =
  | { kind: "prompt"; prompt: ScanPrompt }
  | { kind: "quick"; item: ScanItem }
  | { kind: "recover"; item: ScanItem }
  | { kind: "undo"; ticketId: string }
  | { kind: "split"; bookId: string; code: string };

export interface StoreSaleFlowOptions {
  /** 看的那家店 */
  orgId: string;
  /** 這台裝置的本機收銀點;沒設定 = null */
  local: { id: string; name: string } | null;
  /** `board` 看板(本機收銀點檯面直接售出)/ `quick` 其他頁面的快速銷售(先開小視窗確認) */
  mode: "board" | "quick";
  /** 刷到本店的張(看板:展開的卡片裡那一格閃一下) */
  onScanned?: (item: ScanItem) => void;
}

export interface StoreSaleFlow {
  /** 條碼槍 / 相機 / 輸入讀到的碼 */
  handleCode: (code: string) => void;
  /** 打開撤銷確認(售出提示、[最近售出]、展開卡片) */
  openUndo: (ticketId: string) => void;
  /** 這個流程開著的對話框 */
  element: ReactNode;
}

/**
 * 刷到刮刮樂的整條流程(專案規格 6.3;Figma ST-05a–f、ST-06、ST-08、ST-35a):查刷到的張 →
 * 依 api 判斷的處理方式直接售出 / 確認 / 選遊戲 / 詢問拆本 / 擋下 / 提示尋回;售出後跳
 * 「已售出 … [撤銷]」提示。同時兩人賣同一張,失敗方看到「已於 hh:mm 售出」。
 */
export const useStoreSaleFlow = ({
  orgId,
  local,
  mode,
  onScanned,
}: StoreSaleFlowOptions): StoreSaleFlow => {
  const { t, errorText } = useSalesText();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const show = useSnackbar();
  const refresh = useRefreshSales();
  const blockedText = useBlockedText();
  const [step, setStep] = useState<Step | null>(null);
  const close = () => {
    setStep(null);
  };

  const sell = useSellLotteryTicketsMutation(session.client, {
    onSuccess: (data) => {
      refresh();
      setStep(null);
      for (const row of data.sellLotteryTickets.items) {
        show(
          "success",
          t("sale.soldMessage", {
            key: row.ticketKey,
            amount: moneyText(row.amount),
            cashPoint: row.cashPoint.name,
          }),
          {
            title: t("sale.soldTitle"),
            ...(hasPermission(STORE_PERMISSIONS.undoSale) && {
              action: {
                label: t("sale.undo"),
                onClick: () => {
                  setStep({ kind: "undo", ticketId: row.ticketId });
                },
              },
            }),
          },
        );
      }
    },
    onError: (error) => {
      refresh();
      // 同時兩人賣同一張:失敗方看到「已於 hh:mm 售出」(第 17 章第 3 題)
      if (storeSalesErrorOf(error).code === "ALREADY_SOLD") {
        setStep({
          kind: "prompt",
          prompt: { kind: "blocked", item: null, message: errorText(error) },
        });
        return;
      }
      setStep(null);
      show("error", errorText(error));
    },
  });

  const sellItem = (item: ScanItem, confirmMove = false) => {
    if (local === null) {
      return;
    }
    sell.mutate({
      input: {
        orgId,
        localCashPointId: local.id,
        tickets: [{ ticketId: item.ticketId, version: item.version }],
        source: "scan",
        confirmMove,
      },
    });
  };

  const route = (item: ScanItem) => {
    onScanned?.(item);
    switch (item.outcome) {
      case "sell": {
        if (mode === "board") {
          sellItem(item);
        } else {
          setStep({ kind: "quick", item });
        }
        return;
      }
      case "sell_other_mine": {
        setStep({ kind: "prompt", prompt: { kind: "otherMine", item } });
        return;
      }
      case "move_and_sell": {
        setStep({ kind: "prompt", prompt: { kind: "move", item } });
        return;
      }
      case "unopened": {
        setStep(
          hasPermission(STORE_PERMISSIONS.split)
            ? { kind: "prompt", prompt: { kind: "unopened", item } }
            : { kind: "prompt", prompt: { kind: "info", item } },
        );
        return;
      }
      case "recover": {
        setStep(
          hasPermission(INVENTORY_PERMISSIONS.recover)
            ? { kind: "recover", item }
            : {
                kind: "prompt",
                prompt: {
                  kind: "blocked",
                  item,
                  message: t("scan.recoverNoPermission"),
                },
              },
        );
        return;
      }
      case "info_only": {
        setStep({ kind: "prompt", prompt: { kind: "info", item } });
        return;
      }
      default: {
        setStep({
          kind: "prompt",
          prompt: { kind: "blocked", item, message: blockedText(item) },
        });
      }
    }
  };

  const handleCode = (code: string) => {
    if (orgId === "" || sell.isPending) {
      return;
    }
    const variables = {
      input: { orgId, code, localCashPointId: local?.id ?? null },
    };
    void queryClient
      .fetchQuery<LotteryStoreScanQuery>({
        queryKey: useLotteryStoreScanQuery.getKey(variables),
        queryFn: useLotteryStoreScanQuery.fetcher(session.client, variables),
        staleTime: 0,
      })
      .then((data) => {
        const items = data.lotteryStoreScan.items;
        const first = items.at(0);
        if (first === undefined) {
          setStep({
            kind: "prompt",
            prompt: {
              kind: "blocked",
              item: null,
              message: t("scan.notFound"),
            },
          });
          return;
        }
        if (items.length > 1) {
          setStep({ kind: "prompt", prompt: { kind: "pick", items } });
          return;
        }
        route(first);
      })
      .catch((error: unknown) => {
        show("error", errorText(error));
      });
  };

  let element: ReactNode = null;
  switch (step?.kind) {
    case "prompt": {
      element = (
        <ScanOutcomeDialog
          prompt={step.prompt}
          localName={local?.name ?? ""}
          busy={sell.isPending}
          onClose={close}
          onPick={(item) => {
            route(item);
          }}
          onConfirm={(item) => {
            sellItem(item, item.outcome === "move_and_sell");
          }}
          onSplit={(item) => {
            setStep({
              kind: "split",
              bookId: item.bookId,
              code: rescanCodeOf(item),
            });
          }}
        />
      );
      break;
    }
    case "quick": {
      element = (
        <QuickSaleDialog
          item={step.item}
          busy={sell.isPending}
          onClose={close}
          onConfirm={(item) => {
            sellItem(item);
          }}
        />
      );
      break;
    }
    case "recover": {
      element = (
        <RecoverTicketDialog
          book={{
            gameCode: step.item.gameCode,
            gameName: step.item.gameName,
            unitPrice: step.item.unitPrice,
            bookNo: step.item.bookNo,
          }}
          tickets={[
            {
              id: step.item.ticketId,
              version: step.item.version,
              ticketNo: step.item.ticketNo,
              status: step.item.status,
            },
          ]}
          // 刷到的那家店 = 看板正在看的店(總部在看板操作某家店時,目前組織不是那家店)
          store={{ id: orgId }}
          onClose={close}
          onRecovered={refresh}
        />
      );
      break;
    }
    case "undo": {
      element = (
        <UndoSaleDialog
          ticketId={step.ticketId}
          orgId={orgId}
          onClose={close}
        />
      );
      break;
    }
    case "split": {
      const { code } = step;
      element = (
        <SplitWizardDialog
          orgId={orgId}
          bookId={step.bookId}
          local={local}
          onClose={close}
          onSplit={() => {
            setStep(null);
            // 拆好之後照刷條碼的流程把這張賣掉(錢算本機收銀點的班)
            handleCode(code);
          }}
        />
      );
      break;
    }
    case undefined: {
      break;
    }
  }

  return {
    handleCode,
    openUndo: (ticketId) => {
      setStep({ kind: "undo", ticketId });
    },
    element,
  };
};
