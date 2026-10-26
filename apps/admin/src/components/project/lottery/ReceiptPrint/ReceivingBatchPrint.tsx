import { useState } from "react";
import { useTranslations } from "use-intl";

import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";

import { useTemporalText } from "@/hooks/base/useTemporalText";
import type {
  ReceiptKind,
  ReceiptPayloads,
} from "@/lib/project/lottery/receipts/receipt-kinds";

import { ReceiptPrintButton } from "./ReceiptPrintButton";

/** 一次點收([完成這次點收] 的點收批次)。 */
export interface ReceivingBatch {
  batchId: string;
  no: number;
  completedAt: string;
  rowIds: readonly string[];
}

export interface ReceivingBatchPrintProps<Kind extends ReceiptKind> {
  kind: Kind;
  /** 每一次點收(由舊到新) */
  batches: readonly ReceivingBatch[];
  /** 已點收幾列(沒有任何點收批次的舊資料:有點收過才出現按鈕) */
  receivedCount: number;
  /** 選的那一次點收 → 單據資料(`null` = 沒有點收批次的舊資料:印到目前為止已點收的全部) */
  payloadOf: (batch: ReceivingBatch | null) => ReceiptPayloads[Kind];
  /** 按鈕前的單據名稱(一頁有好幾種單據時);不給就只有按鈕 */
  label?: string | null;
}

/**
 * 點收單(進貨點收單、調貨點收單)的標頭 [列印] / [補印]:補印和原單一致 —— 一次點收([完成這次點收] 的點收批次)
 * 一張單據,照那一次的列重排版、已印次數以那一次計。點收過兩次以上時,按鈕前多一個「點收批次」選單(預設最近一次)。
 * 還沒有任何點收批次(批次功能之前點收的舊資料)時印到目前為止已點收的全部;一列都沒點收 → 不出現。
 */
export const ReceivingBatchPrint = <Kind extends ReceiptKind>({
  kind,
  batches,
  receivedCount,
  payloadOf,
  label = null,
}: ReceivingBatchPrintProps<Kind>) => {
  const t = useTranslations("admin.lotteryPurchasing.receipts");
  const temporalText = useTemporalText();
  const [chosen, setChosen] = useState<string | null>(null);
  const batch =
    batches.find((item) => item.batchId === chosen) ?? batches.at(-1) ?? null;
  if (batch === null && receivedCount === 0) {
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
        kind={kind}
        payload={payloadOf(batch)}
        label={label}
      />
    </Stack>
  );
};
