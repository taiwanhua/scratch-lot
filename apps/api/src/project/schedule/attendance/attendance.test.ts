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
import type { Connection, Model, Types } from "mongoose";

import {
  type AuthTestApp,
  type GraphqlResult,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { SCHEDULE_ATTENDANCE_PUNCHES_COLLECTION } from "../../database/schedule/schedule-attendance-punch.schema";
import { ScheduleEntryLock } from "../../database/schedule/schedule-entry-lock.schema";
import { SCHEDULE_ENTRIES_COLLECTION } from "../../database/schedule/schedule-entry.schema";
import { SCHEDULE_PERIODS_COLLECTION } from "../../database/schedule/schedule-period.schema";
import { ScheduleClock } from "../shared/schedule-clock";
import {
  SCHEDULE_TEST_PERMISSIONS as P,
  type ScheduleTestUser,
  createScheduleUser,
  seedScheduleAuthorization,
  seedScheduleFieldOptions,
} from "../test-support/fixtures";
import { PUNCH_REASSIGN_ACTION } from "./attendance.service";

const ROW = /* GraphQL */ `
  entryId
  userId
  userName
  orgName
  date
  clockIn
  clockOut
  status
  lateMinutes
  earlyLeaveMinutes
  workedMinutes
  scheduledMinutes
  missing
  hasMakeup
  punches { id type entryId source duplicate }
`;

const BY_PERSON = /* GraphQL */ `
  query ByPerson($input: ScheduleAttendanceByPersonInput!) {
    scheduleAttendanceByPerson(input: $input) {
      month
      userId
      people { userId name }
      rows { ${ROW} }
      unmatched { id type entryId }
      abilities { canViewAll canReassign canExport canCreate }
    }
  }
`;

const BY_STORE = /* GraphQL */ `
  query ByStore($input: ScheduleAttendanceByStoreInput!) {
    scheduleAttendanceByStore(input: $input) {
      date
      rows { ${ROW} }
      unmatched { id userId userName type entryId }
      scheduledCount
      arrivedCount
      absentCount
    }
  }
`;

const EXPORT = /* GraphQL */ `
  query Export($input: ScheduleAttendanceExportInput!) {
    scheduleAttendanceExport(input: $input) {
      month
      sheets {
        orgId
        orgName
        rows {
          entryId
          userName
        }
      }
    }
  }
`;

const REASSIGN = /* GraphQL */ `
  mutation Reassign($input: ReassignSchedulePunchInput!) {
    reassignSchedulePunch(input: $input) {
      id
      entryId
      orgId
      type
    }
  }
`;

const OPTIONS = /* GraphQL */ `
  query Options($punchId: ID!) {
    scheduleAttendancePunchEntryOptions(punchId: $punchId) {
      id
      date
      orgName
    }
  }
`;

interface Row {
  entryId: string;
  date: string;
  userId: string;
  userName: string;
  status: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  workedMinutes: number | null;
  scheduledMinutes: number;
  missing: string[];
  clockIn: string | null;
  punches: { id: string; type: string }[];
}

const taipei = (date: string, time: string) =>
  new Date(`${date}T${time}+08:00`);

/** 洛杉磯的時點(`offset` 是那天的 UTC 偏移:夏令 -07:00、標準 -08:00)。 */
const la = (date: string, time: string, offset: string) =>
  new Date(`${date}T${time}${offset}`);

/** 台北 2026 年 11 月的查詢範圍 `[11/1 00:00, 12/1 00:00)`。 */
const NOV = {
  from: taipei("2026-11-01", "00:00:00").toISOString(),
  to: taipei("2026-12-01", "00:00:00").toISOString(),
};

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

/**
 * 出勤紀錄(規格 14.7):依人員(月)、依分店(日)、Excel 的資料、改對應排班。
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07);「現在」由 `ScheduleClock` 注入。
 *
 * 組織樹:租戶甲(包含下層)─┬─ 中山店(王、林、店長)
 *                           └─ 新竹店
 * 11/4 中山店:王 早 08:30–14:30(上班 08:41、下班 14:24:59)、林 晚 14:30–22:00(沒打卡);
 * 11/5 新竹店:王 早(看得到的人才列)。11 月兩家店都已發布。
 */
describe("出勤紀錄(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;

  let tenant: Types.ObjectId;
  let zhongshan: Types.ObjectId;
  let hsinchu: Types.ObjectId;

  /** 店員:出勤紀錄 view + create(只看自己的) */
  let wang: ScheduleTestUser;
  let lin: ScheduleTestUser;
  /** 店長:view-all、export、reassign-punches */
  let manager: ScheduleTestUser;

  let wangNov4: Types.ObjectId;
  let wangNov5: Types.ObjectId;
  let linNov4: Types.ObjectId;
  let unmatched: Types.ObjectId;

  function gql(
    user: ScheduleTestUser,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<GraphqlResult> {
    return api.graphql(query, variables, { accessToken: user.token });
  }

  const punches = () =>
    connection.collection(SCHEDULE_ATTENDANCE_PUNCHES_COLLECTION);

  async function entryIdOf(
    id: Types.ObjectId,
  ): Promise<Types.ObjectId | null | undefined> {
    const found = await punches().findOne<{ entryId: Types.ObjectId | null }>({
      _id: id,
    });
    return found?.entryId;
  }

  async function entry(
    user: ScheduleTestUser,
    orgId: Types.ObjectId,
    date: string,
    start: string,
    end: string,
  ): Promise<Types.ObjectId> {
    const { insertedId } = await connection
      .collection(SCHEDULE_ENTRIES_COLLECTION)
      .insertOne({
        orgId,
        tenantId: tenant,
        userId: user.userId,
        date: taipei(date, "00:00:00"),
        startAt: taipei(date, `${start}:00`),
        // 結束不晚於開始 = 跨午夜,做到隔天
        endAt:
          end <= start
            ? new Date(taipei(date, `${end}:00`).getTime() + 24 * 3_600_000)
            : taipei(date, `${end}:00`),
        breakMinutes: 30,
        moduleKey: "schedule.manage",
        ...base(),
      });
    return insertedId;
  }

  async function punch(
    user: ScheduleTestUser,
    orgId: Types.ObjectId,
    at: Date,
    type: "in" | "out",
    entryId: Types.ObjectId | null,
  ): Promise<Types.ObjectId> {
    const { insertedId } = await punches().insertOne({
      orgId,
      tenantId: tenant,
      userId: user.userId,
      at,
      type,
      entryId,
      ip: null,
      userAgent: null,
      source: "button",
      makeupRequestId: null,
      duplicate: false,
      moduleKey: "schedule.attendance",
      ...base(),
    });
    return insertedId;
  }

  async function byStore(
    user: ScheduleTestUser,
    input: Record<string, unknown> = {},
  ) {
    const result = await gql(user, BY_STORE, {
      input: {
        orgId: String(zhongshan),
        date: taipei("2026-11-04", "00:00:00").toISOString(),
        ...input,
      },
    });
    expect(result.errors).toBeUndefined();
    return result.data?.scheduleAttendanceByStore as {
      date: string;
      rows: Row[];
      unmatched: { id: string; userName: string; entryId: string | null }[];
      scheduledCount: number;
      arrivedCount: number;
      absentCount: number;
    };
  }

  async function errorOf(query: string, input: Record<string, unknown>) {
    const { errors } = await gql(manager, query, { input });
    return errors?.[0]?.extensions;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-schedule-attendance");
    connection = api.connection;
    await seedScheduleAuthorization(connection);
    await seedScheduleFieldOptions(connection);
    await api.app
      .get<Model<ScheduleEntryLock>>(getModelToken(ScheduleEntryLock.name))
      .init();
    jest
      .spyOn(api.app.get(ScheduleClock), "now")
      .mockReturnValue(taipei("2026-11-06", "12:00:00"));

    tenant = await createOrg(connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    zhongshan = await createOrg(connection, {
      name: "中山店",
      parentId: tenant,
    });
    hsinchu = await createOrg(connection, { name: "新竹店", parentId: tenant });

    const staff = [P.attendanceView, P.attendanceCreate];
    wang = await createScheduleUser(
      api,
      connection,
      [zhongshan, hsinchu],
      staff,
      "王小明",
    );
    lin = await createScheduleUser(
      api,
      connection,
      [zhongshan],
      staff,
      "林美麗",
    );
    manager = await createScheduleUser(
      api,
      connection,
      [zhongshan],
      [...staff, P.attendanceViewAll, P.attendanceExport, P.reassignPunches],
      "何店長",
    );

    for (const orgId of [zhongshan, hsinchu]) {
      await connection.collection(SCHEDULE_PERIODS_COLLECTION).insertOne({
        orgId,
        tenantId: tenant,
        month: "2026-11",
        status: "published",
        publishedAt: new Date(),
        publishedBy: null,
        lockedAt: null,
        lockedBy: null,
        version: 0,
        moduleKey: "schedule.manage",
        ...base(),
      });
    }
    wangNov4 = await entry(wang, zhongshan, "2026-11-04", "08:30", "14:30");
    wangNov5 = await entry(wang, hsinchu, "2026-11-05", "08:30", "14:30");
    linNov4 = await entry(lin, zhongshan, "2026-11-04", "14:30", "22:00");
    await punch(
      wang,
      zhongshan,
      taipei("2026-11-04", "08:41:00"),
      "in",
      wangNov4,
    );
    await punch(
      wang,
      zhongshan,
      taipei("2026-11-04", "14:24:59"),
      "out",
      wangNov4,
    );
    // 林 11/4 在中山店打了一張未對應排班的上班卡(晚班前)
    unmatched = await punch(
      lin,
      zhongshan,
      taipei("2026-11-04", "09:02:00"),
      "in",
      null,
    );
  }, HOOK_TIMEOUT_MS);

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("依分店(日)", () => {
    it("view-all 看全店:已到 / 未到、遲到 / 早退用分店的寬限(預設 5 分鐘)、實際工時、未對應排班另列", async () => {
      const data = await byStore(manager);
      expect(data.date).toBe(taipei("2026-11-04", "00:00:00").toISOString());
      expect(data.scheduledCount).toBe(2);
      expect(data.arrivedCount).toBe(1);
      expect(data.absentCount).toBe(1);
      const wangRow = data.rows.find((row) => row.userName === "王小明");
      expect(wangRow).toMatchObject({
        date: taipei("2026-11-04", "00:00:00").toISOString(),
        status: "arrived",
        lateMinutes: 11,
        earlyLeaveMinutes: 6,
        // 14:24:59 − 08:41 − 30 分休息 = 313.98 → 314
        workedMinutes: 314,
        scheduledMinutes: 330,
        missing: [],
      });
      expect(data.rows.find((row) => row.userName === "林美麗")).toMatchObject({
        status: "absent",
        missing: ["in", "out"],
        workedMinutes: null,
      });
      expect(data.unmatched).toEqual([
        expect.objectContaining({
          id: String(unmatched),
          userName: "林美麗",
          entryId: null,
        }),
      ]);
    });

    it("只看未對應排班的打卡:排班列是空的、計數照算", async () => {
      const data = await byStore(manager, { unmatchedOnly: true });
      expect(data.rows).toEqual([]);
      expect(data.unmatched).toHaveLength(1);
      expect(data.scheduledCount).toBe(2);
    });

    it("員工(沒有 view-all)只看到自己的班與卡", async () => {
      const data = await byStore(wang);
      expect(data.rows.map((row) => row.userName)).toEqual(["王小明"]);
      expect(data.unmatched).toEqual([]);
    });
  });

  describe("日期與月份是時點", () => {
    it("依分店(日):送當天其他時刻也歸到那天;回的日期是那天 00:00", async () => {
      const data = await byStore(manager, {
        date: taipei("2026-11-04", "18:30:00").toISOString(),
      });
      expect(data.date).toBe(taipei("2026-11-04", "00:00:00").toISOString());
      expect(data.scheduledCount).toBe(2);
    });

    it("依人員(月)/ 匯出:from / to 不是租戶時區的整個月 → VALIDATION_FAILED(from、to)", async () => {
      const notWhole = {
        from: NOV.from,
        to: taipei("2026-11-30", "00:00:00").toISOString(),
      };
      expect(await errorOf(BY_PERSON, notWhole)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["from", "to"],
      });
      expect(await errorOf(EXPORT, notWhole)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["from", "to"],
      });
      // UTC 的月初不是台北的月初
      expect(
        await errorOf(BY_PERSON, {
          from: "2026-11-01T00:00:00.000Z",
          to: "2026-12-01T00:00:00.000Z",
        }),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["from", "to"] });
    });

    it("出勤月報的月界:[月初 00:00, 下月初 00:00),跨午夜的班算開始那天", async () => {
      // 11/30 22:00 做到 12/1 02:00:整班算 11 月,12/1 的下班卡也跟著這一班
      const late = await entry(lin, zhongshan, "2026-11-30", "22:00", "02:00");
      // 12/1 的班不在 11 月
      const december = await entry(
        lin,
        zhongshan,
        "2026-12-01",
        "08:30",
        "14:30",
      );
      const added = await Promise.all([
        punch(lin, zhongshan, taipei("2026-10-31", "23:59:59"), "in", null),
        punch(lin, zhongshan, taipei("2026-11-30", "23:59:59"), "in", null),
        punch(lin, zhongshan, taipei("2026-12-01", "00:00:00"), "in", null),
        punch(lin, zhongshan, taipei("2026-12-01", "02:00:00"), "out", late),
      ]);
      try {
        const result = await gql(manager, BY_PERSON, {
          input: {
            ...NOV,
            orgId: String(zhongshan),
            userId: String(lin.userId),
          },
        });
        expect(result.errors).toBeUndefined();
        const data = result.data?.scheduleAttendanceByPerson as {
          rows: Row[];
          unmatched: { id: string }[];
        };
        expect(data.rows.map((row) => [row.entryId, row.date])).toEqual([
          [String(linNov4), taipei("2026-11-04", "00:00:00").toISOString()],
          [String(late), taipei("2026-11-30", "00:00:00").toISOString()],
        ]);
        expect(
          data.rows
            .find((row) => row.entryId === String(late))
            ?.punches.map((item) => item.id),
        ).toEqual([String(added[3])]);
        expect(data.unmatched.map((item) => item.id)).toEqual([
          String(unmatched),
          String(added[1]),
        ]);
      } finally {
        await connection
          .collection(SCHEDULE_ENTRIES_COLLECTION)
          .deleteMany({ _id: { $in: [late, december] } });
        await punches().deleteMany({ _id: { $in: added } });
      }
    });

    it("非台北時區(洛杉磯):日與月都照租戶時區算(11/1 夏令時間結束,那個月從 -07:00 開始)", async () => {
      const orgs = connection.collection("orgs");
      const entries = connection.collection(SCHEDULE_ENTRIES_COLLECTION);
      await orgs.updateOne(
        { _id: tenant },
        { $set: { "settings.timezone": "America/Los_Angeles" } },
      );
      const { insertedId: laEntry } = await entries.insertOne({
        orgId: zhongshan,
        tenantId: tenant,
        userId: wang.userId,
        date: la("2026-11-20", "00:00:00", "-08:00"),
        startAt: la("2026-11-20", "09:00:00", "-08:00"),
        endAt: la("2026-11-20", "17:00:00", "-08:00"),
        breakMinutes: 30,
        moduleKey: "schedule.manage",
        ...base(),
      });
      try {
        const day = await byStore(manager, {
          date: la("2026-11-20", "15:00:00", "-08:00").toISOString(),
        });
        expect(day.date).toBe(
          la("2026-11-20", "00:00:00", "-08:00").toISOString(),
        );
        expect(day.rows.map((row) => row.entryId)).toEqual([String(laEntry)]);

        const laNov = {
          from: la("2026-11-01", "00:00:00", "-07:00").toISOString(),
          to: la("2026-12-01", "00:00:00", "-08:00").toISOString(),
        };
        const month = await gql(wang, BY_PERSON, { input: laNov });
        expect(month.errors).toBeUndefined();
        expect(
          (month.data?.scheduleAttendanceByPerson as { rows: Row[] }).rows.map(
            (row) => row.entryId,
          ),
        ).toContain(String(laEntry));
        // 台北的整個月不是洛杉磯的整個月
        const taipeiMonth = await gql(wang, BY_PERSON, { input: NOV });
        expect(taipeiMonth.errors?.[0]?.extensions).toMatchObject({
          code: "VALIDATION_FAILED",
          fields: ["from", "to"],
        });
      } finally {
        await entries.deleteOne({ _id: laEntry });
        await orgs.updateOne(
          { _id: tenant },
          { $unset: { "settings.timezone": "" } },
        );
      }
    });
  });

  describe("依人員(月)", () => {
    it("員工看自己:跨分店合併(支援別家店的班也列);人員選單只有自己", async () => {
      const result = await gql(wang, BY_PERSON, {
        input: NOV,
      });
      expect(result.errors).toBeUndefined();
      const data = result.data?.scheduleAttendanceByPerson as {
        rows: Row[];
        people: { userId: string }[];
        abilities: { canViewAll: boolean };
      };
      expect(data.rows.map((row) => row.entryId)).toEqual([
        String(wangNov4),
        String(wangNov5),
      ]);
      expect(data.people.map((person) => person.userId)).toEqual([
        String(wang.userId),
      ]);
      expect(data.abilities.canViewAll).toBe(false);
    });

    it("員工看別人 → FORBIDDEN(API 擋);view-all 看得到", async () => {
      const denied = await gql(wang, BY_PERSON, {
        input: { ...NOV, userId: String(lin.userId) },
      });
      expect(denied.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
        reason: "MISSING_PERMISSION",
      });
      const allowed = await gql(manager, BY_PERSON, {
        input: {
          ...NOV,
          orgId: String(zhongshan),
          userId: String(lin.userId),
        },
      });
      expect(allowed.errors).toBeUndefined();
      const data = allowed.data?.scheduleAttendanceByPerson as {
        rows: Row[];
        unmatched: { id: string }[];
      };
      expect(data.rows.map((row) => row.entryId)).toEqual([String(linNov4)]);
      expect(data.unmatched.map((item) => item.id)).toEqual([
        String(unmatched),
      ]);
    });
  });

  describe("Excel 的資料", () => {
    it("選最上層組織:一家分店一個工作表(依名稱);沒有 view-all 只匯出自己的", async () => {
      const result = await gql(manager, EXPORT, {
        input: { ...NOV, orgId: String(zhongshan) },
      });
      expect(result.errors).toBeUndefined();
      const sheets = (
        result.data?.scheduleAttendanceExport as {
          sheets: { orgName: string; rows: { userName: string }[] }[];
        }
      ).sheets;
      expect(sheets.map((sheet) => sheet.orgName)).toEqual(["中山店"]);
      expect(sheets[0]?.rows).toHaveLength(2);
    });

    it("沒有 export → FORBIDDEN", async () => {
      const result = await gql(wang, EXPORT, { input: NOV });
      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });
  });

  describe("改對應排班(reassign-punches)", () => {
    it("可以選的排班:這個人打卡那天前後各一天的班", async () => {
      const result = await gql(manager, OPTIONS, {
        punchId: String(unmatched),
      });
      expect(result.errors).toBeUndefined();
      expect(
        (
          result.data?.scheduleAttendancePunchEntryOptions as { id: string }[]
        ).map((item) => item.id),
      ).toEqual([String(linNov4)]);
    });

    it("沒有原因 → VALIDATION_FAILED(reasonKey);停用的原因、「其他」沒說明也擋;沒有權限 → FORBIDDEN", async () => {
      const send = (user: ScheduleTestUser, input: Record<string, unknown>) =>
        gql(user, REASSIGN, {
          input: {
            punchId: String(unmatched),
            entryId: String(linNov4),
            ...input,
          },
        });
      const errorOf = async (
        user: ScheduleTestUser,
        input: Record<string, unknown>,
      ) => {
        const result = await send(user, input);
        return result.errors?.[0]?.extensions;
      };
      expect(await errorOf(manager, { reasonKey: "" })).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["reasonKey"],
      });
      expect(
        await errorOf(manager, { reasonKey: "retired-reassign" }),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["reasonKey"] });
      expect(await errorOf(manager, { reasonKey: "other" })).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["reasonNote"],
      });
      expect(await errorOf(wang, { reasonKey: "shift-swap" })).toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await entryIdOf(unmatched)).toBeNull();
    });

    it("改了:卡對應到那一筆(時間與類型不變),寫 audit_log;再改回未對應排班", async () => {
      const result = await gql(manager, REASSIGN, {
        input: {
          punchId: String(unmatched),
          entryId: String(linNov4),
          reasonKey: "shift-swap",
        },
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.reassignSchedulePunch).toMatchObject({
        entryId: String(linNov4),
        type: "in",
      });
      const stored = await punches().findOne<{
        entryId: Types.ObjectId | null;
        at: Date;
      }>({
        _id: unmatched,
      });
      expect(String(stored?.entryId)).toBe(String(linNov4));
      expect(stored?.at).toEqual(taipei("2026-11-04", "09:02:00"));
      const audit = await connection.collection("audit_logs").findOne({
        action: PUNCH_REASSIGN_ACTION,
        targetId: unmatched,
      });
      expect(audit).toMatchObject({
        actorId: manager.userId,
        before: { entryId: null },
        after: {
          entryId: String(linNov4),
          reasonKey: "shift-swap",
          reasonNote: null,
        },
      });

      const back = await gql(manager, REASSIGN, {
        input: {
          punchId: String(unmatched),
          entryId: null,
          reasonKey: "other",
          reasonNote: "對錯了",
        },
      });
      expect(back.errors).toBeUndefined();
      expect(await entryIdOf(unmatched)).toBeNull();
    });

    it("別人的排班 → VALIDATION_FAILED(entryId)", async () => {
      const result = await gql(manager, REASSIGN, {
        input: {
          punchId: String(unmatched),
          entryId: String(wangNov4),
          reasonKey: "shift-swap",
        },
      });
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["entryId"],
        reason: "REFERENCE_NOT_FOUND",
      });
    });
  });
});
