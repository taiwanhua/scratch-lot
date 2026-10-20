import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import { type Connection, type Model, Types } from "mongoose";

import {
  type AuthTestApp,
  type GraphqlResult,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { ScheduleDayOffLock } from "../../database/schedule/schedule-day-off-lock.schema";
import {
  SCHEDULE_DAY_OFFS_COLLECTION,
  ScheduleDayOff,
} from "../../database/schedule/schedule-day-off.schema";
import {
  SCHEDULE_DAY_OFF_CLOSING,
  SCHEDULE_DAY_OFF_OPEN,
} from "../../notifications";
import { ScheduleClock } from "../shared/schedule-clock";
import {
  ALL_SCHEDULE_TEST_PERMISSIONS,
  SCHEDULE_TEST_PERMISSIONS as P,
  type ScheduleTestUser,
  createScheduleUser,
  seedScheduleAuthorization,
  seedScheduleFieldOptions,
} from "../test-support/fixtures";
import {
  DAY_OFF_REMINDERS_JOB_KEY,
  DayOffRemindersService,
} from "./day-off-reminders.service";
import { ScheduleDayOffsService } from "./schedule-day-offs.service";

// ---- GraphQL ----

const DAY_OFF = /* GraphQL */ `
  id
  userId
  name
  date
  kind
  startTime
  endTime
  isPrimary
  byName
  reason
  reasonNote
`;

const VIOLATION = /* GraphQL */ `
  key
  level
  dates
  actual
  limit
  from
  to
`;

const MY_DAY_OFFS = /* GraphQL */ `
  query MyScheduleDayOffs($input: MyScheduleDayOffsInput) {
    myScheduleDayOffs(input: $input) {
      month
      primaryOrg { id name }
      window { month startDate endDate state daysLeft }
      canEdit
      canOverride
      limits { maxMonthly minMonthly maxDailyStaff }
      dayOffCount
      myDayOffs { ${DAY_OFF} }
      days { date staffCount dayOffs { ${DAY_OFF} } }
      violations { ${VIOLATION} }
    }
  }
`;

const ADD_MINE = /* GraphQL */ `
  mutation AddMyScheduleDayOffs($input: AddMyScheduleDayOffsInput!) {
    addMyScheduleDayOffs(input: $input) {
      items { ${DAY_OFF} }
      violations { ${VIOLATION} }
    }
  }
`;

const DELETE_MINE = /* GraphQL */ `
  mutation DeleteMyScheduleDayOff($input: DeleteMyScheduleDayOffInput!) {
    deleteMyScheduleDayOff(input: $input) {
      id
    }
  }
`;

const OVERVIEW = /* GraphQL */ `
  query ScheduleDayOffOverview($input: ScheduleDayOffOverviewInput) {
    scheduleDayOffOverview(input: $input) {
      orgId
      month
      window { startDate endDate state daysLeft }
      canEdit
      limits { maxDailyStaff }
      staff { userId name isPrimary dayOffCount }
      days { date staffCount dayOffs { ${DAY_OFF} } }
    }
  }
`;

const ADD_ON_BEHALF = /* GraphQL */ `
  mutation AddScheduleDayOffsOnBehalf($input: AddScheduleDayOffsOnBehalfInput!) {
    addScheduleDayOffsOnBehalf(input: $input) {
      items { ${DAY_OFF} }
      violations { ${VIOLATION} }
    }
  }
`;

const DELETE_ON_BEHALF = /* GraphQL */ `
  mutation DeleteScheduleDayOffOnBehalf(
    $input: DeleteScheduleDayOffOnBehalfInput!
  ) {
    deleteScheduleDayOffOnBehalf(input: $input) {
      id
    }
  }
`;

const ADD_STAFF = /* GraphQL */ `
  mutation AddScheduleStaff($input: AddScheduleStaffInput!) {
    addScheduleStaff(input: $input) {
      items {
        userId
        staff {
          id
        }
      }
    }
  }
`;

const UPDATE_STAFF = /* GraphQL */ `
  mutation UpdateScheduleStaff($input: UpdateScheduleStaffInput!) {
    updateScheduleStaff(input: $input) {
      item {
        userId
      }
    }
  }
`;

const CUSTOMIZE_RULE = /* GraphQL */ `
  mutation CustomizeScheduleRule($input: CustomizeScheduleRuleInput!) {
    customizeScheduleRule(input: $input) {
      rules {
        orgId
      }
    }
  }
`;

// ---- 型別 ----

interface DayOffRow {
  id: string;
  userId: string;
  name: string;
  date: string;
  kind: string;
  startTime: string | null;
  endTime: string | null;
  isPrimary: boolean;
  byName: string | null;
  reason: string | null;
  reasonNote: string | null;
}

interface ViolationRow {
  key: string;
  level: string;
  dates: string[];
  actual: number | null;
  limit: number | null;
  from: string | null;
  to: string | null;
}

interface DayRow {
  date: string;
  staffCount: number;
  dayOffs: DayOffRow[];
}

interface MyRow {
  month: string;
  primaryOrg: { id: string; name: string } | null;
  window: {
    month: string;
    startDate: string;
    endDate: string;
    state: string;
    daysLeft: number;
  } | null;
  canEdit: boolean;
  canOverride: boolean;
  limits: {
    maxMonthly: number | null;
    minMonthly: number | null;
    maxDailyStaff: number | null;
  };
  dayOffCount: number;
  myDayOffs: DayOffRow[];
  days: DayRow[];
  violations: ViolationRow[];
}

interface OverviewRow {
  orgId: string;
  month: string;
  window: { startDate: string; endDate: string; state: string };
  canEdit: boolean;
  limits: { maxDailyStaff: number | null };
  staff: {
    userId: string;
    name: string;
    isPrimary: boolean;
    dayOffCount: number;
  }[];
  days: DayRow[];
}

interface SaveRow {
  items: DayOffRow[];
  violations: ViolationRow[];
}

interface Payloads {
  myScheduleDayOffs: MyRow;
  addMyScheduleDayOffs: SaveRow;
  scheduleDayOffOverview: OverviewRow;
  addScheduleDayOffsOnBehalf: SaveRow;
  deleteMyScheduleDayOff: { id: string };
  deleteScheduleDayOffOnBehalf: { id: string };
  addScheduleStaff: { items: { staff: { id: string } }[] };
}

function dataOf<Key extends keyof Payloads>(
  result: GraphqlResult,
  key: Key,
): Payloads[Key] {
  expect(result.errors).toBeUndefined();
  const value = result.data?.[key];
  if (value === undefined || value === null) {
    throw new Error(`${key} 沒有回資料`);
  }
  return value as Payloads[Key];
}

function errorOf(result: GraphqlResult): Record<string, unknown> | undefined {
  return result.errors?.[0]?.extensions;
}

/** 租戶時區(預設 Asia/Taipei)某天 09:00 = UTC 01:00。 */
const taipei = (date: string, time = "09:00") =>
  new Date(`${date}T${time}:00+08:00`);

/**
 * 畫休(規格 14.1、14.2、14.5 畫休總覽、14.6 我的畫休、3.4 畫休開放 / 截止通知):
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07);「今天」由 `ScheduleClock` 注入。
 *
 * 組織樹:root ─ 租戶甲(可見性 包含下層)─┬─ 中山店(主要分店:王、李、陳、店長)
 *                                          └─ 新竹店(主要分店:林;林也可以排中山店)
 * 中山店規則用預設:每月最多 8 / 最少 4(限制)、最多連續休假 3(提醒)、同日最多畫休 2 人(限制)、開放 15–25 日。
 */
/** 同時送出的結果裡成功幾筆。 */
const succeeded = (results: GraphqlResult[]) =>
  results.filter((result) => result.errors === undefined).length;

describe("畫休(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let clock: ScheduleClock;

  let tenantA: Types.ObjectId;
  let zhongshan: Types.ObjectId;
  let hsinchu: Types.ObjectId;

  let hq: ScheduleTestUser;
  /** 中山店店長:畫休總覽 + 代改 */
  let manager: ScheduleTestUser;
  /** 中山店:只有畫休總覽(沒有代改) */
  let viewer: ScheduleTestUser;
  let wang: ScheduleTestUser;
  let li: ScheduleTestUser;
  let chen: ScheduleTestUser;
  /** 主要分店新竹店,也可以排中山店 */
  let lin: ScheduleTestUser;
  /** 有我的畫休權限、但沒加入排班 */
  let outsider: ScheduleTestUser;

  function gql(
    user: ScheduleTestUser,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<GraphqlResult> {
    return api.graphql(query, variables, { accessToken: user.token });
  }

  function travelTo(date: string, time = "10:00") {
    jest.spyOn(clock, "now").mockReturnValue(taipei(date, time));
  }

  function addMine(user: ScheduleTestUser, input: Record<string, unknown>) {
    return gql(user, ADD_MINE, { input });
  }

  async function myDayOffs(
    user: ScheduleTestUser,
    month?: string,
  ): Promise<MyRow> {
    return dataOf(
      await gql(user, MY_DAY_OFFS, {
        input: month === undefined ? null : { month },
      }),
      "myScheduleDayOffs",
    );
  }

  async function overview(
    user: ScheduleTestUser,
    month = "2026-12",
  ): Promise<OverviewRow> {
    return dataOf(
      await gql(user, OVERVIEW, {
        input: { orgId: String(zhongshan), month },
      }),
      "scheduleDayOffOverview",
    );
  }

  function onBehalf(input: Record<string, unknown>) {
    return gql(manager, ADD_ON_BEHALF, {
      input: { orgId: String(zhongshan), ...input },
    });
  }

  async function joinSchedule(
    user: ScheduleTestUser,
    orgs: { orgId: Types.ObjectId; isPrimary: boolean }[],
  ): Promise<void> {
    const added = dataOf(
      await gql(hq, ADD_STAFF, { input: { userIds: [String(user.userId)] } }),
      "addScheduleStaff",
    );
    const staffId = added.items[0]?.staff.id;
    const updated = await gql(hq, UPDATE_STAFF, {
      input: {
        staffId,
        orgs: orgs.map((org) => ({
          orgId: String(org.orgId),
          canLead: false,
          isPrimary: org.isPrimary,
        })),
      },
    });
    expect(updated.errors).toBeUndefined();
  }

  async function dayOffIdOf(
    user: ScheduleTestUser,
    date: string,
  ): Promise<string> {
    const document = await connection
      .collection(SCHEDULE_DAY_OFFS_COLLECTION)
      .findOne<{ _id: Types.ObjectId }>({
        userId: user.userId,
        date,
        deletedAt: null,
      });
    if (!document) {
      throw new Error(`找不到 ${user.account} ${date} 的畫休`);
    }
    return String(document._id);
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-schedule-day-offs");
    connection = api.connection;
    clock = api.app.get(ScheduleClock);
    await seedScheduleAuthorization(connection);
    await seedScheduleFieldOptions(connection);
    // 整天畫休的唯一索引先建好,同時寫入的情境才擋得到
    await api.app
      .get<Model<ScheduleDayOff>>(getModelToken(ScheduleDayOff.name))
      .init();
    await api.app
      .get<Model<ScheduleDayOffLock>>(getModelToken(ScheduleDayOffLock.name))
      .init();

    tenantA = await createOrg(connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    zhongshan = await createOrg(connection, {
      name: "中山店",
      parentId: tenantA,
    });
    hsinchu = await createOrg(connection, {
      name: "新竹店",
      parentId: tenantA,
    });

    hq = await createScheduleUser(
      api,
      connection,
      [tenantA],
      ALL_SCHEDULE_TEST_PERMISSIONS,
    );
    manager = await createScheduleUser(
      api,
      connection,
      [zhongshan],
      [P.manageView, P.viewDayOffs, P.editDayOffs, P.myEditDayOffs],
      "李店長",
    );
    viewer = await createScheduleUser(
      api,
      connection,
      [zhongshan],
      [P.manageView, P.viewDayOffs],
    );
    wang = await createScheduleUser(
      api,
      connection,
      [zhongshan],
      [P.myEditDayOffs],
      "王小明",
    );
    li = await createScheduleUser(
      api,
      connection,
      [zhongshan],
      [P.myEditDayOffs],
      "李小華",
    );
    chen = await createScheduleUser(
      api,
      connection,
      [zhongshan],
      [P.myEditDayOffs],
      "陳大文",
    );
    lin = await createScheduleUser(
      api,
      connection,
      [hsinchu],
      [P.myEditDayOffs],
      "林新人",
    );
    outsider = await createScheduleUser(
      api,
      connection,
      [zhongshan],
      [P.myEditDayOffs],
    );

    for (const user of [manager, wang, li, chen]) {
      await joinSchedule(user, [{ orgId: zhongshan, isPrimary: true }]);
    }
    await joinSchedule(lin, [
      { orgId: hsinchu, isPrimary: true },
      { orgId: zhongshan, isPrimary: false },
    ]);
  }, HOOK_TIMEOUT_MS);

  const run = (at: Date) =>
    api.app.get(DayOffRemindersService).run({
      key: DAY_OFF_REMINDERS_JOB_KEY,
      scheduledFor: at,
      tenants: [{ tenantId: tenantA, timezone: "Asia/Taipei" }],
    });

  const recipientsOf = async (type: string, orgId: Types.ObjectId) => {
    const rows = await connection
      .collection("notifications")
      .find<{ recipientId: Types.ObjectId }>({ type, orgId })
      .toArray();
    return rows
      .map((row) => String(row.recipientId))
      .toSorted((left, right) => left.localeCompare(right));
  };

  const ids = (...users: ScheduleTestUser[]) =>
    users
      .map((user) => String(user.userId))
      .toSorted((left, right) => left.localeCompare(right));

  function febFullDay(user: ScheduleTestUser, date: string) {
    return onBehalf({ userId: String(user.userId), date, kind: "full-day" });
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("我的畫休:登記與畫休的算法", () => {
    it("開放期間內(11/20)看的是 12 月:開放中 11/15–11/25,剩 6 天;統計列的上下限照主要分店", async () => {
      travelTo("2026-11-20");
      const mine = await myDayOffs(wang);
      expect(mine).toMatchObject({
        month: "2026-12",
        primaryOrg: { name: "中山店" },
        window: {
          month: "2026-12",
          startDate: "2026-11-15",
          endDate: "2026-11-25",
          state: "open",
          daysLeft: 6,
        },
        canEdit: true,
        canOverride: false,
        limits: { maxMonthly: 8, minMonthly: 4, maxDailyStaff: 2 },
        dayOffCount: 0,
      });
      // 還沒畫 → 少於下限(限制)列在違規清單
      expect(mine.violations.map((item) => item.key)).toEqual([
        "minMonthlyDayOffs",
      ]);
    });

    it("A 早上不可排、B 下午不可排 → 那天 2 人畫休(2/2)", async () => {
      travelTo("2026-11-20");
      dataOf(
        await addMine(wang, {
          date: "2026-12-03",
          kind: "time-range",
          slots: [{ startTime: "09:00", endTime: "13:00" }],
        }),
        "addMyScheduleDayOffs",
      );
      dataOf(
        await addMine(li, {
          date: "2026-12-03",
          kind: "time-range",
          slots: [{ startTime: "14:00", endTime: "18:00" }],
        }),
        "addMyScheduleDayOffs",
      );
      const { days } = await overview(manager);
      const day = days.find((item) => item.date === "2026-12-03");
      expect(day?.staffCount).toBe(2);
      expect(day?.dayOffs.map((item) => item.name)).toEqual([
        "王小明",
        "李小華",
      ]);
    });

    it("同一人同一天整天 + 時段 → 算 1 天", async () => {
      travelTo("2026-11-20");
      dataOf(
        await addMine(wang, { date: "2026-12-05", kind: "full-day" }),
        "addMyScheduleDayOffs",
      );
      dataOf(
        await addMine(wang, {
          date: "2026-12-05",
          kind: "time-range",
          slots: [{ startTime: "18:00", endTime: "22:00" }],
        }),
        "addMyScheduleDayOffs",
      );
      const mine = await myDayOffs(wang);
      expect(mine.dayOffCount).toBe(2);
      expect(mine.myDayOffs).toHaveLength(3);
      expect(
        mine.days.find((item) => item.date === "2026-12-05")?.staffCount,
      ).toBe(1);
    });

    it("時段不可排重疊 → VALIDATION_FAILED(既有的、或同一次送的幾段);開始不早於結束也擋", async () => {
      travelTo("2026-11-20");
      const withExisting = await addMine(wang, {
        date: "2026-12-03",
        kind: "time-range",
        slots: [{ startTime: "12:00", endTime: "14:00" }],
      });
      expect(errorOf(withExisting)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["slots"],
      });
      const withinRequest = await addMine(wang, {
        date: "2026-12-04",
        kind: "time-range",
        slots: [
          { startTime: "09:00", endTime: "12:00" },
          { startTime: "11:00", endTime: "13:00" },
        ],
      });
      expect(errorOf(withinRequest)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["slots"],
      });
      const reversed = await addMine(wang, {
        date: "2026-12-04",
        kind: "time-range",
        slots: [{ startTime: "13:00", endTime: "09:00" }],
      });
      expect(errorOf(reversed)).toMatchObject({ fields: ["slots"] });
      // 相接不算重疊
      dataOf(
        await addMine(wang, {
          date: "2026-12-03",
          kind: "time-range",
          slots: [{ startTime: "13:00", endTime: "15:00" }],
        }),
        "addMyScheduleDayOffs",
      );
    });

    it("整天畫休一天兩筆 → 擋下(事前檢查與唯一索引)", async () => {
      travelTo("2026-11-20");
      const twice = await addMine(wang, {
        date: "2026-12-05",
        kind: "full-day",
      });
      expect(errorOf(twice)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["kind"],
      });
      // 同時送兩筆:唯一索引擋下第二筆,回同一個錯誤
      const results = await Promise.all([
        addMine(chen, { date: "2026-12-06", kind: "full-day" }),
        addMine(chen, { date: "2026-12-06", kind: "full-day" }),
      ]);
      expect(
        results.filter((result) => result.errors === undefined),
      ).toHaveLength(1);
      const count = await connection
        .collection(SCHEDULE_DAY_OFFS_COLLECTION)
        .countDocuments({ userId: chen.userId, date: "2026-12-06" });
      expect(count).toBe(1);
    });

    it("刪除自己的畫休;刪別人的 → NOT_FOUND", async () => {
      travelTo("2026-11-20");
      const id = await dayOffIdOf(chen, "2026-12-06");
      const forbidden = await gql(wang, DELETE_MINE, { input: { id } });
      expect(errorOf(forbidden)).toMatchObject({ code: "NOT_FOUND" });
      dataOf(
        await gql(chen, DELETE_MINE, { input: { id } }),
        "deleteMyScheduleDayOff",
      );
      const mine = await myDayOffs(chen);
      expect(mine.myDayOffs).toEqual([]);
    });

    it("沒加入排班:我的畫休沒有主要分店;登記 → VALIDATION_FAILED(userId)", async () => {
      travelTo("2026-11-20");
      const mine = await myDayOffs(outsider);
      expect(mine).toMatchObject({
        primaryOrg: null,
        window: null,
        canEdit: false,
      });
      const result = await addMine(outsider, {
        date: "2026-12-10",
        kind: "full-day",
      });
      expect(errorOf(result)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["userId"],
      });
    });
  });

  describe("開放期間與代改", () => {
    it("開放期間外本人不能改(API 擋):截止後登記 / 刪除、還沒開放的月份都 FORBIDDEN", async () => {
      travelTo("2026-11-26");
      const mine = await myDayOffs(wang);
      expect(mine.window).toMatchObject({ state: "closed", daysLeft: 0 });
      expect(mine.canEdit).toBe(false);

      const add = await addMine(wang, { date: "2026-12-10", kind: "full-day" });
      expect(errorOf(add)).toMatchObject({
        code: "FORBIDDEN",
        reason: "OUTSIDE_DAY_OFF_WINDOW",
      });
      const id = await dayOffIdOf(wang, "2026-12-05");
      const remove = await gql(wang, DELETE_MINE, { input: { id } });
      expect(errorOf(remove)).toMatchObject({
        reason: "OUTSIDE_DAY_OFF_WINDOW",
      });

      travelTo("2026-11-20");
      const nextMonth = await addMine(wang, {
        date: "2027-01-10",
        kind: "full-day",
      });
      expect(errorOf(nextMonth)).toMatchObject({
        reason: "OUTSIDE_DAY_OFF_WINDOW",
      });
    });

    it("代改:截止前不用原因,記代改人", async () => {
      travelTo("2026-11-20");
      const saved = dataOf(
        await onBehalf({
          userId: String(chen.userId),
          date: "2026-12-08",
          kind: "full-day",
        }),
        "addScheduleDayOffsOnBehalf",
      );
      expect(saved.items[0]).toMatchObject({
        name: "陳大文",
        byName: "李店長",
        reason: null,
      });
    });

    it("代改:截止後原因必填,「其他」要說明;選項要是「代改畫休原因」", async () => {
      travelTo("2026-11-26");
      const input = {
        userId: String(chen.userId),
        date: "2026-12-09",
        kind: "time-range",
        slots: [{ startTime: "18:00", endTime: "22:00" }],
      };
      expect(errorOf(await onBehalf(input))).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["reason"],
      });
      expect(
        errorOf(await onBehalf({ ...input, reason: "other" })),
      ).toMatchObject({ fields: ["reasonNote"] });
      expect(
        errorOf(await onBehalf({ ...input, reason: "not-an-option" })),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["reason"] });

      const saved = dataOf(
        await onBehalf({ ...input, reason: "other", reasonNote: "家裡有事" }),
        "addScheduleDayOffsOnBehalf",
      );
      expect(saved.items[0]).toMatchObject({
        reason: "other",
        reasonNote: "家裡有事",
        byName: "李店長",
      });
    });

    it("代改刪除:截止後原因必填,寫入代改人與原因後軟刪除", async () => {
      travelTo("2026-11-26");
      const id = await dayOffIdOf(chen, "2026-12-08");
      const missing = await gql(manager, DELETE_ON_BEHALF, {
        input: { orgId: String(zhongshan), id },
      });
      expect(errorOf(missing)).toMatchObject({ fields: ["reason"] });
      dataOf(
        await gql(manager, DELETE_ON_BEHALF, {
          input: { orgId: String(zhongshan), id, reason: "entry-error" },
        }),
        "deleteScheduleDayOffOnBehalf",
      );
      const document = await connection
        .collection(SCHEDULE_DAY_OFFS_COLLECTION)
        .findOne<{ deletedAt: Date | null; reason: string; by: unknown }>({
          _id: new Types.ObjectId(id),
        });
      expect(document?.deletedAt).not.toBeNull();
      expect(document?.reason).toBe("entry-error");
      expect(String(document?.by)).toBe(String(manager.userId));
    });

    it("代改的對象要是這家店的排班人員(否則 NOT_FOUND)", async () => {
      travelTo("2026-11-20");
      const result = await onBehalf({
        userId: String(outsider.userId),
        date: "2026-12-08",
        kind: "full-day",
      });
      expect(errorOf(result)).toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("規則:違反限制不存、提醒可存", () => {
    it("同日最多畫休 2 人已滿 → 第 3 人不存並回原因;主要分店不是這家的人不計入", async () => {
      travelTo("2026-11-20");
      const blocked = await addMine(chen, {
        date: "2026-12-03",
        kind: "full-day",
      });
      expect(errorOf(blocked)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["date"],
        violations: [
          expect.objectContaining({
            key: "maxDailyDayOffStaff",
            level: "limit",
            actual: 3,
            limit: 2,
            from: "2026-12-03",
          }),
        ],
      });
      // 代改也照規則
      const onBehalfBlocked = await onBehalf({
        userId: String(chen.userId),
        date: "2026-12-03",
        kind: "full-day",
      });
      // 代改違反限制一樣被擋下,回同一組原因
      expect(errorOf(onBehalfBlocked)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["date"],
        violations: [
          expect.objectContaining({
            key: "maxDailyDayOffStaff",
            actual: 3,
            limit: 2,
          }),
        ],
      });

      // 林的主要分店是新竹店:中山店的同日人數不算他
      dataOf(
        await addMine(lin, { date: "2026-12-03", kind: "full-day" }),
        "addMyScheduleDayOffs",
      );
      const { days } = await overview(manager);
      const day = days.find((item) => item.date === "2026-12-03");
      expect(day?.staffCount).toBe(2);
      expect(
        day?.dayOffs.find((item) => item.name === "林新人")?.isPrimary,
      ).toBe(false);
    });

    it("最多連續休假(提醒)→ 照存,回提醒;只算整天畫休", async () => {
      travelTo("2026-11-20");
      for (const date of ["2026-12-14", "2026-12-15", "2026-12-16"]) {
        const saved = dataOf(
          await addMine(chen, { date, kind: "full-day" }),
          "addMyScheduleDayOffs",
        );
        expect(
          saved.violations.some((item) => item.key === "maxConsecutiveDaysOff"),
        ).toBe(false);
      }
      const fourth = dataOf(
        await addMine(chen, { date: "2026-12-17", kind: "full-day" }),
        "addMyScheduleDayOffs",
      );
      expect(fourth.violations).toContainEqual(
        expect.objectContaining({
          key: "maxConsecutiveDaysOff",
          level: "reminder",
          actual: 4,
          from: "2026-12-14",
          to: "2026-12-17",
        }),
      );
      const mine = await myDayOffs(chen);
      expect(
        mine.violations.find((item) => item.key === "maxConsecutiveDaysOff")
          ?.dates,
      ).toEqual(["2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17"]);
    });

    it("每月最多畫休(限制,本店自訂 6)→ 第 7 天不存;最少畫休不擋刪除", async () => {
      travelTo("2026-11-20");
      const customized = await gql(hq, CUSTOMIZE_RULE, {
        input: {
          orgId: String(zhongshan),
          key: "maxMonthlyDayOffs",
          value: { amount: 6 },
        },
      });
      expect(customized.errors).toBeUndefined();
      // 陳:12/9(代改的時段不可排)+ 12/14–12/17 四天 + 12/20 = 6 天
      for (const date of ["2026-12-20"]) {
        dataOf(
          await addMine(chen, { date, kind: "full-day" }),
          "addMyScheduleDayOffs",
        );
      }
      const seventh = await addMine(chen, {
        date: "2026-12-24",
        kind: "time-range",
        slots: [{ startTime: "09:00", endTime: "10:00" }],
      });
      expect(errorOf(seventh)).toMatchObject({
        violations: [
          expect.objectContaining({
            key: "maxMonthlyDayOffs",
            actual: 7,
            limit: 6,
          }),
        ],
      });

      // 王只有 2 天(< 下限 4),照樣可以刪
      const id = await dayOffIdOf(wang, "2026-12-03");
      dataOf(
        await gql(wang, DELETE_MINE, { input: { id } }),
        "deleteMyScheduleDayOff",
      );
    });
  });

  describe("歸屬組織(不共用;讀取以人為準)", () => {
    it("本人登記歸當前組織、代改歸總覽選的那家店", async () => {
      const orgOf = async (user: ScheduleTestUser, date: string) => {
        const document = await connection
          .collection(SCHEDULE_DAY_OFFS_COLLECTION)
          .findOne<{ orgId: Types.ObjectId }>({
            userId: user.userId,
            date,
            deletedAt: null,
          });
        return String(document?.orgId);
      };
      // 林(所屬新竹店)自己登記
      expect(await orgOf(lin, "2026-12-03")).toBe(String(hsinchu));
      // 王(所屬中山店)自己登記
      expect(await orgOf(wang, "2026-12-05")).toBe(String(zhongshan));
      // 店長在中山店的總覽替陳代改
      expect(await orgOf(chen, "2026-12-09")).toBe(String(zhongshan));
    });
  });

  describe("同時送出不能繞過限制(守門文件 + 同一個交易)", () => {
    // 2027-02 的開放期間是 2027/1/15–1/25,今天 11/20 還沒開始:代改不受限制、不必填原因
    it("同日最多 2 人:3 人同時送出,只成功 2 筆", async () => {
      travelTo("2026-11-20");
      const results = await Promise.all(
        [wang, li, chen].map((user) => febFullDay(user, "2027-02-10")),
      );
      expect(succeeded(results)).toBe(2);
      expect(
        results.find((result) => result.errors !== undefined)?.errors?.[0]
          ?.extensions,
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["date"] });
      const count = await connection
        .collection(SCHEDULE_DAY_OFFS_COLLECTION)
        .countDocuments({ date: "2027-02-10", deletedAt: null });
      expect(count).toBe(2);
    });

    it("同一人同時送兩次:不會超過每月最多畫休(本店自訂 6 天)", async () => {
      travelTo("2026-11-20");
      for (const day of ["01", "02", "03", "04", "05"]) {
        dataOf(
          await febFullDay(manager, `2027-02-${day}`),
          "addScheduleDayOffsOnBehalf",
        );
      }
      const results = await Promise.all([
        febFullDay(manager, "2027-02-20"),
        febFullDay(manager, "2027-02-21"),
      ]);
      expect(succeeded(results)).toBe(1);
      const days = await connection
        .collection(SCHEDULE_DAY_OFFS_COLLECTION)
        .distinct("date", {
          userId: manager.userId,
          date: { $regex: "^2027-02-" },
          deletedAt: null,
        });
      expect(days).toHaveLength(6);
    });

    it("同一人同時送兩段重疊的時段不可排:只寫進一段", async () => {
      travelTo("2026-11-20");
      const range = (startTime: string, endTime: string) =>
        onBehalf({
          userId: String(lin.userId),
          date: "2027-02-15",
          kind: "time-range",
          slots: [{ startTime, endTime }],
        });
      const results = await Promise.all([
        range("09:00", "12:00"),
        range("11:00", "13:00"),
      ]);
      expect(succeeded(results)).toBe(1);
      const count = await connection
        .collection(SCHEDULE_DAY_OFFS_COLLECTION)
        .countDocuments({
          userId: lin.userId,
          date: "2027-02-15",
          deletedAt: null,
        });
      expect(count).toBe(1);
    });
  });

  describe("權限與總覽", () => {
    it("畫休總覽:候選人、尚未畫休(dayOffCount 0)、canEdit 依 edit-day-offs", async () => {
      travelTo("2026-11-20");
      const view = await overview(manager);
      expect(view.canEdit).toBe(true);
      expect(view.window).toMatchObject({
        startDate: "2026-11-15",
        endDate: "2026-11-25",
        state: "open",
      });
      expect(view.limits.maxDailyStaff).toBe(2);
      const byName = new Map(view.staff.map((item) => [item.name, item]));
      expect(byName.get("林新人")).toMatchObject({ isPrimary: false });
      expect(byName.get("李店長")?.dayOffCount).toBe(0);

      const viewerView = await overview(viewer);
      expect(viewerView.canEdit).toBe(false);
    });

    it("沒有 view-day-offs → 總覽 FORBIDDEN;沒有 edit-day-offs → 代改 FORBIDDEN;沒有 my.edit-day-offs → 我的畫休 FORBIDDEN", async () => {
      travelTo("2026-11-20");
      expect(
        errorOf(
          await gql(wang, OVERVIEW, { input: { orgId: String(zhongshan) } }),
        ),
      ).toMatchObject({ code: "FORBIDDEN" });
      expect(
        errorOf(
          await gql(viewer, ADD_ON_BEHALF, {
            input: {
              orgId: String(zhongshan),
              userId: String(wang.userId),
              date: "2026-12-11",
              kind: "full-day",
            },
          }),
        ),
      ).toMatchObject({ code: "FORBIDDEN" });
      expect(errorOf(await gql(viewer, MY_DAY_OFFS))).toMatchObject({
        code: "FORBIDDEN",
      });
      const managerPage = await myDayOffs(manager);
      expect(managerPage.canOverride).toBe(true);
    });
  });

  describe("listUnavailable(給排班表與自動排班)", () => {
    it("某家店的排班人員每人每天的整天畫休 / 時段不可排(畫休屬於人,不分在哪家店)", async () => {
      const service = api.app.get(ScheduleDayOffsService);
      const items = await service.listUnavailable(
        zhongshan,
        "2026-12-03",
        "2026-12-05",
      );
      const find = (user: ScheduleTestUser, date: string) =>
        items.find(
          (item) => item.userId === String(user.userId) && item.date === date,
        );
      expect(find(li, "2026-12-03")).toEqual({
        userId: String(li.userId),
        date: "2026-12-03",
        fullDay: false,
        slots: [{ startTime: "14:00", endTime: "18:00" }],
      });
      expect(find(lin, "2026-12-03")?.fullDay).toBe(true);
      expect(find(wang, "2026-12-05")).toMatchObject({
        fullDay: true,
        slots: [{ startTime: "18:00", endTime: "22:00" }],
      });
      // 新竹店的候選人只有林
      const hsinchuItems = await service.listUnavailable(
        hsinchu,
        "2026-12-01",
        "2026-12-31",
      );
      expect(new Set(hsinchuItems.map((item) => item.userId))).toEqual(
        new Set([String(lin.userId)]),
      );
    });
  });

  describe("B14 畫休開放 / 即將截止通知(注入時鐘)", () => {
    it("開放日當天 09:00 前不寄;09:00 寄給可以排這家店的排班人員(每家店各一則);重跑不重寄", async () => {
      await run(taipei("2026-11-15", "08:45"));
      expect(await recipientsOf(SCHEDULE_DAY_OFF_OPEN, zhongshan)).toEqual([]);

      await run(taipei("2026-11-15", "09:00"));
      await run(taipei("2026-11-15", "09:15"));
      expect(await recipientsOf(SCHEDULE_DAY_OFF_OPEN, zhongshan)).toEqual(
        ids(manager, wang, li, chen, lin),
      );
      expect(await recipientsOf(SCHEDULE_DAY_OFF_OPEN, hsinchu)).toEqual(
        ids(lin),
      );
      const notification = await connection
        .collection("notifications")
        .findOne<{ title: string; body: string }>({
          type: SCHEDULE_DAY_OFF_OPEN,
          orgId: zhongshan,
          recipientId: wang.userId,
        });
      expect(notification?.title).toBe("畫休開放:中山店");
      expect(notification?.body).toContain("2026-11-25");
      expect(await recipientsOf(SCHEDULE_DAY_OFF_CLOSING, zhongshan)).toEqual(
        [],
      );
    });

    it("截止日前 1 天 09:00 寄「畫休即將截止」;其他日子不寄", async () => {
      await run(taipei("2026-11-20", "09:00"));
      expect(await recipientsOf(SCHEDULE_DAY_OFF_CLOSING, zhongshan)).toEqual(
        [],
      );
      await run(taipei("2026-11-24", "09:00"));
      expect(await recipientsOf(SCHEDULE_DAY_OFF_CLOSING, zhongshan)).toEqual(
        ids(manager, wang, li, chen, lin),
      );
    });

    it("開放期間照各店的規則:新竹店自訂 1–10 日 → 12/1 09:00 寄 1 月的畫休開放", async () => {
      const customized = await gql(hq, CUSTOMIZE_RULE, {
        input: {
          orgId: String(hsinchu),
          key: "dayOffWindow",
          value: { startDay: 1, endDay: 10 },
        },
      });
      expect(customized.errors).toBeUndefined();
      await run(taipei("2026-12-01", "09:00"));
      const rows = await connection
        .collection("notifications")
        .find<{ dedupeKey: string }>({
          type: SCHEDULE_DAY_OFF_OPEN,
          orgId: hsinchu,
        })
        .toArray();
      expect(rows.map((row) => row.dedupeKey)).toContainEqual(
        expect.stringContaining(":2027-01:"),
      );
      // 中山店維持 15 日開放:12/1 不寄
      expect(
        await connection.collection("notifications").countDocuments({
          type: SCHEDULE_DAY_OFF_OPEN,
          orgId: zhongshan,
          dedupeKey: { $regex: ":2027-01:" },
        }),
      ).toBe(0);
    });
  });
});
