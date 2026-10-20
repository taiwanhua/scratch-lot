// 共用清單的租戶檢查讀原生 orgs(同 BaseRepository.withModuleTenant 推導 tenantId 的讀法):
// orgs 掛治理類過濾,分享者不一定管得到要共用的組織;只取 ancestors、條件明列 id。
//
// **資料層直接丟 GraphQLError(VALIDATION_FAILED)的唯一例外**:其餘資料層錯誤都是程式錯誤
// (`TenantScopeError`),只有「共用給」選錯組織是使用者輸入錯誤;檢查放在 BaseRepository 才能讓
// 每個可共用的模組都繞不過,若改成丟內部錯誤,每個模組都要各自轉成同一個碼,漏一個就變成 INTERNAL。
import { GraphQLError } from "graphql";
import mongoose, { type ClientSession, type Connection, Types } from "mongoose";

import type { ShareOrg } from "./plugins/tenant-scope.plugin";
import { ORGS_COLLECTION } from "./schemas/org.schema";
import { tenantIdOfOrg } from "./tenant-id";

/**
 * 共用清單(`shareOrgs`,ADR-0014)的正規化與租戶檢查;只由 `BaseRepository` 在建立 / 更新時呼叫。
 *
 * 「共用給」可以選整個租戶的組織(包含分享者自己看不到的):共用只讓對方看得到,不讓分享者看更多。
 * 所以這裡**不**檢查可見範圍,只檢查「每個組織都存在、且都在這筆資料的租戶」;
 * 別租戶或不存在的組織一律 `VALIDATION_FAILED`(fields: ["shareOrgs"]),是使用者輸入錯誤、不是程式錯誤。
 */

/** 呼叫端給的一筆(GraphQL input 的 id 是字串;`includeDescendants` 缺席 = 不含下層)。 */
export interface ShareOrgInput {
  orgId: Types.ObjectId | string;
  includeDescendants?: boolean | null;
}

/** 共用清單不合法:別租戶 / 不存在的組織、不是合法 id。 */
export function shareOrgsValidationError(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "VALIDATION_FAILED", fields: ["shareOrgs"] },
  });
}

/**
 * 轉成存檔形狀:id 轉 ObjectId、同一組織只留一筆(任一筆勾了含下層就算含下層)。
 * 不是陣列 / id 不合法 → `VALIDATION_FAILED`。
 */
export function normalizeShareOrgs(value: unknown): ShareOrg[] {
  if (!Array.isArray(value)) {
    throw shareOrgsValidationError("shareOrgs must be a list");
  }
  const byId = new Map<string, ShareOrg>();
  for (const entry of value as unknown[]) {
    const { orgId, includeDescendants } = (entry ?? {}) as ShareOrgInput;
    const id = String(orgId);
    if (!Types.ObjectId.isValid(id)) {
      throw shareOrgsValidationError(`shareOrgs has an invalid org id: ${id}`);
    }
    const previous = byId.get(id);
    byId.set(id, {
      orgId: new Types.ObjectId(id),
      includeDescendants:
        includeDescendants === true || previous?.includeDescendants === true,
    });
  }
  return [...byId.values()];
}

/**
 * 清單裡每個組織的租戶(依 `ancestors` 推導);有任何一個不存在或是根組織 → `VALIDATION_FAILED`。
 * 回傳去重後的租戶 id(呼叫端再判斷是否只有一個、是否等於資料的租戶)。
 */
export async function tenantIdsOfShareOrgs(
  connection: Connection,
  shareOrgs: readonly ShareOrg[],
  session: ClientSession | null,
): Promise<Types.ObjectId[]> {
  if (shareOrgs.length === 0) {
    return [];
  }
  const ids = shareOrgs.map((entry) => entry.orgId);
  const orgs = await connection
    .collection<{ ancestors?: Types.ObjectId[]; deletedAt?: Date | null }>(
      ORGS_COLLECTION,
    )
    .find(
      { _id: { $in: ids }, deletedAt: null },
      { projection: { ancestors: 1 }, session: session ?? undefined },
    )
    .toArray();
  if (orgs.length !== ids.length) {
    throw shareOrgsValidationError("shareOrgs has an org that does not exist");
  }
  const tenants = new Map<string, Types.ObjectId>();
  for (const org of orgs) {
    const tenantId = tenantIdOfOrg({
      _id: new mongoose.Types.ObjectId(String(org._id)),
      ancestors: org.ancestors ?? [],
    });
    if (tenantId === null) {
      throw shareOrgsValidationError("shareOrgs cannot include the root org");
    }
    tenants.set(String(tenantId), tenantId);
  }
  return [...tenants.values()];
}

/** 清單必須全在 `tenantId` 這個租戶(資料的租戶;根組織的資料 = null,不能共用給任何人)。 */
export async function assertShareOrgsInTenant(
  connection: Connection,
  shareOrgs: readonly ShareOrg[],
  tenantId: Types.ObjectId | null,
  session: ClientSession | null,
): Promise<void> {
  const tenants = await tenantIdsOfShareOrgs(connection, shareOrgs, session);
  if (tenants.some((tenant) => tenantId === null || !tenant.equals(tenantId))) {
    throw shareOrgsValidationError(
      "shareOrgs can only include orgs of the same tenant",
    );
  }
}
