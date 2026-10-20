import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import type { Persisted } from "../../../database/base.repository";
import {
  OrgsRepository,
  UsersRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import {
  ScheduleEntriesRepository,
  type ScheduleEntryDocument,
  ScheduleEntryLocksRepository,
} from "../../database/schedule/roster.repositories";
import { isDuplicateKeyError } from "../shared/schedule-error";

export type EntryRecord = Persisted<ScheduleEntryDocument>;

/** 讀使用者名稱用的上下文:`users` 不掛租戶過濾,範圍在此無作用,只為讓 BaseRepository 收得到上下文。 */
const NAMES_READER: OperatorContext = {
  actorId: null,
  currentOrgId: null,
  visibleOrgIds: [],
  managedOrgIds: [],
  memberOrgIds: [],
  roleIds: [],
  memberTenants: [],
};

/**
 * 排班表「以人為準」的讀取(規格 14.1「一個人同一時間只有一筆排班,跨店也不能重疊」、14.5「跨店與不可排」):
 * 一個人在**整個租戶**裡的排班 —— 包含操作者看不到的分店。以底座 `tenantBoundaryContext` 讀
 * (`TENANT_BOUNDARY_CONTEXT_CALLERS` 登記用途「以人為準的資料」);只回時間與分店 id,
 * 看不到的分店由呼叫端只寫「已排於其他分店」。
 *
 * 寫入排班前另碰這個人的守門文件(`schedule_entry_locks`,一個租戶一人一筆,歸屬租戶頂層;用途「例外寫入」):
 * 同一個人在兩家店同時被排時,兩個交易在這筆文件上衝突、重跑後讀到對方的排班,跨店重疊才擋得住。
 */
@Injectable()
export class RosterPeopleReader {
  constructor(
    private readonly entries: ScheduleEntriesRepository,
    private readonly locks: ScheduleEntryLocksRepository,
    private readonly orgs: OrgsRepository,
    private readonly users: UsersRepository,
  ) {}

  /** 這些人在租戶裡某段日期(`YYYY-MM-DD`,含頭尾)的所有排班(任何分店)。 */
  async entriesOfPeople(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    userIds: readonly Types.ObjectId[],
    from: string,
    to: string,
  ): Promise<EntryRecord[]> {
    if (userIds.length === 0) {
      return [];
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    return this.entries.findMany(
      reader,
      {
        tenantId,
        userId: { $in: [...userIds] },
        date: { $gte: from, $lte: to },
      },
      { sort: { startAt: 1 } },
    );
  }

  /** 這個人在租戶裡和這段時間重疊的排班(任何分店;不含 `excludeId` 那一筆;相接不算重疊)。 */
  async overlapping(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    userId: Types.ObjectId,
    startAt: Date,
    endAt: Date,
    excludeId: Types.ObjectId | null,
  ): Promise<EntryRecord[]> {
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    return this.entries.findMany(reader, {
      tenantId,
      userId,
      startAt: { $lt: endAt },
      endAt: { $gt: startAt },
      ...(excludeId === null ? {} : { _id: { $ne: excludeId } }),
    });
  }

  /** 這個人的守門文件先建好(交易外;兩個請求同時建,唯一索引擋下的那一個略過)。 */
  async ensurePersonLock(
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
   * 交易一開始對這個人的守門文件 `$inc`:之後讀到的排班就是這一刻之後的快照,同時寫同一個人的另一方
   * 會衝突重跑。碰不到文件(應該已在交易外建好)→ 丟錯,不靜默失去保護。
   */
  async touchPersonLock(
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
      throw new Error(`schedule entry lock missing: user ${String(userId)}`);
    }
  }

  /** 使用者名稱(id 字串 → 名稱);`users` 是關聯歸屬資料,條件釘死在明列的 id 上。 */
  async namesOf(
    ids: readonly (Types.ObjectId | string)[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.map(String))];
    if (unique.length === 0) {
      return new Map();
    }
    const users = await this.users.findMany(NAMES_READER, {
      _id: { $in: unique.map((id) => new Types.ObjectId(id)) },
    });
    return new Map(users.map((user) => [String(user._id), user.name]));
  }
}
