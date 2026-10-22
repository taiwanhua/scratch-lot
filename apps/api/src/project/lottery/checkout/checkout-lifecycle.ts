import {
  CHECKOUT_CONFIRM_FORM_KEY,
  STORE_KEY,
} from "@repo/domain/project/lottery";

import { registerFormLifecycle } from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import type { DailyCloseService } from "../daily-close/daily-close.service";
import { DAILY_CLOSE_SERVICE } from "../daily-close/daily-close.token";
import type { CheckoutService } from "./checkout.service";
import { CHECKOUT_SERVICE } from "./checkout.token";

/**
 * 結帳確認申請的掛接點(規格 6.9、6.10、8.7;正本 `docs/modules/project/store.md`「交班結帳」「日結與存銀行」)。
 * 交班與日結同一張表單,**依類型分派**:日結 → `DailyCloseService`(`daily-close/`),交班 → `CheckoutService`。
 *
 * - `beforeSubmit`:交班 → 負責人或店長、班開著、沒有其他審核中的結帳、盤點 / 差額原因 / 交接合法;
 *   日結 → 所有收銀點的班都已送出、涵蓋的交班全部已核准、全店盤點 / 小金庫差額原因 / 存入銀行合法
 * - `submitted`:同一個交易建立結帳單、盤點單;交班 → 這一班結束(下一班可以先開);日結 → 涵蓋計算期間定下
 * - `returned` / `withdrawn`:結帳單 → 已退回(自己的盤點單一起;交班 / 日結同一套)
 * - `completed`:套用盤點、結帳單 → 已確認;交班 → 零用金成為下一班期初;日結 → 寫「存銀行」流水與銀行「存入」、
 *   小金庫從清點金額重新起算
 * - `beforeReject` / `beforeVoid`:**一律擋下**(只能退回)
 */
export const checkoutConfirmLifecycle = registerFormLifecycle({
  moduleKey: STORE_KEY,
  formKey: CHECKOUT_CONFIRM_FORM_KEY,
  inject: [CHECKOUT_SERVICE, DAILY_CLOSE_SERVICE],
  guards: {
    beforeSubmit: ({ operator, submission, values, get }) => {
      const daily = get<DailyCloseService>(DAILY_CLOSE_SERVICE);
      return daily.isDailyValues(values)
        ? daily.checkSubmit(operator, submission._id, values)
        : get<CheckoutService>(CHECKOUT_SERVICE).checkSubmit(
            operator,
            submission._id,
            values,
          );
    },
    beforeReject: ({ get }) =>
      get<CheckoutService>(CHECKOUT_SERVICE).beforeReject(),
    beforeVoid: ({ get }) =>
      get<CheckoutService>(CHECKOUT_SERVICE).beforeVoid(),
  },
  effects: {
    submitted: async ({ submissionId, tenantId, session, get }) => {
      const daily = get<DailyCloseService>(DAILY_CLOSE_SERVICE);
      if (await daily.isDaily(session, tenantId, submissionId)) {
        await daily.submitFromSubmission(session, tenantId, submissionId);
        return;
      }
      await get<CheckoutService>(CHECKOUT_SERVICE).submitFromSubmission(
        session,
        tenantId,
        submissionId,
      );
    },
    returned: async ({ submissionId, tenantId, session, get }) => {
      await get<CheckoutService>(CHECKOUT_SERVICE).markReturned(
        session,
        tenantId,
        submissionId,
      );
    },
    withdrawn: async ({ submissionId, tenantId, session, get }) => {
      await get<CheckoutService>(CHECKOUT_SERVICE).markReturned(
        session,
        tenantId,
        submissionId,
      );
    },
    completed: async ({ submissionId, tenantId, session, get }) => {
      const daily = get<DailyCloseService>(DAILY_CLOSE_SERVICE);
      if (await daily.isDaily(session, tenantId, submissionId)) {
        await daily.apply(session, tenantId, submissionId);
        return;
      }
      await get<CheckoutService>(CHECKOUT_SERVICE).apply(
        session,
        tenantId,
        submissionId,
      );
    },
  },
});
