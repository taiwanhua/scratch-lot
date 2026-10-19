/**
 * 開通時建立的角色(專案規格 3.3;開通清單正本 `docs/modules/project/lottery-onboarding.md`)。
 *
 * 三個角色在角色管理是**一般角色**,和租戶自己建的沒有差別,畫面不另外標示(底座的「預設角色」只指
 * 租戶管理員副本)。權限配方由各模組一段登記(`role-grants/`),這裡只負責角色本身與合併。
 */

/** 開通腳本與示範資料指定角色用的 key(程式不寫死角色 id;id 每個租戶不同,建立時取得)。 */
export const ONBOARDING_ROLE_KEYS = ["hq", "store-manager", "clerk"] as const;

export type OnboardingRoleKey = (typeof ONBOARDING_ROLE_KEYS)[number];

export interface OnboardingRole {
  key: OnboardingRoleKey;
  /** 角色管理顯示的名稱;重跑時以它找回同一個角色。 */
  name: string;
  description: string;
}

export const ONBOARDING_ROLES: readonly OnboardingRole[] = [
  {
    key: "hq",
    name: "總部管理",
    description: "開通時建立:全部權限;叫貨單、支援需求單的審核者",
  },
  {
    key: "store-manager",
    name: "店長",
    description: "開通時建立:店面管理、庫存、單據、叫貨進貨調貨、報表",
  },
  {
    key: "clerk",
    name: "店員",
    description: "開通時建立:銷售、兌獎、開班、盤點與結帳、我的班表",
  },
];

export function isOnboardingRoleKey(
  value: unknown,
): value is OnboardingRoleKey {
  return (ONBOARDING_ROLE_KEYS as readonly unknown[]).includes(value);
}

/** 一個角色的授予(`saveRoleMatrix` 的形狀:`*` 代表該模組這一層全部)。 */
export interface RoleGrant {
  moduleKeys: readonly string[];
  permissionKeys: readonly string[];
}

/**
 * 一個模組(或一組模組)對三個角色的授予:**每個模組一段**,由該模組的 owner 票追加到
 * `role-grants/index.ts`(規格 3.3)。沒有列的角色 = 這個模組不給。
 */
export interface ModuleRoleGrants {
  /** 這段是哪個模組的配方(出現在開通腳本的輸出與測試訊息裡)。 */
  section: string;
  grants: Partial<Record<OnboardingRoleKey, RoleGrant>>;
}

/** 一個角色在所有段落的授予合併(去重、保持宣告順序)。 */
export function roleGrantOf(
  role: OnboardingRoleKey,
  sections: readonly ModuleRoleGrants[],
): RoleGrant {
  const moduleKeys = new Set<string>();
  const permissionKeys = new Set<string>();
  for (const { grants } of sections) {
    const grant = grants[role];
    for (const key of grant?.moduleKeys ?? []) {
      moduleKeys.add(key);
    }
    for (const key of grant?.permissionKeys ?? []) {
      permissionKeys.add(key);
    }
  }
  return { moduleKeys: [...moduleKeys], permissionKeys: [...permissionKeys] };
}

/** 一個模組這一層的全部權限(`<模組 key>.*`)。 */
export function everything(moduleKey: string): string {
  return `${moduleKey}.*`;
}
