import {
  STOCKTAKE_CONFIRM_FORM_KEY,
  STOCKTAKE_REASONS,
  STORE_KEY,
} from "@repo/domain/project/lottery";

import { registerFormLifecycle } from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import type { StocktakeService } from "./stocktake.service";
import { STOCKTAKE_SERVICE } from "./stocktake.token";

/**
 * 盤點確認申請的掛接點(規格 6.8、8.6;正本 `docs/modules/project/store.md`「盤點」):
 *
 * - `beforeSubmit`:每筆差異都已處理、而且還對得到(已被其他盤點或操作處理掉 → `STOCKTAKE_DIFF_STALE`)
 * - `submitted`:同一個交易建立盤點單(待核准;退回後再送出改寫同一筆)
 * - `returned` / `withdrawn`:盤點單 → 已退回(打開時帶入原內容);`rejected`:→ 已駁回(補登的售出不退)
 * - `completed`:套用庫存變動(新增待查、確認遺失、尋回、未拆的本不在 → 待查)
 * - `beforeVoid`:**一律擋下**(待查錯誤刷到時尋回)
 */
export const stocktakeConfirmLifecycle = registerFormLifecycle({
  moduleKey: STORE_KEY,
  formKey: STOCKTAKE_CONFIRM_FORM_KEY,
  inject: [STOCKTAKE_SERVICE],
  guards: {
    beforeSubmit: ({ operator, values, get }) =>
      get<StocktakeService>(STOCKTAKE_SERVICE).checkSubmit(operator, values),
    beforeVoid: () => ({
      code: STOCKTAKE_REASONS.voidForbidden,
      message: "stocktake confirmations cannot be voided",
    }),
  },
  effects: {
    submitted: async ({ submissionId, tenantId, session, get }) => {
      await get<StocktakeService>(STOCKTAKE_SERVICE).submitFromSubmission(
        session,
        tenantId,
        submissionId,
      );
    },
    returned: async ({ submissionId, tenantId, session, get }) => {
      await get<StocktakeService>(STOCKTAKE_SERVICE).markStatus(
        session,
        tenantId,
        submissionId,
        "returned",
      );
    },
    withdrawn: async ({ submissionId, tenantId, session, get }) => {
      await get<StocktakeService>(STOCKTAKE_SERVICE).markStatus(
        session,
        tenantId,
        submissionId,
        "returned",
      );
    },
    rejected: async ({ submissionId, tenantId, session, get }) => {
      await get<StocktakeService>(STOCKTAKE_SERVICE).markStatus(
        session,
        tenantId,
        submissionId,
        "rejected",
      );
    },
    // 確認人 = 最後核准的人(`decidedBy`;每一關都跳過 = 申請人)
    completed: async ({ submissionId, tenantId, decidedBy, session, get }) => {
      await get<StocktakeService>(STOCKTAKE_SERVICE).apply(
        session,
        tenantId,
        submissionId,
        decidedBy?.id ?? null,
      );
    },
  },
});
