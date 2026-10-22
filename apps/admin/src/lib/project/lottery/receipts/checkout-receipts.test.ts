import { describe, expect, it } from "@jest/globals";
import { createTranslator } from "use-intl";

import type { LotteryCheckoutQuery } from "@repo/graphql";
import { composeProjectMessages } from "@repo/i18n";
import { projectPublic } from "@repo/project-config/public";

import { dailyCloseInputOf } from "./daily-close-receipt";
import { RECEIPT_KINDS, receiptPrintRefOf } from "./receipt-kinds";
import { type ReceiptTranslator, receiptLinesOf } from "./receipt-layout";
import { shiftCheckoutInputOf } from "./shift-checkout-receipt";
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
const VIEW = "https://admin.example/store/view-page";

/** 檢視頁的時間格式(租戶時區 monthDayTime;測試用固定的對照)。 */
const TIMES: Record<string, string> = {
  "2026-10-16T00:02:00.000Z": "10/16 08:02",
  "2026-10-16T07:10:00.000Z": "10/16 15:10",
  "2026-10-16T02:32:00.000Z": "10/16 10:32",
  "2026-10-14T01:02:00.000Z": "10/14 09:02",
  "2026-10-16T14:40:00.000Z": "10/16 22:40",
};
const timeText = (value: string) => TIMES[value] ?? value;

type Detail = LotteryCheckoutQuery["lotteryCheckout"];

const ref = (id: string, name: string) => ({
  __typename: "LotteryAccountsRef" as const,
  id,
  name,
});

/** 交班結帳單的結帳單:店內櫃台 王小明 → 李小華,沿用 10:32 的盤點,差 −300(找錯錢)。 */
const shiftDetail = (): Detail => ({
  __typename: "LotteryCheckoutDetail",
  id: "co-3",
  submissionId: "sub-ck3",
  type: "shift",
  status: "pending",
  orgId: "org-store",
  orgName: "中山店",
  cashPoint: ref("cp-counter", "店內櫃台"),
  shiftId: "shift-1",
  cashPointPrinterId: "printer-counter",
  shiftOpenedAt: "2026-10-16T00:02:00.000Z",
  shiftClosedAt: "2026-10-16T07:10:00.000Z",
  stocktakeMode: "reuse",
  stocktake: {
    __typename: "LotteryCheckoutReusableStocktake",
    submissionId: "sub-st",
    serialNo: "ST-0032",
    startedAt: "2026-10-16T02:32:00.000Z",
    scopeName: null,
    diffCount: 0,
  },
  skipReason: null,
  skipReasonNote: null,
  expectedItems: [],
  expected: 12_350,
  denominations: [],
  counted: 12_050,
  difference: -300,
  diffReason: "找錯錢",
  diffReasonNote: null,
  pendingImpacts: [],
  leftForNext: 3000,
  successor: ref("user-hua", "李小華"),
  submittedBy: ref("user-ming", "王小明"),
  submittedAt: "2026-10-16T07:10:00.000Z",
  confirmedAt: null,
  coveredFrom: null,
  coveredTo: null,
  coveredShifts: [],
  bankDepositAmount: 0,
  bankAccount: null,
  draft: "{}",
});

/** 日結單的結帳單:店內櫃台 4 班(其中一班差 −100)、店外攤位 3 班;存 40,000。 */
const dailyDetail = (): Detail => ({
  ...shiftDetail(),
  submissionId: "sub-c43",
  type: "daily",
  cashPoint: null,
  shiftId: null,
  cashPointPrinterId: null,
  shiftOpenedAt: null,
  shiftClosedAt: null,
  stocktakeMode: "reuse",
  expected: 48_200,
  counted: 48_200,
  difference: 0,
  diffReason: null,
  successor: null,
  coveredFrom: "2026-10-14T01:02:00.000Z",
  coveredTo: "2026-10-16T14:40:00.000Z",
  submittedAt: "2026-10-16T14:40:00.000Z",
  coveredShifts: [
    ["店內櫃台", -100],
    ["店外攤位", 0],
    ["店內櫃台", 0],
    ["店外攤位", 0],
    ["店內櫃台", 0],
    ["店外攤位", 0],
    ["店內櫃台", 0],
  ].map(([cashPointName, difference], index) => ({
    __typename: "LotteryCheckoutCoveredShift" as const,
    submissionId: `sub-${String(index)}`,
    serialNo: null,
    cashPointName: String(cashPointName),
    difference: Number(difference),
  })),
  bankDepositAmount: 40_000,
  bankAccount: ref("acc-1", "末 34521"),
});

describe("店面的 58mm 單據版面:交班結帳單、日結單(規格第 12 章;Figma RC-04、RC-05)", () => {
  it("交班結帳單:收銀點、班次、交班人、接班人、盤點、應有 / 實點 / 差額(原因)、留給下一班;時間 = 送出時間;簽名欄 交班人、接班人", () => {
    const payload = shiftCheckoutInputOf(
      shiftDetail(),
      "C-0042",
      `${VIEW}/sub-ck3`,
      timeText,
    );
    const [layout] = RECEIPT_KINDS["store-shift-checkout"].copiesOf(
      payload,
      t,
      NOW,
    );

    expect(layout.time).toBe("2026-10-16T07:10:00.000Z");
    expect(receiptLinesOf(layout, HEADER)).toEqual([
      "好運彩券行",
      "交班結帳單",
      "單號 C-0042 | 2026-10-16 21:30",
      "----",
      "收銀點 | 店內櫃台",
      "班次 | 10/16 08:02 ~ 10/16 15:10",
      "交班人 | 王小明",
      "接班人 | 李小華",
      "盤點 | 沿用 10/16 10:32",
      "----",
      "應有現金 | 12,350",
      "實點 | 12,050",
      "差額 | -300(找錯錢)",
      "[合計] 留給下一班 | 3,000",
      "----",
      `[QR] ${VIEW}/sub-ck3`,
      "掃描開啟單據",
      "[簽名] 交班人簽名",
      "[簽名] 接班人簽名",
    ]);
    expect(receiptPrintRefOf("store-shift-checkout", payload, t)).toMatchObject(
      {
        refId: "sub-ck3",
        documentName: "交班結帳單 C-0042",
        defaultPrinterId: "printer-counter",
      },
    );
  });

  it("交班結帳單:沒有接班人 =「無」;跳過盤點印原因;差額 0 不接原因", () => {
    const lines = receiptLinesOf(
      RECEIPT_KINDS["store-shift-checkout"].layoutOf(
        shiftCheckoutInputOf(
          {
            ...shiftDetail(),
            successor: null,
            stocktakeMode: "skip",
            stocktake: null,
            skipReason: "客人太多",
            difference: 0,
            diffReason: null,
          },
          "C-0042",
          `${VIEW}/sub-ck3`,
          timeText,
        ),
        t,
        NOW,
      ),
      HEADER,
    );

    expect(lines).toContain("接班人 | 無");
    expect(lines).toContain("盤點 | 跳過(客人太多)");
    expect(lines).toContain("差額 | 0");
  });

  it("日結單:涵蓋計算期間、盤點、各收銀點班數與差額、小金庫應有 / 實點、存入銀行、小金庫留存;簽名欄 店長", () => {
    const payload = dailyCloseInputOf(
      dailyDetail(),
      "C-0043",
      `${VIEW}/sub-c43`,
      timeText,
    );
    const [layout] = RECEIPT_KINDS["store-daily-close"].copiesOf(
      payload,
      t,
      NOW,
    );

    expect(receiptLinesOf(layout, HEADER)).toEqual([
      "好運彩券行",
      "日結單",
      "單號 C-0043 | 2026-10-16 21:30",
      "----",
      "涵蓋計算期間 | 10/14 09:02 ~ 10/16 22:40",
      "盤點 | 沿用 10/16 10:32",
      "----",
      "[表頭] 收銀點 | 班數 | 差額",
      "店內櫃台 | 4 | -100",
      "店外攤位 | 3 | 0",
      "----",
      "小金庫 應有 | 48,200",
      "小金庫 實點 | 48,200",
      "存入銀行 | 40,000(末 34521)",
      "[合計] 小金庫 留存 | 8,200",
      "----",
      `[QR] ${VIEW}/sub-c43`,
      "掃描開啟單據",
      "[簽名] 店長簽名",
    ]);
  });

  it("日結單:第一次日結沒有起點;小金庫差額不為 0 才印;不存銀行 =「不存」", () => {
    const lines = receiptLinesOf(
      RECEIPT_KINDS["store-daily-close"].layoutOf(
        dailyCloseInputOf(
          {
            ...dailyDetail(),
            coveredFrom: null,
            counted: 48_000,
            difference: -200,
            diffReason: "找錯錢",
            bankDepositAmount: 0,
            bankAccount: null,
          },
          "C-0043",
          `${VIEW}/sub-c43`,
          timeText,
        ),
        t,
        NOW,
      ),
      HEADER,
    );

    expect(lines).toContain("涵蓋計算期間 | 第一次日結 ~ 10/16 22:40");
    expect(lines).toContain("小金庫 差額 | -200(找錯錢)");
    expect(lines).toContain("存入銀行 | 不存");
    expect(lines).toContain("[合計] 小金庫 留存 | 48,000");
  });
});
