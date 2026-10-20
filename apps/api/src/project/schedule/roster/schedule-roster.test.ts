import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
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
import { SCHEDULE_DAY_OFFS_COLLECTION } from "../../database/schedule/schedule-day-off.schema";
import { ScheduleEntryLock } from "../../database/schedule/schedule-entry-lock.schema";
import { ScheduleTaskAssignment } from "../../database/schedule/schedule-task-assignment.schema";
import {
  clearEntryDeletionGuardsForTest,
  registerEntryDeletionGuard,
} from "../integration/entry-deletion-guards";
import {
  ALL_SCHEDULE_TEST_PERMISSIONS,
  SCHEDULE_TEST_PERMISSIONS as P,
  type ScheduleTestUser,
  createScheduleUser,
  seedScheduleAuthorization,
  seedScheduleFieldOptions,
} from "../test-support/fixtures";

// ---- GraphQL ----

const DEMAND = /* GraphQL */ `
  id
  date
  startAt
  endAt
  positionKey
  templateId
  source
  tasks { taskId role taskKey entryId userId userName }
`;

const ENTRY = /* GraphQL */ `
  id
  userId
  date
  startAt
  endAt
  breakMinutes
  deletable
  assignments { demandId taskId role taskKey source }
`;

const ROSTER = /* GraphQL */ `
  query ScheduleRoster($input: ScheduleRosterInput!) {
    scheduleRoster(input: $input) {
      orgId
      month
      period { status }
      canEdit
      canSaveTemplate
      settings { breakTiers { minMinutes breakMinutes } defaultLeaderTaskKey defaultHelperTaskKey maxMonthlyDayOffs minMonthlyDayOffs }
      people {
        userId name canLead isCandidate
        stats { shiftCount leadShiftCount workMinutes dayOffDays fullDayOffDays longestStreak timeRangeDays { date slots { startTime endTime } } }
      }
      demands { ${DEMAND} }
      entries { ${ENTRY} }
      otherStoreEntries { userId date orgName }
      unavailability { userId date fullDay }
      templates { id shortName }
    }
  }
`;

const SAVE_DEMAND = /* GraphQL */ `
  mutation SaveScheduleDemand($input: SaveScheduleDemandInput!) {
    saveScheduleDemand(input: $input) {
      item { ${DEMAND} }
      deletedEntryIds
    }
  }
`;

const DELETE_DEMAND = /* GraphQL */ `
  mutation DeleteScheduleDemand($input: DeleteScheduleDemandInput!) {
    deleteScheduleDemand(input: $input) {
      id
      deletedEntryIds
    }
  }
`;

const SAVE_ENTRY = /* GraphQL */ `
  mutation SaveScheduleEntry($input: SaveScheduleEntryInput!) {
    saveScheduleEntry(input: $input) {
      item { ${ENTRY} }
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

const SAVE_CALENDAR_DAY = /* GraphQL */ `
  mutation SaveScheduleCalendarDay($input: SaveScheduleCalendarDayInput!) {
    saveScheduleCalendarDay(input: $input) {
      item {
        id
      }
    }
  }
`;

// ---- 型別 ----

interface TaskRow {
  taskId: string;
  role: string;
  taskKey: string;
  entryId: string | null;
  userId: string | null;
  userName: string | null;
}

interface DemandRow {
  id: string;
  date: string;
  startAt: string;
  endAt: string;
  positionKey: string;
  templateId: string | null;
  source: string;
  tasks: TaskRow[];
}

interface EntryRow {
  id: string;
  userId: string;
  date: string;
  breakMinutes: number;
  deletable: boolean;
  assignments: { demandId: string; taskId: string; role: string }[];
}

interface PersonRow {
  userId: string;
  name: string;
  canLead: boolean;
  isCandidate: boolean;
  stats: {
    shiftCount: number;
    leadShiftCount: number;
    workMinutes: number;
    dayOffDays: number;
    fullDayOffDays: number;
    longestStreak: number;
    timeRangeDays: {
      date: string;
      slots: { startTime: string; endTime: string }[];
    }[];
  };
}

interface RosterRow {
  orgId: string;
  month: string;
  period: { status: string };
  canEdit: boolean;
  canSaveTemplate: boolean;
  settings: {
    breakTiers: { minMinutes: number; breakMinutes: number }[];
    defaultLeaderTaskKey: string;
    defaultHelperTaskKey: string;
    maxMonthlyDayOffs: number | null;
    minMonthlyDayOffs: number | null;
  };
  people: PersonRow[];
  demands: DemandRow[];
  entries: EntryRow[];
  otherStoreEntries: { userId: string; date: string; orgName: string | null }[];
  unavailability: { userId: string; date: string; fullDay: boolean }[];
  templates: { id: string; shortName: string }[];
}

interface Payloads {
  scheduleRoster: RosterRow;
  saveScheduleDemand: { item: DemandRow; deletedEntryIds: string[] };
  deleteScheduleDemand: { id: string; deletedEntryIds: string[] };
  saveScheduleEntry: { item: EntryRow };
  deleteScheduleEntry: { id: string };
  removeScheduleDayEntries: { deletedIds: string[]; skippedIds: string[] };
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

/** 租戶時區(預設 Asia/Taipei)的當地時間 → ISO。 */
const taipei = (date: string, time: string) =>
  new Date(`${date}T${time}:00+08:00`).toISOString();

const taskOf = (demand: DemandRow, role: string, index = 0): string => {
  const task = demand.tasks.filter((item) => item.role === role)[index];
  if (!task) {
    throw new Error(`沒有 ${role} 任務`);
  }
  return task.taskId;
};

const LEAD = "store-and-accounts-lead";
const DUTY = "store-duties";
const COUNTER = "in-store-counter";

/**
 * 排班表(規格 14.1 `schedule_demands` / `schedule_periods` / `schedule_entries` / `schedule_task_assignments`、
 * 14.4 手動新增、14.5 排班表):打真的 GraphQL 端點、對真 MongoDB(TEST-07)。
 *
 * 組織樹:root ─ 租戶甲(可見性 包含下層)─┬─ 中山店(王:可擔任負責人;李;陳也可以排新竹店)
 *                                          └─ 新竹店(陳)
 * 店長只看得到中山店;檢視者只有 `view`。
 */
describe("排班表(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;

  let tenantA: Types.ObjectId;
  let zhongshan: Types.ObjectId;
  let hsinchu: Types.ObjectId;

  let hq: ScheduleTestUser;
  /** 中山店店長:排班表 view + edit(沒有 edit-templates) */
  let manager: ScheduleTestUser;
  /** 中山店:只有 view */
  let viewer: ScheduleTestUser;
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

  async function roster(
    user: ScheduleTestUser,
    month = "2026-11",
    orgId = zhongshan,
  ): Promise<RosterRow> {
    return dataOf(
      await gql(user, ROSTER, { input: { orgId: String(orgId), month } }),
      "scheduleRoster",
    );
  }

  function saveDemand(
    user: ScheduleTestUser,
    input: Record<string, unknown>,
  ): Promise<GraphqlResult> {
    return gql(user, SAVE_DEMAND, {
      input: { orgId: String(zhongshan), positionKey: COUNTER, ...input },
    });
  }

  /** 中山店某天一筆人力需求:負責 1 + 協同 `helpers` 筆。 */
  async function demandOn(
    date: string,
    start: string,
    end: string,
    helpers = 1,
    orgId = zhongshan,
  ): Promise<DemandRow> {
    return dataOf(
      await gql(hq, SAVE_DEMAND, {
        input: {
          orgId: String(orgId),
          positionKey: COUNTER,
          startAt: taipei(date, start),
          endAt: taipei(date, end),
          tasks: [
            { role: "leader", taskKey: LEAD },
            ...Array.from({ length: helpers }, () => ({
              role: "helper",
              taskKey: DUTY,
            })),
          ],
        },
      }),
      "saveScheduleDemand",
    ).item;
  }

  function saveEntry(
    user: ScheduleTestUser,
    input: Record<string, unknown>,
  ): Promise<GraphqlResult> {
    return gql(user, SAVE_ENTRY, {
      input: { orgId: String(zhongshan), breakMinutes: 30, ...input },
    });
  }

  async function entryFor(
    person: ScheduleTestUser,
    date: string,
    start: string,
    end: string,
    assignments: { demandId: string; taskId: string }[],
    orgId = zhongshan,
  ): Promise<EntryRow> {
    return dataOf(
      await gql(hq, SAVE_ENTRY, {
        input: {
          orgId: String(orgId),
          userId: String(person.userId),
          startAt: taipei(date, start),
          endAt: taipei(date, end),
          breakMinutes: 30,
          assignments,
        },
      }),
      "saveScheduleEntry",
    ).item;
  }

  /** 李小華在中山店某天一筆排班(那天新建一筆人力需求,填協同)。 */
  async function entryOn(
    date: string,
    start: string,
    end: string,
  ): Promise<GraphqlResult> {
    const demand = await demandOn(date, start, end);
    return saveEntry(hq, {
      userId: String(li.userId),
      startAt: taipei(date, start),
      endAt: taipei(date, end),
      assignments: [{ demandId: demand.id, taskId: taskOf(demand, "helper") }],
    });
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

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-schedule-roster");
    connection = api.connection;
    await seedScheduleAuthorization(connection);
    await seedScheduleFieldOptions(connection);
    // 「一筆執行任務只填一人」「同一筆人力需求只能填一筆」的唯一索引先建好,同時寫入才擋得到
    await api.app
      .get<Model<ScheduleTaskAssignment>>(
        getModelToken(ScheduleTaskAssignment.name),
      )
      .init();
    // 「人」守門文件一人一筆:唯一索引先建好,同時第一次寫同一人才不會建出兩筆
    await api.app
      .get<Model<ScheduleEntryLock>>(getModelToken(ScheduleEntryLock.name))
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
      [P.manageView, P.manageEdit],
      "李店長",
    );
    viewer = await createScheduleUser(
      api,
      connection,
      [zhongshan],
      [P.manageView],
    );
    wang = await createScheduleUser(api, connection, [zhongshan], [], "王小明");
    li = await createScheduleUser(api, connection, [zhongshan], [], "李小華");
    chen = await createScheduleUser(api, connection, [zhongshan], [], "陳大文");

    await joinSchedule(wang, [
      { orgId: zhongshan, isPrimary: true, canLead: true },
    ]);
    await joinSchedule(li, [
      { orgId: zhongshan, isPrimary: true, canLead: false },
    ]);
    await joinSchedule(chen, [
      { orgId: zhongshan, isPrimary: true, canLead: true },
      { orgId: hsinchu, isPrimary: false, canLead: true },
    ]);
  }, HOOK_TIMEOUT_MS);

  afterEach(() => {
    clearEntryDeletionGuardsForTest();
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("人力需求", () => {
    it("新增:日期 = 開始時點的當地日期、執行任務產生 id、未套用範本 → 來源手動、templateId null", async () => {
      const demand = await demandOn("2026-11-02", "14:30", "22:00", 2);
      expect(demand).toMatchObject({
        date: "2026-11-02",
        positionKey: COUNTER,
        templateId: null,
        source: "manual",
      });
      expect(demand.tasks.map((task) => task.role)).toEqual([
        "leader",
        "helper",
        "helper",
      ]);
      expect(new Set(demand.tasks.map((task) => task.taskId)).size).toBe(3);
    });

    it("負責人超過 1 筆、結束不晚於開始、崗位不是啟用選項 → VALIDATION_FAILED", async () => {
      const twoLeaders = await saveDemand(hq, {
        startAt: taipei("2026-11-02", "08:00"),
        endAt: taipei("2026-11-02", "12:00"),
        tasks: [
          { role: "leader", taskKey: LEAD },
          { role: "leader", taskKey: LEAD },
        ],
      });
      expect(errorOf(twoLeaders)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["tasks"],
      });
      const backwards = await saveDemand(hq, {
        startAt: taipei("2026-11-02", "12:00"),
        endAt: taipei("2026-11-02", "08:00"),
        tasks: [],
      });
      expect(errorOf(backwards)).toMatchObject({ fields: ["endAt"] });
      const retired = await saveDemand(hq, {
        positionKey: "retired-position",
        startAt: taipei("2026-11-02", "08:00"),
        endAt: taipei("2026-11-02", "12:00"),
        tasks: [],
      });
      expect(errorOf(retired)).toMatchObject({ fields: ["positionKey"] });
    });

    it("同時存成人力需求範本:要 edit-templates;有權限時建範本並連到這筆人力需求", async () => {
      const input = {
        startAt: taipei("2026-11-12", "13:00"),
        endAt: taipei("2026-11-12", "18:00"),
        tasks: [{ role: "helper", taskKey: DUTY }],
        saveAsTemplate: { name: "店外促銷", shortName: "促" },
      };
      const denied = await saveDemand(manager, input);
      expect(errorOf(denied)).toMatchObject({
        code: "FORBIDDEN",
        reason: "MISSING_PERMISSION",
      });
      const saved = dataOf(
        await saveDemand(hq, input),
        "saveScheduleDemand",
      ).item;
      const view = await roster(hq);
      const template = view.templates.find((item) => item.shortName === "促");
      expect(template).toBeDefined();
      expect(saved.templateId).toBe(template?.id);
    });

    it("沒有 edit → FORBIDDEN;view 看得到排班表但 canEdit = false", async () => {
      const result = await saveDemand(viewer, {
        startAt: taipei("2026-11-02", "08:00"),
        endAt: taipei("2026-11-02", "12:00"),
        tasks: [],
      });
      expect(errorOf(result)).toMatchObject({ code: "FORBIDDEN" });
      const view = await roster(viewer);
      expect(view.canEdit).toBe(false);
      expect(view.canSaveTemplate).toBe(false);
    });
  });

  describe("排班:填進執行任務", () => {
    it("一筆執行任務第二個人填 → 擋下", async () => {
      const demand = await demandOn("2026-11-03", "08:30", "14:30");
      await entryFor(wang, "2026-11-03", "08:30", "14:30", [
        { demandId: demand.id, taskId: taskOf(demand, "helper") },
      ]);
      const second = await saveEntry(hq, {
        userId: String(li.userId),
        startAt: taipei("2026-11-03", "08:30"),
        endAt: taipei("2026-11-03", "14:30"),
        assignments: [
          { demandId: demand.id, taskId: taskOf(demand, "helper") },
        ],
      });
      expect(errorOf(second)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["assignments"],
      });
    });

    it("同一筆人力需求同一筆排班填兩筆 → 擋下", async () => {
      const demand = await demandOn("2026-11-04", "08:30", "14:30", 2);
      const result = await saveEntry(hq, {
        userId: String(li.userId),
        startAt: taipei("2026-11-04", "08:30"),
        endAt: taipei("2026-11-04", "14:30"),
        assignments: [
          { demandId: demand.id, taskId: taskOf(demand, "helper", 0) },
          { demandId: demand.id, taskId: taskOf(demand, "helper", 1) },
        ],
      });
      expect(errorOf(result)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["assignments"],
      });
    });

    it("跨店時間重疊 → 擋下;相接不算重疊", async () => {
      const there = await demandOn("2026-11-05", "14:00", "22:00", 1, hsinchu);
      await entryFor(
        chen,
        "2026-11-05",
        "14:00",
        "22:00",
        [{ demandId: there.id, taskId: taskOf(there, "leader") }],
        hsinchu,
      );
      const here = await demandOn("2026-11-05", "08:30", "14:30");
      const overlap = await saveEntry(hq, {
        userId: String(chen.userId),
        startAt: taipei("2026-11-05", "08:30"),
        endAt: taipei("2026-11-05", "14:30"),
        assignments: [{ demandId: here.id, taskId: taskOf(here, "leader") }],
      });
      expect(errorOf(overlap)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["startAt"],
      });
      const adjacent = await saveEntry(hq, {
        userId: String(chen.userId),
        startAt: taipei("2026-11-05", "08:30"),
        endAt: taipei("2026-11-05", "14:00"),
        assignments: [{ demandId: here.id, taskId: taskOf(here, "leader") }],
      });
      expect(adjacent.errors).toBeUndefined();
    });

    it("兩家店同時替同一人排重疊的班 → 只成功一筆(「人」守門文件互相衝突重跑)", async () => {
      const date = "2026-12-03";
      const here = await demandOn(date, "08:30", "14:30");
      const there = await demandOn(date, "10:00", "16:00", 1, hsinchu);
      const results = await Promise.all([
        gql(hq, SAVE_ENTRY, {
          input: {
            orgId: String(zhongshan),
            userId: String(chen.userId),
            startAt: taipei(date, "08:30"),
            endAt: taipei(date, "14:30"),
            breakMinutes: 30,
            assignments: [
              { demandId: here.id, taskId: taskOf(here, "leader") },
            ],
          },
        }),
        gql(hq, SAVE_ENTRY, {
          input: {
            orgId: String(hsinchu),
            userId: String(chen.userId),
            startAt: taipei(date, "10:00"),
            endAt: taipei(date, "16:00"),
            breakMinutes: 30,
            assignments: [
              { demandId: there.id, taskId: taskOf(there, "leader") },
            ],
          },
        }),
      ]);
      expect(
        results.filter((result) => result.errors === undefined),
      ).toHaveLength(1);
      expect(results.map((result) => errorOf(result)?.fields)).toContainEqual([
        "startAt",
      ]);
    });

    it("畫休那段時間不能排:整天畫休擋下、和時段不可排重疊擋下、頭尾相接可以排", async () => {
      await connection.collection(SCHEDULE_DAY_OFFS_COLLECTION).insertMany(
        [
          {
            date: "2026-12-10",
            kind: "full-day",
            startTime: null,
            endTime: null,
          },
          {
            date: "2026-12-11",
            kind: "time-range",
            startTime: "09:00",
            endTime: "13:00",
          },
        ].map((item) => ({
          orgId: zhongshan,
          tenantId: tenantA,
          userId: li.userId,
          note: null,
          by: null,
          reason: null,
          reasonNote: null,
          moduleKey: "schedule.my",
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: null,
          updatedBy: null,
          deletedAt: null,
          ...item,
        })),
      );
      expect(
        errorOf(await entryOn("2026-12-10", "13:00", "17:00")),
      ).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["startAt"],
      });
      expect(
        errorOf(await entryOn("2026-12-11", "08:30", "10:00")),
      ).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["startAt"],
      });
      const adjacent = await entryOn("2026-12-11", "13:00", "17:00");
      expect(adjacent.errors).toBeUndefined();
    });

    it("零筆執行任務 → VALIDATION_FAILED(欄位 assignments)", async () => {
      const result = await saveEntry(hq, {
        userId: String(li.userId),
        startAt: taipei("2026-11-06", "08:30"),
        endAt: taipei("2026-11-06", "14:30"),
        assignments: [],
      });
      expect(errorOf(result)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["assignments"],
      });
    });

    it("不能擔任負責人的人填負責任務 → 擋下;不是這家店的候選人 → 擋下;別天的人力需求 → 擋下", async () => {
      const demand = await demandOn("2026-11-07", "08:30", "14:30");
      const notLeader = await saveEntry(hq, {
        userId: String(li.userId),
        startAt: taipei("2026-11-07", "08:30"),
        endAt: taipei("2026-11-07", "14:30"),
        assignments: [
          { demandId: demand.id, taskId: taskOf(demand, "leader") },
        ],
      });
      expect(errorOf(notLeader)).toMatchObject({ fields: ["assignments"] });
      const stranger = await saveEntry(hq, {
        userId: String(manager.userId),
        startAt: taipei("2026-11-07", "08:30"),
        endAt: taipei("2026-11-07", "14:30"),
        assignments: [
          { demandId: demand.id, taskId: taskOf(demand, "helper") },
        ],
      });
      expect(errorOf(stranger)).toMatchObject({ fields: ["userId"] });
      const otherDay = await saveEntry(hq, {
        userId: String(li.userId),
        startAt: taipei("2026-11-08", "08:30"),
        endAt: taipei("2026-11-08", "14:30"),
        assignments: [
          { demandId: demand.id, taskId: taskOf(demand, "helper") },
        ],
      });
      expect(errorOf(otherDay)).toMatchObject({ fields: ["assignments"] });
    });

    it("店休那天不能排", async () => {
      dataOf(
        await gql(hq, SAVE_CALENDAR_DAY, {
          input: {
            orgId: String(zhongshan),
            date: "2026-11-10",
            type: "closed",
          },
        }),
        "saveScheduleCalendarDay" as keyof Payloads,
      );
      const demand = await demandOn("2026-11-10", "08:30", "14:30");
      const result = await saveEntry(hq, {
        userId: String(li.userId),
        startAt: taipei("2026-11-10", "08:30"),
        endAt: taipei("2026-11-10", "14:30"),
        assignments: [
          { demandId: demand.id, taskId: taskOf(demand, "helper") },
        ],
      });
      expect(errorOf(result)).toMatchObject({ fields: ["startAt"] });
    });

    it("編輯:人員不變、改填的任務(拿掉的解除、新的手動)", async () => {
      const demand = await demandOn("2026-11-09", "08:30", "14:30", 2);
      const entry = await entryFor(wang, "2026-11-09", "08:30", "14:30", [
        { demandId: demand.id, taskId: taskOf(demand, "helper", 0) },
      ]);
      const edited = dataOf(
        await saveEntry(hq, {
          id: entry.id,
          startAt: taipei("2026-11-09", "08:00"),
          endAt: taipei("2026-11-09", "14:30"),
          breakMinutes: 60,
          assignments: [
            { demandId: demand.id, taskId: taskOf(demand, "leader") },
          ],
        }),
        "saveScheduleEntry",
      ).item;
      expect(edited).toMatchObject({
        userId: String(wang.userId),
        breakMinutes: 60,
        assignments: [{ demandId: demand.id, role: "leader" }],
      });
      // 拿掉的那一筆空出來,李可以填
      await entryFor(li, "2026-11-09", "08:30", "14:30", [
        { demandId: demand.id, taskId: taskOf(demand, "helper", 0) },
      ]);
    });
  });

  describe("刪除人力需求 / 排班", () => {
    it("修改人力需求拿掉有人填的任務:解除;解除後零筆的排班一起刪", async () => {
      const morning = await demandOn("2026-11-14", "08:30", "14:30", 2);
      const both = await demandOn("2026-11-14", "14:30", "18:00", 0);
      // 王填早班協同 + 下午負責(兩筆);李只填早班協同
      const wangEntry = await entryFor(wang, "2026-11-14", "08:30", "18:00", [
        { demandId: morning.id, taskId: taskOf(morning, "helper", 0) },
        { demandId: both.id, taskId: taskOf(both, "leader") },
      ]);
      const liEntry = await entryFor(li, "2026-11-14", "08:30", "14:30", [
        { demandId: morning.id, taskId: taskOf(morning, "helper", 1) },
      ]);
      const saved = dataOf(
        await saveDemand(hq, {
          id: morning.id,
          startAt: taipei("2026-11-14", "08:30"),
          endAt: taipei("2026-11-14", "14:30"),
          tasks: [
            {
              taskId: taskOf(morning, "leader"),
              role: "leader",
              taskKey: LEAD,
            },
          ],
        }),
        "saveScheduleDemand",
      );
      expect(saved.deletedEntryIds).toEqual([liEntry.id]);
      const view = await roster(hq);
      const ids = view.entries.map((entry) => entry.id);
      expect(ids).toContain(wangEntry.id);
      expect(ids).not.toContain(liEntry.id);
      expect(
        view.entries.find((entry) => entry.id === wangEntry.id)?.assignments,
      ).toEqual([expect.objectContaining({ demandId: both.id })]);
    });

    it("刪除人力需求:零筆的排班一起刪;被綁定的排班擋下並列出(登記的 deletion guard)", async () => {
      const demand = await demandOn("2026-11-15", "08:30", "14:30");
      const entry = await entryFor(wang, "2026-11-15", "08:30", "14:30", [
        { demandId: demand.id, taskId: taskOf(demand, "leader") },
      ]);
      registerEntryDeletionGuard((_tenantId, entryIds) =>
        Promise.resolve(new Set(entryIds.filter((id) => id === entry.id))),
      );
      const blocked = await gql(hq, DELETE_DEMAND, {
        input: { orgId: String(zhongshan), id: demand.id },
      });
      expect(errorOf(blocked)).toMatchObject({
        code: "VALIDATION_FAILED",
        blockedEntryIds: [entry.id],
      });
      const view = await roster(hq);
      expect(view.entries.find((item) => item.id === entry.id)?.deletable).toBe(
        false,
      );
      expect(view.demands.map((item) => item.id)).toContain(demand.id);

      clearEntryDeletionGuardsForTest();
      const deleted = dataOf(
        await gql(hq, DELETE_DEMAND, {
          input: { orgId: String(zhongshan), id: demand.id },
        }),
        "deleteScheduleDemand",
      );
      expect(deleted.deletedEntryIds).toEqual([entry.id]);
    });

    it("刪除排班:被綁定的擋下;移除這天所有排班略過被綁定的", async () => {
      const demand = await demandOn("2026-11-16", "08:30", "14:30", 1);
      const lead = await entryFor(wang, "2026-11-16", "08:30", "14:30", [
        { demandId: demand.id, taskId: taskOf(demand, "leader") },
      ]);
      const help = await entryFor(li, "2026-11-16", "08:30", "14:30", [
        { demandId: demand.id, taskId: taskOf(demand, "helper") },
      ]);
      registerEntryDeletionGuard(() => Promise.resolve(new Set([lead.id])));
      const denied = await gql(hq, DELETE_ENTRY, {
        input: { orgId: String(zhongshan), id: lead.id },
      });
      expect(errorOf(denied)).toMatchObject({ blockedEntryIds: [lead.id] });
      const removed = dataOf(
        await gql(hq, REMOVE_DAY, {
          input: { orgId: String(zhongshan), date: "2026-11-16" },
        }),
        "removeScheduleDayEntries",
      );
      expect(removed).toEqual({ deletedIds: [help.id], skippedIds: [lead.id] });
      // 刪掉後那筆任務空出來
      const view = await roster(hq);
      const after = view.demands.find((item) => item.id === demand.id);
      expect(after?.tasks.find((task) => task.role === "helper")).toMatchObject(
        { entryId: null },
      );
    });
  });

  describe("排班表讀取", () => {
    it("統計欄:負責班數以排班為單位、總工時到分鐘、畫休天數同畫休算法;跨店的班只列分店名(看不到的寫 null)", async () => {
      const date = "2026-11-20";
      await connection.collection(SCHEDULE_DAY_OFFS_COLLECTION).insertMany(
        [
          { date: "2026-11-21", kind: "full-day" },
          {
            date: "2026-11-22",
            kind: "time-range",
            startTime: "09:00",
            endTime: "13:00",
          },
        ].map((item) => ({
          orgId: zhongshan,
          tenantId: tenantA,
          userId: chen.userId,
          startTime: null,
          endTime: null,
          note: null,
          by: null,
          reason: null,
          reasonNote: null,
          moduleKey: "schedule.my",
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: null,
          updatedBy: null,
          deletedAt: null,
          ...item,
        })),
      );
      const demand = await demandOn(date, "08:30", "14:30");
      await entryFor(chen, date, "08:30", "14:30", [
        { demandId: demand.id, taskId: taskOf(demand, "leader") },
      ]);
      const there = await demandOn("2026-11-19", "14:00", "22:00", 0, hsinchu);
      await entryFor(
        chen,
        "2026-11-19",
        "14:00",
        "22:00",
        [{ demandId: there.id, taskId: taskOf(there, "leader") }],
        hsinchu,
      );

      const view = await roster(hq);
      const chenRow = view.people.find(
        (person) => person.userId === String(chen.userId),
      );
      expect(chenRow?.stats).toMatchObject({
        shiftCount: 2,
        leadShiftCount: 2,
        // 11/5 08:30–14:00 休 30 = 300;11/20 08:30–14:30 休 30 = 330
        workMinutes: 630,
        dayOffDays: 2,
        fullDayOffDays: 1,
        // 11/19(新竹)+ 11/20(中山)
        longestStreak: 2,
        timeRangeDays: [
          {
            date: "2026-11-22",
            slots: [{ startTime: "09:00", endTime: "13:00" }],
          },
        ],
      });
      expect(view.otherStoreEntries).toContainEqual({
        userId: String(chen.userId),
        date: "2026-11-19",
        orgName: "新竹店",
      });
      expect(view.unavailability).toContainEqual({
        userId: String(chen.userId),
        date: "2026-11-21",
        fullDay: true,
      });

      const managerView = await roster(manager);
      expect(managerView.otherStoreEntries).toContainEqual({
        userId: String(chen.userId),
        date: "2026-11-19",
        orgName: null,
      });
      expect(managerView.canEdit).toBe(true);
    });

    it("規則生效值、月份狀態(寫過就是未發布);看不到的分店 → NOT_FOUND;月份格式不對 → VALIDATION_FAILED", async () => {
      const view = await roster(hq);
      expect(view.period.status).toBe("unpublished");
      expect(view.settings).toEqual({
        breakTiers: [
          { minMinutes: 240, breakMinutes: 30 },
          { minMinutes: 480, breakMinutes: 60 },
        ],
        defaultLeaderTaskKey: LEAD,
        defaultHelperTaskKey: DUTY,
        maxMonthlyDayOffs: 8,
        minMonthlyDayOffs: 4,
      });
      const hidden = await gql(manager, ROSTER, {
        input: { orgId: String(hsinchu), month: "2026-11" },
      });
      expect(errorOf(hidden)).toMatchObject({ code: "NOT_FOUND" });
      const bad = await gql(hq, ROSTER, {
        input: { orgId: String(zhongshan), month: "2026-13" },
      });
      expect(errorOf(bad)).toMatchObject({ fields: ["month"] });
      expect(new Types.ObjectId(view.orgId)).toEqual(zhongshan);
    });
  });
});
