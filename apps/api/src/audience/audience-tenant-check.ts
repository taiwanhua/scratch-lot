import type { Types } from "mongoose";

import {
  type Audience,
  type AudienceLeaf,
  type AudienceNode,
  isAudienceGroup,
} from "@repo/domain/audience";

import type { TenantDirectoryService } from "../workflows/tenant-directory.service";

/**
 * 租戶端儲存人員條件時的租戶邊界檢查(`AudienceService` 的「租戶邊界不在這裡檢查條件本身」):
 * 條件裡指定的使用者(所屬組織在租戶子樹內)與角色(擁有組織在租戶子樹內)都要屬本租戶。
 * 回第一個不屬本租戶的值的路徑(與 `validateAudience` 的 `path` 同一種寫法,例
 * `filter.children[0].value.values[1]`);都屬本租戶 = null。通知收件人與側欄數字共用這一支。
 */
export async function outOfTenantPath(
  directory: TenantDirectoryService,
  tenantId: Types.ObjectId,
  audience: Audience,
): Promise<string | null> {
  if (audience.mode !== "match") {
    return null;
  }
  const leaves = leavesOf(audience.filter, "filter");
  const userIds = leaves.flatMap(({ leaf }) =>
    leaf.field === "user" && leaf.value.kind === "static"
      ? leaf.value.values
      : [],
  );
  const roleIds = leaves.flatMap(({ leaf }) =>
    leaf.field === "role" && leaf.value.kind === "static"
      ? leaf.value.values
      : [],
  );
  const tenantUsers =
    userIds.length === 0
      ? new Map<string, unknown>()
      : await directory.userFacts(tenantId, userIds);
  const tenantRoles =
    roleIds.length === 0
      ? new Set<string>()
      : await directory.tenantRoleIds(tenantId);
  for (const { leaf, path } of leaves) {
    if (leaf.value.kind !== "static") {
      continue;
    }
    const outside = leaf.value.values.findIndex((value) =>
      leaf.field === "user"
        ? !tenantUsers.has(value)
        : leaf.field === "role" && !tenantRoles.has(value),
    );
    if (outside !== -1) {
      return `${path}.value.values[${String(outside)}]`;
    }
  }
  return null;
}

/** 條件樹的每個條件列與它的路徑(與 `validateAudience` 的 `path` 同一種寫法)。 */
function leavesOf(
  node: AudienceNode,
  path: string,
): { leaf: AudienceLeaf; path: string }[] {
  if (!isAudienceGroup(node)) {
    return [{ leaf: node, path }];
  }
  return node.children.flatMap((child, index) =>
    leavesOf(child, `${path}.children[${String(index)}]`),
  );
}
