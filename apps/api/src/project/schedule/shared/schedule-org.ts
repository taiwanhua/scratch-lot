import { Types } from "mongoose";

import type { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { systemTenantReader } from "../../../database/system-tenant-reader";
import { notFoundError, validationError } from "./schedule-error";

/**
 * 排班設定「沿組織樹往上找」的共用部分。
 *
 * 範本、週範本、行事曆、規則設定都宣告「上層沿用到下層」(ADR-0014):分店的人看得到所屬組織上層鏈建的,
 * 直接以操作者的上下文讀,條件另釘本檔算出的組織鏈。組織本身(`orgs` 掛治理類過濾)以
 * `scheduleOrgReader` 讀:可見範圍 + 所屬組織的上層鏈,不提升成全部。
 */

/**
 * 讀組織(名稱、上層鏈)用的上下文:`orgs` 吃管理範圍,這裡是業務用途 ——
 * 改成「可見範圍 ∪ 所屬組織的上層鏈」(上層鏈本來就看得到它們建的排班設定)。根組織成員照舊看全部。
 */
export function scheduleOrgReader(operator: OperatorContext): OperatorContext {
  if (operator.visibleOrgIds === "all") {
    return { ...operator, managedOrgIds: operator.visibleOrgIds };
  }
  const ids = new Map<string, Types.ObjectId>(
    operator.visibleOrgIds.map((id) => [String(id), id]),
  );
  for (const tenant of operator.memberTenants) {
    for (const id of tenant.ancestorOrgIds) {
      ids.set(String(id), id);
    }
  }
  return { ...operator, managedOrgIds: [...ids.values()] };
}

/**
 * 以**租戶**為邊界的讀寫(ADR-0005 的 `systemTenantReader`:可見範圍 = 這個租戶的整棵組織樹)。
 * 只給「以人為準、跨店」的資料:畫休(屬於人、不分在哪家店登記)、守門文件(掛在租戶頂層)、
 * 排程與給其他功能的查詢;條件一律再釘 `tenantId`。有操作者時保留他的 id(基礎欄位與稽核記得是誰改的)。
 */
export async function scheduleTenantContext(
  orgs: OrgsRepository,
  operator: OperatorContext | null,
  tenantId: Types.ObjectId,
): Promise<OperatorContext> {
  const reader = await systemTenantReader(orgs, tenantId);
  return operator === null ? reader : { ...reader, actorId: operator.actorId };
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
  const org = await orgs.findById(scheduleOrgReader(operator), id);
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
  const found = await orgs.findMany(scheduleOrgReader(operator), {
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
