import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import type { InstantRange } from "@repo/domain/form";

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
} from "../../database/schedule/roster.repositories";
import { instantRangeFilter } from "../shared/schedule-dates";

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
 * (寫入時的「人」守門文件在 `shared/schedule-person-locks.ts`。)
 */
@Injectable()
export class RosterPeopleReader {
  constructor(
    private readonly entries: ScheduleEntriesRepository,
    private readonly orgs: OrgsRepository,
    private readonly users: UsersRepository,
  ) {}

  /** 這些人在租戶裡某段期間(排班日期落在半開的時點區間 `[from, to)`)的所有排班(任何分店)。 */
  async entriesOfPeople(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    userIds: readonly Types.ObjectId[],
    range: InstantRange,
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
        date: instantRangeFilter(range),
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
