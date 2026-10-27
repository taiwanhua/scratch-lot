import { describe, expect, it } from "@jest/globals";
import { createTranslator } from "use-intl";

import { composeProjectMessages } from "@repo/i18n";
import { projectPublic } from "@repo/project-config/public";

import { PURCHASING_RECEIPTS_I18N } from "./purchase-receiving-receipt";
import { receiptLayoutsOf, receiptPrintRefOf } from "./receipt-kinds";
import { type ReceiptTranslator, receiptLinesOf } from "./receipt-layout";
import type { TransferReceivingReceiptInput } from "./transfer-receiving-receipt";

/** 真的字典(與畫面同一份):單據上的字就是租戶會看到的字。 */
const messages = composeProjectMessages({
  brandName: projectPublic.brand.name,
  frontMetadata: projectPublic.front.metadata,
})["zh-TW"];
const tRoot = createTranslator({ locale: "zh-TW", messages });
const t: ReceiptTranslator = (key, values) =>
  tRoot(`${PURCHASING_RECEIPTS_I18N}.${key}` as never, values as never);

const NOW = "2026-10-12T06:05:00.000Z";
const HEADER = { tenantName: "好運彩券行", time: "2026-10-12 14:05" };

/** 調貨單 T-0008 的點收:5164 兩本整本 + 一本選張(#090~099),這次點收整本 056527 與選張那一列。 */
const transferReceiving: TransferReceivingReceiptInput = {
  submissionId: "doc-t8",
  serialNo: "T-0008",
  toBranchId: "org-hsinchu",
  fromBranchName: "中山店",
  toBranchName: "新竹店",
  groups: [
    {
      gameCode: "5164",
      gameName: "發大財",
      rows: [
        {
          rowId: "t1",
          bookNo: "0056527",
          mode: "whole",
          ticketNos: [],
          tickets: 100,
          received: true,
          receivedTickets: 100,
          receivedTicketNos: Array.from({ length: 100 }, (_, index) =>
            String(index + 1).padStart(3, "0"),
          ),
        },
        {
          rowId: "t2",
          bookNo: "0056528",
          mode: "whole",
          ticketNos: [],
          tickets: 100,
          received: false,
          receivedTickets: 0,
          receivedTicketNos: [],
        },
        {
          rowId: "t3",
          bookNo: "0056529",
          mode: "partial",
          ticketNos: [
            "090",
            "091",
            "092",
            "093",
            "094",
            "095",
            "096",
            "097",
            "098",
            "099",
          ],
          tickets: 10,
          // 選張的列逐張點收:這一次只到了 5 張
          received: false,
          receivedTickets: 5,
          receivedTicketNos: ["090", "091", "092", "093", "094"],
        },
      ],
    },
  ],
  batch: {
    batchId: "tbatch-1",
    no: 1,
    rowIds: ["t1", "t3"],
    rows: [
      { rowId: "t1", ticketNos: [] },
      { rowId: "t3", ticketNos: ["090", "091", "092", "093", "094"] },
    ],
  },
  url: "https://admin.example/purchasing/transfer/view-page/doc-t8",
};

describe("調貨點收單(規格第 12 章、8.4;Figma RC-10 待補)", () => {
  it("調貨點收單:兩聯(收貨店留存、送貨人留存);出貨店 → 收貨店、第 N 次點收、遊戲 / 本數 / 點收、整本寫本號、選張寫號碼區段(照這一次點收的張)、尚未到的本(選張的列寫還沒到的張);簽名欄 點收人、送貨人", () => {
    const copies = receiptLayoutsOf(
      "transfer-receiving",
      transferReceiving,
      t,
      NOW,
    );

    expect(copies).toHaveLength(2);
    expect(receiptLinesOf(copies[0], HEADER)).toEqual([
      "好運彩券行",
      "調貨點收單",
      "[聯別] 第 1 聯 · 收貨店留存",
      "單號 T-0008 | 2026-10-12 14:05",
      "----",
      "出貨店 → 收貨店 | 中山店 → 新竹店",
      "----",
      "第 1 次點收(2 本)",
      "[表頭] 遊戲 | 本數 | 點收",
      "5164 發大財 | 2 | 1 / 3",
      "本號:056527",
      "056529 號碼:#090~094(5 張)",
      "----",
      "尚未到的本(2 本)",
      "5164 發大財 | 2",
      "本號:056528",
      // 選張的列只到部分張:尚未到的寫還沒點收的張
      "056529 號碼:#095~099(5 張)",
      "----",
      `[QR] ${transferReceiving.url}`,
      "掃描開啟單據",
      "[簽名] 點收人簽名",
      "[簽名] 送貨人簽名",
    ]);
    expect(receiptLinesOf(copies[1], HEADER)[2]).toBe(
      "[聯別] 第 2 聯 · 送貨人留存",
    );
    expect(
      receiptPrintRefOf("transfer-receiving", transferReceiving, t),
    ).toEqual({
      orgId: "org-hsinchu",
      documentType: "lottery-transfer-receiving",
      refType: "lottery-transfer-receiving",
      refId: "tbatch-1",
      documentName: "調貨點收單 T-0008(兩聯)",
      defaultPrinterId: null,
    });
  });
});
