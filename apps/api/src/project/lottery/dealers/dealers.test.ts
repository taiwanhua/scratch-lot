import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import {
  ALL_MODULES,
  CREATE_CONTACT,
  CREATE_DEALER,
  DEALER,
  DEALERS,
  type DealerRow,
  P,
  UPDATE_CONTACT,
  UPDATE_DEALER,
  contactInput,
  createDealersOperator,
  dealerInput,
  dealersToken,
  errorOf,
  ok,
  seedDealersAuthorization,
} from "./test-support/dealers-fixtures";

interface CreateData {
  createLotteryDealer: { item: DealerRow };
}
interface UpdateData {
  updateLotteryDealer: { item: DealerRow };
}
interface ContactData {
  createLotteryDealerContact: { item: { id: string } };
}
interface DealerData {
  lotteryDealer: { item: DealerRow };
}
interface DealersData {
  lotteryDealers: { items: DealerRow[] };
}

/** 關係人單筆的系統資訊欄位。 */
const CONTACT_SYSTEM = /* GraphQL */ `
  query TestLotteryDealerContactSystem($id: ID!) {
    lotteryDealerContact(id: $id) {
      item {
        ownerOrgName
        createdBy {
          id
          name
        }
        updatedBy {
          id
          name
        }
      }
    }
  }
`;

/** 讀得到這一位經銷商嗎(單筆查詢沒有錯誤)。 */
async function readableBy(
  api: AuthTestApp,
  token: string,
  id: string,
): Promise<boolean> {
  return (await errorOf(api, token, DEALER, { id })) === undefined;
}

describe("經銷商管理(專案規格 5.2–5.4)", () => {
  let api: AuthTestApp;
  let tenantId: Types.ObjectId;
  let branchA: Types.ObjectId;
  let branchB: Types.ObjectId;
  /** 總部:全部權限(含兩個批購基準日的欄位級權限)。 */
  let hq: string;
  /** 只有 create / edit,沒有欄位級權限。 */
  let editor: string;
  /** 只綁模組(看得到),沒有任何權限。 */
  let viewer: string;
  /** 沒綁經銷商管理。 */
  let outsider: string;

  beforeAll(async () => {
    api = await startAuthTestApp("lottery_dealers_test");
    await seedDealersAuthorization(api.connection);
    tenantId = await createOrg(api.connection, { name: "好運彩券行" });
    branchA = await createOrg(api.connection, {
      name: "中山店",
      parentId: tenantId,
    });
    branchB = await createOrg(api.connection, {
      name: "信義店",
      parentId: tenantId,
    });
    hq = await dealersToken(api, api.connection, {
      orgId: tenantId,
      moduleKeys: ALL_MODULES,
      permissionKeys: [P.all, P.contactsAll],
    });
    editor = await dealersToken(api, api.connection, {
      orgId: tenantId,
      moduleKeys: ALL_MODULES,
      permissionKeys: [P.create, P.edit, P.contactsCreate, P.contactsEdit],
    });
    viewer = await dealersToken(api, api.connection, {
      orgId: tenantId,
      moduleKeys: ALL_MODULES,
      permissionKeys: [],
    });
    outsider = await dealersToken(api, api.connection, {
      orgId: tenantId,
      moduleKeys: [],
      permissionKeys: [],
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  const createDealer = async (
    type: "A" | "B",
    extra: Record<string, unknown> = {},
    token = hq,
  ): Promise<DealerRow> => {
    const data = await ok<CreateData>(api, token, CREATE_DEALER, {
      input: dealerInput(type, extra),
    });
    return data.createLotteryDealer.item;
  };

  const updateDealer = async (
    input: Record<string, unknown>,
  ): Promise<DealerRow> => {
    const data = await ok<UpdateData>(api, hq, UPDATE_DEALER, { input });
    return data.updateLotteryDealer.item;
  };

  const createContact = async (
    roles: string[],
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const data = await ok<ContactData>(api, hq, CREATE_CONTACT, {
      input: contactInput(roles, extra),
    });
    return data.createLotteryDealerContact.item.id;
  };

  const updateError = (input: Record<string, unknown>, token = hq) =>
    errorOf(api, token, UPDATE_DEALER, { input });

  const createError = (input: Record<string, unknown>, token = hq) =>
    errorOf(api, token, CREATE_DEALER, { input });

  /** 列表查詢回來的經銷商 id(總部看)。 */
  const idsOf = async (input: Record<string, unknown>): Promise<string[]> => {
    const data = await ok<DealersData>(api, hq, DEALERS, { input });
    return data.lotteryDealers.items.map((row) => row.id);
  };

  describe("新增與讀取", () => {
    it("甲類 / 乙類各自列在自己的分頁;類型、證號、狀態照存", async () => {
      const a = await createDealer("A", { name: "陳志明" });
      const b = await createDealer("B", { storeName: "好運 2 號店" });
      expect(a).toMatchObject({ type: "A", status: "ACTIVE", name: "陳志明" });
      expect(b).toMatchObject({ type: "B", storeName: "好運 2 號店" });
      const list = await ok<{
        lotteryDealers: { items: DealerRow[] };
      }>(api, hq, DEALERS, { input: { type: "A" } });
      const ids = list.lotteryDealers.items.map((row) => row.id);
      expect(ids).toContain(a.id);
      expect(ids).not.toContain(b.id);
    });

    it("證照篩選 licenseState:30 天內到期 / 已過期各自篩出,與類型一起套用(甲類、乙類列表共用)", async () => {
      const day = 86_400_000;
      const now = Date.now();
      const expiresIn = (days: number) => ({
        licenseExpiresAt: new Date(now + days * day).toISOString(),
      });
      const expiringB = await createDealer("B", expiresIn(10));
      const expiredB = await createDealer("B", expiresIn(-10));
      const okB = await createDealer("B", expiresIn(365));
      const expiringA = await createDealer("A", expiresIn(10));
      const expiring = await idsOf({ type: "B", licenseState: "EXPIRING" });
      expect(expiring).toContain(expiringB.id);
      expect(expiring).not.toContain(expiredB.id);
      expect(expiring).not.toContain(okB.id);
      expect(expiring).not.toContain(expiringA.id);

      const expired = await idsOf({ type: "B", licenseState: "EXPIRED" });
      expect(expired).toContain(expiredB.id);
      expect(expired).not.toContain(expiringB.id);
      expect(expired).not.toContain(okB.id);
    });

    it("keyword 比對證號、姓名、店名、身分證字號(同關係人)", async () => {
      const a = await createDealer("A", { name: "關鍵字甲" });
      const b = await createDealer("B", { storeName: "關鍵字店" });
      expect(await idsOf({ type: "A", keyword: a.nationalId })).toEqual([a.id]);
      // 大小寫不分(身分證字號的英文字母)
      expect(
        await idsOf({ type: "A", keyword: a.nationalId.toLowerCase() }),
      ).toEqual([a.id]);
      expect(await idsOf({ type: "B", keyword: b.nationalId })).toEqual([b.id]);
      expect(await idsOf({ type: "A", keyword: a.licenseNo })).toEqual([a.id]);
      expect(await idsOf({ type: "A", keyword: "關鍵字甲" })).toEqual([a.id]);
      expect(await idsOf({ type: "B", keyword: "關鍵字店" })).toEqual([b.id]);
    });

    it("系統資訊:所屬組織、建立者、修改者都取這筆資料本身(orgId、createdBy、updatedBy)", async () => {
      const writer = await createDealersOperator(api, api.connection, {
        orgId: tenantId,
        moduleKeys: ALL_MODULES,
        permissionKeys: [P.edit, P.editBase, P.showBase, P.contactsEdit],
      });
      const a = await createDealer("A");
      expect(a.ownerOrgName).toBe("好運彩券行");
      expect(a.createdBy?.name).toBeTruthy();
      expect(a.updatedBy).toEqual(a.createdBy);

      const data = await ok<UpdateData>(api, writer.token, UPDATE_DEALER, {
        input: { id: a.id, name: "改過的" },
      });
      const updated = data.updateLotteryDealer.item;
      expect(updated.createdBy).toEqual(a.createdBy);
      expect(updated.updatedBy).toMatchObject({ id: String(writer.userId) });
      expect(updated.updatedBy?.name).toMatch(/^dealers-/);
      expect(updated.ownerOrgName).toBe("好運彩券行");

      // 批購基準日會觸發重算(系統身分寫入):修改者仍是操作的人
      const based = await createDealer("A", {
        lastPurchaseBaseDate: "2026-01-05T16:00:00.000Z",
      });
      expect(based.lastPurchaseDate).toBe("2026-01-05T16:00:00.000Z");
      expect(based.updatedBy).toEqual(based.createdBy);
      const rebased = await ok<UpdateData>(api, writer.token, UPDATE_DEALER, {
        input: {
          id: based.id,
          lastPurchaseBaseDate: "2026-02-05T16:00:00.000Z",
        },
      });
      expect(rebased.updateLotteryDealer.item.lastPurchaseDate).toBe(
        "2026-02-05T16:00:00.000Z",
      );
      expect(rebased.updateLotteryDealer.item.updatedBy).toMatchObject({
        id: String(writer.userId),
      });

      const contactId = await createContact(["AGENT"]);
      await ok(api, writer.token, UPDATE_CONTACT, {
        input: { id: contactId, name: "改過的人" },
      });
      const contact = await ok<{
        lotteryDealerContact: {
          item: {
            ownerOrgName: string | null;
            createdBy: { id: string } | null;
            updatedBy: { id: string } | null;
          };
        };
      }>(api, hq, CONTACT_SYSTEM, { id: contactId });
      expect(contact.lotteryDealerContact.item).toMatchObject({
        ownerOrgName: "好運彩券行",
        createdBy: a.createdBy,
        updatedBy: { id: String(writer.userId) },
      });
    });

    it("證號格式不對、身分證字號格式不對 → VALIDATION_FAILED 一次標出", async () => {
      expect(
        await createError(
          dealerInput("A", { licenseNo: "123", nationalId: "x1" }),
        ),
      ).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["licenseNo", "nationalId"],
      });
    });

    it("證號在租戶內唯一", async () => {
      const a = await createDealer("A");
      expect(
        await createError(dealerInput("A", { licenseNo: a.licenseNo })),
      ).toMatchObject({
        code: "VALIDATION_FAILED",
        reason: "LICENSE_NO_DUPLICATE",
      });
    });

    it("甲類給了乙類才有的欄位 → NOT_FOR_TYPE", async () => {
      expect(
        await createError(dealerInput("A", { storeName: "店" })),
      ).toMatchObject({ reason: "NOT_FOR_TYPE", fields: ["storeName"] });
    });

    it("牌租週期是季或年時起算月份必填;由季改成月時起算月份不再使用", async () => {
      expect(
        await createError(
          dealerInput("B", {
            rentFee: 3000,
            rentCycle: "QUARTER",
            rentDueDay: 10,
          }),
        ),
      ).toMatchObject({ reason: "RENT_START_MONTH_REQUIRED" });
      // 有週期沒有繳費日:原因 RENT_DUE_DAY_REQUIRED(前端寫在繳費日欄下)
      expect(
        await createError(
          dealerInput("B", { rentFee: 3000, rentCycle: "MONTH" }),
        ),
      ).toMatchObject({
        reason: "RENT_DUE_DAY_REQUIRED",
        fields: ["rentDueDay"],
      });
      const b = await createDealer("B", {
        rentFee: 3000,
        rentCycle: "QUARTER",
        rentStartMonth: 2,
        rentDueDay: 10,
      });
      expect(b.nextRentDueAt).not.toBeNull();
      const updated = await updateDealer({ id: b.id, rentCycle: "MONTH" });
      expect(updated).toMatchObject({
        rentCycle: "MONTH",
        rentStartMonth: null,
      });
    });

    it("戶籍同通訊地址:存通訊地址", async () => {
      const a = await createDealer("A", {
        mailingAddress: "台北市中山區南京東路 1 段 10 號",
        residentialSameAsMailing: true,
      });
      expect(a.residentialAddress).toBe("台北市中山區南京東路 1 段 10 號");
    });

    it("沒有刪除經銷商 / 關係人的端點:被引用的只能解約 / 停用", async () => {
      const result = await api.graphql<{
        __schema: { mutationType: { fields: { name: string }[] } };
      }>(
        "query { __schema { mutationType { fields { name } } } }",
        {},
        { accessToken: hq },
      );
      const names =
        result.data?.__schema.mutationType.fields.map((field) => field.name) ??
        [];
      expect(names).toContain("updateLotteryDealer");
      expect(names.filter((name) => /^delete.*Dealer/.test(name))).toEqual([]);
    });
  });

  describe("關聯上限與身分(L290,每條一個測試)", () => {
    let coSales: DealerRow;
    beforeAll(async () => {
      coSales = await createDealer("B");
    });

    it("甲類代理人最多 2", async () => {
      const ids = [
        await createContact(["AGENT"]),
        await createContact(["AGENT"]),
        await createContact(["AGENT"]),
      ];
      expect(
        await createError(
          dealerInput("A", { coSalesDealerId: coSales.id, agentIds: ids }),
        ),
      ).toMatchObject({ reason: "ROLE_LIMIT", fields: ["agentIds"] });
    });

    it("同一位關係人選了兩次 → CONTACT_REPEATED", async () => {
      const id = await createContact(["TRUSTEE"]);
      expect(
        await createError(dealerInput("A", { trusteeIds: [id, id] })),
      ).toMatchObject({ reason: "CONTACT_REPEATED", fields: ["trusteeIds"] });
    });

    it("甲類受託人最多 2", async () => {
      const ids = [
        await createContact(["TRUSTEE"]),
        await createContact(["TRUSTEE"]),
        await createContact(["TRUSTEE"]),
      ];
      expect(
        await createError(dealerInput("A", { trusteeIds: ids })),
      ).toMatchObject({ reason: "ROLE_LIMIT", fields: ["trusteeIds"] });
    });

    it("甲類介紹人最多 1", async () => {
      const ids = [
        await createContact(["INTRODUCER"]),
        await createContact(["INTRODUCER"]),
      ];
      expect(
        await createError(dealerInput("A", { introducerIds: ids })),
      ).toMatchObject({ reason: "ROLE_LIMIT", fields: ["introducerIds"] });
    });

    it("乙類代理人最多 2", async () => {
      const ids = [
        await createContact(["AGENT"]),
        await createContact(["AGENT"]),
        await createContact(["AGENT"]),
      ];
      expect(
        await createError(dealerInput("B", { agentIds: ids })),
      ).toMatchObject({ reason: "ROLE_LIMIT", fields: ["agentIds"] });
    });

    it("乙類介紹人最多 1", async () => {
      const ids = [
        await createContact(["INTRODUCER"]),
        await createContact(["INTRODUCER"]),
      ];
      expect(
        await createError(dealerInput("B", { introducerIds: ids })),
      ).toMatchObject({ reason: "ROLE_LIMIT", fields: ["introducerIds"] });
    });

    it("乙類不能有受託人", async () => {
      const id = await createContact(["TRUSTEE"]);
      expect(
        await createError(dealerInput("B", { trusteeIds: [id] })),
      ).toMatchObject({
        reason: "TRUSTEE_NOT_ALLOWED",
        fields: ["trusteeIds"],
      });
    });

    it("關係人沒有該身分 → CONTACT_ROLE_MISMATCH", async () => {
      const id = await createContact(["INTRODUCER"]);
      expect(
        await createError(dealerInput("A", { trusteeIds: [id] })),
      ).toMatchObject({ reason: "CONTACT_ROLE_MISMATCH" });
    });

    it("停用的關係人不能再被選;既有關聯保留", async () => {
      const id = await createContact(["TRUSTEE"]);
      const a = await createDealer("A", { trusteeIds: [id] });
      await ok(api, hq, UPDATE_CONTACT, {
        input: { id, status: "DISABLED" },
      });
      // 既有的關聯照樣在,編輯別的欄位不受影響
      const kept = await updateDealer({ id: a.id, name: "改名" });
      expect(kept.trustees.map((row) => row.id)).toEqual([id]);
      expect(
        await createError(dealerInput("A", { trusteeIds: [id] })),
      ).toMatchObject({ reason: "CONTACT_DISABLED" });
    });

    it("經銷商本人(身分證字號相同)不能登記", async () => {
      const nationalId = "B223456780";
      const id = await createContact(["TRUSTEE"], { nationalId });
      expect(
        await createError(dealerInput("A", { nationalId, trusteeIds: [id] })),
      ).toMatchObject({ reason: "SELF_RELATION" });
    });

    it("同一人對同一經銷商可同時擔任多種身分", async () => {
      const id = await createContact(["TRUSTEE", "INTRODUCER"]);
      const a = await createDealer("A", {
        trusteeIds: [id],
        introducerIds: [id],
      });
      expect(a.trustees.map((row) => row.id)).toEqual([id]);
      expect(a.introducers.map((row) => row.id)).toEqual([id]);
    });
  });

  describe("共同銷售處所與代理人(L231、L245)", () => {
    it("甲類沒有共同銷售處所時不能設代理人", async () => {
      const id = await createContact(["AGENT"]);
      expect(
        await createError(dealerInput("A", { agentIds: [id] })),
      ).toMatchObject({ reason: "AGENT_REQUIRES_CO_SALES" });
    });

    it("移除共同銷售處所但有代理人 → 擋下並列出;確認後自動解除", async () => {
      const b = await createDealer("B");
      const agent = await createContact(["AGENT"], { name: "陳小芳" });
      const a = await createDealer("A", {
        coSalesDealerId: b.id,
        agentIds: [agent],
      });
      expect(
        await updateError({ id: a.id, coSalesDealerId: null }),
      ).toMatchObject({
        code: "CONFLICT",
        reason: "AGENTS_REQUIRE_CO_SALES",
        relationships: [
          expect.objectContaining({ role: "agent", contactName: "陳小芳" }),
        ],
      });
      const released = await updateDealer({
        id: a.id,
        coSalesDealerId: null,
        releaseAgents: true,
      });
      expect(released.coSalesDealer).toBeNull();
      expect(released.agents).toEqual([]);
    });

    it("共同銷售處所只能選乙類;乙類的共同銷售人數用反查", async () => {
      const otherA = await createDealer("A");
      expect(
        await createError(dealerInput("A", { coSalesDealerId: otherA.id })),
      ).toMatchObject({ reason: "CO_SALES_NOT_CLASS_B" });
      const b = await createDealer("B");
      await createDealer("A", { coSalesDealerId: b.id });
      await createDealer("A", { coSalesDealerId: b.id });
      const detail = await ok<{ lotteryDealer: { item: DealerRow } }>(
        api,
        hq,
        DEALER,
        { id: b.id },
      );
      expect(detail.lotteryDealer.item.coSellerCount).toBe(2);
    });

    it("關聯失敗時主檔也不寫(同一個交易)", async () => {
      const id = await createContact(["AGENT"]);
      const input = dealerInput("A", { agentIds: [id] });
      await createError(input);
      const list = await ok<{ lotteryDealers: { items: DealerRow[] } }>(
        api,
        hq,
        DEALERS,
        { input: { type: "A", keyword: input.licenseNo } },
      );
      expect(list.lotteryDealers.items).toEqual([]);
    });
  });

  describe("解約 / 停用後不能被選(L244、L276)", () => {
    it("解約的乙類不能被選為共同銷售處所;既有關聯保留;挑選器不列", async () => {
      const b = await createDealer("B");
      const a = await createDealer("A", { coSalesDealerId: b.id });
      await ok(api, hq, UPDATE_DEALER, {
        input: { id: b.id, status: "TERMINATED" },
      });
      expect(
        await createError(dealerInput("A", { coSalesDealerId: b.id })),
      ).toMatchObject({ reason: "DEALER_TERMINATED" });
      const kept = await ok<{ lotteryDealer: { item: DealerRow } }>(
        api,
        hq,
        DEALER,
        { id: a.id },
      );
      expect(kept.lotteryDealer.item.coSalesDealer?.id).toBe(b.id);
      const selectable = await ok<{ lotteryDealers: { items: DealerRow[] } }>(
        api,
        hq,
        DEALERS,
        { input: { type: "B", selectable: true, pageSize: 100 } },
      );
      expect(
        selectable.lotteryDealers.items.map((row) => row.id),
      ).not.toContain(b.id);
    });

    it("關係人取消的身分還有關聯 → 擋下並列出;確認後自動解除", async () => {
      const id = await createContact(["TRUSTEE", "INTRODUCER"]);
      const a = await createDealer("A", { trusteeIds: [id] });
      expect(
        await errorOf(api, hq, UPDATE_CONTACT, {
          input: { id, roles: ["INTRODUCER"] },
        }),
      ).toMatchObject({
        code: "CONFLICT",
        reason: "ROLE_IN_USE",
        relationships: [
          expect.objectContaining({ role: "trustee", dealerId: a.id }),
        ],
      });
      const updated = await ok<{
        updateLotteryDealerContact: {
          item: { roles: string[]; dealerCount: number };
        };
      }>(api, hq, UPDATE_CONTACT, {
        input: { id, roles: ["INTRODUCER"], releaseRelationships: true },
      });
      expect(updated.updateLotteryDealerContact.item).toMatchObject({
        roles: ["INTRODUCER"],
        dealerCount: 0,
      });
    });
  });

  describe("對應分店 org_lottery_dealer(L292)", () => {
    it("一對一:已對應的分店不能再選;占用清單註明是哪一位", async () => {
      const first = await createDealer("B", {
        storeOrgId: String(branchA),
        storeName: "好運 2 號店",
      });
      expect(first.storeOrg).toEqual({ id: String(branchA), name: "中山店" });
      expect(
        await createError(dealerInput("B", { storeOrgId: String(branchA) })),
      ).toMatchObject({ reason: "STORE_OCCUPIED", fields: ["storeOrgId"] });
      const occupied = await ok<{
        lotteryOccupiedStores: {
          items: { orgId: string; dealer: { id: string } }[];
        };
      }>(
        api,
        hq,
        "query { lotteryOccupiedStores { items { orgId dealer { id } } } }",
      );
      expect(occupied.lotteryOccupiedStores.items).toContainEqual({
        orgId: String(branchA),
        dealer: { id: first.id },
      });
      // 解除後別人就能選
      await ok(api, hq, UPDATE_DEALER, {
        input: { id: first.id, storeOrgId: null },
      });
      const second = await createDealer("B", { storeOrgId: String(branchA) });
      expect(second.storeOrg?.id).toBe(String(branchA));
    });

    it("對應分店要是租戶底下的組織(不能是最上層組織本身)", async () => {
      expect(
        await createError(dealerInput("B", { storeOrgId: String(tenantId) })),
      ).toMatchObject({ reason: "STORE_NOT_BRANCH" });
      expect(
        await createError(dealerInput("A", { storeOrgId: String(branchB) })),
      ).toMatchObject({ reason: "NOT_FOR_TYPE" });
    });
  });

  describe("欄位級權限(四件事各一測試)", () => {
    const base = "2026-01-05T16:00:00.000Z";

    it("投影:沒有 show- 權限時列表與單筆都不回傳", async () => {
      const a = await createDealer("A", {
        lastPurchaseBaseDate: base,
        lastSelfPurchaseBaseDate: base,
      });
      expect(a.lastPurchaseBaseDate).toBe(base);
      const one = await ok<{ lotteryDealer: { item: DealerRow } }>(
        api,
        editor,
        DEALER,
        { id: a.id },
      );
      expect(one.lotteryDealer.item).toMatchObject({
        lastPurchaseBaseDate: null,
        lastSelfPurchaseBaseDate: null,
        // 顯示值(最近一次批購日)照常回
        lastPurchaseDate: base,
      });
      const list = await ok<{ lotteryDealers: { items: DealerRow[] } }>(
        api,
        editor,
        DEALERS,
        { input: { type: "A", keyword: a.licenseNo } },
      );
      expect(list.lotteryDealers.items[0]?.lastPurchaseBaseDate).toBeNull();
    });

    it("寫入守門:沒有 edit- 權限,送出(含 null)即 FIELD_FORBIDDEN", async () => {
      const a = await createDealer("A");
      expect(
        await updateError({ id: a.id, lastPurchaseBaseDate: null }, editor),
      ).toMatchObject({ code: "FORBIDDEN", reason: "FIELD_FORBIDDEN" });
      expect(
        await createError(
          dealerInput("A", { lastSelfPurchaseBaseDate: base }),
          editor,
        ),
      ).toMatchObject({ code: "FORBIDDEN", reason: "FIELD_FORBIDDEN" });
      // 新增時 null 視同缺席
      expect(
        await createError(
          dealerInput("A", { lastSelfPurchaseBaseDate: null }),
          editor,
        ),
      ).toBeUndefined();
      expect(a.abilities.canEditLastPurchaseBaseDate).toBe(true);
    });

    it("稽核:兩個批購基準日一律 [redacted]", async () => {
      const a = await createDealer("A", { lastPurchaseBaseDate: base });
      await ok(api, hq, UPDATE_DEALER, {
        input: { id: a.id, lastPurchaseBaseDate: "2026-02-05T16:00:00.000Z" },
      });
      const logs = await api.connection
        .collection<{ targetId: unknown; action: string; after?: unknown }>(
          "audit_logs",
        )
        .find({ targetType: "lottery_dealer" })
        .toArray();
      const mine = logs.filter((log) => String(log.targetId) === a.id);
      expect(mine.map((log) => log.action)).toEqual([
        "lottery-dealer.create",
        "lottery-dealer.edit",
      ]);
      expect(mine[0]?.after).toMatchObject({
        lastPurchaseBaseDate: "[redacted]",
      });
      expect(mine[1]).toMatchObject({
        before: { lastPurchaseBaseDate: "[redacted]" },
        after: { lastPurchaseBaseDate: "[redacted]" },
      });
      expect(JSON.stringify(mine)).not.toContain("2026-02-05");
    });

    it("keyword 不比對受權限欄", async () => {
      const a = await createDealer("A", { lastPurchaseBaseDate: base });
      const list = await ok<{ lotteryDealers: { items: DealerRow[] } }>(
        api,
        hq,
        DEALERS,
        { input: { type: "A", keyword: "2026-01" } },
      );
      expect(list.lotteryDealers.items.map((row) => row.id)).not.toContain(
        a.id,
      );
    });
  });

  describe("沒有權限(L260、L282)", () => {
    it("沒有 create / edit:mutation FORBIDDEN、abilities 為 false", async () => {
      expect(await createError(dealerInput("A"), viewer)).toMatchObject({
        code: "FORBIDDEN",
      });
      const a = await createDealer("A");
      expect(await updateError({ id: a.id, name: "改" }, viewer)).toMatchObject(
        {
          code: "FORBIDDEN",
        },
      );
      const one = await ok<{ lotteryDealer: { item: DealerRow } }>(
        api,
        viewer,
        DEALER,
        { id: a.id },
      );
      expect(one.lotteryDealer.item.abilities).toEqual({
        canEdit: false,
        canEditLastPurchaseBaseDate: false,
        canEditLastSelfPurchaseBaseDate: false,
      });
      expect(
        await errorOf(api, viewer, CREATE_CONTACT, {
          input: contactInput(["AGENT"]),
        }),
      ).toMatchObject({ code: "FORBIDDEN" });
    });

    it("沒綁經銷商管理:讀取 FORBIDDEN", async () => {
      expect(
        await errorOf(api, outsider, DEALERS, { input: { type: "A" } }),
      ).toMatchObject({ code: "FORBIDDEN" });
    });

    it("分店的人看不到總部建的經銷商(可見範圍)", async () => {
      const a = await createDealer("A");
      const branchViewer = await dealersToken(api, api.connection, {
        orgId: branchA,
        ownerOrgId: tenantId,
        moduleKeys: ALL_MODULES,
        permissionKeys: [],
      });
      expect(
        await errorOf(api, branchViewer, DEALER, { id: a.id }),
      ).toMatchObject({ code: "NOT_FOUND" });
    });
  });

  /**
   * 資料共用(ADR-0014):經銷商「可共用、預設不共用、可編輯」,另給對應分店看(sharedByFields);
   * 共用進來的只能看。別租戶的人透過列表、單筆、lookup 都看不到。
   */
  describe("資料共用與別租戶", () => {
    let branchAViewer: string;
    let branchBViewer: string;
    let branchAEditor: string;
    let otherHq: string;
    let otherTenant: Types.ObjectId;
    /** 只有 create(沒有 edit):不能設「共用給」。 */
    let creatorOnly: string;

    beforeAll(async () => {
      branchAViewer = await dealersToken(api, api.connection, {
        orgId: branchA,
        ownerOrgId: tenantId,
        moduleKeys: ALL_MODULES,
        permissionKeys: [],
      });
      branchBViewer = await dealersToken(api, api.connection, {
        orgId: branchB,
        ownerOrgId: tenantId,
        moduleKeys: ALL_MODULES,
        permissionKeys: [],
      });
      branchAEditor = await dealersToken(api, api.connection, {
        orgId: branchA,
        ownerOrgId: tenantId,
        moduleKeys: ALL_MODULES,
        permissionKeys: [P.all, P.contactsAll],
      });
      creatorOnly = await dealersToken(api, api.connection, {
        orgId: tenantId,
        moduleKeys: ALL_MODULES,
        permissionKeys: [P.create],
      });
      otherTenant = await createOrg(api.connection, { name: "別家彩券行" });
      otherHq = await dealersToken(api, api.connection, {
        orgId: otherTenant,
        moduleKeys: ALL_MODULES,
        permissionKeys: [P.all, P.contactsAll],
      });
    }, HOOK_TIMEOUT_MS);

    it("對應分店的人看得到乙類(標示為共用進來、不能編輯、寫入 NOT_FOUND);換了對應分店,看得到的人跟著換", async () => {
      const b = await createDealer("B", { storeOrgId: String(branchB) });
      const seen = await ok<DealerData>(api, branchBViewer, DEALER, {
        id: b.id,
      });
      // 所屬組織(總部)不在分店的可見範圍,名稱照樣以租戶的組織樹讀出
      expect(seen.lotteryDealer.item).toMatchObject({
        isShared: true,
        abilities: { canEdit: false },
        ownerOrgName: "好運彩券行",
      });
      const branchBEditor = await dealersToken(api, api.connection, {
        orgId: branchB,
        ownerOrgId: tenantId,
        moduleKeys: ALL_MODULES,
        permissionKeys: [P.all],
      });
      expect(
        await updateError({ id: b.id, name: "分店改總部的" }, branchBEditor),
      ).toMatchObject({ code: "NOT_FOUND" });
      expect(await readableBy(api, branchAViewer, b.id)).toBe(false);
      await updateDealer({ id: b.id, storeOrgId: null });
      expect(await readableBy(api, branchBViewer, b.id)).toBe(false);
    });

    it("共用給:總部共用給信義店 → 信義店看得到、中山店看不到;改回空清單就都看不到", async () => {
      const a = await createDealer("A", {
        shareOrgs: [{ orgId: String(branchB) }],
      });
      expect(a.shareOrgs).toEqual([
        { orgId: String(branchB), includeDescendants: false },
      ]);
      expect(await readableBy(api, branchBViewer, a.id)).toBe(true);
      expect(await readableBy(api, branchAViewer, a.id)).toBe(false);
      await updateDealer({ id: a.id, shareOrgs: [] });
      expect(await readableBy(api, branchBViewer, a.id)).toBe(false);
    });

    it("共用給沒有 dealers.edit → FORBIDDEN;共用給別租戶的組織 → VALIDATION_FAILED", async () => {
      expect(
        await createError(
          dealerInput("A", { shareOrgs: [{ orgId: String(branchB) }] }),
          creatorOnly,
        ),
      ).toMatchObject({ code: "FORBIDDEN" });
      expect(
        await createError(
          dealerInput("A", { shareOrgs: [{ orgId: String(otherTenant) }] }),
        ),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["shareOrgs"] });
    });

    it("別租戶的人:列表、單筆、lookup 都看不到;證號可以與別租戶重複;共同銷售處所不能選別租戶的", async () => {
      const a = await createDealer("A", {
        shareOrgs: [{ orgId: String(branchB) }],
      });
      const list = await ok<DealersData>(api, otherHq, DEALERS, {
        input: { type: "A" },
      });
      expect(list.lotteryDealers.items.map((row) => row.id)).not.toContain(
        a.id,
      );
      expect(await readableBy(api, otherHq, a.id)).toBe(false);
      const mine = await ok<CreateData>(api, otherHq, CREATE_DEALER, {
        input: dealerInput("A", { licenseNo: a.licenseNo }),
      });
      expect(mine.createLotteryDealer.item.licenseNo).toBe(a.licenseNo);
      const b = await createDealer("B");
      expect(
        await errorOf(api, otherHq, UPDATE_DEALER, {
          input: {
            id: mine.createLotteryDealer.item.id,
            coSalesDealerId: b.id,
          },
        }),
      ).toMatchObject({ reason: "REFERENCE_NOT_FOUND" });
    });

    it("關係人取消身分:別人看不到的經銷商上的關聯只回筆數(hiddenCount),確認後一起解除", async () => {
      const contact = await ok<ContactData>(
        api,
        branchAEditor,
        CREATE_CONTACT,
        {
          input: contactInput(["TRUSTEE", "INTRODUCER"]),
        },
      );
      const contactId = contact.createLotteryDealerContact.item.id;
      // 總部的甲類掛上中山店建的關係人(中山店的人看不到總部的經銷商)
      await createDealer("A", { trusteeIds: [contactId] });
      expect(
        await errorOf(api, branchAEditor, UPDATE_CONTACT, {
          input: { id: contactId, roles: ["INTRODUCER"] },
        }),
      ).toMatchObject({
        code: "CONFLICT",
        reason: "ROLE_IN_USE",
        relationships: [],
        hiddenCount: 1,
      });
      const released = await ok<{
        updateLotteryDealerContact: { item: { dealerCount: number } };
      }>(api, branchAEditor, UPDATE_CONTACT, {
        input: {
          id: contactId,
          roles: ["INTRODUCER"],
          releaseRelationships: true,
        },
      });
      expect(released.updateLotteryDealerContact.item.dealerCount).toBe(0);
    });
  });
});
