/* eslint-disable @repo/no-raw-model-query -- 單號計數器不是租戶資料(沒有組織歸屬與操作者),取號靠唯一索引 + `$inc` upsert 的原子更新,BaseRepository 沒有這種語意;每個方法都明給 tenantId;此檔是 `serial_counters` 唯一的讀寫出口;到期條件:無 */
import mongoose, { type ClientSession, type Model, type Types } from "mongoose";

import { isDuplicateKeyError } from "../forms/forms-error";
import { TenantScopeError } from "./plugins/tenant-scope.plugin";
import { ORGS_COLLECTION } from "./schemas/org.schema";
import type { SerialCounter } from "./schemas/serial-counter.schema";
import { assertTenantOrShared } from "./tenant-boundary";
import { tenantIdOfOrg } from "./tenant-id";

/**
 * `serial_counters` 的讀寫出口(`SerialService` 用;`docs/data-model.md`「serial_counters」)。
 */
export class SerialCountersStore {
  constructor(private readonly model: Model<SerialCounter>) {}

  /**
   * 取下一號:`(tenantId, key, period)` 的計數器 `$inc` 1(沒有就建,從 1 起),回新的號碼。
   * 兩個請求同時建同一個計數器時,後到的 upsert 撞唯一索引 → 重試一次就是一般的 `$inc`。
   * 在交易內(`session`)時,交易回復這次取的號也一起回復,不會跳號。
   */
  async next(
    tenantId: Types.ObjectId | null | undefined,
    key: string,
    period: string,
    session: ClientSession | null,
  ): Promise<number> {
    const tenant = assertTenantOrShared(tenantId, "serial_counters");
    const increment = () =>
      this.model
        .findOneAndUpdate(
          { tenantId: tenant, key, period },
          { $inc: { seq: 1 } },
          { upsert: true, returnDocument: "after", session },
        )
        .lean<{ seq: number } | null>()
        .exec();
    let counter: { seq: number } | null;
    try {
      counter = await increment();
    } catch (error) {
      // 交易內撞唯一索引會讓整個交易失敗(由交易入口重試),只有交易外才在這裡重試
      if (!isDuplicateKeyError(error) || session?.inTransaction() === true) {
        throw error;
      }
      counter = await increment();
    }
    if (counter === null) {
      throw new TenantScopeError(`serial_counters:${key} 取號失敗`);
    }
    return counter.seq;
  }

  /**
   * 某組織所屬的租戶(取號以資料歸屬組織的租戶為準);以原生 orgs 讀,只取 ancestors、條件明列 id
   * (同 `BaseRepository.withModuleTenant`)。組織不存在 → `TenantScopeError`(fail-closed)。
   */
  async tenantIdOfOrg(
    orgId: Types.ObjectId,
    session: ClientSession | null,
  ): Promise<Types.ObjectId | null> {
    const org = await this.model.db
      .collection<{ ancestors?: Types.ObjectId[] }>(ORGS_COLLECTION)
      .findOne(
        { _id: new mongoose.Types.ObjectId(String(orgId)) },
        { projection: { ancestors: 1 }, session: session ?? undefined },
      );
    if (!org) {
      throw new TenantScopeError(
        `serial_counters:組織 ${String(orgId)} 不存在,無法決定單號的租戶`,
      );
    }
    return tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors ?? [] });
  }
}
