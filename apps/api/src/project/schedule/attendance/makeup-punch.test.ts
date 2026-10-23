import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import { type Model, Types } from "mongoose";

import type { FormDefinition } from "@repo/domain/form";
import {
  MAKEUP_PUNCH_FORM_KEY,
  MAKEUP_PUNCH_MODULE_KEY,
} from "@repo/domain/project/schedule-settings";
import type { StepDef } from "@repo/domain/workflow";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { TransactionService } from "../../../database/transaction";
import {
  ASSIGN,
  CREATE_FORM,
  CREATE_FORM_DRAFT,
  SUBMIT,
  type SubmissionRow,
  call,
  createDraft,
  definitionOf,
  extensionsOf,
  field,
  ok,
  publishDefinition,
  rootToken,
  submitDraft,
} from "../../../forms/test-support/form-fixtures";
import { createRole } from "../../../permission/test-support/fixtures";
import {
  DECIDE,
  type Person,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  bindForm,
  decideOn,
  pendingTaskOf,
  person,
  publishWorkflow,
  reviewStep,
  roleSource,
} from "../../../workflows/test-support/workflow-fixtures";
import {
  SCHEDULE_ATTENDANCE_PUNCHES_COLLECTION,
  ScheduleAttendancePunch,
} from "../../database/schedule/schedule-attendance-punch.schema";
import { ScheduleEntryLock } from "../../database/schedule/schedule-entry-lock.schema";
import { SCHEDULE_ENTRIES_COLLECTION } from "../../database/schedule/schedule-entry.schema";
import { SCHEDULE_PERIODS_COLLECTION } from "../../database/schedule/schedule-period.schema";
import {
  SCHEDULE_TEST_PERMISSIONS as P,
  seedScheduleAuthorization,
  seedScheduleFieldOptions,
} from "../test-support/fixtures";
import {
  MAKEUP_PUNCH_REASONS,
  MakeupPunchService,
} from "./makeup-punch.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const SCHEDULE_MODULES = ["schedule", "schedule.my", "schedule.attendance"];

const PENDING = /* GraphQL */ `
  query Pending {
    myPendingMakeupPunchEntryIds
  }
`;

const EXISTS = /* GraphQL */ `
  query Exists($submissionId: ID!) {
    makeupPunchEntryExists(submissionId: $submissionId)
  }
`;

const ENTRY_OPTIONS = /* GraphQL */ `
  query Options($input: MakeupPunchEntryOptionsInput!) {
    makeupPunchEntryOptions(input: $input) {
      id
      date
    }
  }
`;

/** 補打卡申請的定義(欄位 key 同受管表單 `seeds/project/revisions/makeup_punch.r4.seed.ts`)。 */
function makeupDefinition(): FormDefinition {
  return definitionOf([
    field("entry_label", "text", { rules: { required: true } }),
    field("punch_at", "datetime", { rules: { required: true } }),
    field("branch", "reference", {
      source: { provider: "org", labelField: "name" },
      rules: { required: true },
    }),
    field("entry", "text", { rules: { required: true } }),
    field("punch_type", "select", {
      options: {
        kind: "static",
        items: [
          { value: "in", label: "上班", order: 1, enabled: true },
          { value: "out", label: "下班", order: 2, enabled: true },
        ],
      },
      rules: { required: true },
    }),
    field("reason", "select", {
      options: { kind: "fieldCategory", key: "schedule-makeup-punch-reason" },
      rules: { required: true },
    }),
    field("note", "text"),
  ]);
}

const taipei = (date: string, time: string) =>
  new Date(`${date}T${time}:00+08:00`);

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
 * 補打卡申請(規格 14.8):真的表單引擎 + 審核流程 + 掛接點。
 * 流程同開通腳本建的那一份:一關 店長。
 */
describe("補打卡申請(規格 14.8)", () => {
  let api: AuthTestApp;
  let world: World;
  let tenant: Types.ObjectId;
  let zhongshan: Types.ObjectId;
  let wang: Person;
  let lin: Person;
  let manager: Person;
  let wangNov2: Types.ObjectId;
  let wangNov3: Types.ObjectId;
  let linNov2: Types.ObjectId;

  const punches = () =>
    api.connection.collection(SCHEDULE_ATTENDANCE_PUNCHES_COLLECTION);
  const entries = () => api.connection.collection(SCHEDULE_ENTRIES_COLLECTION);

  async function pendingIds(): Promise<string[]> {
    const data = await ok<{ myPendingMakeupPunchEntryIds: string[] }>(
      api,
      wang.token,
      PENDING,
    );
    return data.myPendingMakeupPunchEntryIds;
  }

  async function entryExists(
    submissionId: string,
    who: Person = manager,
  ): Promise<boolean> {
    const data = await ok<{ makeupPunchEntryExists: boolean }>(
      api,
      who.token,
      EXISTS,
      { submissionId },
    );
    return data.makeupPunchEntryExists;
  }

  async function makeupPunchOf(submissionId: string) {
    return punches().findOne<{
      entryId: Types.ObjectId | null;
      type: string;
      at: Date;
    }>({
      makeupRequestId: new Types.ObjectId(submissionId),
    });
  }

  /** 一筆排班;結束不晚於開始 = 跨午夜,做到隔天。 */
  async function entry(
    who: Person,
    date: string,
    start: string,
    end: string,
  ): Promise<Types.ObjectId> {
    const startAt = taipei(date, start);
    let endAt = taipei(date, end);
    if (endAt <= startAt) {
      endAt = new Date(endAt.getTime() + 24 * 3_600_000);
    }
    const { insertedId } = await entries().insertOne({
      orgId: zhongshan,
      tenantId: tenant,
      userId: who.userId,
      date: taipei(date, "00:00"),
      startAt,
      endAt,
      breakMinutes: 30,
      moduleKey: "schedule.manage",
      ...base(),
    });
    return insertedId;
  }

  /** 補打卡的存值;時間預設 14:35(`time` 給 `HH:mm`,或給 `at` 指定另一天的時點)。 */
  const values = (
    date: string,
    entryValue: string,
    overrides: Record<string, unknown> & { time?: string; at?: Date } = {},
  ) => {
    const { time = "14:35", at, ...rest } = overrides;
    return {
      punch_at: (at ?? taipei(date, time)).toISOString(),
      branch: String(zhongshan),
      entry: entryValue,
      entry_label: "早 08:30–14:30",
      punch_type: "out",
      reason: { value: "forgot-punch", label: "forgot-punch" },
      ...rest,
    };
  };
  async function submitAs(
    who: Person,
    input: Record<string, unknown>,
  ): Promise<SubmissionRow> {
    return submitDraft(
      api,
      who.token,
      await createDraft(api, who.token, MAKEUP_PUNCH_FORM_KEY, input),
    );
  }

  async function submitError(who: Person, input: Record<string, unknown>) {
    const draft = await call<{
      createFormDraft: { submission: SubmissionRow };
    }>(api, who.token, CREATE_FORM_DRAFT, {
      input: {
        formKey: MAKEUP_PUNCH_FORM_KEY,
        clientRequestId: `makeup-${String(new Types.ObjectId())}`,
        values: input,
      },
    });
    const created = draft.data?.createFormDraft.submission;
    if (!created) {
      throw new Error(JSON.stringify(draft.errors));
    }
    return call(api, who.token, SUBMIT, {
      input: { id: created.id, expectedEditVersion: created.editVersion },
    });
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-makeup-punch");
    const { connection } = api;
    await seedScheduleAuthorization(connection);
    await seedScheduleFieldOptions(connection);
    await api.app
      .get<Model<ScheduleEntryLock>>(getModelToken(ScheduleEntryLock.name))
      .init();
    // 「一張申請只寫一張卡」的部分唯一索引先建好,同時寫入才擋得到
    await api.app
      .get<Model<ScheduleAttendancePunch>>(
        getModelToken(ScheduleAttendancePunch.name),
      )
      .init();
    const root = await rootToken(api);
    tenant = await createOrg(connection, {
      name: "好運彩券行",
      settings: { visibility: "subtree" },
    });
    zhongshan = await createOrg(connection, {
      name: "中山店",
      parentId: tenant,
    });

    const admin = await person(api, connection, tenant, tenant, {
      moduleKeys: ["system", "system.workflows", "system.forms"],
      permissionKeys: ["system.workflows.*", "system.forms.*"],
    });
    const staffScope = {
      moduleKeys: [
        ...SCHEDULE_MODULES,
        "apply-center",
        "apply-center.view-page",
      ],
      permissionKeys: [
        P.myView,
        P.attendanceView,
        P.attendanceCreate,
        P.attendanceEdit,
        "apply-center.view",
      ],
    };
    wang = await person(api, connection, zhongshan, tenant, staffScope);
    lin = await person(api, connection, zhongshan, tenant, staffScope);
    // 店長只是審核者:沒有出勤紀錄的權限,經申請中心審核
    manager = await person(api, connection, zhongshan, tenant, {
      moduleKeys: ["apply-center", "apply-center.view-page"],
      permissionKeys: ["apply-center.view"],
    });
    const managerRole = await createRole(api.app, connection, {
      name: "店長",
      ownerOrgId: tenant,
      assignTo: [manager.userId],
    });

    await ok(api, root, CREATE_FORM, {
      input: {
        key: MAKEUP_PUNCH_FORM_KEY,
        moduleKey: MAKEUP_PUNCH_MODULE_KEY,
        name: "補打卡申請",
      },
    });
    await publishDefinition(
      api,
      root,
      MAKEUP_PUNCH_FORM_KEY,
      makeupDefinition(),
      null,
    );
    await ok(api, root, ASSIGN, {
      input: {
        formKey: MAKEUP_PUNCH_FORM_KEY,
        tenantOrgIds: [String(tenant)],
      },
    });
    world = { api, connection, admin } as unknown as World;
    const step: StepDef = reviewStep("store", roleSource(managerRole));
    await publishWorkflow(world, "makeup_flow", {
      steps: [step],
      checkFormKey: MAKEUP_PUNCH_FORM_KEY,
    });
    await bindForm(world, "makeup_flow", MAKEUP_PUNCH_FORM_KEY);

    await connection.collection(SCHEDULE_PERIODS_COLLECTION).insertOne({
      orgId: zhongshan,
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
    wangNov2 = await entry(wang, "2026-11-02", "08:30", "14:30");
    wangNov3 = await entry(wang, "2026-11-03", "08:30", "14:30");
    linNov2 = await entry(lin, "2026-11-02", "08:30", "14:30");
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  async function entryOptions(at: Date) {
    const data = await ok<{
      makeupPunchEntryOptions: { id: string; date: string }[];
    }>(api, wang.token, ENTRY_OPTIONS, {
      input: { at: at.toISOString(), orgId: String(zhongshan) },
    });
    return data.makeupPunchEntryOptions;
  }

  async function entryIdsOf(at: Date): Promise<string[]> {
    const options = await entryOptions(at);
    return options.map((item) => item.id);
  }

  it("新增頁的「對應排班」下拉:本人補打卡那天在那家店的已發布排班;日期是那天台北 00:00 的時點", async () => {
    expect(await entryOptions(taipei("2026-11-02", "23:59"))).toEqual([
      {
        id: String(wangNov2),
        date: taipei("2026-11-02", "00:00").toISOString(),
      },
    ]);
    // 只有日期、沒有時刻與時區的字串 → 拒收(嚴格 DateTime)
    const result = await call(api, wang.token, ENTRY_OPTIONS, {
      input: { at: "2026-11-02", orgId: String(zhongshan) },
    });
    expect(extensionsOf(result)).toMatchObject({ code: "BAD_USER_INPUT" });
  });

  it("非台北時區(洛杉磯):「那天」照租戶時區算", async () => {
    const orgs = api.connection.collection("orgs");
    await orgs.updateOne(
      { _id: tenant },
      { $set: { "settings.timezone": "America/Los_Angeles" } },
    );
    try {
      // 台北 11/2 08:00 = 洛杉磯 11/1 16:00:洛杉磯 11/1 是 [11/1 07:00Z, 11/2 08:00Z),台北 11/2 早班落在裡面
      expect(await entryIdsOf(taipei("2026-11-02", "08:00"))).toEqual([
        String(wangNov2),
      ]);
      // 台北 11/2 23:59 = 洛杉磯 11/2 07:59:洛杉磯 11/2 列的是台北 11/3 早班
      expect(await entryIdsOf(taipei("2026-11-02", "23:59"))).toEqual([
        String(wangNov3),
      ]);
    } finally {
      await orgs.updateOne(
        { _id: tenant },
        { $unset: { "settings.timezone": "" } },
      );
    }
  });

  it("跨午夜的班:隔天的補打卡也列得到前一天做到這天的班,下班卡記在隔天的時點", async () => {
    const night = await entry(wang, "2026-11-07", "22:00", "02:00");
    try {
      // 11/8 那天:前一天 22:00–02:00 的班做到這天,列出來
      expect(await entryIdsOf(taipei("2026-11-08", "02:10"))).toEqual([
        String(night),
      ]);
      // 11/9 那天:沒有任何一段落在這天,不列
      expect(await entryOptions(taipei("2026-11-09", "01:00"))).toEqual([]);

      const submitted = await submitAs(
        wang,
        values("2026-11-08", String(night), { time: "02:10" }),
      );
      await decideOn(world, manager, submitted.id, "APPROVE");
      expect(await makeupPunchOf(submitted.id)).toMatchObject({
        entryId: night,
        type: "out",
        at: taipei("2026-11-08", "02:10"),
      });
    } finally {
      await entries().deleteOne({ _id: night });
    }
  });

  it("對應排班不是本人補打卡那天在那家店的排班 → 擋下(MAKEUP_PUNCH_ENTRY_MISMATCH)", async () => {
    for (const [date, entryId] of [
      ["2026-11-02", linNov2],
      ["2026-11-03", wangNov2],
    ] as const) {
      const result = await submitError(wang, values(date, String(entryId)));
      expect(extensionsOf(result)).toMatchObject({
        code: "FORBIDDEN",
        reason: MAKEUP_PUNCH_REASONS.entryMismatch,
      });
    }
  });

  it("核准 → 新增一筆 source = 補打卡的打卡,對應排班照申請(不自動找);送出後到核准前顯示「補卡審核中」", async () => {
    const submitted = await submitAs(
      wang,
      values("2026-11-02", String(wangNov2)),
    );
    expect(await pendingIds()).toEqual([String(wangNov2)]);
    expect(
      await punches().countDocuments({
        makeupRequestId: new Types.ObjectId(submitted.id),
      }),
    ).toBe(0);

    await decideOn(world, manager, submitted.id, "APPROVE");
    const written = await punches()
      .find({ makeupRequestId: new Types.ObjectId(submitted.id) })
      .toArray();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      source: "makeup",
      type: "out",
      entryId: wangNov2,
      userId: wang.userId,
      orgId: zhongshan,
      at: taipei("2026-11-02", "14:35"),
      ip: null,
    });
    expect(await pendingIds()).toEqual([]);
  });

  it("選「沒有排班(臨時代班)」→ 核准後是未對應排班的卡(分店 = 申請的分店)", async () => {
    const submitted = await submitAs(
      wang,
      values("2026-11-04", "none", { punch_type: "in", time: "09:02" }),
    );
    await decideOn(world, manager, submitted.id, "APPROVE");
    const written = await punches().findOne({
      makeupRequestId: new Types.ObjectId(submitted.id),
    });
    expect(written).toMatchObject({
      entryId: null,
      orgId: zhongshan,
      type: "in",
      at: taipei("2026-11-04", "09:02"),
    });
  });

  it("審核中那筆排班只改了時間 → 照常核准,打卡記在那一筆", async () => {
    const submitted = await submitAs(
      wang,
      values("2026-11-03", String(wangNov3)),
    );
    await entries().updateOne(
      { _id: wangNov3 },
      {
        $set: {
          startAt: taipei("2026-11-03", "09:00"),
          endAt: taipei("2026-11-03", "15:00"),
        },
      },
    );
    await decideOn(world, manager, submitted.id, "APPROVE");
    const written = await makeupPunchOf(submitted.id);
    expect(written?.entryId).toEqual(wangNov3);
  });

  it("審核中那筆排班被刪除 → 審核頁警告、核准被擋(MAKEUP_PUNCH_ENTRY_DELETED),只能退回", async () => {
    const doomed = await entry(wang, "2026-11-05", "08:30", "14:30");
    const submitted = await submitAs(
      wang,
      values("2026-11-05", String(doomed)),
    );
    expect(await entryExists(submitted.id)).toBe(true);
    await entries().updateOne(
      { _id: doomed },
      { $set: { deletedAt: new Date() } },
    );
    expect(await entryExists(submitted.id)).toBe(false);
    // 審核者(店長,沒有出勤紀錄的權限)查得到;有出勤紀錄 view 的同店同事、申請人也查得到
    expect(await entryExists(submitted.id, lin)).toBe(false);
    expect(await entryExists(submitted.id, wang)).toBe(false);
    // 同租戶、沒有出勤紀錄權限、也不是這張申請的審核者 → NOT_FOUND
    const outsider = await person(api, api.connection, zhongshan, tenant, {
      moduleKeys: ["apply-center", "apply-center.view-page"],
      permissionKeys: ["apply-center.view"],
    });
    const denied = await call(api, outsider.token, EXISTS, {
      submissionId: submitted.id,
    });
    expect(extensionsOf(denied)).toMatchObject({ code: "NOT_FOUND" });

    const task = await pendingTaskOf(world, manager, submitted.id);
    const approve = await call(api, manager.token, DECIDE, {
      input: {
        taskId: task.id,
        expectedEditVersion: task.editVersion,
        decision: "APPROVE",
      },
    });
    expect(extensionsOf(approve)).toMatchObject({
      code: "FORBIDDEN",
      reason: MAKEUP_PUNCH_REASONS.entryDeleted,
    });
    expect(
      await punches().countDocuments({
        makeupRequestId: new Types.ObjectId(submitted.id),
      }),
    ).toBe(0);
    await decideOn(world, manager, submitted.id, "RETURN");
  });

  it("同一張申請的完成同時跑兩次 → 只寫一張卡(makeupRequestId 部分唯一索引)", async () => {
    const submitted = await submitAs(
      wang,
      values("2026-11-06", "none", { punch_type: "in", time: "10:00" }),
    );
    await decideOn(world, manager, submitted.id, "APPROVE");
    const id = new Types.ObjectId(submitted.id);
    // 拿掉核准時寫的那一張,模擬完成的事後動作同時跑兩次
    await punches().deleteMany({ makeupRequestId: id });
    const transactions = api.app.get(TransactionService);
    const service = api.app.get(MakeupPunchService);
    const results = await Promise.allSettled(
      [0, 1].map(() =>
        transactions.withTransaction((session) =>
          service.complete(id, tenant, session),
        ),
      ),
    );
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(await punches().countDocuments({ makeupRequestId: id })).toBe(1);
  });
});
