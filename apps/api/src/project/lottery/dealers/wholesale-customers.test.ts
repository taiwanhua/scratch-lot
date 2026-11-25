import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { LOTTERY_WHOLESALE_CUSTOMERS_COLLECTION } from "../../database/lottery-dealers/lottery-wholesale-customer.schema";
import {
  KEYS,
  P,
  dealersToken,
  errorOf,
  nextLicenseNo,
  ok,
  seedDealersAuthorization,
} from "./test-support/dealers-fixtures";
import { WholesaleCustomerDocuments } from "./wholesale-customer-documents";

interface CustomerRow {
  id: string;
  storeName: string;
  licenseNo: string | null;
  contactName: string | null;
  phone: string | null;
  status: string;
  note: string | null;
  lastWholesaleAt: string | null;
  ownerOrgName: string | null;
  shareOrgs: { orgId: string; includeDescendants: boolean }[];
  isShared: boolean;
  abilities: { canEdit: boolean };
}

interface SameName {
  id: string;
  storeName: string;
  phone: string | null;
}

const FIELDS = /* GraphQL */ `
  fragment TestCustomerFields on LotteryWholesaleCustomer {
    id
    storeName
    licenseNo
    contactName
    phone
    status
    note
    lastWholesaleAt
    ownerOrgName
    shareOrgs {
      orgId
      includeDescendants
    }
    isShared
    abilities {
      canEdit
    }
  }
`;
const CREATE = /* GraphQL */ `
  ${FIELDS}
  mutation TestCreate($input: CreateLotteryWholesaleCustomerInput!) {
    createLotteryWholesaleCustomer(input: $input) {
      item {
        ...TestCustomerFields
      }
    }
  }
`;
const UPDATE = /* GraphQL */ `
  ${FIELDS}
  mutation TestUpdate($input: UpdateLotteryWholesaleCustomerInput!) {
    updateLotteryWholesaleCustomer(input: $input) {
      item {
        ...TestCustomerFields
      }
    }
  }
`;
const DELETE = /* GraphQL */ `
  mutation TestDelete($input: DeleteLotteryWholesaleCustomerInput!) {
    deleteLotteryWholesaleCustomer(input: $input) {
      success
      deletedId
    }
  }
`;
const ONE = /* GraphQL */ `
  ${FIELDS}
  query TestOne($id: ID!) {
    lotteryWholesaleCustomer(id: $id) {
      item {
        ...TestCustomerFields
      }
    }
  }
`;
const LIST = /* GraphQL */ `
  ${FIELDS}
  query TestList($input: LotteryWholesaleCustomersInput!) {
    lotteryWholesaleCustomers(input: $input) {
      items {
        ...TestCustomerFields
      }
      totalCount
    }
  }
`;
const SAME_NAMES = /* GraphQL */ `
  query TestSameNames($input: LotteryWholesaleCustomerSameNamesInput!) {
    lotteryWholesaleCustomerSameNames(input: $input) {
      items {
        id
        storeName
        phone
      }
    }
  }
`;

const NOT_FOUND = { code: "NOT_FOUND" };
const FORBIDDEN = { code: "FORBIDDEN" };

describe("批售客戶(專案規格 21.2)", () => {
  let api: AuthTestApp;
  let tenantId: Types.ObjectId;
  let branchA: Types.ObjectId;
  let branchB: Types.ObjectId;
  let otherTenant: Types.ObjectId;
  /** 總部管理:全部。 */
  let hq: string;
  /** 店長(中山店 / 信義店):綁分頁,沒有新增 / 編輯。 */
  let managerA: string;
  let managerB: string;
  /** 信義店,有編輯權限(驗共用進來的只能看)。 */
  let editorB: string;
  /** 總部,只有新增。 */
  let creatorOnly: string;
  /** 綁了經銷商管理、沒綁批售客戶分頁。 */
  let dealersOnly: string;
  let otherHq: string;

  beforeAll(async () => {
    api = await startAuthTestApp("lottery_wholesale_customers_test");
    const { connection } = api;
    await seedDealersAuthorization(connection);
    // 總部看全部(含下層分店建的)
    tenantId = await createOrg(connection, {
      name: "好運彩券行",
      settings: { visibility: "subtree" },
    });
    branchA = await createOrg(connection, {
      name: "中山店",
      parentId: tenantId,
    });
    branchB = await createOrg(connection, {
      name: "信義店",
      parentId: tenantId,
    });
    otherTenant = await createOrg(connection, { name: "別家彩券行" });
    const tab = [KEYS.list, KEYS.wholesaleCustomers];
    const token = (
      orgId: Types.ObjectId,
      permissionKeys: readonly string[],
      moduleKeys: readonly string[] = tab,
      ownerOrgId: Types.ObjectId = tenantId,
    ) =>
      dealersToken(api, connection, {
        orgId,
        ownerOrgId,
        moduleKeys,
        permissionKeys,
      });
    hq = await token(tenantId, [P.wholesaleAll]);
    managerA = await token(branchA, []);
    managerB = await token(branchB, []);
    editorB = await token(branchB, [P.wholesaleAll]);
    creatorOnly = await token(tenantId, [P.wholesaleCreate]);
    dealersOnly = await token(tenantId, [P.all], [KEYS.list, KEYS.contacts]);
    otherHq = await token(otherTenant, [P.wholesaleAll], tab, otherTenant);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  const create = async (
    extra: Record<string, unknown> = {},
    token = hq,
  ): Promise<CustomerRow> => {
    const data = await ok<{
      createLotteryWholesaleCustomer: { item: CustomerRow };
    }>(api, token, CREATE, { input: { storeName: "好運彩券行", ...extra } });
    return data.createLotteryWholesaleCustomer.item;
  };
  const update = async (
    input: Record<string, unknown>,
    token = hq,
  ): Promise<CustomerRow> => {
    const data = await ok<{
      updateLotteryWholesaleCustomer: { item: CustomerRow };
    }>(api, token, UPDATE, { input });
    return data.updateLotteryWholesaleCustomer.item;
  };
  const remove = (id: string) => ok(api, hq, DELETE, { input: { id } });
  const one = async (id: string, token = hq): Promise<CustomerRow> => {
    const data = await ok<{ lotteryWholesaleCustomer: { item: CustomerRow } }>(
      api,
      token,
      ONE,
      { id },
    );
    return data.lotteryWholesaleCustomer.item;
  };
  const oneError = (id: string, token: string) =>
    errorOf(api, token, ONE, { id });
  const listIds = async (input: Record<string, unknown>): Promise<string[]> => {
    const data = await ok<{
      lotteryWholesaleCustomers: { items: CustomerRow[] };
    }>(api, hq, LIST, { input });
    return data.lotteryWholesaleCustomers.items.map((row) => row.id);
  };
  const sameNames = async (
    input: Record<string, unknown>,
    token = hq,
  ): Promise<SameName[]> => {
    const data = await ok<{
      lotteryWholesaleCustomerSameNames: { items: SameName[] };
    }>(api, token, SAME_NAMES, { input });
    return data.lotteryWholesaleCustomerSameNames.items;
  };
  const createError = (input: Record<string, unknown>, token = hq) =>
    errorOf(api, token, CREATE, { input: { storeName: "測試", ...input } });
  const updateError = (input: Record<string, unknown>, token = hq) =>
    errorOf(api, token, UPDATE, { input });
  const deleteError = (id: string, token = hq) =>
    errorOf(api, token, DELETE, { input: { id } });
  const storedLabel = async (storeName: string): Promise<unknown> => {
    const stored = await api.connection
      .collection(LOTTERY_WHOLESALE_CUSTOMERS_COLLECTION)
      .findOne<{ label: string }>({ storeName });
    return stored?.label;
  };

  describe("新增 / 編輯 / 刪除", () => {
    it("只填店名就能新增:預設往來中、最近一次批售日無紀錄、所屬組織 = 建立時的組織", async () => {
      const row = await create({ storeName: "  最少欄位行 " });
      expect(row).toMatchObject({
        storeName: "最少欄位行",
        licenseNo: null,
        status: "ACTIVE",
        lastWholesaleAt: null,
        ownerOrgName: "好運彩券行",
        shareOrgs: [],
        isShared: false,
        abilities: { canEdit: true },
      });
    });

    it.each([
      ["店名空白", { storeName: " " }, ["storeName"]],
      ["店名超過 30 字", { storeName: "店".repeat(31) }, ["storeName"]],
      ["證號不是 8 碼數字", { licenseNo: "1234567" }, ["licenseNo"]],
      ["聯絡人超過 10 字", { contactName: "人".repeat(11) }, ["contactName"]],
      ["電話有非數字", { phone: "02-12345678" }, ["phone"]],
      ["電話超過 15 字", { phone: "1".repeat(16) }, ["phone"]],
      ["地址超過 60 字", { address: "路".repeat(61) }, ["address"]],
      ["備註超過 1000 字", { note: "記".repeat(1001) }, ["note"]],
    ])("%s → VALIDATION_FAILED", async (_name, input, fields) => {
      expect(await createError(input)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields,
      });
    });

    it("編輯:缺席 = 不動、null = 清空、店名 null 視同缺席;顯示文字跟著店名與電話", async () => {
      const row = await create({
        storeName: "顯示文字行",
        phone: "0223456789",
        contactName: "林大明",
      });
      expect(await storedLabel("顯示文字行")).toBe("顯示文字行 · 0223456789");
      const edited = await update({
        id: row.id,
        storeName: null,
        phone: null,
        status: "INACTIVE",
      });
      expect(edited).toMatchObject({
        storeName: "顯示文字行",
        phone: null,
        contactName: "林大明",
        status: "INACTIVE",
      });
      expect(await storedLabel("顯示文字行")).toBe("顯示文字行");
    });

    it("每次異動都寫稽核:新增、編輯、刪除", async () => {
      const row = await create({ storeName: "稽核行" });
      await update({ id: row.id, note: "習慣匯款" });
      await remove(row.id);
      const logs = await api.connection
        .collection("audit_logs")
        .find({ targetType: "lottery_wholesale_customer" })
        .toArray();
      const mine = logs.filter((log) => String(log.targetId) === row.id);
      expect(mine.map((log) => String(log.action))).toEqual([
        "lottery-wholesale-customer.create",
        "lottery-wholesale-customer.edit",
        "lottery-wholesale-customer.delete",
      ]);
      expect(mine[1]).toMatchObject({
        before: { note: null },
        after: { note: "習慣匯款" },
      });
    });

    it("沒有被引用可以刪除(軟刪除),刪除後查不到", async () => {
      const row = await create({ storeName: "可刪行" });
      await remove(row.id);
      expect(await oneError(row.id, hq)).toMatchObject(NOT_FOUND);
    });

    it("登記的批售單來源:最近一次批售日照來源回,被引用的不能刪除(WHOLESALE_CUSTOMER_IN_USE)、可以停用", async () => {
      const used = await create({ storeName: "被引用行" });
      const free = await create({ storeName: "沒引用行" });
      const shippedAt = new Date("2026-11-19T06:00:00.000Z");
      api.app.get(WholesaleCustomerDocuments).registerSource({
        lastShippedAt: () => Promise.resolve(new Map([[used.id, shippedAt]])),
        isReferenced: (_operator, _tenantId, id) =>
          Promise.resolve(String(id) === used.id),
      });
      const withDate = await one(used.id);
      expect(withDate.lastWholesaleAt).toBe(shippedAt.toISOString());
      const withoutDate = await one(free.id);
      expect(withoutDate.lastWholesaleAt).toBeNull();
      expect(await deleteError(used.id)).toMatchObject({
        code: "VALIDATION_FAILED",
        reason: "WHOLESALE_CUSTOMER_IN_USE",
        fields: ["id"],
      });
      const stopped = await update({ id: used.id, status: "INACTIVE" });
      expect(stopped.status).toBe("INACTIVE");
      await remove(free.id);
    });
  });

  describe("證號與同名", () => {
    it("證號有填時租戶內不重複(含看不到的);沒填可以很多筆;別租戶、已刪除的不算", async () => {
      const licenseNo = nextLicenseNo();
      const row = await create({ licenseNo });
      await create({ licenseNo: null });
      await create({ licenseNo: null });
      const duplicate = {
        code: "VALIDATION_FAILED",
        reason: "WHOLESALE_LICENSE_NO_DUPLICATE",
        fields: ["licenseNo"],
      };
      expect(await createError({ licenseNo })).toMatchObject(duplicate);
      // 信義店看不到總部建的那一筆,一樣擋
      expect(await createError({ licenseNo }, editorB)).toMatchObject(
        duplicate,
      );
      const other = await create();
      expect(await updateError({ id: other.id, licenseNo })).toMatchObject(
        duplicate,
      );
      // 同一筆不改證號照存
      const same = await update({ id: row.id, note: "x", licenseNo });
      expect(same.note).toBe("x");
      const foreign = await create({ licenseNo }, otherHq);
      expect(foreign.licenseNo).toBe(licenseNo);
      await remove(row.id);
      const again = await create({ licenseNo });
      expect(again.licenseNo).toBe(licenseNo);
    });

    it("資料庫的部分唯一索引:只算有填、未刪除的", async () => {
      const indexes = await api.connection
        .collection(LOTTERY_WHOLESALE_CUSTOMERS_COLLECTION)
        .indexes();
      expect(
        indexes.find((index) => index.key.licenseNo !== undefined),
      ).toMatchObject({
        key: { tenantId: 1, licenseNo: 1 },
        unique: true,
        partialFilterExpression: {
          deletedAt: { $type: "null" },
          licenseNo: { $type: "string" },
        },
      });
    });

    it("同名只提醒、不擋:整個租戶的同名客戶(店名、電話),排除自己、已刪除、別租戶", async () => {
      const first = await create({ storeName: "同名行", phone: "0223456789" });
      const second = await create({ storeName: "同名行" });
      await create({ storeName: "同名行" }, otherHq);
      const removed = await create({ storeName: "同名行" });
      await remove(removed.id);

      const secondRow = { id: second.id, storeName: "同名行", phone: null };
      expect(await sameNames({ storeName: " 同名行 " })).toEqual([
        { id: first.id, storeName: "同名行", phone: "0223456789" },
        secondRow,
      ]);
      expect(
        await sameNames({ storeName: "同名行", excludeId: first.id }),
      ).toEqual([secondRow]);
      // 提醒以租戶為範圍:信義店的人看不到那兩筆,一樣提醒,但不給電話
      expect(await sameNames({ storeName: "同名行" }, editorB)).toEqual([
        { id: first.id, storeName: "同名行", phone: null },
        { ...secondRow, phone: null },
      ]);
      expect(await sameNames({ storeName: "同名" })).toEqual([]);
      expect(await sameNames({ storeName: " " })).toEqual([]);
    });
  });

  describe("清單", () => {
    it("關鍵字比對店名、證號、聯絡人、電話;篩選狀態", async () => {
      const licenseNo = nextLicenseNo();
      const row = await create({
        storeName: "關鍵字甲(總)行",
        licenseNo,
        contactName: "陳志遠",
        phone: "0287654321",
      });
      const stopped = await create({
        storeName: "關鍵字乙行",
        status: "INACTIVE",
      });
      for (const keyword of ["字甲(總)", licenseNo, "志遠", "87654321"]) {
        expect(await listIds({ keyword })).toEqual([row.id]);
      }
      expect(await listIds({ keyword: "關鍵字", status: "ACTIVE" })).toEqual([
        row.id,
      ]);
      expect(await listIds({ keyword: "關鍵字", status: "INACTIVE" })).toEqual([
        stopped.id,
      ]);
    });
  });

  describe("權限與資料共用", () => {
    it("沒綁批售客戶分頁 → FORBIDDEN(綁了經銷商管理也一樣)", async () => {
      expect(
        await errorOf(api, dealersOnly, LIST, { input: {} }),
      ).toMatchObject(FORBIDDEN);
      expect(await createError({}, dealersOnly)).toMatchObject(FORBIDDEN);
    });

    it("店長(只綁分頁):只能看,不能新增 / 編輯 / 刪除,也不能查同名", async () => {
      const row = await create({
        storeName: "共用給中山店的客戶",
        shareOrgs: [{ orgId: String(branchA) }],
      });
      const seen = await one(row.id, managerA);
      expect(seen.abilities.canEdit).toBe(false);
      expect(await createError({}, managerA)).toMatchObject(FORBIDDEN);
      expect(
        await updateError({ id: row.id, note: "x" }, managerA),
      ).toMatchObject(FORBIDDEN);
      expect(await deleteError(row.id, managerA)).toMatchObject(FORBIDDEN);
      expect(
        await errorOf(api, managerA, SAME_NAMES, {
          input: { storeName: "共用給中山店的客戶" },
        }),
      ).toMatchObject(FORBIDDEN);
    });

    it("可見範圍:分店建的總部看得到、別家分店看不到;總部建的分店看不到;別租戶看不到", async () => {
      const fromB = await create({ storeName: "信義店建的" }, editorB);
      const seen = await one(fromB.id);
      expect(seen.ownerOrgName).toBe("信義店");
      expect(await oneError(fromB.id, managerA)).toMatchObject(NOT_FOUND);
      const fromHq = await create({ storeName: "總部建的" });
      expect(await oneError(fromHq.id, managerB)).toMatchObject(NOT_FOUND);
      expect(await oneError(fromHq.id, otherHq)).toMatchObject(NOT_FOUND);
    });

    it("共用給信義店:看得到但只能看(編輯、刪除 NOT_FOUND);改回空清單就看不到", async () => {
      const row = await create({
        storeName: "共用客戶",
        shareOrgs: [{ orgId: String(branchB) }],
      });
      expect(await one(row.id, editorB)).toMatchObject({
        isShared: true,
        abilities: { canEdit: false },
      });
      expect(
        await updateError({ id: row.id, note: "x" }, editorB),
      ).toMatchObject(NOT_FOUND);
      expect(await deleteError(row.id, editorB)).toMatchObject(NOT_FOUND);
      await update({ id: row.id, shareOrgs: [] });
      expect(await oneError(row.id, editorB)).toMatchObject(NOT_FOUND);
    });

    it("共用給:沒有 edit → FORBIDDEN;別租戶的組織、編輯送 null → VALIDATION_FAILED", async () => {
      expect(
        await createError(
          { shareOrgs: [{ orgId: String(branchB) }] },
          creatorOnly,
        ),
      ).toMatchObject(FORBIDDEN);
      const invalid = { code: "VALIDATION_FAILED", fields: ["shareOrgs"] };
      expect(
        await createError({ shareOrgs: [{ orgId: String(otherTenant) }] }),
      ).toMatchObject(invalid);
      const row = await create();
      expect(await updateError({ id: row.id, shareOrgs: null })).toMatchObject(
        invalid,
      );
    });
  });
});
