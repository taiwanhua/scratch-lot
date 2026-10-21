import {
  CHECKOUT_CONFIRM_FORM_KEY,
  STORE_KEY,
} from "@repo/domain/project/lottery";

import { registerFormLifecycle } from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import type { CheckoutService } from "./checkout.service";
import { CHECKOUT_SERVICE } from "./checkout.token";

/**
 * 結帳確認申請的掛接點(規格 6.9、8.7;正本 `docs/modules/project/store.md`「交班結帳」):
 *
 * - `beforeSubmit`:有 `store.checkout`、負責人或店長;班開著;這一班沒有其他審核中的結帳;盤點方式、差額原因、交接都合法
 * - `submitted`:同一個交易建立結帳單、盤點單(現在盤點),這一班結束(下一班可以先開);退回後再送出改寫同一筆
 * - `returned` / `withdrawn`:結帳單 → 已退回(自己的盤點單一起)
 * - `completed`:套用盤點、結帳單 → 已確認;零用金成為下一班期初
 * - `beforeReject` / `beforeVoid`:**一律擋下**(只能退回)
 */
export const checkoutConfirmLifecycle = registerFormLifecycle({
  moduleKey: STORE_KEY,
  formKey: CHECKOUT_CONFIRM_FORM_KEY,
  inject: [CHECKOUT_SERVICE],
  guards: {
    beforeSubmit: ({ operator, submission, values, get }) =>
      get<CheckoutService>(CHECKOUT_SERVICE).checkSubmit(
        operator,
        submission._id,
        values,
      ),
    beforeReject: ({ get }) =>
      get<CheckoutService>(CHECKOUT_SERVICE).beforeReject(),
    beforeVoid: ({ get }) =>
      get<CheckoutService>(CHECKOUT_SERVICE).beforeVoid(),
  },
  effects: {
    submitted: async ({ submissionId, tenantId, session, get }) => {
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
      await get<CheckoutService>(CHECKOUT_SERVICE).apply(
        session,
        tenantId,
        submissionId,
      );
    },
  },
});
