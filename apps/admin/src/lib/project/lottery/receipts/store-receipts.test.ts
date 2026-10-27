import { describe, expect, it } from "@jest/globals";
import { createTranslator } from "use-intl";

import { composeProjectMessages } from "@repo/i18n";
import { projectPublic } from "@repo/project-config/public";

import {
  RECEIPT_KINDS,
  receiptDocumentNameOf,
  receiptLayoutsOf,
  receiptPrintRefOf,
} from "./receipt-kinds";
import { type ReceiptTranslator, receiptLinesOf } from "./receipt-layout";
import type { SaleRefundReceiptInput } from "./sale-refund-receipt";
import { STORE_RECEIPTS_I18N } from "./store-receipts";

/** 真的字典(與畫面同一份):單據上的字就是租戶會看到的字。 */
const messages = composeProjectMessages({
  brandName: projectPublic.brand.name,
  frontMetadata: projectPublic.front.metadata,
})["zh-TW"];
const tRoot = createTranslator({ locale: "zh-TW", messages });
const t: ReceiptTranslator = (key, values) =>
  tRoot(`${STORE_RECEIPTS_I18N}.${key}` as never, values as never);

const NOW = "2026-10-16T13:30:00.000Z";
const HEADER = { tenantName: "好運彩券行", time: "2026-10-16 21:30" };
const LEDGER = "https://admin.example/accounts?tab=cash&movementId=mv-18";
const VIEW = "https://admin.example/store/view-page";

const refund: SaleRefundReceiptInput = {
  submissionId: "sub-r8",
  serialNo: "SR-0008",
  branchId: "org-store",
  pending: true,
  refundShiftLabel: "店內櫃台 · 王小明 10/16 08:02",
  reasonLabel: "客人退貨",
  groups: [
    {
      gameCode: "5164",
      gameName: "發大財",
      ticketNos: ["031", "032"],
      amount: 400,
    },
  ],
  refundAmount: 400,
  url: `${VIEW}/sub-r8`,
};

describe("店面的 58mm 單據版面:投庫單、出庫單、存款單、退貨退款收據(規格第 12 章;Figma RC-01–03、RC-09)", () => {
  it("投庫單:分店、收銀點、方向、金額;沒有單號(現金流水),QR 連到即時現金帳那一筆;簽名欄 投庫人、見證人", () => {
    const payload = {
      movementId: "mv-18",
      branchId: "org-store",
      branchName: "中山店",
      cashPointName: "店內櫃台",
      amount: 3000,
      note: null,
      defaultPrinterId: "printer-counter",
      url: LEDGER,
    };
    const [layout] = receiptLayoutsOf("store-vault-deposit", payload, t, NOW);

    expect(layout.time).toBe(NOW);
    expect(receiptLinesOf(layout, HEADER)).toEqual([
      "好運彩券行",
      "投庫單",
      " | 2026-10-16 21:30",
      "----",
      "分店 | 中山店",
      "收銀點 | 店內櫃台",
      "方向 | 抽屜 → 小金庫",
      "[合計] 金額 | 3,000",
      "----",
      `[QR] ${LEDGER}`,
      "掃描開啟單據",
      "[簽名] 投庫人簽名",
      "[簽名] 見證人簽名",
    ]);
    // 一筆流水一張;印收銀點的印表機
    expect(receiptPrintRefOf("store-vault-deposit", payload, t)).toMatchObject({
      orgId: "org-store",
      documentType: "lottery-store-vault-deposit",
      refType: "lottery-store-vault-deposit",
      refId: "mv-18",
      documentName: "投庫單 · 中山店",
      defaultPrinterId: "printer-counter",
    });
    // 一聯的單據:補印時列印紀錄的名稱不變(不加聯別、不加「補印」)
    expect(
      receiptDocumentNameOf("store-vault-deposit", payload, t, {
        isReprint: true,
      }),
    ).toBe("投庫單 · 中山店");
  });

  it("出庫單:分店、方向(小金庫 → 收銀點抽屜)、原因、備註、金額;簽名欄 領取人、見證人", () => {
    const [layout] = receiptLayoutsOf(
      "store-vault-withdraw",
      {
        movementId: "mv-13",
        branchId: "org-store",
        branchName: "中山店",
        cashPointName: "店外攤位",
        reasonLabel: "開班零用金",
        amount: 2000,
        note: "早班",
        url: LEDGER,
      },
      t,
      NOW,
    );

    expect(receiptLinesOf(layout, HEADER)).toEqual([
      "好運彩券行",
      "出庫單",
      " | 2026-10-16 21:30",
      "----",
      "分店 | 中山店",
      "方向 | 小金庫 → 店外攤位抽屜",
      "原因 | 開班零用金",
      "備註 | 早班",
      "[合計] 金額 | 2,000",
      "----",
      `[QR] ${LEDGER}`,
      "掃描開啟單據",
      "[簽名] 領取人簽名",
      "[簽名] 見證人簽名",
    ]);
  });

  it("存款單:分店、經手人、存入帳戶、備註、金額;簽名欄 經手人;印分店預設印表機", () => {
    const payload = {
      movementId: "mv-bank-1",
      branchId: "org-store",
      branchName: "中山店",
      handler: "王小明",
      accountName: "台灣銀行 ****12345",
      amount: 5000,
      note: "小金庫現金過多",
      url: LEDGER,
    };
    const [layout] = receiptLayoutsOf("store-bank-deposit", payload, t, NOW);

    expect(receiptLinesOf(layout, HEADER)).toEqual([
      "好運彩券行",
      "存款單",
      " | 2026-10-16 21:30",
      "----",
      "分店 | 中山店",
      "經手人 | 王小明",
      "存入帳戶 | 台灣銀行 ****12345",
      "備註 | 小金庫現金過多",
      "[合計] 金額 | 5,000",
      "----",
      `[QR] ${LEDGER}`,
      "掃描開啟單據",
      "[簽名] 經手人簽名",
    ]);
    expect(
      receiptPrintRefOf("store-bank-deposit", payload, t).defaultPrinterId,
    ).toBeNull();
  });

  it("退貨退款收據:標「待核准」;退款班次、原因、遊戲 / 張數 / 金額、號碼區段、退款;簽名欄 經手人", () => {
    const [layout] = receiptLayoutsOf("store-sale-refund", refund, t, NOW);

    expect(receiptLinesOf(layout, HEADER)).toEqual([
      "好運彩券行",
      "退貨退款收據",
      "[標示] 待核准",
      "單號 SR-0008 | 2026-10-16 21:30",
      "----",
      "退款班次 | 店內櫃台 · 王小明 10/16 08:02",
      "原因 | 客人退貨",
      "[表頭] 遊戲 | 張數 | 金額",
      "5164 發大財 | 2 | 400",
      "號碼:#031~032(2 張)",
      "[合計] 退款 | 400",
      "----",
      `[QR] ${VIEW}/sub-r8`,
      "掃描開啟單據",
      "[簽名] 經手人簽名",
    ]);
  });

  it("退貨退款收據:申請已自動通過(店長自己送)→ 不標「待核准」", () => {
    const layout = RECEIPT_KINDS["store-sale-refund"].layoutOf(
      { ...refund, pending: false },
      t,
      NOW,
    );

    expect(layout.stamp).toBeNull();
    expect(receiptLinesOf(layout, HEADER)).not.toContain("[標示] 待核准");
  });
});
