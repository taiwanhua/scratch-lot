import type { GraphqlClient } from "../../../src/demo/graphql-client";
import type { OnboardingPlan } from "./plan";
import type { OnboardingRoleKey } from "./roles";

/**
 * 新建的使用者怎麼取得密碼:真實租戶寄啟用信(本人自己設定);示範資料用示範密碼
 * (首登照一般規則要改密碼)。已存在的使用者一律不動密碼。
 */
export type UserActivation =
  { mode: "EMAIL" } | { mode: "PASSWORD"; password: string };

/** 前面的步驟找到或建立的東西(後面的步驟靠它取 id;每一步重跑時都重新找,不靠上一次的執行)。 */
export interface OnboardingState {
  tenant: { id: string; name: string } | null;
  /** 分店名稱 → 組織 id。 */
  branchIds: Map<string, string>;
  /** 開通時建立的角色 → 角色 id(每個租戶不同)。 */
  roleIds: Map<OnboardingRoleKey, string>;
}

export interface OnboardingContext {
  /** 已登入成這個租戶的租戶管理員(操作紀錄記在他名下)。 */
  client: GraphqlClient;
  plan: OnboardingPlan;
  activation: UserActivation;
  /** 要開通的租戶短碼:登入者所屬的租戶不是它就停在第一步(防止用錯帳號開到別的租戶)。 */
  tenantSlug: string;
  state: OnboardingState;
}

/**
 * 開通腳本的一步:**冪等**(已經有的就沿用、不改回去),回傳給操作者看的結果行。
 * 失敗就丟錯(api 回的錯誤原樣往上),由 `runOnboarding` 停在這一步並列出。
 */
export interface OnboardingStep {
  key: string;
  /** 對應開通清單(`docs/modules/project/lottery-onboarding.md`)的項目名稱。 */
  title: string;
  run: (context: OnboardingContext) => Promise<string[]>;
}

export function emptyState(): OnboardingState {
  return { tenant: null, branchIds: new Map(), roleIds: new Map() };
}

/** 後面的步驟取租戶;「租戶」那一步還沒成功時是程式錯誤。 */
export function requireTenant(state: OnboardingState): {
  id: string;
  name: string;
} {
  if (state.tenant === null) {
    throw new Error("還沒有讀到租戶(「租戶」步驟要排在最前面)");
  }
  return state.tenant;
}

export function requireRoleId(
  state: OnboardingState,
  role: OnboardingRoleKey,
): string {
  const id = state.roleIds.get(role);
  if (id === undefined) {
    throw new Error(`還沒有角色「${role}」的 id(「角色」步驟要排在前面)`);
  }
  return id;
}

export function requireBranchId(state: OnboardingState, name: string): string {
  const id = state.branchIds.get(name);
  if (id === undefined) {
    throw new Error(`還沒有分店「${name}」的 id(「分店」步驟要排在前面)`);
  }
  return id;
}
