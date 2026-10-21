import type { Ref } from "react";

import {
  Receipt58,
  Receipt58Divider,
  Receipt58Header,
  Receipt58Qr,
  Receipt58Range,
  type Receipt58ReprintMarkProps,
  Receipt58Row,
  Receipt58Signature,
  Receipt58Table,
  Receipt58Text,
  Receipt58Total,
} from "@repo/ui/receipt58";

import type {
  ReceiptBlock,
  ReceiptLayout,
} from "@/lib/project/lottery/receipts/receipt-layout";

export interface ReceiptDocumentProps {
  layout: ReceiptLayout;
  /** 最上層組織名稱(`me.currentOrg.tenantName`);不印分店名稱、不印平台名稱 */
  tenantName: string;
  /** 表頭右邊的時間(已依租戶時區格式化) */
  timeText: string;
  /** 補印標示(底座補印流程);第一次列印不給 */
  reprint?: Receipt58ReprintMarkProps;
  /** 交給 `renderReceiptToPng` 轉圖的節點 */
  ref?: Ref<HTMLDivElement>;
}

const Block = ({ block }: { block: ReceiptBlock }) => {
  switch (block.type) {
    case "row": {
      return <Receipt58Row label={block.label} value={block.value} />;
    }
    case "total": {
      return <Receipt58Total label={block.label} value={block.value} />;
    }
    case "table": {
      return (
        <Receipt58Table
          {...(block.head !== undefined && { head: block.head })}
          rows={block.rows}
        />
      );
    }
    case "range": {
      const { count } = block;
      return (
        <Receipt58Range
          label={block.label}
          numbers={block.numbers}
          {...(block.prefix !== undefined && { prefix: block.prefix })}
          {...(block.digits !== undefined && { digits: block.digits })}
          {...(count !== undefined && { formatCount: () => count })}
        />
      );
    }
    case "text": {
      return (
        <Receipt58Text
          variant={block.bold === true ? "bold" : "normal"}
          align={block.center === true ? "center" : "left"}
        >
          {block.text}
        </Receipt58Text>
      );
    }
    case "divider": {
      return <Receipt58Divider />;
    }
  }
};

/**
 * 一張 58mm 單據(專案規格第 12 章):把 `lib/project/lottery/receipts/` 排好的版面資料
 * 組成底座 B8 的版面零件 —— 表頭(租戶名稱、單據名稱、補印標示、單號與時間)、各區塊、QR code、簽名欄。
 * 預覽與列印用同一個元件。
 */
export const ReceiptDocument = ({
  layout,
  tenantName,
  timeText,
  reprint,
  ref,
}: ReceiptDocumentProps) => (
  <Receipt58 ref={ref}>
    <Receipt58Header
      tenantName={tenantName}
      title={layout.title}
      documentNo={layout.documentNo}
      time={timeText}
      {...(reprint !== undefined && { reprint })}
    />
    {layout.blocks.map((block, index) => (
      // 單據是一次性的快照,區塊沒有穩定 id;順序即身分
      <Block key={index} block={block} />
    ))}
    <Receipt58Qr value={layout.qr.value} caption={layout.qr.caption} />
    {layout.signatures.map((signer) => (
      <Receipt58Signature key={signer} signer={signer} />
    ))}
  </Receipt58>
);
