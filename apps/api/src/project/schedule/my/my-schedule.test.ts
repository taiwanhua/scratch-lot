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

import { OperatorContextService } from "../../../auth/operator-context.service";
import {
  type AuthTestApp,
  type GraphqlResult,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { SCHEDULE_ATTENDANCE_PUNCHES_COLLECTION } from "../../database/schedule/schedule-attendance-punch.schema";
import { SCHEDULE_CHANGES_COLLECTION } from "../../database/schedule/schedule-change.schema";
import { SCHEDULE_DEMAND_TEMPLATES_COLLECTION } from "../../database/schedule/schedule-demand-template.schema";
import { SCHEDULE_DEMANDS_COLLECTION } from "../../database/schedule/schedule-demand.schema";
import { ScheduleEntryLock } from "../../database/schedule/schedule-entry-lock.schema";
import { SCHEDULE_ENTRIES_COLLECTION } from "../../database/schedule/schedule-entry.schema";
import { SCHEDULE_PERIODS_COLLECTION } from "../../database/schedule/schedule-period.schema";
import { SCHEDULE_TASK_ASSIGNMENTS_COLLECTION } from "../../database/schedule/schedule-task-assignment.schema";
import { ScheduleEntryLookup } from "../integration/entry-lookup";
import { ScheduleClock } from "../shared/schedule-clock";
import {
  SCHEDULE_TEST_PERMISSIONS as P,
  type ScheduleTestUser,
  createScheduleUser,
  seedScheduleAuthorization,
  seedScheduleFieldOptions,
} from "../test-support/fixtures";

// ---- GraphQL ----

const ENTRY_FIELDS = /* GraphQL */ `
  id
  orgName
  date
  startAt
  endAt
  breakMinutes
  shortName
  isLead
  positionKey
  tasks {
    role
    taskKey
    positionKey
  }
  clockIn
  clockOut
  missing
`;

const MY_SCHEDULE = /* GraphQL */ `
  query MySchedule($input: MyScheduleInput) {
    mySchedule(input: $input) {
      month
      today
      canPunch
      currentOrg { id name }
      entries { ${ENTRY_FIELDS} }
      punchCards { day entry { ${ENTRY_FIELDS} } }
      hasEntryToday
      openUnmatchedClockIn { id type entryId }
      incomplete { ${ENTRY_FIELDS} }
      changes {
        date
        action
        orgName
        beforeStartAt
        afterStartAt
        reason
        reasonNote
      }
      dayOffDates
    }
  }
`;

const PUNCH = /* GraphQL */ `
  mutation PunchMySchedule($input: PunchMyScheduleInput!) {
    punchMySchedule(input: $input) {
      id
      type
      at
      entryId
      orgId
      duplicate
    }
  }
`;

// ---- 型別 ----

interface EntryRow {
  id: string;
  orgName: string;
  date: string;
  shortName: string | null;
  isLead: boolean;
  positionKey: string | null;
  tasks: { role: string; taskKey: string; positionKey: string }[];
  clockIn: string | null;
  clockOut: string | null;
  missing: string[];
}

interface MyScheduleRow {
  month: string;
  today: string;
  canPunch: boolean;
  currentOrg: { id: string; name: string };
  entries: EntryRow[];
  punchCards: { day: string; entry: EntryRow }[];
  hasEntryToday: boolean;
  openUnmatchedClockIn: { id: string; type: string } | null;
  incomplete: EntryRow[];
  changes: {
    date: string;
    action: string;
    orgName: string;
    beforeStartAt: string | null;
    afterStartAt: string | null;
    reason: string;
    reasonNote: string | null;
  }[];
  dayOffDates: string[];
}

interface PunchRow {
  id: string;
  type: string;
  entryId: string | null;
  orgId: string;
  duplicate: boolean;
}

const base = () => {
  const now = new Date();
  return {
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
};

const taipei = (date: string, time: string) =>
  new Date(`${date}T${time}:00+08:00`);

function errorOf(result: GraphqlResult): Record<string, unknown> | undefined {
  return result.errors?.[0]?.extensions;
}

/**
 * 我的班表 → 班表分頁與打卡(規格 14.6)、給刮刮樂的排班查詢(14.9):打真的 GraphQL 端點、對真 MongoDB(TEST-07);
 * 「現在」由 `ScheduleClock` 注入。
 *
 * 組織樹:root ─ 租戶甲(包含下層)─┬─ 信義店(王的所屬組織)
 *                                   └─ 板橋店(王看不到;去支援)
 * 王的班:11/2 板橋店早班、11/4 信義店晚班、11/5 信義店早班(負責)— 11 月兩家店都已發布;
 * 12/3 信義店(12 月未發布)。
 */
describe("我的班表與打卡(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let clock: ScheduleClock;

  let tenant: Types.ObjectId;
  let xinyi: Types.ObjectId;
  let banqiao: Types.ObjectId;

  let wang: ScheduleTestUser;
  /** 只有 `schedule.my.view`(沒有打卡權限) */
  let lin: ScheduleTestUser;

  let nov2: Types.ObjectId;
  let nov4: Types.ObjectId;
  let nov5: Types.ObjectId;
  let dec3: Types.ObjectId;

  function gql(
    user: ScheduleTestUser,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<GraphqlResult> {
    return api.graphql(query, variables, { accessToken: user.token });
  }

  async function mySchedule(
    user: ScheduleTestUser,
    month?: string,
  ): Promise<MyScheduleRow> {
    const result = await gql(user, MY_SCHEDULE, {
      input: month === undefined ? null : { month },
    });
    expect(result.errors).toBeUndefined();
    return result.data?.mySchedule as MyScheduleRow;
  }

  async function punch(
    type: "in" | "out",
    entryId: Types.ObjectId | null,
    user: ScheduleTestUser = wang,
  ): Promise<GraphqlResult> {
    return gql(user, PUNCH, {
      input: { type, entryId: entryId === null ? null : String(entryId) },
    });
  }

  async function punched(
    type: "in" | "out",
    entryId: Types.ObjectId | null,
  ): Promise<PunchRow> {
    const result = await punch(type, entryId);
    expect(result.errors).toBeUndefined();
    return result.data?.punchMySchedule as PunchRow;
  }

  function now(date: string, time: string): void {
    jest.spyOn(clock, "now").mockReturnValue(taipei(date, time));
  }

  async function period(
    orgId: Types.ObjectId,
    month: string,
    status: string,
  ): Promise<void> {
    await connection.collection(SCHEDULE_PERIODS_COLLECTION).insertOne({
      orgId,
      tenantId: tenant,
      month,
      status,
      publishedAt: status === "published" ? new Date() : null,
      publishedBy: null,
      lockedAt: null,
      lockedBy: null,
      version: 0,
      moduleKey: "schedule.manage",
      ...base(),
    });
  }

  /** 一筆排班 + 它填進的人力需求(崗位、職責;`templateId` 給了 = 套用範本建的)。 */
  async function entry(
    user: ScheduleTestUser,
    orgId: Types.ObjectId,
    date: string,
    start: string,
    end: string,
    tasks: {
      role: "leader" | "helper";
      positionKey: string;
      start?: string;
      templateId?: Types.ObjectId;
    }[] = [{ role: "helper", positionKey: "in-store-counter" }],
  ): Promise<Types.ObjectId> {
    const { insertedId } = await connection
      .collection(SCHEDULE_ENTRIES_COLLECTION)
      .insertOne({
        orgId,
        tenantId: tenant,
        userId: user.userId,
        date,
        startAt: taipei(date, start),
        endAt: taipei(date, end),
        breakMinutes: 30,
        moduleKey: "schedule.manage",
        ...base(),
      });
    for (const [index, task] of tasks.entries()) {
      const taskId = `t${String(index)}`;
      const { insertedId: demandId } = await connection
        .collection(SCHEDULE_DEMANDS_COLLECTION)
        .insertOne({
          orgId,
          tenantId: tenant,
          date,
          startAt: taipei(date, task.start ?? start),
          endAt: taipei(date, end),
          positionKey: task.positionKey,
          tasks: [
            {
              taskId,
              role: task.role,
              taskKey:
                task.role === "leader"
                  ? "store-and-accounts-lead"
                  : "store-duties",
            },
          ],
          templateId: task.templateId ?? null,
          source: task.templateId === undefined ? "manual" : "template",
          moduleKey: "schedule.manage",
          ...base(),
        });
      await connection
        .collection(SCHEDULE_TASK_ASSIGNMENTS_COLLECTION)
        .insertOne({
          orgId,
          tenantId: tenant,
          entryId: insertedId,
          demandId,
          taskId,
          source: "manual",
          autoRunId: null,
          reason: null,
          moduleKey: "schedule.manage",
          ...base(),
        });
    }
    return insertedId;
  }

  const punchesOf = (entryId: Types.ObjectId) =>
    connection
      .collection(SCHEDULE_ATTENDANCE_PUNCHES_COLLECTION)
      .find<{
        type: string;
        duplicate: boolean;
        ip: string | null;
        source: string;
        orgId: Types.ObjectId;
      }>({ entryId })
      .sort({ at: 1 })
      .toArray();

  async function operatorOf(user: ScheduleTestUser) {
    const resolved = await api.app
      .get(OperatorContextService)
      .resolve(user.userId, xinyi);
    return resolved.operator;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-schedule-my");
    connection = api.connection;
    clock = api.app.get(ScheduleClock);
    await seedScheduleAuthorization(connection);
    await seedScheduleFieldOptions(connection);
    await api.app
      .get<Model<ScheduleEntryLock>>(getModelToken(ScheduleEntryLock.name))
      .init();

    tenant = await createOrg(connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    xinyi = await createOrg(connection, { name: "信義店", parentId: tenant });
    banqiao = await createOrg(connection, { name: "板橋店", parentId: tenant });

    wang = await createScheduleUser(
      api,
      connection,
      [xinyi],
      [P.myView, P.myPunch],
      "王小明",
    );
    lin = await createScheduleUser(
      api,
      connection,
      [xinyi],
      [P.myView],
      "林小美",
    );

    const { insertedId: morning } = await connection
      .collection(SCHEDULE_DEMAND_TEMPLATES_COLLECTION)
      .insertOne({
        orgId: tenant,
        tenantId: tenant,
        name: "早班",
        shortName: "早",
        startTime: "08:30",
        endTime: "14:30",
        positionKey: "in-store-counter",
        tasks: [],
        paletteKey: null,
        moduleKey: "schedule.settings",
        ...base(),
      });

    await period(xinyi, "2026-11", "published");
    await period(banqiao, "2026-11", "published");
    await period(xinyi, "2026-12", "unpublished");
    nov2 = await entry(wang, banqiao, "2026-11-02", "08:00", "14:30");
    nov4 = await entry(wang, xinyi, "2026-11-04", "14:30", "22:00");
    nov5 = await entry(wang, xinyi, "2026-11-05", "08:30", "14:30", [
      { role: "helper", positionKey: "restock" },
      {
        role: "leader",
        positionKey: "in-store-counter",
        start: "09:00",
        templateId: morning,
      },
    ]);
    dec3 = await entry(wang, xinyi, "2026-12-03", "08:30", "14:30");
    await entry(lin, xinyi, "2026-11-05", "08:30", "14:30");
  }, HOOK_TIMEOUT_MS);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("班表:跨分店合併、職責與範本簡稱;打卡區 = 今天的班 + 昨天未打下班卡的班", async () => {
    now("2026-11-05", "10:00");
    const page = await mySchedule(wang);
    expect(page.month).toBe("2026-11");
    expect(page.today).toBe("2026-11-05");
    expect(page.canPunch).toBe(true);
    expect(page.currentOrg.name).toBe("信義店");
    expect(page.entries.map((item) => [item.date, item.orgName])).toEqual([
      ["2026-11-02", "板橋店"],
      ["2026-11-04", "信義店"],
      ["2026-11-05", "信義店"],
    ]);
    const today = page.entries.at(-1);
    expect(today).toMatchObject({
      shortName: "早",
      isLead: true,
      positionKey: "in-store-counter",
    });
    expect(today?.tasks.map((task) => task.role)).toEqual(["leader", "helper"]);
    expect(page.punchCards.map((card) => [card.day, card.entry.date])).toEqual([
      ["today", "2026-11-05"],
      ["yesterday", "2026-11-04"],
    ]);
    expect(page.hasEntryToday).toBe(true);
  });

  it("打卡不完整:已結束的班缺卡 → 列出;還沒結束 → 不列(注入時鐘)", async () => {
    now("2026-11-04", "20:00");
    const evening = await mySchedule(wang);
    // 11/4 晚班還沒結束 → 不列;11/2 早班已結束、上下班都沒打
    expect(evening.incomplete.map((item) => [item.date, item.missing])).toEqual(
      [["2026-11-02", ["in", "out"]]],
    );

    now("2026-11-05", "10:00");
    const next = await mySchedule(wang);
    expect(next.incomplete.map((item) => [item.date, item.missing])).toEqual([
      ["2026-11-02", ["in", "out"]],
      ["2026-11-04", ["in", "out"]],
    ]);
    // 11/5 早班還沒結束:不算缺卡
    expect(next.entries.at(-1)?.missing).toEqual([]);

    // 只看最近 7 天(11/3–11/9):11/2 不再提醒
    now("2026-11-09", "10:00");
    const later = await mySchedule(wang, "2026-11");
    expect(later.incomplete.map((item) => item.date)).toEqual([
      "2026-11-04",
      "2026-11-05",
    ]);
  });

  it("未發布的月份我的班表看不到;未發布的班不能打卡", async () => {
    now("2026-12-03", "09:00");
    const december = await mySchedule(wang, "2026-12");
    expect(december.entries).toEqual([]);
    expect(december.punchCards).toEqual([]);
    expect(december.hasEntryToday).toBe(false);
    expect(errorOf(await punch("in", dec3))?.code).toBe("NOT_FOUND");
  });

  it("同一班打兩次上班卡 → 第二筆標重複;上班取最早、下班取最晚", async () => {
    now("2026-11-05", "08:24");
    const first = await punched("in", nov5);
    expect(first).toMatchObject({ type: "in", duplicate: false });
    expect(first.orgId).toBe(String(xinyi));
    now("2026-11-05", "08:31");
    expect(await punched("in", nov5)).toMatchObject({ duplicate: true });

    now("2026-11-05", "14:30");
    const out1 = await punched("out", nov5);
    expect(out1.duplicate).toBe(false);
    now("2026-11-05", "14:36");
    const out2 = await punched("out", nov5);
    expect(out2.duplicate).toBe(false);

    // 較早的下班卡改標重複
    const afterOut = await punchesOf(nov5);
    expect(afterOut.map((item) => [item.type, item.duplicate])).toEqual([
      ["in", false],
      ["in", true],
      ["out", true],
      ["out", false],
    ]);
    const stored = await punchesOf(nov5);
    expect(stored.every((item) => item.source === "button")).toBe(true);
    expect(stored.every((item) => typeof item.ip === "string")).toBe(true);

    now("2026-11-05", "15:00");
    const page = await mySchedule(wang);
    const today = page.entries.find((item) => item.id === String(nov5));
    expect(today?.clockIn).toBe(taipei("2026-11-05", "08:24").toISOString());
    expect(today?.clockOut).toBe(taipei("2026-11-05", "14:36").toISOString());
    expect(today?.missing).toEqual([]);
  });

  it("昨天未打下班卡的班:只能打下班卡,打了之後就不在打卡區;跨店的班照樣打(寫在班的分店)", async () => {
    now("2026-11-05", "09:00");
    expect(errorOf(await punch("in", nov4))?.code).toBe("VALIDATION_FAILED");
    await punched("out", nov4);
    const page = await mySchedule(wang);
    expect(page.punchCards.map((card) => card.day)).toEqual(["today"]);
    // 兩天前的班不能打
    expect(errorOf(await punch("out", nov2))?.code).toBe("VALIDATION_FAILED");

    now("2026-11-03", "09:00");
    // 11/2 板橋店的班(王看不到板橋店)在隔天照樣打下班卡,記在板橋店
    const cross = await punched("out", nov2);
    expect(cross.orgId).toBe(String(banqiao));
  });

  it("沒有排班:未對應排班的卡記在當前組織;打了上班卡、還沒打下班卡 → 醒目顯示", async () => {
    now("2026-11-06", "09:00");
    const clockIn = await punched("in", null);
    expect(clockIn).toMatchObject({
      entryId: null,
      orgId: String(xinyi),
      duplicate: false,
    });
    const page = await mySchedule(wang);
    expect(page.hasEntryToday).toBe(false);
    expect(page.openUnmatchedClockIn?.id).toBe(clockIn.id);
    now("2026-11-06", "13:00");
    await punched("out", null);
    const closed = await mySchedule(wang);
    expect(closed.openUnmatchedClockIn).toBeNull();
  });

  it("經過 Cloud Run 前端代理:記下 X-Forwarded-For 最右邊的客戶端 IP", async () => {
    now("2026-11-07", "09:00");
    const result = await api.graphql(
      PUNCH,
      { input: { type: "in", entryId: null } },
      {
        accessToken: wang.token,
        headers: {
          "X-Forwarded-For": "198.51.100.9, 203.0.113.7",
          "User-Agent": "punch-test",
        },
      },
    );
    expect(result.errors).toBeUndefined();
    const id = (result.data?.punchMySchedule as PunchRow).id;
    const stored = await connection
      .collection(SCHEDULE_ATTENDANCE_PUNCHES_COLLECTION)
      .findOne({ _id: new Types.ObjectId(id) });
    expect(stored).toMatchObject({
      ip: "203.0.113.7",
      userAgent: "punch-test",
    });
  });

  it("沒有 schedule.my.punch:看不到打卡按鈕(canPunch = false),打卡被擋", async () => {
    now("2026-11-05", "09:00");
    const page = await mySchedule(lin);
    expect(page.canPunch).toBe(false);
    expect(page.punchCards).toHaveLength(1);
    expect(errorOf(await punch("in", null, lin))?.code).toBe("FORBIDDEN");
  });

  it("最近異動:只列還沒到的班,附原因", async () => {
    const row = (date: string, reasonKey: string) => ({
      orgId: xinyi,
      tenantId: tenant,
      month: date.slice(0, 7),
      date,
      action: "entry.edit",
      targetId: new Types.ObjectId(),
      userIds: [wang.userId],
      before: {
        startAt: taipei(date, "14:30"),
        endAt: taipei(date, "22:00"),
      },
      after: { startAt: taipei(date, "08:30"), endAt: taipei(date, "14:30") },
      reasonKey,
      reasonNote: reasonKey === "other" ? "臨時請假" : null,
      moduleKey: "schedule.manage",
      ...base(),
    });
    await connection
      .collection(SCHEDULE_CHANGES_COLLECTION)
      .insertMany([
        row("2026-11-04", "shift-swap"),
        row("2026-11-08", "shift-swap"),
        row("2026-11-12", "other"),
      ]);
    now("2026-11-05", "09:00");
    const page = await mySchedule(wang);
    expect(
      page.changes
        .map((item) => [item.date, item.reason, item.reasonNote])
        .toSorted((left, right) =>
          String(left[0]).localeCompare(String(right[0])),
        ),
    ).toEqual([
      ["2026-11-08", "shift-swap", null],
      ["2026-11-12", "other", "臨時請假"],
    ]);
    expect(page.changes[0]?.beforeStartAt).not.toBeNull();
    expect(page.changes[0]?.orgName).toBe("信義店");
  });

  describe("給刮刮樂的排班查詢(integration/entry-lookup.ts)", () => {
    it("findEntryForShift:容許範圍內取上班最接近;都超過 → null;未發布不算", async () => {
      const lookup = api.app.get(ScheduleEntryLookup);
      const operator = await operatorOf(wang);
      const scope = { tenantId: tenant, userId: wang.userId, orgId: xinyi };
      const early = await lookup.findEntryForShift(operator, {
        ...scope,
        at: taipei("2026-11-05", "07:45"),
      });
      expect(early?.id).toBe(String(nov5));
      expect(
        await lookup.findEntryForShift(operator, {
          ...scope,
          at: taipei("2026-11-05", "07:29"),
        }),
      ).toBeNull();
      expect(
        await lookup.findEntryForShift(operator, {
          ...scope,
          at: taipei("2026-12-03", "09:00"),
        }),
      ).toBeNull();
      const day = await lookup.listEntriesOfDay(operator, {
        ...scope,
        date: "2026-11-05",
      });
      expect(day.map((item) => [item.id, item.shortName])).toEqual([
        [String(nov5), "早"],
      ]);
    });

    it("taskSnapshotFor:收銀點崗位那一筆;沒有同崗位 → null", async () => {
      const lookup = api.app.get(ScheduleEntryLookup);
      const operator = await operatorOf(wang);
      expect(
        await lookup.taskSnapshotFor(operator, {
          tenantId: tenant,
          entryId: nov5,
          positionKey: "in-store-counter",
        }),
      ).toMatchObject({ role: "leader", taskKey: "store-and-accounts-lead" });
      expect(
        await lookup.taskSnapshotFor(operator, {
          tenantId: tenant,
          entryId: nov5,
          positionKey: "outdoor-stall",
        }),
      ).toBeNull();
    });

    it("punchStart:只能替自己打今天這一班的上班卡", async () => {
      now("2026-11-05", "09:10");
      const lookup = api.app.get(ScheduleEntryLookup);
      const operator = await operatorOf(wang);
      const meta = { ip: null, userAgent: "pos" };
      const result = await lookup.punchStart(
        operator,
        { userId: wang.userId, entryId: nov5 },
        meta,
      );
      expect(result).toMatchObject({ type: "in", entryId: String(nov5) });
      await expect(
        lookup.punchStart(
          operator,
          { userId: lin.userId, entryId: nov5 },
          meta,
        ),
      ).rejects.toThrow("can only punch for yourself");
      // 沒有 schedule.my.punch(林只有 view):擋下
      const linOperator = await operatorOf(lin);
      await expect(
        lookup.punchStart(
          linOperator,
          { userId: lin.userId, entryId: nov5 },
          meta,
        ),
      ).rejects.toThrow("missing permission schedule.my.punch");
    });
  });
});
