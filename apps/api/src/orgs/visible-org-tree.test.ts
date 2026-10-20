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

const VISIBLE_ORG_TREE = /* GraphQL */ `
  query TestVisibleOrgTree {
    visibleOrgTree {
      id
      name
      parentId
      outOfScope
      children {
        id
        name
        parentId
        children {
          id
          name
        }
      }
    }
  }
`;

interface Node {
  id: string;
  name: string;
  parentId?: string | null;
  outOfScope?: boolean;
  children?: Node[];
}

/** 樹 → 「名稱(下層…)」的扁平名單(依出現順序)。 */
function namesOf(nodes: readonly Node[]): string[] {
  return nodes.flatMap((node) => [node.name, ...namesOf(node.children ?? [])]);
}

/**
 * 業務頁的組織樹 `visibleOrgTree`(可見範圍;CONTEXT.md「可見範圍」):
 * root ─┬─ 租戶甲(包含下層)─┬─ 中山店
 *        │                    └─ 新竹店
 *        └─ 租戶乙
 * 所有操作者都**沒有任何角色**(沒有組織管理 / 使用者管理的權限)。
 */
describe("visibleOrgTree:業務頁列可見範圍內的組織", () => {
  let api: AuthTestApp;
  let tenantA: Types.ObjectId;
  let storeA: Types.ObjectId;

  async function treeOf(token: string): Promise<Node[]> {
    const result = await api.graphql<{ visibleOrgTree: Node[] }>(
      VISIBLE_ORG_TREE,
      {},
      { accessToken: token },
    );
    expect(result.errors).toBeUndefined();
    return result.data?.visibleOrgTree ?? [];
  }

  let sequence = 0;
  async function memberOf(orgIds: Types.ObjectId[]): Promise<string> {
    sequence += 1;
    const account = `visible-tree-${String(sequence)}`;
    await createUser(api.connection, { account, password: PASSWORD, orgIds });
    return login(api, account);
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-visible-org-tree");
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

  it("店長(只屬於中山店、沒有治理權限):只看得到自己的分店,它就是根", async () => {
    const tree = await treeOf(await memberOf([storeA]));
    expect(tree).toEqual([
      {
        id: String(storeA),
        name: "中山店",
        parentId: null,
        outOfScope: false,
        children: [],
      },
    ]);
  });

  it("總部(屬於租戶甲,開關「包含下層」):看得到整個租戶;別的租戶不出現", async () => {
    const tree = await treeOf(await memberOf([tenantA]));
    expect(tree.map((node) => node.id)).toEqual([String(tenantA)]);
    expect(new Set(namesOf(tree))).toEqual(
      new Set(["中山店", "新竹店", "租戶甲"]),
    );
  });

  it("租戶的開關是預設(只看自己):總部只看得到最上層組織本身", async () => {
    const tenantC = await createOrg(api.connection, { name: "租戶丙" });
    await createOrg(api.connection, { name: "丙分店", parentId: tenantC });
    const tree = await treeOf(await memberOf([tenantC]));
    expect(namesOf(tree)).toEqual(["租戶丙"]);
  });

  it("根組織的成員:可見範圍是全部,整棵樹從根組織開始", async () => {
    const token = await login(api, ROOT_ADMIN.account, ROOT_ADMIN.password);
    const tree = await treeOf(token);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.parentId).toBeNull();
    expect(namesOf(tree)).toEqual(
      expect.arrayContaining(["租戶甲", "中山店", "租戶乙"]),
    );
  });

  it("沒有治理權限:管理範圍的 orgTree 被拒,visibleOrgTree 照樣拿得到", async () => {
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
});
