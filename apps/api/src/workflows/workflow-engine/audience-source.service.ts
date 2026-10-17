import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  AUDIENCE_FORM_FIELD_REF_PREFIX,
  type AudienceDynamicRef,
} from "@repo/domain/audience";
import {
  type AssigneeSource,
  audienceFormFieldRefsOf,
} from "@repo/domain/workflow";

import { AudienceService } from "../../audience/audience.service";
import { OrgManagersService } from "../../orgs/org-managers.service";
import { TenantDirectoryService } from "../tenant-directory.service";
import { assigneeKindUnknownError } from "../workflows-error";

/**
 * 依「這張單據」算人時要的上下文(審核者、知會對象共用)。
 * 全部取自提交與它的實例:`orgId` = 單據所屬組織(提交的 `orgId`)、`values` = 該修訂的表單內容。
 */
export interface SubmissionAudienceContext {
  tenantId: Types.ObjectId;
  /** 單據所屬組織(人員條件的「單據所屬組織」、主管往上找的起點) */
  orgId: Types.ObjectId | null;
  /** 申請人(主管解析要剔除他本人;剔除申請人的通則在 domain `buildPlan`) */
  applicantId: Types.ObjectId | null;
  /** 該修訂的表單內容(表單欄位 / 表單的組織欄位從這裡讀) */
  values: Record<string, unknown>;
}

/** 引用欄存的值 `{ id, ... }` → id;沒填 / 不是 id → null。 */
function referenceIdOf(stored: unknown): Types.ObjectId | null {
  const id =
    typeof stored === "object" && stored !== null && "id" in stored
      ? (stored as { id?: unknown }).id
      : undefined;
  return typeof id === "string" && Types.ObjectId.isValid(id)
    ? new Types.ObjectId(id)
    : null;
}

/**
 * 「依這張單據算出的人」(《底座規格》3.3;流程審核者與知會對象直接呼叫 `resolveAudienceSource`):
 *
 * | 來源     | 怎麼算                                                                                         |
 * | -------- | ---------------------------------------------------------------------------------------------- |
 * | 人員條件 | `AudienceService.listAudience`;動態組織來源代入:單據所屬組織 / 租戶 / 表單的組織欄位所選的組織 |
 * | 表單欄位 | 該修訂 `values[fieldKey]`(使用者引用欄)指到的人                                               |
 * | 主管     | 從單據所屬組織往上第 `level` 組主管(`OrgManagersService.resolveManagers`)                     |
 *
 * 回的名單**已收斂成啟用中、仍在本租戶的人**(人員條件由 `listAudience` 收斂,其餘以
 * `TenantDirectoryService.eligibleUserIds` 收斂);剔除申請人不在這裡(審核者由 domain `buildPlan` 做)。
 * 找不到人 → 空陣列(審核者:該關阻擋,可「新增審核者」)。
 *
 * 讀取依序 `await`(TX-02):推進在交易內呼叫這裡。
 */
@Injectable()
export class AudienceSourceService {
  constructor(
    private readonly audiences: AudienceService,
    private readonly directory: TenantDirectoryService,
    private readonly managers: OrgManagersService,
  ) {}

  async resolveAudienceSource(
    source: AssigneeSource,
    ctx: SubmissionAudienceContext,
  ): Promise<Types.ObjectId[]> {
    if (source.kind === "audience") {
      return this.audiences.listAudience(ctx.tenantId, source.audience, {
        resolveRef: (ref) => this.orgsOfRef(ref, ctx),
      });
    }
    const candidates = await this.candidatesOf(source, ctx);
    const eligible = await this.directory.eligibleUserIds(
      ctx.tenantId,
      candidates,
    );
    return candidates.filter((id) => eligible.has(String(id)));
  }

  /** 表單欄位 / 主管的候選名單(還沒過「啟用 / 在本租戶」)。 */
  private async candidatesOf(
    source: Exclude<AssigneeSource, { kind: "audience" }>,
    ctx: SubmissionAudienceContext,
  ): Promise<Types.ObjectId[]> {
    switch (source.kind) {
      case "field": {
        const id = referenceIdOf(ctx.values[source.fieldKey]);
        return id === null ? [] : [id];
      }
      case "manager": {
        if (ctx.applicantId === null || ctx.orgId === null) {
          return [];
        }
        return this.managers.resolveManagers(
          ctx.applicantId,
          ctx.orgId,
          ctx.tenantId,
          source.level,
        );
      }
      default: {
        // 型別上不會到這裡;落盤的舊資料(`users` / `role`)才會
        throw assigneeKindUnknownError((source as { kind?: unknown }).kind);
      }
    }
  }

  /**
   * 人員條件的動態組織來源 → 組織 id。表單的組織欄位沒填 → 空(那個條件列沒有人符合);
   * 欄位是不是組織引用欄由送出時檢查擋(`FIELD_NOT_ORG_REFERENCE`),這裡只讀值。
   * 通知用的 `event-org` 不屬於單據,這裡不代入。
   */
  private orgsOfRef(
    ref: AudienceDynamicRef,
    ctx: SubmissionAudienceContext,
  ): Types.ObjectId[] {
    if (ref === "tenant") {
      return [ctx.tenantId];
    }
    if (ref === "submission-org") {
      return ctx.orgId === null ? [] : [ctx.orgId];
    }
    if (ref.startsWith(AUDIENCE_FORM_FIELD_REF_PREFIX)) {
      const fieldKey = ref.slice(AUDIENCE_FORM_FIELD_REF_PREFIX.length);
      const id = referenceIdOf(ctx.values[fieldKey]);
      return id === null ? [] : [id];
    }
    return [];
  }
}

/**
 * 「依這張單據算人」算不到任何人時的原因(給 log 用;知會對象、逾時通知對象在送出 / 綁定時不檢查,
 * 執行時算不到人就不通知,但一定要記下是為什麼):
 * 表單欄位沒填 / 表單的組織欄位沒填 / 人員條件沒人符合 / 選到的人停用或不在本租戶 / 找不到主管。
 */
export function emptySourceReason(
  source: AssigneeSource,
  ctx: SubmissionAudienceContext,
): string {
  switch (source.kind) {
    case "field": {
      return referenceIdOf(ctx.values[source.fieldKey]) === null
        ? `表單欄位 ${source.fieldKey} 沒填`
        : `表單欄位 ${source.fieldKey} 選的人已停用或不在本租戶`;
    }
    case "audience": {
      const unfilled =
        source.audience.mode === "match"
          ? audienceFormFieldRefsOf(source.audience)
              .map((ref) => ref.fieldKey)
              .filter(
                (fieldKey) => referenceIdOf(ctx.values[fieldKey]) === null,
              )
          : [];
      return unfilled.length > 0
        ? `人員條件用的表單組織欄位 ${unfilled.join("、")} 沒填`
        : "人員條件沒有人符合";
    }
    case "manager": {
      return `單據所屬組織往上找不到第 ${String(source.level)} 組主管`;
    }
    default: {
      return "來源不明";
    }
  }
}
