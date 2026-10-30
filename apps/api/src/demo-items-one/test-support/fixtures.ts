import { expect } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import type { AuthTestApp } from "../../auth/test-support/auth-app";
import { createUser } from "../../auth/test-support/fixtures";
import { createRole } from "../../permission/test-support/fixtures";

/**
 * 示範模組1 測試的共用夾具(三個測試檔共用):GraphQL 文件、建操作者、常用呼叫。
 * 測試檔只寫行為(TEST-08 的分檔原則,api 同理)。
 */

export const PASSWORD = ["test", "pass", "word"].join("-");

/** 模組樹要給完整(綁下層必綁上層,ADR-0011 步驟 3)。 */
export const SAMPLE_ONE_MODULES = ["demo", "demo.sub", "demo.sub.sample-one"];
/** 編輯頁(隱藏頁模組):`edit-page.show-history` 掛在它底下。 */
export const EDIT_PAGE_MODULE = "demo.sub.sample-one.edit-page";

const KEY = "demo.sub.sample-one";
export const P = {
  view: `${KEY}.view`,
  create: `${KEY}.create`,
  edit: `${KEY}.edit`,
  delete: `${KEY}.delete`,
  showInternalNote: `${KEY}.show-internal-note`,
  editInternalNote: `${KEY}.edit-internal-note`,
  showHistory: `${EDIT_PAGE_MODULE}.show-history`,
} as const;

/** 權限表(demo.sub.sample-one.md)上掛在列表頁那層的全部權限。 */
export const ALL_SAMPLE_ONE_PERMISSIONS = [
  P.view,
  P.create,
  P.edit,
  P.delete,
  P.showInternalNote,
  P.editInternalNote,
];

/** 本 API 簽得出來的上傳路徑(`demo/<uuid>.<副檔名>`,ADR-0010);測試用固定 uuid。 */
export const COVER_PATH = "demo/11111111-2222-4333-8444-555555555555.png";
export const ATTACHMENT_PATH = "demo/66666666-7777-4888-8999-aaaaaaaaaaaa.jpg";

/** 附件 input:路徑 + 前端申報的原始檔名 / 大小 / 檔型。 */
export const ATTACHMENT_INPUT = {
  path: ATTACHMENT_PATH,
  name: "成本估算 2026 Q3.jpg",
  size: 123_456,
  contentType: "image/jpeg",
} as const;

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

/** 一筆示範項目的對外形狀(正本 docs/modules/demo.sub.sample-one.md「api 介面」)。 */
const ITEM_FIELDS = /* GraphQL */ `
  fragment ItemFields on DemoItemOne {
    id
    name
    category
    categoryLabel
    note
    internalNote
    coverPath
    coverUrl
    attachment {
      path
      name
      size
      contentType
    }
    status
    enabled
    createdBy {
      id
      name
    }
    createdAt
    updatedAt
    abilities {
      canEdit
      canDelete
      canEditInternalNote
    }
  }
`;

export const DEMO_ITEMS_ONE = /* GraphQL */ `
  ${ITEM_FIELDS}
  query DemoItemsOne($input: DemoItemsOneInput!) {
    demoItemsOne(input: $input) {
      items {
        ...ItemFields
      }
      totalCount
      page
      pageSize
    }
  }
`;

export const DEMO_ITEM_ONE = /* GraphQL */ `
  ${ITEM_FIELDS}
  query DemoItemOne($id: ID!) {
    demoItemOne(id: $id) {
      item {
        ...ItemFields
      }
    }
  }
`;

export const CREATE_DEMO_ITEM_ONE = /* GraphQL */ `
  ${ITEM_FIELDS}
  mutation CreateDemoItemOne($input: CreateDemoItemOneInput!) {
    createDemoItemOne(input: $input) {
      item {
        ...ItemFields
      }
    }
  }
`;

export const UPDATE_DEMO_ITEM_ONE = /* GraphQL */ `
  ${ITEM_FIELDS}
  mutation UpdateDemoItemOne($input: UpdateDemoItemOneInput!) {
    updateDemoItemOne(input: $input) {
      item {
        ...ItemFields
      }
    }
  }
`;

export const DELETE_DEMO_ITEM_ONE = /* GraphQL */ `
  mutation DeleteDemoItemOne($input: DeleteDemoItemOneInput!) {
    deleteDemoItemOne(input: $input) {
      success
      deletedId
    }
  }
`;

export const SET_DEMO_ITEM_ONE_ENABLED = /* GraphQL */ `
  ${ITEM_FIELDS}
  mutation SetDemoItemOneEnabled($input: SetDemoItemOneEnabledInput!) {
    setDemoItemOneEnabled(input: $input) {
      item {
        ...ItemFields
      }
    }
  }
`;

export const DEMO_ITEM_ONE_HISTORY = /* GraphQL */ `
  query DemoItemOneHistory($id: ID!) {
    demoItemOneHistory(id: $id) {
      items {
        id
        action
        actor {
          id
          name
        }
        before
        after
        createdAt
      }
      totalCount
    }
  }
`;

export const DEMO_ITEM_ONE_ATTACHMENT_URL = /* GraphQL */ `
  query DemoItemOneAttachmentUrl($id: ID!) {
    demoItemOneAttachmentUrl(id: $id) {
      url
    }
  }
`;

export interface ItemRow {
  id: string;
  name: string;
  category: string | null;
  categoryLabel: string | null;
  note: string | null;
  internalNote: string | null;
  coverPath: string | null;
  coverUrl: string | null;
  attachment: {
    path: string;
    name: string | null;
    size: number | null;
    contentType: string | null;
  } | null;
  status: string;
  enabled: boolean;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  abilities: {
    canEdit: boolean;
    canDelete: boolean;
    canEditInternalNote: boolean;
  };
}

export interface ItemsData {
  demoItemsOne: {
    items: ItemRow[];
    totalCount: number;
    page: number;
    pageSize: number;
  };
}

export interface ItemData {
  demoItemOne: { item: ItemRow };
}

export interface MutationData {
  createDemoItemOne?: { item: ItemRow };
  updateDemoItemOne?: { item: ItemRow };
  setDemoItemOneEnabled?: { item: ItemRow };
}

export interface HistoryRow {
  id: string;
  action: string;
  actor: { id: string; name: string } | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface HistoryData {
  demoItemOneHistory: { items: HistoryRow[]; totalCount: number };
}

export interface AttachmentUrlData {
  demoItemOneAttachmentUrl: { url: string };
}

interface LoginData {
  login: { accessToken: string };
}

/** `audit_logs` 的一筆(欄位正本 `database/schemas/audit-log.schema.ts`)。 */
export interface AuditRecord {
  action: string;
  targetType?: string;
  targetId?: Types.ObjectId;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

let accountSequence = 0;

export async function login(
  api: AuthTestApp,
  account: string,
  password = PASSWORD,
): Promise<string> {
  const result = await api.graphql<LoginData>(LOGIN, {
    input: { account, password },
  });
  expect(result.errors).toBeUndefined();
  const token = result.data?.login.accessToken;
  if (!token) {
    throw new Error(`登入失敗:${account}`);
  }
  return token;
}

export interface SampleOneOperator {
  userId: Types.ObjectId;
  /** 這位操作者持有的角色(資料範圍規則的套用對象「指定角色」要用它)。 */
  roleId: Types.ObjectId;
  account: string;
  token: string;
}

export interface CreateOperatorOptions {
  orgId: Types.ObjectId;
  /** 角色的擁有組織(治理範圍);不給即與所屬組織相同。 */
  ownerOrgId?: Types.ObjectId;
  permissionKeys?: string[];
  moduleKeys?: string[];
  /** 額外的所屬組織(排在第一個之後)。 */
  extraOrgIds?: Types.ObjectId[];
}

/** 建一個持有示範模組1 權限的操作者並登入(當前組織 = 第一個所屬組織)。 */
export async function createSampleOneOperator(
  api: AuthTestApp,
  connection: Connection,
  options: CreateOperatorOptions,
): Promise<SampleOneOperator> {
  accountSequence += 1;
  const account = `sample-one-${String(accountSequence)}`;
  const userId = await createUser(connection, {
    account,
    password: PASSWORD,
    orgIds: [options.orgId, ...(options.extraOrgIds ?? [])],
  });
  const roleId = await createRole(api.app, connection, {
    name: `示範模組1 角色:${account}`,
    ownerOrgId: options.ownerOrgId ?? options.orgId,
    moduleKeys: options.moduleKeys ?? SAMPLE_ONE_MODULES,
    permissionKeys: options.permissionKeys ?? ALL_SAMPLE_ONE_PERMISSIONS,
    assignTo: [userId],
  });
  return { userId, roleId, account, token: await login(api, account) };
}

/** 新增一筆並回傳它(errors 不該有;建立失敗直接拋,讓前提壞掉的測試早點紅)。 */
export async function createItem(
  api: AuthTestApp,
  token: string,
  input: Record<string, unknown>,
): Promise<ItemRow> {
  const result = await api.graphql<MutationData>(
    CREATE_DEMO_ITEM_ONE,
    { input },
    { accessToken: token },
  );
  expect(result.errors).toBeUndefined();
  const item = result.data?.createDemoItemOne?.item;
  if (!item) {
    throw new Error("createDemoItemOne 沒有回資料");
  }
  return item;
}

/** 清單;順帶驗 `totalCount` 與回傳筆數在同一頁內一致。 */
export async function listItems(
  api: AuthTestApp,
  token: string,
  input: Record<string, unknown> = {},
): Promise<ItemsData["demoItemsOne"]> {
  const result = await api.graphql<ItemsData>(
    DEMO_ITEMS_ONE,
    { input },
    { accessToken: token },
  );
  expect(result.errors).toBeUndefined();
  if (!result.data) {
    throw new Error("demoItemsOne 沒有回資料");
  }
  return result.data.demoItemsOne;
}

export function namesOf(items: readonly ItemRow[]): string[] {
  return items
    .map((item) => item.name)
    .toSorted((a, b) => a.localeCompare(b, "zh-Hant"));
}

/** 清單的名稱(排序後),篩選條件的斷言直接比這個。 */
export async function listNames(
  api: AuthTestApp,
  token: string,
  input: Record<string, unknown> = {},
): Promise<string[]> {
  const payload = await listItems(api, token, input);
  return namesOf(payload.items);
}

/** 取最後一筆指定動作的稽核紀錄。 */
export function latestAudit(
  connection: Connection,
  action: string,
  targetId?: Types.ObjectId | string,
): Promise<AuditRecord | null> {
  return connection.collection("audit_logs").findOne<AuditRecord>(
    {
      action,
      ...(targetId === undefined
        ? {}
        : { targetId: new Types.ObjectId(targetId) }),
    },
    { sort: { createdAt: -1, _id: -1 } },
  );
}

/** 欄位管理的自訂選項(直接寫測試資料庫;新增端點另有自己的測試)。 */
export async function insertFieldOption(
  connection: Connection,
  option: {
    categoryId: Types.ObjectId;
    orgId: Types.ObjectId | null;
    value: string;
    label: string;
    enabled?: boolean;
  },
): Promise<void> {
  const now = new Date();
  await connection.collection("fields").insertOne({
    categoryId: option.categoryId,
    orgId: option.orgId,
    value: option.value,
    label: option.label,
    order: 10,
    enabled: option.enabled ?? true,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  });
}
