import type { WorkflowInstanceFieldsFragment } from "@repo/graphql";

import { type APPLICANT, STAMP } from "./workflow-fixtures";

/** 時間軸的一筆事件(`reason` = 跳過 / 自動通過的原因;`taskKey` 依關卡編 `<stepKey>-1`)。 */
export const historyEvent = (
  kind: string,
  stepKey: string | null,
  reason: string | null,
  who: typeof APPLICANT | null = null,
  code: string | null = null,
): WorkflowInstanceFieldsFragment["history"][number] => ({
  at: STAMP,
  kind,
  stepKey,
  taskKey: who === null || stepKey === null ? null : `${stepKey}-1`,
  user: who,
  toUser: null,
  comment: null,
  result: null,
  reason,
  code,
  delegators: [],
});

/** 自動通過被守門擋下(`auto_approve_blocked`;預設是「已在前關核准過」那一種,`code` = 專案錯誤碼)。 */
export const autoApproveBlockedEvent = (
  stepKey: string,
  who: typeof APPLICANT,
  code: string,
  reason = "auto_prior_approver",
): WorkflowInstanceFieldsFragment["history"][number] =>
  historyEvent("auto_approve_blocked", stepKey, reason, who, code);
