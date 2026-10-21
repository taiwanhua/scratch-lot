import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import { type Connection, type Model, Types } from "mongoose";

import {
  type AuthTestApp,
  type GraphqlResult,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { SCHEDULE_ATTENDANCE_PUNCHES_COLLECTION } from "../../database/schedule/schedule-attendance-punch.schema";
import { SCHEDULE_CHANGES_COLLECTION } from "../../database/schedule/schedule-change.schema";
import { SCHEDULE_DAY_OFFS_COLLECTION } from "../../database/schedule/schedule-day-off.schema";
import { ScheduleEntryLock } from "../../database/schedule/schedule-entry-lock.schema";
import { ScheduleTaskAssignment } from "../../database/schedule/schedule-task-assignment.schema";
import { SCHEDULE_CHANGED, SCHEDULE_PUBLISHED } from "../../notifications";
import {
  ALL_SCHEDULE_TEST_PERMISSIONS,
  SCHEDULE_TEST_PERMISSIONS as P,
  type ScheduleTestUser,
  createScheduleUser,
  seedScheduleAuthorization,
  seedScheduleFieldOptions,
} from "../test-support/fixtures";

// ---- GraphQL ----

const CHECK = /* GraphQL */ `
  query ScheduleCheck($input: ScheduleRosterInput!) {
    scheduleCheck(input: $input) {
      limitCount
      reminderCount
      items {
        key
        level
        userId
        userName
        date
        entryIds
        actual
        limit
        from
        to
        isOtherStore
        orgName
        understaffed {
          role
          missing
          available
          dayOff
          timeRange
          occupied
          cannotLead
        }
      }
    }
  }
`;

const PUBLISH = /* GraphQL */ `
  mutation PublishSchedule($input: PublishScheduleInput!) {
    publishSchedule(input: $input) {
      period {
        status
        publishedAt
        publishedByName
      }
      notifiedCount
    }
  }
`;

const ROSTER_PERIOD = /* GraphQL */ `
  query ScheduleRoster($input: ScheduleRosterInput!) {
    scheduleRoster(input: $input) {
      period {
        status
      }
      entries {
        id
        userId
        date
      }
    }
  }
`;

const SAVE_DEMAND = /* GraphQL */ `
  mutation SaveScheduleDemand($input: SaveScheduleDemandInput!) {
    saveScheduleDemand(input: $input) {
      item {
        id
        tasks {
          taskId
          role
        }
      }
    }
  }
`;

const SAVE_ENTRY = /* GraphQL */ `
  mutation SaveScheduleEntry($input: SaveScheduleEntryInput!) {
    saveScheduleEntry(input: $input) {
      item {
        id
      }
    }
  }
`;

const DELETE_ENTRY = /* GraphQL */ `
  mutation DeleteScheduleEntry($input: DeleteScheduleEntryInput!) {
    deleteScheduleEntry(input: $input) {
      id
    }
  }
`;

const REMOVE_DAY = /* GraphQL */ `
  mutation RemoveScheduleDayEntries($input: RemoveScheduleDayEntriesInput!) {
    removeScheduleDayEntries(input: $input) {
      deletedIds
      skippedIds
    }
  }
`;

const ADD_STAFF = /* GraphQL */ `
  mutation AddScheduleStaff($input: AddScheduleStaffInput!) {
    addScheduleStaff(input: $input) {
      items {
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

const MUTATION_FIELDS = /* GraphQL */ `
  query MutationFields {
    __type(name: "Mutation") {
      fields {
        name
      }
    }
  }
`;

// ---- 型別 ----

interface CheckItemRow {
  key: string;
  level: string;
  userId: string | null;
  userName: string | null;
  date: string;
  entryIds: string[];
  actual: number | null;
  limit: number | null;
  from: string | null;
  to: string | null;
  isOtherStore: boolean;
  orgName: string | null;
  understaffed: {
    role: string;
    missing: number;
    available: number;
    dayOff: number;
    timeRange: number;
    occupied: number;
    cannotLead: number;
  } | null;
}

interface CheckRow {
  limitCount: number;
  reminderCount: number;
  items: CheckItemRow[];
}

interface DemandRow {
  id: string;
  tasks: { taskId: string; role: string }[];
}

function errorOf(result: GraphqlResult): Record<string, unknown> | undefined {
  return result.errors?.[0]?.extensions;
}

interface Payloads {
  scheduleCheck: CheckRow;
  publishSchedule: {
    period: { status: string; publishedByName: string | null };
    notifiedCount: number;
  };
  scheduleRoster: {
    period: { status: string };
    entries: { id: string; date: string; userId: string }[];
  };
  saveScheduleDemand: { item: DemandRow };
  saveScheduleEntry: { item: { id: string } };
  addScheduleStaff: { items: { staff: { id: string } }[] };
  removeScheduleDayEntries: { deletedIds: string[] };
  __type: { fields: { name: string }[] };
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

const taipei = (date: string, time: string) =>
  new Date(`${date}T${time}:00+08:00`).toISOString();

const taskOf = (demand: DemandRow, role: string) => {
  const task = demand.tasks.find((item) => item.role === role);
  if (!task) {
    throw new Error(`沒有 ${role} 任務`);
  }
  return task.taskId;
};

const LEAD = "store-and-accounts-lead";
const DUTY = "store-duties";
const COUNTER = "in-store-counter";
const SWAP = { reasonKey: "shift-swap" };

/**
 * 檢核與發布(規格 14.2 等級、14.5「檢核面板」「發布」、14.1 `schedule_changes`、3.4 排班發布 / 異動):
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07)。
 *
 * 組織樹:root ─ 租戶乙(包含下層)─┬─ 信義店(王:主要、可負責;李:主要;陳:可以排)
 *                                   └─ 板橋店(陳:主要)
 * 每個情境用不同的月份(連續上班 / 休息會看前後一個月),彼此不干擾。
 * 「每月最少畫休」(預設限制 4 天)在最上層組織調成 0,不然沒畫休的人都會擋發布。
 */
describe("排班檢核與發布(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;

  let tenant: Types.ObjectId;
  let xinyi: Types.ObjectId;
  let banqiao: Types.ObjectId;

  let hq: ScheduleTestUser;
  /** 信義店店長:排班表 view + edit,沒有 publish */
  let manager: ScheduleTestUser;
  let wang: ScheduleTestUser;
  let li: ScheduleTestUser;
  let chen: ScheduleTestUser;

  function gql(
    user: ScheduleTestUser,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<GraphqlResult> {
    return api.graphql(query, variables, { accessToken: user.token });
  }

  async function check(month: string, orgId = xinyi): Promise<CheckRow> {
    return dataOf(
      await gql(hq, CHECK, { input: { orgId: String(orgId), month } }),
      "scheduleCheck",
    );
  }

  function publish(
    month: string,
    user: ScheduleTestUser = hq,
  ): Promise<GraphqlResult> {
    return gql(user, PUBLISH, { input: { orgId: String(xinyi), month } });
  }

  async function demandOn(
    date: string,
    start: string,
    end: string,
    roles: ("leader" | "helper")[] = ["leader"],
    orgId = xinyi,
    endDate = date,
  ): Promise<DemandRow> {
    return dataOf(
      await gql(hq, SAVE_DEMAND, {
        input: {
          orgId: String(orgId),
          positionKey: COUNTER,
          startAt: taipei(date, start),
          endAt: taipei(endDate, end),
          tasks: roles.map((role) => ({
            role,
            taskKey: role === "leader" ? LEAD : DUTY,
          })),
        },
      }),
      "saveScheduleDemand",
    ).item;
  }

  /** 某人某天一筆排班(那天新建一筆同時段的人力需求並填進去)。 */
  function entryOn(
    person: ScheduleTestUser,
    date: string,
    start: string,
    end: string,
    options: {
      orgId?: Types.ObjectId;
      breakMinutes?: number;
      role?: "leader" | "helper";
      changeReason?: Record<string, unknown>;
      endDate?: string;
      /** 填進已建好的人力需求(已發布的月份先在發布前建好) */
      demand?: DemandRow;
    } = {},
  ): Promise<GraphqlResult> {
    const orgId = options.orgId ?? xinyi;
    const role = options.role ?? "helper";
    const ready =
      options.demand === undefined
        ? demandOn(date, start, end, [role], orgId, options.endDate)
        : Promise.resolve(options.demand);
    return ready.then((demand) =>
      gql(hq, SAVE_ENTRY, {
        input: {
          orgId: String(orgId),
          userId: String(person.userId),
          startAt: taipei(date, start),
          endAt: taipei(options.endDate ?? date, end),
          breakMinutes: options.breakMinutes ?? 0,
          assignments: [{ demandId: demand.id, taskId: taskOf(demand, role) }],
          ...(options.changeReason === undefined
            ? {}
            : { changeReason: options.changeReason }),
        },
      }),
    );
  }

  async function entryIdOn(
    person: ScheduleTestUser,
    date: string,
    start: string,
    end: string,
    options: Parameters<typeof entryOn>[4] = {},
  ): Promise<string> {
    return dataOf(
      await entryOn(person, date, start, end, options),
      "saveScheduleEntry",
    ).item.id;
  }

  async function customize(
    key: string,
    input: Record<string, unknown>,
    orgId = tenant,
  ): Promise<void> {
    const result = await gql(hq, CUSTOMIZE_RULE, {
      input: { orgId: String(orgId), key, ...input },
    });
    expect(result.errors).toBeUndefined();
  }

  async function joinSchedule(
    user: ScheduleTestUser,
    orgs: { orgId: Types.ObjectId; isPrimary: boolean; canLead: boolean }[],
  ): Promise<void> {
    const added = dataOf(
      await gql(hq, ADD_STAFF, { input: { userIds: [String(user.userId)] } }),
      "addScheduleStaff",
    );
    const updated = await gql(hq, UPDATE_STAFF, {
      input: {
        staffId: added.items[0]?.staff.id,
        orgs: orgs.map((org) => ({ ...org, orgId: String(org.orgId) })),
      },
    });
    expect(updated.errors).toBeUndefined();
  }

  async function insertDayOff(
    user: ScheduleTestUser,
    date: string,
    kind: "full-day" | "time-range",
  ): Promise<void> {
    const now = new Date();
    await connection.collection(SCHEDULE_DAY_OFFS_COLLECTION).insertOne({
      orgId: xinyi,
      tenantId: tenant,
      userId: user.userId,
      date,
      kind,
      startTime: kind === "time-range" ? "09:00" : null,
      endTime: kind === "time-range" ? "13:00" : null,
      note: null,
      by: null,
      reason: null,
      reasonNote: null,
      moduleKey: "schedule.my",
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
      deletedAt: null,
    });
  }

  const notificationsOf = (type: string, userId: Types.ObjectId) =>
    connection
      .collection("notifications")
      .find<{ title: string; body: string }>({ type, recipientId: userId })
      .toArray();

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-schedule-check");
    connection = api.connection;
    await seedScheduleAuthorization(connection);
    await seedScheduleFieldOptions(connection);
    await api.app
      .get<Model<ScheduleTaskAssignment>>(
        getModelToken(ScheduleTaskAssignment.name),
      )
      .init();
    await api.app
      .get<Model<ScheduleEntryLock>>(getModelToken(ScheduleEntryLock.name))
      .init();

    tenant = await createOrg(connection, {
      name: "租戶乙",
      settings: { visibility: "subtree" },
    });
    xinyi = await createOrg(connection, { name: "信義店", parentId: tenant });
    banqiao = await createOrg(connection, { name: "板橋店", parentId: tenant });

    hq = await createScheduleUser(
      api,
      connection,
      [tenant],
      ALL_SCHEDULE_TEST_PERMISSIONS,
    );
    manager = await createScheduleUser(
      api,
      connection,
      [xinyi],
      [P.manageView, P.manageEdit],
      "信義店長",
    );
    wang = await createScheduleUser(api, connection, [xinyi], [], "王小明");
    li = await createScheduleUser(api, connection, [xinyi], [], "李小華");
    chen = await createScheduleUser(api, connection, [banqiao], [], "陳大文");

    await joinSchedule(wang, [
      { orgId: xinyi, isPrimary: true, canLead: true },
    ]);
    await joinSchedule(li, [{ orgId: xinyi, isPrimary: true, canLead: false }]);
    await joinSchedule(chen, [
      { orgId: banqiao, isPrimary: true, canLead: true },
      { orgId: xinyi, isPrimary: false, canLead: false },
    ]);
    await customize("minMonthlyDayOffs", { value: { amount: 0 } });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("檢核(規格 14.2、14.5 檢核面板)", () => {
    it("人力不足:空的執行任務依職責各一項,附可排人數與原因;店的規則捲到那一天", async () => {
      await demandOn("2026-11-05", "14:30", "22:00", ["leader", "helper"]);
      await insertDayOff(li, "2026-11-05", "full-day");
      const result = await check("2026-11");
      const understaffed = result.items.filter(
        (item) => item.key === "understaffed",
      );
      expect(
        understaffed.map((item) => [item.understaffed?.role, item.date]),
      ).toEqual([
        ["leader", "2026-11-05"],
        ["helper", "2026-11-05"],
      ]);
      // 負責:李不能負責(先算)、陳在信義店不能負責 → 可排 1(王)
      expect(understaffed[0]?.understaffed).toMatchObject({
        missing: 1,
        available: 1,
        cannotLead: 2,
      });
      // 協同:李整天畫休 → 可排 2(王、陳)
      expect(understaffed[1]?.understaffed).toMatchObject({
        available: 2,
        dayOff: 1,
      });
      expect(understaffed[0]?.userId).toBeNull();
      expect(understaffed[0]?.level).toBe("reminder");
    });

    it("每天最多上班時數:同一人兩家店同一天加總;違反列在有這家店排班的那天", async () => {
      await entryIdOn(chen, "2026-11-10", "08:00", "13:00", {
        orgId: banqiao,
        role: "leader",
      });
      const evening = await entryIdOn(chen, "2026-11-10", "16:00", "20:00");
      const { items } = await check("2026-11");
      const item = items.find((row) => row.key === "maxDailyWorkHours");
      expect(item).toMatchObject({
        level: "reminder",
        userName: "陳大文",
        date: "2026-11-10",
        actual: 9,
        limit: 8,
      });
      expect(item?.entryIds).toContain(evening);
    });

    it("畫休日有排班(先排班、後登記畫休):列出人 × 日,含跨店;看不到的分店名稱由 api 判斷", async () => {
      await entryIdOn(wang, "2026-11-12", "09:00", "17:00", { role: "leader" });
      await insertDayOff(wang, "2026-11-12", "time-range");
      const { items } = await check("2026-11");
      const item = items.find((row) => row.key === "dayOffEntryConflict");
      expect(item).toMatchObject({
        level: "reminder",
        userName: "王小明",
        date: "2026-11-12",
        isOtherStore: false,
        orgName: "信義店",
      });
    });

    it("未對應排班的打卡:提醒,一人一天一項(張數);不影響發布", async () => {
      const now = new Date();
      for (const time of ["09:02", "15:10"]) {
        await connection
          .collection(SCHEDULE_ATTENDANCE_PUNCHES_COLLECTION)
          .insertOne({
            orgId: xinyi,
            tenantId: tenant,
            userId: wang.userId,
            at: new Date(`2026-11-13T${time}:00+08:00`),
            type: time === "09:02" ? "in" : "out",
            entryId: null,
            ip: null,
            userAgent: null,
            source: "button",
            makeupRequestId: null,
            duplicate: false,
            moduleKey: "schedule.attendance",
            createdAt: now,
            updatedAt: now,
            createdBy: null,
            updatedBy: null,
            deletedAt: null,
          });
      }
      const { items } = await check("2026-11");
      expect(items.filter((row) => row.key === "unmatchedPunches")).toEqual([
        expect.objectContaining({
          level: "reminder",
          userName: "王小明",
          date: "2026-11-13",
          actual: 2,
        }),
      ]);
    });

    it("排序:限制在前、提醒在後", async () => {
      await customize("maxDailyWorkHours", { level: "limit" });
      const result = await check("2026-11");
      expect(result.limitCount).toBeGreaterThan(0);
      expect(result.items[0]?.level).toBe("limit");
      const levels = result.items.map((item) => item.level);
      expect(levels.lastIndexOf("limit")).toBeLessThan(
        levels.indexOf("reminder"),
      );
      await customize("maxDailyWorkHours", { level: "reminder" });
    });
  });

  describe("等級(規格 14.2:限制 → 不能存、不能發布;提醒 → 可存可發布)", () => {
    it("提醒:超過每天最多上班時數照樣存;限制:存檔後更嚴重 → VALIDATION_FAILED(欄位 rules)", async () => {
      const saved = await entryOn(li, "2027-02-03", "08:00", "18:00");
      expect(saved.errors).toBeUndefined();

      await customize("maxDailyWorkHours", { level: "limit" });
      const blocked = await entryOn(li, "2027-02-04", "08:00", "18:00");
      expect(errorOf(blocked)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["rules"],
      });
      const violations = errorOf(blocked)?.violations as {
        key: string;
        level: string;
        actual: number;
      }[];
      expect(violations).toEqual([
        expect.objectContaining({
          key: "maxDailyWorkHours",
          level: "limit",
          actual: 10,
        }),
      ]);
      // 剛好 8 小時不擋
      const ok = await entryOn(li, "2027-02-05", "08:00", "16:00");
      expect(ok.errors).toBeUndefined();
    });

    it("改規則不改已排的班,只重新標示;有限制 → 不能發布(HAS_LIMIT_VIOLATIONS)", async () => {
      // 上一個情境在提醒時存的 10 小時那筆仍在,改成限制後被標成限制
      const roster = dataOf(
        await gql(hq, ROSTER_PERIOD, {
          input: { orgId: String(xinyi), month: "2027-02" },
        }),
        "scheduleRoster",
      );
      expect(
        roster.entries.some(
          (entry) =>
            entry.date === "2027-02-03" && entry.userId === String(li.userId),
        ),
      ).toBe(true);
      const result = await check("2027-02");
      expect(
        result.items.find((item) => item.key === "maxDailyWorkHours"),
      ).toMatchObject({ level: "limit", date: "2027-02-03" });

      const blocked = await publish("2027-02");
      expect(errorOf(blocked)).toMatchObject({
        code: "VALIDATION_FAILED",
        reason: "HAS_LIMIT_VIOLATIONS",
      });
      const period = dataOf(
        await gql(hq, ROSTER_PERIOD, {
          input: { orgId: String(xinyi), month: "2027-02" },
        }),
        "scheduleRoster",
      );
      expect(period.period.status).toBe("unpublished");
      await customize("maxDailyWorkHours", { level: "reminder" });
    });
  });

  describe("發布(規格 14.5 發布、3.4 排班發布)", () => {
    it("只有提醒 → 照樣發布;通知這個月被排到的人;已發布不能再發布、沒有取消發布的端點", async () => {
      await entryIdOn(wang, "2027-05-04", "09:00", "17:00", { role: "leader" });
      await demandOn("2027-05-06", "09:00", "17:00", ["helper"]);
      const before = await check("2027-05");
      expect(before.limitCount).toBe(0);
      expect(before.reminderCount).toBeGreaterThan(0);

      const published = dataOf(await publish("2027-05"), "publishSchedule");
      expect(published.period.status).toBe("published");
      expect(published.notifiedCount).toBe(1);
      const notes = await notificationsOf(SCHEDULE_PUBLISHED, wang.userId);
      expect(notes.map((note) => note.title)).toEqual(["排班發布:信義店"]);
      expect(await notificationsOf(SCHEDULE_PUBLISHED, li.userId)).toHaveLength(
        0,
      );

      const again = await publish("2027-05");
      expect(errorOf(again)).toMatchObject({ reason: "ALREADY_PUBLISHED" });
      const fields = dataOf(await gql(hq, MUTATION_FIELDS), "__type");
      expect(
        fields.fields.filter((field) => /unpublish/iu.test(field.name)),
      ).toEqual([]);
    });

    it("全部符合 → 發布;沒有任何排班 → 通知 0 人", async () => {
      const { items } = await check("2027-11");
      expect(items).toEqual([]);
      const published = dataOf(await publish("2027-11"), "publishSchedule");
      expect(published.notifiedCount).toBe(0);
    });

    it("沒有 publish 權限 → FORBIDDEN", async () => {
      const result = await publish("2027-12", manager);
      expect(errorOf(result)).toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("發布後異動(規格 14.5:異動原因必填、寫 schedule_changes、通知當事人)", () => {
    const month = "2027-08";
    let entryId: string;
    let day11: DemandRow;
    let day12: DemandRow;
    let day20: DemandRow;

    beforeAll(async () => {
      entryId = await entryIdOn(li, "2027-08-10", "09:00", "15:00");
      day11 = await demandOn("2027-08-11", "09:00", "15:00", ["helper"]);
      day12 = await demandOn("2027-08-12", "09:00", "15:00", ["helper"]);
      day20 = await demandOn("2027-08-20", "09:00", "15:00", [
        "leader",
        "helper",
      ]);
      const published = await publish(month);
      expect(published.errors).toBeUndefined();
    });

    it("沒有原因 → VALIDATION_FAILED(reasonKey);選「其他」沒說明 → reasonNote;停用的選項 → reasonKey", async () => {
      const missing = await entryOn(li, "2027-08-11", "09:00", "15:00", {
        demand: day11,
      });
      expect(errorOf(missing)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["reasonKey"],
      });
      const other = await entryOn(li, "2027-08-11", "09:00", "15:00", {
        demand: day11,
        changeReason: { reasonKey: "other" },
      });
      expect(errorOf(other)).toMatchObject({ fields: ["reasonNote"] });
      const retired = await entryOn(li, "2027-08-11", "09:00", "15:00", {
        demand: day11,
        changeReason: { reasonKey: "retired-reason" },
      });
      expect(errorOf(retired)).toMatchObject({ fields: ["reasonKey"] });
      expect(
        await connection
          .collection(SCHEDULE_CHANGES_COLLECTION)
          .countDocuments({ month }),
      ).toBe(0);
    });

    it("有原因 → 寫 schedule_changes 並通知當事人(新增、刪除各一列)", async () => {
      const created = await entryIdOn(li, "2027-08-12", "09:00", "15:00", {
        demand: day12,
        changeReason: SWAP,
      });
      const removed = await gql(hq, DELETE_ENTRY, {
        input: {
          orgId: String(xinyi),
          id: entryId,
          changeReason: { reasonKey: "other", reasonNote: "颱風" },
        },
      });
      expect(removed.errors).toBeUndefined();
      const rows = await connection
        .collection(SCHEDULE_CHANGES_COLLECTION)
        .find<{
          action: string;
          targetId: Types.ObjectId;
          userIds: Types.ObjectId[];
          reasonKey: string;
          reasonNote: string | null;
          date: string;
        }>({ month })
        .sort({ createdAt: 1 })
        .toArray();
      expect(
        rows.map((row) => [
          row.action,
          String(row.targetId),
          row.userIds.map(String),
          row.reasonKey,
          row.reasonNote,
        ]),
      ).toEqual([
        ["entry.create", created, [String(li.userId)], "shift-swap", null],
        ["entry.delete", entryId, [String(li.userId)], "other", "颱風"],
      ]);
      const notes = await notificationsOf(SCHEDULE_CHANGED, li.userId);
      expect(notes.map((note) => note.body)).toEqual([
        "「信義店」2027-08-12 的排班有異動。原因:shift-swap",
        "「信義店」2027-08-10 的排班有異動。原因:other(颱風)",
      ]);
    });

    it("移除這天所有排班:原因只填一次,每筆排班各記一列", async () => {
      await entryIdOn(wang, "2027-08-20", "09:00", "15:00", {
        role: "leader",
        demand: day20,
        changeReason: SWAP,
      });
      await entryIdOn(li, "2027-08-20", "09:00", "15:00", {
        demand: day20,
        changeReason: SWAP,
      });
      const noReason = await gql(hq, REMOVE_DAY, {
        input: { orgId: String(xinyi), date: "2027-08-20" },
      });
      expect(errorOf(noReason)).toMatchObject({ fields: ["reasonKey"] });
      const removed = dataOf(
        await gql(hq, REMOVE_DAY, {
          input: {
            orgId: String(xinyi),
            date: "2027-08-20",
            changeReason: SWAP,
          },
        }),
        "removeScheduleDayEntries",
      );
      expect(removed.deletedIds).toHaveLength(2);
      expect(
        await connection
          .collection(SCHEDULE_CHANGES_COLLECTION)
          .countDocuments({ date: "2027-08-20", action: "entry.delete" }),
      ).toBe(2);
    });

    it("未發布的月份不用原因、不記異動", async () => {
      const saved = await entryOn(li, "2027-09-02", "09:00", "15:00");
      expect(saved.errors).toBeUndefined();
      expect(
        await connection
          .collection(SCHEDULE_CHANGES_COLLECTION)
          .countDocuments({ month: "2027-09" }),
      ).toBe(0);
    });
  });
});
