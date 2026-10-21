import type { LotteryStoreShiftFieldsFragment } from "@repo/graphql";

import { CashMoveDialog } from "./CashMoveDialog";
import type { BoardCashPoint } from "./CashPointSection";
import { LocalCashPointDialog } from "./LocalCashPointDialog";
import { OpenShiftDialog } from "./OpenShiftDialog";
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

/** 看板的對話框:設定本機收銀點、切換確認、開班、班次資訊 / 改對應排班、投庫 / 出庫。 */
export const BoardDialogs = ({
  dialog,
  cashPoints,
  local,
  vaultExpected,
  onClose,
  onPickLocal,
  onConfirmSwitch,
}: BoardDialogsProps) => {
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
        />
      );
    }
    case undefined: {
      return null;
    }
  }
};
