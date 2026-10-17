import {
  DEFAULT_TENANT_TIMEZONE,
  type ExpressionContext,
} from "@repo/domain/form";

/**
 * 表達式的 `ctx`(Spec 6a §5「歷史檢視的上下文」):
 * - 填寫 / 預覽:真正的現在 + 填寫者本人(目前組織、所屬組織全部、租戶);時區 = 讀者的租戶時區
 *   (`me.currentOrg.timezone`,`useTenantTimezone`),還沒載到用預設的 `Asia/Taipei`(不用瀏覽器時區;
 *   api 送出時以租戶時區重算,以後端為準)
 * - 唯讀(詳情、修訂 r):整個由那一次修訂的 `ctx` 轉來,**不拿讀者現在的身分、組織或時間補任何一項**
 */
export interface LiveIdentity {
  userId: string | null;
  /** 目前組織(`ctx.user.orgId`) */
  orgId: string | null;
  /** 所屬組織全部(`ctx.user.orgIds`) */
  orgIds?: readonly string[];
  /** 租戶頂層(`ctx.tenant.id`;`me.currentOrg.tenantId`) */
  tenantId?: string | null;
}

/** 沒有填寫者(設計器畫布 / 版本檢視):身分全空。 */
export const NO_IDENTITY: LiveIdentity = { userId: null, orgId: null };

export const liveContextOf = (
  identity: LiveIdentity,
  now: Date = new Date(),
  timezone?: string | null,
): ExpressionContext => ({
  now: now.toISOString(),
  timezone: timezone ?? DEFAULT_TENANT_TIMEZONE,
  user: {
    id: identity.userId,
    orgId: identity.orgId,
    orgIds: [...(identity.orgIds ?? [])],
  },
  tenant: { id: identity.tenantId ?? null },
});

export interface SubmissionContextLike {
  at: string;
  timezone: string;
  userId?: string | null;
  orgId?: string | null;
  orgIds?: readonly string[] | null;
  tenantId?: string | null;
}

export const revisionContextOf = (
  ctx: SubmissionContextLike,
): ExpressionContext => ({
  now: ctx.at,
  timezone: ctx.timezone,
  user: {
    id: ctx.userId ?? null,
    orgId: ctx.orgId ?? null,
    orgIds: [...(ctx.orgIds ?? [])],
  },
  tenant: { id: ctx.tenantId ?? null },
});
