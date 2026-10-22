import { useState } from "react";
import { useTranslations } from "use-intl";

import type {
  FormSubmissionFieldsFragment,
  LotteryPurchaseReceivingFieldsFragment,
} from "@repo/graphql";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";

import { ReceiptPrintButton } from "@/components/project/lottery/ReceiptPrint/ReceiptPrintButton";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { purchaseReceivingInputOf } from "@/lib/project/lottery/receipts/purchase-receiving-receipt";

export interface PurchaseReceiptPrintProps {
  submission: FormSubmissionFieldsFragment;
  receiving: LotteryPurchaseReceivingFieldsFragment;
  /** 這張進貨單在後台的連結(QR code) */
  url: string;
}

/**
 * 標頭的 [列印] / [補印] 進貨點收單:補印和原單一致 —— 一次點收([完成這次點收] 的點收批次)一張,
 * 照那一次的本重排版、已印次數以那一次計。點收過兩次以上時,按鈕前多一個「點收批次」選單(預設最近一次)。
 * 還沒有任何點收批次(批次功能之前點收的舊資料)時印到目前為止已點收的全部本;一本都沒點收 → 不出現。
 */
export const PurchaseReceiptPrint = ({
  submission,
  receiving,
  url,
}: PurchaseReceiptPrintProps) => {
  const t = useTranslations("admin.lotteryPurchasing.receipts");
  const temporalText = useTemporalText();
  const { batches } = receiving;
  const [chosen, setChosen] = useState<string | null>(null);
  const batch =
    batches.find((item) => item.batchId === chosen) ?? batches.at(-1) ?? null;
  if (batch === null && receiving.receivedCount === 0) {
    return null;
  }
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      {batches.length > 1 && batch !== null && (
        <SelectField
          label={t("batchSelect")}
          size="small"
          value={batch.batchId}
          options={batches.map((item) => ({
            value: item.batchId,
            label: t("batchOption", {
              no: item.no,
              time: temporalText(item.completedAt, "monthDayTime"),
            }),
          }))}
          onChange={setChosen}
        />
      )}
      <ReceiptPrintButton
        kind="purchase-receiving"
        payload={purchaseReceivingInputOf(submission, receiving, batch, url)}
      />
    </Stack>
  );
};
