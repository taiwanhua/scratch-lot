import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { TransactionService } from "../../../database/transaction";
import { ScheduleEntryLocksRepository } from "../../database/schedule/roster.repositories";
import { isDuplicateKeyError } from "./schedule-error";

/** `ensureMany` 撞到唯一索引(別的請求同時建了其中幾筆)時重讀再建的次數上限。 */
const ENSURE_MANY_ATTEMPTS = 3;

/**
 * 「人」守門文件(`schedule_entry_locks`,一個租戶一人一筆,歸屬租戶頂層):寫入一個人的排班或畫休時,
 * 交易外先建好(`ensure`),交易一開始 `$inc`(`touch`)。同一個人在兩家店同時被排、或排班與畫休同時寫入,
 * 兩個交易在這筆文件上衝突、由 `TransactionService` 重跑,重跑的一方讀到對方寫的資料 ——
 * 跨店不能重疊、畫休那段時間不能排,才不會被同時送出繞過。
 *
 * 排班表與畫休都用它;放在 `shared/`,兩邊不互相依賴。以 `tenantBoundaryContext` 寫
 * (`TENANT_BOUNDARY_CONTEXT_CALLERS` 用途「例外寫入」)。
 *
 * 一次碰多人(自動排班的全部候選人)用 `ensureMany` / `touchMany`:上下文只建一次、讀寫各一次(TX-06)。
 */
@Injectable()
export class SchedulePersonLocks {
  constructor(
    private readonly locks: ScheduleEntryLocksRepository,
    private readonly orgs: OrgsRepository,
    private readonly transactions: TransactionService,
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

  /**
   * 多人一次建好(交易外呼叫):一次讀出已有的,缺的在自己的小交易裡一次 `createMany`
   * (`createMany` 必須在交易內)。別的請求同時建了其中幾筆 → 唯一索引讓整批失敗、交易回復,
   * 重讀後只建還沒有的(最多 `ENSURE_MANY_ATTEMPTS` 次)。
   */
  async ensureMany(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    userIds: readonly Types.ObjectId[],
  ): Promise<void> {
    const unique = uniqueIds(userIds);
    if (unique.length === 0) {
      return;
    }
    const writer = await tenantBoundaryContext(this.orgs, operator, tenantId);
    for (let attempt = 1; ; attempt += 1) {
      const existing = await this.locks.findMany(writer, {
        orgId: tenantId,
        userId: { $in: unique },
      });
      const have = new Set(existing.map((lock) => String(lock.userId)));
      const missing = unique.filter((id) => !have.has(String(id)));
      if (missing.length === 0) {
        return;
      }
      try {
        await this.transactions.withTransaction(() =>
          this.locks.createMany(
            writer,
            missing.map((userId) => ({ orgId: tenantId, userId, version: 0 })),
          ),
        );
        return;
      } catch (error) {
        if (!isDuplicateKeyError(error) || attempt >= ENSURE_MANY_ATTEMPTS) {
          throw error;
        }
      }
    }
  }

  /**
   * 多人一次 `$inc`(交易一開始,同 `touch`):一次 `updateMany`,碰到的筆數不等於人數
   * (有人的文件不在,應該已在交易外建好)→ 丟錯,不靜默失去保護。
   */
  async touchMany(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    userIds: readonly Types.ObjectId[],
  ): Promise<void> {
    const unique = uniqueIds(userIds);
    if (unique.length === 0) {
      return;
    }
    const writer = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const touched = await this.locks.updateMany(
      writer,
      { orgId: tenantId, userId: { $in: unique } },
      { $inc: { version: 1 } },
    );
    if (touched !== unique.length) {
      throw new Error(
        `schedule person locks missing: touched ${String(touched)} of ${String(unique.length)}`,
      );
    }
  }
}

function uniqueIds(ids: readonly Types.ObjectId[]): Types.ObjectId[] {
  const seen = new Map(ids.map((id) => [String(id), id]));
  return [...seen.values()];
}
