import { useEffect, useRef, useState } from "react";

import { Box } from "@repo/ui/box";
import type { Receipt58ReprintMarkProps } from "@repo/ui/receipt58";

import type { PrintReprintMark } from "@/components/base/PrintButton/PrintButton";
import { receiptPngOf } from "@/lib/project/lottery/receipts/receipt-image";
import type { ReceiptLayout } from "@/lib/project/lottery/receipts/receipt-layout";

import { ReceiptDocument } from "./ReceiptDocument";

/** 一次排隊等轉圖的列印(`useReceiptPrinter` 的佇列):一聯或好幾聯(依序接成一張圖)。 */
export interface PendingRender {
  id: number;
  layouts: readonly ReceiptLayout[];
  reprint: PrintReprintMark | null;
  resolve: (png: Blob) => void;
  reject: (error: unknown) => void;
}

/**
 * 一次要轉圖的列印:掛上之後轉成**一張** PNG,交回等待中的那一個 promise。
 * 好幾聯時各聯由上而下排、聯與聯之間是切紙位置(`Receipt58Cut`;代理程式在那裡切紙)——一個列印工作。
 */
export const PendingReceipt = ({
  item,
  tenantName,
  timeTextOf,
  reprint,
  onDone,
}: {
  item: PendingRender;
  tenantName: string;
  /** 表頭右邊的時間(ISO 時點 → 依租戶時區的文字) */
  timeTextOf: (time: string) => string;
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
    // 寬度跟著單據(384 點),不撐滿外層
    <Box ref={setNode} sx={{ width: "fit-content" }}>
      {item.layouts.map((layout, index) => (
        <ReceiptDocument
          // 同一次列印的各聯順序固定;順序即身分
          key={index}
          layout={layout}
          tenantName={tenantName}
          timeText={timeTextOf(layout.time)}
          cutAfter={index < item.layouts.length - 1}
          {...(reprint !== undefined && { reprint })}
        />
      ))}
    </Box>
  );
};
