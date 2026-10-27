import type { ReactNode, Ref } from "react";

import { Box } from "@repo/ui/box";
import {
  Receipt58,
  Receipt58Cut,
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
  /** 一次列印好幾聯時,這一聯後面接著下一聯:最後印切紙位置(代理程式在這裡切紙) */
  cutAfter?: boolean;
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
 * 單據名稱;多聯的單據在名稱下方印聯別(例「第 1 聯 · 店鋪留存」);
 * 有標示(例「待核准」)時在名稱下方加一個框(Figma RC-09)。
 * 表頭零件的名稱在一個 `<p>` 裡,聯別與標示換行接在後面(標示是 inline-block 的 `<span>`)。
 */
const titleOf = (layout: ReceiptLayout): ReactNode =>
  layout.stamp == null && layout.copy == null ? (
    layout.title
  ) : (
    <>
      {layout.title}
      {layout.copy == null ? null : (
        <>
          <br />
          {layout.copy}
        </>
      )}
      {layout.stamp == null ? null : (
        <>
          <br />
          <Box
            component="span"
            sx={{
              display: "inline-block",
              mt: "4px",
              px: "8px",
              border: "2px solid currentColor",
            }}
          >
            {layout.stamp}
          </Box>
        </>
      )}
    </>
  );

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
  cutAfter = false,
}: ReceiptDocumentProps) => (
  <Receipt58 ref={ref}>
    <Receipt58Header
      tenantName={tenantName}
      title={titleOf(layout)}
      documentNo={layout.documentNo}
      time={timeText}
      {...(reprint !== undefined && { reprint })}
    />
    {layout.blocks.map((block, index) => (
      // 單據是一次性的快照,區塊沒有穩定 id;順序即身分
      <Block key={index} block={block} />
    ))}
    {/* 沒有連結 → 照印、不印 QR */}
    {layout.qr !== null && (
      <Receipt58Qr value={layout.qr.value} caption={layout.qr.caption} />
    )}
    {layout.signatures.map((signer) => (
      <Receipt58Signature key={signer} signer={signer} />
    ))}
    {/* 聯與聯之間:不另寫文字(切紙虛線本身就是撕線;舊版代理程式不切時照這條撕) */}
    {cutAfter && <Receipt58Cut label="" />}
  </Receipt58>
);
