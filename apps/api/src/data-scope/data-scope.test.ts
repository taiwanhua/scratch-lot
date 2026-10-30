import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import { OperatorContextService } from "../auth/operator-context.service";
import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import {
  createOrg,
  createUser,
  findRootOrgId,
} from "../auth/test-support/fixtures";
import {
  AuditLogsRepository,
  CustomersRepository,
  DemoItemsOneRepository,
  DemoItemsTwoRepository,
  FieldsRepository,
  OrgsRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { createRole } from "../permission/test-support/fixtures";
import { DataScopeService } from "./data-scope.service";
import {
  SAMPLE_ONE_MODULE_KEY,
  dataScopeTargetIdOf,
} from "./test-support/fixtures";

const PASSWORD = ["test", "pass", "word"].join("-");

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const DATA_SCOPE_TARGETS = /* GraphQL */ `
  query DataScopeTargets {
    dataScopeTargets {
      targets {
        id
        collection
        moduleKey
        moduleName
        name
        description
        hasRule
        fields {
          name
          label
          type
          isBase
          options {
            value
          }
        }
      }
    }
  }
`;

const DATA_SCOPE_RULE = /* GraphQL */ `
  query DataScopeRule($targetId: ID!) {
    dataScopeRule(targetId: $targetId) {
      rule {
        targetId
        collection
        moduleKey
        combineOp
        rules {
          audience
          filter
        }
      }
    }
  }
`;

const SAVE_DATA_SCOPE_RULE = /* GraphQL */ `
  mutation SaveDataScopeRule($input: SaveDataScopeRuleInput!) {
    saveDataScopeRule(input: $input) {
      rule {
        collection
        combineOp
        rules {
          audience
          filter
        }
      }
    }
  }
`;

interface LoginData {
  login: { accessToken: string };
}

interface TargetField {
  name: string;
  label: string;
  type: string;
  isBase: boolean;
  options: { value: string }[];
}

interface TargetsData {
  dataScopeTargets: {
    targets: {
      id: string;
      collection: string;
      moduleKey: string;
      moduleName: string;
      name: string;
      description: string | null;
      hasRule: boolean;
      fields: TargetField[];
    }[];
  };
}

interface RuleShape {
  targetId?: string;
  collection: string;
  moduleKey?: string;
  combineOp: string;
  rules: {
    audience: Record<string, unknown>;
    filter: Record<string, unknown>;
  }[];
}

interface RuleData {
  dataScopeRule: { rule: RuleShape | null };
}

interface SaveRuleData {
  saveDataScopeRule: { rule: RuleShape };
}

interface AuditRecord {
  action: string;
  targetType?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/** 【操作者本人】的條件列:建立者 = 正在查的人(ADR-0008「僅本人」)。 */
const ONLY_MINE = {
  op: "AND",
  children: [
    {
      field: "createdBy",
      cond: "in",
      value: { kind: "dynamic", ref: "current-user" },
    },
  ],
};

/** 【操作者的所屬組織】的條件列(ADR-0008「僅所屬組織」)。 */
const ONLY_MY_ORGS = {
  op: "AND",
  children: [
    {
      field: "orgId",
      cond: "in",
      value: { kind: "dynamic", ref: "current-user-orgs" },
    },
  ],
};

/** 在編譯好的條件裡找 `createdAt` 的比對式(日期條件的邊界測試用)。 */
function createdAtConditionOf(node: unknown): unknown {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = createdAtConditionOf(child);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (typeof node !== "object" || node === null) {
    return undefined;
  }
  if ("createdAt" in node) {
    return node.createdAt;
  }
  return createdAtConditionOf(Object.values(node));
}

/** 一條「全部人 → 建立時間 <cond> <values>」的規則(日期條件的測試用)。 */
function dateRule(cond: string, values: string[]) {
  return [
    {
      audience: { mode: "all" },
      filter: {
        op: "AND",
        children: [
          { field: "createdAt", cond, value: { kind: "static", values } },
        ],
      },
    },
  ];
}

/** 名稱排序後比對:查詢順序不是本測試的斷言對象。 */
function sortedNames(rows: readonly { name: string }[]): string[] {
  return rows
    .map((row) => row.name)
    .toSorted((a, b) => a.localeCompare(b, "zh-Hant"));
}

/** 兩條都可能命中同一個人的規則:「全部人 → 僅本人」+「客服角色 → 部門二」。 */
function twoRules(
  roleId: string,
  orgId: Types.ObjectId,
): Record<string, unknown>[] {
  return [
    { audience: { mode: "all" }, filter: ONLY_MINE },
    {
      audience: {
        mode: "match",
        filter: {
          field: "role",
          cond: "in",
          value: { kind: "static", values: [roleId] },
        },
      },
      filter: staticOrgFilter(orgId),
    },
  ];
}

function staticOrgFilter(orgId: Types.ObjectId): Record<string, unknown> {
  return {
    op: "AND",
    children: [
      {
        field: "orgId",
        cond: "in",
        value: { kind: "static", values: [String(orgId)] },
      },
    ],
  };
}

/**
 * 資料範圍(目標目錄 / 規則讀寫 / DataScopeService + BaseRepository 執行)。
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07);
 * `docs/testing/permission-scenarios.md` 劇本 2(規則命中 → 只見自建;刪規則恢復)、
 * 3(未宣告對照)、4(頂層合成 OR / AND)。
 *
 * **第二個接縫**(TEST-07 的例外,PR 有說明):規則的**執行**發生在 BaseRepository 的查詢中介層,
 * 而示範模組的 GraphQL 端點屬第 5 段、現在還不存在 — 因此以 `app.get()` 取出
 * `OperatorContextService`(算出真正的操作者上下文,含所屬組織與角色)與
 * `DemoItemsOneRepository` / `DemoItemsTwoRepository` 直接查,驗的仍是正式執行路徑。
 *
 * 組織樹(root 為 seed 建的根組織):
 *   root ── 租戶甲 ─┬─ 部門一
 *                   └─ 部門二
 */
describe("資料範圍(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;

  let rootOrgId: Types.ObjectId;
  let tenantA: Types.ObjectId;
  let deptOne: Types.ObjectId;
  let deptTwo: Types.ObjectId;

  let rootToken: string;
  let tenantViewerToken: string;

  let agentUserId: Types.ObjectId;
  let peerUserId: Types.ObjectId;
  let supervisorUserId: Types.ObjectId;
  let agentRoleId: Types.ObjectId;
  /** 示範模組1 的資料範圍目標 id(`demo_items_one` + `demo.sub.sample-one`)。 */
  let sampleOneTargetId: string;

  async function login(account: string, password = PASSWORD): Promise<string> {
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

  /** 真正的操作者上下文(登入線算出來的那一份,含 memberOrgIds / roleIds)。 */
  function operatorOf(
    userId: Types.ObjectId,
    currentOrgId: Types.ObjectId,
  ): Promise<OperatorContext> {
    return api.app
      .get(OperatorContextService)
      .resolve(userId, currentOrgId)
      .then((resolution) => resolution.operator);
  }

  /** 以某人的身分查示範模組1,回傳看得到的項目名稱(排序後比對)。 */
  async function visibleItemsOne(
    userId: Types.ObjectId,
    currentOrgId: Types.ObjectId,
  ): Promise<string[]> {
    const operator = await operatorOf(userId, currentOrgId);
    const found = await api.app.get(DemoItemsOneRepository).findMany(operator);
    return sortedNames(found);
  }

  async function visibleItemsTwo(
    userId: Types.ObjectId,
    currentOrgId: Types.ObjectId,
  ): Promise<string[]> {
    const operator = await operatorOf(userId, currentOrgId);
    const found = await api.app.get(DemoItemsTwoRepository).findMany(operator);
    return sortedNames(found);
  }

  async function saveRule(
    rules: Record<string, unknown>[],
    combineOp: "AND" | "OR" = "OR",
    token = rootToken,
  ): Promise<ReturnType<AuthTestApp["graphql"]>> {
    return saveRuleOf(sampleOneTargetId, rules, combineOp, token);
  }

  async function saveRuleOf(
    targetId: string,
    rules: Record<string, unknown>[],
    combineOp: "AND" | "OR" = "OR",
    token = rootToken,
  ): Promise<ReturnType<AuthTestApp["graphql"]>> {
    return api.graphql<SaveRuleData>(
      SAVE_DATA_SCOPE_RULE,
      { input: { targetId, combineOp, rules } },
      { accessToken: token },
    );
  }

  /** 示範模組1 這個目標目前的 `hasRule`。 */
  async function hasRule(): Promise<boolean | undefined> {
    const result = await api.graphql<TargetsData>(
      DATA_SCOPE_TARGETS,
      {},
      { accessToken: rootToken },
    );
    expect(result.errors).toBeUndefined();
    return result.data?.dataScopeTargets.targets.find(
      (target) => target.id === sampleOneTargetId,
    )?.hasRule;
  }

  /** 送一條必定驗不過的規則,回傳 `RULE_INVALID` 的 extensions。 */
  async function saveInvalid(
    filter: unknown,
    audience?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const result = await saveRule([
      { audience: audience ?? { mode: "all" }, filter },
    ]);
    const error = result.errors?.[0];
    expect(error).toBeDefined();
    return error?.extensions ?? {};
  }

  /** 客服甲看得到的「日期 …」那幾筆(日期條件的測試用;其他資料的建立時間是現在,不在比對範圍內)。 */
  async function datedVisible(): Promise<string[]> {
    const names = await visibleItemsOne(agentUserId, deptOne);
    return names.filter((name) => name.startsWith("日期 "));
  }

  async function setTenantTimezone(timezone: string | null): Promise<void> {
    await connection
      .collection("orgs")
      .updateOne(
        { _id: tenantA },
        timezone === null
          ? { $unset: { "settings.timezone": "" } }
          : { $set: { "settings.timezone": timezone } },
      );
  }

  async function setRootTimezone(timezone: string | null): Promise<void> {
    await connection
      .collection("orgs")
      .updateOne(
        { _id: rootOrgId },
        timezone === null
          ? { $unset: { "settings.timezone": "" } }
          : { $set: { "settings.timezone": timezone } },
      );
  }

  /** 直接問執行面:站在某組織(`null` = 系統上下文)查示範模組1 時,`createdAt` 的比對條件。 */
  async function createdAtBoundOf(
    currentOrgId: Types.ObjectId | null,
  ): Promise<unknown> {
    const operator: OperatorContext = {
      actorId: null,
      currentOrgId,
      visibleOrgIds: "all",
      managedOrgIds: "all",
      memberOrgIds: [],
      roleIds: [],
      memberTenants: [],
    };
    const condition = await api.app
      .get(DataScopeService)
      .conditionFor("demo_items_one", operator);
    return createdAtConditionOf(condition);
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-data-scope");
    connection = api.connection;

    rootOrgId = await findRootOrgId(connection);
    tenantA = await createOrg(connection, { name: "租戶甲" });
    deptOne = await createOrg(connection, {
      name: "部門一",
      parentId: tenantA,
    });
    deptTwo = await createOrg(connection, {
      name: "部門二",
      parentId: tenantA,
    });

    rootToken = await login(ROOT_ADMIN.account, ROOT_ADMIN.password);
    sampleOneTargetId = await dataScopeTargetIdOf(
      connection,
      SAMPLE_ONE_MODULE_KEY,
    );

    // 客服甲 / 客服乙:同屬部門一;主管:屬租戶甲(沒開可見性開關 ⇒ 只看得到租戶甲本身)
    agentUserId = await createUser(connection, {
      account: "agent-a",
      password: PASSWORD,
      orgIds: [deptOne],
    });
    peerUserId = await createUser(connection, {
      account: "agent-b",
      password: PASSWORD,
      orgIds: [deptOne],
    });
    supervisorUserId = await createUser(connection, {
      account: "supervisor",
      password: PASSWORD,
      orgIds: [deptOne, deptTwo],
    });
    agentRoleId = await createRole(api.app, connection, {
      name: "客服角色",
      ownerOrgId: tenantA,
      assignTo: [agentUserId],
    });

    // 租戶端的「資料範圍」檢視者:持有權限但站在租戶裡(根組織專屬 → 仍該被擋)
    const tenantViewerId = await createUser(connection, {
      account: "tenant-viewer",
      password: PASSWORD,
      orgIds: [tenantA],
    });
    await createRole(api.app, connection, {
      name: "租戶端資料範圍檢視者",
      ownerOrgId: tenantA,
      moduleKeys: ["system", "system.data-scope"],
      permissionKeys: ["system.data-scope.view", "system.data-scope.edit"],
      assignTo: [tenantViewerId],
    });
    tenantViewerToken = await login("tenant-viewer");

    // 示範資料:部門一由客服甲 / 客服乙各建一筆,部門二由主管建一筆
    const asAgent = await operatorOf(agentUserId, deptOne);
    const asPeer = await operatorOf(peerUserId, deptOne);
    const asSupervisor = await operatorOf(supervisorUserId, deptTwo);
    const itemsOne = api.app.get(DemoItemsOneRepository);
    const itemsTwo = api.app.get(DemoItemsTwoRepository);
    for (const [name, operator] of [
      ["甲的項目", asAgent],
      ["乙的項目", asPeer],
      ["部門二的項目", asSupervisor],
    ] as const) {
      await itemsOne.create(operator, { name });
      await itemsTwo.create(operator, { name });
    }
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("資料目標與欄位目錄(dataScopeTargets)", () => {
    it("一列 = 一個模組:只列 seed 宣告的目標(示範模組2 沒宣告就不在清單裡,劇本 3 的對照);主文字是模組名", async () => {
      const result = await api.graphql<TargetsData>(
        DATA_SCOPE_TARGETS,
        {},
        { accessToken: rootToken },
      );
      expect(result.errors).toBeUndefined();
      const rows = result.data?.dataScopeTargets.targets.map((target) => ({
        moduleKey: target.moduleKey,
        moduleName: target.moduleName,
        collection: target.collection,
      }));
      // 依模組 key 排序;表單模組的目標 collection 固定 form_submissions
      expect(rows).toEqual([
        {
          moduleKey: "demo-form",
          moduleName: "示範表單(頂層)",
          collection: "form_submissions",
        },
        {
          moduleKey: "demo.form",
          moduleName: "示範表單(群組內)",
          collection: "form_submissions",
        },
        {
          moduleKey: "demo.sub.form",
          moduleName: "示範表單(次群組內)",
          collection: "form_submissions",
        },
        {
          moduleKey: "demo.sub.sample-one",
          moduleName: "示範模組1",
          collection: "demo_items_one",
        },
      ]);
    });

    it("底座的六個基礎欄位自動掛進目錄,且標記 isBase", async () => {
      const result = await api.graphql<TargetsData>(
        DATA_SCOPE_TARGETS,
        {},
        { accessToken: rootToken },
      );
      const target = result.data?.dataScopeTargets.targets[0];
      const base = (target?.fields ?? []).filter((field) => field.isBase);
      expect(base.map((field) => field.name)).toEqual([
        "orgId",
        "createdBy",
        "updatedBy",
        "createdAt",
        "updatedAt",
        "deletedAt",
      ]);
      expect(base.map((field) => field.type)).toEqual([
        "ORG",
        "USER",
        "USER",
        "DATE",
        "DATE",
        "DATE",
      ]);
    });

    it("seed 宣告的 enum 業務欄位排在基礎欄位之前,並帶固定選項", async () => {
      const result = await api.graphql<TargetsData>(
        DATA_SCOPE_TARGETS,
        {},
        { accessToken: rootToken },
      );
      const fields =
        result.data?.dataScopeTargets.targets.find(
          (target) => target.moduleKey === "demo.sub.sample-one",
        )?.fields ?? [];
      expect(fields[0]).toMatchObject({
        name: "status",
        label: "狀態",
        type: "ENUM",
        isBase: false,
      });
      expect(fields[0]?.options.map((option) => option.value)).toEqual([
        "draft",
        "published",
        "archived",
      ]);
    });

    it("尚未設規則的目標 hasRule = false", async () => {
      const result = await api.graphql<TargetsData>(
        DATA_SCOPE_TARGETS,
        {},
        { accessToken: rootToken },
      );
      expect(result.data?.dataScopeTargets.targets[0]?.hasRule).toBe(false);
    });

    it("根組織專屬:站在租戶裡即使持有權限也回 FORBIDDEN", async () => {
      const result = await api.graphql<TargetsData>(
        DATA_SCOPE_TARGETS,
        {},
        { accessToken: tenantViewerToken },
      );
      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });
  });

  describe("規則的讀寫(dataScopeRule / saveDataScopeRule)", () => {
    it("尚未設定過 → null(ADR-0008:沒有規則 = 只有租戶保底)", async () => {
      const result = await api.graphql<RuleData>(
        DATA_SCOPE_RULE,
        { targetId: sampleOneTargetId },
        { accessToken: rootToken },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.dataScopeRule.rule).toBeNull();
    });

    it("不是 seed 宣告的目標 → NOT_FOUND", async () => {
      for (const targetId of [String(new Types.ObjectId()), "not-an-id"]) {
        const result = await api.graphql<RuleData>(
          DATA_SCOPE_RULE,
          { targetId },
          { accessToken: rootToken },
        );
        expect(result.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
      }
    });

    it("RULE_INVALID:欄位不在目錄裡,path 指到該條件列", async () => {
      const extensions = await saveInvalid({
        op: "AND",
        children: [
          {
            field: "nickname",
            cond: "in",
            value: { kind: "static", values: ["x"] },
          },
        ],
      });
      expect(extensions.code).toBe("RULE_INVALID");
      expect(extensions.reason).toBe("UNKNOWN_FIELD");
      expect(extensions.path).toBe("rules[0].filter.children[0].field");
    });

    it("RULE_INVALID:運算子不符型別(date 不吃 in)", async () => {
      const extensions = await saveInvalid({
        op: "AND",
        children: [
          {
            field: "createdAt",
            cond: "in",
            value: { kind: "static", values: ["2026-01-01"] },
          },
        ],
      });
      expect(extensions.reason).toBe("CONDITION_NOT_ALLOWED");
      expect(extensions.path).toBe("rules[0].filter.children[0].cond");
    });

    it("RULE_INVALID:值來源不符型別(date 沒有動態值)", async () => {
      const extensions = await saveInvalid({
        op: "AND",
        children: [
          {
            field: "createdAt",
            cond: "before",
            value: { kind: "dynamic", ref: "current-user" },
          },
        ],
      });
      expect(extensions.reason).toBe("VALUE_SOURCE_NOT_ALLOWED");
      expect(extensions.path).toBe("rules[0].filter.children[0].value.ref");
    });

    it("RULE_INVALID:user 欄位的靜態值不是 id", async () => {
      const extensions = await saveInvalid({
        op: "AND",
        children: [
          {
            field: "createdBy",
            cond: "in",
            value: { kind: "static", values: ["not-an-object-id"] },
          },
        ],
      });
      expect(extensions.reason).toBe("VALUE_INVALID");
      expect(extensions.path).toBe(
        "rules[0].filter.children[0].value.values[0]",
      );
    });

    it("RULE_INVALID:between 要剛好兩個日期", async () => {
      const extensions = await saveInvalid({
        op: "AND",
        children: [
          {
            field: "createdAt",
            cond: "between",
            value: { kind: "static", values: ["2026-01-01"] },
          },
        ],
      });
      expect(extensions.reason).toBe("VALUE_INVALID");
      expect(extensions.path).toBe("rules[0].filter.children[0].value.values");
    });

    it("RULE_INVALID:日期值只收帶時區的時點,`YYYY-MM-DD` 一律拒", async () => {
      for (const value of ["2026-01-01", "2026-01-01T00:00:00"]) {
        const extensions = await saveInvalid({
          op: "AND",
          children: [
            {
              field: "createdAt",
              cond: "before",
              value: { kind: "static", values: [value] },
            },
          ],
        });
        expect(extensions.reason).toBe("VALUE_INVALID");
        expect(extensions.path).toBe(
          "rules[0].filter.children[0].value.values[0]",
        );
      }
    });

    it("RULE_INVALID:空群組", async () => {
      const extensions = await saveInvalid({ op: "OR", children: [] });
      expect(extensions.reason).toBe("EMPTY_GROUP");
      expect(extensions.path).toBe("rules[0].filter.children");
    });

    it.each([
      ["mode 不認得", { mode: "everyone" }, "rules[0].audience.mode"],
      ["match 沒有條件列", { mode: "match" }, "rules[0].audience.filter"],
      [
        "match 的群組是空的",
        { mode: "match", filter: { op: "AND", children: [] } },
        "rules[0].audience.filter.children",
      ],
      [
        "欄位不合法",
        {
          mode: "match",
          filter: {
            op: "AND",
            children: [
              {
                field: "role",
                cond: "in",
                value: {
                  kind: "static",
                  values: [String(new Types.ObjectId())],
                },
              },
              {
                field: "createdBy",
                cond: "in",
                value: { kind: "static", values: [] },
              },
            ],
          },
        },
        "rules[0].audience.filter.children[1].field",
      ],
      [
        "資料範圍的組織只能指定(不收動態來源)",
        {
          mode: "match",
          filter: {
            field: "org",
            cond: "in",
            value: { kind: "dynamic", ref: "tenant" },
            range: "self",
          },
        },
        "rules[0].audience.filter.value.ref",
      ],
      ["舊格式 ALL", { type: "all" }, "rules[0].audience.mode"],
      [
        "舊格式 ROLE",
        { type: "role", ids: [String(new Types.ObjectId())] },
        "rules[0].audience.mode",
      ],
    ])("RULE_INVALID / AUDIENCE_INVALID:%s", async (_label, audience, path) => {
      const extensions = await saveInvalid(ONLY_MINE, audience);
      expect(extensions.reason).toBe("AUDIENCE_INVALID");
      expect(extensions.path).toBe(path);
    });

    it("編輯是根組織專屬的:租戶端持有 edit 也被擋", async () => {
      const result = await saveRule(
        [{ audience: { mode: "all" }, filter: ONLY_MINE }],
        "OR",
        tenantViewerToken,
      );
      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });
  });

  describe("已設規則的旗標(DataScopeTarget.hasRule)", () => {
    it("存了規則之後 → true", async () => {
      const result = await saveRule([
        { audience: { mode: "all" }, filter: ONLY_MINE },
      ]);
      expect(result.errors).toBeUndefined();
      expect(await hasRule()).toBe(true);
    });

    it("整份覆蓋成空陣列(= 刪掉規則)→ 回到 false,與執行面同一條判準", async () => {
      const result = await saveRule([]);
      expect(result.errors).toBeUndefined();
      // 規則文件還在(dataScopeRule 回得到),但沒有任何規則 ⇒ 不算已設
      const rule = await api.graphql<RuleData>(
        DATA_SCOPE_RULE,
        { targetId: sampleOneTargetId },
        { accessToken: rootToken },
      );
      expect(rule.data?.dataScopeRule.rule?.rules).toEqual([]);
      expect(await hasRule()).toBe(false);
    });
  });

  describe("劇本 2:規則命中 → 只見自建;刪規則 → 恢復", () => {
    it("套用對象 = 客服角色 → 建立者 =【操作者本人】", async () => {
      // 先暖快取:規則存檔前查一次,確認看得到全部(快取作廢才會有後面的差異)
      expect(await visibleItemsOne(agentUserId, deptOne)).toEqual([
        "乙的項目",
        "甲的項目",
      ]);

      const result = await saveRule([
        {
          audience: {
            mode: "match",
            filter: {
              field: "role",
              cond: "in",
              value: { kind: "static", values: [String(agentRoleId)] },
            },
          },
          filter: ONLY_MINE,
        },
      ]);
      expect(result.errors).toBeUndefined();

      // 儲存即作廢快取:同一個行程內,下一次查詢就吃到新規則
      expect(await visibleItemsOne(agentUserId, deptOne)).toEqual(["甲的項目"]);
    });

    it("沒被命中的人不受影響(客服乙沒有客服角色)", async () => {
      expect(await visibleItemsOne(peerUserId, deptOne)).toEqual([
        "乙的項目",
        "甲的項目",
      ]);
    });

    it("劇本 3:示範模組2 未宣告目標 → 同一個人查它不受規則影響", async () => {
      expect(await visibleItemsTwo(agentUserId, deptOne)).toEqual([
        "乙的項目",
        "甲的項目",
      ]);
    });

    it("規則寫了審計(data-scope.edit)", async () => {
      const audit = await connection
        .collection("audit_logs")
        .findOne<AuditRecord>(
          { action: "data-scope.edit" },
          { sort: { createdAt: -1, _id: -1 } },
        );
      expect(audit?.targetType).toBe("data_scope_rule");
      expect(audit?.after?.combineOp).toBe("OR");
    });

    it("讀回來的規則與存進去的一致(admin 條件樹編輯器照用的形狀)", async () => {
      const result = await api.graphql<RuleData>(
        DATA_SCOPE_RULE,
        { targetId: sampleOneTargetId },
        { accessToken: rootToken },
      );
      const rule = result.data?.dataScopeRule.rule;
      expect(rule).toMatchObject({
        targetId: sampleOneTargetId,
        collection: "demo_items_one",
        moduleKey: "demo.sub.sample-one",
      });
      expect(rule?.combineOp).toBe("OR");
      expect(rule?.rules[0]?.audience).toEqual({
        mode: "match",
        filter: {
          field: "role",
          cond: "in",
          value: { kind: "static", values: [String(agentRoleId)] },
        },
      });
      expect(rule?.rules[0]?.filter).toEqual(ONLY_MINE);
    });

    it("刪規則(整份覆蓋成空)→ 恢復可見範圍", async () => {
      const result = await saveRule([]);
      expect(result.errors).toBeUndefined();
      expect(await visibleItemsOne(agentUserId, deptOne)).toEqual([
        "乙的項目",
        "甲的項目",
      ]);
    });
  });

  describe("動態值代入", () => {
    it("current-user-orgs → 操作者的所屬組織(不是可見範圍)", async () => {
      await saveRule([{ audience: { mode: "all" }, filter: ONLY_MY_ORGS }]);
      // 主管同屬部門一與部門二 → 兩邊都看得到
      expect(await visibleItemsOne(supervisorUserId, deptTwo)).toEqual([
        "乙的項目",
        "甲的項目",
        "部門二的項目",
      ]);
      // 客服甲只屬部門一 → 看不到部門二的資料
      expect(await visibleItemsOne(agentUserId, deptOne)).toEqual([
        "乙的項目",
        "甲的項目",
      ]);
    });
  });

  describe("劇本 4:頂層合成 OR / AND", () => {
    it("OR = 聯集:自建的 ∪ 部門二的", async () => {
      await saveRule(twoRules(String(agentRoleId), deptTwo), "OR");
      expect(await visibleItemsOne(agentUserId, deptOne)).toEqual(["甲的項目"]);
      // 主管的可見範圍只有部門一 / 部門二(所屬組織),兩條規則都命中「全部人」那一條
      expect(await visibleItemsOne(supervisorUserId, deptTwo)).toEqual([
        "部門二的項目",
      ]);
    });

    it("AND = 交集:兩條都要滿足,客服甲什麼都看不到", async () => {
      await saveRule(twoRules(String(agentRoleId), deptTwo), "AND");
      expect(await visibleItemsOne(agentUserId, deptOne)).toEqual([]);
    });

    it("AND 時只命中一條的人只受那一條限制", async () => {
      // 客服乙沒有客服角色 → 只命中「全部人 → 僅本人」
      expect(await visibleItemsOne(peerUserId, deptOne)).toEqual(["乙的項目"]);
    });
  });

  describe("依模組:同一個 collection 兩個模組各自的規則", () => {
    /** 同一張 demo_items_one 裡掛另一個模組的資料(模擬 form_submissions 被多個表單模組共用)。 */
    const OTHER_MODULE = "test.other-module";
    let otherTargetId: string;

    beforeAll(async () => {
      await saveRule([]);
      const inserted = await connection
        .collection("data_scope_targets")
        .insertOne({
          collection: "demo_items_one",
          moduleKey: OTHER_MODULE,
          name: "另一個模組",
          fields: [],
          isSystem: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: null,
          updatedBy: null,
          deletedAt: null,
        });
      otherTargetId = String(inserted.insertedId);
      const now = new Date();
      await connection.collection("demo_items_one").insertMany(
        [
          ["另一模組:甲的", agentUserId],
          ["另一模組:乙的", peerUserId],
        ].map(([name, createdBy]) => ({
          name,
          orgId: deptOne,
          tenantId: tenantA,
          moduleKey: OTHER_MODULE,
          status: "draft",
          enabled: true,
          createdBy,
          updatedBy: createdBy,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }, HOOK_TIMEOUT_MS);

    afterAll(async () => {
      await saveRule([]);
      await saveRuleOf(otherTargetId, []);
      await connection
        .collection("demo_items_one")
        .deleteMany({ moduleKey: OTHER_MODULE });
      await connection
        .collection("data_scope_rules")
        .deleteMany({ moduleKey: OTHER_MODULE });
      await connection
        .collection("data_scope_targets")
        .deleteMany({ moduleKey: OTHER_MODULE });
    }, HOOK_TIMEOUT_MS);

    it("只有示範模組1 有規則 → 只收窄示範模組1 的資料;沒規則的模組維持只看可見範圍", async () => {
      const result = await saveRule([
        { audience: { mode: "all" }, filter: ONLY_MINE },
      ]);
      expect(result.errors).toBeUndefined();
      expect(await visibleItemsOne(agentUserId, deptOne)).toEqual([
        "另一模組:乙的",
        "另一模組:甲的",
        "甲的項目",
      ]);
    });

    it("兩個模組各設規則 → 各自生效(另一模組:只看部門二 → 部門一的都看不到)", async () => {
      const result = await saveRuleOf(otherTargetId, [
        { audience: { mode: "all" }, filter: staticOrgFilter(deptTwo) },
      ]);
      expect(result.errors).toBeUndefined();
      expect(await visibleItemsOne(agentUserId, deptOne)).toEqual(["甲的項目"]);
    });

    it("清掉示範模組1 的規則 → 示範模組1 恢復可見範圍,另一模組的規則照舊", async () => {
      await saveRule([]);
      expect(await visibleItemsOne(agentUserId, deptOne)).toEqual([
        "乙的項目",
        "甲的項目",
      ]);
    });

    it("沒有 moduleKey 的舊文件(回填前):有規則命中時看不到,不會從 $nin 那一支溜過去", async () => {
      const now = new Date();
      await connection.collection("demo_items_one").insertOne({
        name: "回填前的舊資料",
        orgId: deptOne,
        status: "draft",
        enabled: true,
        createdBy: agentUserId,
        updatedBy: agentUserId,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      // 另一模組的規則仍命中客服甲(見上一條):舊文件不屬於任何模組 → 看不到
      expect(await visibleItemsOne(agentUserId, deptOne)).toEqual([
        "乙的項目",
        "甲的項目",
      ]);
      await connection
        .collection("demo_items_one")
        .deleteOne({ name: "回填前的舊資料" });
    });

    it("沒有 moduleKey 的規則文件(回填前)被略過,不影響其他模組的規則", async () => {
      await connection.collection("data_scope_rules").insertOne({
        collection: "demo_items_one",
        combineOp: "OR",
        rules: [{ audience: { mode: "all" }, filter: ONLY_MINE }],
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
      // 作廢快取(存一次示範模組1 的空規則),讓下一次查詢重新載入含那份舊文件的規則
      await saveRule([]);
      expect(await visibleItemsOne(agentUserId, deptOne)).toEqual([
        "乙的項目",
        "甲的項目",
      ]);
      await connection.collection("data_scope_rules").deleteMany({
        collection: "demo_items_one",
        moduleKey: { $exists: false },
      });
    });

    it("存著的套用對象不是人員條件格式(舊資料)→ 整個目標 fail-closed,誰都看不到,不是跳過那條", async () => {
      // 先清空(作廢快取),再把規則直接改成改格式前的舊形狀,讓下一次查詢載入它
      await saveRule([]);
      await connection.collection("data_scope_rules").updateOne(
        { collection: "demo_items_one", moduleKey: SAMPLE_ONE_MODULE_KEY },
        {
          $set: {
            rules: [
              {
                audience: { type: "role", ids: [String(new Types.ObjectId())] },
                filter: ONLY_MINE,
              },
            ],
          },
        },
      );
      expect(await visibleItemsOne(agentUserId, deptOne)).toEqual([]);
      await saveRule([]);
      expect(await visibleItemsOne(agentUserId, deptOne)).toEqual([
        "乙的項目",
        "甲的項目",
      ]);
    });
  });

  describe("日期條件:日曆天、逐租戶套用 —— 以根組織的時區還原那一天,以操作者租戶的時區算邊界", () => {
    /**
     * 建立時間落在台北時區(UTC+8)日界線兩側的五筆(名稱 = 台北的當地時間):
     * 「0101-0730」在 UTC 還是 12/31,「0101-2359」與「0102-0000」只差一分鐘卻分屬兩天。
     */
    const DATED_ITEMS: readonly [string, string][] = [
      ["日期 0101-0730", "2019-12-31T23:30:00.000Z"],
      ["日期 0101-2359", "2020-01-01T15:59:00.000Z"],
      ["日期 0102-0000", "2020-01-01T16:00:00.000Z"],
      ["日期 0102-2359", "2020-01-02T15:59:59.000Z"],
      ["日期 0103-0000", "2020-01-02T16:00:00.000Z"],
    ];
    /** 台北時區 2020-01-01 / 01-02 的 00:00(admin 以租戶時區把選的那天換成的時點)。 */
    const TAIPEI_0101 = "2019-12-31T16:00:00.000Z";
    const TAIPEI_0102 = "2020-01-01T16:00:00.000Z";

    beforeAll(async () => {
      await setTenantTimezone("Asia/Taipei");
      await connection.collection("demo_items_one").insertMany(
        DATED_ITEMS.map(([name, createdAt]) => ({
          name,
          orgId: deptOne,
          tenantId: tenantA,
          moduleKey: SAMPLE_ONE_MODULE_KEY,
          status: "draft",
          enabled: true,
          createdBy: agentUserId,
          updatedBy: agentUserId,
          deletedAt: null,
          createdAt: new Date(createdAt),
          updatedAt: new Date(createdAt),
        })),
      );
    }, HOOK_TIMEOUT_MS);

    afterAll(async () => {
      await saveRule([]);
      await setTenantTimezone(null);
      await connection
        .collection("demo_items_one")
        .deleteMany({ name: { $regex: "^日期 " } });
    }, HOOK_TIMEOUT_MS);

    it("between 同一天:台北 08:00 前(UTC 還是前一天)的資料落在台北的那一天", async () => {
      const result = await saveRule(
        dateRule("between", [TAIPEI_0101, TAIPEI_0101]),
      );
      expect(result.errors).toBeUndefined();
      expect(await datedVisible()).toEqual([
        "日期 0101-0730",
        "日期 0101-2359",
      ]);
    });

    it("between 迄日整天都含(到 23:59:59),次日 00:00 起不含", async () => {
      await saveRule(dateRule("between", [TAIPEI_0101, TAIPEI_0102]));
      expect(await datedVisible()).toEqual([
        "日期 0101-0730",
        "日期 0101-2359",
        "日期 0102-0000",
        "日期 0102-2359",
      ]);
    });

    it("before 不含當天、after 不含當天(從次日 00:00 起)", async () => {
      await saveRule(dateRule("before", [TAIPEI_0102]));
      expect(await datedVisible()).toEqual([
        "日期 0101-0730",
        "日期 0101-2359",
      ]);

      await saveRule(dateRule("after", [TAIPEI_0101]));
      expect(await datedVisible()).toEqual([
        "日期 0102-0000",
        "日期 0102-2359",
        "日期 0103-0000",
      ]);
    });

    it("邊界時點:根組織(台北)存的「2020-02-01」,台北的操作者從台北 2/1 00:00 起算、倫敦租戶的操作者從倫敦 2/1 00:00 起算", async () => {
      const TAIPEI_0201 = "2020-01-31T16:00:00.000Z";
      await setTenantTimezone("Europe/London");
      try {
        await saveRule(dateRule("before", [TAIPEI_0201]));
        expect(await createdAtBoundOf(rootOrgId)).toEqual({
          $lt: new Date("2020-01-31T16:00:00.000Z"),
        });
        expect(await createdAtBoundOf(deptOne)).toEqual({
          $lt: new Date("2020-02-01T00:00:00.000Z"),
        });

        await saveRule(dateRule("after", [TAIPEI_0201]));
        expect(await createdAtBoundOf(rootOrgId)).toEqual({
          $gte: new Date("2020-02-01T16:00:00.000Z"),
        });
        expect(await createdAtBoundOf(deptOne)).toEqual({
          $gte: new Date("2020-02-02T00:00:00.000Z"),
        });
      } finally {
        await setTenantTimezone("Asia/Taipei");
      }
    });

    it("系統上下文(沒有當前組織):操作者時區退回根組織的時區", async () => {
      await setRootTimezone("Europe/London");
      try {
        // 倫敦 2020-02-01 00:00 = 2/1 00:00Z;若退回預設(台北)會是 1/31 16:00Z
        await saveRule(dateRule("before", ["2020-02-01T00:00:00.000Z"]));
        expect(await createdAtBoundOf(null)).toEqual({
          $lt: new Date("2020-02-01T00:00:00.000Z"),
        });
      } finally {
        await setRootTimezone(null);
      }
    });

    it("夏令時間切換日:倫敦租戶以倫敦當地的 00:00 為界(3 月底進、10 月底出)", async () => {
      await setTenantTimezone("Europe/London");
      try {
        // 台北存 2020-03-29(倫敦當天 01:00 進夏令時間):次日 00:00 = 3/29 23:00Z
        await saveRule(dateRule("after", ["2020-03-28T16:00:00.000Z"]));
        expect(await createdAtBoundOf(deptOne)).toEqual({
          $gte: new Date("2020-03-29T23:00:00.000Z"),
        });
        await saveRule(
          dateRule("between", [
            "2020-03-28T16:00:00.000Z",
            "2020-03-28T16:00:00.000Z",
          ]),
        );
        expect(await createdAtBoundOf(deptOne)).toEqual({
          $gte: new Date("2020-03-29T00:00:00.000Z"),
          $lt: new Date("2020-03-29T23:00:00.000Z"),
        });

        // 台北存 2020-10-25(倫敦當天 02:00 回標準時間):當天 00:00 = 10/24 23:00Z,次日 00:00 = 10/26 00:00Z
        await saveRule(
          dateRule("between", [
            "2020-10-24T16:00:00.000Z",
            "2020-10-24T16:00:00.000Z",
          ]),
        );
        expect(await createdAtBoundOf(deptOne)).toEqual({
          $gte: new Date("2020-10-24T23:00:00.000Z"),
          $lt: new Date("2020-10-26T00:00:00.000Z"),
        });
        await saveRule(dateRule("after", ["2020-10-24T16:00:00.000Z"]));
        expect(await createdAtBoundOf(deptOne)).toEqual({
          $gte: new Date("2020-10-26T00:00:00.000Z"),
        });
      } finally {
        await setTenantTimezone("Asia/Taipei");
      }
    });

    it("午夜切換夏令時間的時區(聖地牙哥):當天 00:00 不存在時從當天第一個時點起算", async () => {
      await setTenantTimezone("America/Santiago");
      try {
        // 台北存 2020-09-06;聖地牙哥 9/6 00:00 直接跳到 01:00(-03)= 04:00Z,9/7 00:00 = 03:00Z
        await saveRule(
          dateRule("between", [
            "2020-09-05T16:00:00.000Z",
            "2020-09-05T16:00:00.000Z",
          ]),
        );
        expect(await createdAtBoundOf(deptOne)).toEqual({
          $gte: new Date("2020-09-06T04:00:00.000Z"),
          $lt: new Date("2020-09-07T03:00:00.000Z"),
        });
        // 前一天 9/5 的次日邊界同一個時點
        await saveRule(dateRule("after", ["2020-09-04T16:00:00.000Z"]));
        expect(await createdAtBoundOf(deptOne)).toEqual({
          $gte: new Date("2020-09-06T04:00:00.000Z"),
        });
      } finally {
        await setTenantTimezone("Asia/Taipei");
      }
    });

    it("倫敦租戶的操作者:同一份規則以倫敦的那一天為界(between 同一天 / 迄日整天含)", async () => {
      await setTenantTimezone("Europe/London");
      try {
        // 倫敦 01/01 = 01/01 00:00Z ~ 01/02 00:00Z
        await saveRule(dateRule("between", [TAIPEI_0101, TAIPEI_0101]));
        expect(await datedVisible()).toEqual([
          "日期 0101-2359",
          "日期 0102-0000",
        ]);

        // 倫敦 01/01 ~ 01/02 整天 = 01/01 00:00Z ~ 01/03 00:00Z
        await saveRule(dateRule("between", [TAIPEI_0101, TAIPEI_0102]));
        expect(await datedVisible()).toEqual([
          "日期 0101-2359",
          "日期 0102-0000",
          "日期 0102-2359",
          "日期 0103-0000",
        ]);
      } finally {
        await setTenantTimezone("Asia/Taipei");
      }
    });

    it("倫敦租戶的操作者:before / after 也不含當天,當天以倫敦算", async () => {
      await setTenantTimezone("Europe/London");
      try {
        // 倫敦 01/02 00:00Z 前
        await saveRule(dateRule("before", [TAIPEI_0102]));
        expect(await datedVisible()).toEqual([
          "日期 0101-0730",
          "日期 0101-2359",
          "日期 0102-0000",
        ]);

        // 倫敦 01/02 00:00Z 起
        await saveRule(dateRule("after", [TAIPEI_0101]));
        expect(await datedVisible()).toEqual([
          "日期 0102-2359",
          "日期 0103-0000",
        ]);
      } finally {
        await setTenantTimezone("Asia/Taipei");
      }
    });

    it("操作者的租戶沒設時區 → 退回預設時區(台北)", async () => {
      await setTenantTimezone(null);
      try {
        await saveRule(dateRule("between", [TAIPEI_0101, TAIPEI_0101]));
        expect(await datedVisible()).toEqual([
          "日期 0101-0730",
          "日期 0101-2359",
        ]);
      } finally {
        await setTenantTimezone("Asia/Taipei");
      }
    });

    it("存的時點以根組織的時區還原成那一天:根組織設奧克蘭 → 奧克蘭選的 01/02,台北租戶照台北的 01/02 算", async () => {
      await setRootTimezone("Pacific/Auckland");
      try {
        // 奧克蘭 2020-01-02 00:00 = 01/01 11:00Z(在台北仍是 01/01 19:00,若以台北還原會差一天)
        await saveRule(
          dateRule("between", [
            "2020-01-01T11:00:00.000Z",
            "2020-01-01T11:00:00.000Z",
          ]),
        );
        expect(await datedVisible()).toEqual([
          "日期 0102-0000",
          "日期 0102-2359",
        ]);
      } finally {
        await setRootTimezone(null);
      }
    });

    it("根組織改時區即時生效:不重存規則,下一次查詢就以新時區還原存的那一天", async () => {
      // 先存好規則並查一次,讓規則進快取(之後不再存)
      await saveRule(dateRule("between", [TAIPEI_0101, TAIPEI_0102]));
      expect(await datedVisible()).toEqual([
        "日期 0101-0730",
        "日期 0101-2359",
        "日期 0102-0000",
        "日期 0102-2359",
      ]);
      await setRootTimezone("America/New_York");
      try {
        // 台北 01/01、01/02 00:00 在紐約是 12/31、01/01 那兩天 → 台北租戶看台北的 12/31 ~ 01/01
        expect(await datedVisible()).toEqual([
          "日期 0101-0730",
          "日期 0101-2359",
        ]);
      } finally {
        await setRootTimezone(null);
      }
      expect(await datedVisible()).toEqual([
        "日期 0101-0730",
        "日期 0101-2359",
        "日期 0102-0000",
        "日期 0102-2359",
      ]);
    });

    it("存著遷移前的 `YYYY-MM-DD`(驗證擋不到的舊值)→ 那個條件什麼都不命中,不會放寬", async () => {
      // 存一次空規則 = 作廢快取;下一次查詢才從資料庫重新載入,讀到的就是直接寫進去的舊值
      await saveRule([]);
      await connection.collection("data_scope_rules").updateOne(
        { collection: "demo_items_one", moduleKey: SAMPLE_ONE_MODULE_KEY },
        {
          $set: {
            rules: [
              {
                audience: { mode: "all" },
                filter: dateRule("between", ["2020-01-01", "2020-01-02"])[0]
                  ?.filter,
              },
            ],
          },
        },
      );
      expect(await visibleItemsOne(agentUserId, deptOne)).toEqual([]);
    });
  });

  describe("moduleData 不影響 fields / audit_logs / customers(真的寫、真的查)", () => {
    it("三張表不帶 moduleKey 也寫得進去,查詢不套資料範圍規則(即使塞了一份規則)", async () => {
      const now = new Date();
      for (const collection of ["customers", "fields", "audit_logs"]) {
        await connection.collection("data_scope_rules").insertOne({
          collection,
          moduleKey: "test.not-module-data",
          combineOp: "OR",
          rules: [{ audience: { mode: "all" }, filter: ONLY_MINE }],
          createdAt: now,
          updatedAt: now,
          createdBy: null,
          updatedBy: null,
          deletedAt: null,
        });
      }
      const asAgent = await operatorOf(agentUserId, deptOne);
      const asPeer = await operatorOf(peerUserId, deptOne);

      const customers = api.app.get(CustomersRepository);
      const customer = await customers.create(asAgent, {
        name: "會員甲",
        account: "member-module-data",
        email: "member-module-data@example.com",
        passwordHash: "x",
      });
      expect(customer).not.toHaveProperty("moduleKey");
      const fields = api.app.get(FieldsRepository);
      await fields.create(asAgent, {
        categoryId: new Types.ObjectId(),
        label: "自訂",
        value: "custom-module-data",
      });
      const audits = api.app.get(AuditLogsRepository);
      await audits.create(asAgent, {
        actorId: agentUserId,
        actorType: "user",
        action: "test.module-data",
      });

      // 規則若套上,「僅本人」會讓客服乙一筆都看不到客服甲建的
      await expect(
        customers.count(asPeer, { account: "member-module-data" }),
      ).resolves.toBe(1);
      await expect(
        fields.count(asPeer, { value: "custom-module-data" }),
      ).resolves.toBe(1);
      await expect(
        audits.count(asPeer, { action: "test.module-data" }),
      ).resolves.toBe(1);

      await connection
        .collection("data_scope_rules")
        .deleteMany({ moduleKey: "test.not-module-data" });
    });
  });

  describe("治理類 collection 不受規則影響", () => {
    it("直接對 orgs 塞一份規則,組織查詢仍不套(kind = governance)", async () => {
      await connection.collection("data_scope_rules").insertOne({
        collection: "orgs",
        combineOp: "OR",
        rules: [
          {
            audience: { mode: "all" },
            filter: {
              op: "AND",
              children: [
                {
                  field: "createdBy",
                  cond: "in",
                  value: { kind: "dynamic", ref: "current-user" },
                },
              ],
            },
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
      // 這批組織的 createdBy 都是 null,規則若套上就會一個都查不到
      const operator = await operatorOf(supervisorUserId, deptOne);
      const orgs = await api.app
        .get(OrgsRepository)
        .findMany({ ...operator, managedOrgIds: [tenantA, deptOne, deptTwo] });
      expect(
        orgs
          .map((org) => String(org._id))
          .toSorted((a, b) => a.localeCompare(b, "zh-Hant")),
      ).toEqual(
        [String(tenantA), String(deptOne), String(deptTwo)].toSorted((a, b) =>
          a.localeCompare(b, "zh-Hant"),
        ),
      );
      expect(rootOrgId).toBeDefined();
    });
  });

  describe("存在性檢查(BaseRepository.existsAny):略過規則,不略過租戶過濾", () => {
    it("規則把某組織的資料全收窄掉時:列表與筆數照樣看不到,existsAny 仍答「有」", async () => {
      // 客服角色只看「已發布」;部門一的示範資料全是草稿 ⇒ 客服甲在部門一一筆都看不到
      const result = await saveRule([
        {
          audience: {
            mode: "match",
            filter: {
              field: "role",
              cond: "in",
              value: { kind: "static", values: [String(agentRoleId)] },
            },
          },
          filter: {
            op: "AND",
            children: [
              {
                field: "status",
                cond: "in",
                value: { kind: "static", values: ["published"] },
              },
            ],
          },
        },
      ]);
      expect(result.errors).toBeUndefined();
      try {
        const asAgent = await operatorOf(agentUserId, deptOne);
        const itemsOne = api.app.get(DemoItemsOneRepository);

        // 一般查詢仍受規則限制:存在性檢查沒有放寬別的路徑
        await expect(itemsOne.findMany(asAgent)).resolves.toEqual([]);
        await expect(itemsOne.count(asAgent, { orgId: deptOne })).resolves.toBe(
          0,
        );
        await expect(
          itemsOne.findOne(asAgent, { orgId: deptOne }),
        ).resolves.toBeNull();

        // 存在性檢查不被規則收窄
        await expect(
          itemsOne.existsAny(asAgent, "orgId", deptOne),
        ).resolves.toBe(true);
      } finally {
        await saveRule([]);
      }
    });

    it("可見範圍外的組織 existsAny 答「沒有」(租戶過濾照套)", async () => {
      const itemsOne = api.app.get(DemoItemsOneRepository);
      // 看得到部門二的人(主管)問:有
      const asSupervisor = await operatorOf(supervisorUserId, deptTwo);
      await expect(
        itemsOne.existsAny(asSupervisor, "orgId", deptTwo),
      ).resolves.toBe(true);
      // 客服甲只屬部門一、租戶甲沒開可見性開關 ⇒ 部門二在他的範圍外:沒有
      const asAgent = await operatorOf(agentUserId, deptOne);
      await expect(itemsOne.existsAny(asAgent, "orgId", deptTwo)).resolves.toBe(
        false,
      );
    });

    it("已軟刪除的資料不算「有」", async () => {
      const deptThree = await createOrg(connection, {
        name: "部門三",
        parentId: tenantA,
      });
      const asAgent = await operatorOf(agentUserId, deptOne);
      const inDeptThree: OperatorContext = {
        ...asAgent,
        currentOrgId: deptThree,
        visibleOrgIds: [deptThree],
        managedOrgIds: [deptThree],
      };
      const itemsTwo = api.app.get(DemoItemsTwoRepository);
      const created = await itemsTwo.create(inDeptThree, {
        name: "等一下刪掉",
      });
      await expect(
        itemsTwo.existsAny(inDeptThree, "orgId", deptThree),
      ).resolves.toBe(true);

      await itemsTwo.softDeleteById(inDeptThree, created._id);
      await expect(
        itemsTwo.existsAny(inDeptThree, "orgId", deptThree),
      ).resolves.toBe(false);
    });
  });
});
