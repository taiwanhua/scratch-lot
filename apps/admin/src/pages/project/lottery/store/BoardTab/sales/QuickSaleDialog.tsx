import { useEffect, useEffectEvent } from "react";

import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { moneyText } from "../../store-text";
import { ScanTicketSummary } from "./ScanTicketSummary";
import type { ScanItem } from "./scan-place";
import { useSalesText } from "./useSalesText";

export interface QuickSaleDialogProps {
  item: ScanItem;
  busy: boolean;
  onClose: () => void;
  onConfirm: (item: ScanItem) => void;
}

/**
 * 快速銷售(Figma ST-06;規格 6.3):沒有頁面宣告掃描用途時刷到刮刮樂開這個小視窗。
 * Enter 確認售出、Esc 取消;錢算在本機收銀點的班。
 */
export const QuickSaleDialog = ({
  item,
  busy,
  onClose,
  onConfirm,
}: QuickSaleDialogProps) => {
  const { t } = useSalesText();
  const onEnter = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Enter" && !busy) {
      event.preventDefault();
      onConfirm(item);
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      onEnter(event);
    };
    globalThis.addEventListener("keydown", listener);
    return () => {
      globalThis.removeEventListener("keydown", listener);
    };
  }, []);
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={t("quickSale.title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("quickSale.cancel")}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              onConfirm(item);
            }}
          >
            {t("quickSale.confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.5}>
        <ScanTicketSummary item={item} />
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          <Typography variant="body2" color="text.secondary">
            {t("quickSale.cashPoint")}
          </Typography>
          <Typography variant="body1">
            {t("quickSale.cashPointValue", {
              name: item.cashPoint?.name ?? "",
            })}
          </Typography>
        </Stack>
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          <Typography variant="body2" color="text.secondary">
            {t("quickSale.amount")}
          </Typography>
          <Typography variant="subtitle1">
            {moneyText(item.unitPrice)}
          </Typography>
        </Stack>
      </Stack>
    </Dialog>
  );
};
