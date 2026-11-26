import { describe, expect, it } from "@jest/globals";
import { createTranslator } from "use-intl";

import { WHOLESALE_SETTLEMENT_SIDE } from "@repo/domain/project/lottery";
import type { LotterySettlementFieldsFragment } from "@repo/graphql";
import { composeProjectMessages } from "@repo/i18n";
import { projectPublic } from "@repo/project-config/public";

import { PURCHASING_RECEIPTS_I18N } from "./purchase-receiving-receipt";
import {
  RECEIPT_KINDS,
  receiptLayoutsOf,
  receiptPrintRefOf,
} from "./receipt-kinds";
import { type ReceiptTranslator, receiptLinesOf } from "./receipt-layout";
import { transferPaymentInputOf } from "./transfer-payment-receipt";
import {
  latestWholesalePaymentInputOf,
  wholesalePaymentInputOf,
} from "./wholesale-payment-receipt";
import {
  type WholesaleShipmentDetail,
  wholesaleShipmentInputOf,
} from "./wholesale-shipment-receipt";

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

/** 規格 21.9 共同前提:W-0001 中山店 → 好運彩券行,5164 兩本(056611、056612)都改 93 → 每本 18,600。 */
const wholesaleBook = {
  gameCode: "5164",
  bookNo: "0056611",
  tickets: 100,
  rate: 93,
  amount: 18_600,
};
const wholesaleDetail: WholesaleShipmentDetail = {
  fromBranchName: "中山店",
  customerName: "好運彩券行",
  paymentMode: "collect_first",
  amount: 37_200,
  received: 37_200,
  shippedAt: "2026-11-19T02:45:00.000Z",
  rows: [wholesaleBook, { ...wholesaleBook, bookNo: "0056612" }],
};
const WHOLESALE_URL =
  "https://admin.example/purchasing/wholesale/view-page/doc-w1";
const wholesaleDocument = {
  submissionId: "doc-w1",
  serialNo: "W-0001",
  fromBranchId: "org-store",
  url: WHOLESALE_URL,
};

const wholesaleSettlement = (
  records: Partial<LotterySettlementFieldsFragment["records"][number]>[],
): LotterySettlementFieldsFragment => ({
  moduleKey: "purchasing.wholesale",
  label: "批售單",
  kind: "wholesale",
  refId: "doc-w1",
  docNo: "W-0001",
  counterparty: "好運彩券行",
  payable: 37_200,
  pendingPayee: 0,
  sides: [
    {
      side: WHOLESALE_SETTLEMENT_SIDE,
      label: "出貨店",
      role: "payee",
      methods: ["bank", "cash"],
      branch: { id: "org-store", name: "中山店" },
      totalOut: 0,
      totalIn: 20_000,
      net: 20_000,
      canSettle: true,
      cashDrawers: [],
      buttons: [],
    },
  ],
  records: records.map((record, index) => ({
    id: `rec-${String(index + 1)}`,
    method: "cash",
    side: WHOLESALE_SETTLEMENT_SIDE,
    type: "wholesale_in",
    direction: "in",
    amount: 20_000,
    accountLabel: null,
    cashPlace: "vault",
    cashPointName: null,
    cashPointPrinterId: null,
    handler: "王小明",
    note: null,
    occurredAt: "2026-11-18T06:05:00.000Z",
    createdBy: null,
    reversalOf: null,
    reversedById: null,
    canReverse: true,
    ...record,
  })),
});

describe("批售單的 58mm 單據(規格 21.8;Figma RC-11、RC-12)", () => {
  it("批售出貨單(驗算 #7):兩聯(店鋪留存、客戶留存);出貨分店 → 批售客戶、遊戲 · 本號區段 / 本數 / 批售金額(不另印每本張數與批購金額率)、批售金額、收款方式與已收;時間 = 出貨時間;不印原成本與獲利", () => {
    const input = wholesaleShipmentInputOf(wholesaleDetail, wholesaleDocument);
    const copies = receiptLayoutsOf("wholesale-shipment", input, t, NOW);
    const [layout] = copies;

    expect(copies.map((item) => item.copy)).toEqual([
      "第 1 聯 · 店鋪留存",
      "第 2 聯 · 客戶留存",
    ]);
    expect(layout.time).toBe("2026-11-19T02:45:00.000Z");
    const lines = receiptLinesOf(layout, HEADER);
    expect(lines).toEqual([
      "好運彩券行",
      "批售出貨單",
      "[聯別] 第 1 聯 · 店鋪留存",
      "單號 W-0001 | 2026-10-12 14:05",
      "----",
      "出貨分店 → 批售客戶 | 中山店 → 好運彩券行",
      "----",
      "[表頭] 遊戲 / 本號 | 本數 | 批售金額",
      "5164 · 056611~056612 | 2 | 37,200",
      "[合計] 批售金額 | 37,200",
      "收款方式 | 收到錢再核准",
      "已收 | 37,200",
      "----",
      `[QR] ${WHOLESALE_URL}`,
      "掃描開啟單據",
      "[簽名] 經手人",
      "[簽名] 客戶簽收",
    ]);
    expect(lines.join("\n")).not.toMatch(/成本|獲利/);
    expect(receiptPrintRefOf("wholesale-shipment", input, t)).toEqual({
      orgId: "org-store",
      documentType: "lottery-wholesale-shipment",
      refType: "lottery-wholesale-shipment",
      refId: "doc-w1",
      documentName: "批售出貨單 W-0001(兩聯)",
      defaultPrinterId: null,
    });
  });

  it("批售出貨單:同遊戲的本併成一列(不同批購金額率也併)、本號不連號以「、」分開;沒有出貨時間用列印當下;從帳戶入帳;沒有連結不印 QR", () => {
    const input = wholesaleShipmentInputOf(
      {
        ...wholesaleDetail,
        paymentMode: "auto_bank",
        shippedAt: null,
        amount: 74_800,
        rows: [
          ...wholesaleDetail.rows,
          { ...wholesaleBook, bookNo: "0056620" },
          { ...wholesaleBook, bookNo: "0056630", rate: 95, amount: 19_000 },
        ],
      },
      { ...wholesaleDocument, url: null },
    );
    const layout = RECEIPT_KINDS["wholesale-shipment"].layoutOf(input, t, NOW);
    const lines = receiptLinesOf(layout, HEADER);

    expect(layout.time).toBe(NOW);
    expect(lines.slice(7, 9)).toEqual([
      "5164 · 056611~056612、056620、056630 | 4 | 74,800",
      "[合計] 批售金額 | 74,800",
    ]);
    expect(lines).toContain("收款方式 | 從帳戶入帳");
    expect(lines.some((line) => line.startsWith("[QR]"))).toBe(false);
  });

  it("批售收款收據(驗算 #5):兩聯(店鋪留存、客戶留存);批售客戶、現金進(分店 · 小金庫)、經手人、現金;簽名欄 經手人、客戶簽名;時間 = 收款時間", () => {
    const input = wholesalePaymentInputOf(
      wholesaleSettlement([{}]),
      "rec-1",
      WHOLESALE_URL,
    );
    if (input === null) throw new Error("應該要印批售收款收據");
    const copies = receiptLayoutsOf("wholesale-payment", input, t, NOW);
    const [layout] = copies;

    expect(copies.map((item) => item.copy)).toEqual([
      "第 1 聯 · 店鋪留存",
      "第 2 聯 · 客戶留存",
    ]);
    expect(layout.time).toBe("2026-11-18T06:05:00.000Z");
    expect(receiptLinesOf(layout, HEADER)).toEqual([
      "好運彩券行",
      "批售收款收據",
      "[聯別] 第 1 聯 · 店鋪留存",
      "單號 W-0001 | 2026-10-12 14:05",
      "----",
      "批售客戶 | 好運彩券行",
      "現金進 | 中山店 · 小金庫",
      "經手人 | 王小明",
      "[合計] 現金 | 20,000",
      "----",
      `[QR] ${WHOLESALE_URL}`,
      "掃描開啟單據",
      "[簽名] 經手人",
      "[簽名] 客戶簽名",
    ]);
    expect(receiptPrintRefOf("wholesale-payment", input, t)).toEqual({
      orgId: "org-store",
      documentType: "lottery-wholesale-payment",
      refType: "lottery-wholesale-payment",
      refId: "rec-1",
      documentName: "批售收款收據 W-0001(兩聯)",
      defaultPrinterId: null,
    });
  });

  it("批售收款收據:收進收銀點抽屜印收銀點名稱、用收銀點的印表機;銀行、退款、沖正、被沖正、其他單據 → 不印;[列印] 用最近一筆現金收款", () => {
    const records = wholesaleSettlement([
      {
        cashPlace: "drawer",
        cashPointName: "店內櫃台",
        cashPointPrinterId: "printer-counter",
      },
      { method: "bank", cashPlace: null, accountLabel: "台銀" },
      { direction: "out", type: "wholesale_out" },
      { reversalOf: "rec-1" },
      { amount: 500 },
      { reversedById: "rec-x" },
    ]);
    const drawer = wholesalePaymentInputOf(records, "rec-1", WHOLESALE_URL);
    if (drawer === null) throw new Error("應該要印批售收款收據");

    expect(
      receiptLinesOf(
        RECEIPT_KINDS["wholesale-payment"].layoutOf(drawer, t, NOW),
        HEADER,
      ),
    ).toContain("現金進 | 中山店 · 店內櫃台");
    expect(
      receiptPrintRefOf("wholesale-payment", drawer, t).defaultPrinterId,
    ).toBe("printer-counter");
    for (const id of ["rec-2", "rec-3", "rec-4", "rec-6"]) {
      expect(wholesalePaymentInputOf(records, id, WHOLESALE_URL)).toBeNull();
    }
    expect(
      latestWholesalePaymentInputOf(records, WHOLESALE_URL)?.recordId,
    ).toBe("rec-5");
    expect(
      wholesalePaymentInputOf(
        { ...records, kind: "transfer" },
        "rec-1",
        WHOLESALE_URL,
      ),
    ).toBeNull();
    // 調貨付款收據也不會把批售單的現金收款當成要印的付款
    expect(transferPaymentInputOf(records, "rec-1", WHOLESALE_URL)).toBeNull();
  });
});
