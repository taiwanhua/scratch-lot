import { formatNumberRanges } from "@repo/ui/receipt58";

/**
 * 58mm 單據的版面資料(專案規格第 12 章;底座 B8 版面零件 `@repo/ui/receipt58`):
 * 每張單據一支純函式把業務資料排成這份資料,畫面由 `components/project/lottery/ReceiptDocument`
 * 照它組 `Receipt58*` 零件 —— 版面只有一份、可以不經畫面直接比對(快照測試)。
 *
 * 共通的版面規則:單欄、「標籤:值」、表格最多三欄、號碼以區段表示、底部 QR code(這張單據在後台的連結)、
 * 上方租戶名稱(由畫面填)、補印標示(由畫面依底座補印流程填)。
 */

/** 表格一列最多三欄(`Receipt58Table`)。 */
export type ReceiptCells =
  | readonly [string]
  | readonly [string, string]
  | readonly [string, string, string];

export type ReceiptBlock =
  /** 「標籤:值」(`Receipt58Row`) */
  | { type: "row"; label: string; value: string }
  /** 合計(`Receipt58Total`) */
  | { type: "total"; label: string; value: string }
  /** 表格(`Receipt58Table`);`head` 不給就不印表頭 */
  | { type: "table"; head?: ReceiptCells; rows: readonly ReceiptCells[] }
  /** 號碼區段(`Receipt58Range`):連號以 `~` 連起來,`count` 是後面的筆數說明 */
  | {
      type: "range";
      label: string;
      numbers: readonly number[];
      prefix?: string;
      digits?: number;
      count?: string;
    }
  /** 一段文字(`Receipt58Text`) */
  | { type: "text"; text: string; bold?: boolean; center?: boolean }
  /** 虛線分隔(`Receipt58Divider`) */
  | { type: "divider" };

export interface ReceiptLayout {
  /** 單據名稱(例「進貨點收單」) */
  title: string;
  /** 單號那一格(例「單號 P-0031」) */
  documentNo: string;
  /** 單號右邊的時間(ISO 時點;畫面依租戶時區以 `formatTemporal` 顯示) */
  time: string;
  blocks: readonly ReceiptBlock[];
  /** 底部 QR code:內容 = 這張單據在後台的連結 */
  qr: { value: string; caption: string };
  /** 簽名欄(由上而下) */
  signatures: readonly string[];
}

/** 單據文案的翻譯函式(各張單據自己的 namespace;由畫面傳入)。 */
export type ReceiptTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/** 金額 / 張數的千分位。 */
export const receiptMoney = (value: number): string =>
  value.toLocaleString("en-US");

/** 本號顯示:存的是 7 位(開頭補 0),單據上去掉補的 0(與點收區塊同)。 */
export const receiptBookNo = (bookNo: string): string =>
  bookNo.startsWith("0") ? bookNo.slice(1) : bookNo;

/**
 * 把本號清單寫成區段資料:位數取最長的那一本(本號都是數字;開頭的 0 靠補位數印回來)。
 * 不是數字的本號(不該出現)直接略過。
 */
export const bookNumbersOf = (
  bookNos: readonly string[],
): { numbers: number[]; digits: number } => {
  const shown = bookNos
    .map((no) => receiptBookNo(no))
    .filter((no) => /^\d+$/.test(no));
  return {
    numbers: shown.map(Number),
    digits: Math.max(0, ...shown.map((no) => no.length)),
  };
};

/** 一個區塊的文字行(快照用)。 */
const blockLinesOf = (block: ReceiptBlock): string[] => {
  switch (block.type) {
    case "row": {
      return [`${block.label} | ${block.value}`];
    }
    case "total": {
      return [`[合計] ${block.label} | ${block.value}`];
    }
    case "table": {
      return [
        ...(block.head === undefined
          ? []
          : [`[表頭] ${block.head.join(" | ")}`]),
        ...block.rows.map((row) => row.join(" | ")),
      ];
    }
    case "range": {
      const ranges = formatNumberRanges(block.numbers, {
        ...(block.prefix !== undefined && { prefix: block.prefix }),
        ...(block.digits !== undefined && { digits: block.digits }),
      });
      return [`${block.label}${ranges}${block.count ?? ""}`];
    }
    case "text": {
      return [block.text];
    }
    case "divider": {
      return ["----"];
    }
  }
};

/**
 * 版面的文字快照:每一行一個字串,依序是表頭、各區塊、QR code、簽名欄。
 * 給快照測試與除錯用,和畫面用的是同一份版面資料。
 */
export const receiptLinesOf = (
  layout: ReceiptLayout,
  header: { tenantName: string; time: string; reprint?: string | null },
): string[] => [
  header.tenantName,
  layout.title,
  ...(header.reprint === undefined || header.reprint === null
    ? []
    : [header.reprint]),
  `${layout.documentNo} | ${header.time}`,
  ...layout.blocks.flatMap((block) => blockLinesOf(block)),
  `[QR] ${layout.qr.value}`,
  layout.qr.caption,
  ...layout.signatures.map((signer) => `[簽名] ${signer}`),
];
