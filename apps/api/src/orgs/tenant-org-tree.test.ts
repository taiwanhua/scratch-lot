import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { Types } from "mongoose";

import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg, createUser } from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { PASSWORD, login } from "../demo-items-two/test-support/fixtures";
import { createRole } from "../permission/test-support/fixtures";

const TENANT_ORG_TREE = /* GraphQL */ `
  query TestTenantOrgTree {
    tenantOrgTree {
      id
      name
      parentId
      isVisible
      isManaged
      children {
        id
        name
        parentId
        isVisible
        isManaged
        children {
          id
          name
          isVisible
          isManaged
        }
      }
    }
  }
`;

interface Node {
  id: string;
  name: string;
  parentId?: string | null;
  isVisible: boolean;
  isManaged: boolean;
  children?: Node[];
}

/** 樹 → 扁平的節點清單(依出現順序)。 */
function flatten(nodes: readonly Node[]): Node[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

/** 名稱 → [可見, 可管理]。 */
function flagsOf(nodes: readonly Node[]): Record<string, [boolean, boolean]> {
  return Object.fromEntries(
    flatten(nodes).map((node) => [node.name, [node.isVisible, node.isManaged]]),
  );
}

/**
 * 組織選擇器的整棵租戶樹 `tenantOrgTree`:
 * root ─┬─ 租戶甲(包含下層)─┬─ 中山店
 *        │                    └─ 新竹店
 *        └─ 租戶乙
 * 每個節點帶「可見 / 可管理」旗標;釘在當前組織的租戶;只要登入。
 */
describe("tenantOrgTree:整棵租戶樹 + 可見 / 可管理旗標", () => {
  let api: AuthTestApp;
  let tenantA: Types.ObjectId;
  let storeA: Types.ObjectId;

  async function treeOf(token: string): Promise<Node[]> {
    const result = await api.graphql<{ tenantOrgTree: Node[] }>(
      TENANT_ORG_TREE,
      {},
      { accessToken: token },
    );
    expect(result.errors).toBeUndefined();
    return result.data?.tenantOrgTree ?? [];
  }

  let sequence = 0;
  async function memberOf(
    orgIds: Types.ObjectId[],
    managedOrgId?: Types.ObjectId,
  ): Promise<string> {
    sequence += 1;
    const account = `tenant-tree-${String(sequence)}`;
    const userId = await createUser(api.connection, {
      account,
      password: PASSWORD,
      orgIds,
    });
    if (managedOrgId !== undefined) {
      await createRole(api.app, api.connection, {
        name: `管理角色 ${account}`,
        ownerOrgId: managedOrgId,
        assignTo: [userId],
      });
    }
    return login(api, account);
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-tenant-org-tree");
    tenantA = await createOrg(api.connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    storeA = await createOrg(api.connection, {
      name: "中山店",
      parentId: tenantA,
    });
    await createOrg(api.connection, { name: "新竹店", parentId: tenantA });
    await createOrg(api.connection, { name: "租戶乙" });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("店長(只屬於中山店、沒有治理權限):看到整棵租戶樹,只有中山店可見;別的租戶不出現", async () => {
    const tree = await treeOf(await memberOf([storeA]));
    expect(tree.map((node) => [node.name, node.parentId])).toEqual([
      ["租戶甲", null],
    ]);
    expect(flagsOf(tree)).toEqual({
      租戶甲: [false, false],
      中山店: [true, false],
      新竹店: [false, false],
    });
    // 樹上只有名稱與兩個旗標(查詢只問得到這些)
    expect(
      Object.keys(tree[0] ?? {}).toSorted((left, right) =>
        left.localeCompare(right),
      ),
    ).toEqual(["children", "id", "isManaged", "isVisible", "name", "parentId"]);
  });

  it("總部(屬於租戶甲,包含下層)、角色擁有組織在租戶甲:全部可見、全部可管理", async () => {
    const tree = await treeOf(await memberOf([tenantA], tenantA));
    expect(flagsOf(tree)).toEqual({
      租戶甲: [true, true],
      中山店: [true, true],
      新竹店: [true, true],
    });
  });

  it("租戶的開關是預設(只看自己):整棵樹照列,只有最上層組織可見", async () => {
    const tenantC = await createOrg(api.connection, { name: "租戶丙" });
    await createOrg(api.connection, { name: "丙分店", parentId: tenantC });
    const tree = await treeOf(await memberOf([tenantC]));
    expect(flagsOf(tree)).toEqual({
      租戶丙: [true, false],
      丙分店: [false, false],
    });
  });

  it("根組織的成員:整棵樹從根組織開始,全部可見", async () => {
    const token = await login(api, ROOT_ADMIN.account, ROOT_ADMIN.password);
    const tree = await treeOf(token);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.parentId).toBeNull();
    const nodes = flatten(tree);
    expect(nodes.map((node) => node.name)).toEqual(
      expect.arrayContaining(["租戶甲", "中山店", "租戶乙"]),
    );
    expect(nodes.every((node) => node.isVisible)).toBe(true);
  });

  it("沒有治理權限:管理範圍的 orgTree 被拒,tenantOrgTree 照樣拿得到", async () => {
    const token = await memberOf([storeA]);
    const governance = await api.graphql(
      /* GraphQL */ `
        query {
          orgTree {
            id
          }
        }
      `,
      {},
      { accessToken: token },
    );
    expect(governance.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    expect(await treeOf(token)).toHaveLength(1);
  });

  it("屬於兩個租戶:只列當前組織所屬的那個租戶", async () => {
    const tenantE = await createOrg(api.connection, { name: "租戶戊" });
    const tenantF = await createOrg(api.connection, { name: "租戶己" });
    // 當前組織 = 第一個所屬組織(租戶戊)
    const tree = await treeOf(await memberOf([tenantE, tenantF]));
    expect(flatten(tree).map((node) => node.name)).toEqual(["租戶戊"]);
  });
});
