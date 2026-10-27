import { HttpResponse } from "msw";

import { api, type server } from "../../server";

/** 58mm 單據 QR code 的頁面路由(api 依模組樹組,不依權限)的固定回應。 */
export const RECEIPT_LINK_ROUTES = {
  cashLedger: "/accounts",
  storeView: "/store/view-page",
  purchaseView: "/purchasing/purchase/view-page",
  transferView: "/purchasing/transfer/view-page",
} as const;

/** 路由都是 null:模組停用 / 沒有 route(單據照印、不印 QR)。 */
export const NO_RECEIPT_LINK_ROUTES = {
  cashLedger: null,
  storeView: null,
  purchaseView: null,
  transferView: null,
} as const;

/** 寫入 mutation 一起帶回的 `receiptLinks`(預設同 `lotteryReceiptLinks`)。 */
export const receiptLinksPayload = (
  routes:
    | typeof RECEIPT_LINK_ROUTES
    | typeof NO_RECEIPT_LINK_ROUTES = RECEIPT_LINK_ROUTES,
) => ({ __typename: "LotteryReceiptLinks" as const, ...routes });

/** `lotteryReceiptLinks`:元件測試與 mock 模式共用。 */
export const receiptLinksHandlers = (): Parameters<typeof server.use> => [
  api.query("LotteryReceiptLinks", () =>
    HttpResponse.json({
      data: {
        lotteryReceiptLinks: {
          __typename: "LotteryReceiptLinks",
          ...RECEIPT_LINK_ROUTES,
        },
      },
    }),
  ),
];
