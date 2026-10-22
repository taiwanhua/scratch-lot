import { useTranslations } from "use-intl";

import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { PrintButton } from "@/components/base/PrintButton/PrintButton";
import { usePermissions } from "@/hooks/base/usePermissions";
import { PRINT_BUTTON_PERMISSIONS } from "@/lib/base/print-button";
import {
  type ReceiptKind,
  type ReceiptPayloads,
  receiptKindOf,
  receiptPrintRefOf,
} from "@/lib/project/lottery/receipts/receipt-kinds";

import { useReceiptPrinter } from "./useReceiptPrinter";

export interface ReceiptPrintButtonProps<Kind extends ReceiptKind> {
  kind: Kind;
  payload: ReceiptPayloads[Kind];
  /** 按鈕前的單據名稱(一頁有兩種單據時分得出是哪一張;例「調貨出貨單」);不給就只有按鈕 */
  label?: string | null;
}

/**
 * 單據頁的 [列印] / [補印](底座 `PrintButton`;已印次數、補印對話框、分店沒有印表機時變灰都是底座的):
 * 單據名稱 + 按鈕;按下時把 `kind` 這張單據排好版、轉圖送出。補印時單據上方印「【補印】第 N 次 · 時間 · 原因 · 補印人」。
 * 沒有 `api.printing.print` 時整個不渲染(連名稱都不出現)。
 */
export const ReceiptPrintButton = <Kind extends ReceiptKind>({
  kind,
  payload,
  label = null,
}: ReceiptPrintButtonProps<Kind>) => {
  const tRoot = useTranslations();
  const { hasPermission } = usePermissions();
  const printer = useReceiptPrinter();
  if (!hasPermission(PRINT_BUTTON_PERMISSIONS.print)) {
    return null;
  }
  const { i18n } = receiptKindOf(kind);
  const ref = receiptPrintRefOf(kind, payload, (key, values) =>
    tRoot(`${i18n}.${key}`, values),
  );
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      {label === null ? null : (
        <Typography
          variant="body2"
          color="textSecondary"
          sx={{ whiteSpace: "nowrap" }}
        >
          {label}
        </Typography>
      )}
      <PrintButton
        orgId={ref.orgId}
        documentType={ref.documentType}
        refType={ref.refType}
        refId={ref.refId}
        documentName={ref.documentName}
        defaultPrinterId={ref.defaultPrinterId}
        renderImage={(reprint) => printer.renderReceipt(kind, payload, reprint)}
      />
      {printer.host}
    </Stack>
  );
};
