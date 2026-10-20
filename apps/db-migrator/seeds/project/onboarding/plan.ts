/**
 * 開通腳本要建的內容(一家新租戶的資料):示範資料由 `seeds/project/demo/` 組出,
 * 真實租戶由開通 skill 問完操作者後寫成 JSON 檔(同一個形狀;**不含任何密碼**)交給 `onboard` 指令。
 *
 * 之後的模組票若要開通時建資料(例:收銀點、乙類、銀行帳戶、排班人員),在這裡加自己的欄位
 * (選填、預設空清單)、在 `parseOnboardingPlan` 驗它,並在 `steps.ts` 追加自己的步驟。
 */
import {
  TAG_PALETTE_KEYS,
  type TagPaletteKey,
  isTagPaletteKey,
} from "@repo/domain/project/tag-palette";

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
  /**
   * 選項顏色(標籤色票代號,同欄位管理的「顏色」;規格 18.5)。沒有就 null。
   * 只在選項還沒有顏色時設定,租戶已選過的不動。
   */
  color: TagPaletteKey | null;
}

/** 收銀點(檔案管理;規格 5.5)。重跑時以「分店 + 崗位」找回,已存在就不改。 */
export interface OnboardingCashPoint {
  /** 分店名稱(須在 `branches` 內) */
  branch: string;
  /** 崗位選項值(專案預設或 `positions` 裡的) */
  positionKey: string;
  name: string;
  order: number;
}

/** 開通時建立的乙類(開通清單第 6 點;規格 5.2)。日期 `YYYY-MM-DD`(以租戶時區那一天 00:00 寫入)。 */
export interface OnboardingClassBDealer {
  /** 證號 8 碼數字(租戶內唯一;重跑時以它找回,已存在就不動) */
  licenseNo: string;
  name: string;
  /** 身分證字號 */
  nationalId: string;
  licenseApprovedOn: string;
  licenseExpiresOn: string;
  storeName: string | null;
  /** 對應分店(名稱,須在 `branches` 內);沒有就 null */
  branch: string | null;
}

export interface OnboardingPlan {
  branches: OnboardingBranch[];
  /** 總部是某家分店時填那家店的名稱(須在 `branches` 內);總部就是租戶本身時為 null。 */
  headquartersBranch: string | null;
  users: OnboardingUser[];
  /** 租戶自訂的崗位(專案 seed 的店內櫃台、店外攤位、補貨之外;沒有就空清單)。 */
  positions: OnboardingPosition[];
  /** 開通時建立的收銀點(沒有就空清單)。 */
  cashPoints: OnboardingCashPoint[];
  /** 乙類與對應分店(選填;沒給 = 這一步略過)。 */
  classBDealers?: OnboardingClassBDealer[];
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

function integer(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(path, "必須是整數");
  }
  return value;
}

function parseCashPoint(
  raw: unknown,
  path: string,
  branches: Set<string>,
): OnboardingCashPoint {
  if (!isRecord(raw)) {
    fail(path, "必須是物件");
  }
  const branch = text(raw.branch, `${path}.branch`);
  if (!branches.has(branch)) {
    fail(`${path}.branch`, `的「${branch}」不在 branches 內`);
  }
  return {
    branch,
    positionKey: text(raw.positionKey, `${path}.positionKey`),
    name: text(raw.name, `${path}.name`),
    order: raw.order === undefined ? 0 : integer(raw.order, `${path}.order`),
  };
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
    const color = position.color ?? null;
    if (color !== null && !isTagPaletteKey(color)) {
      fail(`${path}.color`, `必須是色票代號 ${TAG_PALETTE_KEYS.join(" / ")}`);
    }
    return { value, label: text(position.label, `${path}.label`), color };
  });
  unique(
    positions.map((position) => position.value),
    "positions 的 value",
  );

  const cashPoints = list(raw.cashPoints, "cashPoints").map((point, at) =>
    parseCashPoint(point, `cashPoints[${String(at)}]`, branchNames),
  );
  unique(
    cashPoints.map((point) => `${point.branch}/${point.positionKey}`),
    "cashPoints 的分店 + 崗位",
  );
  const classBDealers =
    raw.classBDealers === undefined
      ? undefined
      : list(raw.classBDealers, "classBDealers").map((dealer, at) =>
          parseClassBDealer(
            dealer,
            `classBDealers[${String(at)}]`,
            branchNames,
          ),
        );
  if (classBDealers !== undefined) {
    unique(
      classBDealers.map((dealer) => dealer.licenseNo),
      "classBDealers 的 licenseNo",
    );
  }

  return {
    branches,
    headquartersBranch,
    users,
    positions,
    cashPoints,
    ...(classBDealers === undefined ? {} : { classBDealers }),
  };
}

const LICENSE_NO = /^\d{8}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseClassBDealer(
  raw: unknown,
  path: string,
  branches: Set<string>,
): OnboardingClassBDealer {
  if (!isRecord(raw)) {
    fail(path, "必須是物件");
  }
  const licenseNo = text(raw.licenseNo, `${path}.licenseNo`);
  if (!LICENSE_NO.test(licenseNo)) {
    fail(`${path}.licenseNo`, "必須是 8 碼數字");
  }
  const date = (key: "licenseApprovedOn" | "licenseExpiresOn") => {
    const value = text(raw[key], `${path}.${key}`);
    if (!DATE.test(value)) {
      fail(`${path}.${key}`, "必須是 YYYY-MM-DD");
    }
    return value;
  };
  const branch =
    raw.branch === undefined || raw.branch === null
      ? null
      : text(raw.branch, `${path}.branch`);
  if (branch !== null && !branches.has(branch)) {
    fail(`${path}.branch`, `的「${branch}」不在 branches 內`);
  }
  return {
    licenseNo,
    name: text(raw.name, `${path}.name`),
    nationalId: text(raw.nationalId, `${path}.nationalId`),
    licenseApprovedOn: date("licenseApprovedOn"),
    licenseExpiresOn: date("licenseExpiresOn"),
    storeName:
      raw.storeName === undefined || raw.storeName === null
        ? null
        : text(raw.storeName, `${path}.storeName`),
    branch,
  };
}
