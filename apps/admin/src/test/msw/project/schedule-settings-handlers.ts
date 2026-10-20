import { HttpResponse } from "msw";

import {
  SCHEDULE_RULE_DEFINITIONS,
  hasRuleLevel,
} from "@repo/domain/project/schedule-settings";
import {
  type AddScheduleStaffMutationVariables,
  type CustomizeScheduleAutoRunMutationVariables,
  type CustomizeScheduleRuleMutationVariables,
  type DeleteScheduleDemandTemplateMutationVariables,
  type RestoreScheduleRuleMutationVariables,
  type SaveScheduleDemandTemplateMutationVariables,
  type SaveScheduleDemandWeekTemplateMutationVariables,
  type ScheduleDemandTemplateFieldsFragment,
  type ScheduleDemandWeekTemplateFieldsFragment,
  ScheduleRuleSource,
  type ScheduleRulesFieldsFragment,
  type ScheduleRulesQueryVariables,
  type ScheduleStaffQueryVariables,
  type ScheduleStaffRowFieldsFragment,
  type UpdateScheduleStaffMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "../auth-handlers";
import { api } from "../server";
import {
  SCHEDULE_BRANCH,
  SCHEDULE_TENANT,
  SCHEDULE_TEST_OPTIONS,
  sampleScheduleStaff,
  sampleScheduleTemplates,
  sampleScheduleWeekTemplates,
} from "./schedule-settings-fixtures";

export interface ScheduleSettingsWorldOptions {
  /** 對應權限:有就讓 api 回 canEdit / canCreate = true */
  canEditStaff?: boolean;
  canEditTemplates?: boolean;
  canEditRules?: boolean;
  /** 規則頁預設看的組織(當前組織);預設分店 */
  currentOrg?: { id: string; name: string };
  staff?: ScheduleStaffRowFieldsFragment[];
  templates?: ScheduleDemandTemplateFieldsFragment[];
  weekTemplates?: ScheduleDemandWeekTemplateFieldsFragment[];
  /** 已自訂的規則:組織 id → key → 設定 */
  ruleRows?: Record<string, Record<string, OwnRule>>;
}

export interface OwnRule {
  enabled: boolean;
  value: Record<string, unknown>;
  level: string | null;
  order: number;
}

/**
 * 班表管理的排班設定(排班人員、範本、規則)的假 api:有狀態 —— 寫入後重查看得到新值。
 * 規則照 `docs/modules/project/schedule.md`:能不能改(`canEdit` / `canCreate`)由 api 算好,
 * 這裡依夾具的權限旗標回;規則的生效值只模擬「最上層組織 → 分店」兩層。
 * 夾具在 `schedule-settings-fixtures.ts`。
 */

/** 分店往上的組織鏈(最上層組織只有自己)。 */
const chainOf = (orgId: string): string[] =>
  orgId === SCHEDULE_TENANT.id ? [orgId] : [orgId, SCHEDULE_TENANT.id];

const ORG_NAMES: Record<string, string> = {
  [SCHEDULE_TENANT.id]: SCHEDULE_TENANT.name,
  [SCHEDULE_BRANCH.id]: SCHEDULE_BRANCH.name,
  "org-content": "A-1 內容組",
};

const nameOf = (orgId: string): string => ORG_NAMES[orgId] ?? orgId;

type RuleSetting = ScheduleRulesFieldsFragment["items"][number]["effective"];

const AUTO_RUN_KEYS = new Set(
  SCHEDULE_RULE_DEFINITIONS.filter((rule) => rule.group === "autoRun").map(
    (rule) => rule.key,
  ),
);

let sequence = 0;
const nextId = (prefix: string): string => {
  sequence += 1;
  return `${prefix}-${String(sequence)}`;
};

export const scheduleSettingsWorld = (
  options: ScheduleSettingsWorldOptions = {},
) => {
  const {
    canEditStaff = true,
    canEditTemplates = true,
    canEditRules = true,
    currentOrg = SCHEDULE_BRANCH,
  } = options;
  let staff = [...(options.staff ?? sampleScheduleStaff)];
  let templates = [...(options.templates ?? sampleScheduleTemplates)];
  let weekTemplates = [
    ...(options.weekTemplates ?? sampleScheduleWeekTemplates),
  ];
  const ruleRows: Record<string, Record<string, OwnRule>> = {
    [SCHEDULE_TENANT.id]: {
      maxMonthlyDayOffs: {
        enabled: true,
        value: { amount: 8 },
        level: "limit",
        order: 1,
      },
    },
    [SCHEDULE_BRANCH.id]: {
      maxConsecutiveWorkDays: {
        enabled: true,
        value: { amount: 6 },
        level: "reminder",
        order: 3,
      },
    },
    ...options.ruleRows,
  };
  const inputs = {
    customize: [] as CustomizeScheduleRuleMutationVariables["input"][],
    restore: [] as RestoreScheduleRuleMutationVariables["input"][],
    addStaff: [] as AddScheduleStaffMutationVariables["input"][],
  };

  const settingAt = (
    chain: readonly string[],
    key: string,
    offset: number,
  ): RuleSetting => {
    const definition = SCHEDULE_RULE_DEFINITIONS.find(
      (rule) => rule.key === key,
    );
    for (const [index, orgId] of chain.entries()) {
      const rows: Partial<Record<string, OwnRule>> = ruleRows[orgId] ?? {};
      const hasGroup =
        AUTO_RUN_KEYS.has(key) &&
        Object.keys(rows).some((rowKey) => AUTO_RUN_KEYS.has(rowKey));
      const row = rows[key];
      if (row !== undefined || hasGroup) {
        const source =
          index + offset === 0
            ? ScheduleRuleSource.Own
            : ScheduleRuleSource.Inherited;
        const base = row ?? {
          enabled: definition?.defaults.enabled ?? true,
          value: definition?.defaults.value ?? {},
          level: definition?.defaults.level ?? null,
          order: definition?.defaults.order ?? 0,
        };
        return { ...base, source, sourceOrgName: nameOf(orgId) };
      }
    }
    return {
      enabled: definition?.defaults.enabled ?? true,
      value: definition?.defaults.value ?? {},
      level: definition?.defaults.level ?? null,
      order: definition?.defaults.order ?? 0,
      source: ScheduleRuleSource.Default,
      sourceOrgName: null,
    };
  };

  const rulesOf = (orgId: string): ScheduleRulesFieldsFragment => {
    const chain = chainOf(orgId);
    return {
      orgId,
      orgName: nameOf(orgId),
      isTenantTop: orgId === SCHEDULE_TENANT.id,
      canEdit: canEditRules,
      items: SCHEDULE_RULE_DEFINITIONS.map((definition) => {
        const effective = settingAt(chain, definition.key, 0);
        return {
          key: definition.key,
          group: definition.group,
          valueType: definition.valueType,
          unit: definition.unit,
          hasLevel: hasRuleLevel(definition),
          effective,
          parent:
            effective.source === ScheduleRuleSource.Own
              ? settingAt(chain.slice(1), definition.key, 1)
              : null,
        };
      }),
    };
  };

  const handlers = [
    api.query("ScheduleFieldOptions", ({ variables }) => {
      const items = SCHEDULE_TEST_OPTIONS[String(variables.categoryKey)] ?? [];
      return HttpResponse.json({
        data: { scheduleFieldOptions: { items, totalCount: items.length } },
      });
    }),
    api.query("ScheduleRules", ({ variables }) => {
      const { input } = variables as ScheduleRulesQueryVariables;
      return HttpResponse.json({
        data: { scheduleRules: rulesOf(input?.orgId ?? currentOrg.id) },
      });
    }),
    api.mutation("CustomizeScheduleRule", ({ variables }) => {
      const { input } = variables as CustomizeScheduleRuleMutationVariables;
      inputs.customize.push(input);
      const orgId = input.orgId ?? currentOrg.id;
      const current = settingAt(chainOf(orgId), input.key, 0);
      ruleRows[orgId] = {
        ...ruleRows[orgId],
        [input.key]: {
          enabled: input.enabled ?? current.enabled,
          value: input.value ?? current.value,
          level: input.level ?? current.level ?? null,
          order: input.order ?? current.order,
        },
      };
      return HttpResponse.json({
        data: { customizeScheduleRule: { rules: rulesOf(orgId) } },
      });
    }),
    api.mutation("CustomizeScheduleAutoRun", ({ variables }) => {
      const { input } = variables as CustomizeScheduleAutoRunMutationVariables;
      const orgId = input.orgId ?? currentOrg.id;
      const rows = { ...ruleRows[orgId] };
      for (const [index, condition] of input.conditions.entries()) {
        rows[condition.key] = {
          enabled: condition.enabled,
          value: {},
          level: null,
          order: index + 1,
        };
      }
      ruleRows[orgId] = rows;
      return HttpResponse.json({
        data: { customizeScheduleAutoRun: { rules: rulesOf(orgId) } },
      });
    }),
    api.mutation("RestoreScheduleRule", ({ variables }) => {
      const { input } = variables as RestoreScheduleRuleMutationVariables;
      inputs.restore.push(input);
      const orgId = input.orgId ?? currentOrg.id;
      const keys = AUTO_RUN_KEYS.has(input.key)
        ? [...AUTO_RUN_KEYS]
        : [input.key];
      ruleRows[orgId] = Object.fromEntries(
        Object.entries(ruleRows[orgId] ?? {}).filter(
          ([key]) => !keys.includes(key),
        ),
      );
      return HttpResponse.json({
        data: { restoreScheduleRule: { rules: rulesOf(orgId) } },
      });
    }),
    api.query("ScheduleStaff", ({ variables }) => {
      const { input } = variables as ScheduleStaffQueryVariables;
      const items = staff.filter(
        (row) =>
          input?.joined === null ||
          input?.joined === undefined ||
          (row.staff !== null || row.joinedElsewhere) === input.joined,
      );
      return HttpResponse.json({
        data: {
          scheduleStaff: {
            items,
            totalCount: items.length,
            canEdit: canEditStaff,
          },
        },
      });
    }),
    api.mutation("AddScheduleStaff", ({ variables }) => {
      const { input } = variables as AddScheduleStaffMutationVariables;
      inputs.addStaff.push(input);
      if (!canEditStaff) {
        return graphqlError("FORBIDDEN");
      }
      staff = staff.map((row) =>
        input.userIds.includes(row.userId) && row.staff === null
          ? {
              ...row,
              staff: {
                id: nextId("s"),
                employmentType: "full-time",
                enabled: true,
                note: null,
                primaryElsewhere: false,
                orgs: [],
              },
            }
          : row,
      );
      const items = staff.filter((row) => input.userIds.includes(row.userId));
      return HttpResponse.json({ data: { addScheduleStaff: { items } } });
    }),
    api.mutation("UpdateScheduleStaff", ({ variables }) => {
      const { input } = variables as UpdateScheduleStaffMutationVariables;
      const target = staff.find((row) => row.staff?.id === input.staffId);
      if (target?.staff === null || target?.staff === undefined) {
        return graphqlError("FORBIDDEN", "NOT_FOUND");
      }
      const updated: ScheduleStaffRowFieldsFragment = {
        ...target,
        staff: {
          ...target.staff,
          employmentType: input.employmentType ?? target.staff.employmentType,
          orgs: (input.orgs ?? []).map((org, index) => ({
            orgId: org.orgId,
            orgName: nameOf(org.orgId),
            canLead: org.canLead,
            isPrimary: org.isPrimary,
            sortOrder: index + 1,
          })),
        },
      };
      staff = staff.map((row) =>
        row.userId === target.userId ? updated : row,
      );
      return HttpResponse.json({
        data: { updateScheduleStaff: { item: updated } },
      });
    }),
    api.query("ScheduleDemandTemplates", () =>
      HttpResponse.json({
        data: {
          scheduleDemandTemplates: {
            items: templates.map((template) => ({
              ...template,
              canEdit: canEditTemplates && template.canEdit,
            })),
            totalCount: templates.length,
            canCreate: canEditTemplates,
          },
        },
      }),
    ),
    api.mutation("SaveScheduleDemandTemplate", ({ variables }) => {
      const { input } =
        variables as SaveScheduleDemandTemplateMutationVariables;
      const id = input.id ?? nextId("tpl");
      const item: ScheduleDemandTemplateFieldsFragment = {
        id,
        name: input.name,
        shortName: input.shortName,
        startTime: input.startTime,
        endTime: input.endTime,
        positionKey: input.positionKey,
        tasks: input.tasks.map((task) => ({
          taskId: task.taskId ?? nextId("task"),
          role: task.role,
          taskKey: task.taskKey,
        })),
        paletteKey: input.paletteKey ?? null,
        ownerOrg: { ...SCHEDULE_BRANCH },
        canEdit: true,
      };
      templates = input.id
        ? templates.map((template) => (template.id === id ? item : template))
        : [...templates, item];
      return HttpResponse.json({
        data: { saveScheduleDemandTemplate: { item } },
      });
    }),
    api.mutation("DeleteScheduleDemandTemplate", ({ variables }) => {
      const { input } =
        variables as DeleteScheduleDemandTemplateMutationVariables;
      templates = templates.filter((template) => template.id !== input.id);
      return HttpResponse.json({
        data: { deleteScheduleDemandTemplate: { id: input.id } },
      });
    }),
    api.query("ScheduleDemandWeekTemplates", () =>
      HttpResponse.json({
        data: {
          scheduleDemandWeekTemplates: {
            items: weekTemplates.map((week) => ({
              ...week,
              canEdit: canEditTemplates && week.canEdit,
            })),
            totalCount: weekTemplates.length,
            canCreate: canEditTemplates,
          },
        },
      }),
    ),
    api.mutation("SaveScheduleDemandWeekTemplate", ({ variables }) => {
      const { input } =
        variables as SaveScheduleDemandWeekTemplateMutationVariables;
      const id = input.id ?? nextId("week");
      const existing = weekTemplates.find((week) => week.id === id);
      const item: ScheduleDemandWeekTemplateFieldsFragment = {
        id,
        name: input.name,
        days: input.days.map((day) => [...day]),
        enabled: input.enabled ?? existing?.enabled ?? true,
        ownerOrg: existing?.ownerOrg ?? { ...SCHEDULE_BRANCH },
        canEdit: true,
      };
      weekTemplates = existing
        ? weekTemplates.map((week) => (week.id === id ? item : week))
        : [...weekTemplates, item];
      return HttpResponse.json({
        data: { saveScheduleDemandWeekTemplate: { item } },
      });
    }),
    api.mutation("DeleteScheduleDemandWeekTemplate", ({ variables }) => {
      const { input } =
        variables as DeleteScheduleDemandTemplateMutationVariables;
      weekTemplates = weekTemplates.filter((week) => week.id !== input.id);
      return HttpResponse.json({
        data: { deleteScheduleDemandWeekTemplate: { id: input.id } },
      });
    }),
  ];

  return { handlers, inputs };
};
