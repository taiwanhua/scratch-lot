import { type GraphQLResponseBody, HttpResponse } from "msw";

import type {
  LotteryCheckoutQueryVariables,
  LotteryCheckoutWizardQueryVariables,
  LotteryCheckoutsQueryVariables,
} from "@repo/graphql";

import { api, type server } from "../../server";
import {
  CHECKOUT_REVIEWING_ID,
  type CheckoutWizardFixture,
  sampleCheckoutDetail,
  sampleCheckoutList,
  sampleCheckoutWizard,
} from "./checkout-fixtures";

export interface CheckoutWorldOptions {
  /** 精靈資料的覆寫(例:沒有可沿用的盤點、不能送出) */
  wizard?: Partial<CheckoutWizardFixture>;
}

export interface CheckoutWorld {
  handlers: Parameters<typeof server.use>;
}

/** 業務錯誤(GQL-04)。 */
const apiError = (code: string, extensions: Record<string, unknown>) =>
  HttpResponse.json<GraphQLResponseBody<Record<string, never>>>({
    data: null,
    errors: [{ message: code, extensions: { ...extensions, code } }],
  });

/**
 * 交班結帳的假 api(夾具在 `checkout-fixtures.ts`;規則照 `docs/modules/project/store.md`「交班結帳」):
 * 精靈資料(看板上的兩班)、班次結帳歷史紀錄(依收銀點、類型、狀態篩)、結帳確認申請檢視頁(只有 C-0042)。
 * 送出走表單執行端的假 api(`createAndSubmitFormSubmission`)。元件測試與 mock 模式共用。
 */
export const checkoutWorld = (
  options: CheckoutWorldOptions = {},
): CheckoutWorld => {
  const handlers = [
    api.query("LotteryCheckoutWizard", ({ variables }) => {
      const { shiftId } = variables as LotteryCheckoutWizardQueryVariables;
      const wizard = sampleCheckoutWizard(shiftId);
      if (wizard === null) {
        return apiError("NOT_FOUND", {});
      }
      return HttpResponse.json({
        data: { lotteryCheckoutWizard: { ...wizard, ...options.wizard } },
      });
    }),
    api.query("LotteryCheckouts", ({ variables }) => {
      const { input } = variables as LotteryCheckoutsQueryVariables;
      const rows = sampleCheckoutList().filter(
        (row) =>
          (input.cashPointId == null ||
            row.cashPoint?.id === input.cashPointId) &&
          (input.type == null || row.type === input.type) &&
          (input.status == null || row.submissionStatus === input.status),
      );
      return HttpResponse.json({
        data: {
          lotteryCheckouts: {
            __typename: "LotteryCheckoutsPayload",
            total: rows.length,
            items: rows,
          },
        },
      });
    }),
    api.query("LotteryCheckout", ({ variables }) => {
      const { submissionId } = variables as LotteryCheckoutQueryVariables;
      if (submissionId !== CHECKOUT_REVIEWING_ID) {
        return apiError("NOT_FOUND", {});
      }
      return HttpResponse.json({
        data: { lotteryCheckout: sampleCheckoutDetail() },
      });
    }),
  ];
  return { handlers };
};
