import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";

import type { ReasonValue } from "@/components/project/lottery/ReasonFields/reason-value";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";

import { moneyText } from "../store-text";
import { RecentRedemptionsDrawer } from "./RecentRedemptionsDrawer";
import { RedeemDialog } from "./RedeemDialog";
import { RedemptionDetailDialog } from "./RedemptionDetailDialog";
import { RevokeManagerDialog, RevokeSelfDialog } from "./RevokeDialogs";
import type { RedemptionRow } from "./redemption-shared";

/** 看板上兌獎要的那一班。 */
export interface RedemptionShift {
  orgId: string;
  shiftId: string;
  cashPointName: string;
  expectedCash: number;
}

type FlowDialog =
  | { kind: "redeem"; shift: RedemptionShift }
  | { kind: "detail"; id: string }
  | { kind: "revoke-self"; row: RedemptionRow }
  | { kind: "revoke-manager"; row: RedemptionRow }
  | { kind: "replace"; row: RedemptionRow; reason: ReasonValue };

export interface RedemptionFlow {
  /** 標題列 [兌獎] */
  openRedeem: (shift: RedemptionShift) => void;
  /** 標題列 [最近兌獎](抽屜;撤銷後不關) */
  openRecent: (
    shift: Pick<RedemptionShift, "shiftId" | "cashPointName">,
  ) => void;
  /** 兌獎紀錄分頁點一列 / 其他入口 */
  openDetail: (id: string) => void;
  /** 放在頁面裡(抽屜與視窗) */
  element: ReactNode;
}

/**
 * 兌獎的入口與視窗串接(規格 6.5;看板與兌獎紀錄分頁共用):兌獎成功 → 提示「已兌獎 RD-0219 · … [撤銷]」
 * (能自己撤銷時才有 [撤銷],直接開那一筆的確認視窗;**不**自動打開 [最近兌獎]);撤銷依 `revokeMode`
 * 開自己撤銷(ST-41)或店長撤銷(ST-39b);[撤銷並重新登記] 接著開兌獎視窗(同一班)。
 */
export const useRedemptionFlow = (): RedemptionFlow => {
  const t = useTranslations("admin.lotteryStore.redemption");
  const showSnackbar = useSnackbar();
  const [recent, setRecent] = useState<Pick<
    RedemptionShift,
    "shiftId" | "cashPointName"
  > | null>(null);
  const [dialog, setDialog] = useState<FlowDialog | null>(null);
  const close = () => {
    setDialog(null);
  };

  const revoke = (row: RedemptionRow) => {
    if (row.revokeMode === "self") {
      setDialog({ kind: "revoke-self", row });
    } else if (row.revokeMode === "manager") {
      setDialog({ kind: "revoke-manager", row });
    }
  };

  const redeemed = (row: RedemptionRow, cashPointName: string) => {
    close();
    showSnackbar(
      "success",
      t("successMessage", {
        serial: row.serialNo ?? "—",
        ticket: row.ticketLabel,
        amount: moneyText(row.prizeAmount),
        cashPoint: cashPointName,
      }),
      {
        title: t("successTitle"),
        ...(row.revokeMode === "self" && {
          action: {
            label: t("undo"),
            onClick: () => {
              revoke(row);
            },
          },
        }),
      },
    );
  };

  const dialogElement = (() => {
    switch (dialog?.kind) {
      case "redeem": {
        const { shift } = dialog;
        return (
          <RedeemDialog
            orgId={shift.orgId}
            shiftId={shift.shiftId}
            cashPointName={shift.cashPointName}
            expectedCash={shift.expectedCash}
            onClose={close}
            onDone={(row) => {
              redeemed(row, shift.cashPointName);
            }}
          />
        );
      }
      case "detail": {
        return (
          <RedemptionDetailDialog
            id={dialog.id}
            onClose={close}
            onRevoke={revoke}
          />
        );
      }
      case "revoke-self": {
        return <RevokeSelfDialog row={dialog.row} onClose={close} />;
      }
      case "revoke-manager": {
        const { row } = dialog;
        return (
          <RevokeManagerDialog
            row={row}
            onClose={close}
            onReplace={(reason) => {
              setDialog({ kind: "replace", row, reason });
            }}
          />
        );
      }
      case "replace": {
        const { row, reason } = dialog;
        return (
          <RedeemDialog
            orgId={row.orgId}
            shiftId={row.shift.id}
            cashPointName={row.cashPoint.name}
            expectedCash={null}
            replace={{ original: row, reason }}
            onClose={close}
            onDone={() => {
              close();
              showSnackbar("success", t("replaceSuccess"));
            }}
          />
        );
      }
      case undefined: {
        return null;
      }
    }
  })();

  return {
    openRedeem: (shift) => {
      setDialog({ kind: "redeem", shift });
    },
    openRecent: setRecent,
    openDetail: (id) => {
      setDialog({ kind: "detail", id });
    },
    element: (
      <>
        {recent === null ? null : (
          <RecentRedemptionsDrawer
            shiftId={recent.shiftId}
            cashPointName={recent.cashPointName}
            onClose={() => {
              setRecent(null);
            }}
            onRevoke={revoke}
            onOpen={(row) => {
              setDialog({ kind: "detail", id: row.id });
            }}
          />
        )}
        {dialogElement}
      </>
    ),
  };
};
