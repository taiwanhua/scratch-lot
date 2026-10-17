import { Injectable, Logger } from "@nestjs/common";
import { Types } from "mongoose";

import { UserDelegationsRepository } from "../../database/database.module";
import {
  TenantDirectoryService,
  systemContext,
} from "../tenant-directory.service";

/** 套用代理後的審核者名單。 */
export interface DelegatedAssignees {
  /** 換過的名單(在代理期間的人換成代理人;順序同原名單)。 */
  assigneeIds: string[];
  /** 代理人 id → 原審核者 id(只有真的換了的;同一位代理人代好幾位時記第一位)。 */
  delegatorOf: Record<string, string>;
}

/** 推進當下的上下文。 */
export interface DelegationContext {
  tenantId: Types.ObjectId;
  /** 申請人(代理人是申請人時不換,任務留在原審核者名下)。 */
  applicantId: string | null;
  now: Date;
}

/**
 * B15 代理人(《底座規格》3.7):進關解析審核者後,把**此刻在代理期間**的人換成他的代理人。
 *
 * | 情況                                    | 結果                                                   |
 * | --------------------------------------- | ------------------------------------------------------ |
 * | 審核者在代理期間(`startAt <= now < endAt`) | 換成代理人,`delegatorOf` 記原審核者                     |
 * | 代理人停用 / 不在本租戶                  | 不換(照原審核者派任),記 log                            |
 * | 代理人是申請人                          | 不換(任務留在原審核者名下,避免自己審自己)              |
 * | 原審核者是申請人                        | 不換(申請人照一般規則剔除或 B5 自動通過,不讓代理繞過) |
 * | 代理人自己也在代理期間(B → C)            | 仍派給代理人,不往下傳(不做代理鏈)                     |
 *
 * 只在進關那一次換;已派出的任務不會因為之後才開始的代理而轉(計畫固定)。
 * 讀取依序 `await`(TX-02):推進在交易內呼叫這裡。
 */
@Injectable()
export class AssigneeDelegationService {
  private readonly logger = new Logger(AssigneeDelegationService.name);

  constructor(
    private readonly delegations: UserDelegationsRepository,
    private readonly directory: TenantDirectoryService,
  ) {}

  async apply(
    assigneeIds: readonly string[],
    ctx: DelegationContext,
  ): Promise<DelegatedAssignees> {
    const candidates = [...new Set(assigneeIds)].filter(
      (id) => id !== ctx.applicantId && Types.ObjectId.isValid(id),
    );
    if (candidates.length === 0) {
      return { assigneeIds: [...assigneeIds], delegatorOf: {} };
    }
    const active = await this.delegations.findMany(systemContext(), {
      userId: { $in: candidates.map((id) => new Types.ObjectId(id)) },
      startAt: { $lte: ctx.now },
      endAt: { $gt: ctx.now },
    });
    const delegateOf = new Map<string, Types.ObjectId>();
    for (const delegation of active) {
      // 同一個人的代理期間不重疊(建立時擋),此刻至多一筆;萬一有多筆取第一筆
      if (!delegateOf.has(String(delegation.userId))) {
        delegateOf.set(String(delegation.userId), delegation.delegateUserId);
      }
    }
    if (delegateOf.size === 0) {
      return { assigneeIds: [...assigneeIds], delegatorOf: {} };
    }
    const eligible = await this.directory.eligibleUserIds(ctx.tenantId, [
      ...delegateOf.values(),
    ]);
    const delegatorOf: Record<string, string> = {};
    const result = assigneeIds.map((id) => {
      const delegate = delegateOf.get(id);
      if (delegate === undefined) {
        return id;
      }
      const delegateId = String(delegate);
      if (delegateId === ctx.applicantId) {
        return id;
      }
      if (!eligible.has(delegateId)) {
        this.logger.warn(
          `審核者 ${id} 在代理期間,但代理人 ${delegateId} 已停用或不在租戶 ${String(ctx.tenantId)},照原審核者派任`,
        );
        return id;
      }
      // 代理人本來就在名單裡 → 他自己那一項為準(不記成代理)
      if (!assigneeIds.includes(delegateId) && !(delegateId in delegatorOf)) {
        delegatorOf[delegateId] = id;
      }
      return delegateId;
    });
    return { assigneeIds: result, delegatorOf };
  }
}
