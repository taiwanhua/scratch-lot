/**
 * 主管的解析(`org_manager`)的純規則部分。
 * api 的 `resolveManagers(applicantId, submissionOrgId, tenantId, level)` 負責讀資料
 * (提交組織的祖先鏈、各組織的 `org_manager`、使用者啟用與租戶歸屬),再交給這裡決定名單。
 */

export interface ManagerResolutionInput {
  /**
   * 從**提交的 `orgId`** 往上到**提交的 `tenantId`**(含兩端)的組織 id,依序由近到遠。
   * 起點是提交所屬組織,不是申請人現在的當前組織;上界是租戶頂層,不往根組織走。
   */
  orgChain: readonly string[];
  /** 組織 id → 該組織的主管 id(只含啟用中、仍在本租戶的使用者;api 已過濾)。 */
  managersByOrg: ReadonlyMap<string, readonly string[]>;
  /** 申請人(不能自審)。 */
  applicantId: string;
  /** 第幾層主管(1 起)。 */
  level: number;
}

/**
 * 沿組織鏈往上:遇到第一個「剔除申請人後仍有主管」的組織 = 第 1 層;`level = 2` 再往上找下一個。
 * 剔除後為空 → 視同該層沒有主管,繼續往上;到租戶頂層還找不到 → 空陣列(該關阻擋)。
 * `level` 不是正整數 → 空陣列(檢查器在發布前就擋了)。
 */
export function resolveManagersFrom(input: ManagerResolutionInput): string[] {
  if (!Number.isInteger(input.level) || input.level < 1) {
    return [];
  }
  let found = 0;
  for (const orgId of input.orgChain) {
    const listed = input.managersByOrg.get(orgId);
    const managers =
      listed === undefined
        ? []
        : [...new Set(listed)].filter((id) => id !== input.applicantId);
    if (managers.length === 0) {
      continue;
    }
    found += 1;
    if (found === input.level) {
      return managers;
    }
  }
  return [];
}

/**
 * 提交組織到租戶頂層的鏈:`ancestors` 是物化路徑 `[根, 租戶頂層, …, 上層]`(ADR-0005)。
 * 回 `[提交組織, 上層, …, 租戶頂層]`;提交組織不在該租戶底下(資料不一致)→ 空陣列
 * (不往租戶外找)。
 */
export function orgChainToTenant(
  orgId: string,
  ancestors: readonly string[],
  tenantId: string,
): string[] {
  if (orgId === tenantId) {
    return [orgId];
  }
  const tenantIndex = ancestors.indexOf(tenantId);
  if (tenantIndex === -1) {
    return [];
  }
  return [orgId, ...ancestors.slice(tenantIndex).toReversed()];
}
