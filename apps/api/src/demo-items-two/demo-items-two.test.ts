import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import { OperatorContextService } from "../auth/operator-context.service";
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
import { DemoItemsOneRepository } from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import {
  CREATE_DEMO_ITEM_TWO,
  DELETE_DEMO_ITEM_TWO,
  DEMO_ITEM_TWO,
  type DeleteDemoItemTwoData,
  type DemoItemTwoData,
  type DemoItemTwoRow,
  type DemoTwoOperator,
  type MutateDemoItemTwoData,
  SET_DEMO_ITEM_TWO_ENABLED,
  UPDATE_DEMO_ITEM_TWO,
  createDemoTwoOperator,
  createItem,
  listItems,
  login,
  sortedNames,
} from "./test-support/fixtures";

/**
 * seed 種下的示範資料名稱(正本 `apps/db-migrator/seeds/base/demo-items.ts`)。
 * STRUCT-01 禁 app 互 import,所以這裡抄一份 —— 名稱對不上時這個測試就是第一個紅的。
 */
const SEEDED_NAMES = new Set([
  "每週營運週報",
  "supplier 聯絡窗口",
  "廚房檢查表",
  "新人訓練筆記",
  "已停用的對照項目",
]);

const SAVE_DATA_SCOPE_RULE = /* GraphQL */ `
  mutation SaveDataScopeRule($input: SaveDataScopeRuleInput!) {
    saveDataScopeRule(input: $input) {
      rule {
        collection
      }
    }
  }
`;

/** 送一個 mutation(共用給的測試用;錯誤留給呼叫端斷言)。 */
function mutate(
  api: AuthTestApp,
  query: string,
  input: Record<string, unknown>,
  token: string,
) {
  return api.graphql<MutateDemoItemTwoData>(
    query,
    { input },
    { accessToken: token },
  );
}

/** 【操作者本人】的條件列(ADR-0008「僅本人」;形狀正本 data-scope.test.ts)。 */
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

/** `audit_logs` 的一筆(欄位正本 `database/schemas/audit-log.schema.ts`)。 */
interface AuditRecord {
  action: string;
  targetType?: string;
  targetId?: Types.ObjectId;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/**
 * 示範模組2(CRUD / 分頁與篩選 / abilities / 守門 / 審計 / 對照組)。
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07);夾具沿用 auth / permission 的 test-support。
 *
 * 組織樹(root 為 seed 建的根組織):root ─┬─ 租戶甲 ── 部門一
 *                                        └─ 租戶乙
 *
 * **第二個接縫**(TEST-07 的例外,PR 有說明):最後一段的對照測試要先讓
 * `demo_items_one` 有資料、再證明規則只收縮它而不碰 `demo_items_two`。示範模組1 的
 * GraphQL 端點屬另一個模組、這裡不依賴它,所以那幾筆用 `DemoItemsOneRepository` 直接建與查
 * —— 走的仍是正式的執行路徑(BaseRepository 的查詢中介層)。
 */
describe("示範模組2(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;

  let tenantA: Types.ObjectId;
  let tenantB: Types.ObjectId;
  let deptOne: Types.ObjectId;

  let editor: DemoTwoOperator;
  let peer: DemoTwoOperator;
  let viewer: DemoTwoOperator;
  let otherTenant: DemoTwoOperator;
  let rootToken: string;

  function latestAudit(
    action: string,
    targetId?: Types.ObjectId | string,
  ): Promise<AuditRecord | null> {
    return connection.collection("audit_logs").findOne<AuditRecord>(
      {
        action,
        ...(targetId ? { targetId: new Types.ObjectId(targetId) } : {}),
      },
      { sort: { createdAt: -1, _id: -1 } },
    );
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

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-demo-items-two");
    connection = api.connection;

    tenantA = await createOrg(connection, { name: "租戶甲" });
    tenantB = await createOrg(connection, { name: "租戶乙" });
    deptOne = await createOrg(connection, {
      name: "部門一",
      parentId: tenantA,
    });

    editor = await createDemoTwoOperator(api, connection, deptOne);
    peer = await createDemoTwoOperator(api, connection, deptOne);
    viewer = await createDemoTwoOperator(api, connection, deptOne, [
      "demo.sample-two.view",
    ]);
    otherTenant = await createDemoTwoOperator(api, connection, tenantB);
    rootToken = await login(api, ROOT_ADMIN.account, ROOT_ADMIN.password);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("清單(demoItemsTwo)", () => {
    it("seed 的示範資料掛在根組織:root 看得到 5 筆,租戶的操作者一筆都看不到(租戶保底)", async () => {
      const seenByRoot = await listItems(api, rootToken, { pageSize: 100 });
      expect(
        seenByRoot.items
          .map((item) => item.name)
          .filter((name) => SEEDED_NAMES.has(name)),
      ).toHaveLength(SEEDED_NAMES.size);

      const seenByEditor = await listItems(api, editor.token, {
        pageSize: 100,
      });
      expect(
        seenByEditor.items
          .map((item) => item.name)
          .filter((name) => SEEDED_NAMES.has(name)),
      ).toEqual([]);
    });

    it("enabled 缺席 = 啟用與停用都列;給值就只列那一種", async () => {
      const all = await listItems(api, rootToken, { pageSize: 100 });
      const names = all.items.map((item) => item.name);
      expect(names).toContain("已停用的對照項目");

      const onlyEnabled = await listItems(api, rootToken, {
        pageSize: 100,
        enabled: true,
      });
      expect(onlyEnabled.items.map((item) => item.name)).not.toContain(
        "已停用的對照項目",
      );

      const onlyDisabled = await listItems(api, rootToken, {
        pageSize: 100,
        enabled: false,
      });
      expect(onlyDisabled.items.map((item) => item.name)).toContain(
        "已停用的對照項目",
      );
    });

    it("keyword 比對名稱與備註,不分大小寫且特殊字元當字面值", async () => {
      const byName = await listItems(api, rootToken, {
        pageSize: 100,
        keyword: "SUPPLIER",
      });
      expect(sortedNames(byName.items)).toEqual(["supplier 聯絡窗口"]);

      const byNote = await listItems(api, rootToken, {
        pageSize: 100,
        keyword: "可見範圍保底",
      });
      expect(sortedNames(byNote.items)).toEqual(["每週營運週報"]);

      // `.*` 若被當成 regex 會全部命中 —— 命中 0 筆才代表有 escape
      const literal = await listItems(api, rootToken, {
        pageSize: 100,
        keyword: ".*",
      });
      expect(literal.totalCount).toBe(0);
    });

    it("分頁:totalCount 是符合條件的總數,items 只有該頁那幾筆", async () => {
      const firstPage = await listItems(api, rootToken, {
        page: 1,
        pageSize: 2,
      });
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.page).toBe(1);
      expect(firstPage.pageSize).toBe(2);
      expect(firstPage.totalCount).toBeGreaterThanOrEqual(SEEDED_NAMES.size);

      const secondPage = await listItems(api, rootToken, {
        page: 2,
        pageSize: 2,
      });
      expect(secondPage.totalCount).toBe(firstPage.totalCount);
      expect(secondPage.items.map((item) => item.id)).not.toEqual(
        firstPage.items.map((item) => item.id),
      );
    });
  });

  describe("CRUD(create / demoItemTwo / update / setDemoItemTwoEnabled / delete)", () => {
    let created: DemoItemTwoRow;

    it("新增:寫入操作者的當前組織與建立者,回傳的 createdBy 是自己", async () => {
      created = await createItem(api, editor.token, {
        name: "部門一的項目",
        note: "第一版備註",
      });
      expect(created).toMatchObject({
        name: "部門一的項目",
        note: "第一版備註",
        enabled: true,
      });
      expect(created.createdBy).toMatchObject({
        id: String(editor.userId),
        name: editor.account,
      });

      const stored = await connection
        .collection("demo_items_two")
        .findOne<{ orgId: Types.ObjectId }>({
          _id: new Types.ObjectId(created.id),
        });
      expect(String(stored?.orgId)).toBe(String(deptOne));
    });

    it("詳情:同租戶查得到,別的租戶一律 NOT_FOUND(不透露存在與否)", async () => {
      const mine = await api.graphql<DemoItemTwoData>(
        DEMO_ITEM_TWO,
        { id: created.id },
        { accessToken: editor.token },
      );
      expect(mine.errors).toBeUndefined();
      expect(mine.data?.demoItemTwo.item.name).toBe("部門一的項目");

      const theirs = await api.graphql<DemoItemTwoData>(
        DEMO_ITEM_TWO,
        { id: created.id },
        { accessToken: otherTenant.token },
      );
      expect(theirs.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
    });

    it("編輯:缺席的欄位不動,note 送 null 清空(GQL-06)", async () => {
      const renamed = await api.graphql<MutateDemoItemTwoData>(
        UPDATE_DEMO_ITEM_TWO,
        { input: { id: created.id, name: "部門一的項目(改名)" } },
        { accessToken: editor.token },
      );
      expect(renamed.errors).toBeUndefined();
      // note 缺席 → 不動
      expect(renamed.data?.updateDemoItemTwo.item).toMatchObject({
        name: "部門一的項目(改名)",
        note: "第一版備註",
      });

      const cleared = await api.graphql<MutateDemoItemTwoData>(
        UPDATE_DEMO_ITEM_TWO,
        { input: { id: created.id, note: null } },
        { accessToken: editor.token },
      );
      expect(cleared.errors).toBeUndefined();
      expect(cleared.data?.updateDemoItemTwo.item).toMatchObject({
        name: "部門一的項目(改名)",
        note: null,
      });
    });

    it("停用 / 啟用:切換後清單仍看得到,只是 enabled 變了", async () => {
      const disabled = await api.graphql<MutateDemoItemTwoData>(
        SET_DEMO_ITEM_TWO_ENABLED,
        { input: { id: created.id, enabled: false } },
        { accessToken: editor.token },
      );
      expect(disabled.errors).toBeUndefined();
      expect(disabled.data?.setDemoItemTwoEnabled.item.enabled).toBe(false);

      const stillListed = await listItems(api, editor.token, {
        pageSize: 100,
      });
      expect(stillListed.items.map((item) => item.id)).toContain(created.id);

      const enabled = await api.graphql<MutateDemoItemTwoData>(
        SET_DEMO_ITEM_TWO_ENABLED,
        { input: { id: created.id, enabled: true } },
        { accessToken: editor.token },
      );
      expect(enabled.data?.setDemoItemTwoEnabled.item.enabled).toBe(true);
    });

    it("刪除是軟刪除:之後查不到,資料庫裡仍在且 deletedAt 有值", async () => {
      const removable = await createItem(api, editor.token, {
        name: "要被刪掉的項目",
      });
      const result = await api.graphql<DeleteDemoItemTwoData>(
        DELETE_DEMO_ITEM_TWO,
        { input: { id: removable.id } },
        { accessToken: editor.token },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.deleteDemoItemTwo).toEqual({
        success: true,
        deletedId: removable.id,
      });

      const afterDelete = await api.graphql<DemoItemTwoData>(
        DEMO_ITEM_TWO,
        { id: removable.id },
        { accessToken: editor.token },
      );
      expect(afterDelete.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");

      const stored = await connection
        .collection("demo_items_two")
        .findOne<{ deletedAt: Date | null }>({
          _id: new Types.ObjectId(removable.id),
        });
      expect(stored?.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe("權限:守門與 abilities", () => {
    it("只有 view 的操作者:abilities 兩個都 false", async () => {
      const seen = await listItems(api, viewer.token, { pageSize: 100 });
      for (const item of seen.items) {
        expect(item.abilities).toEqual({ canEdit: false, canDelete: false });
      }
    });

    it("有 edit / delete 的操作者:abilities 兩個都 true", async () => {
      const seen = await listItems(api, editor.token, { pageSize: 100 });
      expect(seen.items.length).toBeGreaterThan(0);
      for (const item of seen.items) {
        expect(item.abilities).toEqual({ canEdit: true, canDelete: true });
      }
    });

    it("沒有 create / edit / delete 權限硬送 → FORBIDDEN(頁與功能分離,劇本 7)", async () => {
      const seen = await listItems(api, viewer.token, { pageSize: 1 });
      const [target] = seen.items;
      if (!target) {
        throw new Error("測試前提壞了:viewer 應至少看得到一筆");
      }

      const create = await api.graphql(
        UPDATE_DEMO_ITEM_TWO,
        { input: { id: target.id, name: "硬送改名" } },
        { accessToken: viewer.token },
      );
      expect(create.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");

      const toggle = await api.graphql(
        SET_DEMO_ITEM_TWO_ENABLED,
        { input: { id: target.id, enabled: false } },
        { accessToken: viewer.token },
      );
      expect(toggle.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");

      const remove = await api.graphql(
        DELETE_DEMO_ITEM_TWO,
        { input: { id: target.id } },
        { accessToken: viewer.token },
      );
      expect(remove.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });

    it("建立者查無此人(示範資料的假 id)時 createdBy 為 null,不是炸掉", async () => {
      const seen = await listItems(api, rootToken, { pageSize: 100 });
      const seeded = seen.items.find((item) => item.name === "每週營運週報");
      expect(seeded?.createdBy).toBeNull();
    });
  });

  describe("輸入驗證(VALIDATION_FAILED)", () => {
    it('name 去頭尾空白後為空 → fields: ["name"]', async () => {
      const result = await api.graphql(
        /* GraphQL */ `
          mutation CreateDemoItemTwo($input: CreateDemoItemTwoInput!) {
            createDemoItemTwo(input: $input) {
              item {
                id
              }
            }
          }
        `,
        { input: { name: " ".repeat(3) } },
        { accessToken: editor.token },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["name"],
      });
    });

    it('id 不是合法的 ObjectId → fields: ["id"](不是 NOT_FOUND)', async () => {
      const result = await api.graphql<DemoItemTwoData>(
        DEMO_ITEM_TWO,
        { id: "not-an-object-id" },
        { accessToken: editor.token },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["id"],
      });
    });
  });

  describe("審計(demo-item-two.*)", () => {
    it("四個寫入動作各寫一筆 audit_log,targetType 為 demo_item_two", async () => {
      const item = await createItem(api, editor.token, {
        name: "審計用項目",
        note: "建立時的備註",
      });
      await api.graphql<MutateDemoItemTwoData>(
        UPDATE_DEMO_ITEM_TWO,
        { input: { id: item.id, name: "審計用項目(改名)" } },
        { accessToken: editor.token },
      );
      await api.graphql<MutateDemoItemTwoData>(
        SET_DEMO_ITEM_TWO_ENABLED,
        { input: { id: item.id, enabled: false } },
        { accessToken: editor.token },
      );
      await api.graphql<DeleteDemoItemTwoData>(
        DELETE_DEMO_ITEM_TWO,
        { input: { id: item.id } },
        { accessToken: editor.token },
      );

      expect(await latestAudit("demo-item-two.create", item.id)).toMatchObject({
        targetType: "demo_item_two",
        after: { name: "審計用項目", note: "建立時的備註" },
      });
      expect(await latestAudit("demo-item-two.edit", item.id)).toMatchObject({
        before: { name: "審計用項目" },
        after: { name: "審計用項目(改名)" },
      });
      expect(
        await latestAudit("demo-item-two.toggle-enabled", item.id),
      ).toMatchObject({
        before: { enabled: true },
        after: { enabled: false },
      });
      expect(await latestAudit("demo-item-two.delete", item.id)).toMatchObject({
        targetType: "demo_item_two",
        before: { name: "審計用項目(改名)" },
      });
    });
  });

  /**
   * 劇本 3(`docs/testing/permission-scenarios.md`):`demo_items_two` 沒有 seed 宣告
   * `dataScopeTarget`,所以資料範圍規則的機制對它完全不介入 —— 查詢只受可見範圍保底。
   * 反證的方式是「同一個操作者、同一個時間點」:規則一開,示範模組1 收縮、示範模組2 不動。
   */
  describe("對照:未宣告資料範圍目標(劇本 3)", () => {
    it("對 demo_items_one 設『全部人 → 僅本人』後:示範模組1 收縮,示範模組2 的清單一筆不少", async () => {
      const asEditor = await operatorOf(editor.userId, deptOne);
      const asPeer = await operatorOf(peer.userId, deptOne);
      const itemsOne = api.app.get(DemoItemsOneRepository);
      await itemsOne.create(asEditor, { name: "示範1:編輯者的" });
      await itemsOne.create(asPeer, { name: "示範1:同事的" });
      await createItem(api, peer.token, { name: "示範2:同事的" });

      const beforeOne = await itemsOne.findMany(asEditor);
      expect(sortedNames(beforeOne)).toEqual([
        "示範1:同事的",
        "示範1:編輯者的",
      ]);
      const beforeTwo = await listItems(api, editor.token, { pageSize: 100 });

      const saved = await api.graphql(
        SAVE_DATA_SCOPE_RULE,
        {
          input: {
            targetId: await dataScopeTargetIdOf(
              api.connection,
              SAMPLE_ONE_MODULE_KEY,
            ),
            combineOp: "OR",
            rules: [{ audience: { mode: "all" }, filter: ONLY_MINE }],
          },
        },
        { accessToken: rootToken },
      );
      expect(saved.errors).toBeUndefined();

      // 示範模組1:規則命中 → 只剩自建
      const afterOne = await itemsOne.findMany(
        await operatorOf(editor.userId, deptOne),
      );
      expect(sortedNames(afterOne)).toEqual(["示範1:編輯者的"]);

      // 示範模組2:同一位操作者、同一條規則,結果完全不變
      const afterTwo = await listItems(api, editor.token, { pageSize: 100 });
      expect(sortedNames(afterTwo.items)).toEqual(sortedNames(beforeTwo.items));
      expect(afterTwo.totalCount).toBe(beforeTwo.totalCount);
      // 別人建的那一筆還在 —— 規則若誤套,它會是第一個消失的
      expect(sortedNames(afterTwo.items)).toContain("示範2:同事的");
    });
  });

  /**
   * 資料共用(ADR-0014;示範模組2 是「可共用、預設不共用、可編輯」的示範表):
   * 租戶甲 ─┬─ 部門一(既有)
   *         └─ 部門二 ── 部門二之一
   */
  describe("共用給(shareOrgs)", () => {
    let deptTwo: Types.ObjectId;
    let deptTwoChild: Types.ObjectId;
    let deptTwoEditor: DemoTwoOperator;
    let deptTwoChildViewer: DemoTwoOperator;
    let creatorOnly: DemoTwoOperator;

    beforeAll(async () => {
      deptTwo = await createOrg(connection, {
        name: "部門二",
        parentId: tenantA,
      });
      deptTwoChild = await createOrg(connection, {
        name: "部門二之一",
        parentId: deptTwo,
      });
      deptTwoEditor = await createDemoTwoOperator(api, connection, deptTwo);
      deptTwoChildViewer = await createDemoTwoOperator(
        api,
        connection,
        deptTwoChild,
        ["demo.sample-two.view"],
      );
      creatorOnly = await createDemoTwoOperator(api, connection, deptOne, [
        "demo.sample-two.view",
        "demo.sample-two.create",
      ]);
    }, HOOK_TIMEOUT_MS);

    it("新增時給共用清單;被共用的部門看得到、標示為共用進來、不能改刪", async () => {
      const created = await createItem(api, editor.token, {
        name: "共用:給部門二",
        shareOrgs: [{ orgId: String(deptTwo) }],
      });
      expect(created.shareOrgs).toEqual([
        { orgId: String(deptTwo), includeDescendants: false },
      ]);
      expect(created.isShared).toBe(false);

      const seen = await listItems(api, deptTwoEditor.token, { pageSize: 100 });
      const row = seen.items.find((item) => item.id === created.id);
      expect(row).toMatchObject({
        isShared: true,
        abilities: { canEdit: false, canDelete: false },
      });
      // 不含下層:部門二之一看不到
      const seenByChild = await listItems(api, deptTwoChildViewer.token, {
        pageSize: 100,
      });
      expect(seenByChild.items.map((item) => item.id)).not.toContain(
        created.id,
      );

      // 修改 / 刪除不放大:共用進來的 → NOT_FOUND
      const updated = await mutate(
        api,
        UPDATE_DEMO_ITEM_TWO,
        { id: created.id, name: "改名" },
        deptTwoEditor.token,
      );
      expect(updated.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
      const removed = await api.graphql<DeleteDemoItemTwoData>(
        DELETE_DEMO_ITEM_TWO,
        { input: { id: created.id } },
        { accessToken: deptTwoEditor.token },
      );
      expect(removed.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
    });

    it("編輯時改成「含下層」:下層跟著看得到;改回空清單就都看不到", async () => {
      const created = await createItem(api, editor.token, {
        name: "共用:改清單",
      });
      const shared = await mutate(
        api,
        UPDATE_DEMO_ITEM_TWO,
        {
          id: created.id,
          shareOrgs: [{ orgId: String(deptTwo), includeDescendants: true }],
        },
        editor.token,
      );
      expect(shared.errors).toBeUndefined();
      const child = await api.graphql<DemoItemTwoData>(
        DEMO_ITEM_TWO,
        { id: created.id },
        { accessToken: deptTwoChildViewer.token },
      );
      expect(child.data?.demoItemTwo.item.isShared).toBe(true);

      await mutate(
        api,
        UPDATE_DEMO_ITEM_TWO,
        { id: created.id, shareOrgs: [] },
        editor.token,
      );
      const after = await api.graphql<DemoItemTwoData>(
        DEMO_ITEM_TWO,
        { id: created.id },
        { accessToken: deptTwoChildViewer.token },
      );
      expect(after.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
    });

    it("共用給別租戶的組織 → VALIDATION_FAILED(fields: shareOrgs);別租戶的人看不到", async () => {
      const created = await mutate(
        api,
        CREATE_DEMO_ITEM_TWO,
        { name: "共用:給別租戶", shareOrgs: [{ orgId: String(tenantB) }] },
        editor.token,
      );
      expect(created.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["shareOrgs"],
      });
      const own = await createItem(api, editor.token, {
        name: "共用:編輯給別租戶",
      });
      const updated = await mutate(
        api,
        UPDATE_DEMO_ITEM_TWO,
        { id: own.id, shareOrgs: [{ orgId: String(tenantB) }] },
        editor.token,
      );
      expect(updated.errors?.[0]?.extensions?.code).toBe("VALIDATION_FAILED");
      const seenByOther = await listItems(api, otherTenant.token, {
        pageSize: 100,
      });
      expect(seenByOther.items.map((item) => item.id)).not.toContain(own.id);
    });

    it("沒有編輯權限的人新增時不能給共用清單(FORBIDDEN);不給就照常新增", async () => {
      const denied = await mutate(
        api,
        CREATE_DEMO_ITEM_TWO,
        { name: "共用:沒有編輯權限", shareOrgs: [{ orgId: String(deptTwo) }] },
        creatorOnly.token,
      );
      expect(denied.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      const plain = await createItem(api, creatorOnly.token, {
        name: "共用:沒有編輯權限但不共用",
      });
      expect(plain.shareOrgs).toEqual([]);
    });
  });
});
