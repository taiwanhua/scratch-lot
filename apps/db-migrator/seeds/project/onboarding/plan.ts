/**
 * 開通腳本要建的內容(一家新租戶的資料):示範資料由 `seeds/project/demo/` 組出,
 * 真實租戶由開通 skill 問完操作者後寫成 JSON 檔(同一個形狀;**不含任何密碼**)交給 `onboard` 指令。
 *
 * 之後的模組票若要開通時建資料(例:收銀點、乙類、銀行帳戶、排班人員),在這裡加自己的欄位
 * (選填、預設空清單)、在 `parseOnboardingPlan` 驗它,並在 `steps.ts` 追加自己的步驟。
 */
import {
  ONBOARDING_ROLE_KEYS,
  type OnboardingRoleKey,
  isOnboardingRoleKey,
} from "./roles";

export interface OnboardingBranch {
  /** 分店名稱(租戶頂層的直接下層組織);重跑時以名稱找回。 */
  name: string;
}

export interface OnboardingUser {
  /** 登入帳號(全系統唯一);重跑時以它找回同一個人,已存在就不改他的密碼與基本資料。 */
  account: string;
  email: string;
  name: string;
  /** 所屬分店(名稱,須在 `branches` 內)。 */
  branches: string[];
  /** 總部人員:一律同時加入租戶本身(最上層組織);總部是某家分店時也加入那家店(開通清單第 2 點)。 */
  headquarters: boolean;
  roles: OnboardingRoleKey[];
}

export interface OnboardingPosition {
  /** 選項代碼(英文 kebab-case,同一類別內唯一)。 */
  value: string;
  label: string;
}

export interface OnboardingPlan {
  branches: OnboardingBranch[];
  /** 總部是某家分店時填那家店的名稱(須在 `branches` 內);總部就是租戶本身時為 null。 */
  headquartersBranch: string | null;
  users: OnboardingUser[];
  /** 租戶自訂的崗位(專案 seed 的店內櫃台、店外攤位、補貨之外;沒有就空清單)。 */
  positions: OnboardingPosition[];
}

const POSITION_VALUE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function fail(path: string, rule: string): never {
  throw new Error(`開通資料 ${path} ${rule}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(path, "必須是非空字串");
  }
  return value.trim();
}

function list(value: unknown, path: string): unknown[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail(path, "必須是陣列");
  }
  return value;
}

function unique(values: readonly string[], path: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      fail(path, `有重複的值:${value}`);
    }
    seen.add(value);
  }
}

function parseUser(raw: unknown, path: string, branches: Set<string>) {
  if (!isRecord(raw)) {
    fail(path, "必須是物件");
  }
  const userBranches = list(raw.branches, `${path}.branches`).map((name, at) =>
    text(name, `${path}.branches[${String(at)}]`),
  );
  for (const name of userBranches) {
    if (!branches.has(name)) {
      fail(`${path}.branches`, `的「${name}」不在 branches 內`);
    }
  }
  const headquarters = raw.headquarters ?? false;
  if (typeof headquarters !== "boolean") {
    fail(`${path}.headquarters`, "必須是 true 或 false");
  }
  if (userBranches.length === 0 && !headquarters) {
    fail(path, "至少要屬於一家分店,或是總部人員");
  }
  const roles = list(raw.roles, `${path}.roles`).map((role, at) => {
    if (!isOnboardingRoleKey(role)) {
      fail(
        `${path}.roles[${String(at)}]`,
        `必須是 ${ONBOARDING_ROLE_KEYS.join(" / ")}`,
      );
    }
    return role;
  });
  return {
    account: text(raw.account, `${path}.account`),
    email: text(raw.email, `${path}.email`),
    name: text(raw.name, `${path}.name`),
    branches: userBranches,
    headquarters,
    roles,
  } satisfies OnboardingUser;
}

/** 驗開通資料(JSON 檔讀進來的值)並正規化;任何一欄不合就丟錯,此時還沒有呼叫 api。 */
export function parseOnboardingPlan(raw: unknown): OnboardingPlan {
  if (!isRecord(raw)) {
    fail("", "必須是物件");
  }
  const branches = list(raw.branches, "branches").map((branch, at) => {
    const path = `branches[${String(at)}]`;
    if (!isRecord(branch)) {
      fail(path, "必須是物件");
    }
    return { name: text(branch.name, `${path}.name`) };
  });
  unique(
    branches.map((branch) => branch.name),
    "branches",
  );
  const branchNames = new Set(branches.map((branch) => branch.name));

  const headquartersBranch =
    raw.headquartersBranch === undefined || raw.headquartersBranch === null
      ? null
      : text(raw.headquartersBranch, "headquartersBranch");
  if (headquartersBranch !== null && !branchNames.has(headquartersBranch)) {
    fail("headquartersBranch", `的「${headquartersBranch}」不在 branches 內`);
  }

  const users = list(raw.users, "users").map((user, at) =>
    parseUser(user, `users[${String(at)}]`, branchNames),
  );
  unique(
    users.map((user) => user.account),
    "users 的 account",
  );

  const positions = list(raw.positions, "positions").map((position, at) => {
    const path = `positions[${String(at)}]`;
    if (!isRecord(position)) {
      fail(path, "必須是物件");
    }
    const value = text(position.value, `${path}.value`);
    if (!POSITION_VALUE.test(value)) {
      fail(`${path}.value`, "必須是英文 kebab-case(例:counter-a)");
    }
    return { value, label: text(position.label, `${path}.label`) };
  });
  unique(
    positions.map((position) => position.value),
    "positions 的 value",
  );

  return { branches, headquartersBranch, users, positions };
}
