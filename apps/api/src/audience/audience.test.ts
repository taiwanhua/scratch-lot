import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { Types } from "mongoose";

import type { Audience, AudienceNode } from "@repo/domain/audience";

import { OperatorContextService } from "../auth/operator-context.service";
import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg, createUser } from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import {
  createRole,
  setModuleEnabled,
  setPermissionEnabled,
  setRoleEnabled,
} from "../permission/test-support/fixtures";
import { type AudienceContext, AudienceService } from "./audience.service";

const PASSWORD = ["test", "pass", "word"].join("-");

const SAMPLE_ONE = "demo.sub.sample-one";
const SAMPLE_ONE_FAMILY = ["demo", "demo.sub", SAMPLE_ONE];
const VIEW = `${SAMPLE_ONE}.view`;
const EDIT = `${SAMPLE_ONE}.edit`;
const TWO_VIEW = "demo.sample-two.view";
const TWO_EDIT = "demo.sample-two.edit";
/** 本租戶 / 別租戶客製表單的欄位級動態權限(掛在示範模組1 下,持 `模組.*` 的人展開得到兩筆)。 */
const OWN_FORM_SHOW = `${SAMPLE_ONE}.show-aud_own-secret`;
const OTHER_FORM_SHOW = `${SAMPLE_ONE}.show-aud_other-secret`;
/** 示範模組1 底下一筆已停用的權限:持 `模組.*` 也不算持有(不走 `*` 同層回退)。 */
const DISABLED_IN_SAMPLE_ONE = `${SAMPLE_ONE}.archived`;

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const PERMISSION_OPTIONS = /* GraphQL */ `
  query AudiencePermissionOptions {
    audiencePermissionOptions {
      modules {
        key
        permissions {
          key
        }
        children {
          key
          permissions {
            key
          }
          children {
            key
            permissions {
              key
            }
          }
        }
      }
    }
  }
`;

interface OptionNode {
  key: string;
  permissions: { key: string }[];
  children?: OptionNode[];
}

interface OptionsData {
  audiencePermissionOptions: { modules: OptionNode[] };
}

function flatten(nodes: OptionNode[]): { modules: string[]; perms: string[] } {
  const modules: string[] = [];
  const perms: string[] = [];
  const visit = (node: OptionNode): void => {
    modules.push(node.key);
    perms.push(...node.permissions.map((permission) => permission.key));
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  for (const node of nodes) {
    visit(node);
  }
  return { modules, perms };
}

const leaf = (
  field: "user" | "role" | "permission",
  values: (string | Types.ObjectId)[],
): AudienceNode => ({
  field,
  cond: "in",
  value: { kind: "static", values: values.map(String) },
});

const orgLeaf = (
  orgId: Types.ObjectId,
  range: "self" | "descendants" | "ancestors",
): AudienceNode => ({
  field: "org",
  cond: "in",
  value: { kind: "static", values: [String(orgId)] },
  range,
});

async function login(
  api: AuthTestApp,
  account: string,
  password: string,
): Promise<string> {
  const result = await api.graphql<{ login: { accessToken: string } }>(LOGIN, {
    input: { account, password },
  });
  const token = result.data?.login.accessToken;
  if (!token) {
    throw new Error("login 沒有回 accessToken");
  }
  return token;
}

const byText = (a: string, b: string): number => a.localeCompare(b);

const match = (filter: AudienceNode): Audience => ({ mode: "match", filter });

describe("人員條件:matchesAudience / listAudience(對真 Nest app + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let audience: AudienceService;
  let contexts: OperatorContextService;

  let tenant: Types.ObjectId;
  let otherTenant: Types.ObjectId;
  let storeA: Types.ObjectId;
  let storeB: Types.ObjectId;
  let storeA1: Types.ObjectId;

  let managerRole: Types.ObjectId;
  let clerkRole: Types.ObjectId;

  /** 名字 → userId(本租戶的人;`outsider` 在另一個租戶)。 */
  const users = new Map<string, Types.ObjectId>();
  /** 本租戶裡所有建立過的人(含停用的):逐人判斷的母體。 */
  const tenantUsers: string[] = [];
  let sequence = 0;

  async function addUser(
    name: string,
    orgIds: Types.ObjectId[],
    options: { enabled?: boolean; inTenant?: boolean } = {},
  ): Promise<Types.ObjectId> {
    sequence += 1;
    const userId = await createUser(api.connection, {
      account: `audience-${String(sequence)}`,
      password: PASSWORD,
      orgIds,
      enabled: options.enabled ?? true,
    });
    users.set(name, userId);
    if (options.inTenant ?? true) {
      tenantUsers.push(name);
    }
    return userId;
  }

  function id(name: string): Types.ObjectId {
    const found = users.get(name);
    if (!found) {
      throw new Error(`沒有使用者 ${name}`);
    }
    return found;
  }

  function nameOf(userId: Types.ObjectId | string): string {
    for (const [name, value] of users) {
      if (String(value) === String(userId)) {
        return name;
      }
    }
    return `?${String(userId)}`;
  }

  async function list(
    target: Audience,
    ctx?: AudienceContext,
  ): Promise<string[]> {
    const ids = await audience.listAudience(tenant, target, ctx);
    return ids.map((userId) => nameOf(userId)).toSorted(byText);
  }

  async function matches(
    name: string,
    target: Audience,
    ctx?: AudienceContext,
  ): Promise<boolean> {
    const { operator } = await contexts.resolve(id(name), null);
    return audience.matchesAudience(operator, target, ctx);
  }

  /** 逐人判斷:本租戶、啟用中的人裡 `matchesAudience` 為真的。 */
  async function matchingByEach(
    target: Audience,
    ctx?: AudienceContext,
  ): Promise<string[]> {
    const disabled = new Set(["disabledManager"]);
    const result: string[] = [];
    for (const name of tenantUsers) {
      if (!disabled.has(name) && (await matches(name, target, ctx))) {
        result.push(name);
      }
    }
    return result.toSorted(byText);
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-audience");
    audience = api.app.get(AudienceService);
    contexts = api.app.get(OperatorContextService);

    tenant = await createOrg(api.connection, { name: "租戶甲" });
    otherTenant = await createOrg(api.connection, { name: "租戶乙" });
    storeA = await createOrg(api.connection, {
      name: "A 店",
      parentId: tenant,
    });
    storeB = await createOrg(api.connection, {
      name: "B 店",
      parentId: tenant,
    });
    storeA1 = await createOrg(api.connection, {
      name: "A 店內場",
      parentId: storeA,
    });

    await addUser("managerA", [storeA]);
    await addUser("managerB", [storeB]);
    await addUser("clerkA", [storeA]);
    await addUser("wildcardA1", [storeA1]);
    await addUser("disabledRoleA", [storeA]);
    await addUser("noModuleB", [storeB]);
    await addUser("disabledPermB", [storeB]);
    await addUser("disabledModuleB", [storeB]);
    await addUser("disabledManager", [storeA], { enabled: false });
    await addUser("superAdmin", [tenant]);
    await addUser("outsider", [otherTenant], { inTenant: false });

    managerRole = await createRole(api.app, api.connection, {
      name: "店長",
      ownerOrgId: tenant,
      moduleKeys: SAMPLE_ONE_FAMILY,
      permissionKeys: [VIEW, EDIT],
      assignTo: [
        id("managerA"),
        id("managerB"),
        id("disabledManager"),
        id("outsider"),
      ],
    });
    clerkRole = await createRole(api.app, api.connection, {
      name: "店員",
      ownerOrgId: tenant,
      moduleKeys: SAMPLE_ONE_FAMILY,
      permissionKeys: [VIEW],
      assignTo: [id("clerkA")],
    });
    await createRole(api.app, api.connection, {
      name: "示範模組1 全部",
      ownerOrgId: tenant,
      moduleKeys: SAMPLE_ONE_FAMILY,
      permissionKeys: [`${SAMPLE_ONE}.*`],
      assignTo: [id("wildcardA1")],
    });
    const disabledRole = await createRole(api.app, api.connection, {
      name: "停用的角色",
      ownerOrgId: tenant,
      moduleKeys: SAMPLE_ONE_FAMILY,
      permissionKeys: [EDIT],
      assignTo: [id("disabledRoleA")],
    });
    await setRoleEnabled(api.connection, disabledRole, false);
    // 有權限、沒綁模組:權限解析不算(模組不在模組陣列裡)
    await createRole(api.app, api.connection, {
      name: "沒綁模組",
      ownerOrgId: tenant,
      permissionKeys: [EDIT],
      assignTo: [id("noModuleB")],
    });
    await createRole(api.app, api.connection, {
      name: "停用的權限",
      ownerOrgId: tenant,
      moduleKeys: ["demo", "demo.sample-two"],
      permissionKeys: [TWO_EDIT],
      assignTo: [id("disabledPermB")],
    });
    await setPermissionEnabled(api.connection, TWO_EDIT, false);
    await createRole(api.app, api.connection, {
      name: "停用的模組",
      ownerOrgId: tenant,
      moduleKeys: ["demo", "demo.sample-two"],
      permissionKeys: [TWO_VIEW],
      assignTo: [id("disabledModuleB")],
    });
    await setModuleEnabled(api.connection, "demo.sample-two", false);

    // 兩張客製表單(本租戶 / 別租戶)與它們的動態權限
    const sampleOne = await api.connection
      .collection("modules")
      .findOne<{ _id: Types.ObjectId }>({ key: SAMPLE_ONE });
    if (!sampleOne) {
      throw new Error("seed 沒有示範模組1");
    }
    const now = new Date();
    const base = {
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
      deletedAt: null,
    };
    await api.connection.collection("forms").insertMany([
      {
        key: "aud_own",
        moduleKey: SAMPLE_ONE,
        name: "本租戶客製",
        ownerOrgId: tenant,
        forkedFrom: null,
        currentVersion: null,
        ...base,
      },
      {
        key: "aud_other",
        moduleKey: SAMPLE_ONE,
        name: "別租戶客製",
        ownerOrgId: otherTenant,
        forkedFrom: null,
        currentVersion: null,
        ...base,
      },
    ]);
    await api.connection.collection("permissions").insertMany(
      [OWN_FORM_SHOW, OTHER_FORM_SHOW, DISABLED_IN_SAMPLE_ONE].map((key) => ({
        key,
        moduleId: sampleOne._id,
        name: key,
        enabled: key !== DISABLED_IN_SAMPLE_ONE,
        isSystem: false,
        settings: {},
        source: key === DISABLED_IN_SAMPLE_ONE ? "seed" : "dynamic",
        retiredAt: null,
        ...base,
      })),
    );

    const superAdminRole = await api.connection
      .collection("roles")
      .findOne<{ _id: Types.ObjectId }>({ key: "super-admin" });
    if (!superAdminRole) {
      throw new Error("seed 沒有 super-admin 角色");
    }
    await api.connection.collection("core_relationships").insertOne({
      type: "user_role",
      firstId: id("superAdmin"),
      secondId: superAdminRole._id,
      thirdId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
      updatedBy: null,
      deletedAt: null,
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("「店長且屬於 A 店」只命中 A 店的店長", async () => {
    const target = match({
      op: "AND",
      children: [leaf("role", [managerRole]), orgLeaf(storeA, "self")],
    });
    expect(await list(target)).toEqual(["managerA"]);
    expect(await matches("managerA", target)).toBe(true);
    expect(await matches("managerB", target)).toBe(false);
    expect(await matches("clerkA", target)).toBe(false);
  });

  it("超級管理員不因權限條件被列入;選他的角色或本人才會", async () => {
    const byPermission = match(leaf("permission", [VIEW, `${SAMPLE_ONE}.*`]));
    expect(await list(byPermission)).not.toContain("superAdmin");
    expect(await matches("superAdmin", byPermission)).toBe(false);
    expect(await list(match(leaf("user", [id("superAdmin")])))).toEqual([
      "superAdmin",
    ]);
  });

  it("只列啟用中、本租戶的使用者", async () => {
    const managers = await list(match(leaf("role", [managerRole])));
    expect(managers).toEqual(["managerA", "managerB"]);
    expect(await list({ mode: "all" })).toEqual(
      tenantUsers.filter((name) => name !== "disabledManager").toSorted(byText),
    );
  });

  const dynamicTenant: AudienceContext = {
    resolveRef: (ref) => (ref === "tenant" ? [tenant] : []),
  };

  // 每列都給上下文(3 個元素):少一個的話 jest 會把第 3 個參數當成 done callback
  const cases: [string, () => Audience, AudienceContext][] = [
    ["所有人", () => ({ mode: "all" }), {}],
    [
      "指定使用者",
      () => match(leaf("user", [id("clerkA"), id("outsider")])),
      {},
    ],
    ["角色", () => match(leaf("role", [managerRole, clerkRole])), {}],
    ["組織:本身", () => match(orgLeaf(storeA, "self")), {}],
    ["組織:含下層", () => match(orgLeaf(storeA, "descendants")), {}],
    ["組織:含上層", () => match(orgLeaf(storeA1, "ancestors")), {}],
    [
      "權限:直接授予(停用角色 / 沒綁模組不算)",
      () => match(leaf("permission", [EDIT])),
      {},
    ],
    ["權限:模組.* 展開", () => match(leaf("permission", [VIEW])), {}],
    [
      "權限:持有 模組.* 本身",
      () => match(leaf("permission", [`${SAMPLE_ONE}.*`])),
      {},
    ],
    ["權限:停用的權限", () => match(leaf("permission", [TWO_EDIT])), {}],
    [
      "權限:持 模組.*、底下那筆已停用 → 不算",
      () => match(leaf("permission", [DISABLED_IN_SAMPLE_ONE])),
      {},
    ],
    [
      "權限:本租戶客製表單的動態權限(經 模組.* 展開)",
      () => match(leaf("permission", [OWN_FORM_SHOW])),
      {},
    ],
    [
      "權限:別租戶客製表單的動態權限(剔除,模組.* 也蓋不到)",
      () => match(leaf("permission", [OTHER_FORM_SHOW])),
      {},
    ],
    ["權限:停用的模組", () => match(leaf("permission", [TWO_VIEW])), {}],
    [
      "巢狀 AND / OR(3 層)",
      () =>
        match({
          op: "OR",
          children: [
            leaf("user", [id("managerB")]),
            {
              op: "AND",
              children: [
                orgLeaf(storeA, "descendants"),
                {
                  op: "OR",
                  children: [
                    leaf("permission", [EDIT]),
                    leaf("role", [clerkRole]),
                  ],
                },
              ],
            },
          ],
        }),
      {},
    ],
    [
      "動態組織(租戶,含下層)",
      () =>
        match({
          op: "AND",
          children: [
            {
              field: "org",
              cond: "in",
              value: { kind: "dynamic", ref: "tenant" },
              range: "descendants",
            },
            leaf("permission", [VIEW]),
          ],
        }),
      dynamicTenant,
    ],
    [
      "動態組織沒有解析 → 沒有人",
      () =>
        match({
          field: "org",
          cond: "in",
          value: { kind: "dynamic", ref: "submission-org" },
          range: "self",
        }),
      {},
    ],
  ];

  it.each(cases)(
    "列出 = 逐人判斷:%s",
    async (_label, build, ctx) => {
      const target = build();
      expect(await list(target, ctx)).toEqual(
        await matchingByEach(target, ctx),
      );
    },
    HOOK_TIMEOUT_MS,
  );

  it("權限條件的結果(表格)", async () => {
    expect(await list(match(leaf("permission", [EDIT])))).toEqual([
      "managerA",
      "managerB",
      "wildcardA1",
    ]);
    expect(await list(match(leaf("permission", [TWO_EDIT])))).toEqual([]);
    expect(
      await list(match(leaf("permission", [DISABLED_IN_SAMPLE_ONE]))),
    ).toEqual([]);
    expect(
      await matches(
        "wildcardA1",
        match(leaf("permission", [DISABLED_IN_SAMPLE_ONE])),
      ),
    ).toBe(false);
    expect(await list(match(leaf("permission", [OWN_FORM_SHOW])))).toEqual([
      "wildcardA1",
    ]);
    expect(await list(match(leaf("permission", [OTHER_FORM_SHOW])))).toEqual(
      [],
    );
    expect(
      await matches("wildcardA1", match(leaf("permission", [OTHER_FORM_SHOW]))),
    ).toBe(false);
    expect(await list(match(leaf("permission", [TWO_VIEW])))).toEqual([]);
    expect(await list(match(orgLeaf(storeA1, "ancestors")))).toEqual(
      [
        "clerkA",
        "disabledRoleA",
        "managerA",
        "superAdmin",
        "wildcardA1",
      ].toSorted(byText),
    );
  });

  describe("audiencePermissionOptions(權限矩陣的顯示樹)", () => {
    it("租戶使用者只看得到自己持有的", async () => {
      const token = await login(api, "audience-4", PASSWORD);
      const result = await api.graphql<OptionsData>(
        PERMISSION_OPTIONS,
        {},
        { accessToken: token },
      );
      expect(result.errors).toBeUndefined();
      const { modules, perms } = flatten(
        result.data?.audiencePermissionOptions.modules ?? [],
      );
      expect(modules).toEqual(SAMPLE_ONE_FAMILY);
      expect(perms).toContain(VIEW);
      expect(perms).not.toContain("system.data-scope.view");
    });

    it("root 看得到底座的權限", async () => {
      const token = await login(api, ROOT_ADMIN.account, ROOT_ADMIN.password);
      const result = await api.graphql<OptionsData>(
        PERMISSION_OPTIONS,
        {},
        { accessToken: token },
      );
      expect(result.errors).toBeUndefined();
      const { modules } = flatten(
        result.data?.audiencePermissionOptions.modules ?? [],
      );
      expect(modules).toContain("system.data-scope");
    });

    it("沒登入 → UNAUTHENTICATED", async () => {
      const result = await api.graphql<OptionsData>(PERMISSION_OPTIONS);
      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    });
  });

  // 放最後:停用示範模組1 的上層會影響本檔其他測試
  it("祖先模組停用:底下模組的權限不算(列出與逐人判斷一致)", async () => {
    await setModuleEnabled(api.connection, "demo.sub", false);
    const target = match(leaf("permission", [EDIT, VIEW]));
    expect(await list(target)).toEqual([]);
    expect(await matches("managerA", target)).toBe(false);
    expect(await list(target)).toEqual(await matchingByEach(target));
    await setModuleEnabled(api.connection, "demo.sub", true);
    expect(await list(match(leaf("permission", [EDIT])))).toEqual([
      "managerA",
      "managerB",
      "wildcardA1",
    ]);
  });
});
