import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import { type Connection, type Model, Types } from "mongoose";

import {
  type AuthTestApp,
  type GraphqlResult,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import type { OperatorContext } from "../../../database/operator-context";
import {
  type DbCommandCount,
  countDbCommands,
  expectDbCommandsAtMost,
} from "../../../database/test-support/db-commands";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { TransactionService } from "../../../database/transaction";
import { SCHEDULE_AUTO_RUNS_COLLECTION } from "../../database/schedule/schedule-auto-run.schema";
import { SCHEDULE_CHANGES_COLLECTION } from "../../database/schedule/schedule-change.schema";
import {
  SCHEDULE_ENTRY_LOCKS_COLLECTION,
  ScheduleEntryLock,
} from "../../database/schedule/schedule-entry-lock.schema";
import { SCHEDULE_PERIODS_COLLECTION } from "../../database/schedule/schedule-period.schema";
import { ScheduleTaskAssignment } from "../../database/schedule/schedule-task-assignment.schema";
import { SCHEDULE_CHANGED } from "../../notifications";
import { ScheduleClock } from "../shared/schedule-clock";
import { SchedulePersonLocks } from "../shared/schedule-person-locks";
import {
  ALL_SCHEDULE_TEST_PERMISSIONS,
  SCHEDULE_TEST_PERMISSIONS as P,
  type ScheduleTestUser,
  createScheduleUser,
  seedScheduleAuthorization,
  seedScheduleFieldOptions,
} from "../test-support/fixtures";
import { ScheduleAutoRunService } from "./schedule-auto-run.service";

// ---- GraphQL ----

const SAVE_TEMPLATE = /* GraphQL */ `
  mutation SaveTemplate($input: SaveScheduleDemandTemplateInput!) {
    saveScheduleDemandTemplate(input: $input) {
      item {
        id
        tasks {
          taskId
        }
      }
    }
  }
`;

const SAVE_WEEK_TEMPLATE = /* GraphQL */ `
  mutation SaveWeekTemplate($input: SaveScheduleDemandWeekTemplateInput!) {
    saveScheduleDemandWeekTemplate(input: $input) {
      item {
        id
      }
    }
  }
`;

const APPLY_FIELDS = "createdCount skippedSlots filledDays skippedDays";

const APPLY_PREVIEW = /* GraphQL */ `
  query Preview($input: ApplyScheduleTemplatesInput!) {
    scheduleTemplateApplyPreview(input: $input) { ${APPLY_FIELDS} }
  }
`;

const APPLY = /* GraphQL */ `
  mutation Apply($input: ApplyScheduleTemplatesInput!) {
    applyScheduleTemplates(input: $input) { ${APPLY_FIELDS} }
  }
`;

const STATUS = /* GraphQL */ `
  query Status($input: ScheduleRosterInput!) {
    scheduleAutoRunStatus(input: $input) {
      canAutoRun
      running
      latest {
        filledCount
        unfilledCount
        addedDemandCount
        addedDemandDays
        byName
      }
      weekTemplates {
        id
        name
      }
    }
  }
`;

const RUN_PREVIEW = /* GraphQL */ `
  query RunPreview($input: ScheduleAutoRunRangeInput!) {
    scheduleAutoRunPreview(input: $input) {
      demandCount
      fillableDays
      manualCount
      autoCount
      weekTemplate {
        id
        name
      }
    }
  }
`;

const RUN = /* GraphQL */ `
  mutation Run($input: RunScheduleAutoRunInput!) {
    runScheduleAutoRun(input: $input) {
      filledCount
      unfilledCount
      addedDemandCount
      addedDemandDays
    }
  }
`;

const CLEAR = /* GraphQL */ `
  mutation Clear($input: ScheduleAutoRunRangeInput!) {
    clearScheduleAutoAssignments(input: $input) {
      removedCount
      deletedEntryIds
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

const ROSTER = /* GraphQL */ `
  query Roster($input: ScheduleRosterInput!) {
    scheduleRoster(input: $input) {
      demands {
        id
        date
        startAt
        endAt
        templateId
        positionKey
        tasks {
          taskId
          role
          userId
        }
      }
      entries {
        id
        userId
        date
        startAt
        endAt
        breakMinutes
        assignments {
          demandId
          taskId
          source
          reason
        }
      }
    }
  }
`;

const SAVE_DEMAND = /* GraphQL */ `
  mutation SaveDemand($input: SaveScheduleDemandInput!) {
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
  mutation SaveEntry($input: SaveScheduleEntryInput!) {
    saveScheduleEntry(input: $input) {
      item {
        id
      }
    }
  }
`;

const PUBLISH = /* GraphQL */ `
  mutation Publish($input: PublishScheduleInput!) {
    publishSchedule(input: $input) {
      notifiedCount
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

// ---- 型別 ----

interface RosterDemand {
  id: string;
  date: string;
  startAt: string;
  endAt: string;
  templateId: string | null;
  positionKey: string;
  tasks: { taskId: string; role: string; userId: string | null }[];
}

interface RosterEntry {
  id: string;
  userId: string;
  date: string;
  startAt: string;
  endAt: string;
  breakMinutes: number;
  assignments: {
    demandId: string;
    taskId: string;
    source: string;
    reason: string | null;
  }[];
}

interface ApplyRow {
  createdCount: number;
  skippedSlots: number;
  filledDays: number;
  skippedDays: number;
}

/** 不算通知入口內每位收件人各自的讀寫(`notifications.*`;那部分由通知入口自己的防退化測試管)。 */
function withoutNotifications(
  counted: DbCommandCount<GraphqlResult>,
): Pick<DbCommandCount<GraphqlResult>, "total" | "byCommand"> {
  const byCommand = new Map(
    [...counted.byCommand].filter(([key]) => !key.startsWith("notifications.")),
  );
  const total = [...byCommand.values()].reduce((sum, n) => sum + n, 0);
  return { total, byCommand };
}

function errorOf(result: GraphqlResult): Record<string, unknown> | undefined {
  return result.errors?.[0]?.extensions;
}

interface PreviewRow {
  demandCount: number;
  fillableDays: number;
  manualCount: number;
  autoCount: number;
  weekTemplate: { id: string; name: string } | null;
}

interface SummaryRow {
  filledCount: number;
  unfilledCount: number;
  addedDemandCount: number;
  addedDemandDays: number;
}

interface Payloads {
  scheduleTemplateApplyPreview: ApplyRow;
  applyScheduleTemplates: ApplyRow;
  scheduleAutoRunPreview: PreviewRow;
  runScheduleAutoRun: SummaryRow;
  scheduleAutoRunStatus: {
    canAutoRun: boolean;
    running: boolean;
    latest: (SummaryRow & { byName: string | null }) | null;
  };
  clearScheduleAutoAssignments: {
    removedCount: number;
    deletedEntryIds: string[];
  };
  scheduleRoster: { demands: RosterDemand[]; entries: RosterEntry[] };
  saveScheduleDemand: {
    item: { id: string; tasks: { taskId: string; role: string }[] };
  };
  addScheduleStaff: { items: { staff: { id: string } }[] };
  saveScheduleDemandTemplate: {
    item: { id: string; tasks: { taskId: string }[] };
  };
  saveScheduleDemandWeekTemplate: { item: { id: string } };
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

/** api 收發的日期:那天台北 00:00 的時點。 */
const day = (date: string) => taipei(date, "00:00");

/** 自動排班範圍(日期含頭尾)→ 半開的時點區間 `[from 00:00, to 隔天 00:00)`(台北沒有夏令時間)。 */
const rangeOf = (from: string, to: string) => ({
  from: day(from),
  to: new Date(Date.parse(day(to)) + 86_400_000).toISOString(),
});

/** 洛杉磯(夏令 UTC−7)某天某時刻(租戶時區不是台北的測試用)。 */
const laDaylight = (date: string, time: string) =>
  new Date(`${date}T${time}:00-07:00`).toISOString();

const LEAD = "store-and-accounts-lead";
const DUTY = "store-duties";
const COUNTER = "in-store-counter";
const STALL = "outdoor-stall";
const ALL_CONDITIONS = [
  { key: "continuePreviousEntry", enabled: true },
  { key: "leaderCountFirst", enabled: true },
  { key: "monthlyShiftBalance", enabled: false },
  { key: "allowOverlappingDemands", enabled: false },
];

/**
 * 套用範本與自動排班(規格 14.4「套用範本」、14.5「自動排班」):打真的 GraphQL 端點、對真 MongoDB(TEST-07)。
 *
 * 組織樹:root ─ 租戶丙(包含下層)─┬─ 大安店(王:主要、可負責;李:主要;張:主要、可負責)
 *                                   └─ 中和店(沒有排班人員;週範本、空月份用)
 * 每個情境用不同的月份,彼此不干擾;「每月最少畫休」在最上層組織調成 0。
 */
describe("套用範本與自動排班(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;

  let tenant: Types.ObjectId;
  let daan: Types.ObjectId;
  let zhonghe: Types.ObjectId;

  let hq: ScheduleTestUser;
  /** 只有 view + edit(沒有 auto-run) */
  let editor: ScheduleTestUser;
  /** 只有 view + auto-run(沒有 edit) */
  let runner: ScheduleTestUser;
  let wang: ScheduleTestUser;
  let li: ScheduleTestUser;
  let zhang: ScheduleTestUser;

  let morning: { id: string; tasks: { taskId: string }[] };
  let evening: { id: string };
  let weekTemplateId: string;

  function gql(
    user: ScheduleTestUser,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<GraphqlResult> {
    return api.graphql(query, variables, { accessToken: user.token });
  }

  async function roster(
    month: string,
    orgId = daan,
  ): Promise<{ demands: RosterDemand[]; entries: RosterEntry[] }> {
    return dataOf(
      await gql(hq, ROSTER, { input: { orgId: String(orgId), month } }),
      "scheduleRoster",
    );
  }

  function applyInput(
    month: string,
    extra: Record<string, unknown>,
    orgId = daan,
  ): Record<string, unknown> {
    return { input: { orgId: String(orgId), month, ...extra } };
  }

  function runInput(
    month: string,
    extra: Record<string, unknown> = {},
    orgId = daan,
  ): Record<string, unknown> {
    return {
      input: {
        orgId: String(orgId),
        month,
        ...rangeOf(`${month}-01`, `${month}-28`),
        mode: "fill-empty",
        conditions: ALL_CONDITIONS,
        ...extra,
      },
    };
  }

  async function demandOn(
    date: string,
    start: string,
    end: string,
    roles: ("leader" | "helper")[],
  ): Promise<{ id: string; tasks: { taskId: string; role: string }[] }> {
    return dataOf(
      await gql(hq, SAVE_DEMAND, {
        input: {
          orgId: String(daan),
          positionKey: COUNTER,
          startAt: taipei(date, start),
          endAt: taipei(date, end),
          tasks: roles.map((role) => ({
            role,
            taskKey: role === "leader" ? LEAD : DUTY,
          })),
        },
      }),
      "saveScheduleDemand",
    ).item;
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

  const periods = () => connection.collection(SCHEDULE_PERIODS_COLLECTION);

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-schedule-auto-run");
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
      name: "租戶丙",
      settings: { visibility: "subtree" },
    });
    daan = await createOrg(connection, { name: "大安店", parentId: tenant });
    zhonghe = await createOrg(connection, { name: "中和店", parentId: tenant });

    hq = await createScheduleUser(
      api,
      connection,
      [tenant],
      ALL_SCHEDULE_TEST_PERMISSIONS,
      "總部",
    );
    editor = await createScheduleUser(
      api,
      connection,
      [daan],
      [P.manageView, P.manageEdit],
      "大安排班",
    );
    runner = await createScheduleUser(
      api,
      connection,
      [daan, zhonghe],
      [P.manageView, P.autoRun],
      "自動排班的人",
    );
    wang = await createScheduleUser(api, connection, [daan], [], "王小明");
    li = await createScheduleUser(api, connection, [daan], [], "李小華");
    zhang = await createScheduleUser(api, connection, [daan], [], "張小芳");
    await joinSchedule(wang, [{ orgId: daan, isPrimary: true, canLead: true }]);
    await joinSchedule(li, [{ orgId: daan, isPrimary: true, canLead: false }]);
    await joinSchedule(zhang, [
      { orgId: daan, isPrimary: true, canLead: true },
    ]);
    const customized = await gql(hq, CUSTOMIZE_RULE, {
      input: {
        orgId: String(tenant),
        key: "minMonthlyDayOffs",
        value: { amount: 0 },
      },
    });
    expect(customized.errors).toBeUndefined();

    morning = dataOf(
      await gql(hq, SAVE_TEMPLATE, {
        input: {
          name: "早班",
          shortName: "早",
          startTime: "08:30",
          endTime: "14:30",
          positionKey: COUNTER,
          tasks: [
            { role: "leader", taskKey: LEAD },
            { role: "helper", taskKey: DUTY },
          ],
        },
      }),
      "saveScheduleDemandTemplate",
    ).item;
    evening = dataOf(
      await gql(hq, SAVE_TEMPLATE, {
        input: {
          name: "晚班",
          shortName: "晚",
          startTime: "14:30",
          endTime: "22:00",
          positionKey: COUNTER,
          tasks: [{ role: "leader", taskKey: LEAD }],
        },
      }),
      "saveScheduleDemandTemplate",
    ).item;
    // 一般週:平日早晚班、週末只有早班
    weekTemplateId = dataOf(
      await gql(hq, SAVE_WEEK_TEMPLATE, {
        input: {
          name: "一般週",
          days: [
            [morning.id],
            [morning.id, evening.id],
            [morning.id, evening.id],
            [morning.id, evening.id],
            [morning.id, evening.id],
            [morning.id, evening.id],
            [morning.id],
          ],
        },
      }),
      "saveScheduleDemandWeekTemplate",
    ).item.id;
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("套用範本(規格 14.4)", () => {
    it("人力需求範本:同時間同崗位略過(不論哪個範本)、只重疊照常產生;預覽與套用一致;複製執行任務並產生新的 taskId", async () => {
      // 2027-01-05:手動建一筆和早班完全相同的(略過)、一筆 09:00 開始的(重疊照常產生)
      await demandOn("2027-01-05", "08:30", "14:30", ["leader"]);
      await demandOn("2027-01-06", "09:00", "14:30", ["leader"]);
      const input = applyInput("2027-01", {
        kind: "template",
        templateIds: [morning.id, evening.id],
        dates: [day("2027-01-05"), day("2027-01-06")],
      });
      const preview = dataOf(
        await gql(editor, APPLY_PREVIEW, input),
        "scheduleTemplateApplyPreview",
      );
      expect(preview).toEqual({
        createdCount: 3,
        skippedSlots: 1,
        filledDays: 0,
        skippedDays: 0,
      });
      expect(
        dataOf(await gql(editor, APPLY, input), "applyScheduleTemplates"),
      ).toEqual(preview);
      // 再套一次:全部略過
      expect(
        dataOf(await gql(editor, APPLY, input), "applyScheduleTemplates"),
      ).toMatchObject({ createdCount: 0, skippedSlots: 4 });

      const { demands } = await roster("2027-01");
      const fromMorning = demands.filter(
        (demand) => demand.templateId === morning.id,
      );
      expect(fromMorning.map((demand) => demand.date)).toEqual([
        day("2027-01-06"),
      ]);
      const copied = fromMorning[0]?.tasks.map((task) => task.taskId) ?? [];
      expect(copied).toHaveLength(2);
      expect(copied).not.toContain(morning.tasks[0]?.taskId);
      expect(demands).toHaveLength(5);
    });

    it("人力需求週範本:只補完全沒有人力需求的日子", async () => {
      await demandOn("2027-02-02", "18:00", "20:00", ["helper"]);
      const result = dataOf(
        await gql(
          editor,
          APPLY,
          applyInput("2027-02", {
            kind: "week-template",
            weekTemplateId,
            // 2027-02-01 星期一、02-02 星期二(已有人力需求)、02-07 星期日
            dates: [day("2027-02-01"), day("2027-02-02"), day("2027-02-07")],
          }),
        ),
        "applyScheduleTemplates",
      );
      expect(result).toEqual({
        createdCount: 3,
        skippedSlots: 0,
        filledDays: 2,
        skippedDays: 1,
      });
      const { demands } = await roster("2027-02");
      expect(
        demands.map(
          (demand) => `${demand.date}:${String(demand.templateId === null)}`,
        ),
      ).toEqual([
        `${day("2027-02-01")}:false`,
        `${day("2027-02-01")}:false`,
        `${day("2027-02-02")}:true`,
        `${day("2027-02-07")}:false`,
      ]);
    });

    it("範本結束 00:00 = 隔天 00:00;租戶時區不是台北:套用到洛杉磯那天", async () => {
      const night = dataOf(
        await gql(hq, SAVE_TEMPLATE, {
          input: {
            name: "夜班",
            shortName: "夜",
            startTime: "18:00",
            endTime: "00:00",
            positionKey: COUNTER,
            tasks: [{ role: "leader", taskKey: LEAD }],
          },
        }),
        "saveScheduleDemandTemplate",
      ).item;
      const orgs = connection.collection("orgs");
      await orgs.updateOne(
        { _id: tenant },
        { $set: { "settings.timezone": "America/Los_Angeles" } },
      );
      try {
        const applied = dataOf(
          await gql(
            hq,
            APPLY,
            applyInput(
              "2028-06",
              {
                kind: "template",
                templateIds: [night.id],
                // 洛杉磯 6/30 00:00(= UTC 6/30 07:00)
                dates: [laDaylight("2028-06-30", "00:00")],
              },
              zhonghe,
            ),
          ),
          "applyScheduleTemplates",
        );
        expect(applied.createdCount).toBe(1);
        const { demands } = await roster("2028-06", zhonghe);
        expect(demands).toEqual([
          expect.objectContaining({
            date: laDaylight("2028-06-30", "00:00"),
            startAt: laDaylight("2028-06-30", "18:00"),
            endAt: laDaylight("2028-07-01", "00:00"),
          }),
        ]);
      } finally {
        await orgs.updateOne(
          { _id: tenant },
          { $unset: { "settings.timezone": "" } },
        );
      }
    });

    it("不是這個月的日子、看不到的範本 → VALIDATION_FAILED;沒有 edit → FORBIDDEN", async () => {
      expect(
        errorOf(
          await gql(
            editor,
            APPLY,
            applyInput("2027-02", {
              kind: "template",
              templateIds: [morning.id],
              dates: [day("2027-03-01")],
            }),
          ),
        ),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["dates"] });
      expect(
        errorOf(
          await gql(
            editor,
            APPLY,
            applyInput("2027-02", {
              kind: "template",
              templateIds: [new Types.ObjectId().toHexString()],
              dates: [day("2027-02-10")],
            }),
          ),
        ),
      ).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["templateIds"],
        reason: "REFERENCE_NOT_FOUND",
      });
      expect(
        errorOf(
          await gql(
            runner,
            APPLY,
            applyInput("2027-02", {
              kind: "template",
              templateIds: [morning.id],
              dates: [day("2027-02-10")],
            }),
          ),
        ),
      ).toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("自動排班(規格 14.5)", () => {
    it("範圍內沒有人力需求也沒有週範本 → 預覽 demandCount 0、週範本 null(畫面停用 [執行])", async () => {
      const preview = dataOf(
        await gql(runner, RUN_PREVIEW, {
          input: {
            orgId: String(zhonghe),
            month: "2027-03",
            ...rangeOf("2027-03-01", "2027-03-31"),
          },
        }),
        "scheduleAutoRunPreview",
      );
      expect(preview).toMatchObject({
        demandCount: 0,
        weekTemplate: null,
        fillableDays: 0,
      });
    });

    it("沒有 auto-run 看不到 / 不能按(canAutoRun false、執行 FORBIDDEN)", async () => {
      const status = dataOf(
        await gql(editor, STATUS, {
          input: { orgId: String(daan), month: "2027-04" },
        }),
        "scheduleAutoRunStatus",
      );
      expect(status.canAutoRun).toBe(false);
      expect(
        errorOf(await gql(editor, RUN, runInput("2027-04"))),
      ).toMatchObject({ code: "FORBIDDEN" });
    });

    it("先以週範本補上人力需求(只有 auto-run、沒有 edit 也可以)→ 再填人;負責只給可負責的人;結果標自動、記執行紀錄與摘要", async () => {
      const customized = await gql(hq, CUSTOMIZE_RULE, {
        input: {
          orgId: String(daan),
          key: "autoDemandWeekTemplateId",
          value: { weekTemplateId },
        },
      });
      expect(customized.errors).toBeUndefined();
      const preview = dataOf(
        await gql(runner, RUN_PREVIEW, {
          input: {
            orgId: String(daan),
            month: "2027-05",
            ...rangeOf("2027-05-03", "2027-05-04"),
          },
        }),
        "scheduleAutoRunPreview",
      );
      expect(preview).toMatchObject({
        fillableDays: 2,
        weekTemplate: { id: weekTemplateId },
      });

      const summary = dataOf(
        await gql(
          runner,
          RUN,
          runInput("2027-05", {
            ...rangeOf("2027-05-03", "2027-05-04"),
            fillWeekTemplate: true,
          }),
        ),
        "runScheduleAutoRun",
      );
      // 5/3、5/4 都是平日:早(負 + 協)+ 晚(負)= 每天 3 筆任務
      expect(summary).toEqual({
        filledCount: 6,
        unfilledCount: 0,
        addedDemandCount: 4,
        addedDemandDays: 2,
      });
      const { demands, entries } = await roster("2027-05");
      expect(demands).toHaveLength(4);
      const leaders = demands.flatMap((demand) =>
        demand.tasks
          .filter((task) => task.role === "leader")
          .map((task) => task.userId),
      );
      expect(
        leaders.every(
          (id) => id === String(wang.userId) || id === String(zhang.userId),
        ),
      ).toBe(true);
      const assignments = entries.flatMap((entry) => entry.assignments);
      expect(assignments).toHaveLength(6);
      expect(assignments.every((item) => item.source === "auto")).toBe(true);
      expect(
        assignments.every((item) => item.reason?.startsWith("自動排入:")),
      ).toBe(true);
      // 排班休息依規則「預設休息」(滿 4 小時 30 分、滿 8 小時 60 分;延續的早晚班併成一筆 08:30–22:00)
      for (const entry of entries) {
        const hours =
          (Date.parse(entry.endAt) - Date.parse(entry.startAt)) / 3_600_000;
        expect(entry.breakMinutes).toBe(hours >= 8 ? 60 : 30);
      }

      const status = dataOf(
        await gql(hq, STATUS, {
          input: { orgId: String(daan), month: "2027-05" },
        }),
        "scheduleAutoRunStatus",
      );
      expect(status.running).toBe(false);
      expect(status.latest).toMatchObject({
        filledCount: 6,
        addedDemandDays: 2,
        byName: "自動排班的人",
      });
      const [run] = await connection
        .collection(SCHEDULE_AUTO_RUNS_COLLECTION)
        .find({ month: "2027-05" })
        .toArray();
      expect(run).toMatchObject({
        mode: "fill-empty",
        algorithmVersion: "1",
        conditions: ALL_CONDITIONS,
      });
      expect(typeof run?.seed).toBe("number");
      // 鎖已解除
      expect(
        await periods().findOne({ orgId: daan, month: "2027-05" }),
      ).toMatchObject({ lockedAt: null });
    });

    it("沒勾「允許同一人同時段填進多筆」→ 不會讓同一人填進時間重疊的兩筆", async () => {
      // 兩台同時段,只有負責;可負責的只有王、張 → 兩人各一台,不會一人兩台
      await demandOn("2027-06-07", "09:00", "13:00", ["leader"]);
      await demandOn("2027-06-07", "09:00", "13:00", ["leader"]);
      await demandOn("2027-06-07", "09:00", "13:00", ["leader"]);
      const summary = dataOf(
        await gql(hq, RUN, runInput("2027-06")),
        "runScheduleAutoRun",
      );
      expect(summary).toMatchObject({ filledCount: 2, unfilledCount: 1 });
      const { entries } = await roster("2027-06");
      expect(entries).toHaveLength(2);
      expect(entries.every((entry) => entry.assignments.length === 1)).toBe(
        true,
      );
    });

    it("一定遵守:畫休日不排(李整天畫休 → 協同排不到)", async () => {
      await connection.collection("schedule_day_offs").insertOne({
        orgId: daan,
        tenantId: tenant,
        userId: li.userId,
        date: new Date(taipei("2027-07-05", "00:00")),
        kind: "full-day",
        startAt: null,
        endAt: null,
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
      });
      await demandOn("2027-07-05", "09:00", "13:00", ["helper"]);
      await demandOn("2027-07-05", "09:00", "13:00", ["helper"]);
      await demandOn("2027-07-05", "09:00", "13:00", ["helper"]);
      const summary = dataOf(
        await gql(hq, RUN, runInput("2027-07")),
        "runScheduleAutoRun",
      );
      expect(summary).toMatchObject({ filledCount: 2, unfilledCount: 1 });
      const { entries } = await roster("2027-07");
      expect(entries.map((entry) => entry.userId)).not.toContain(
        String(li.userId),
      );
    });

    it("重排自動排入的人只換自動的;全部重排先看手動人次(確認用),連手動的一起清掉重排", async () => {
      const demand = await demandOn("2027-08-02", "09:00", "13:00", [
        "leader",
        "helper",
      ]);
      const leaderTask = demand.tasks.find((task) => task.role === "leader");
      const manual = await gql(hq, SAVE_ENTRY, {
        input: {
          orgId: String(daan),
          userId: String(wang.userId),
          startAt: taipei("2027-08-02", "09:00"),
          endAt: taipei("2027-08-02", "13:00"),
          breakMinutes: 0,
          assignments: [{ demandId: demand.id, taskId: leaderTask?.taskId }],
        },
      });
      expect(manual.errors).toBeUndefined();
      await gql(hq, RUN, runInput("2027-08"));
      const counts = async () =>
        dataOf(
          await gql(hq, RUN_PREVIEW, {
            input: {
              orgId: String(daan),
              month: "2027-08",
              ...rangeOf("2027-08-01", "2027-08-31"),
            },
          }),
          "scheduleAutoRunPreview",
        );
      expect(await counts()).toMatchObject({ manualCount: 1, autoCount: 1 });
      await gql(hq, RUN, runInput("2027-08", { mode: "redo-auto" }));
      expect(await counts()).toMatchObject({ manualCount: 1, autoCount: 1 });
      const run = await gql(hq, RUN, runInput("2027-08", { mode: "redo-all" }));
      expect(run.errors).toBeUndefined();
      expect(await counts()).toMatchObject({ manualCount: 0, autoCount: 2 });
    });

    it("清除自動排入的人只清 source = 自動;手動改過的變手動、不被清;零筆的排班一起刪", async () => {
      await demandOn("2027-09-06", "09:00", "13:00", ["leader"]);
      await demandOn("2027-09-07", "09:00", "13:00", ["leader"]);
      await gql(hq, RUN, runInput("2027-09"));
      const before = await roster("2027-09");
      expect(before.entries).toHaveLength(2);
      // 手動改一筆(只改休息)→ 來源變手動、理由不再顯示
      const [edited, untouched] = before.entries;
      const saved = await gql(hq, SAVE_ENTRY, {
        input: {
          orgId: String(daan),
          id: edited?.id,
          startAt: edited?.startAt,
          endAt: edited?.endAt,
          breakMinutes: 10,
          assignments: edited?.assignments.map((item) => ({
            demandId: item.demandId,
            taskId: item.taskId,
          })),
        },
      });
      expect(saved.errors).toBeUndefined();
      const afterEdit = await roster("2027-09");
      const editedRow = afterEdit.entries.find(
        (entry) => entry.id === edited?.id,
      );
      expect(editedRow?.assignments[0]).toMatchObject({
        source: "manual",
        reason: null,
      });

      const cleared = dataOf(
        await gql(hq, CLEAR, {
          input: {
            orgId: String(daan),
            month: "2027-09",
            ...rangeOf("2027-09-01", "2027-09-30"),
          },
        }),
        "clearScheduleAutoAssignments",
      );
      expect(cleared).toEqual({
        removedCount: 1,
        deletedEntryIds: [untouched?.id],
      });
      const after = await roster("2027-09");
      expect(after.entries.map((entry) => entry.id)).toEqual([edited?.id]);
    });

    it("同時兩人按 [自動排班]:鎖定中的另一人看到「自動排班執行中」,排班表寫入也被擋;10 分鐘逾時自動解除", async () => {
      await demandOn("2027-10-04", "09:00", "13:00", ["leader"]);
      const clock = api.app.get(ScheduleClock);
      const now = new Date("2027-09-20T02:00:00Z");
      const spy = jest.spyOn(clock, "now").mockReturnValue(now);
      try {
        // 另一人剛按下(條件更新標記)
        await periods().updateOne(
          { orgId: daan, month: "2027-10" },
          {
            $set: {
              lockedAt: new Date(now.getTime() - 60_000),
              lockedBy: hq.userId,
            },
          },
        );
        const status = dataOf(
          await gql(runner, STATUS, {
            input: { orgId: String(daan), month: "2027-10" },
          }),
          "scheduleAutoRunStatus",
        );
        expect(status.running).toBe(true);
        expect(
          errorOf(await gql(runner, RUN, runInput("2027-10"))),
        ).toMatchObject({
          code: "VALIDATION_FAILED",
          reason: "AUTO_RUN_IN_PROGRESS",
        });
        expect(
          errorOf(
            await gql(hq, SAVE_DEMAND, {
              input: {
                orgId: String(daan),
                positionKey: STALL,
                startAt: taipei("2027-10-05", "09:00"),
                endAt: taipei("2027-10-05", "12:00"),
                tasks: [{ role: "helper", taskKey: DUTY }],
              },
            }),
          ),
        ).toMatchObject({ reason: "AUTO_RUN_IN_PROGRESS" });

        // 超過 10 分鐘 → 視為已解除
        spy.mockReturnValue(new Date(now.getTime() + 10 * 60_000));
        const run = await gql(runner, RUN, runInput("2027-10"));
        expect(run.errors).toBeUndefined();
        expect(
          await periods().findOne({ orgId: daan, month: "2027-10" }),
        ).toMatchObject({ lockedAt: null });
      } finally {
        spy.mockRestore();
      }
    });

    it("同時送出兩次:一個成功、另一個看到「自動排班執行中」(或在前一個解鎖後才開始)", async () => {
      await demandOn("2027-11-01", "09:00", "13:00", ["leader"]);
      const results = await Promise.all([
        gql(hq, RUN, runInput("2027-11")),
        gql(runner, RUN, runInput("2027-11")),
      ]);
      const failed = results.filter((result) => result.errors !== undefined);
      expect(results.length - failed.length).toBeGreaterThanOrEqual(1);
      for (const result of failed) {
        expect(errorOf(result)).toMatchObject({
          reason: "AUTO_RUN_IN_PROGRESS",
        });
      }
      const { entries } = await roster("2027-11");
      expect(entries).toHaveLength(1);
    });

    it("已發布的月份不能自動排班 / 清除(ALREADY_PUBLISHED)", async () => {
      const published = await gql(hq, PUBLISH, {
        input: { orgId: String(daan), month: "2027-12" },
      });
      expect(published.errors).toBeUndefined();
      expect(errorOf(await gql(hq, RUN, runInput("2027-12")))).toMatchObject({
        reason: "ALREADY_PUBLISHED",
      });
      expect(
        errorOf(
          await gql(hq, CLEAR, {
            input: {
              orgId: String(daan),
              month: "2027-12",
              ...rangeOf("2027-12-01", "2027-12-31"),
            },
          }),
        ),
      ).toMatchObject({ reason: "ALREADY_PUBLISHED" });
    });

    it("自動排班執行中不能發布(AUTO_RUN_IN_PROGRESS);逾時解除後照常發布", async () => {
      await demandOn("2028-01-03", "09:00", "13:00", ["helper"]);
      const clock = api.app.get(ScheduleClock);
      const now = new Date("2027-12-20T02:00:00Z");
      const spy = jest.spyOn(clock, "now").mockReturnValue(now);
      try {
        await periods().updateOne(
          { orgId: daan, month: "2028-01" },
          {
            $set: {
              lockedAt: new Date(now.getTime() - 60_000),
              lockedBy: runner.userId,
            },
          },
        );
        const publish = () =>
          gql(hq, PUBLISH, {
            input: { orgId: String(daan), month: "2028-01" },
          });
        expect(errorOf(await publish())).toMatchObject({
          code: "VALIDATION_FAILED",
          reason: "AUTO_RUN_IN_PROGRESS",
        });
        expect(
          await periods().findOne({ orgId: daan, month: "2028-01" }),
        ).toMatchObject({ status: "unpublished" });
        spy.mockReturnValue(new Date(now.getTime() + 10 * 60_000));
        const published = await publish();
        expect(published.errors).toBeUndefined();
      } finally {
        spy.mockRestore();
      }
    });

    it("計算在交易外:計算期間鎖逾時被別人搶走 → 不寫入,別人的鎖照留", async () => {
      await demandOn("2028-02-07", "09:00", "13:00", ["leader"]);
      const service = api.app.get(ScheduleAutoRunService);
      const target = service as unknown as {
        prepareRun: (...args: unknown[]) => Promise<unknown>;
      };
      const original = target.prepareRun.bind(service);
      const stolenAt = new Date();
      const spy = jest
        .spyOn(target, "prepareRun")
        .mockImplementation(async (...args: unknown[]) => {
          const prepared = await original(...args);
          // 計算期間:自己的鎖逾時,別人重新標記
          await periods().updateOne(
            { orgId: daan, month: "2028-02" },
            { $set: { lockedAt: stolenAt, lockedBy: hq.userId } },
          );
          return prepared;
        });
      try {
        expect(
          errorOf(await gql(runner, RUN, runInput("2028-02"))),
        ).toMatchObject({ reason: "AUTO_RUN_IN_PROGRESS" });
      } finally {
        spy.mockRestore();
      }
      const { entries } = await roster("2028-02");
      expect(entries).toEqual([]);
      expect(
        await connection
          .collection(SCHEDULE_AUTO_RUNS_COLLECTION)
          .countDocuments({ month: "2028-02" }),
      ).toBe(0);
      expect(
        await periods().findOne({ orgId: daan, month: "2028-02" }),
      ).toMatchObject({ lockedAt: stolenAt, lockedBy: hq.userId });
    });

    it("執行紀錄記下這次實際用的整組條件與順序(沒送的補在後面、不勾)與延續延長前的時間", async () => {
      const first = await demandOn("2028-03-06", "08:00", "12:00", ["leader"]);
      await demandOn("2028-03-06", "12:00", "14:00", ["leader"]);
      const saved = await gql(hq, SAVE_ENTRY, {
        input: {
          orgId: String(daan),
          userId: String(wang.userId),
          startAt: taipei("2028-03-06", "08:00"),
          endAt: taipei("2028-03-06", "12:00"),
          breakMinutes: 0,
          assignments: [{ demandId: first.id, taskId: first.tasks[0]?.taskId }],
        },
      });
      expect(saved.errors).toBeUndefined();
      const run = await gql(
        hq,
        RUN,
        runInput("2028-03", {
          conditions: [{ key: "continuePreviousEntry", enabled: true }],
        }),
      );
      expect(run.errors).toBeUndefined();
      const record = await connection
        .collection(SCHEDULE_AUTO_RUNS_COLLECTION)
        .findOne({ month: "2028-03" });
      expect(record?.conditions).toEqual([
        { key: "continuePreviousEntry", enabled: true },
        { key: "leaderCountFirst", enabled: false },
        { key: "monthlyShiftBalance", enabled: false },
        { key: "allowOverlappingDemands", enabled: false },
      ]);
      // 王的 08–12 延長到 14:00;紀錄留延長前的時間(清除時要不要縮回待決)
      expect(record?.extendedEntries).toEqual([
        expect.objectContaining({
          before: expect.objectContaining({
            startAt: new Date(taipei("2028-03-06", "08:00")),
            endAt: new Date(taipei("2028-03-06", "12:00")),
            breakMinutes: 0,
          }),
          after: expect.objectContaining({
            endAt: new Date(taipei("2028-03-06", "14:00")),
          }),
        }),
      ]);
      const { entries } = await roster("2028-03");
      expect(entries).toHaveLength(1);

      // 清除自動排入的人 → 被延長的那筆縮回延長前的 08–12(手動的填進留著)
      const cleared = await gql(hq, CLEAR, {
        input: {
          orgId: String(daan),
          month: "2028-03",
          ...rangeOf("2028-03-01", "2028-03-31"),
        },
      });
      expect(cleared.errors).toBeUndefined();
      const after = await roster("2028-03");
      expect(after.entries).toEqual([
        expect.objectContaining({
          startAt: taipei("2028-03-06", "08:00"),
          endAt: taipei("2028-03-06", "12:00"),
          breakMinutes: 0,
        }),
      ]);
      expect(after.entries[0]?.assignments).toHaveLength(1);
    });

    it("延長後被手動改過(來源變手動)→ 清除時不縮回、維持現狀", async () => {
      const first = await demandOn("2028-04-03", "08:00", "12:00", ["leader"]);
      await demandOn("2028-04-03", "12:00", "14:00", ["leader"]);
      const saved = await gql(hq, SAVE_ENTRY, {
        input: {
          orgId: String(daan),
          userId: String(wang.userId),
          startAt: taipei("2028-04-03", "08:00"),
          endAt: taipei("2028-04-03", "12:00"),
          breakMinutes: 0,
          assignments: [{ demandId: first.id, taskId: first.tasks[0]?.taskId }],
        },
      });
      expect(saved.errors).toBeUndefined();
      const ran = await gql(hq, RUN, runInput("2028-04"));
      expect(ran.errors).toBeUndefined();
      const ranRoster = await roster("2028-04");
      const [extended] = ranRoster.entries;
      expect(extended?.endAt).toBe(taipei("2028-04-03", "14:00"));
      const edited = await gql(hq, SAVE_ENTRY, {
        input: {
          orgId: String(daan),
          id: extended?.id,
          startAt: extended?.startAt,
          endAt: extended?.endAt,
          breakMinutes: extended?.breakMinutes,
          assignments: extended?.assignments.map((item) => ({
            demandId: item.demandId,
            taskId: item.taskId,
          })),
        },
      });
      expect(edited.errors).toBeUndefined();
      const cleared = dataOf(
        await gql(hq, CLEAR, {
          input: {
            orgId: String(daan),
            month: "2028-04",
            ...rangeOf("2028-04-01", "2028-04-30"),
          },
        }),
        "clearScheduleAutoAssignments",
      );
      expect(cleared.removedCount).toBe(0);
      const keptRoster = await roster("2028-04");
      const [kept] = keptRoster.entries;
      expect(kept).toMatchObject({
        startAt: taipei("2028-04-03", "08:00"),
        endAt: taipei("2028-04-03", "14:00"),
      });
    });
  });

  /**
   * 整批寫入的防退化(TX-06):同一個動作做 1 筆與多筆,指令數只多常數次。另開一家「信義店」(8 位排班人員),
   * 不和上面大安店的情境共用月份。`counts` 是實測數字(回報用)。
   */
  describe("整批寫入的指令數(TX-06)", () => {
    let xinyi: Types.ObjectId;
    const people: ScheduleTestUser[] = [];
    const counts: Record<string, number> = {};

    const SWAP = { reasonKey: "shift-swap" };

    async function demandAt(
      date: string,
      start: string,
      end: string,
      roles: ("leader" | "helper")[],
    ): Promise<{ id: string; tasks: { taskId: string; role: string }[] }> {
      return dataOf(
        await gql(hq, SAVE_DEMAND, {
          input: {
            orgId: String(xinyi),
            positionKey: COUNTER,
            startAt: taipei(date, start),
            endAt: taipei(date, end),
            tasks: roles.map((role) => ({
              role,
              taskKey: role === "leader" ? LEAD : DUTY,
            })),
          },
        }),
        "saveScheduleDemand",
      ).item;
    }

    /** 這個月的狀態文件先建好(清除一次:沒有可清的),再直接標成已發布。 */
    async function publishDirectly(month: string): Promise<void> {
      const created = await gql(hq, CLEAR, {
        input: {
          orgId: String(xinyi),
          month,
          ...rangeOf(`${month}-01`, `${month}-01`),
        },
      });
      expect(created.errors).toBeUndefined();
      await periods().updateOne(
        { orgId: xinyi, month },
        { $set: { status: "published" } },
      );
    }

    async function measured(
      label: string,
      query: string,
      variables: Record<string, unknown>,
    ): Promise<DbCommandCount<GraphqlResult>> {
      const counted = await countDbCommands(async () => {
        const result = await gql(hq, query, variables);
        expect(result.errors).toBeUndefined();
        return result;
      });
      counts[label] = counted.total;
      return counted;
    }

    function addStaff(label: string, users: ScheduleTestUser[]) {
      return measured(label, ADD_STAFF, {
        input: { userIds: users.map((user) => String(user.userId)) },
      });
    }

    function runAt(
      label: string,
      month: string,
      extra: Record<string, unknown>,
    ) {
      return measured(label, RUN, runInput(month, extra, xinyi));
    }

    function clearAt(
      label: string,
      month: string,
      range: Record<string, unknown>,
    ) {
      return measured(label, CLEAR, {
        input: { orgId: String(xinyi), month, ...range },
      });
    }

    beforeAll(async () => {
      xinyi = await createOrg(connection, { name: "信義店", parentId: tenant });
      for (let index = 0; index < 8; index += 1) {
        people.push(
          await createScheduleUser(
            api,
            connection,
            [xinyi],
            [],
            `信義${String(index)}`,
          ),
        );
      }
    }, HOOK_TIMEOUT_MS);

    afterAll(() => {
      // 實測數字(回報前後對照用)
      process.stdout.write(`TX-06 指令數 ${JSON.stringify(counts)}\n`);
    });

    it("加入排班人員:1 人與 7 人指令數相同", async () => {
      const one = await addStaff("addStaff1", people.slice(0, 1));
      const seven = await addStaff("addStaff7", people.slice(1));
      expectDbCommandsAtMost(seven, one.total + 2, "加入 7 位排班人員");
      const added = [
        ...dataOf(one.result, "addScheduleStaff").items,
        ...dataOf(seven.result, "addScheduleStaff").items,
      ];
      expect(added).toHaveLength(8);
      for (const item of added) {
        const updated = await gql(hq, UPDATE_STAFF, {
          input: {
            staffId: item.staff.id,
            orgs: [{ orgId: String(xinyi), isPrimary: true, canLead: true }],
          },
        });
        expect(updated.errors).toBeUndefined();
      }
    });

    it("人的守門文件 ensureMany / touchMany:同時建同一批不重複、撞到的重讀後只建還沒有的;缺文件的 touch 丟錯", async () => {
      const locks = api.app.get(SchedulePersonLocks);
      const root: OperatorContext = {
        actorId: hq.userId,
        currentOrgId: null,
        visibleOrgIds: "all",
        managedOrgIds: "all",
        memberOrgIds: [],
        roleIds: [],
        memberTenants: [],
      };
      const ids = Array.from({ length: 4 }, () => new Types.ObjectId());
      await Promise.all([
        locks.ensureMany(root, tenant, ids.slice(0, 3)),
        locks.ensureMany(root, tenant, ids.slice(1)),
        locks.ensureMany(root, tenant, ids.slice(2, 3)),
      ]);
      const stored = connection.collection(SCHEDULE_ENTRY_LOCKS_COLLECTION);
      expect(
        await stored.countDocuments({ orgId: tenant, userId: { $in: ids } }),
      ).toBe(4);
      // 都已建好:只讀一次、不寫
      const again = await countDbCommands(() =>
        locks.ensureMany(root, tenant, ids),
      );
      expect(
        again.byCommand.get(`${SCHEDULE_ENTRY_LOCKS_COLLECTION}.find`),
      ).toBe(1);
      expect(
        again.byCommand.get(`${SCHEDULE_ENTRY_LOCKS_COLLECTION}.insertMany`),
      ).toBeUndefined();
      const transactions = api.app.get(TransactionService);
      await transactions.withTransaction(() =>
        locks.touchMany(root, tenant, ids),
      );
      expect(
        await stored.countDocuments({ userId: { $in: ids }, version: 1 }),
      ).toBe(4);
      await expect(
        transactions.withTransaction(() =>
          locks.touchMany(root, tenant, [...ids, new Types.ObjectId()]),
        ),
      ).rejects.toThrow("schedule person locks missing");
    });

    it("大店整月自動排班 / 重排 / 清除:和只排一天的指令數相同", async () => {
      const customized = await gql(hq, CUSTOMIZE_RULE, {
        input: {
          orgId: String(xinyi),
          key: "autoDemandWeekTemplateId",
          value: { weekTemplateId },
        },
      });
      expect(customized.errors).toBeUndefined();
      const monthRange = rangeOf("2028-03-01", "2028-03-28");
      const dayRange = rangeOf("2028-04-03", "2028-04-03");
      const fillMonth = await runAt("runFillMonth", "2028-03", {
        ...monthRange,
        fillWeekTemplate: true,
      });
      const fillDay = await runAt("runFillDay", "2028-04", {
        ...dayRange,
        fillWeekTemplate: true,
      });
      expect(
        dataOf(fillMonth.result, "runScheduleAutoRun").addedDemandCount,
      ).toBeGreaterThan(40);
      expectDbCommandsAtMost(fillMonth, fillDay.total + 10, "整月首次自動排班");

      const redoMonth = await runAt("runRedoMonth", "2028-03", {
        ...monthRange,
        mode: "redo-all",
      });
      const redoDay = await runAt("runRedoDay", "2028-04", {
        ...dayRange,
        mode: "redo-all",
      });
      expect(
        dataOf(redoMonth.result, "runScheduleAutoRun").filledCount,
      ).toBeGreaterThan(60);
      expectDbCommandsAtMost(redoMonth, redoDay.total + 4, "整月重排");
      // 人的守門文件:8 位候選人也只各一次(建好的查一次、交易內一次 $inc)
      const lockCommands = [...redoMonth.byCommand.entries()]
        .filter(([key]) => key.startsWith(SCHEDULE_ENTRY_LOCKS_COLLECTION))
        .reduce((sum, [, count]) => sum + count, 0);
      expect(lockCommands).toBeLessThanOrEqual(2);

      const clearMonth = await clearAt("clearMonth", "2028-03", monthRange);
      const clearDay = await clearAt("clearDay", "2028-04", dayRange);
      expect(
        dataOf(clearMonth.result, "clearScheduleAutoAssignments").removedCount,
      ).toBeGreaterThan(60);
      expectDbCommandsAtMost(clearMonth, clearDay.total + 4, "整月清除");
    });

    it("延續延長與清除時縮回:6 天與 1 天的指令數相同", async () => {
      const setup = async (dates: string[]) => {
        for (const [index, date] of dates.entries()) {
          const first = await demandAt(date, "08:00", "12:00", ["leader"]);
          await demandAt(date, "12:00", "14:00", ["leader"]);
          const saved = await gql(hq, SAVE_ENTRY, {
            input: {
              orgId: String(xinyi),
              userId: String(people[index % people.length]?.userId),
              startAt: taipei(date, "08:00"),
              endAt: taipei(date, "12:00"),
              breakMinutes: 0,
              assignments: [
                { demandId: first.id, taskId: first.tasks[0]?.taskId },
              ],
            },
          });
          expect(saved.errors).toBeUndefined();
        }
      };
      await setup([
        "2028-05-08",
        "2028-05-09",
        "2028-05-10",
        "2028-05-11",
        "2028-05-12",
        "2028-05-15",
      ]);
      await setup(["2028-06-05"]);
      const extend = (label: string, month: string) =>
        measured(label, RUN, {
          input: {
            orgId: String(xinyi),
            month,
            ...rangeOf(`${month}-01`, `${month}-28`),
            mode: "fill-empty",
            conditions: [{ key: "continuePreviousEntry", enabled: true }],
          },
        });
      const many = await extend("extendMany", "2028-05");
      const one = await extend("extendOne", "2028-06");
      const record = await connection
        .collection(SCHEDULE_AUTO_RUNS_COLLECTION)
        .findOne({ orgId: xinyi, month: "2028-05" });
      expect(record?.stats).toMatchObject({ extendedEntryCount: 6 });
      expectDbCommandsAtMost(many, one.total + 2, "延長 6 筆排班");

      const shrink = (label: string, month: string) =>
        measured(label, CLEAR, {
          input: {
            orgId: String(xinyi),
            month,
            ...rangeOf(`${month}-01`, `${month}-28`),
          },
        });
      const shrinkMany = await shrink("shrinkMany", "2028-05");
      const shrinkOne = await shrink("shrinkOne", "2028-06");
      expectDbCommandsAtMost(shrinkMany, shrinkOne.total + 2, "縮回 6 筆排班");
      const { entries } = await roster("2028-05", xinyi);
      expect(entries).toHaveLength(6);
      for (const entry of entries) {
        expect(Date.parse(entry.endAt) - Date.parse(entry.startAt)).toBe(
          4 * 3_600_000,
        );
      }
    });

    it("已發布的月份套用週範本:整月與一天的指令數相同(每筆一列異動)", async () => {
      await publishDirectly("2028-07");
      await publishDirectly("2028-08");
      const apply = (label: string, month: string, dates: string[]) =>
        measured(
          label,
          APPLY,
          applyInput(
            month,
            {
              kind: "week-template",
              weekTemplateId,
              dates: dates.map((date) => day(date)),
              changeReason: SWAP,
            },
            xinyi,
          ),
        );
      const monthDates = Array.from(
        { length: 28 },
        (_, index) => `2028-07-${String(index + 1).padStart(2, "0")}`,
      );
      const many = await apply("applyPublishedMonth", "2028-07", monthDates);
      const one = await apply("applyPublishedDay", "2028-08", ["2028-08-07"]);
      const created = dataOf(many.result, "applyScheduleTemplates");
      expect(created.createdCount).toBeGreaterThan(40);
      expect(
        await connection
          .collection(SCHEDULE_CHANGES_COLLECTION)
          .countDocuments({ orgId: xinyi, month: "2028-07" }),
      ).toBe(created.createdCount);
      expectDbCommandsAtMost(many, one.total + 2, "已發布的月份套用週範本");
    });

    it("已發布的月份移除這天所有排班:6 個排班與 1 個的指令數相同(每人一則通知)", async () => {
      await demandAt("2028-09-04", "08:00", "14:00", [
        "leader",
        "helper",
        "helper",
        "helper",
        "helper",
        "helper",
      ]);
      await demandAt("2028-09-05", "08:00", "14:00", ["leader"]);
      // 同一人同一天兩個排班(移除時合併通知分兩輪,照樣收到兩則,和逐列記異動時相同)
      const person = people[0];
      for (const [start, end] of [
        ["06:00", "07:00"],
        ["20:00", "21:00"],
      ] as const) {
        const demand = await demandAt("2028-09-06", start, end, ["leader"]);
        const saved = await gql(hq, SAVE_ENTRY, {
          input: {
            orgId: String(xinyi),
            userId: String(person?.userId),
            startAt: taipei("2028-09-06", start),
            endAt: taipei("2028-09-06", end),
            breakMinutes: 0,
            assignments: [
              { demandId: demand.id, taskId: demand.tasks[0]?.taskId },
            ],
          },
        });
        expect(saved.errors).toBeUndefined();
      }
      const filled = await gql(hq, RUN, {
        input: {
          orgId: String(xinyi),
          month: "2028-09",
          ...rangeOf("2028-09-01", "2028-09-28"),
          mode: "fill-empty",
          conditions: [],
        },
      });
      expect(filled.errors).toBeUndefined();
      await periods().updateOne(
        { orgId: xinyi, month: "2028-09" },
        { $set: { status: "published" } },
      );
      const remove = (label: string, date: string) =>
        measured(label, REMOVE_DAY, {
          input: {
            orgId: String(xinyi),
            date: day(date),
            changeReason: SWAP,
          },
        });
      const many = await remove("removeDay6", "2028-09-04");
      const one = await remove("removeDay1", "2028-09-05");
      expect(
        (many.result.data?.removeScheduleDayEntries as { deletedIds: string[] })
          .deletedIds,
      ).toHaveLength(6);
      const notified = await connection
        .collection("notifications")
        .countDocuments({
          type: SCHEDULE_CHANGED,
          recipientId: { $in: people.map((person) => person.userId) },
          body: { $regex: "2028-09-04" },
        });
      expect(notified).toBe(6);
      expectDbCommandsAtMost(
        withoutNotifications(many),
        withoutNotifications(one).total + 2,
        "移除這天 6 個排班",
      );

      const noticesOf = () =>
        connection.collection("notifications").countDocuments({
          type: SCHEDULE_CHANGED,
          recipientId: person?.userId,
          body: { $regex: "2028-09-06" },
        });
      const before = await noticesOf();
      await remove("removeDaySamePerson", "2028-09-06");
      expect(await noticesOf()).toBe(before + 2);
    });
  });
});
