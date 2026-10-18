import { type GraphqlResponse, graphql, graphqlOk } from "./graphql";

/**
 * 前置資料要用到的 GraphQL 操作(正本是 `packages/graphql/src/documents/*.graphql`,
 * 這裡只抄 e2e 需要的欄位)。新增操作時對照那份文件,不要憑印象補欄位。
 */

const LOGIN = `
mutation Login($input: LoginInput!) {
  login(input: $input) { accessToken }
}`;

const SET_PASSWORD = `
mutation SetPassword($input: SetPasswordInput!) {
  setPassword(input: $input) { accessToken }
}`;

const CHANGE_PASSWORD = `
mutation ChangePassword($input: ChangePasswordInput!) {
  changePassword(input: $input) { success }
}`;

const TENANT_MODULE_OPTIONS = `
query TenantModuleOptions { tenantModuleOptions { key } }`;

const PROVISION_TENANT = `
mutation ProvisionTenant($input: ProvisionTenantInput!) {
  provisionTenant(input: $input) { org { id name } ownerUserId roleId }
}`;

const CREATE_CHILD_ORG = `
mutation CreateChildOrg($input: CreateChildOrgInput!) {
  createChildOrg(input: $input) { org { id name } }
}`;

const CREATE_USER = `
mutation CreateUser($input: CreateUserInput!) {
  createUser(input: $input) { user { id account } }
}`;

const SET_USER_ORGS = `
mutation SetUserOrgs($input: SetUserOrgsInput!) {
  setUserOrgs(input: $input) { user { id orgs { id name } } }
}`;

const CREATE_ROLE = `
mutation CreateRole($input: CreateRoleInput!) {
  createRole(input: $input) { role { id name } }
}`;

const MATRIX_NODE = `
  id key name
  permissions { key action }`;

const ROLE_MATRIX = `
query RoleMatrix($roleId: ID!) {
  roleMatrix(roleId: $roleId) {
    granted { moduleKeys permissionKeys }
    modules {
      ${MATRIX_NODE}
      children {
        ${MATRIX_NODE}
        children {
          ${MATRIX_NODE}
          children { ${MATRIX_NODE} }
        }
      }
    }
  }
}`;

const SAVE_ROLE_MATRIX = `
mutation SaveRoleMatrix($input: SaveRoleMatrixInput!) {
  saveRoleMatrix(input: $input) { granted { moduleKeys permissionKeys } }
}`;

const GRANT_ROLE_USERS = `
mutation GrantRoleUsers($input: GrantRoleUsersInput!) {
  grantRoleUsers(input: $input) { totalCount }
}`;

const SWITCH_ORG = `
mutation SwitchOrg($input: SwitchOrgInput!) {
  switchOrg(input: $input) { accessToken }
}`;

const CREATE_DEMO_ITEM_ONE = `
mutation CreateDemoItemOne($input: CreateDemoItemOneInput!) {
  createDemoItemOne(input: $input) { item { id name } }
}`;

const CREATE_DEMO_ITEM_TWO = `
mutation CreateDemoItemTwo($input: CreateDemoItemTwoInput!) {
  createDemoItemTwo(input: $input) { item { id name } }
}`;

const SET_DEMO_ITEM_ONE_STATUS = `
mutation UpdateDemoItemOne($input: UpdateDemoItemOneInput!) {
  updateDemoItemOne(input: $input) { item { id status } }
}`;

const DATA_SCOPE_TARGETS = `
query DataScopeTargets { dataScopeTargets { targets { id moduleKey } } }`;

const SAVE_DATA_SCOPE_RULE = `
mutation SaveDataScopeRule($input: SaveDataScopeRuleInput!) {
  saveDataScopeRule(input: $input) {
    rule {
      targetId
      collection
      moduleKey
      combineOp
      rules { audience filter }
    }
  }
}`;

const UPDATE_DEMO_ITEM_ONE = `
mutation UpdateDemoItemOne($input: UpdateDemoItemOneInput!) {
  updateDemoItemOne(input: $input) { item { id name internalNote } }
}`;

const DEMO_ITEM_ONE_HISTORY = `
query DemoItemOneHistory($id: ID!) {
  demoItemOneHistory(id: $id) {
    items { id action before after createdAt }
    totalCount
  }
}`;

export interface MatrixPermission {
  key: string;
  action: string;
}

export interface MatrixModule {
  id: string;
  key: string;
  name: string;
  permissions: MatrixPermission[];
  children?: MatrixModule[];
}

export interface RoleGrant {
  moduleKeys: string[];
  permissionKeys: string[];
}

export async function login(
  account: string,
  password: string,
): Promise<string> {
  const data = await graphqlOk<{ login: { accessToken: string } }>(LOGIN, {
    input: { account, password },
  });
  return data.login.accessToken;
}

/** 啟用信 / 重設信共用;成功直接回登入 token(免再登入一次)。 */
export async function setPassword(
  token: string,
  password: string,
): Promise<string> {
  const data = await graphqlOk<{ setPassword: { accessToken: string } }>(
    SET_PASSWORD,
    { input: { token, newPassword: password } },
  );
  return data.setPassword.accessToken;
}

/** 清掉首登強改旗標(`activation: PASSWORD` 建出來的帳號一律帶著它)。 */
export async function changePassword(
  accessToken: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await graphqlOk(
    CHANGE_PASSWORD,
    { input: { currentPassword, newPassword } },
    accessToken,
  );
}

export async function tenantModuleOptionKeys(
  accessToken: string,
): Promise<string[]> {
  const data = await graphqlOk<{ tenantModuleOptions: { key: string }[] }>(
    TENANT_MODULE_OPTIONS,
    {},
    accessToken,
  );
  return data.tenantModuleOptions.map((module) => module.key);
}

export interface ProvisionTenantResult {
  orgId: string;
  ownerUserId: string;
  roleId: string;
}

export async function provisionTenant(
  accessToken: string,
  input: {
    name: string;
    /** 租戶短碼(`^[a-z][a-z0-9_]{1,19}$`、全域唯一) */
    slug: string;
    adminAccount: string;
    adminEmail: string;
    moduleKeys: readonly string[];
  },
): Promise<ProvisionTenantResult> {
  const data = await graphqlOk<{
    provisionTenant: {
      org: { id: string };
      ownerUserId: string;
      roleId: string;
    };
  }>(PROVISION_TENANT, { input }, accessToken);
  return {
    orgId: data.provisionTenant.org.id,
    ownerUserId: data.provisionTenant.ownerUserId,
    roleId: data.provisionTenant.roleId,
  };
}

export async function createChildOrg(
  accessToken: string,
  parentId: string,
  name: string,
): Promise<string> {
  const data = await graphqlOk<{ createChildOrg: { org: { id: string } } }>(
    CREATE_CHILD_ORG,
    { input: { parentId, name } },
    accessToken,
  );
  return data.createChildOrg.org.id;
}

export async function createUserWithPassword(
  accessToken: string,
  input: {
    account: string;
    name: string;
    email: string;
    orgIds: readonly string[];
    initialPassword: string;
  },
): Promise<string> {
  const data = await graphqlOk<{ createUser: { user: { id: string } } }>(
    CREATE_USER,
    {
      input: {
        account: input.account,
        name: input.name,
        email: input.email,
        orgIds: input.orgIds,
        activation: {
          mode: "PASSWORD",
          initialPassword: input.initialPassword,
        },
      },
    },
    accessToken,
  );
  return data.createUser.user.id;
}

export async function setUserOrgs(
  accessToken: string,
  userId: string,
  orgIds: readonly string[],
): Promise<void> {
  await graphqlOk(SET_USER_ORGS, { input: { userId, orgIds } }, accessToken);
}

export async function createRole(
  accessToken: string,
  name: string,
  ownerOrgId: string,
): Promise<string> {
  const data = await graphqlOk<{ createRole: { role: { id: string } } }>(
    CREATE_ROLE,
    { input: { name, ownerOrgId } },
    accessToken,
  );
  return data.createRole.role.id;
}

export async function roleMatrix(
  accessToken: string,
  roleId: string,
): Promise<{ modules: MatrixModule[]; granted: RoleGrant }> {
  const data = await graphqlOk<{
    roleMatrix: { modules: MatrixModule[]; granted: RoleGrant };
  }>(ROLE_MATRIX, { roleId }, accessToken);
  return data.roleMatrix;
}

export async function saveRoleMatrix(
  accessToken: string,
  input: { roleId: string; moduleKeys: string[]; permissionKeys: string[] },
): Promise<RoleGrant> {
  const data = await graphqlOk<{ saveRoleMatrix: { granted: RoleGrant } }>(
    SAVE_ROLE_MATRIX,
    { input },
    accessToken,
  );
  return data.saveRoleMatrix.granted;
}

export async function grantRoleUsers(
  accessToken: string,
  roleId: string,
  userIds: readonly string[],
): Promise<void> {
  await graphqlOk(
    GRANT_ROLE_USERS,
    { input: { roleId, userIds } },
    accessToken,
  );
}

/** 切換當前組織:驗過所屬組織後**換發**一張 access token(舊的那張不會失效)。 */
export async function switchOrg(
  accessToken: string,
  orgId: string,
): Promise<string> {
  const data = await graphqlOk<{ switchOrg: { accessToken: string } }>(
    SWITCH_ORG,
    { input: { orgId } },
    accessToken,
  );
  return data.switchOrg.accessToken;
}

export async function createDemoItemOne(
  accessToken: string,
  input: { name: string; note?: string; internalNote?: string },
): Promise<string> {
  const data = await graphqlOk<{
    createDemoItemOne: { item: { id: string } };
  }>(CREATE_DEMO_ITEM_ONE, { input }, accessToken);
  return data.createDemoItemOne.item.id;
}

export async function createDemoItemTwo(
  accessToken: string,
  input: { name: string; note?: string },
): Promise<string> {
  const data = await graphqlOk<{
    createDemoItemTwo: { item: { id: string } };
  }>(CREATE_DEMO_ITEM_TWO, { input }, accessToken);
  return data.createDemoItemTwo.item.id;
}

/** 原樣回傳(要驗 `FIELD_FORBIDDEN` 這類錯誤碼,所以不用 `graphqlOk`)。 */
export function updateDemoItemOne(
  accessToken: string,
  input: Record<string, unknown>,
): ReturnType<typeof graphql> {
  return graphql(UPDATE_DEMO_ITEM_ONE, { input }, accessToken);
}

/** GraphQL 的狀態列舉(資料庫存的是小寫,`dataScopeTarget` 宣告的 enum 選項用那一份)。 */
export type DemoItemOneStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export async function setDemoItemOneStatus(
  accessToken: string,
  id: string,
  status: DemoItemOneStatus,
): Promise<void> {
  await graphqlOk(
    SET_DEMO_ITEM_ONE_STATUS,
    { input: { id, status } },
    accessToken,
  );
}

/* ---- 資料範圍(ADR-0008;形狀正本 `docs/modules/data-scope.md`) ---- */

/** 多條規則命中同一個人時的頂層合成:OR = 聯集、AND = 交集。 */
export type DataScopeCombineOp = "AND" | "OR";

/** 一條規則:套用對象(人員條件,形狀正本 `@repo/domain/audience`)+ 條件樹(`filter`)。 */
export interface DataScopeRuleEntry {
  audience: Record<string, unknown>;
  filter: Record<string, unknown>;
}

export interface DataScopeRule {
  targetId: string;
  collection: string;
  moduleKey: string;
  combineOp: DataScopeCombineOp;
  rules: DataScopeRuleEntry[];
}

/**
 * 某模組的資料目標 id(一個模組一個目標,`(collection, moduleKey)` 唯一;規則以 id 指定目標)。
 * 目標清單是根組織專屬,所以要用 root 的 token。
 */
async function dataScopeTargetId(
  accessToken: string,
  moduleKey: string,
): Promise<string> {
  const data = await graphqlOk<{
    dataScopeTargets: { targets: { id: string; moduleKey: string }[] };
  }>(DATA_SCOPE_TARGETS, {}, accessToken);
  const target = data.dataScopeTargets.targets.find(
    (item) => item.moduleKey === moduleKey,
  );
  if (!target) {
    throw new Error(`seed 沒有登記 ${moduleKey} 的資料範圍目標`);
  }
  return target.id;
}

/**
 * **整份覆蓋**某模組這個資料目標的規則(送出的就是之後生效的全部)。
 * 根組織專屬:站在租戶裡即使持有權限也會拿到 `FORBIDDEN`,所以一律用 root 的 token。
 */
export async function saveDataScopeRule(
  accessToken: string,
  input: {
    moduleKey: string;
    combineOp: DataScopeCombineOp;
    rules: readonly DataScopeRuleEntry[];
  },
): Promise<DataScopeRule> {
  const targetId = await dataScopeTargetId(accessToken, input.moduleKey);
  const data = await graphqlOk<{
    saveDataScopeRule: { rule: DataScopeRule };
  }>(
    SAVE_DATA_SCOPE_RULE,
    {
      input: { targetId, combineOp: input.combineOp, rules: input.rules },
    },
    accessToken,
  );
  return data.saveDataScopeRule.rule;
}

/** 刪規則 = 整份覆蓋成空陣列(執行面只剩租戶保底)。 */
export async function clearDataScopeRule(
  accessToken: string,
  moduleKey: string,
): Promise<void> {
  await saveDataScopeRule(accessToken, {
    moduleKey,
    combineOp: "OR",
    rules: [],
  });
}

/** 條件樹:一個群組包一條條件列(編輯器存出來就是這個形狀)。 */
function singleCondition(
  field: string,
  value: Record<string, unknown>,
): Record<string, unknown> {
  return {
    op: "AND",
    children: [{ field, cond: "in", value }],
  };
}

/** 套用對象 = 角色 屬於 → 建立者 屬於【操作者本人】(劇本 2 / 3 / 4 的規則①)。 */
export function ownedByOperatorRule(roleId: string): DataScopeRuleEntry {
  return {
    audience: {
      mode: "match",
      filter: {
        field: "role",
        cond: "in",
        value: { kind: "static", values: [roleId] },
      },
    },
    filter: singleCondition("createdBy", {
      kind: "dynamic",
      ref: "current-user",
    }),
  };
}

/** 套用對象 = 所屬組織(本身)屬於 → 狀態 屬於【已發布】(劇本 4 的規則②)。 */
export function publishedInOrgRule(orgId: string): DataScopeRuleEntry {
  return {
    audience: {
      mode: "match",
      filter: {
        field: "org",
        cond: "in",
        value: { kind: "static", values: [orgId] },
        range: "self",
      },
    },
    filter: singleCondition("status", {
      kind: "static",
      values: ["published"],
    }),
  };
}

export interface HistoryEntry {
  id: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * 某一筆示範項目的變更歷程(新到舊,不分頁);需要 `edit-page.show-history`。
 *
 * 受欄位級權限保護的欄位在 `before` / `after` 裡一律是 `"[redacted]"`
 * (ADR-0004「稽核歷程一律記 `[redacted]`」)—— 畫面上的歷程區塊根本不渲染值,
 * 所以那一條只驗得到這裡。
 */
export async function demoItemOneHistory(
  accessToken: string,
  id: string,
): Promise<HistoryEntry[]> {
  const data = await graphqlOk<{
    demoItemOneHistory: { items: HistoryEntry[] };
  }>(DEMO_ITEM_ONE_HISTORY, { id }, accessToken);
  return data.demoItemOneHistory.items;
}

/** 攤平權限矩陣的樹(矩陣是巢狀四層,選模組 / 權限時一律先攤平)。 */
export function flattenMatrix(
  modules: readonly MatrixModule[],
): MatrixModule[] {
  return modules.flatMap((module) => [
    module,
    ...flattenMatrix(module.children ?? []),
  ]);
}

/* ---- 劇本 10 / 13:防越權、總覽也是模組 ---- */

const ME_MODULE_KEYS = `
query Me { me { modules { key } } }`;

/** 操作者自己持有的模組 key(`me.modules`;側欄與可進入路由都從這一份長出來)。 */
export async function myModuleKeys(accessToken: string): Promise<string[]> {
  const data = await graphqlOk<{ me: { modules: { key: string }[] } }>(
    ME_MODULE_KEYS,
    {},
    accessToken,
  );
  return data.me.modules.map((module) => module.key);
}

/**
 * 原樣回傳的 `saveRoleMatrix`(要驗 `ROLE_OUT_OF_REACH` 這類錯誤碼,所以不用 `graphqlOk`)。
 * 前置用的整份覆蓋走上面的 `saveRoleMatrix`。
 */
export function saveRoleMatrixRaw(
  accessToken: string,
  input: { roleId: string; moduleKeys: string[]; permissionKeys: string[] },
): ReturnType<typeof graphql> {
  return graphql(SAVE_ROLE_MATRIX, { input }, accessToken);
}

/* ---- 劇本 8 / 9:多所屬組織、組織外、移除所屬組織三檔 ---- */

const ADD_ORG_MEMBERS = `
mutation AddOrgMembers($input: AddOrgMembersInput!) {
  addOrgMembers(input: $input) { addedUserIds skippedUserIds }
}`;

const MOVE_ORG = `
mutation MoveOrg($input: MoveOrgInput!) {
  moveOrg(input: $input) { org { id parentId } }
}`;

const REVOKE_ROLE_USERS = `
mutation RevokeRoleUsers($input: RevokeRoleUsersInput!) {
  revokeRoleUsers(input: $input) { totalCount }
}`;

const SET_USER_ORGS_WITH_POLICY = `
mutation SetUserOrgs($input: SetUserOrgsInput!) {
  setUserOrgs(input: $input) {
    user { id orgs { id name } roles { id name outOfScope } }
    removedOrgs { id name }
    unqualifiedRoles { roleId roleName ownerOrgId ownerOrgName reasons ownerProtected }
    revokedRoleIds
  }
}`;

/**
 * 組織管理「成員」分頁的「加入成員」:對每個人的所屬組織**加**一筆
 * (只加不減,所以沒有 dry-run;移除只有 `setUserOrgs` 一個入口)。
 */
export async function addOrgMembers(
  accessToken: string,
  orgId: string,
  userIds: readonly string[],
): Promise<void> {
  await graphqlOk(ADD_ORG_MEMBERS, { input: { orgId, userIds } }, accessToken);
}

/** 把組織搬到新的上層(候選 = 管理範圍 ∩ 同租戶 − 自己子樹)。 */
export async function moveOrg(
  accessToken: string,
  id: string,
  newParentId: string,
): Promise<void> {
  await graphqlOk(MOVE_ORG, { input: { id, newParentId } }, accessToken);
}

/** 角色管理「分配使用者」的「移除」:解除這幾個人的這個角色授予。 */
export async function revokeRoleUsers(
  accessToken: string,
  roleId: string,
  userIds: readonly string[],
): Promise<void> {
  await graphqlOk(
    REVOKE_ROLE_USERS,
    { input: { roleId, userIds } },
    accessToken,
  );
}

/** 移除所屬組織的三檔(ADR-0003;`docs/modules/user-manager.md` 的 radio 文案表)。 */
export type UserOrgRemovalPolicy =
  "KEEP_ALL" | "REVOKE_OWNED_BY_ORG" | "REVOKE_ALL_UNQUALIFIED";

export type RoleUnqualifiedReason =
  "OWNED_BY_REMOVED_ORG" | "NO_REMAINING_SUBTREE_SUPPORT";

export interface SetUserOrgsResult {
  user: {
    id: string;
    orgs: { id: string; name: string }[];
    roles: { id: string; name: string; outOfScope: boolean }[];
  };
  removedOrgs: { id: string; name: string }[];
  unqualifiedRoles: {
    roleId: string;
    roleName: string;
    ownerOrgId: string | null;
    ownerOrgName: string | null;
    reasons: RoleUnqualifiedReason[];
    ownerProtected: boolean;
  }[];
  revokedRoleIds: string[];
}

/**
 * 帶 `dryRun` / `removalPolicy` 的 `setUserOrgs`,回完整 payload
 * (劇本 9 要比對 dry-run 的 `reasons` 與送出後的 `revokedRoleIds`)。
 * 只加不減的前置用上面的 `setUserOrgs` 即可。
 */
export async function setUserOrgsWithPolicy(
  accessToken: string,
  input: {
    userId: string;
    orgIds: readonly string[];
    dryRun: boolean;
    removalPolicy?: UserOrgRemovalPolicy;
  },
): Promise<SetUserOrgsResult> {
  const data = await graphqlOk<{ setUserOrgs: SetUserOrgsResult }>(
    SET_USER_ORGS_WITH_POLICY,
    { input },
    accessToken,
  );
  return data.setUserOrgs;
}

/* ---- 劇本 12:可見性開關 ---- */

const DATA_SCOPE_RULE = `
query DataScopeRule($targetId: ID!) {
  dataScopeRule(targetId: $targetId) {
    rule {
      targetId
      collection
      moduleKey
      combineOp
      rules { audience filter }
    }
  }
}`;

const SET_ORG_VISIBILITY = `
mutation SetOrgVisibility($input: SetOrgVisibilityInput!) {
  setOrgVisibility(input: $input) { org { id visibility } }
}`;

/**
 * 讀某個資料目標目前的規則:`null` = 從來沒設定過,`rules: []` = 設過又刪光
 * (兩者在執行面等價,都只剩租戶保底;`docs/modules/data-scope.md`「執行面的回傳語意」)。
 * 規則是全站共用的一份,所以要讀它的是 root。
 */
export async function dataScopeRule(
  accessToken: string,
  moduleKey: string,
): Promise<DataScopeRule | null> {
  const targetId = await dataScopeTargetId(accessToken, moduleKey);
  const data = await graphqlOk<{
    dataScopeRule: { rule: DataScopeRule | null };
  }>(DATA_SCOPE_RULE, { targetId }, accessToken);
  return data.dataScopeRule.rule;
}

/** 租戶頂層的「使用者可見下層組織資料」開關(ADR-0005;新開通的租戶沒有設定 = `OWN`)。 */
export type OrgVisibility = "OWN" | "SUBTREE";

/** 設租戶頂層的可見性開關;+tenant(模板副本含 `set-visibility`)與 root 都設得了。 */
export async function setOrgVisibility(
  accessToken: string,
  orgId: string,
  visibility: OrgVisibility,
): Promise<void> {
  await graphqlOk(
    SET_ORG_VISIBILITY,
    { input: { orgId, visibility } },
    accessToken,
  );
}

/* ---- 劇本 14:管理範圍 vs 可見範圍 ---- */

const ORG_TREE = `
query OrgTree {
  orgTree {
    id name parentId
    children {
      id name parentId
      children { id name parentId children { id name parentId } }
    }
  }
}`;

const ORG = `
query Org($id: ID!) {
  org(id: $id) { id name parentId visibility }
}`;

const SET_ROLE_ENABLED = `
mutation SetRoleEnabled($input: SetRoleEnabledInput!) {
  setRoleEnabled(input: $input) { role { id enabled } }
}`;

/** 組織樹的一個節點(`orgTree`;四層夠劇本用:租戶頂層 > 分店 > 倉庫)。 */
export interface OrgTreeNode {
  id: string;
  name: string;
  /** 每棵樹的**樹根一律 `null`**(它的上層不在管理範圍內;`docs/modules/org-manager.md`)。 */
  parentId: string | null;
  children?: OrgTreeNode[];
}

/**
 * 原樣回傳的 `orgTree`(要驗 `FORBIDDEN`)。根 = 操作者**管理範圍**的各個頂點,範圍外不回傳;
 * `system.org-manager.view` 或 `system.user-manager.view` 任一即可進端點。
 */
export function orgTreeRaw(
  accessToken: string,
): Promise<GraphqlResponse<{ orgTree: OrgTreeNode[] }>> {
  return graphql<{ orgTree: OrgTreeNode[] }>(ORG_TREE, {}, accessToken);
}

/** 組織樹的各個樹根(前置失敗就拋)。 */
export async function orgTree(accessToken: string): Promise<OrgTreeNode[]> {
  const data = await graphqlOk<{ orgTree: OrgTreeNode[] }>(
    ORG_TREE,
    {},
    accessToken,
  );
  return data.orgTree;
}

export interface OrgSummary {
  id: string;
  name: string;
  parentId: string | null;
  /** 只有租戶頂層有值(新開通的租戶沒設定 = `OWN`)。 */
  visibility: OrgVisibility | null;
}

/** 單一組織,原樣回傳(管理範圍外 = `NOT_FOUND`,不透露存不存在)。 */
export function orgRaw(
  accessToken: string,
  id: string,
): Promise<GraphqlResponse<{ org: OrgSummary }>> {
  return graphql<{ org: OrgSummary }>(ORG, { id }, accessToken);
}

/** 原樣回傳的 `setOrgVisibility`(要驗 `NOT_FOUND` / `VALIDATION_FAILED` / `FORBIDDEN`)。 */
export function setOrgVisibilityRaw(
  accessToken: string,
  orgId: string,
  visibility: OrgVisibility,
): ReturnType<typeof graphql> {
  return graphql(
    SET_ORG_VISIBILITY,
    { input: { orgId, visibility } },
    accessToken,
  );
}

/** 原樣回傳的 `moveOrg`(要驗 `NOT_FOUND` / `CYCLIC_MOVE` / `CROSS_TENANT` / `FORBIDDEN`)。 */
export function moveOrgRaw(
  accessToken: string,
  id: string,
  newParentId: string,
): ReturnType<typeof graphql> {
  return graphql(MOVE_ORG, { input: { id, newParentId } }, accessToken);
}

/** 角色管理的「停用 / 啟用」:停用的角色不算進管理範圍,也不給任何權限(ADR-0011 步驟 2)。 */
export async function setRoleEnabled(
  accessToken: string,
  roleId: string,
  enabled: boolean,
): Promise<void> {
  await graphqlOk(
    SET_ROLE_ENABLED,
    { input: { id: roleId, enabled } },
    accessToken,
  );
}

/* ---- 劇本 16 / 17:租戶視角、擁有者保護、撤銷開通 ---- */

const REVOKE_TENANT_PROVISION = `
mutation RevokeTenantProvision($input: RevokeTenantProvisionInput!) {
  revokeTenantProvision(input: $input) {
    success revokedOrgId revokedOwnerUserId revokedRoleId
  }
}`;

const SET_USER_ENABLED = `
mutation SetUserEnabled($input: SetUserEnabledInput!) {
  setUserEnabled(input: $input) { user { id enabled } }
}`;

const SET_ORG_ENABLED = `
mutation SetOrgEnabled($input: SetOrgEnabledInput!) {
  setOrgEnabled(input: $input) { org { id enabled } }
}`;

const DELETE_ORG = `
mutation DeleteOrg($input: DeleteOrgInput!) {
  deleteOrg(input: $input) { success deletedId }
}`;

const USER = `
query User($id: ID!) {
  user(id: $id) { id account enabled orgs { id name } roles { id name } }
}`;

const ROLE = `
query Role($id: ID!) {
  role(id: $id) { role { id name } }
}`;

export interface RevokeTenantProvisionResult {
  success: boolean;
  revokedOrgId: string;
  revokedOwnerUserId: string | null;
  revokedRoleId: string | null;
}

/**
 * 原樣回傳的 `revokeTenantProvision`(根組織專屬;要驗 `PROVISION_NOT_REVOKABLE`
 * 與它的 `extensions.reasons`,所以不用 `graphqlOk`)。
 */
export function revokeTenantProvisionRaw(
  accessToken: string,
  orgId: string,
): Promise<
  GraphqlResponse<{ revokeTenantProvision: RevokeTenantProvisionResult }>
> {
  return graphql<{ revokeTenantProvision: RevokeTenantProvisionResult }>(
    REVOKE_TENANT_PROVISION,
    { input: { orgId } },
    accessToken,
  );
}

/** 原樣回傳的 `setUserEnabled`(擁有者被租戶內的人停用 → `OWNER_PROTECTED`)。 */
export function setUserEnabledRaw(
  accessToken: string,
  id: string,
  enabled: boolean,
): ReturnType<typeof graphql> {
  return graphql(SET_USER_ENABLED, { input: { id, enabled } }, accessToken);
}

/** 原樣回傳的 `setOrgEnabled`(租戶內的人停用租戶頂層 → `FORBIDDEN`)。 */
export function setOrgEnabledRaw(
  accessToken: string,
  id: string,
  enabled: boolean,
): ReturnType<typeof graphql> {
  return graphql(SET_ORG_ENABLED, { input: { id, enabled } }, accessToken);
}

/** 原樣回傳的 `deleteOrg`(租戶內的人刪租戶頂層 → `FORBIDDEN`,排在前置四項之前)。 */
export function deleteOrgRaw(
  accessToken: string,
  id: string,
): ReturnType<typeof graphql> {
  return graphql(DELETE_ORG, { input: { id } }, accessToken);
}

/**
 * 原樣回傳的 `setUserOrgs`(全量覆蓋、不 dry-run;要驗 `OWNER_PROTECTED` / `LAST_ORG`)。
 * 要讀 dry-run 清單的用上面的 `setUserOrgsWithPolicy`。
 */
export function setUserOrgsRaw(
  accessToken: string,
  userId: string,
  orgIds: readonly string[],
): ReturnType<typeof graphql> {
  return graphql(SET_USER_ORGS, { input: { userId, orgIds } }, accessToken);
}

/** 原樣回傳的 `revokeRoleUsers`(解除擁有者的預設角色授予 → `OWNER_PROTECTED`)。 */
export function revokeRoleUsersRaw(
  accessToken: string,
  roleId: string,
  userIds: readonly string[],
): ReturnType<typeof graphql> {
  return graphql(
    REVOKE_ROLE_USERS,
    { input: { roleId, userIds } },
    accessToken,
  );
}

export interface UserSummary {
  id: string;
  account: string;
  enabled: boolean;
  orgs: { id: string; name: string }[];
  roles: { id: string; name: string }[];
}

/** 單一使用者,原樣回傳(撤銷開通後擁有者帳號被抹掉 → `NOT_FOUND`)。 */
export function userRaw(
  accessToken: string,
  id: string,
): Promise<GraphqlResponse<{ user: UserSummary }>> {
  return graphql<{ user: UserSummary }>(USER, { id }, accessToken);
}

/** 單一使用者(前置失敗就拋)。 */
export async function userById(
  accessToken: string,
  id: string,
): Promise<UserSummary> {
  const data = await graphqlOk<{ user: UserSummary }>(
    USER,
    { id },
    accessToken,
  );
  return data.user;
}

/** 單一角色,原樣回傳(撤銷開通後角色副本被抹掉 → `NOT_FOUND`)。 */
export function roleRaw(
  accessToken: string,
  id: string,
): Promise<GraphqlResponse<{ role: { role: { id: string; name: string } } }>> {
  return graphql<{ role: { role: { id: string; name: string } } }>(
    ROLE,
    { id },
    accessToken,
  );
}

/** 原樣回傳的 `login`(帳號被抹掉之後 → `INVALID_CREDENTIALS`)。 */
export function loginRaw(
  account: string,
  password: string,
): Promise<GraphqlResponse<{ login: { accessToken: string } }>> {
  return graphql<{ login: { accessToken: string } }>(LOGIN, {
    input: { account, password },
  });
}

/* ---- 劇本 11 / 15:上傳票、附件下載網址 ---- */

const CREATE_UPLOAD_URL = `
mutation CreateUploadUrl($input: CreateUploadUrlInput!) {
  createUploadUrl(input: $input) { uploadUrl objectPath expiresAt }
}`;

const DEMO_ITEM_ONE_ATTACHMENT_URL = `
query DemoItemOneAttachmentUrl($id: ID!) {
  demoItemOneAttachmentUrl(id: $id) { url }
}`;

/** GraphQL 的上傳用途列舉(正本 `apps/api/src/storage/upload-rules.ts` 的 `UploadPurpose`)。 */
export type UploadPurpose = "ORG_LOGO" | "DEMO_COVER" | "DEMO_ATTACHMENT";

export interface UploadTicket {
  uploadUrl: string;
  objectPath: string;
  expiresAt: string;
}

/** 原樣回傳的 `createUploadUrl`(劇本 11 步驟 4:檔型 / 大小不合 → `UPLOAD_REJECTED`)。 */
export function createUploadUrlRaw(
  accessToken: string,
  input: { purpose: UploadPurpose; contentType: string; size: number },
): Promise<GraphqlResponse<{ createUploadUrl: UploadTicket }>> {
  return graphql<{ createUploadUrl: UploadTicket }>(
    CREATE_UPLOAD_URL,
    { input },
    accessToken,
  );
}

/** 原樣回傳的 `demoItemOneAttachmentUrl`(劇本 11 步驟 5:拿掉 `view` → `FORBIDDEN`)。 */
export function demoItemOneAttachmentUrlRaw(
  accessToken: string,
  id: string,
): Promise<GraphqlResponse<{ demoItemOneAttachmentUrl: { url: string } }>> {
  return graphql<{ demoItemOneAttachmentUrl: { url: string } }>(
    DEMO_ITEM_ONE_ATTACHMENT_URL,
    { id },
    accessToken,
  );
}

/* ---- 劇本 18 / 19:表單引擎 ---- */
/**
 * 表單引擎的前置操作(劇本 18 / 19;正本 `packages/graphql/src/documents/base/forms.graphql`、
 * `form-submissions.graphql`,這裡只抄 e2e 用到的欄位)。前置一律走 api(TEST-11):
 * 劇本 19 的共用表單由 root 以 api 建好、發布、分派,畫面只跑客製與退役那一段。
 */

const CREATE_FORM = `
mutation CreateForm($input: CreateFormInput!) {
  createForm(input: $input) { form { key } }
}`;

const CREATE_FORM_VERSION_DRAFT = `
mutation CreateFormVersionDraft($input: CreateFormVersionDraftInput!) {
  createFormVersionDraft(input: $input) { formVersion { draftRevision } }
}`;

const SAVE_FORM_VERSION_DRAFT = `
mutation SaveFormVersionDraft($input: SaveFormVersionDraftInput!) {
  saveFormVersionDraft(input: $input) { formVersion { draftRevision } }
}`;

const PUBLISH_FORM_VERSION = `
mutation PublishFormVersion($input: PublishFormVersionInput!) {
  publishFormVersion(input: $input) { formVersion { version } }
}`;

const ASSIGN_FORM_TO_TENANTS = `
mutation AssignFormToTenants($input: AssignFormToTenantsInput!) {
  assignFormToTenants(input: $input) { form { key } }
}`;

const CREATE_FORM_DRAFT = `
mutation CreateFormDraft($input: CreateFormDraftInput!) {
  createFormDraft(input: $input) { submission { id status } }
}`;

const MODULE_FORMS = `
query ModuleForms($moduleKey: ID!) {
  moduleForms(moduleKey: $moduleKey) { key name currentVersion }
}`;

/** 示範表單(頂層)(seed `apps/db-migrator/seeds/base/modules/demo-form.ts`):劇本 18 / 19 用。 */
export const DEMO_FORM = "demo-form";
export const DEMO_FORM_ROUTE = "/demo-form";
export const DEMO_FORM_CREATE_ROUTE = `${DEMO_FORM_ROUTE}/create-page`;
export const DEMO_FORM_VIEW_ROUTE = `${DEMO_FORM_ROUTE}/view-page`;
export const FORMS_ROUTE = "/system/forms";

/** 表單 key:小寫開頭、只允許小寫 / 數字 / 底線(場景字尾是隨機 hex,前面補固定字母)。 */
export function formKeyOf(prefix: string, slug: string): string {
  return `${prefix}_${slug}`.toLowerCase().replaceAll(/[^a-z0-9_]/g, "_");
}

/** 一個單行文字欄位、一個分區、摘要標題指向它 —— 檢查器沒有錯的最小定義。 */
export function oneTextFieldDefinition(fieldKey: string, label: string) {
  return {
    fields: [
      {
        key: fieldKey,
        label,
        type: "text",
        widget: { kind: "textField" },
        valueSource: { kind: "input" },
        options: null,
        rules: { required: true },
        permission: { show: false, edit: false },
        help: null,
      },
    ],
    layout: {
      sections: [
        {
          key: "basic",
          title: "內容",
          rows: [{ cols: [{ fieldKey, span: 12 }] }],
        },
      ],
    },
    summaryMap: { title: fieldKey },
    prefills: [],
  };
}

/** root 建共用表單 → 開草稿 → 存定義 → 發布 → 分派給租戶(劇本 19 的前置)。 */
export async function publishSharedForm(
  rootToken: string,
  input: {
    key: string;
    name: string;
    definition: ReturnType<typeof oneTextFieldDefinition>;
    tenantOrgIds: readonly string[];
  },
): Promise<void> {
  await graphqlOk(
    CREATE_FORM,
    { input: { key: input.key, moduleKey: DEMO_FORM, name: input.name } },
    rootToken,
  );
  const draft = await graphqlOk<{
    createFormVersionDraft: { formVersion: { draftRevision: number } };
  }>(CREATE_FORM_VERSION_DRAFT, { input: { formKey: input.key } }, rootToken);
  const saved = await graphqlOk<{
    saveFormVersionDraft: { formVersion: { draftRevision: number } };
  }>(
    SAVE_FORM_VERSION_DRAFT,
    {
      input: {
        formKey: input.key,
        expectedDraftRevision:
          draft.createFormVersionDraft.formVersion.draftRevision,
        ...input.definition,
      },
    },
    rootToken,
  );
  await graphqlOk(
    PUBLISH_FORM_VERSION,
    {
      input: {
        formKey: input.key,
        expectedDraftRevision:
          saved.saveFormVersionDraft.formVersion.draftRevision,
        changelog: "e2e 前置",
      },
    },
    rootToken,
  );
  await graphqlOk(
    ASSIGN_FORM_TO_TENANTS,
    { input: { formKey: input.key, tenantOrgIds: [...input.tenantOrgIds] } },
    rootToken,
  );
}

/** 此刻可以在示範表單(頂層)新增的表單 key。 */
export async function moduleFormKeys(accessToken: string): Promise<string[]> {
  const data = await graphqlOk<{ moduleForms: { key: string }[] }>(
    MODULE_FORMS,
    { moduleKey: DEMO_FORM },
    accessToken,
  );
  return data.moduleForms.map((form) => form.key);
}

/** 原樣回傳的 `createFormDraft`(劇本 19:退役後 → `FORBIDDEN` + `FORM_NOT_AVAILABLE`)。 */
export function createFormDraftRaw(
  accessToken: string,
  formKey: string,
): Promise<
  GraphqlResponse<{ createFormDraft: { submission: { id: string } } }>
> {
  return graphql<{ createFormDraft: { submission: { id: string } } }>(
    CREATE_FORM_DRAFT,
    {
      input: {
        formKey,
        clientRequestId: `e2e-${formKey}-${String(Date.now())}`,
      },
    },
    accessToken,
  );
}
