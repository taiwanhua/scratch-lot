import { useEffect, useRef, useState } from "react";

import type { Receipt58ReprintMarkProps } from "@repo/ui/receipt58";

import type { PrintReprintMark } from "@/components/base/PrintButton/PrintButton";
import { receiptPngOf } from "@/lib/project/lottery/receipts/receipt-image";
import type { ReceiptLayout } from "@/lib/project/lottery/receipts/receipt-layout";

import { ReceiptDocument } from "./ReceiptDocument";

/** 一張排隊等轉圖的單據(`useReceiptPrinter` 的佇列)。 */
export interface PendingRender {
  id: number;
  layout: ReceiptLayout;
  reprint: PrintReprintMark | null;
  resolve: (png: Blob) => void;
  reject: (error: unknown) => void;
}

/** 一張要轉圖的單據:掛上之後轉成 PNG,交回等待中的那一個 promise。 */
export const PendingReceipt = ({
  item,
  tenantName,
  timeText,
  reprint,
  onDone,
}: {
  item: PendingRender;
  tenantName: string;
  timeText: string;
  reprint: Receipt58ReprintMarkProps | undefined;
  onDone: (id: number) => void;
}) => {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  // StrictMode 會把 effect 跑兩次:同一張只轉一次
  const started = useRef(false);
  useEffect(() => {
    if (node === null || started.current) {
      return;
    }
    started.current = true;
    receiptPngOf(node)
      .then(item.resolve, item.reject)
      .finally(() => {
        onDone(item.id);
      });
  }, [item, node, onDone]);
  return (
    <ReceiptDocument
      ref={setNode}
      layout={item.layout}
      tenantName={tenantName}
      timeText={timeText}
      {...(reprint !== undefined && { reprint })}
    />
  );
};
