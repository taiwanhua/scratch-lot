import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import type { Audience } from "@repo/domain/audience";

import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { PRINTING_AGENT_OFFLINE } from "../notifications/base-notification-types";
import { createRole } from "../permission/test-support/fixtures";
import {
  type Manager,
  ROLE_MANAGER_PERMISSIONS,
  type RolesWorld,
  createManager,
  createMember,
  login,
  nextAccount,
  startRolesWorld,
} from "./roles-test-support";

const DELETE_ROLE = /* GraphQL */ `
  mutation DeleteRole($input: DeleteRoleInput!) {
    deleteRole(input: $input) {
      success
      deletedId
    }
  }
`;

const SET_ROLE_ENABLED = /* GraphQL */ `
  mutation SetRoleEnabled($input: SetRoleEnabledInput!) {
    setRoleEnabled(input: $input) {
      role {
        id
        enabled
      }
    }
  }
`;

interface Reference {
  kind: string;
  name: string;
  stepName?: string;
}

interface DeleteOutcome {
  code: string | undefined;
  reasons: string[] | undefined;
  references: Reference[] | undefined;
  deletedId: string | undefined;
}

/** 只有一個「角色」條件列的人員條件。 */
function roleAudience(roleId: Types.ObjectId): Audience {
  return {
    mode: "match",
    filter: {
      field: "role",
      cond: "in",
      value: { kind: "static", values: [String(roleId)] },
    },
  };
}

/** 角色條件列藏在第三層群組裡(AND → OR → 條件列)。 */
function nestedRoleAudience(roleId: Types.ObjectId): Audience {
  return {
    mode: "match",
    filter: {
      op: "AND",
      children: [
        {
          field: "permission",
          cond: "in",
          value: { kind: "static", values: ["system.role-manager.view"] },
        },
        {
          op: "OR",
          children: [
            {
              field: "user",
              cond: "in",
              value: { kind: "static", values: [String(new Types.ObjectId())] },
            },
            {
              field: "role",
              cond: "in",
              value: { kind: "static", values: [String(roleId)] },
            },
          ],
        },
      ],
    },
  };
}

const BASE_FIELDS = {
  createdBy: null,
  updatedBy: null,
  deletedAt: null,
};

function reviewStep(
  name: string,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    key: `step_${new Types.ObjectId().toHexString()}`,
    name,
    assignee: {
      kind: "audience",
      audience: {
        mode: "match",
        filter: {
          field: "permission",
          cond: "in",
          value: { kind: "static", values: ["system.role-manager.view"] },
        },
      },
    },
    mode: "any",
    ...extras,
  };
}

/** 流程的目前版本:有指定就用指定的,否則 `published` 的那一版。 */
function currentVersionOf(
  options: { status?: string; currentVersion?: number | null },
  version: number | null,
): number | null {
  if (options.currentVersion !== undefined) {
    return options.currentVersion;
  }
  return options.status === "published" ? version : null;
}

/**
 * 角色被人員條件引用時不能刪除(docs/modules/role-manager.md 權限表「刪除」):
 * 通知設定的收件人、流程的審核者 / 知會 / 逾時提醒的通知對象、資料範圍的套用對象。
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07);引用資料直接寫進 collection。
 */
describe("角色刪除前置:被人員條件引用(REFERENCED_BY_AUDIENCE)", () => {
  let world: RolesWorld;
  let connection: Connection;
  let manager: Manager;
  let rootToken: string;

  beforeAll(async () => {
    world = await startRolesWorld("cookhome-test-role-in-use");
    connection = world.connection;
    manager = await createManager(world, {
      orgIds: [world.tenantA],
      ownerOrgId: world.tenantA,
    });
    const rootAccount = nextAccount("root-operator");
    const rootUserId = await createMember(
      world,
      [world.rootOrgId],
      "root-operator",
    );
    await connection
      .collection("users")
      .updateOne({ _id: rootUserId }, { $set: { account: rootAccount } });
    await createRole(world.api.app, connection, {
      name: `根組織操作者-${rootAccount}`,
      ownerOrgId: world.rootOrgId,
      moduleKeys: ["system", "system.role-manager"],
      permissionKeys: ROLE_MANAGER_PERMISSIONS,
      assignTo: [rootUserId],
    });
    rootToken = await login(world, rootAccount);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await world.api.close();
  }, HOOK_TIMEOUT_MS);

  async function deleteAs(
    token: string,
    roleId: Types.ObjectId,
  ): Promise<DeleteOutcome> {
    const result = await world.api.graphql<{
      deleteRole: { success: boolean; deletedId: string };
    }>(DELETE_ROLE, { input: { id: String(roleId) } }, { accessToken: token });
    const extensions:
      | { code?: string; reasons?: string[]; references?: Reference[] }
      | undefined = result.errors?.[0]?.extensions;
    return {
      code: extensions?.code,
      reasons: extensions?.reasons,
      references: extensions?.references,
      deletedId: result.data?.deleteRole.deletedId,
    };
  }

  async function newRole(name: string): Promise<Types.ObjectId> {
    return createRole(world.api.app, connection, {
      name,
      ownerOrgId: world.deptTwo,
    });
  }

  /** 每個租戶、每種類型至多一筆(唯一索引),所以是覆寫該租戶這一類型的設定。 */
  async function setNotificationAudience(
    tenantId: Types.ObjectId,
    audience: Audience | null,
  ): Promise<void> {
    const now = new Date();
    await connection.collection("notification_settings").updateOne(
      { tenantId, type: PRINTING_AGENT_OFFLINE },
      {
        $set: { audience, updatedAt: now },
        $setOnInsert: { createdAt: now, ...BASE_FIELDS },
      },
      { upsert: true },
    );
  }

  interface VersionOptions {
    steps: Record<string, unknown>[];
    cc?: Record<string, unknown> | null;
    status?: "draft" | "published" | "retired";
    version?: number;
  }

  /** 流程的一份版本(`status` 預設草稿;草稿沒有版號)。 */
  async function addVersion(
    key: string,
    options: VersionOptions,
  ): Promise<number | null> {
    const now = new Date();
    const status = options.status ?? "draft";
    const version = status === "draft" ? null : (options.version ?? 1);
    await connection.collection("workflow_versions").insertOne({
      workflowKey: key,
      version,
      status,
      draftRevision: 0,
      baseVersion: null,
      steps: options.steps,
      edges: null,
      cc: options.cc ?? null,
      checkFormKey: null,
      changelog: null,
      publishedAt: null,
      publishedBy: null,
      createdAt: now,
      updatedAt: now,
      ...BASE_FIELDS,
    });
    return version;
  }

  /**
   * 一個流程 + 一份版本(`tenantId = null` = 共用流程);`published` 的版本同步設成目前版本,
   * `currentVersion` 可另外指定(多版本時用)。
   */
  async function addWorkflow(
    options: VersionOptions & {
      tenantId: Types.ObjectId | null;
      name: string;
      currentVersion?: number | null;
    },
  ): Promise<string> {
    const key = `wf_${new Types.ObjectId().toHexString()}`;
    const now = new Date();
    const version = await addVersion(key, options);
    await connection.collection("workflows").insertOne({
      key,
      name: options.name,
      ownerOrgId: options.tenantId,
      tenantId: options.tenantId,
      forkedFrom: null,
      currentVersion: currentVersionOf(options, version),
      createdAt: now,
      updatedAt: now,
      ...BASE_FIELDS,
    });
    return key;
  }

  /** 一張用某版流程的單據實例(`running` / `blocked` = 進行中)。 */
  async function addInstance(
    key: string,
    workflowVersion: number,
    status: "running" | "blocked" | "approved",
  ): Promise<void> {
    const now = new Date();
    await connection.collection("workflow_instances").insertOne({
      submissionId: new Types.ObjectId(),
      revision: 1,
      formKey: "demo_form",
      formVersion: 1,
      workflowKey: key,
      workflowVersion,
      status,
      activeStepKeys: [],
      steps: [],
      history: [],
      moduleKey: "demo.form",
      tenantId: world.tenantA,
      orgId: world.deptTwo,
      createdAt: now,
      updatedAt: now,
      ...BASE_FIELDS,
    });
  }

  it("通知設定的收件人引用 → ROLE_NOT_DELETABLE,reasons 含 REFERENCED_BY_AUDIENCE 並帶引用處", async () => {
    const roleId = await newRole("通知收件角色");
    await setNotificationAudience(world.tenantA, roleAudience(roleId));

    const { code, reasons, references, deletedId } = await deleteAs(
      manager.token,
      roleId,
    );
    expect(code).toBe("ROLE_NOT_DELETABLE");
    expect(reasons).toEqual(["REFERENCED_BY_AUDIENCE"]);
    expect(references).toEqual([
      { kind: "notification-setting", name: "列印代理程式離線" },
    ]);
    expect(deletedId).toBeUndefined();
  });

  it("側欄數字的人員條件引用 → 擋下,引用處帶模組名稱;沒登記側欄數字的模組與別租戶的不算", async () => {
    const roleId = await newRole("側欄數字角色");
    const now = new Date();
    const setting = (tenantId: Types.ObjectId, moduleKey: string) => ({
      tenantId,
      moduleKey,
      audience: roleAudience(roleId),
      createdAt: now,
      updatedAt: now,
      ...BASE_FIELDS,
    });
    await connection
      .collection("sidebar_badge_settings")
      .insertMany([
        setting(world.tenantA, "apply-center"),
        setting(world.tenantA, "removed.module"),
        setting(world.tenantB, "apply-center"),
      ]);

    const { code, reasons, references } = await deleteAs(manager.token, roleId);
    expect(code).toBe("ROLE_NOT_DELETABLE");
    expect(reasons).toEqual(["REFERENCED_BY_AUDIENCE"]);
    expect(references).toEqual([{ kind: "sidebar-badge", name: "申請中心" }]);

    await connection
      .collection("sidebar_badge_settings")
      .deleteMany({ "audience.filter.value.values": String(roleId) });
    const after = await deleteAs(manager.token, roleId);
    expect(after.deletedId).toBe(String(roleId));
  });

  it("流程關卡的審核者引用 → 擋下,引用處帶流程與關卡名稱", async () => {
    const roleId = await newRole("審核角色");
    await addWorkflow({
      tenantId: world.tenantA,
      name: "請購單",
      steps: [
        reviewStep("主管審核"),
        {
          ...reviewStep("財務審核"),
          assignee: { kind: "audience", audience: roleAudience(roleId) },
        },
      ],
    });

    const { code, reasons, references } = await deleteAs(manager.token, roleId);
    expect(code).toBe("ROLE_NOT_DELETABLE");
    expect(reasons).toEqual(["REFERENCED_BY_AUDIENCE"]);
    expect(references).toEqual([
      {
        kind: "workflow-approver",
        name: "請購單",
        stepName: "財務審核",
        source: "draft",
      },
    ]);
  });

  it("流程關卡的知會對象引用 → 擋下", async () => {
    const roleId = await newRole("關卡知會角色");
    await addWorkflow({
      tenantId: world.tenantA,
      name: "請假單",
      status: "published",
      steps: [
        reviewStep("主管審核", {
          cc: { kind: "audience", audience: roleAudience(roleId) },
        }),
      ],
    });

    const { reasons, references } = await deleteAs(manager.token, roleId);
    expect(reasons).toEqual(["REFERENCED_BY_AUDIENCE"]);
    expect(references).toEqual([
      {
        kind: "workflow-step-cc",
        name: "請假單",
        stepName: "主管審核",
        source: "current",
      },
    ]);
  });

  it("整個流程的知會對象引用 → 擋下", async () => {
    const roleId = await newRole("流程知會角色");
    await addWorkflow({
      tenantId: world.tenantA,
      name: "出差單",
      steps: [reviewStep("主管審核")],
      cc: { kind: "audience", audience: roleAudience(roleId) },
    });

    const { reasons, references } = await deleteAs(manager.token, roleId);
    expect(reasons).toEqual(["REFERENCED_BY_AUDIENCE"]);
    expect(references).toEqual([
      { kind: "workflow-cc", name: "出差單", source: "draft" },
    ]);
  });

  it("逾時提醒的通知對象引用 → 擋下", async () => {
    const roleId = await newRole("逾時通知角色");
    await addWorkflow({
      tenantId: world.tenantA,
      name: "採購單",
      steps: [
        reviewStep("主管審核", {
          overdue: {
            reviewerAfterHours: 24,
            audienceAfterHours: 48,
            audience: roleAudience(roleId),
          },
        }),
      ],
    });

    const { reasons, references } = await deleteAs(manager.token, roleId);
    expect(reasons).toEqual(["REFERENCED_BY_AUDIENCE"]);
    expect(references).toEqual([
      {
        kind: "workflow-overdue",
        name: "採購單",
        stepName: "主管審核",
        source: "draft",
      },
    ]);
  });

  it("巢狀群組裡的角色條件列也找得到(通知設定與流程)", async () => {
    const roleId = await newRole("巢狀條件角色");
    await setNotificationAudience(world.tenantA, nestedRoleAudience(roleId));
    await addWorkflow({
      tenantId: world.tenantA,
      name: "報銷單",
      steps: [
        {
          ...reviewStep("會計審核"),
          assignee: { kind: "audience", audience: nestedRoleAudience(roleId) },
        },
      ],
    });

    const { reasons, references } = await deleteAs(manager.token, roleId);
    expect(reasons).toEqual(["REFERENCED_BY_AUDIENCE"]);
    expect(references).toEqual([
      { kind: "notification-setting", name: "列印代理程式離線" },
      {
        kind: "workflow-approver",
        name: "報銷單",
        stepName: "會計審核",
        source: "draft",
      },
    ]);
  });

  it("資料範圍的套用對象引用 → 擋下,引用處帶資料目標名稱", async () => {
    const roleId = await newRole("資料範圍角色");
    const collectionName = `items_${new Types.ObjectId().toHexString()}`;
    const now = new Date();
    await connection.collection("data_scope_targets").insertOne({
      collection: collectionName,
      moduleKey: "demo.sample",
      name: "示範資料",
      fields: [],
      isSystem: false,
      createdAt: now,
      updatedAt: now,
      ...BASE_FIELDS,
    });
    await connection.collection("data_scope_rules").insertOne({
      collection: collectionName,
      moduleKey: "demo.sample",
      combineOp: "OR",
      rules: [
        {
          audience: roleAudience(roleId),
          filter: { op: "AND", children: [] },
        },
      ],
      createdAt: now,
      updatedAt: now,
      ...BASE_FIELDS,
    });

    const { reasons, references } = await deleteAs(manager.token, roleId);
    expect(reasons).toEqual(["REFERENCED_BY_AUDIENCE"]);
    expect(references).toEqual([{ kind: "data-scope", name: "示範資料" }]);
  });

  it("其他租戶的引用不算(租戶隔離)", async () => {
    const roleId = await newRole("只被別租戶寫到的角色");
    await setNotificationAudience(world.tenantB, roleAudience(roleId));
    await addWorkflow({
      tenantId: world.tenantB,
      name: "別租戶的流程",
      steps: [
        {
          ...reviewStep("審核"),
          assignee: { kind: "audience", audience: roleAudience(roleId) },
        },
      ],
    });

    const { code, deletedId } = await deleteAs(manager.token, roleId);
    expect(code).toBeUndefined();
    expect(deletedId).toBe(String(roleId));
  });

  it("退役且沒有進行中單據的版本不算;進行中單據用的舊版本仍算", async () => {
    const retiredOnly = await newRole("只在退役版本的角色");
    await addWorkflow({
      tenantId: world.tenantA,
      name: "已退役的流程",
      status: "retired",
      steps: [
        {
          ...reviewStep("審核"),
          assignee: { kind: "audience", audience: roleAudience(retiredOnly) },
        },
      ],
    });
    const retiredOutcome = await deleteAs(manager.token, retiredOnly);
    expect(retiredOutcome.code).toBeUndefined();

    const inFlight = await newRole("進行中單據用到的角色");
    const key = await addWorkflow({
      tenantId: world.tenantA,
      name: "還有單據在跑的流程",
      status: "retired",
      steps: [
        {
          ...reviewStep("審核"),
          assignee: { kind: "audience", audience: roleAudience(inFlight) },
        },
      ],
    });
    await addInstance(key, 1, "running");
    const { reasons, references } = await deleteAs(manager.token, inFlight);
    expect(reasons).toEqual(["REFERENCED_BY_AUDIENCE"]);
    expect(references).toEqual([
      {
        kind: "workflow-approver",
        name: "還有單據在跑的流程",
        stepName: "審核",
        source: "in-use",
        inUseCount: 1,
      },
    ]);
  });

  it("進行中單據:blocked 也算;多個舊版本同一關合成一筆、單據數相加;已結束的單據不算", async () => {
    const roleId = await newRole("多版本進行中的角色");
    const step = {
      ...reviewStep("複核"),
      assignee: { kind: "audience", audience: roleAudience(roleId) },
    };
    const key = await addWorkflow({
      tenantId: world.tenantA,
      name: "多版本流程",
      status: "published",
      version: 1,
      currentVersion: 3,
      steps: [step],
    });
    await addVersion(key, { status: "published", version: 2, steps: [step] });
    await addVersion(key, {
      status: "published",
      version: 3,
      steps: [reviewStep("複核")],
    });
    await addInstance(key, 1, "running");
    await addInstance(key, 1, "blocked");
    await addInstance(key, 2, "blocked");
    await addInstance(key, 2, "approved");

    const { reasons, references } = await deleteAs(manager.token, roleId);
    expect(reasons).toEqual(["REFERENCED_BY_AUDIENCE"]);
    expect(references).toEqual([
      {
        kind: "workflow-approver",
        name: "多版本流程",
        stepName: "複核",
        source: "in-use",
        inUseCount: 3,
      },
    ]);
  });

  it("草稿與目前版本都引用同一關:各一筆(source 不同),目前版本有進行中單據時另列 in-use", async () => {
    const roleId = await newRole("草稿與目前版本都用的角色");
    const step = {
      ...reviewStep("初審"),
      assignee: { kind: "audience", audience: roleAudience(roleId) },
    };
    const key = await addWorkflow({
      tenantId: world.tenantA,
      name: "重複引用的流程",
      status: "published",
      steps: [step],
    });
    await addVersion(key, { steps: [step] });
    await addInstance(key, 1, "running");

    const { references } = await deleteAs(manager.token, roleId);
    expect(references).toEqual([
      {
        kind: "workflow-approver",
        name: "重複引用的流程",
        stepName: "初審",
        source: "draft",
      },
      {
        kind: "workflow-approver",
        name: "重複引用的流程",
        stepName: "初審",
        source: "current",
      },
      {
        kind: "workflow-approver",
        name: "重複引用的流程",
        stepName: "初審",
        source: "in-use",
        inUseCount: 1,
      },
    ]);
  });

  it("根組織的角色:看共用流程(草稿)與資料範圍,不看租戶的通知設定", async () => {
    const roleId = await createRole(world.api.app, connection, {
      name: "根組織的角色",
      ownerOrgId: world.rootOrgId,
    });
    await addWorkflow({
      tenantId: null,
      name: "共用流程",
      steps: [
        {
          ...reviewStep("審核"),
          assignee: { kind: "audience", audience: roleAudience(roleId) },
        },
      ],
    });
    await setNotificationAudience(world.tenantA, roleAudience(roleId));

    const { reasons, references } = await deleteAs(rootToken, roleId);
    expect(reasons).toEqual(["REFERENCED_BY_AUDIENCE"]);
    expect(references).toEqual([
      {
        kind: "workflow-approver",
        name: "共用流程",
        stepName: "審核",
        source: "draft",
      },
    ]);
    await setNotificationAudience(world.tenantA, null);
  });

  it("沒有登記的通知類型不算", async () => {
    const roleId = await newRole("只在未登記類型的角色");
    const now = new Date();
    await connection.collection("notification_settings").insertOne({
      tenantId: world.tenantA,
      type: "removed.type",
      audience: roleAudience(roleId),
      createdAt: now,
      updatedAt: now,
      ...BASE_FIELDS,
    });

    const { code, deletedId } = await deleteAs(manager.token, roleId);
    expect(code).toBeUndefined();
    expect(deletedId).toBe(String(roleId));
  });

  it("引用移除後可以刪", async () => {
    const roleId = await newRole("移除引用後可刪的角色");
    await setNotificationAudience(world.tenantA, roleAudience(roleId));
    const blocked = await deleteAs(manager.token, roleId);
    expect(blocked.code).toBe("ROLE_NOT_DELETABLE");

    await setNotificationAudience(world.tenantA, null);

    const { code, deletedId } = await deleteAs(manager.token, roleId);
    expect(code).toBeUndefined();
    expect(deletedId).toBe(String(roleId));
  });

  it("同時有 HAS_GRANTS 與 REFERENCED_BY_AUDIENCE → 兩個原因一起回", async () => {
    const holderId = await createMember(world, [world.deptTwo]);
    const roleId = await createRole(world.api.app, connection, {
      name: "有人持有又被引用的角色",
      ownerOrgId: world.deptTwo,
      assignTo: [holderId],
    });
    await setNotificationAudience(world.tenantA, roleAudience(roleId));

    const { code, reasons, references } = await deleteAs(manager.token, roleId);
    expect(code).toBe("ROLE_NOT_DELETABLE");
    expect(reasons).toEqual(["HAS_GRANTS", "REFERENCED_BY_AUDIENCE"]);
    expect(references).toEqual([
      { kind: "notification-setting", name: "列印代理程式離線" },
    ]);
  });

  it("被引用的角色仍可停用(停用不擋)", async () => {
    const roleId = await newRole("被引用但可停用的角色");
    await setNotificationAudience(world.tenantA, roleAudience(roleId));

    const result = await world.api.graphql<{
      setRoleEnabled: { role: { id: string; enabled: boolean } };
    }>(
      SET_ROLE_ENABLED,
      { input: { id: String(roleId), enabled: false } },
      { accessToken: manager.token },
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.setRoleEnabled.role.enabled).toBe(false);
  });
});
