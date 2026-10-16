import {
  DEFAULT_TENANT_TIMEZONE,
  type ExpressionContext,
} from "@repo/domain/form";

/**
 * 表達式的 `ctx`(Spec 6a §5「歷史檢視的上下文」):
 * - 填寫 / 預覽:真正的現在 + 填寫者本人;時區 = 讀者的租戶時區(`me.currentOrg.timezone`,
 *   `useTenantTimezone`),還沒載到用預設的 `Asia/Taipei`(不用瀏覽器時區;api 送出時以租戶時區重算,以後端為準)
 * - 唯讀(詳情、修訂 r):整個由那一次修訂的 `ctx` 轉來,**不拿讀者現在的身分、組織或時間補任何一項**
 */
export const liveContextOf = (
  userId: string | null,
  orgId: string | null,
  now: Date = new Date(),
  timezone?: string | null,
): ExpressionContext => ({
  now: now.toISOString(),
  timezone: timezone ?? DEFAULT_TENANT_TIMEZONE,
  user: { id: userId, orgId },
});

export interface SubmissionContextLike {
  at: string;
  timezone: string;
  userId?: string | null;
  orgId?: string | null;
}

export const revisionContextOf = (
  ctx: SubmissionContextLike,
): ExpressionContext => ({
  now: ctx.at,
  timezone: ctx.timezone,
  user: { id: ctx.userId ?? null, orgId: ctx.orgId ?? null },
});
