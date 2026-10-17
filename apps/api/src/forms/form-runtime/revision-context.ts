import type { ExpressionContext } from "@repo/domain/form";

import type { FormRevision } from "../../database/schemas/form-submission.schema";

/**
 * 一次送出 / 修改的上下文 → 表達式的 `ctx.*`(Spec §4 `revisions[].ctx`)。表單引擎的唯讀檢視與流程推進
 * (跳過條件用送出當時,不用推進當下)共用這一份。快照沒有 `tenantId` / `orgIds` 的舊修訂 →
 * `ctx.tenant.id = null`、`ctx.user.orgIds = []`(不拿讀者或現在的身分補值)。
 */
export function expressionContextOf(
  ctx: FormRevision["ctx"],
): ExpressionContext {
  return {
    now: new Date(ctx.at).toISOString(),
    timezone: ctx.timezone,
    user: {
      id: ctx.userId ? String(ctx.userId) : null,
      orgId: ctx.orgId ? String(ctx.orgId) : null,
      orgIds: (ctx.orgIds ?? []).map(String),
    },
    tenant: { id: ctx.tenantId ? String(ctx.tenantId) : null },
  };
}
