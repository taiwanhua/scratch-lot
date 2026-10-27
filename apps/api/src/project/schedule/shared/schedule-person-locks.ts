import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { ScheduleEntryLocksRepository } from "../../database/schedule/roster.repositories";
import { isDuplicateKeyError } from "./schedule-error";

/**
 * 「人」守門文件(`schedule_entry_locks`,一個租戶一人一筆,歸屬租戶頂層):寫入一個人的排班或畫休時,
 * 交易外先建好(`ensure`),交易一開始 `$inc`(`touch`)。同一個人在兩家店同時被排、或排班與畫休同時寫入,
 * 兩個交易在這筆文件上衝突、由 `TransactionService` 重跑,重跑的一方讀到對方寫的資料 ——
 * 跨店不能重疊、畫休那段時間不能排,才不會被同時送出繞過。
 *
 * 排班表與畫休都用它;放在 `shared/`,兩邊不互相依賴。以 `tenantBoundaryContext` 寫
 * (`TENANT_BOUNDARY_CONTEXT_CALLERS` 用途「例外寫入」)。
 */
@Injectable()
export class SchedulePersonLocks {
  constructor(
    private readonly locks: ScheduleEntryLocksRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  /** 交易外先建好(兩個請求同時建,唯一索引擋下的那一個略過)。 */
  async ensure(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<void> {
    const writer = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const key = { orgId: tenantId, userId };
    if (await this.locks.findOne(writer, key)) {
      return;
    }
    try {
      await this.locks.create(writer, { ...key, version: 0 });
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
  }

  /**
   * 交易一開始 `$inc`:之後讀到的排班 / 畫休就是這一刻之後的快照,同時寫同一個人的另一方會衝突重跑。
   * 碰不到文件(應該已在交易外建好)→ 丟錯,不靜默失去保護。
   */
  async touch(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<void> {
    const writer = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const touched = await this.locks.findOneAndUpdate(
      writer,
      { orgId: tenantId, userId },
      { $inc: { version: 1 } },
    );
    if (!touched) {
      throw new Error(`schedule person lock missing: user ${String(userId)}`);
    }
  }
}
