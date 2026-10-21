import { CameraScanDialog } from "./CameraScanDialog";
import { RecentSalesDrawer } from "./RecentSalesDrawer";
import { SplitPickBookDialog } from "./SplitPickBookDialog";
import { SplitWizardDialog } from "./SplitWizardDialog";

/** 看板上銷售類的視窗(一次一個)。 */
export type SalesDialog =
  | { kind: "splitPick" }
  | { kind: "splitWizard"; bookId: string }
  | { kind: "recent"; shiftId: string; cashPointName: string }
  | { kind: "camera" };

export interface SalesBoardDialogsProps {
  dialog: SalesDialog | null;
  orgId: string;
  /** 本機收銀點(開班中);沒有 = null */
  local: { id: string; name: string } | null;
  onChange: (dialog: SalesDialog | null) => void;
  /** [最近售出] 每列的 [撤銷] */
  onUndo: (ticketId: string) => void;
}

/**
 * 看板的銷售類視窗:拆本(ST-37 選本 → ST-09 精靈)、[最近售出](ST-35b)、相機掃描。
 * 刷到時的對話框與撤銷確認在 `useStoreSaleFlow`。
 */
export const SalesBoardDialogs = ({
  dialog,
  orgId,
  local,
  onChange,
  onUndo,
}: SalesBoardDialogsProps) => {
  const close = () => {
    onChange(null);
  };
  switch (dialog?.kind) {
    case "splitPick": {
      return (
        <SplitPickBookDialog
          orgId={orgId}
          localName={local?.name ?? ""}
          onClose={close}
          onNext={(bookId) => {
            onChange({ kind: "splitWizard", bookId });
          }}
        />
      );
    }
    case "splitWizard": {
      return (
        <SplitWizardDialog
          orgId={orgId}
          bookId={dialog.bookId}
          local={local}
          onClose={close}
          onSplit={close}
        />
      );
    }
    case "recent": {
      return (
        <RecentSalesDrawer
          shiftId={dialog.shiftId}
          cashPointName={dialog.cashPointName}
          onClose={close}
          onUndo={onUndo}
        />
      );
    }
    case "camera": {
      return <CameraScanDialog onClose={close} />;
    }
    case undefined: {
      return null;
    }
  }
};
