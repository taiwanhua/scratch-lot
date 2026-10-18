import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg } from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { findCategoryId } from "../fields/test-support/fixtures";
import {
  ATTACHMENT_INPUT,
  ATTACHMENT_PATH,
  COVER_PATH,
  CREATE_DEMO_ITEM_ONE,
  DELETE_DEMO_ITEM_ONE,
  DEMO_ITEM_ONE,
  type ItemData,
  type MutationData,
  P,
  SET_DEMO_ITEM_ONE_ENABLED,
  type SampleOneOperator,
  UPDATE_DEMO_ITEM_ONE,
  createItem,
  createSampleOneOperator,
  insertFieldOption,
  latestAudit,
  listItems,
  listNames,
} from "./test-support/fixtures";

/**
 * 示範模組1 的 CRUD、分類驗證與稽核。
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07);夾具沿用 auth / permission / fields 的 test-support。
 *
 * 欄位級與頁面自有權限見 `demo-items-one-permissions.test.ts`;
 * 資料範圍規則與可見性開關見 `demo-items-one-scope.test.ts`。
 *
 * 組織樹(root 為 seed 建的根組織):root ─┬─ 租戶甲  └─ 租戶乙(互為兄弟,看不到對方的自訂選項)
 * 欄位管理種子:「示範分類」有 staple / side-dish / drink 三個全域選項。
 */
describe("示範模組1 CRUD(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;

  let tenantA: Types.ObjectId;
  let tenantB: Types.ObjectId;
  let demoCategoryId: Types.ObjectId;
  let operator: SampleOneOperator;

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-demo-items-one");
    connection = api.connection;

    tenantA = await createOrg(connection, { name: "租戶甲" });
    tenantB = await createOrg(connection, { name: "租戶乙" });
    demoCategoryId = await findCategoryId(connection, "demo-category");

    // 租戶甲自己加一個停用的選項、租戶乙加一個啟用的選項 —— 兩者都不該被租戶甲的操作者選到
    await insertFieldOption(connection, {
      categoryId: demoCategoryId,
      orgId: tenantA,
      value: "retired",
      label: "已下架",
      enabled: false,
    });
    await insertFieldOption(connection, {
      categoryId: demoCategoryId,
      orgId: tenantB,
      value: "tenant-b-only",
      label: "租戶乙專用",
    });

    operator = await createSampleOneOperator(api, connection, {
      orgId: tenantA,
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("新增", () => {
    it("回傳整筆 + 預設狀態 DRAFT + 建立者,並寫一筆 demo-item-one.create 稽核", async () => {
      const item = await createItem(api, operator.token, {
        name: "主食項目",
        category: "staple",
        note: "備註",
      });
      expect(item).toMatchObject({
        name: "主食項目",
        category: "staple",
        categoryLabel: "主食",
        note: "備註",
        status: "DRAFT",
        enabled: true,
        createdBy: { id: String(operator.userId), name: operator.account },
      });

      const audit = await latestAudit(
        connection,
        "demo-item-one.create",
        item.id,
      );
      expect(audit?.targetType).toBe("demo_item_one");
      expect(audit?.after).toMatchObject({
        name: "主食項目",
        category: "staple",
        status: "draft",
      });
    });

    it("名稱空白 → VALIDATION_FAILED,fields 標在 name", async () => {
      const result = await api.graphql(
        CREATE_DEMO_ITEM_ONE,
        { input: { name: " ".repeat(3) } },
        { accessToken: operator.token },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["name"],
      });
    });

    it.each([
      ["不存在的分類", "nope"],
      ["自己這層已停用的選項", "retired"],
      ["別的租戶加的選項", "tenant-b-only"],
    ])(
      "%s → VALIDATION_FAILED,fields 標在 category",
      async (_label, category) => {
        const result = await api.graphql(
          CREATE_DEMO_ITEM_ONE,
          { input: { name: "分類不合法", category } },
          { accessToken: operator.token },
        );
        expect(result.errors?.[0]?.extensions).toMatchObject({
          code: "VALIDATION_FAILED",
          fields: ["category"],
        });
      },
    );

    it("coverPath 不是本 API 簽出來的路徑 → VALIDATION_FAILED", async () => {
      const result = await api.graphql(
        CREATE_DEMO_ITEM_ONE,
        { input: { name: "偷塞路徑", coverPath: "secrets/private.png" } },
        { accessToken: operator.token },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["coverPath"],
      });
    });

    it("封面回公開穩定 URL(不帶簽名參數)、附件回路徑與原始檔名 / 大小 / 檔型", async () => {
      const item = await createItem(api, operator.token, {
        name: "雙路檔案",
        coverPath: COVER_PATH,
        attachment: ATTACHMENT_INPUT,
      });
      expect(item.coverPath).toBe(COVER_PATH);
      expect(item.coverUrl).toContain(COVER_PATH);
      expect(item.coverUrl).not.toContain("action=read");
      expect(item.attachment).toEqual({
        path: ATTACHMENT_PATH,
        name: "成本估算 2026 Q3.jpg",
        size: 123_456,
        contentType: "image/jpeg",
      });

      // 重新查一次:存進 DB 的是原始值(不是回傳時臨時算的)
      const fetched = await api.graphql<ItemData>(
        DEMO_ITEM_ONE,
        { id: item.id },
        { accessToken: operator.token },
      );
      expect(fetched.data?.demoItemOne.item.attachment).toEqual(
        item.attachment,
      );
    });

    it("早期的舊資料(只有 attachmentPath)→ 檔名 / 大小 / 檔型回 null,路徑照回", async () => {
      const item = await createItem(api, operator.token, {
        name: "舊附件",
        attachment: ATTACHMENT_INPUT,
      });
      await connection.collection("demo_items_one").updateOne(
        { _id: new Types.ObjectId(item.id) },
        {
          $unset: {
            attachmentName: "",
            attachmentSize: "",
            attachmentContentType: "",
          },
        },
      );
      const fetched = await api.graphql<ItemData>(
        DEMO_ITEM_ONE,
        { id: item.id },
        { accessToken: operator.token },
      );
      expect(fetched.data?.demoItemOne.item.attachment).toEqual({
        path: ATTACHMENT_PATH,
        name: null,
        size: null,
        contentType: null,
      });
    });

    it.each([
      ["路徑不是本 API 簽出來的", { path: "secrets/private.pdf" }],
      ["檔名空白", { name: " ".repeat(3) }],
      ["檔名超過 255 字", { name: `${"長".repeat(252)}.pdf` }],
      ["大小是負數", { size: -1 }],
      ["大小超過附件上限 20MB", { size: 20 * 1024 * 1024 + 1 }],
      ["檔型不在附件白名單", { contentType: "application/x-msdownload" }],
    ])(
      "附件%s → VALIDATION_FAILED,fields 標在 attachment",
      async (_label, override) => {
        const result = await api.graphql(
          CREATE_DEMO_ITEM_ONE,
          {
            input: {
              name: "附件不合法",
              attachment: { ...ATTACHMENT_INPUT, ...override },
            },
          },
          { accessToken: operator.token },
        );
        expect(result.errors?.[0]?.extensions).toMatchObject({
          code: "VALIDATION_FAILED",
          fields: ["attachment"],
        });
      },
    );
  });

  describe("編輯", () => {
    it("缺席 = 不動、null = 清空(GQL-06);稽核只記有變的欄位", async () => {
      const item = await createItem(api, operator.token, {
        name: "待編輯",
        category: "drink",
        note: "原本的備註",
        coverPath: COVER_PATH,
      });
      const result = await api.graphql<MutationData>(
        UPDATE_DEMO_ITEM_ONE,
        { input: { id: item.id, name: "改過的名稱", note: null } },
        { accessToken: operator.token },
      );
      expect(result.errors).toBeUndefined();
      const updated = result.data?.updateDemoItemOne?.item;
      expect(updated).toMatchObject({
        name: "改過的名稱",
        note: null,
        // 缺席的欄位原封不動
        category: "drink",
        coverPath: COVER_PATH,
      });

      const audit = await latestAudit(
        connection,
        "demo-item-one.edit",
        item.id,
      );
      expect(audit?.before).toEqual({ name: "待編輯", note: "原本的備註" });
      expect(audit?.after).toEqual({ name: "改過的名稱", note: null });
    });

    it("附件:換檔 = 四欄一起換、null = 四欄一起清;稽核只記路徑", async () => {
      const item = await createItem(api, operator.token, {
        name: "換附件",
        attachment: ATTACHMENT_INPUT,
      });
      const replacement = {
        path: "demo/77777777-8888-4999-8aaa-bbbbbbbbbbbb.pdf",
        name: "新版合約.pdf",
        size: 2048,
        contentType: "application/pdf",
      };
      const replaced = await api.graphql<MutationData>(
        UPDATE_DEMO_ITEM_ONE,
        { input: { id: item.id, attachment: replacement } },
        { accessToken: operator.token },
      );
      expect(replaced.errors).toBeUndefined();
      expect(replaced.data?.updateDemoItemOne?.item.attachment).toEqual(
        replacement,
      );
      const replaceAudit = await latestAudit(
        connection,
        "demo-item-one.edit",
        item.id,
      );
      expect(replaceAudit?.before).toEqual({ attachmentPath: ATTACHMENT_PATH });
      expect(replaceAudit?.after).toEqual({ attachmentPath: replacement.path });

      // 缺席 = 不動
      const untouched = await api.graphql<MutationData>(
        UPDATE_DEMO_ITEM_ONE,
        { input: { id: item.id, note: "只改備註" } },
        { accessToken: operator.token },
      );
      expect(untouched.data?.updateDemoItemOne?.item.attachment).toEqual(
        replacement,
      );

      const cleared = await api.graphql<MutationData>(
        UPDATE_DEMO_ITEM_ONE,
        { input: { id: item.id, attachment: null } },
        { accessToken: operator.token },
      );
      expect(cleared.errors).toBeUndefined();
      expect(cleared.data?.updateDemoItemOne?.item.attachment).toBeNull();
      const stored = await connection
        .collection("demo_items_one")
        .findOne({ _id: new Types.ObjectId(item.id) });
      expect(stored).not.toHaveProperty("attachmentPath");
      expect(stored).not.toHaveProperty("attachmentName");
      expect(stored).not.toHaveProperty("attachmentSize");
      expect(stored).not.toHaveProperty("attachmentContentType");
    });

    it("名稱沒變就不進稽核的 before / after(只記真的有動的欄位)", async () => {
      const item = await createItem(api, operator.token, { name: "沒變" });
      await api.graphql(
        UPDATE_DEMO_ITEM_ONE,
        { input: { id: item.id, name: "沒變", status: "PUBLISHED" } },
        { accessToken: operator.token },
      );
      const audit = await latestAudit(
        connection,
        "demo-item-one.edit",
        item.id,
      );
      expect(audit?.after).toEqual({ status: "published" });
    });

    it("編輯時分類同樣要在合併範圍內", async () => {
      const item = await createItem(api, operator.token, { name: "改分類" });
      const result = await api.graphql(
        UPDATE_DEMO_ITEM_ONE,
        { input: { id: item.id, category: "tenant-b-only" } },
        { accessToken: operator.token },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["category"],
      });
    });

    it("不存在的 id → NOT_FOUND", async () => {
      const result = await api.graphql(
        UPDATE_DEMO_ITEM_ONE,
        {
          input: { id: "ffffffffffffffffffffffff", name: "不存在" },
        },
        { accessToken: operator.token },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("刪除與停用", () => {
    it("刪除是軟刪除:之後查不到,稽核記 demo-item-one.delete", async () => {
      const item = await createItem(api, operator.token, { name: "要刪的" });
      const result = await api.graphql<{
        deleteDemoItemOne: { success: boolean; deletedId: string };
      }>(
        DELETE_DEMO_ITEM_ONE,
        { input: { id: item.id } },
        { accessToken: operator.token },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.deleteDemoItemOne).toEqual({
        success: true,
        deletedId: item.id,
      });

      const after = await api.graphql<ItemData>(
        DEMO_ITEM_ONE,
        { id: item.id },
        { accessToken: operator.token },
      );
      expect(after.errors?.[0]?.extensions).toMatchObject({
        code: "NOT_FOUND",
      });

      const audit = await latestAudit(
        connection,
        "demo-item-one.delete",
        item.id,
      );
      expect(audit?.before).toEqual({ name: "要刪的" });
      // 資料仍在(ADR-0007 軟刪除),只是被標記
      const raw = await connection
        .collection("demo_items_one")
        .findOne<{ deletedAt: Date | null }>({ name: "要刪的" });
      expect(raw?.deletedAt).toBeInstanceOf(Date);
    });

    it("setDemoItemOneEnabled 切換並記稽核 demo-item-one.toggle-enabled", async () => {
      const item = await createItem(api, operator.token, { name: "要停用的" });
      const result = await api.graphql<MutationData>(
        SET_DEMO_ITEM_ONE_ENABLED,
        { input: { id: item.id, enabled: false } },
        { accessToken: operator.token },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.setDemoItemOneEnabled?.item.enabled).toBe(false);

      const audit = await latestAudit(
        connection,
        "demo-item-one.toggle-enabled",
        item.id,
      );
      expect(audit?.before).toEqual({ enabled: true });
      expect(audit?.after).toEqual({ enabled: false });
    });
  });

  describe("清單(分頁形狀、篩選)", () => {
    let listOrg: Types.ObjectId;
    let lister: SampleOneOperator;

    beforeAll(async () => {
      // 另開一個組織,才不會被前面測試建的資料干擾
      listOrg = await createOrg(connection, { name: "清單用組織" });
      lister = await createSampleOneOperator(api, connection, {
        orgId: listOrg,
      });
      await createItem(api, lister.token, {
        name: "蛋餅",
        category: "staple",
        note: "早餐",
      });
      await createItem(api, lister.token, {
        name: "豆漿",
        category: "drink",
        note: "熱的",
      });
      const off = await createItem(api, lister.token, { name: "停售品" });
      await api.graphql(
        SET_DEMO_ITEM_ONE_ENABLED,
        { input: { id: off.id, enabled: false } },
        { accessToken: lister.token },
      );
    }, HOOK_TIMEOUT_MS);

    it("回 items / totalCount / page / pageSize(GQL-03 的全站形狀)", async () => {
      const payload = await listItems(api, lister.token, {
        page: 1,
        pageSize: 2,
      });
      expect(payload.totalCount).toBe(3);
      expect(payload.page).toBe(1);
      expect(payload.pageSize).toBe(2);
      expect(payload.items).toHaveLength(2);
    });

    it("keyword 比對名稱與備註", async () => {
      await expect(
        listNames(api, lister.token, { keyword: "豆" }),
      ).resolves.toEqual(["豆漿"]);
      await expect(
        listNames(api, lister.token, { keyword: "早餐" }),
      ).resolves.toEqual(["蛋餅"]);
    });

    it("category 與 enabled 各自收窄", async () => {
      await expect(
        listNames(api, lister.token, { category: "drink" }),
      ).resolves.toEqual(["豆漿"]);
      await expect(
        listNames(api, lister.token, { enabled: false }),
      ).resolves.toEqual(["停售品"]);
    });

    it("建立者查不到那位使用者時回 null,不拋錯(seed 示範資料的假 ObjectId)", async () => {
      const ghostOrg = await createOrg(connection, { name: "幽靈建立者組織" });
      const now = new Date();
      await connection.collection("demo_items_one").insertOne({
        orgId: ghostOrg,
        name: "沒有建立者的項目",
        status: "draft",
        enabled: true,
        createdAt: now,
        updatedAt: now,
        // 不存在的使用者(seed 的示範資料就長這樣)
        createdBy: new Types.ObjectId(),
        updatedBy: null,
        deletedAt: null,
      });
      const ghostViewer = await createSampleOneOperator(api, connection, {
        orgId: ghostOrg,
        permissionKeys: [P.view],
      });
      const payload = await listItems(api, ghostViewer.token);
      expect(payload.items).toHaveLength(1);
      expect(payload.items[0]?.createdBy).toBeNull();
    });

    it("abilities 依操作者的權限算好:只有 view 的人 canEdit / canDelete 皆 false", async () => {
      const viewer = await createSampleOneOperator(api, connection, {
        orgId: listOrg,
        permissionKeys: [P.view],
      });
      const payload = await listItems(api, viewer.token);
      expect(payload.items[0]?.abilities).toEqual({
        canEdit: false,
        canDelete: false,
        canEditInternalNote: false,
      });
    });
  });
});
