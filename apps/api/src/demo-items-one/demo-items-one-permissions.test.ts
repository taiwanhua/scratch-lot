import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { Connection, Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg } from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import {
  ATTACHMENT_INPUT,
  ATTACHMENT_PATH,
  type AttachmentUrlData,
  CREATE_DEMO_ITEM_ONE,
  DEMO_ITEM_ONE,
  DEMO_ITEM_ONE_ATTACHMENT_URL,
  DEMO_ITEM_ONE_HISTORY,
  EDIT_PAGE_MODULE,
  type HistoryData,
  type ItemData,
  type ItemRow,
  type MutationData,
  P,
  SAMPLE_ONE_MODULES,
  type SampleOneOperator,
  UPDATE_DEMO_ITEM_ONE,
  createItem,
  createSampleOneOperator,
  listItems,
} from "./test-support/fixtures";

const INTERNAL = "只給內部看的備註";

/**
 * 示範模組1 的欄位級權限、頁面自有權限與雙路檔案。
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07);
 * `docs/testing/permission-scenarios.md` 劇本 5(欄位級,綁父)、6(頁面自有權限)、
 * 7 的 API 那一半(綁了頁但沒有 create 權限 → 送出被擋)、11(儲存雙路)。
 *
 * 全部操作者都在同一個組織裡 —— 這幾條驗的是**權限**,不是範圍(範圍見 scope 測試)。
 */
describe("示範模組1 權限(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let org: Types.ObjectId;

  /** 全部權限 + 編輯頁的變更歷程。 */
  let full: SampleOneOperator;
  /** 只有 view:內部備註看不到。 */
  let viewer: SampleOneOperator;
  /** view + edit + show-internal-note,但**沒有** edit-internal-note:唯讀。 */
  let readOnlyNote: SampleOneOperator;
  /** view + edit,但沒有 create。 */
  let noCreate: SampleOneOperator;
  /** 只有 edit(沒有 view):拿不到附件下載網址。 */
  let noView: SampleOneOperator;

  let item: ItemRow;

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-demo-one-permissions");
    connection = api.connection;
    org = await createOrg(connection, { name: "權限測試租戶" });

    full = await createSampleOneOperator(api, connection, {
      orgId: org,
      moduleKeys: [...SAMPLE_ONE_MODULES, EDIT_PAGE_MODULE],
      permissionKeys: [
        P.view,
        P.create,
        P.edit,
        P.delete,
        P.showInternalNote,
        P.editInternalNote,
        P.showHistory,
      ],
    });
    viewer = await createSampleOneOperator(api, connection, {
      orgId: org,
      permissionKeys: [P.view],
    });
    readOnlyNote = await createSampleOneOperator(api, connection, {
      orgId: org,
      permissionKeys: [P.view, P.edit, P.showInternalNote],
    });
    noCreate = await createSampleOneOperator(api, connection, {
      orgId: org,
      permissionKeys: [P.view, P.edit],
    });
    noView = await createSampleOneOperator(api, connection, {
      orgId: org,
      permissionKeys: [P.edit],
    });

    item = await createItem(api, full.token, {
      name: "有內部備註的項目",
      internalNote: INTERNAL,
      attachment: ATTACHMENT_INPUT,
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  async function fetchItem(token: string, id = item.id): Promise<ItemRow> {
    const result = await api.graphql<ItemData>(
      DEMO_ITEM_ONE,
      { id },
      { accessToken: token },
    );
    expect(result.errors).toBeUndefined();
    if (!result.data) {
      throw new Error("demoItemOne 沒有回資料");
    }
    return result.data.demoItemOne.item;
  }

  describe("劇本 5:欄位級權限(內部備註,綁父模組)", () => {
    it("無 show-internal-note → 單筆與列表的 internalNote 一律缺席(值不外流)", async () => {
      const single = await fetchItem(viewer.token);
      expect(single.internalNote).toBeNull();
      const payload = await listItems(api, viewer.token);
      const listed = payload.items.find((row) => row.id === item.id);
      expect(listed?.internalNote).toBeNull();
      // 資料庫裡確實有值 —— 缺席是投影的結果,不是沒填
      const raw = await connection
        .collection("demo_items_one")
        .findOne<{ internalNote?: string }>({ name: "有內部備註的項目" });
      expect(raw?.internalNote).toBe(INTERNAL);
    });

    it("有 show 無 edit → 看得到值,但 abilities.canEditInternalNote 為 false", async () => {
      const seen = await fetchItem(readOnlyNote.token);
      expect(seen.internalNote).toBe(INTERNAL);
      expect(seen.abilities).toMatchObject({
        canEdit: true,
        canEditInternalNote: false,
      });
    });

    it("有 show 無 edit 的人硬送寫入 → FORBIDDEN,reason FIELD_FORBIDDEN", async () => {
      const result = await api.graphql(
        UPDATE_DEMO_ITEM_ONE,
        { input: { id: item.id, internalNote: "偷改" } },
        { accessToken: readOnlyNote.token },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
        reason: "FIELD_FORBIDDEN",
      });
      const unchanged = await fetchItem(readOnlyNote.token);
      expect(unchanged.internalNote).toBe(INTERNAL);
    });

    it("送 null 想清空也一樣被擋(缺席才是「不動」,GQL-06)", async () => {
      const result = await api.graphql(
        UPDATE_DEMO_ITEM_ONE,
        { input: { id: item.id, internalNote: null } },
        { accessToken: readOnlyNote.token },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
        reason: "FIELD_FORBIDDEN",
      });
    });

    it("新增時硬送也擋(create / update 同一條規則)", async () => {
      const result = await api.graphql(
        CREATE_DEMO_ITEM_ONE,
        { input: { name: "硬塞內部備註", internalNote: "x" } },
        { accessToken: noCreate.token },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("持有 edit-internal-note 者寫得進去", async () => {
      const result = await api.graphql<MutationData>(
        UPDATE_DEMO_ITEM_ONE,
        { input: { id: item.id, internalNote: "改過的內部備註" } },
        { accessToken: full.token },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.updateDemoItemOne?.item.internalNote).toBe(
        "改過的內部備註",
      );
    });
  });

  describe("劇本 6:頁面自有權限(變更歷程)與編輯功能互相獨立", () => {
    it("無 edit-page.show-history → 歷程 FORBIDDEN,但編輯照常成功", async () => {
      const history = await api.graphql(
        DEMO_ITEM_ONE_HISTORY,
        { id: item.id },
        { accessToken: noCreate.token },
      );
      expect(history.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
      });

      const edit = await api.graphql<MutationData>(
        UPDATE_DEMO_ITEM_ONE,
        { input: { id: item.id, note: "沒有歷程權限也編得動" } },
        { accessToken: noCreate.token },
      );
      expect(edit.errors).toBeUndefined();
      expect(edit.data?.updateDemoItemOne?.item.note).toBe(
        "沒有歷程權限也編得動",
      );
    });

    it("有 show-history → 讀得到 audit_logs,新到舊,帶執行者", async () => {
      const result = await api.graphql<HistoryData>(
        DEMO_ITEM_ONE_HISTORY,
        { id: item.id },
        { accessToken: full.token },
      );
      expect(result.errors).toBeUndefined();
      const rows = result.data?.demoItemOneHistory.items ?? [];
      expect(rows.length).toBeGreaterThan(1);
      expect(rows.at(-1)?.action).toBe("demo-item-one.create");
      expect(rows.at(-1)?.actor).toEqual({
        id: String(full.userId),
        name: full.account,
      });
      expect(result.data?.demoItemOneHistory.totalCount).toBe(rows.length);
    });

    it("歷程不外洩內部備註的內容(只記「動過」)", async () => {
      const result = await api.graphql<HistoryData>(
        DEMO_ITEM_ONE_HISTORY,
        { id: item.id },
        { accessToken: full.token },
      );
      const noteEdits = (result.data?.demoItemOneHistory.items ?? []).filter(
        (row) => row.after?.internalNote !== undefined,
      );
      expect(noteEdits.length).toBeGreaterThan(0);
      for (const row of noteEdits) {
        expect(row.after?.internalNote).toBe("[redacted]");
      }
      const serialized = JSON.stringify(result.data);
      expect(serialized).not.toContain(INTERNAL);
      expect(serialized).not.toContain("改過的內部備註");
    });
  });

  describe("劇本 7(API 那一半):沒有 create 權限,硬送就被擋", () => {
    it("createDemoItemOne → FORBIDDEN", async () => {
      const result = await api.graphql(
        CREATE_DEMO_ITEM_ONE,
        { input: { name: "沒有新增權限" } },
        { accessToken: noCreate.token },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("劇本 11:儲存雙路(封面公開 / 附件私有簽名)", () => {
    it("有 view → demoItemOneAttachmentUrl 回一個短效讀取網址", async () => {
      const result = await api.graphql<AttachmentUrlData>(
        DEMO_ITEM_ONE_ATTACHMENT_URL,
        { id: item.id },
        { accessToken: viewer.token },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.demoItemOneAttachmentUrl.url).toContain(
        ATTACHMENT_PATH,
      );
      expect(result.data?.demoItemOneAttachmentUrl.url).toContain(
        "action=read",
      );
    });

    it("無 view → FORBIDDEN(附件不隨編輯權限一起給)", async () => {
      const result = await api.graphql(
        DEMO_ITEM_ONE_ATTACHMENT_URL,
        { id: item.id },
        { accessToken: noView.token },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("這筆沒有附件 → NOT_FOUND", async () => {
      const bare = await createItem(api, full.token, { name: "沒有附件" });
      const result = await api.graphql(
        DEMO_ITEM_ONE_ATTACHMENT_URL,
        { id: bare.id },
        { accessToken: viewer.token },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("看不到這筆資料的人(別的租戶)→ NOT_FOUND,不透露它存在", async () => {
      const otherOrg = await createOrg(connection, { name: "別的租戶" });
      const outsider = await createSampleOneOperator(api, connection, {
        orgId: otherOrg,
        permissionKeys: [P.view],
      });
      const result = await api.graphql(
        DEMO_ITEM_ONE_ATTACHMENT_URL,
        { id: item.id },
        { accessToken: outsider.token },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });
});
