import { Types } from "mongoose";

import type { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { notFoundError, validationError } from "./schedule-error";

/**
 * 排班設定「沿組織樹往上找」的共用部分(先例:欄位管理的 `fields/field-visibility.ts`)。
 *
 * 上層組織通常不在操作者的可見範圍裡(分店的人看不到最上層組織),掛在排班表上的
 * `tenantScopePlugin` 會把上層的範本、規則、行事曆濾掉 —— 所以讀「上層繼承」的資料時用
 * `scheduleReadContext`(範圍提升),並一律配**明列 orgId**(本檔算出的組織鏈)的條件。
 */
export function scheduleReadContext(
  operator: OperatorContext,
): OperatorContext {
  return { ...operator, visibleOrgIds: "all", managedOrgIds: "all" };
}

/**
 * 沒有登入主體的讀寫(排程、給其他功能的查詢):範圍放開為 `"all"`(同底座
 * `workflows/tenant-directory.service.ts` 的 `systemContext`),**只准搭配把查詢釘在某個租戶內的條件**
 * (`tenantId` 與明列的 id)。
 */
export function scheduleSystemReader(): OperatorContext {
  return {
    actorId: null,
    currentOrgId: null,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    memberOrgIds: [],
    roleIds: [],
  };
}

export interface ScheduleOrg {
  id: Types.ObjectId;
  name: string;
  /** 租戶頂層(最上層組織)id */
  tenantId: Types.ObjectId;
  /** 自己 → 上層 → … → 最上層組織(不含根組織);生效值依這個順序找 */
  chain: Types.ObjectId[];
  /** 自己就是最上層組織(規則要 `edit-default-rules`) */
  isTenantTop: boolean;
}

export function parseObjectId(value: string, field: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw validationError(`${field} is not a valid id: ${value}`, [field]);
  }
  return new Types.ObjectId(value);
}

/**
 * 排班設定針對的組織:沒給 = 當前組織;要在操作者的**可見範圍**內(看不到 → `NOT_FOUND`);
 * 根組織不屬於任何租戶,沒有排班(→ `VALIDATION_FAILED`,欄位 `orgId`)。
 */
export async function resolveScheduleOrg(
  operator: OperatorContext,
  orgs: OrgsRepository,
  orgId: string | null | undefined,
): Promise<ScheduleOrg> {
  const id =
    orgId === undefined || orgId === null
      ? operator.currentOrgId
      : parseObjectId(orgId, "orgId");
  if (id === null || !isOrgVisible(operator, id)) {
    throw notFoundError(`org not found: ${String(orgId ?? id)}`);
  }
  const org = await orgs.findById(scheduleReadContext(operator), id);
  if (!org) {
    throw notFoundError(`org not found: ${String(id)}`);
  }
  const [, tenantTop, ...between] = org.ancestors;
  if (tenantTop === undefined && org.ancestors.length === 0) {
    throw validationError("the root org has no schedule settings", ["orgId"]);
  }
  const tenantId = tenantTop ?? org._id;
  // ancestors = [根, 租戶頂層, …, 父];鏈 = 自己 → 父 → … → 租戶頂層
  const upper = tenantTop === undefined ? [] : [tenantTop, ...between];
  return {
    id: org._id,
    name: org.name,
    tenantId,
    chain: [org._id, ...upper.toReversed()],
    isTenantTop: tenantTop === undefined,
  };
}

/** 一次取多個組織的名稱(id 字串 → 名稱);查詢釘死在這些 id 上。 */
export async function loadOrgNames(
  operator: OperatorContext,
  orgs: OrgsRepository,
  ids: readonly Types.ObjectId[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.map(String))];
  if (unique.length === 0) {
    return new Map();
  }
  const found = await orgs.findMany(scheduleReadContext(operator), {
    _id: { $in: unique.map((id) => new Types.ObjectId(id)) },
  });
  return new Map(found.map((org) => [String(org._id), org.name]));
}

/** 這個組織是不是操作者看得到的(看不到上層時規則頁只寫「沿用上層設定」,不露出名稱)。 */
export function isVisibleOrg(
  operator: OperatorContext,
  orgId: Types.ObjectId,
): boolean {
  return isOrgVisible(operator, orgId);
}
