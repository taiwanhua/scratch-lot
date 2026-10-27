import { HttpResponse } from "msw";

import { api, type server } from "../../server";

/** 58mm 單據 QR code 的頁面路由(api 依模組樹組,不依權限)的固定回應。 */
export const RECEIPT_LINK_ROUTES = {
  cashLedger: "/accounts",
  storeView: "/store/view-page",
  purchaseView: "/purchasing/purchase/view-page",
  transferView: "/purchasing/transfer/view-page",
} as const;

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
