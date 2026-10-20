import { expect } from "@jest/globals";
import type { Connection, Types } from "mongoose";

import type { AuthTestApp } from "../../../../auth/test-support/auth-app";
import { createUser } from "../../../../auth/test-support/fixtures";
import { login } from "../../../../demo-items-two/test-support/fixtures";
import { createRole } from "../../../../permission/test-support/fixtures";
import { DEALERS_CONTACTS_KEY, DEALERS_KEY } from "../dealer-keys";

/**
 * 經銷商管理測試的共用夾具。api 測試的資料庫只種底座(`BASE_ONLY_REGISTRY`),專案的模組樹與權限
 * 由這裡直接寫進**隔離的測試資料庫**(形狀同 seed:`apps/db-migrator/seeds/project/dealers.ts`)。
 */

export const PASSWORD = ["test", "pass", "word"].join("-");

export const KEYS = {
  list: DEALERS_KEY,
  viewPage: `${DEALERS_KEY}.view-page`,
  createPage: `${DEALERS_KEY}.create-page`,
  editPage: `${DEALERS_KEY}.edit-page`,
  contacts: DEALERS_CONTACTS_KEY,
} as const;

/** 個別權限 + 兩個節點的 wildcard(seed 由 `composeModuleSeeds` 自動產生)。 */
export const P = {
  all: `${DEALERS_KEY}.*`,
  contactsAll: `${DEALERS_CONTACTS_KEY}.*`,
  create: `${DEALERS_KEY}.create`,
  edit: `${DEALERS_KEY}.edit`,
  showBase: `${DEALERS_KEY}.show-last-purchase-base-date`,
  editBase: `${DEALERS_KEY}.edit-last-purchase-base-date`,
  showSelfBase: `${DEALERS_KEY}.show-last-self-purchase-base-date`,
  editSelfBase: `${DEALERS_KEY}.edit-last-self-purchase-base-date`,
  contactsCreate: `${DEALERS_CONTACTS_KEY}.create`,
  contactsEdit: `${DEALERS_CONTACTS_KEY}.edit`,
} as const;

function baseFields(now: Date): Record<string, unknown> {
  return {
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
}

const NODES: readonly {
  key: string;
  parentKey: string | null;
  route: string | null;
  sidebarType: "link" | "hidden";
}[] = [
  { key: KEYS.list, parentKey: null, route: "dealers", sidebarType: "link" },
  {
    key: KEYS.viewPage,
    parentKey: KEYS.list,
    route: "view-page",
    sidebarType: "hidden",
  },
  {
    key: KEYS.contacts,
    parentKey: KEYS.list,
    route: null,
    sidebarType: "hidden",
  },
];

/** 寫入經銷商管理的模組樹與權限(每個測試資料庫呼叫一次)。 */
export async function seedDealersAuthorization(
  connection: Connection,
): Promise<void> {
  const now = new Date();
  const ids = new Map<string, Types.ObjectId>();
  for (const [order, node] of NODES.entries()) {
    const parentId =
      node.parentKey === null ? null : (ids.get(node.parentKey) ?? null);
    const parent =
      parentId === null
        ? null
        : await connection
            .collection("modules")
            .findOne<{ ancestors: Types.ObjectId[] }>({ _id: parentId });
    const { insertedId } = await connection.collection("modules").insertOne({
      key: node.key,
      name: node.key,
      parentId,
      ancestors:
        parentId === null ? [] : [...(parent?.ancestors ?? []), parentId],
      route: node.route,
      sidebarType: node.sidebarType,
      order,
      enabled: true,
      isSystem: false,
      icon: null,
      settings: {},
      engine: "fixed",
      ...baseFields(now),
    });
    ids.set(node.key, insertedId);
  }
  await connection.collection("permissions").insertMany(
    Object.values(P).map((key) => ({
      key,
      moduleId: ids.get(key.slice(0, key.lastIndexOf("."))),
      name: key,
      enabled: true,
      isSystem: false,
      settings: {},
      source: "seed",
      retiredAt: null,
      ...baseFields(now),
    })),
  );
}

/** 綁得到經銷商管理(三個分頁)的模組。 */
export const ALL_MODULES = [KEYS.list, KEYS.viewPage, KEYS.contacts];

let accountSequence = 0;

/** 建一個操作者並登入(當前組織 = 第一個所屬組織)。 */
export async function createDealersOperator(
  api: AuthTestApp,
  connection: Connection,
  options: {
    orgId: Types.ObjectId;
    ownerOrgId?: Types.ObjectId;
    moduleKeys: readonly string[];
    permissionKeys: readonly string[];
  },
): Promise<{ token: string; userId: Types.ObjectId }> {
  accountSequence += 1;
  const account = `dealers-${String(accountSequence)}`;
  const userId = await createUser(connection, {
    account,
    password: PASSWORD,
    orgIds: [options.orgId],
  });
  await createRole(api.app, connection, {
    name: `經銷商管理角色:${account}`,
    ownerOrgId: options.ownerOrgId ?? options.orgId,
    moduleKeys: [...options.moduleKeys],
    permissionKeys: [...options.permissionKeys],
    assignTo: [userId],
  });
  return { token: await login(api, account, PASSWORD), userId };
}

/** 同 `createDealersOperator`,只回 token。 */
export async function dealersToken(
  api: AuthTestApp,
  connection: Connection,
  options: Parameters<typeof createDealersOperator>[2],
): Promise<string> {
  const { token } = await createDealersOperator(api, connection, options);
  return token;
}

/** 呼叫並回第一筆錯誤的 extensions;成功時 undefined。 */
export async function errorOf(
  api: AuthTestApp,
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const result = await api.graphql(query, variables, { accessToken: token });
  return result.errors?.[0]?.extensions;
}

/** 呼叫並要求成功,回 data。 */
export async function ok<TData>(
  api: AuthTestApp,
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<TData> {
  const result = await api.graphql<TData>(query, variables, {
    accessToken: token,
  });
  expect(result.errors).toBeUndefined();
  if (!result.data) {
    throw new Error("沒有回資料");
  }
  return result.data;
}

export const DEALER_FIELDS = /* GraphQL */ `
  fragment TestDealerFields on LotteryDealer {
    id
    type
    licenseNo
    name
    status
    licenseState
    coSalesDealer {
      id
      name
    }
    agents {
      id
      name
    }
    trustees {
      id
    }
    introducers {
      id
    }
    storeOrg {
      id
      name
    }
    storeName
    coSellerCount
    lastPurchaseBaseDate
    lastSelfPurchaseBaseDate
    lastPurchaseDate
    lastSelfPurchaseDate
    daysSinceLastPurchase
    currentQuarterSigned
    rentCycle
    rentStartMonth
    nextRentDueAt
    nationalId
    residentialAddress
    abilities {
      canEdit
      canEditLastPurchaseBaseDate
      canEditLastSelfPurchaseBaseDate
    }
  }
`;

export const CREATE_DEALER = /* GraphQL */ `
  ${DEALER_FIELDS}
  mutation TestCreateLotteryDealer($input: CreateLotteryDealerInput!) {
    createLotteryDealer(input: $input) {
      item {
        ...TestDealerFields
      }
    }
  }
`;

export const UPDATE_DEALER = /* GraphQL */ `
  ${DEALER_FIELDS}
  mutation TestUpdateLotteryDealer($input: UpdateLotteryDealerInput!) {
    updateLotteryDealer(input: $input) {
      item {
        ...TestDealerFields
      }
    }
  }
`;

export const DEALER = /* GraphQL */ `
  ${DEALER_FIELDS}
  query TestLotteryDealer($id: ID!) {
    lotteryDealer(id: $id) {
      item {
        ...TestDealerFields
      }
    }
  }
`;

export const DEALERS = /* GraphQL */ `
  ${DEALER_FIELDS}
  query TestLotteryDealers($input: LotteryDealersInput!) {
    lotteryDealers(input: $input) {
      items {
        ...TestDealerFields
      }
      totalCount
    }
  }
`;

export const CREATE_CONTACT = /* GraphQL */ `
  mutation TestCreateLotteryDealerContact(
    $input: CreateLotteryDealerContactInput!
  ) {
    createLotteryDealerContact(input: $input) {
      item {
        id
        name
        roles
        status
        dealerCount
      }
    }
  }
`;

export const UPDATE_CONTACT = /* GraphQL */ `
  mutation TestUpdateLotteryDealerContact(
    $input: UpdateLotteryDealerContactInput!
  ) {
    updateLotteryDealerContact(input: $input) {
      item {
        id
        roles
        status
        dealerCount
        links {
          role
          dealer {
            id
          }
        }
      }
    }
  }
`;

export interface DealerRow {
  id: string;
  type: string;
  licenseNo: string;
  name: string;
  status: string;
  licenseState: string;
  coSalesDealer: { id: string; name: string } | null;
  agents: { id: string; name: string }[];
  trustees: { id: string }[];
  introducers: { id: string }[];
  storeOrg: { id: string; name: string } | null;
  storeName: string | null;
  coSellerCount: number | null;
  lastPurchaseBaseDate: string | null;
  lastSelfPurchaseBaseDate: string | null;
  lastPurchaseDate: string | null;
  lastSelfPurchaseDate: string | null;
  daysSinceLastPurchase: number | null;
  currentQuarterSigned: boolean | null;
  rentCycle: string | null;
  rentStartMonth: number | null;
  nextRentDueAt: string | null;
  nationalId: string;
  residentialAddress: string | null;
  abilities: {
    canEdit: boolean;
    canEditLastPurchaseBaseDate: boolean;
    canEditLastSelfPurchaseBaseDate: boolean;
  };
}

let licenseSequence = 10_000_000;
let nationalSequence = 100_000_000;

/** 不重複的證號 / 身分證字號。 */
export function nextLicenseNo(): string {
  licenseSequence += 1;
  return String(licenseSequence);
}

export function nextNationalId(): string {
  nationalSequence += 1;
  return `A${String(nationalSequence)}`;
}

/** 新增經銷商的最少欄位(證照一年後到期)。 */
export function dealerInput(
  type: "A" | "B",
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = Date.now();
  return {
    type,
    licenseNo: nextLicenseNo(),
    name: type === "A" ? "甲類測試" : "乙類測試",
    licenseApprovedAt: new Date(now - 365 * 86_400_000).toISOString(),
    licenseExpiresAt: new Date(now + 365 * 86_400_000).toISOString(),
    nationalId: nextNationalId(),
    ...extra,
  };
}

/** 新增關係人的最少欄位。 */
export function contactInput(
  roles: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { name: "關係人", roles, nationalId: nextNationalId(), ...extra };
}
