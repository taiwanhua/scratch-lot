import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import type { LotteryStoreShiftFieldsFragment } from "@repo/graphql";

import { useReceiptLinks } from "@/components/project/lottery/ReceiptPrint/useReceiptLinks";
import { useReceiptPrinter } from "@/components/project/lottery/ReceiptPrint/useReceiptPrinter";
import { logReceiptPrintFailure } from "@/lib/project/lottery/receipts/receipt-log";

import { type CashMoveCommitted, CashMoveDialog } from "./CashMoveDialog";
import type { BoardCashPoint } from "./CashPointSection";
import { LocalCashPointDialog } from "./LocalCashPointDialog";
import { OpenShiftDialog, type OpeningFloatCommitted } from "./OpenShiftDialog";
import { ShiftInfoDialog } from "./ShiftInfoDialog";
import { SwitchCashPointDialog } from "./SwitchCashPointDialog";

/** 看板上開著的對話框(一次一個)。 */
export type BoardDialog =
  | { kind: "local" }
  | { kind: "switch"; to: BoardCashPoint }
  | { kind: "open"; cashPoint: BoardCashPoint }
  | { kind: "info"; shiftId: string }
  | {
      kind: "deposit" | "withdraw";
      shift: LotteryStoreShiftFieldsFragment;
      cashPointName: string;
    };

export interface BoardDialogsProps {
  /** 看板的分店(投庫單 / 出庫單上的分店、印表機選單) */
  org: { id: string; name: string } | null;
  dialog: BoardDialog | null;
  cashPoints: readonly BoardCashPoint[];
  local: BoardCashPoint | null;
  vaultExpected: number;
  onClose: () => void;
  /** 設定本機收銀點的對話框按 [儲存] */
  onPickLocal: (cashPointId: string) => void;
  /** 切換確認按 [切換到…] */
  onConfirmSwitch: (cashPointId: string) => void;
}

/**
 * 看板的對話框:設定本機收銀點、切換確認、開班、班次資訊 / 改對應排班、投庫 / 出庫。
 * 投庫、出庫、開班領零用金寫入成功 → 自動印 58mm 投庫單 / 出庫單(規格第 12 章;`printReceiptAfterCommit`,
 * 失敗只記 log)。轉圖節點(`host`)放在這裡而不是對話框裡:對話框一成功就關掉。
 */
export const BoardDialogs = (props: BoardDialogsProps) => {
  const t = useTranslations("admin.lotteryStore.receipts");
  const { printReceiptAfterCommit, host } = useReceiptPrinter();
  const { fetchLinks } = useReceiptLinks();
  const { org } = props;
  const printCashMove = (cashPointName: string, done: CashMoveCommitted) => {
    if (org === null) {
      return;
    }
    const print = async () => {
      const { cashLedgerUrl } = await fetchLinks();
      const base = {
        movementId: done.movementId,
        branchId: org.id,
        branchName: org.name,
        cashPointName,
        amount: done.amount,
        note: done.note,
        defaultPrinterId: done.cashPointPrinterId,
        url: cashLedgerUrl(done.movementId),
      };
      await (done.kind === "deposit"
        ? printReceiptAfterCommit("store-vault-deposit", base)
        : printReceiptAfterCommit("store-vault-withdraw", {
            ...base,
            reasonLabel: done.reasonLabel,
          }));
    };
    // 讀不到 QR 的路由:不印,只記 log(列印是交易後的附帶動作)
    print().catch((error: unknown) => {
      logReceiptPrintFailure("links failed", { kind: done.kind, error });
    });
  };
  const printOpeningFloat = (
    cashPointName: string,
    done: OpeningFloatCommitted,
  ) => {
    printCashMove(cashPointName, {
      kind: "withdraw",
      movementId: done.movementId,
      cashPointPrinterId: done.cashPointPrinterId,
      amount: done.amount,
      note: null,
      reasonLabel: t("vaultWithdraw.openingFloat"),
    });
  };
  return (
    <>
      <BoardDialogBody
        {...props}
        onCashMoved={printCashMove}
        onFloatTaken={printOpeningFloat}
      />
      {host}
    </>
  );
};

const BoardDialogBody = ({
  dialog,
  cashPoints,
  local,
  vaultExpected,
  onClose,
  onPickLocal,
  onConfirmSwitch,
  onCashMoved,
  onFloatTaken,
}: BoardDialogsProps & {
  onCashMoved: (cashPointName: string, done: CashMoveCommitted) => void;
  onFloatTaken: (cashPointName: string, done: OpeningFloatCommitted) => void;
}): ReactNode => {
  switch (dialog?.kind) {
    case "local": {
      return (
        <LocalCashPointDialog
          cashPoints={cashPoints}
          value={local?.id ?? null}
          onClose={onClose}
          onSave={onPickLocal}
        />
      );
    }
    case "switch": {
      return (
        <SwitchCashPointDialog
          from={local?.name ?? ""}
          to={dialog.to.name}
          onClose={onClose}
          onConfirm={() => {
            onConfirmSwitch(dialog.to.id);
          }}
        />
      );
    }
    case "open": {
      return (
        <OpenShiftDialog
          cashPointId={dialog.cashPoint.id}
          cashPointName={dialog.cashPoint.name}
          onClose={onClose}
          onFloatTaken={(done) => {
            onFloatTaken(dialog.cashPoint.name, done);
          }}
        />
      );
    }
    case "info": {
      return <ShiftInfoDialog shiftId={dialog.shiftId} onClose={onClose} />;
    }
    case "deposit":
    case "withdraw": {
      return (
        <CashMoveDialog
          kind={dialog.kind}
          shift={dialog.shift}
          cashPointName={dialog.cashPointName}
          vaultExpected={vaultExpected}
          onClose={onClose}
          onCommitted={(done) => {
            onCashMoved(dialog.cashPointName, done);
          }}
        />
      );
    }
    case undefined: {
      return null;
    }
  }
};
