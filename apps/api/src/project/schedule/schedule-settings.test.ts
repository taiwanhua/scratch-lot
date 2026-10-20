import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import type { Connection, Model, Types } from "mongoose";

import { SCHEDULE_RULE_DEFINITIONS } from "@repo/domain/project/schedule-settings";

import {
  type AuthTestApp,
  type GraphqlResult,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  SCHEDULE_CALENDAR_DAYS_COLLECTION,
  ScheduleCalendarDay,
} from "../database/schedule/schedule-calendar-day.schema";
import {
  SCHEDULE_SETTINGS_COLLECTION,
  ScheduleSetting,
} from "../database/schedule/schedule-setting.schema";
import { SCHEDULE_STAFF_COLLECTION } from "../database/schedule/schedule-staff.schema";
import { ScheduleStaffService } from "./staff/schedule-staff.service";
import {
  ALL_SCHEDULE_TEST_PERMISSIONS,
  SCHEDULE_TEST_PERMISSIONS as P,
  type ScheduleTestUser,
  createScheduleUser,
  seedScheduleAuthorization,
  seedScheduleFieldOptions,
} from "./test-support/fixtures";

// ---- GraphQL ----

const RULE_SETTING = /* GraphQL */ `
  fragment TestRuleSetting on ScheduleRuleSetting {
    enabled
    value
    level
    order
    source
    sourceOrgName
  }
`;

const RULES_FIELDS = /* GraphQL */ `
  orgId
  orgName
  isTenantTop
  canEdit
  items {
    key
    group
    hasLevel
    effective { ...TestRuleSetting }
    parent { ...TestRuleSetting }
  }
`;

const SCHEDULE_RULES = /* GraphQL */ `
  query ScheduleRules($input: ScheduleRulesInput) {
    scheduleRules(input: $input) { ${RULES_FIELDS} }
  }
  ${RULE_SETTING}
`;

const CUSTOMIZE_RULE = /* GraphQL */ `
  mutation CustomizeScheduleRule($input: CustomizeScheduleRuleInput!) {
    customizeScheduleRule(input: $input) { rules { ${RULES_FIELDS} } }
  }
  ${RULE_SETTING}
`;

const RESTORE_RULE = /* GraphQL */ `
  mutation RestoreScheduleRule($input: RestoreScheduleRuleInput!) {
    restoreScheduleRule(input: $input) { rules { ${RULES_FIELDS} } }
  }
  ${RULE_SETTING}
`;

const CUSTOMIZE_AUTO_RUN = /* GraphQL */ `
  mutation CustomizeScheduleAutoRun($input: CustomizeScheduleAutoRunInput!) {
    customizeScheduleAutoRun(input: $input) { rules { ${RULES_FIELDS} } }
  }
  ${RULE_SETTING}
`;

const STAFF_FIELDS = /* GraphQL */ `
  userId
  name
  staff {
    id
    employmentType
    enabled
    primaryElsewhere
    orgs { orgId orgName canLead isPrimary sortOrder }
  }
`;

const SCHEDULE_STAFF = /* GraphQL */ `
  query ScheduleStaff($input: ScheduleStaffListInput) {
    scheduleStaff(input: $input) { canEdit totalCount items { ${STAFF_FIELDS} } }
  }
`;

const ADD_STAFF = /* GraphQL */ `
  mutation AddScheduleStaff($input: AddScheduleStaffInput!) {
    addScheduleStaff(input: $input) { items { ${STAFF_FIELDS} } }
  }
`;

const UPDATE_STAFF = /* GraphQL */ `
  mutation UpdateScheduleStaff($input: UpdateScheduleStaffInput!) {
    updateScheduleStaff(input: $input) { item { ${STAFF_FIELDS} } }
  }
`;

const TEMPLATE_FIELDS = /* GraphQL */ `
  id
  name
  shortName
  tasks { taskId role taskKey }
  paletteKey
  ownerOrg { id name }
  canEdit
`;

const TEMPLATES = /* GraphQL */ `
  query ScheduleDemandTemplates {
    scheduleDemandTemplates { canCreate totalCount items { ${TEMPLATE_FIELDS} } }
  }
`;

const SAVE_TEMPLATE = /* GraphQL */ `
  mutation SaveScheduleDemandTemplate($input: SaveScheduleDemandTemplateInput!) {
    saveScheduleDemandTemplate(input: $input) { item { ${TEMPLATE_FIELDS} } }
  }
`;

const DELETE_TEMPLATE = /* GraphQL */ `
  mutation DeleteScheduleDemandTemplate($input: DeleteScheduleTemplateInput!) {
    deleteScheduleDemandTemplate(input: $input) {
      id
    }
  }
`;

const WEEK_TEMPLATES = /* GraphQL */ `
  query ScheduleDemandWeekTemplates($input: ScheduleDemandWeekTemplatesInput) {
    scheduleDemandWeekTemplates(input: $input) {
      items {
        id
        name
        days
        enabled
        canEdit
      }
    }
  }
`;

const SAVE_WEEK_TEMPLATE = /* GraphQL */ `
  mutation SaveScheduleDemandWeekTemplate(
    $input: SaveScheduleDemandWeekTemplateInput!
  ) {
    saveScheduleDemandWeekTemplate(input: $input) {
      item {
        id
        name
        days
        enabled
        canEdit
      }
    }
  }
`;

const CALENDAR = /* GraphQL */ `
  query ScheduleCalendar($input: ScheduleCalendarInput!) {
    scheduleCalendar(input: $input) {
      canEdit
      days {
        id
        date
        type
        category
        name
        paletteKey
        ownerOrg {
          id
          name
        }
        canEdit
      }
    }
  }
`;

const SAVE_CALENDAR_DAY = /* GraphQL */ `
  mutation SaveScheduleCalendarDay($input: SaveScheduleCalendarDayInput!) {
    saveScheduleCalendarDay(input: $input) {
      item {
        id
        date
        type
        canEdit
      }
    }
  }
`;

const FIELD_OPTIONS = /* GraphQL */ `
  query ScheduleFieldOptions($categoryKey: String!) {
    scheduleFieldOptions(categoryKey: $categoryKey) {
      totalCount
      items {
        value
        label
      }
    }
  }
`;

// ---- 型別 ----

interface RuleSettingRow {
  enabled: boolean;
  value: Record<string, unknown>;
  level: string | null;
  order: number;
  source: string;
  sourceOrgName: string | null;
}

interface RuleRow {
  key: string;
  group: string;
  hasLevel: boolean;
  effective: RuleSettingRow;
  parent: RuleSettingRow | null;
}

interface RulesRow {
  orgId: string;
  orgName: string;
  isTenantTop: boolean;
  canEdit: boolean;
  items: RuleRow[];
}

interface StaffRow {
  userId: string;
  name: string;
  staff: {
    id: string;
    employmentType: string;
    enabled: boolean;
    primaryElsewhere: boolean;
    orgs: {
      orgId: string;
      orgName: string;
      canLead: boolean;
      isPrimary: boolean;
      sortOrder: number;
    }[];
  } | null;
}

interface TemplateRow {
  id: string;
  name: string;
  shortName: string;
  tasks: { taskId: string; role: string; taskKey: string }[];
  paletteKey: string | null;
  ownerOrg: { id: string; name: string };
  canEdit: boolean;
}

interface CalendarDayRow {
  id: string;
  date: string;
  type: string;
  category: string | null;
  name: string | null;
  paletteKey: string | null;
  ownerOrg: { id: string; name: string };
  canEdit: boolean;
}

function errorOf(result: GraphqlResult): Record<string, unknown> | undefined {
  return result.errors?.[0]?.extensions;
}

interface WeekTemplateRow {
  id: string;
  name: string;
  days: string[][];
  enabled: boolean;
  canEdit: boolean;
}

interface CalendarRow {
  canEdit: boolean;
  days: CalendarDayRow[];
}

/** 每個端點回的資料形狀(測試只取用到的欄位)。 */
interface Payloads {
  scheduleRules: RulesRow;
  customizeScheduleRule: { rules: RulesRow };
  restoreScheduleRule: { rules: RulesRow };
  scheduleStaff: { canEdit: boolean; items: StaffRow[] };
  addScheduleStaff: { items: StaffRow[] };
  updateScheduleStaff: { item: StaffRow };
  scheduleDemandTemplates: { canCreate: boolean; items: TemplateRow[] };
  saveScheduleDemandTemplate: { item: TemplateRow };
  scheduleDemandWeekTemplates: { items: WeekTemplateRow[] };
  saveScheduleDemandWeekTemplate: { item: WeekTemplateRow };
  scheduleCalendar: CalendarRow;
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

function ruleOf(rules: RulesRow, key: string): RuleRow {
  const found = rules.items.find((item) => item.key === key);
  if (!found) {
    throw new Error(`規則頁沒有 ${key}`);
  }
  return found;
}

/**
 * 排班設定(規格 14.2–14.4、14.5 行事曆):打真的 GraphQL 端點、對真 MongoDB(TEST-07)。
 * 組織樹:root ─┬─ 租戶甲(可見性 包含下層)─┬─ 中山店
 *               │                           └─ 新竹店
 *               └─ 租戶乙
 */
describe("排班設定(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;

  let tenantA: Types.ObjectId;
  let zhongshan: Types.ObjectId;
  let hsinchu: Types.ObjectId;
  let tenantB: Types.ObjectId;

  /** 總部:所屬租戶甲,全部權限(看得到兩家分店) */
  let hq: ScheduleTestUser;
  /** 中山店店長:看不到租戶甲與新竹店;沒有 edit-default-rules */
  let manager: ScheduleTestUser;
  /** 中山店只有 view 的人 */
  let viewer: ScheduleTestUser;
  /** 租戶乙的總部 */
  let otherHq: ScheduleTestUser;
  /** 員工(不登入) */
  let wang: ScheduleTestUser;
  let lin: ScheduleTestUser;

  function modelOf<T>(name: string): Model<T> {
    return api.app.get<Model<T>>(getModelToken(name));
  }

  function gql(
    user: ScheduleTestUser,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<GraphqlResult> {
    return api.graphql(query, variables, { accessToken: user.token });
  }

  async function rulesOf(
    user: ScheduleTestUser,
    orgId?: Types.ObjectId,
  ): Promise<RulesRow> {
    return dataOf(
      await gql(user, SCHEDULE_RULES, {
        input: orgId === undefined ? null : { orgId: String(orgId) },
      }),
      "scheduleRules",
    );
  }

  function customize(
    user: ScheduleTestUser,
    orgId: Types.ObjectId,
    input: Record<string, unknown>,
  ) {
    return gql(user, CUSTOMIZE_RULE, {
      input: { orgId: String(orgId), ...input },
    });
  }

  async function staffRows(
    user: ScheduleTestUser,
    input: Record<string, unknown> | null = null,
  ): Promise<{ canEdit: boolean; items: StaffRow[] }> {
    return dataOf(await gql(user, SCHEDULE_STAFF, { input }), "scheduleStaff");
  }

  async function templatesOf(user: ScheduleTestUser): Promise<TemplateRow[]> {
    return dataOf(await gql(user, TEMPLATES), "scheduleDemandTemplates").items;
  }

  function saveTemplate(
    user: ScheduleTestUser,
    input: Record<string, unknown>,
  ) {
    return gql(user, SAVE_TEMPLATE, {
      input: {
        name: "早班",
        shortName: "早",
        startTime: "08:30",
        endTime: "14:30",
        positionKey: "in-store-counter",
        tasks: [
          { role: "leader", taskKey: "store-and-accounts-lead" },
          { role: "helper", taskKey: "store-duties" },
        ],
        paletteKey: "yellow",
        ...input,
      },
    });
  }

  async function calendarOf(
    user: ScheduleTestUser,
    orgId: Types.ObjectId,
  ): Promise<{ canEdit: boolean; days: CalendarDayRow[] }> {
    return dataOf(
      await gql(user, CALENDAR, {
        input: { orgId: String(orgId), month: "2026-11" },
      }),
      "scheduleCalendar",
    );
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-schedule-settings");
    connection = api.connection;
    await seedScheduleAuthorization(connection);
    await seedScheduleFieldOptions(connection);
    // 先等唯一索引建好(先例:遊戲代號),同時寫入與直接寫入的測試才擋得到
    await modelOf<ScheduleCalendarDay>(ScheduleCalendarDay.name).init();
    await modelOf<ScheduleSetting>(ScheduleSetting.name).init();

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
    tenantB = await createOrg(connection, { name: "租戶乙" });

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
      [
        P.settingsView,
        P.editTemplates,
        P.editStaff,
        P.editOrgRules,
        P.manageView,
        P.editCalendar,
      ],
    );
    viewer = await createScheduleUser(
      api,
      connection,
      [zhongshan],
      [P.settingsView, P.manageView],
    );
    otherHq = await createScheduleUser(
      api,
      connection,
      [tenantB],
      ALL_SCHEDULE_TEST_PERMISSIONS,
    );
    wang = await createScheduleUser(api, connection, [zhongshan], [], "王小明");
    lin = await createScheduleUser(api, connection, [hsinchu], [], "林新人");
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("規則(SC-10 / SC-27)", () => {
    it("規則頁依定義清單的順序列出每一條規則,自動排班條件在最後", async () => {
      const rules = await rulesOf(manager);
      expect(rules.items.map((item) => item.key)).toEqual(
        SCHEDULE_RULE_DEFINITIONS.map((definition) => definition.key),
      );
      expect(rules.orgName).toBe("中山店");
      expect(rules.isTenantTop).toBe(false);
      expect(rules.canEdit).toBe(true);
    });

    it("最上層組織設 8、分店未設 → 分店 8 沿用最上層組織;看不到上層的人只看到「沿用上層設定」", async () => {
      const result = await customize(hq, tenantA, {
        key: "maxMonthlyDayOffs",
        value: { amount: 8 },
      });
      expect(result.errors).toBeUndefined();

      const fromHq = ruleOf(await rulesOf(hq, zhongshan), "maxMonthlyDayOffs");
      expect(fromHq.effective).toMatchObject({
        value: { amount: 8 },
        source: "INHERITED",
        sourceOrgName: "租戶甲",
      });
      expect(fromHq.parent).toBeNull();

      const fromManager = ruleOf(await rulesOf(manager), "maxMonthlyDayOffs");
      expect(fromManager.effective).toMatchObject({
        value: { amount: 8 },
        source: "INHERITED",
        sourceOrgName: null,
      });
    });

    it("分店自訂 6 → 6,並顯示上層 8;[還原] 回到沿用", async () => {
      const customized = dataOf(
        await customize(manager, zhongshan, {
          key: "maxMonthlyDayOffs",
          value: { amount: 6 },
        }),
        "customizeScheduleRule",
      );
      const rule = ruleOf(customized.rules, "maxMonthlyDayOffs");
      expect(rule.effective).toMatchObject({
        value: { amount: 6 },
        source: "OWN",
        level: "limit",
        sourceOrgName: "中山店",
      });
      expect(rule.parent).toMatchObject({
        value: { amount: 8 },
        source: "INHERITED",
      });
      // 新竹店不受影響
      expect(
        ruleOf(await rulesOf(hq, hsinchu), "maxMonthlyDayOffs").effective.value,
      ).toEqual({ amount: 8 });

      const restored = dataOf(
        await gql(manager, RESTORE_RULE, {
          input: { orgId: String(zhongshan), key: "maxMonthlyDayOffs" },
        }),
        "restoreScheduleRule",
      );
      expect(ruleOf(restored.rules, "maxMonthlyDayOffs").effective.source).toBe(
        "INHERITED",
      );
    });

    it("等級與排序一起自訂;沒有等級的規則送 level → VALIDATION_FAILED", async () => {
      const ok = await customize(manager, zhongshan, {
        key: "maxConsecutiveWorkDays",
        value: { amount: 6 },
        level: "limit",
        order: 3,
      });
      expect(ok.errors).toBeUndefined();
      const bad = await customize(manager, zhongshan, {
        key: "dayOffWindow",
        level: "limit",
      });
      expect(errorOf(bad)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["level"],
      });
    });

    it.each([
      ["maxMonthlyDayOffs", { value: { amount: 40 } }, ["value.amount"]],
      ["maxDailyWorkHours", { value: { amount: 7.25 } }, ["value.amount"]],
      [
        "dayOffWindow",
        { value: { startDay: 25, endDay: 15 } },
        ["value.endDay"],
      ],
      ["maxMonthlyDayOffs", { level: "warning" }, ["level"]],
      ["nope", {}, ["key"]],
      [
        "autoDemandWeekTemplateId",
        { value: { weekTemplateId: "0123456789abcdef01234567" } },
        ["value.weekTemplateId"],
      ],
    ])("%s %j → VALIDATION_FAILED %j", async (key, input, fields) => {
      const result = await customize(manager, zhongshan, { key, ...input });
      expect(errorOf(result)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields,
      });
    });

    it("最上層組織的規則要 edit-default-rules;分店店長改不了(看不到 → NOT_FOUND)", async () => {
      const notVisible = await customize(manager, tenantA, {
        key: "maxMonthlyDayOffs",
        value: { amount: 3 },
      });
      expect(errorOf(notVisible)).toMatchObject({ code: "NOT_FOUND" });

      const orgRulesOnly = await createScheduleUser(
        api,
        connection,
        [tenantA],
        [P.settingsView, P.editOrgRules],
      );
      const orgRulesView = await rulesOf(orgRulesOnly);
      expect(orgRulesView.canEdit).toBe(false);
      const forbidden = await customize(orgRulesOnly, tenantA, {
        key: "maxMonthlyDayOffs",
        value: { amount: 3 },
      });
      expect(errorOf(forbidden)).toMatchObject({
        code: "FORBIDDEN",
        reason: "MISSING_PERMISSION",
      });
      // 同一個人改分店可以
      const branch = await customize(orgRulesOnly, hsinchu, {
        key: "maxDailyDayOffStaff",
        value: { amount: 3 },
      });
      expect(branch.errors).toBeUndefined();
    });

    it("只有 view:看得到規則頁、canEdit = false,改不了", async () => {
      const rules = await rulesOf(viewer);
      expect(rules.canEdit).toBe(false);
      const result = await customize(viewer, zhongshan, {
        key: "maxMonthlyDayOffs",
        value: { amount: 5 },
      });
      expect(errorOf(result)).toMatchObject({ code: "FORBIDDEN" });
    });

    it("別的租戶看不到這家店 → NOT_FOUND", async () => {
      const result = await gql(otherHq, SCHEDULE_RULES, {
        input: { orgId: String(zhongshan) },
      });
      expect(errorOf(result)).toMatchObject({ code: "NOT_FOUND" });
    });

    it("自動排班條件整組繼承:分店自訂一條 → 整組本店自訂;[還原] → 整組沿用", async () => {
      const groupKeys = SCHEDULE_RULE_DEFINITIONS.filter(
        (definition) => definition.group === "autoRun",
      ).map((definition) => definition.key);
      const tenantSet = await gql(hq, CUSTOMIZE_AUTO_RUN, {
        input: {
          orgId: String(tenantA),
          conditions: [
            { key: "leaderCountFirst", enabled: true },
            { key: "continuePreviousEntry", enabled: false },
            { key: "monthlyShiftBalance", enabled: true },
            { key: "allowOverlappingDemands", enabled: false },
          ],
        },
      });
      expect(tenantSet.errors).toBeUndefined();

      const inherited = await rulesOf(manager);
      for (const key of groupKeys) {
        expect(ruleOf(inherited, key).effective.source).toBe("INHERITED");
      }
      expect(ruleOf(inherited, "leaderCountFirst").effective.order).toBe(1);

      const customized = dataOf(
        await customize(manager, zhongshan, {
          key: "allowOverlappingDemands",
          enabled: true,
        }),
        "customizeScheduleRule",
      );
      for (const key of groupKeys) {
        expect(ruleOf(customized.rules, key).effective.source).toBe("OWN");
      }
      // 沒改的條件照抄上層的生效值
      expect(
        ruleOf(customized.rules, "continuePreviousEntry").effective.enabled,
      ).toBe(false);
      expect(
        ruleOf(customized.rules, "allowOverlappingDemands").effective.enabled,
      ).toBe(true);

      const restored = dataOf(
        await gql(manager, RESTORE_RULE, {
          input: { orgId: String(zhongshan), key: "leaderCountFirst" },
        }),
        "restoreScheduleRule",
      );
      for (const key of groupKeys) {
        expect(ruleOf(restored.rules, key).effective.source).toBe("INHERITED");
      }
    });

    it("存檔前只留定義裡的欄位:多送的 key 丟掉", async () => {
      const result = await customize(manager, zhongshan, {
        key: "entryMatchToleranceMinutes",
        value: { amount: 30, extra: "x", nested: { a: 1 } },
      });
      expect(result.errors).toBeUndefined();
      const stored = await connection
        .collection(SCHEDULE_SETTINGS_COLLECTION)
        .findOne<{ value: Record<string, unknown> }>({
          orgId: zhongshan,
          key: "entryMatchToleranceMinutes",
          deletedAt: null,
        });
      expect(stored?.value).toEqual({ amount: 30 });
    });

    it("負責人 / 協同預設任務要是「執行任務」啟用中的選項", async () => {
      const bad = await customize(manager, zhongshan, {
        key: "defaultTasks",
        value: {
          defaultLeaderTaskKey: "not-a-task",
          defaultHelperTaskKey: "store-duties",
        },
      });
      expect(errorOf(bad)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["value.defaultLeaderTaskKey"],
      });
      const ok = await customize(manager, zhongshan, {
        key: "defaultTasks",
        value: {
          defaultLeaderTaskKey: "store-duties",
          defaultHelperTaskKey: "store-duties",
        },
      });
      expect(ok.errors).toBeUndefined();
    });

    it("同一組織同一條規則只有一筆未刪除的自訂(唯一索引)", async () => {
      const settings = connection.collection(SCHEDULE_SETTINGS_COLLECTION);
      const row = {
        orgId: hsinchu,
        key: "minRestBetweenShifts",
        enabled: true,
        value: { amount: 10 },
        level: "reminder",
        order: 5,
        deletedAt: null,
      };
      await settings.insertOne({ ...row });
      await expect(settings.insertOne({ ...row })).rejects.toMatchObject({
        code: 11_000,
      });
      // 軟刪除的不算
      await settings.insertOne({ ...row, deletedAt: new Date() });
      await settings.deleteMany({ orgId: hsinchu, key: row.key });
    });

    it("整組自訂要列出每一條條件各一次", async () => {
      const result = await gql(manager, CUSTOMIZE_AUTO_RUN, {
        input: {
          orgId: String(zhongshan),
          conditions: [{ key: "leaderCountFirst", enabled: true }],
        },
      });
      expect(errorOf(result)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["conditions"],
      });
    });
  });

  describe("排班人員(SC-08 / SC-26)", () => {
    it("候選使用者 = 看得到的組織的使用者;未加入的才能 [加入排班]", async () => {
      const managerView = await staffRows(manager);
      const names = managerView.items.map((row) => row.name);
      expect(names).toContain("王小明");
      expect(names).not.toContain("林新人");
      expect(managerView.canEdit).toBe(true);

      const added = dataOf(
        await gql(manager, ADD_STAFF, {
          input: { userIds: [String(wang.userId)] },
        }),
        "addScheduleStaff",
      );
      expect(added.items[0]?.staff).toMatchObject({
        employmentType: "full-time",
        enabled: true,
        orgs: [],
      });

      // 排班檔案是整個租戶共用的:歸屬欄 = 租戶頂層(分店店長加的也一樣)
      const document = await connection
        .collection(SCHEDULE_STAFF_COLLECTION)
        .findOne<{ orgId: Types.ObjectId; tenantId: Types.ObjectId }>({
          userId: wang.userId,
        });
      expect(String(document?.orgId)).toBe(String(tenantA));
      expect(String(document?.tenantId)).toBe(String(tenantA));

      const again = await gql(manager, ADD_STAFF, {
        input: { userIds: [String(wang.userId)] },
      });
      expect(errorOf(again)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["userIds"],
      });

      const joined = await staffRows(manager, { joined: true });
      expect(joined.items.map((row) => row.name)).toEqual(["王小明"]);
      const notJoined = await staffRows(manager, { joined: false });
      expect(notJoined.items.map((row) => row.name)).not.toContain("王小明");
    });

    it("看不到的使用者加不了(NOT_FOUND);沒有 edit-staff 加不了(FORBIDDEN)", async () => {
      const hidden = await gql(manager, ADD_STAFF, {
        input: { userIds: [String(lin.userId)] },
      });
      expect(errorOf(hidden)).toMatchObject({ code: "NOT_FOUND" });
      const noPermission = await gql(viewer, ADD_STAFF, {
        input: { userIds: [String(lin.userId)] },
      });
      expect(errorOf(noPermission)).toMatchObject({ code: "FORBIDDEN" });
      const viewerStaff = await staffRows(viewer);
      expect(viewerStaff.canEdit).toBe(false);
    });

    it("可以排的分店:主要分店每人一家;看不到的分店不能加;看不到的分店的關聯保留", async () => {
      const joinedRows = await staffRows(manager, { joined: true });
      const row = joinedRows.items[0];
      const staffId = row?.staff?.id;
      if (staffId === undefined) {
        throw new Error("王小明沒有排班檔案");
      }
      const update = (user: ScheduleTestUser, orgs: unknown[]) =>
        gql(user, UPDATE_STAFF, { input: { staffId, orgs } });

      const hiddenOrg = await update(manager, [
        { orgId: String(zhongshan), canLead: true, isPrimary: true },
        { orgId: String(hsinchu), canLead: false, isPrimary: false },
      ]);
      expect(errorOf(hiddenOrg)).toMatchObject({ code: "NOT_FOUND" });

      const twoPrimary = await update(hq, [
        { orgId: String(zhongshan), canLead: true, isPrimary: true },
        { orgId: String(hsinchu), canLead: false, isPrimary: true },
      ]);
      expect(errorOf(twoPrimary)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["orgs"],
      });
      const noPrimary = await update(hq, [
        { orgId: String(zhongshan), canLead: true, isPrimary: false },
      ]);
      expect(errorOf(noPrimary)).toMatchObject({ code: "VALIDATION_FAILED" });

      const supported = dataOf(
        await update(hq, [
          { orgId: String(zhongshan), canLead: true, isPrimary: true },
          { orgId: String(hsinchu), canLead: false, isPrimary: false },
        ]),
        "updateScheduleStaff",
      );
      expect(supported.item.staff?.orgs).toEqual([
        expect.objectContaining({
          orgName: "中山店",
          canLead: true,
          isPrimary: true,
          sortOrder: 1,
        }),
        expect.objectContaining({
          orgName: "新竹店",
          canLead: false,
          isPrimary: false,
          sortOrder: 2,
        }),
      ]);

      // 店長只看得到中山店:存檔時新竹店的支援關聯保留
      const fromManager = dataOf(
        await gql(manager, UPDATE_STAFF, {
          input: {
            staffId,
            employmentType: "part-time",
            orgs: [
              { orgId: String(zhongshan), canLead: false, isPrimary: true },
            ],
          },
        }),
        "updateScheduleStaff",
      );
      expect(fromManager.item.staff?.employmentType).toBe("part-time");
      expect(fromManager.item.staff?.orgs.map((org) => org.orgName)).toEqual([
        "中山店",
      ]);
      const hqRows = await staffRows(hq, { joined: true });
      const hqView = hqRows.items.find((item) => item.name === "王小明");
      expect(hqView?.staff?.orgs.map((org) => org.orgName)).toEqual([
        "中山店",
        "新竹店",
      ]);

      // 候選人:有排班檔案、可以排的分店包含這家店
      const service = api.app.get(ScheduleStaffService);
      const system = {
        actorId: null,
        currentOrgId: null,
        visibleOrgIds: "all" as const,
        managedOrgIds: "all" as const,
        memberOrgIds: [],
        roleIds: [],
      };
      const zhongshanCandidates = await service.listScheduleCandidates(
        system,
        zhongshan,
      );
      expect(zhongshanCandidates).toEqual([
        expect.objectContaining({
          name: "王小明",
          canLead: false,
          isPrimary: true,
        }),
      ]);
      const hsinchuCandidates = await service.listScheduleCandidates(
        system,
        hsinchu,
      );
      expect(hsinchuCandidates.map((item) => item.name)).toEqual(["王小明"]);
      // 加入新竹店之前的時間點,新竹店還沒有他
      expect(
        await service.listScheduleCandidates(system, hsinchu, new Date(0)),
      ).toEqual([]);
    });
  });

  describe("人力需求範本 / 週範本(SC-09a / SC-09b / SC-22a / SC-22b)", () => {
    let tenantTemplateId: string;

    it("上層建立的範本下層看得到、改不了(FORBIDDEN / NOT_OWNER)", async () => {
      const created = dataOf(
        await saveTemplate(hq, {}),
        "saveScheduleDemandTemplate",
      );
      tenantTemplateId = created.item.id;
      expect(created.item).toMatchObject({
        name: "早班",
        ownerOrg: { name: "租戶甲" },
        canEdit: true,
      });
      expect(created.item.tasks).toHaveLength(2);

      const fromBranch = await templatesOf(manager);
      expect(fromBranch).toContainEqual(
        expect.objectContaining({
          id: tenantTemplateId,
          ownerOrg: expect.objectContaining({ name: "租戶甲" }),
          canEdit: false,
        }),
      );

      const edit = await saveTemplate(manager, {
        id: tenantTemplateId,
        name: "改名",
      });
      expect(errorOf(edit)).toMatchObject({
        code: "FORBIDDEN",
        reason: "NOT_OWNER",
      });
      const remove = await gql(manager, DELETE_TEMPLATE, {
        input: { id: tenantTemplateId },
      });
      expect(errorOf(remove)).toMatchObject({
        code: "FORBIDDEN",
        reason: "NOT_OWNER",
      });
    });

    it("下層建立的範本上層看不到;別的租戶看不到(NOT_FOUND)", async () => {
      const branchTemplate = dataOf(
        await saveTemplate(manager, {
          name: "補貨",
          shortName: "補",
          startTime: "13:00",
          endTime: "17:00",
          positionKey: "restock",
          tasks: [{ role: "helper", taskKey: "store-duties" }],
          paletteKey: "green",
        }),
        "saveScheduleDemandTemplate",
      );
      expect(branchTemplate.item.canEdit).toBe(true);
      const hqTemplates = await templatesOf(hq);
      const hqIds = hqTemplates.map((item) => item.id);
      expect(hqIds).toContain(tenantTemplateId);
      expect(hqIds).not.toContain(branchTemplate.item.id);

      expect(await templatesOf(otherHq)).toEqual([]);
      const foreign = await saveTemplate(otherHq, {
        id: tenantTemplateId,
      });
      expect(errorOf(foreign)).toMatchObject({ code: "NOT_FOUND" });
    });

    it("負責超過 1 筆 / 協同超過 10 筆 → VALIDATION_FAILED", async () => {
      const leaders = await saveTemplate(hq, {
        tasks: [
          { role: "leader", taskKey: "store-and-accounts-lead" },
          { role: "leader", taskKey: "store-and-accounts-lead" },
        ],
      });
      expect(errorOf(leaders)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["tasks"],
      });
      const helpers = await saveTemplate(hq, {
        tasks: Array.from({ length: 11 }, () => ({
          role: "helper",
          taskKey: "store-duties",
        })),
      });
      expect(errorOf(helpers)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["tasks"],
      });
      const tenHelpers = await saveTemplate(hq, {
        name: "大班",
        shortName: "大",
        tasks: Array.from({ length: 10 }, () => ({
          role: "helper",
          taskKey: "store-duties",
        })),
      });
      expect(tenHelpers.errors).toBeUndefined();
    });

    it.each([
      [{ shortName: "早班一" }, ["shortName"]],
      [{ startTime: "8:30" }, ["startTime"]],
      [{ endTime: "08:30", startTime: "08:30" }, ["endTime"]],
      [{ paletteKey: "#ffcc00" }, ["paletteKey"]],
      [{ name: " " }, ["name"]],
    ])("範本欄位 %j → VALIDATION_FAILED %j", async (input, fields) => {
      const result = await saveTemplate(hq, input);
      expect(errorOf(result)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields,
      });
    });

    it("週範本:只能選這一層看得到的範本;上層的週範本下層改不了", async () => {
      const days = [[], [tenantTemplateId], [], [], [], [], []];
      const created = dataOf(
        await gql(hq, SAVE_WEEK_TEMPLATE, { input: { name: "一般週", days } }),
        "saveScheduleDemandWeekTemplate",
      );
      expect(created.item.days).toEqual(days);

      const fromBranch = dataOf(
        await gql(manager, WEEK_TEMPLATES),
        "scheduleDemandWeekTemplates",
      );
      expect(fromBranch.items).toContainEqual(
        expect.objectContaining({ id: created.item.id, canEdit: false }),
      );
      const edit = await gql(manager, SAVE_WEEK_TEMPLATE, {
        input: { id: created.item.id, name: "改", days },
      });
      expect(errorOf(edit)).toMatchObject({
        code: "FORBIDDEN",
        reason: "NOT_OWNER",
      });

      const unknown = await gql(hq, SAVE_WEEK_TEMPLATE, {
        input: {
          name: "壞的",
          days: [["0123456789abcdef01234567"], [], [], [], [], [], []],
        },
      });
      expect(errorOf(unknown)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["days"],
      });
      const sixDays = await gql(hq, SAVE_WEEK_TEMPLATE, {
        input: { name: "六天", days: [[], [], [], [], [], []] },
      });
      expect(errorOf(sixDays)).toMatchObject({ code: "VALIDATION_FAILED" });

      // 預設人力需求週範本:選得到看得到的週範本
      const rule = await customize(manager, zhongshan, {
        key: "autoDemandWeekTemplateId",
        value: { weekTemplateId: created.item.id },
      });
      expect(rule.errors).toBeUndefined();
    });

    it("崗位、執行任務要是欄位管理啟用中的選項", async () => {
      expect(
        errorOf(await saveTemplate(hq, { positionKey: "nowhere" })),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["positionKey"] });
      expect(
        errorOf(await saveTemplate(hq, { positionKey: "retired-position" })),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["positionKey"] });
      expect(
        errorOf(
          await saveTemplate(hq, {
            tasks: [{ role: "helper", taskKey: "unknown-task" }],
          }),
        ),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["tasks"] });
    });

    it("週範本列表帶 orgId:總部看分店時,那家店建立的週範本名稱正確,兄弟分店的不出現", async () => {
      const branchTemplate = dataOf(
        await saveTemplate(manager, { name: "中山早", shortName: "中" }),
        "saveScheduleDemandTemplate",
      ).item;
      const zhongshanWeek = dataOf(
        await gql(manager, SAVE_WEEK_TEMPLATE, {
          input: {
            name: "中山週",
            days: [[branchTemplate.id], [], [], [], [], [], []],
          },
        }),
        "saveScheduleDemandWeekTemplate",
      ).item;
      const hsinchuManager = await createScheduleUser(
        api,
        connection,
        [hsinchu],
        [P.settingsView, P.editTemplates],
      );
      dataOf(
        await gql(hsinchuManager, SAVE_WEEK_TEMPLATE, {
          input: { name: "新竹週", days: [[], [], [], [], [], [], []] },
        }),
        "saveScheduleDemandWeekTemplate",
      );

      const forZhongshan = dataOf(
        await gql(hq, WEEK_TEMPLATES, { input: { orgId: String(zhongshan) } }),
        "scheduleDemandWeekTemplates",
      ).items;
      const names = forZhongshan.map((item) => item.name);
      expect(names).toEqual(expect.arrayContaining(["一般週", "中山週"]));
      expect(names).not.toContain("新竹週");
      expect(
        forZhongshan.find((item) => item.id === zhongshanWeek.id)?.days[0],
      ).toEqual([branchTemplate.id]);
      // 總部看分店時,分店建立的週範本不是總部這一層的,改不了
      expect(
        forZhongshan.find((item) => item.id === zhongshanWeek.id)?.canEdit,
      ).toBe(false);

      // 沒帶 orgId = 當前組織(總部):看不到分店建立的
      const ownList = dataOf(
        await gql(hq, WEEK_TEMPLATES),
        "scheduleDemandWeekTemplates",
      ).items;
      expect(ownList.map((item) => item.name)).not.toContain("中山週");

      // 規則的預設週範本選得到中山週
      const rule = await customize(hq, zhongshan, {
        key: "autoDemandWeekTemplateId",
        value: { weekTemplateId: zhongshanWeek.id },
      });
      expect(rule.errors).toBeUndefined();
    });

    it("沒有 edit-templates:canCreate = false,新增被擋", async () => {
      const payload = dataOf(
        await gql(viewer, TEMPLATES),
        "scheduleDemandTemplates",
      );
      expect(payload.canCreate).toBe(false);
      expect(errorOf(await saveTemplate(viewer, {}))).toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("行事曆(SC-07 / SC-28)", () => {
    it("子分店未設、最上層組織設店休 → 子分店那天是店休;子分店自設特殊日 → 以子分店為準", async () => {
      const closed = await gql(hq, SAVE_CALENDAR_DAY, {
        input: {
          orgId: String(tenantA),
          date: "2026-11-03",
          type: "closed",
          name: "盤點日",
        },
      });
      expect(closed.errors).toBeUndefined();

      const inherited = await calendarOf(manager, zhongshan);
      expect(inherited.canEdit).toBe(true);
      expect(inherited.days).toEqual([
        expect.objectContaining({
          date: "2026-11-03",
          type: "closed",
          ownerOrg: expect.objectContaining({ name: "租戶甲" }),
          canEdit: false,
        }),
      ]);
      const upperId = inherited.days[0]?.id;

      const special = await gql(manager, SAVE_CALENDAR_DAY, {
        input: {
          orgId: String(zhongshan),
          date: "2026-11-03",
          type: "special",
          category: "event-day",
          name: "店慶",
          paletteKey: "cyan",
        },
      });
      expect(special.errors).toBeUndefined();

      const own = await calendarOf(manager, zhongshan);
      expect(own.days).toEqual([
        expect.objectContaining({
          date: "2026-11-03",
          type: "special",
          name: "店慶",
          paletteKey: "cyan",
          canEdit: true,
        }),
      ]);
      // 新竹店沒自設 → 仍是最上層組織的店休
      const other = await calendarOf(hq, hsinchu);
      expect(other.days[0]).toMatchObject({ type: "closed", name: "盤點日" });

      // 上層設的那一天,下層改不了
      const edit = await gql(manager, SAVE_CALENDAR_DAY, {
        input: {
          id: upperId,
          orgId: String(zhongshan),
          date: "2026-11-03",
          type: "closed",
        },
      });
      expect(errorOf(edit)).toMatchObject({
        code: "FORBIDDEN",
        reason: "NOT_OWNER",
      });
    });

    it("同一層同一天只能有一筆;特殊日要類別與名稱", async () => {
      const duplicate = await gql(manager, SAVE_CALENDAR_DAY, {
        input: {
          orgId: String(zhongshan),
          date: "2026-11-03",
          type: "closed",
        },
      });
      expect(errorOf(duplicate)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["date"],
      });
      const missing = await gql(manager, SAVE_CALENDAR_DAY, {
        input: {
          orgId: String(zhongshan),
          date: "2026-11-30",
          type: "special",
        },
      });
      expect(errorOf(missing)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["category", "name"],
      });
    });

    it("特殊日類別要是「特殊日類別」啟用中的選項", async () => {
      const result = await gql(manager, SAVE_CALENDAR_DAY, {
        input: {
          orgId: String(zhongshan),
          date: "2026-11-21",
          type: "special",
          category: "no-such-category",
          name: "活動",
        },
      });
      expect(errorOf(result)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["category"],
      });
    });

    it("唯一索引 (orgId, date):直接寫第二筆未刪除的 → E11000;軟刪除的不算", async () => {
      const days = connection.collection(SCHEDULE_CALENDAR_DAYS_COLLECTION);
      const row = {
        orgId: hsinchu,
        date: "2026-12-01",
        type: "closed",
        category: null,
        name: null,
        note: null,
        paletteKey: null,
        deletedAt: null,
      };
      await days.insertOne({ ...row });
      await expect(days.insertOne({ ...row })).rejects.toMatchObject({
        code: 11_000,
      });
      await days.insertOne({ ...row, deletedAt: new Date() });
      await days.deleteMany({ orgId: hsinchu, date: row.date });
    });

    it("同時新增同一天:只成功一筆,另一筆 VALIDATION_FAILED(date)", async () => {
      const input = {
        orgId: String(zhongshan),
        date: "2026-11-25",
        type: "closed",
      };
      const results = await Promise.all(
        [1, 2].map(() => gql(manager, SAVE_CALENDAR_DAY, { input })),
      );
      const succeeded = results.filter((result) => result.errors === undefined);
      expect(succeeded).toHaveLength(1);
      expect(results.flatMap((result) => result.errors ?? [])).toEqual([
        expect.objectContaining({
          extensions: expect.objectContaining({
            code: "VALIDATION_FAILED",
            fields: ["date"],
          }),
        }),
      ]);
    });

    it("沒有 edit-calendar:canEdit = false,新增被擋", async () => {
      const calendar = await calendarOf(viewer, zhongshan);
      expect(calendar.canEdit).toBe(false);
      expect(calendar.days.every((day) => !day.canEdit)).toBe(true);
      const result = await gql(viewer, SAVE_CALENDAR_DAY, {
        input: {
          orgId: String(zhongshan),
          date: "2026-11-20",
          type: "closed",
        },
      });
      expect(errorOf(result)).toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("下拉選項", () => {
    it("只收排班的類別 key", async () => {
      const result = await gql(manager, FIELD_OPTIONS, {
        categoryKey: "gender",
      });
      expect(errorOf(result)).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["categoryKey"],
      });
      const schedule = await gql(manager, FIELD_OPTIONS, {
        categoryKey: "schedule-position",
      });
      expect(schedule.errors).toBeUndefined();
    });
  });
});
