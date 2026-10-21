import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotteryShiftPersonLocksRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { isDuplicateKeyError } from "../accounts/accounts-error";

/**
 * 開班的「人」守門文件(`lottery_shift_person_locks`,一個租戶一人一筆,歸屬租戶頂層):開班時交易外先建好
 * (`ensure`),交易一開始 `$inc`(`touch`)。同一個人在兩家店同時開班,兩個交易在這筆文件上衝突、
 * 由 `TransactionService` 重跑,重跑的一方讀得到對方剛開的班而被擋下(同一家店的兩個收銀點照樣都能開)。
 * 以 `tenantBoundaryContext` 寫(`TENANT_BOUNDARY_CONTEXT_CALLERS` 用途「例外寫入」)。
 */
@Injectable()
export class StorePersonLocks {
  constructor(
    private readonly locks: LotteryShiftPersonLocksRepository,
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

  /** 交易一開始 `$inc`;碰不到文件(應該已在交易外建好)→ 丟錯,不靜默失去保護。 */
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
      throw new Error(`shift person lock missing: user ${String(userId)}`);
    }
  }
}
