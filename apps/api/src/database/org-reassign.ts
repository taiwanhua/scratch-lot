// 搬家(`BaseRepository.reassignOrg`)的組織檢查:讀原生 orgs(同 `share-orgs.ts` 與
// `BaseRepository.withModuleTenant` 的讀法)—— 搬入的組織可以是操作者看不到的(調貨給別店),
// orgs 掛治理類過濾、操作者不一定管得到;只取 ancestors、條件明列 id。
//
// 資料層直接丟 GraphQLError(VALIDATION_FAILED)的第二個例外(第一個是共用清單,理由同 `share-orgs.ts`):
// 搬到別租戶 / 根組織 / 不存在的組織是使用者輸入錯誤;檢查放在 BaseRepository,每個呼叫端都繞不過。
import { GraphQLError } from "graphql";
import mongoose, { type ClientSession, type Connection, Types } from "mongoose";

import { TenantScopeError } from "./plugins/tenant-scope.plugin";
import { ORGS_COLLECTION } from "./schemas/org.schema";
import { tenantIdOfOrg } from "./tenant-id";

/** 搬家的稽核動作名(`audit_logs.action`)。 */
export const ORG_REASSIGN_AUDIT_ACTION = "data.reassign-org";

/** 搬家的目標組織不合法:別租戶、根組織、不存在、已刪除或不是合法 id。 */
export function orgReassignValidationError(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "VALIDATION_FAILED", fields: ["orgId"] },
  });
}

/** 組織的租戶(`tenantIdOfOrg`);組織不存在 / 已刪除 → null。 */
async function tenantOf(
  connection: Connection,
  orgId: Types.ObjectId,
  session: ClientSession | null,
): Promise<{ found: boolean; tenantId: Types.ObjectId | null }> {
  const org = await connection
    .collection<{ ancestors?: Types.ObjectId[]; deletedAt?: Date | null }>(
      ORGS_COLLECTION,
    )
    .findOne(
      { _id: orgId, deletedAt: null },
      { projection: { ancestors: 1 }, session: session ?? undefined },
    );
  if (!org) {
    return { found: false, tenantId: null };
  }
  return {
    found: true,
    tenantId: tenantIdOfOrg({
      _id: new mongoose.Types.ObjectId(String(org._id)),
      ancestors: org.ancestors ?? [],
    }),
  };
}

/**
 * 搬入的組織:要存在、不能是根組織;回它的 id 與租戶。不合法 → `VALIDATION_FAILED`。
 * 不檢查可見範圍(可以搬到操作者看不到的同租戶組織)。
 */
export async function reassignTargetOf(
  connection: Connection,
  newOrgId: Types.ObjectId | string,
  session: ClientSession | null,
): Promise<{ orgId: Types.ObjectId; tenantId: Types.ObjectId }> {
  const id = String(newOrgId);
  if (!Types.ObjectId.isValid(id)) {
    throw orgReassignValidationError(`orgId is not a valid id: ${id}`);
  }
  const orgId = new Types.ObjectId(id);
  const target = await tenantOf(connection, orgId, session);
  if (!target.found) {
    throw orgReassignValidationError("orgId does not exist");
  }
  if (target.tenantId === null) {
    throw orgReassignValidationError("data cannot be moved to the root org");
  }
  return { orgId, tenantId: target.tenantId };
}

/**
 * 被搬資料目前歸屬組織的租戶;讀不到 → `TenantScopeError`(資料損毀,fail-closed)。
 * 根組織的資料回 null(呼叫端據此擋下:根組織的資料不屬於任何租戶,搬不進租戶)。
 */
export async function currentTenantOf(
  connection: Connection,
  modelName: string,
  orgId: Types.ObjectId,
  session: ClientSession | null,
): Promise<Types.ObjectId | null> {
  const current = await tenantOf(connection, orgId, session);
  if (!current.found) {
    throw new TenantScopeError(
      `${modelName}:所屬組織 ${String(orgId)} 不存在,無法判斷能不能搬`,
    );
  }
  return current.tenantId;
}
