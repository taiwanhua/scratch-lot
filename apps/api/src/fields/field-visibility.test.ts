import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg } from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import {
  type CreateFieldData,
  type FieldRow,
  SET_FIELD_ENABLED,
  UPDATE_FIELD,
  createField,
  createFieldManager,
  customOf,
  findCategoryId,
  listFields,
  login,
} from "./test-support/fixtures";

/** 合併清單裡的一列（找不到即測試前提壞了，直接拋）。 */
function rowOf(rows: FieldRow[], value: string): FieldRow {
  const found = rows.find((row) => row.value === value);
  if (!found) {
    throw new Error(`合併清單裡找不到 ${value}`);
  }
  return found;
}

/**
 * 可見範圍的規則表(正本 `docs/modules/field-manager.md`):
 *
 * **看得到 = 全域 + 我的上層(一路到租戶頂層,不受可見性開關影響)+ 自己
 * + 我可見範圍內的下層;只能編輯 / 停用自己這一層加的。**
 *
 * 組織樹(root 為 seed 建的根組織):
 * ```
 * root ─ 好食公司(租戶頂層,可見性開關掛這裡)─┬─ 南港店 ─ 子南港店
 *                                              └─ 信義店
 * ```
 * 每一層各加一筆 order 相同的自訂選項,順便驗「同 order 依組織深度排序」。
 */
describe("欄位選項的可見範圍:全域 + 上層繼承 + 可見範圍內的下層", () => {
  let api: AuthTestApp;
  let connection: Connection;

  let tenantTop: Types.ObjectId;
  let branch: Types.ObjectId;
  let subBranch: Types.ObjectId;
  let sibling: Types.ObjectId;
  let demoCategoryId: Types.ObjectId;

  let topToken: string;
  let branchToken: string;
  let subBranchToken: string;
  let siblingToken: string;
  let rootToken: string;

  /** 各層自訂選項的 id(NOT_OWNER 的斷言要用)。 */
  const optionIds: Record<string, string> = {};

  /** 可見性開關掛在租戶頂層、套用整棵子樹(ADR-0005);每次請求重算,不必重新登入。 */
  async function setVisibility(value: "own" | "subtree"): Promise<void> {
    await connection
      .collection("orgs")
      .updateOne(
        { _id: tenantTop },
        { $set: { "settings.visibility": value } },
      );
  }

  /** 在某一層加一筆自訂選項,回傳 id;order 一律 4,讓深度成為唯一的次要排序鍵。 */
  async function addOption(
    token: string,
    label: string,
    value: string,
  ): Promise<string> {
    const result = await createField(api, token, {
      categoryId: String(demoCategoryId),
      label,
      value,
      order: 4,
    });
    expect(result.errors).toBeUndefined();
    const id = (result.data as CreateFieldData | null)?.createField.field.id;
    if (id === undefined) {
      throw new Error(`新增自訂選項失敗:${label}`);
    }
    optionIds[value] = id;
    return id;
  }

  /** 合併清單裡的自訂選項:value → 來源組織名稱。 */
  async function customSourcesOf(
    token: string,
  ): Promise<Record<string, string>> {
    const rows = await listFields(api, token, demoCategoryId);
    return Object.fromEntries(
      customOf(rows).map((row) => [row.value, row.ownerOrg?.name ?? ""]),
    );
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-field-visibility");
    connection = api.connection;
    await connection
      .collection("fields")
      .createIndex({ categoryId: 1, orgId: 1, value: 1 }, { unique: true });

    tenantTop = await createOrg(connection, {
      name: "好食公司",
      settings: { visibility: "subtree" },
    });
    branch = await createOrg(connection, {
      name: "南港店",
      parentId: tenantTop,
    });
    subBranch = await createOrg(connection, {
      name: "子南港店",
      parentId: branch,
    });
    sibling = await createOrg(connection, {
      name: "信義店",
      parentId: tenantTop,
    });
    demoCategoryId = await findCategoryId(connection, "demo-category");

    topToken = await createFieldManager(api, connection, tenantTop);
    branchToken = await createFieldManager(api, connection, branch);
    subBranchToken = await createFieldManager(api, connection, subBranch);
    siblingToken = await createFieldManager(api, connection, sibling);
    rootToken = await login(api, ROOT_ADMIN.account, ROOT_ADMIN.password);

    // 建立順序決定同深度的排序(信義店與南港店同深度)
    await addOption(topToken, "甜點", "dessert");
    await addOption(branchToken, "炸物", "fried");
    await addOption(siblingToken, "小點", "snack");
    await addOption(subBranchToken, "湯品", "soup");
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("規則表六列", () => {
    it("root:看得到全部租戶的自訂,一筆都不是自己加的", async () => {
      const sources = await customSourcesOf(rootToken);
      expect(sources).toEqual({
        dessert: "好食公司",
        fried: "南港店",
        snack: "信義店",
        soup: "子南港店",
      });
      const rows = await listFields(api, rootToken, demoCategoryId);
      expect(customOf(rows).every((row) => !row.isOwn && !row.canEdit)).toBe(
        true,
      );
      // 種子選項的全域開關只有根組織切得動
      expect(rowOf(rows, "staple").canToggleEnabled).toBe(true);
    });

    it("好食公司(可見範圍 = 子樹):看得到整棵樹,只編輯得了自己加的", async () => {
      const rows = await listFields(api, topToken, demoCategoryId);
      expect(customOf(rows).map((row) => row.value)).toEqual([
        "dessert",
        "fried",
        "snack",
        "soup",
      ]);
      expect(rowOf(rows, "dessert")).toMatchObject({
        isOwn: true,
        canEdit: true,
        canToggleEnabled: true,
        ownerOrg: { name: "好食公司" },
      });
      // 下層加的看得到,但改不動
      expect(rowOf(rows, "fried")).toMatchObject({
        isOwn: false,
        canEdit: false,
        canToggleEnabled: false,
      });
    });

    it("南港店(可見範圍 = 子樹):好食公司 + 南港店 + 子南港店,看不到信義店", async () => {
      const sources = await customSourcesOf(branchToken);
      expect(sources).toEqual({
        dessert: "好食公司",
        fried: "南港店",
        soup: "子南港店",
      });
      const rows = await listFields(api, branchToken, demoCategoryId);
      // 上層加的看得到、但灰掉;自己加的才可編輯
      expect(rowOf(rows, "dessert")).toMatchObject({
        isOwn: false,
        canEdit: false,
        canToggleEnabled: false,
      });
      expect(rowOf(rows, "fried")).toMatchObject({
        isOwn: true,
        canEdit: true,
        canToggleEnabled: true,
      });
    });

    it("南港店(可見範圍 = 僅本組織):下層的湯品不見了,上層的甜點還在", async () => {
      await setVisibility("own");
      try {
        const sources = await customSourcesOf(branchToken);
        expect(sources).toEqual({
          dessert: "好食公司",
          fried: "南港店",
        });
      } finally {
        await setVisibility("subtree");
      }
    });

    it("子南港店:兩層上層都看得到,只有自己加的可編輯", async () => {
      const sources = await customSourcesOf(subBranchToken);
      expect(sources).toEqual({
        dessert: "好食公司",
        fried: "南港店",
        soup: "子南港店",
      });
      const rows = await listFields(api, subBranchToken, demoCategoryId);
      expect(rowOf(rows, "soup").canEdit).toBe(true);
      expect(rowOf(rows, "fried").canEdit).toBe(false);
    });

    it("信義店:好食公司 + 自己;看不到南港店那一支(兄弟不是上層也不是下層)", async () => {
      const sources = await customSourcesOf(siblingToken);
      expect(sources).toEqual({
        dessert: "好食公司",
        snack: "信義店",
      });
    });
  });

  describe("排序", () => {
    it("依 order 再依組織深度:全域最前,同 order 時上層排在下層之前", async () => {
      const rows = await listFields(api, topToken, demoCategoryId);
      expect(rows.map((row) => row.value)).toEqual([
        "staple",
        "side-dish",
        "drink",
        // 同 order = 4,依深度:好食公司 → 南港店 / 信義店(同深度依建立順序)→ 子南港店
        "dessert",
        "fried",
        "snack",
        "soup",
      ]);
    });
  });

  describe("只能改自己這一層加的(NOT_OWNER)", () => {
    it("南港店改上層(好食公司)的選項 → FORBIDDEN / NOT_OWNER", async () => {
      const result = await api.graphql(
        UPDATE_FIELD,
        { input: { id: optionIds.dessert, label: "被下層改" } },
        { accessToken: branchToken },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
        reason: "NOT_OWNER",
      });
    });

    it("南港店停用上層的選項 → FORBIDDEN / NOT_OWNER", async () => {
      const result = await api.graphql(
        SET_FIELD_ENABLED,
        { input: { id: optionIds.dessert, enabled: false } },
        { accessToken: branchToken },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
        reason: "NOT_OWNER",
      });
    });

    it("好食公司改下層(南港店)的選項 → FORBIDDEN / NOT_OWNER(看得到不等於改得動)", async () => {
      const result = await api.graphql(
        UPDATE_FIELD,
        { input: { id: optionIds.fried, label: "被上層改" } },
        { accessToken: topToken },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
        reason: "NOT_OWNER",
      });
    });

    it("看不到的那一筆仍是 NOT_FOUND(不透露它存在)", async () => {
      const result = await api.graphql(
        UPDATE_FIELD,
        { input: { id: optionIds.snack, label: "被別支改" } },
        { accessToken: branchToken },
      );
      expect(result.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
    });
  });

  describe("value 不可與上層繼承鏈重複", () => {
    it("與上層組織的自訂同 value → FIELD_VALUE_DUPLICATE", async () => {
      const result = await createField(api, branchToken, {
        categoryId: String(demoCategoryId),
        label: "甜點(南港店)",
        value: "dessert",
      });
      expect(result.errors?.[0]?.extensions?.code).toBe(
        "FIELD_VALUE_DUPLICATE",
      );
    });

    it("與同類別的全域種子同 value → FIELD_VALUE_DUPLICATE", async () => {
      const result = await createField(api, subBranchToken, {
        categoryId: String(demoCategoryId),
        label: "主食(子南港店)",
        value: "staple",
      });
      expect(result.errors?.[0]?.extensions?.code).toBe(
        "FIELD_VALUE_DUPLICATE",
      );
    });

    it("與旁支 / 下層的自訂同 value 不算重複(繼承鏈只往上看)", async () => {
      const result = await createField(api, siblingToken, {
        categoryId: String(demoCategoryId),
        label: "炸物(信義店)",
        value: "fried",
      });
      expect(result.errors).toBeUndefined();
      expect(
        (result.data as CreateFieldData | null)?.createField.field,
      ).toMatchObject({ isOwn: true, ownerOrg: { name: "信義店" } });
    });
  });
});
