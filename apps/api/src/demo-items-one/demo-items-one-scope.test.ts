import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { Connection, Types } from "mongoose";

import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg } from "../auth/test-support/fixtures";
import {
  SAMPLE_ONE_MODULE_KEY,
  dataScopeTargetIdOf,
} from "../data-scope/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import {
  DEMO_ITEM_ONE,
  type ItemData,
  type ItemRow,
  P,
  type SampleOneOperator,
  createItem,
  createSampleOneOperator,
  listNames,
  login,
} from "./test-support/fixtures";

const SAVE_DATA_SCOPE_RULE = /* GraphQL */ `
  mutation SaveDataScopeRule($input: SaveDataScopeRuleInput!) {
    saveDataScopeRule(input: $input) {
      rule {
        collection
      }
    }
  }
`;

/**
 * 示範模組1 的**範圍**:資料範圍規則(ADR-0008)與可見性開關(ADR-0005)
 * 在 GraphQL 端點上真的生效。打真的 GraphQL 端點、對真 MongoDB(TEST-07)。
 *
 * 規則的機制本身在 `data-scope/data-scope.test.ts` 已驗(直接打 repository);
 * **這裡驗的是「經過示範模組的端點也一樣」**:列表與單筆一致、規則只會讓看到的變少。
 * `docs/testing/permission-scenarios.md` 劇本 2(規則命中 → 只見自建;刪規則恢復)、
 * 4(頂層合成 OR / AND)、12(可見性開關收縮業務資料)。
 *
 * 組織樹(root 為 seed 建的根組織):
 *   root ─┬─ 租戶甲 ── 部門一
 *         └─ 租戶乙(開關 subtree)── 部門乙
 */
describe("示範模組1 範圍(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let rootToken: string;

  let deptOne: Types.ObjectId;
  let agent: SampleOneOperator;
  let peer: SampleOneOperator;
  let peerDraft: ItemRow;

  /** 整份覆蓋這個目標的規則;`[]` = 刪掉規則(ADR-0008)。快取由 mutation 自己作廢。 */
  async function saveRule(
    rules: Record<string, unknown>[],
    combineOp: "AND" | "OR" = "OR",
  ): Promise<void> {
    const targetId = await dataScopeTargetIdOf(
      connection,
      SAMPLE_ONE_MODULE_KEY,
    );
    const result = await api.graphql(
      SAVE_DATA_SCOPE_RULE,
      { input: { targetId, combineOp, rules } },
      { accessToken: rootToken },
    );
    expect(result.errors).toBeUndefined();
  }

  /** 套用對象 = 客服角色 → 建立者是【操作者本人】。 */
  function ownedByOperatorRule(): Record<string, unknown> {
    return {
      audience: {
        mode: "match",
        filter: {
          field: "role",
          cond: "in",
          value: { kind: "static", values: [String(agent.roleId)] },
        },
      },
      filter: {
        field: "createdBy",
        cond: "in",
        value: { kind: "dynamic", ref: "current-user" },
      },
    };
  }

  /** 套用對象 = 客服角色 → 狀態是「已發布」(seed 宣告的 enum 欄位)。 */
  function publishedRule(): Record<string, unknown> {
    return {
      audience: {
        mode: "match",
        filter: {
          field: "role",
          cond: "in",
          value: { kind: "static", values: [String(agent.roleId)] },
        },
      },
      filter: {
        field: "status",
        cond: "in",
        value: { kind: "static", values: ["published"] },
      },
    };
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-demo-one-scope");
    connection = api.connection;
    rootToken = await login(api, ROOT_ADMIN.account, ROOT_ADMIN.password);

    const tenantA = await createOrg(connection, { name: "租戶甲" });
    deptOne = await createOrg(connection, {
      name: "部門一",
      parentId: tenantA,
    });

    agent = await createSampleOneOperator(api, connection, {
      orgId: deptOne,
      ownerOrgId: tenantA,
    });
    peer = await createSampleOneOperator(api, connection, {
      orgId: deptOne,
      ownerOrgId: tenantA,
    });

    await createItem(api, agent.token, { name: "甲的草稿" });
    await createItem(api, agent.token, {
      name: "甲的已發布",
      status: "PUBLISHED",
    });
    peerDraft = await createItem(api, peer.token, { name: "乙的草稿" });
    await createItem(api, peer.token, {
      name: "乙的已發布",
      status: "PUBLISHED",
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("劇本 2:規則命中 → 列表與單筆一致", () => {
    it("沒有規則時看得到同組織的全部(租戶保底)", async () => {
      await expect(listNames(api, agent.token)).resolves.toEqual([
        "乙的已發布",
        "乙的草稿",
        "甲的已發布",
        "甲的草稿",
      ]);
    });

    it("建規則「建立者 = 操作者本人」→ 列表只剩自建", async () => {
      await saveRule([ownedByOperatorRule()]);
      await expect(listNames(api, agent.token)).resolves.toEqual([
        "甲的已發布",
        "甲的草稿",
      ]);
    });

    it("單筆與列表同一個範圍:看不到的那筆回 NOT_FOUND", async () => {
      const result = await api.graphql<ItemData>(
        DEMO_ITEM_ONE,
        { id: peerDraft.id },
        { accessToken: agent.token },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("沒被規則命中的人不受影響(乙沒有那個角色)", async () => {
      await expect(listNames(api, peer.token)).resolves.toEqual([
        "乙的已發布",
        "乙的草稿",
        "甲的已發布",
        "甲的草稿",
      ]);
    });

    it("刪規則(整份覆蓋成空)→ 恢復到租戶保底", async () => {
      await saveRule([]);
      await expect(listNames(api, agent.token)).resolves.toEqual([
        "乙的已發布",
        "乙的草稿",
        "甲的已發布",
        "甲的草稿",
      ]);
    });
  });

  describe("劇本 4:兩條都命中同一人時的頂層合成", () => {
    it("OR = 聯集(自建的 + 全部已發布的)", async () => {
      await saveRule([ownedByOperatorRule(), publishedRule()], "OR");
      await expect(listNames(api, agent.token)).resolves.toEqual([
        "乙的已發布",
        "甲的已發布",
        "甲的草稿",
      ]);
    });

    it("AND = 交集(自建**且**已發布)", async () => {
      await saveRule([ownedByOperatorRule(), publishedRule()], "AND");
      await expect(listNames(api, agent.token)).resolves.toEqual([
        "甲的已發布",
      ]);
    });
  });

  describe("劇本 12:可見性開關收縮業務資料", () => {
    let tenantB: Types.ObjectId;
    let deptB: Types.ObjectId;
    let manager: SampleOneOperator;

    beforeAll(async () => {
      // 前面的規則只命中客服角色,但仍整份清掉,讓這一段的斷言只受開關影響
      await saveRule([]);
      tenantB = await createOrg(connection, {
        name: "租戶乙",
        settings: { visibility: "subtree" },
      });
      deptB = await createOrg(connection, {
        name: "部門乙",
        parentId: tenantB,
      });

      manager = await createSampleOneOperator(api, connection, {
        orgId: tenantB,
        permissionKeys: [P.view, P.create],
      });
      const deptMember = await createSampleOneOperator(api, connection, {
        orgId: deptB,
        ownerOrgId: tenantB,
        permissionKeys: [P.view, P.create],
      });
      await createItem(api, manager.token, { name: "租戶乙自己的" });
      await createItem(api, deptMember.token, { name: "部門乙的" });
    }, HOOK_TIMEOUT_MS);

    it("開關 subtree:租戶頂層的人看得到下層的業務資料", async () => {
      await expect(listNames(api, manager.token)).resolves.toEqual([
        "租戶乙自己的",
        "部門乙的",
      ]);
    });

    it("切成 own 後重新登入 → 只剩自己所屬組織的資料", async () => {
      await connection
        .collection("orgs")
        .updateOne(
          { _id: tenantB },
          { $set: { "settings.visibility": "own" } },
        );
      const token = await login(api, manager.account);
      await expect(listNames(api, token)).resolves.toEqual(["租戶乙自己的"]);
    });
  });
});
