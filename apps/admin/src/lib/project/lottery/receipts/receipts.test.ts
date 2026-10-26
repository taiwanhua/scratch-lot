import { describe, expect, it } from "@jest/globals";
import { createTranslator } from "use-intl";

import { TRANSFER_SETTLEMENT_SIDE } from "@repo/domain/project/lottery";
import type { LotterySettlementFieldsFragment } from "@repo/graphql";
import { composeProjectMessages } from "@repo/i18n";
import { projectPublic } from "@repo/project-config/public";

import {
  PURCHASING_RECEIPTS_I18N,
  type PurchaseReceivingReceiptInput,
} from "./purchase-receiving-receipt";
import {
  RECEIPT_KINDS,
  receiptDocumentNameOf,
  receiptLayoutsOf,
  receiptPrintRefOf,
  receiptReprintVariantsOf,
} from "./receipt-kinds";
import { type ReceiptTranslator, receiptLinesOf } from "./receipt-layout";
import {
  latestTransferPaymentInputOf,
  transferPaymentInputOf,
} from "./transfer-payment-receipt";
import type { TransferShipmentReceiptInput } from "./transfer-shipment-receipt";

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
const URL = "https://admin.example/purchasing/purchase/view-page/doc-p31";

/** 進貨單 P-0031:5201 三本、5164 兩本(單上 5 本;這次刷了 5201 的 060113~060115)。 */
const purchase: PurchaseReceivingReceiptInput = {
  submissionId: "doc-p31",
  serialNo: "P-0031",
  branchId: "org-store",
  branchName: "中山店",
  dealerLabel: "陳志明 12345678",
  groups: [
    {
      gameCode: "5201",
      gameName: "金好運",
      rows: [
        { rowId: "r1", bookNo: "0060113", received: true },
        { rowId: "r2", bookNo: "0060114", received: true },
        { rowId: "r3", bookNo: "0060115", received: true },
      ],
    },
    {
      gameCode: "5164",
      gameName: "發大財",
      rows: [
        { rowId: "r4", bookNo: "0056529", received: true },
        { rowId: "r5", bookNo: "0056530", received: false },
      ],
    },
  ],
  batch: { batchId: "batch-1", no: 1, rowIds: ["r1", "r2", "r3"] },
  url: URL,
};

const shipment: TransferShipmentReceiptInput = {
  submissionId: "doc-t8",
  serialNo: "T-0008",
  fromBranchId: "org-store",
  fromBranchName: "中山店",
  toBranchName: "新竹店",
  rows: [
    {
      gameCode: "5164",
      bookNo: "0056527",
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
      amount: 2000,
    },
  ],
  transferAmount: 1840,
  url: "https://admin.example/purchasing/transfer/view-page/doc-t8",
};

const settlement = (
  records: Partial<LotterySettlementFieldsFragment["records"][number]>[],
): LotterySettlementFieldsFragment => ({
  moduleKey: "purchasing.transfer",
  label: "調貨單",
  kind: "transfer",
  refId: "doc-t8",
  docNo: "T-0008",
  counterparty: "中山店",
  payable: 1840,
  pendingPayee: 0,
  sides: [
    {
      side: TRANSFER_SETTLEMENT_SIDE.receiver,
      label: "收貨店",
      role: "payer",
      methods: ["bank", "cash"],
      branch: { id: "org-hsinchu", name: "新竹店" },
      totalOut: 1840,
      totalIn: 0,
      net: 1840,
      canSettle: true,
      cashDrawers: [],
      buttons: [],
    },
  ],
  records: records.map((record, index) => ({
    id: `rec-${String(index + 1)}`,
    method: "cash",
    side: TRANSFER_SETTLEMENT_SIDE.receiver,
    type: "transfer_out",
    direction: "out",
    amount: 1840,
    accountLabel: null,
    cashPlace: "drawer",
    cashPointName: null,
    cashPointPrinterId: null,
    handler: "王小明(送貨人)",
    note: null,
    occurredAt: "2026-10-16T11:05:00.000Z",
    createdBy: null,
    reversalOf: null,
    reversedById: null,
    canReverse: true,
    ...record,
  })),
});

describe("58mm 單據的版面(規格第 12 章;Figma RC-06、RC-07、RC-08、RC-10)", () => {
  it("進貨點收單:一次列印兩聯(第 1 聯 店鋪留存、第 2 聯 送貨人留存,名稱下方印聯別),列這次點收的本 + 尚未到的本;簽名欄 點收人、送貨人", () => {
    const copies = receiptLayoutsOf("purchase-receiving", purchase, t, NOW);

    expect(copies).toHaveLength(2);
    expect(receiptLinesOf(copies[0], HEADER)).toEqual([
      "好運彩券行",
      "進貨點收單",
      "[聯別] 第 1 聯 · 店鋪留存",
      "單號 P-0031 | 2026-10-12 14:05",
      "----",
      "進貨分店 | 中山店",
      "甲類 | 陳志明 12345678",
      "----",
      "第 1 次點收(3 本)",
      "[表頭] 遊戲 | 本數 | 點收",
      "5201 金好運 | 3 | 3 / 3",
      "本號:060113~060115",
      "----",
      "尚未到的本(1 本)",
      "5164 發大財 | 1",
      "本號:056530",
      "----",
      `[QR] ${URL}`,
      "掃描開啟單據",
      "[簽名] 點收人簽名",
      "[簽名] 送貨人簽名",
    ]);
    expect(receiptLinesOf(copies[1], HEADER)[2]).toBe(
      "[聯別] 第 2 聯 · 送貨人留存",
    );
    expect(copies[0].time).toBe(NOW);
  });

  it("多聯的單據:補印可選全部(預設)或其中一聯;列印紀錄的名稱寫聯別、補印標「補印」;一聯的單據不多選單", () => {
    expect(
      receiptLayoutsOf("purchase-receiving", purchase, t, NOW, "courier").map(
        (layout) => layout.copy,
      ),
    ).toEqual(["第 2 聯 · 送貨人留存"]);
    expect(receiptReprintVariantsOf("purchase-receiving", t)).toEqual({
      label: "補印哪一聯",
      options: [
        { value: "all", label: "兩聯都補" },
        { value: "store", label: "第 1 聯 · 店鋪留存" },
        { value: "courier", label: "第 2 聯 · 送貨人留存" },
      ],
    });
    expect(receiptDocumentNameOf("purchase-receiving", purchase, t)).toBe(
      "進貨點收單 P-0031(兩聯)",
    );
    expect(
      receiptDocumentNameOf("purchase-receiving", purchase, t, {
        which: "courier",
        isReprint: true,
      }),
    ).toBe("進貨點收單 P-0031(送貨人留存)補印");
    expect(
      receiptDocumentNameOf("purchase-receiving", purchase, t, {
        isReprint: true,
      }),
    ).toBe("進貨點收單 P-0031(兩聯)補印");
    expect(receiptReprintVariantsOf("store-daily-close", t)).toBeNull();
  });

  it("進貨點收單:全部到齊時「尚未到的本:無」;沒有點收批次的舊資料 → 列到目前為止已點收的全部本,以進貨單計次數", () => {
    const allReceived: PurchaseReceivingReceiptInput = {
      ...purchase,
      groups: purchase.groups.map((group) => ({
        ...group,
        rows: group.rows.map((row) => ({ ...row, received: true })),
      })),
      batch: null,
    };

    const lines = receiptLinesOf(
      RECEIPT_KINDS["purchase-receiving"].layoutOf(allReceived, t, NOW),
      HEADER,
    );

    expect(lines.slice(3, 15)).toEqual([
      "----",
      "進貨分店 | 中山店",
      "甲類 | 陳志明 12345678",
      "----",
      "已點收(5 本)",
      "[表頭] 遊戲 | 本數 | 點收",
      "5201 金好運 | 3 | 3 / 3",
      "本號:060113~060115",
      "5164 發大財 | 2 | 2 / 2",
      "本號:056529~056530",
      "----",
      "尚未到的本:無",
    ]);
    expect(receiptPrintRefOf("purchase-receiving", allReceived, t).refId).toBe(
      "doc-p31",
    );
  });

  it("調貨出貨單:兩聯(出貨店留存、送貨人留存);出貨店 → 收貨店、遊戲 / 本、張數、金額、號碼區段與張數、調貨金額;簽名欄 出貨人、送貨人", () => {
    const copies = receiptLayoutsOf("transfer-shipment", shipment, t, NOW);
    const [layout] = copies;

    expect(copies.map((item) => item.copy)).toEqual([
      "第 1 聯 · 出貨店留存",
      "第 2 聯 · 送貨人留存",
    ]);
    expect(receiptLinesOf(layout, HEADER)).toEqual([
      "好運彩券行",
      "調貨出貨單",
      "[聯別] 第 1 聯 · 出貨店留存",
      "單號 T-0008 | 2026-10-12 14:05",
      "----",
      "出貨店 → 收貨店 | 中山店 → 新竹店",
      "----",
      "[表頭] 遊戲 / 本 | 張數 | 金額",
      "5164 · 056527 | 10 | 2,000",
      "號碼:#090~099(10 張)",
      "[合計] 調貨金額 | 1,840",
      "----",
      "[QR] https://admin.example/purchasing/transfer/view-page/doc-t8",
      "掃描開啟單據",
      "[簽名] 出貨人簽名",
      "[簽名] 送貨人簽名",
    ]);
  });

  it("調貨付款收據:兩聯(收貨店留存、送貨人留存);付款店(分店 · 現金來源)、收款人、現金;簽名欄 付款人、送貨人簽收;時間 = 付款時間", () => {
    const input = transferPaymentInputOf(
      settlement([{}]),
      "rec-1",
      shipment.url,
    );
    if (input === null) throw new Error("應該要印付款收據");
    const copies = receiptLayoutsOf("transfer-payment", input, t, NOW);
    const [layout] = copies;

    expect(copies.map((item) => item.copy)).toEqual([
      "第 1 聯 · 收貨店留存",
      "第 2 聯 · 送貨人留存",
    ]);
    expect(layout.time).toBe("2026-10-16T11:05:00.000Z");
    expect(receiptLinesOf(layout, HEADER)).toEqual([
      "好運彩券行",
      "調貨付款收據",
      "[聯別] 第 1 聯 · 收貨店留存",
      "單號 T-0008 | 2026-10-12 14:05",
      "----",
      "付款店 | 新竹店 · 收銀點抽屜",
      "收款人 | 王小明(送貨人)",
      "[合計] 現金 | 1,840",
      "----",
      `[QR] ${shipment.url}`,
      "掃描開啟單據",
      "[簽名] 付款人簽名",
      "[簽名] 送貨人簽收",
    ]);
    expect(receiptPrintRefOf("transfer-payment", input, t)).toEqual({
      orgId: "org-hsinchu",
      documentType: "lottery-transfer-payment",
      refType: "lottery-transfer-payment",
      refId: "rec-1",
      documentName: "調貨付款收據 T-0008(兩聯)",
      defaultPrinterId: null,
    });
  });

  it("從收銀點抽屜付:付款店印收銀點名稱,收銀點的印表機當預設印表機", () => {
    const input = transferPaymentInputOf(
      settlement([
        {
          cashPointName: "店內櫃台抽屜",
          cashPointPrinterId: "printer-counter",
        },
      ]),
      "rec-1",
      URL,
    );
    if (input === null) throw new Error("應該要印付款收據");

    expect(
      receiptLinesOf(
        RECEIPT_KINDS["transfer-payment"].layoutOf(input, t, NOW),
        HEADER,
      ),
    ).toContain("付款店 | 新竹店 · 店內櫃台抽屜");
    expect(
      receiptPrintRefOf("transfer-payment", input, t).defaultPrinterId,
    ).toBe("printer-counter");
  });

  it("付款收據只印收貨店付的現金:銀行、收到退款、沖正、被沖正的 → 不印;[列印] 用最近一筆", () => {
    const records = settlement([
      { cashPlace: "vault" },
      { method: "bank", cashPlace: null },
      { direction: "in" },
      { reversalOf: "rec-1" },
      { cashPlace: "vault", amount: 500 },
      { reversedById: "rec-x" },
    ]);

    expect(transferPaymentInputOf(records, "rec-1", URL)?.source).toBe("vault");
    for (const id of ["rec-2", "rec-3", "rec-4", "rec-6"]) {
      expect(transferPaymentInputOf(records, id, URL)).toBeNull();
    }
    expect(latestTransferPaymentInputOf(records, URL)?.recordId).toBe("rec-5");
    expect(
      transferPaymentInputOf({ ...records, kind: "purchase" }, "rec-1", URL),
    ).toBeNull();
  });

  it("每種單據用自己的 refType(同一張調貨單的出貨單與付款收據各自計算已印次數)", () => {
    expect(receiptPrintRefOf("purchase-receiving", purchase, t)).toEqual({
      orgId: "org-store",
      documentType: "lottery-purchase-receiving",
      refType: "lottery-purchase-receiving",
      refId: "batch-1",
      documentName: "進貨點收單 P-0031(兩聯)",
      defaultPrinterId: null,
    });
    expect(receiptPrintRefOf("transfer-shipment", shipment, t)).toMatchObject({
      orgId: "org-store",
      refType: "lottery-transfer-shipment",
      refId: "doc-t8",
      documentName: "調貨出貨單 T-0008(兩聯)",
    });
  });
});
