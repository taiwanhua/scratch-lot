import {
  MAKEUP_PUNCH_FORM_KEY,
  MAKEUP_PUNCH_MODULE_KEY,
} from "@repo/domain/project/schedule-settings";

import { registerFormLifecycle } from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import type { MakeupPunchService } from "./makeup-punch.service";
import { MAKEUP_PUNCH_SERVICE } from "./makeup-punch.token";

/**
 * 補打卡申請的掛接點(規格 14.8;正本 `docs/modules/project/schedule.md`「出勤紀錄與補打卡」):
 *
 * - `beforeSubmit`:對應排班必選,而且是本人那天在那家店的已發布排班(或「沒有排班(臨時代班)」)
 * - `beforeApprove`:選的那筆排班被刪除 → 擋下(審核頁顯示警告、只能退回讓本人重選);只改時間照常核准
 * - `completed`:寫一張打卡(source = 補打卡,對應排班 = 申請時選的那一筆,不自動找)
 */
export const makeupPunchLifecycle = registerFormLifecycle({
  moduleKey: MAKEUP_PUNCH_MODULE_KEY,
  formKey: MAKEUP_PUNCH_FORM_KEY,
  inject: [MAKEUP_PUNCH_SERVICE],
  guards: {
    beforeSubmit: ({ operator, submission, values, get }) =>
      get<MakeupPunchService>(MAKEUP_PUNCH_SERVICE).checkSubmit(
        operator,
        submission.tenantId,
        values as Record<string, unknown>,
      ),
    beforeApprove: ({ operator, submission, values, get }) =>
      get<MakeupPunchService>(MAKEUP_PUNCH_SERVICE).checkApprove(
        operator,
        submission.tenantId,
        values as Record<string, unknown>,
      ),
  },
  effects: {
    completed: async ({ submissionId, tenantId, session, get }) => {
      await get<MakeupPunchService>(MAKEUP_PUNCH_SERVICE).complete(
        submissionId,
        tenantId,
        session,
      );
    },
  },
});
