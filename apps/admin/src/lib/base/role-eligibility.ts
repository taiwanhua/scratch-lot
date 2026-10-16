import type { OrgNodeLike } from "./org-tree";

/**
 * 「被授予角色的資格」的**前端投影**(規則正本 ADR-0003、api 正本
 * `apps/api/src/users/org-qualification.service.ts`):使用者的所屬組織中,
 * 至少一個落在該角色擁有組織的子樹內。
 *
 * 前端為什麼也要算一次:兩個跳窗都改成「範圍外的照樣列出、但 disabled 並說明原因」
 * (#261 的 6 / 7)—— 不列出來的話,使用者只會覺得「我要的那個人 / 那個角色不見了」。
 * **判定權仍在 api**:送出時 `assignUserRoles` / `grantRoleUsers` 會回 `USER_NOT_ELIGIBLE`,
 * 前端這一份只決定「列要不要灰掉」,算錯也不會放行。
 *
 * 樹的來源是 `orgTree`(操作者的管理範圍);樹上看不到的組織一律視為不在子樹內 —
 * 與 api 的 fail-closed 一致。
 */

/** 組織 id → 從樹根到它的整條路徑(含自己)。一次建好,逐列查表不必重走樹。 */
export type OrgTrailIndex = ReadonlyMap<string, readonly string[]>;

const indexInto = (
  nodes: readonly OrgNodeLike[],
  trail: readonly string[],
  into: Map<string, readonly string[]>,
): void => {
  for (const node of nodes) {
    const next = [...trail, node.id];
    into.set(node.id, next);
    indexInto(node.children ?? [], next, into);
  }
};

export const orgTrailIndex = (nodes: readonly OrgNodeLike[]): OrgTrailIndex => {
  const index = new Map<string, readonly string[]>();
  indexInto(nodes, [], index);
  return index;
};

/** 這個組織落在 `rootId` 的子樹內嗎(含自己)。 */
export const isOrgInSubtree = (
  orgId: string,
  rootId: string,
  index: OrgTrailIndex,
): boolean => index.get(orgId)?.includes(rootId) ?? false;

/**
 * 有資格 = 所屬組織任一落在擁有組織的子樹內。
 * 沒有擁有組織的角色一律無資格(與 `OrgQualificationService.qualifies` 同一條)。
 */
export const isEligibleForRole = (
  memberOrgIds: readonly string[],
  ownerOrgId: string | null,
  index: OrgTrailIndex,
): boolean =>
  ownerOrgId !== null &&
  memberOrgIds.some((orgId) => isOrgInSubtree(orgId, ownerOrgId, index));

/** 樹上找得到這個組織嗎(找不到 = 管理範圍外,判定退回 fail-closed)。 */
export const isOrgKnown = (orgId: string, index: OrgTrailIndex): boolean =>
  index.has(orgId);
