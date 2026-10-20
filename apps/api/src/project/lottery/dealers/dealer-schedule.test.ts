import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { Types } from "mongoose";

import { startOfLocalDay } from "@repo/domain/form";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import {
  NotificationService,
  type NotifyInput,
} from "../../../notifications/notification.service";
import { addDays, localDayOf, quarterOf } from "./dealer-dates";
import {
  DEALER_REMINDERS_JOB_KEY,
  DealerRemindersService,
} from "./dealer-reminders.service";
import {
  ALL_MODULES,
  CREATE_DEALER,
  type DealerRow,
  P,
  createDealersOperator,
  dealerInput,
  errorOf,
  ok,
  seedDealersAuthorization,
} from "./test-support/dealers-fixtures";

const TIMEZONE = "Asia/Taipei";

/** 台北時間某天某時 → ISO(台北 = UTC+8,沒有夏令時間)。 */
const taipei = (date: string, time = "09:00"): Date =>
  new Date(`${date}T${time}:00+08:00`);

/** 台北某天 00:00(日期欄的存值)。 */
const day = (date: string): string => taipei(date, "00:00").toISOString();

interface CreateData {
  createLotteryDealer: { item: DealerRow };
}

const SIGNINS = /* GraphQL */ `
  query TestLotteryDealerSignins($dealerId: ID!, $year: Int!) {
    lotteryDealerSignins(dealerId: $dealerId, year: $year) {
      items {
        id
        quarter
        state
      }
    }
  }
`;

const REGISTER_SIGNIN = /* GraphQL */ `
  mutation TestRegisterLotteryDealerSignin(
    $input: RegisterLotteryDealerSigninInput!
  ) {
    registerLotteryDealerSignin(input: $input) {
      item {
        id
        quarter
        state
      }
    }
  }
`;

const BADGES = /* GraphQL */ `
  query TestSidebarBadges {
    sidebarBadges {
      moduleKey
      count
    }
  }
`;

describe("經銷商管理的排程、見簽與側欄計數", () => {
  let api: AuthTestApp;

  beforeAll(async () => {
    api = await startAuthTestApp("lottery_dealer_schedule_test");
    await seedDealersAuthorization(api.connection);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  /** 一個新租戶 + 一家分店 + 總部操作者(全部權限)。 */
  async function newTenant(name: string) {
    const tenantId = await createOrg(api.connection, { name });
    const branchId = await createOrg(api.connection, {
      name: `${name}分店`,
      parentId: tenantId,
    });
    const { token } = await createDealersOperator(api, api.connection, {
      orgId: tenantId,
      moduleKeys: ALL_MODULES,
      permissionKeys: [P.all, P.contactsAll],
    });
    const create = async (
      type: "A" | "B",
      extra: Record<string, unknown>,
    ): Promise<DealerRow> => {
      const data = await ok<CreateData>(api, token, CREATE_DEALER, {
        input: dealerInput(type, extra),
      });
      return data.createLotteryDealer.item;
    };
    return { tenantId, branchId, token, create };
  }

  describe("B14 提醒(注入排程時點)", () => {
    let calls: NotifyInput[];

    const runAt = async (tenantId: Types.ObjectId, at: Date) => {
      calls = [];
      await api.app.get(DealerRemindersService).run({
        key: DEALER_REMINDERS_JOB_KEY,
        scheduledFor: at,
        tenants: [{ tenantId, timezone: TIMEZONE }],
      });
      return calls;
    };

    /** 某個時點某一型的通知。 */
    const typed = async (
      tenantId: Types.ObjectId,
      type: string,
      date: string,
      time = "09:00",
    ): Promise<NotifyInput[]> => {
      const all = await runAt(tenantId, taipei(date, time));
      return all.filter((call) => call.type === type);
    };

    /** 某個時點某一型第一則通知的某個參數。 */
    const paramOf = async (
      tenantId: Types.ObjectId,
      type: string,
      date: string,
      key: string,
    ): Promise<string | null | undefined> => {
      const [first] = await typed(tenantId, type, date);
      return first?.params?.[key];
    };

    beforeAll(() => {
      jest
        .spyOn(api.app.get(NotificationService), "notify")
        .mockImplementation((input: NotifyInput) => {
          calls.push(input);
          return Promise.resolve();
        });
    });

    afterEach(() => {
      calls = [];
    });

    it("證照到期:到期日前 30、7、0 天 09:00 各一次;過期後不再寄;時間還沒到不寄", async () => {
      const t = await newTenant("證照租戶");
      const dealer = await t.create("A", {
        name: "陳志明",
        licenseExpiresAt: day("2030-12-31"),
      });
      const license = "lottery.license-expiring";
      const hits = (date: string, time?: string) =>
        typed(t.tenantId, license, date, time);

      const first = await hits("2030-12-01");
      expect(first).toEqual([
        expect.objectContaining({
          tenantId: t.tenantId,
          orgId: t.tenantId,
          params: {
            dealerType: "甲類",
            dealerName: "陳志明",
            expiresOn: "2030-12-31",
            daysLeft: "30",
          },
        }),
      ]);
      expect(first[0]?.dedupeKey).toContain(dealer.id);
      expect(await hits("2030-12-01", "08:45")).toEqual([]);
      expect(await hits("2030-12-02")).toEqual([]);
      expect(await paramOf(t.tenantId, license, "2030-12-24", "daysLeft")).toBe(
        "7",
      );
      expect(await paramOf(t.tenantId, license, "2030-12-31", "daysLeft")).toBe(
        "0",
      );
      expect(await hits("2031-01-01")).toEqual([]);
      // 同一個時點晚 15 分鐘再被叫到:dedupeKey 相同(notify 的去重擋掉,只寄一次)
      const again = await hits("2030-12-01", "09:15");
      expect(again[0]?.dedupeKey).toBe(first[0]?.dedupeKey);
    });

    it("證照到期:乙類有對應分店 → 事件組織是分店;解約的不寄", async () => {
      const t = await newTenant("分店租戶");
      await t.create("B", {
        licenseExpiresAt: day("2030-06-30"),
        storeOrgId: String(t.branchId),
      });
      await t.create("A", {
        licenseExpiresAt: day("2030-06-30"),
        status: "TERMINATED",
      });
      const calls = await runAt(t.tenantId, taipei("2030-06-23"));
      expect(calls.map((call) => [call.type, String(call.orgId)])).toEqual([
        ["lottery.license-expiring", String(t.branchId)],
      ]);
    });

    it("牌租(月 / 31 日):2 月在月底那天,前 3 天與當天各一次", async () => {
      const t = await newTenant("牌租月租戶");
      await t.create("B", {
        storeName: "好運 2 號店",
        rentFee: 3000,
        rentCycle: "MONTH",
        rentDueDay: 31,
      });
      const rentType = "lottery.store-rent-due";
      const rent = (date: string) => typed(t.tenantId, rentType, date);
      const dueOn = (date: string) =>
        paramOf(t.tenantId, rentType, date, "dueOn");
      expect(await rent("2031-02-25")).toEqual([
        expect.objectContaining({
          params: {
            dealerName: "好運 2 號店",
            dueOn: "2031-02-28",
            amount: "3,000",
          },
        }),
      ]);
      expect(await dueOn("2031-02-28")).toBe("2031-02-28");
      expect(await rent("2031-02-26")).toEqual([]);
      expect(await dueOn("2031-04-30")).toBe("2031-04-30");
    });

    it("牌租(季 / 起算 2 月 / 10 日):2/10、5/10…,1 月不寄", async () => {
      const t = await newTenant("牌租季租戶");
      await t.create("B", {
        rentFee: 9000,
        rentCycle: "QUARTER",
        rentStartMonth: 2,
        rentDueDay: 10,
      });
      const rentType = "lottery.store-rent-due";
      const rent = (date: string) => typed(t.tenantId, rentType, date);
      const dueOn = (date: string) =>
        paramOf(t.tenantId, rentType, date, "dueOn");
      expect(await dueOn("2031-02-07")).toBe("2031-02-10");
      expect(await dueOn("2031-05-10")).toBe("2031-05-10");
      expect(await rent("2031-01-07")).toEqual([]);
      expect(await rent("2031-03-07")).toEqual([]);
    });
  });

  describe("見簽(L240)", () => {
    it("每季一筆、重複擋下、未到的季別不能登記、已過沒登記警告;寫 audit_log", async () => {
      const t = await newTenant("見簽租戶");
      const dealer = await t.create("A", {});
      const today = localDayOf(new Date(), TIMEZONE);
      const quarter = quarterOf(today);
      const signedAt = new Date().toISOString();
      const registered = await ok<{
        registerLotteryDealerSignin: { item: { id: string; state: string } };
      }>(api, t.token, REGISTER_SIGNIN, {
        input: { dealerId: dealer.id, year: today.year, quarter, signedAt },
      });
      expect(registered.registerLotteryDealerSignin.item.state).toBe("SIGNED");
      expect(
        await errorOf(api, t.token, REGISTER_SIGNIN, {
          input: { dealerId: dealer.id, year: today.year, quarter, signedAt },
        }),
      ).toMatchObject({ reason: "SIGNIN_DUPLICATE" });
      expect(
        await errorOf(api, t.token, REGISTER_SIGNIN, {
          input: {
            dealerId: dealer.id,
            year: today.year + 1,
            quarter: 1,
            signedAt,
          },
        }),
      ).toMatchObject({ reason: "SIGNIN_QUARTER_NOT_STARTED" });

      const list = await ok<{
        lotteryDealerSignins: { items: { quarter: number; state: string }[] };
      }>(api, t.token, SIGNINS, { dealerId: dealer.id, year: today.year });
      expect(list.lotteryDealerSignins.items.map((item) => item.state)).toEqual(
        [1, 2, 3, 4].map((q) => {
          if (q === quarter) {
            return "SIGNED";
          }
          return q < quarter ? "MISSING" : "NOT_STARTED";
        }),
      );
      const logs = await api.connection
        .collection("audit_logs")
        .countDocuments({ action: "lottery-dealer-signin.create" });
      expect(logs).toBeGreaterThanOrEqual(1);
    });
  });

  describe("側欄計數(規格 5.2 情境表)", () => {
    it("證照 30 天內 / 已過期 + 甲類批購日超過 180 天,同一位只算一次;解約不算", async () => {
      const t = await newTenant("計數租戶");
      const today = localDayOf(new Date(), TIMEZONE);
      const at = (offset: number) =>
        new Date(
          startOfLocalDay(addDays(today, offset), TIMEZONE),
        ).toISOString();
      const far = at(400);
      // 算:到期日 = 今天 + 30
      await t.create("B", { licenseExpiresAt: at(30) });
      // 不算:今天 + 31
      await t.create("B", { licenseExpiresAt: at(31) });
      // 算:已過期
      await t.create("B", { licenseExpiresAt: at(-1) });
      // 不算:解約的(證照過期)
      await t.create("A", { licenseExpiresAt: at(-1), status: "TERMINATED" });
      // 算:甲類批購日 181 天前
      await t.create("A", {
        licenseExpiresAt: far,
        lastPurchaseBaseDate: at(-181),
      });
      // 不算:剛好 180 天前
      await t.create("A", {
        licenseExpiresAt: far,
        lastPurchaseBaseDate: at(-180),
      });
      // 算:批購日 10 天前、本人批購日 200 天前
      await t.create("A", {
        licenseExpiresAt: far,
        lastPurchaseBaseDate: at(-10),
        lastSelfPurchaseBaseDate: at(-200),
      });
      // 算:暫停的甲類,批購日 200 天前
      await t.create("A", {
        licenseExpiresAt: far,
        status: "SUSPENDED",
        lastPurchaseBaseDate: at(-200),
      });
      // 不算:甲類兩個批購日都無紀錄
      await t.create("A", { licenseExpiresAt: far });
      // 算 1:同一位證照已過期、批購也超過 180 天
      await t.create("A", {
        licenseExpiresAt: at(-5),
        lastPurchaseBaseDate: at(-300),
      });

      const badges = await ok<{
        sidebarBadges: { moduleKey: string; count: number }[];
      }>(api, t.token, BADGES);
      expect(
        badges.sidebarBadges.find((badge) => badge.moduleKey === "dealers"),
      ).toEqual({ moduleKey: "dealers", count: 6 });
    });
  });
});
