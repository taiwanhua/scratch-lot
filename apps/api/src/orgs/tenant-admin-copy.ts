import type { Types } from "mongoose";

import type { Persisted } from "../database/base.repository";
import type {
  RoleDocument,
  RolesRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import type { RelationService } from "../database/relation.service";
import {
  TEMPLATE_KEY_SETTING,
  TENANT_ADMIN_ROLE_KEY,
} from "./owner-protection.service";

/**
 * 租戶頂層底下的「租戶管理員副本」:`org_role` 由這個組織擁有、`settings.templateKey` 標記來源
 * (判準與擁有者保護同一條,ADR-0009 第 2 步)。找不到副本回 null。
 * 副本不只一份時取第一份(撤銷開通的前置檢查會以 `OWNS_ROLES` 擋下多出來的那幾份)。
 *
 * 使用處:撤銷開通(`tenant-ops.service.ts`,要一起抹掉的副本)、側欄數字設定(這個租戶開通了哪些模組)。
 */
export async function findTenantAdminCopy(
  deps: { relations: RelationService; roles: RolesRepository },
  reader: OperatorContext,
  tenantOrgId: Types.ObjectId,
): Promise<Persisted<RoleDocument> | null> {
  const ownedRoleIds = await deps.relations.listRoleIdsOfOrg(tenantOrgId);
  if (ownedRoleIds.length === 0) {
    return null;
  }
  const owned = await deps.roles.findMany(reader, {
    _id: { $in: ownedRoleIds },
  });
  return (
    owned.find(
      (role) => role.settings[TEMPLATE_KEY_SETTING] === TENANT_ADMIN_ROLE_KEY,
    ) ?? null
  );
}
