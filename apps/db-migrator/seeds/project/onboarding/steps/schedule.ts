import {
  type OnboardingContext,
  type OnboardingStep,
  requireBranchId,
  requireTenant,
} from "../context";

const SCHEDULE_STAFF = /* GraphQL */ `
  query OnboardingScheduleStaff {
    scheduleStaff {
      items {
        userId
        account
        staff {
          id
          orgs {
            orgId
          }
        }
      }
    }
  }
`;

const ADD_SCHEDULE_STAFF = /* GraphQL */ `
  mutation OnboardingAddScheduleStaff($input: AddScheduleStaffInput!) {
    addScheduleStaff(input: $input) {
      items {
        userId
      }
    }
  }
`;

const UPDATE_SCHEDULE_STAFF = /* GraphQL */ `
  mutation OnboardingUpdateScheduleStaff($input: UpdateScheduleStaffInput!) {
    updateScheduleStaff(input: $input) {
      item {
        userId
      }
    }
  }
`;

const TEMPLATES = /* GraphQL */ `
  query OnboardingScheduleTemplates {
    scheduleDemandTemplates {
      items {
        id
        name
        ownerOrg {
          id
        }
      }
    }
  }
`;

const SAVE_TEMPLATE = /* GraphQL */ `
  mutation OnboardingSaveScheduleTemplate(
    $input: SaveScheduleDemandTemplateInput!
  ) {
    saveScheduleDemandTemplate(input: $input) {
      item {
        id
        name
      }
    }
  }
`;

const WEEK_TEMPLATES = /* GraphQL */ `
  query OnboardingScheduleWeekTemplates {
    scheduleDemandWeekTemplates {
      items {
        id
        name
        ownerOrg {
          id
        }
      }
    }
  }
`;

const SAVE_WEEK_TEMPLATE = /* GraphQL */ `
  mutation OnboardingSaveScheduleWeekTemplate(
    $input: SaveScheduleDemandWeekTemplateInput!
  ) {
    saveScheduleDemandWeekTemplate(input: $input) {
      item {
        id
      }
    }
  }
`;

interface StaffRow {
  userId: string;
  account: string;
  staff: { id: string; orgs: { orgId: string }[] } | null;
}

interface OwnedRow {
  id: string;
  name: string;
  ownerOrg: { id: string };
}

async function staffRows(context: OnboardingContext): Promise<StaffRow[]> {
  const { scheduleStaff } = await context.client.request<{
    scheduleStaff: { items: StaffRow[] };
  }>(SCHEDULE_STAFF);
  return scheduleStaff.items;
}

/**
 * 開通清單第 11 點的「加入排班人員」:開通資料列的人 [加入排班],
 * 還沒設定任何可以排的分店時寫入分店(可擔任負責人、主要分店)與僱用類型;已加入、已設分店的不動。
 */
export const scheduleStaffStep: OnboardingStep = {
  key: "schedule-staff",
  title: "排班人員",
  run: async (context) => {
    const { plan, state } = context;
    if (plan.scheduleStaff.length === 0) {
      return ["沒有要加入排班的人"];
    }
    const lines: string[] = [];
    // 輸出只寫姓名:帳號是信箱,不印出來
    const nameOf = (account: string): string =>
      plan.users.find((user) => user.account === account)?.name ?? account;
    const before = await staffRows(context);
    const byAccount = new Map(before.map((row) => [row.account, row]));
    const toAdd = plan.scheduleStaff.flatMap((staff) => {
      const row = byAccount.get(staff.account);
      if (row === undefined) {
        throw new Error(
          `排班人員「${nameOf(staff.account)}」不是這個租戶看得到的使用者(「使用者」步驟要排在前面)`,
        );
      }
      return row.staff === null ? [row.userId] : [];
    });
    if (toAdd.length > 0) {
      await context.client.request(ADD_SCHEDULE_STAFF, {
        input: { userIds: toAdd },
      });
    }
    const after = await staffRows(context);
    const rows = new Map(after.map((row) => [row.account, row]));
    for (const staff of plan.scheduleStaff) {
      const row = rows.get(staff.account);
      const profile = row?.staff ?? null;
      if (row === undefined || profile === null) {
        throw new Error(`排班人員「${nameOf(staff.account)}」沒有加入成功`);
      }
      const added = toAdd.includes(row.userId);
      if (profile.orgs.length > 0 || staff.branches.length === 0) {
        lines.push(
          added
            ? `加入「${nameOf(staff.account)}」`
            : `「${nameOf(staff.account)}」已存在`,
        );
        continue;
      }
      await context.client.request(UPDATE_SCHEDULE_STAFF, {
        input: {
          staffId: profile.id,
          employmentType: staff.employmentType,
          orgs: staff.branches.map((branch) => ({
            orgId: requireBranchId(state, branch.name),
            canLead: branch.canLead,
            isPrimary: branch.isPrimary,
          })),
        },
      });
      lines.push(
        `${added ? "加入" : "設定"}「${nameOf(staff.account)}」:${staff.branches
          .map((branch) => branch.name)
          .join("、")}`,
      );
    }
    return lines;
  },
};

/**
 * 人力需求範本與週範本(最上層組織建立,各分店都能用;開通清單第 11 點的「建立人力需求範本」)。
 * 以名稱找回這一層建立的;已存在的不動。
 */
export const scheduleTemplatesStep: OnboardingStep = {
  key: "schedule-templates",
  title: "人力需求範本",
  run: async ({ client, plan, state }) => {
    if (
      plan.scheduleTemplates.length === 0 &&
      plan.scheduleWeekTemplates.length === 0
    ) {
      return ["沒有預先建立的人力需求範本(之後在排班設定建立)"];
    }
    const tenant = requireTenant(state);
    const lines: string[] = [];
    const { scheduleDemandTemplates } = await client.request<{
      scheduleDemandTemplates: { items: OwnedRow[] };
    }>(TEMPLATES);
    const templateIds = new Map(
      scheduleDemandTemplates.items
        .filter((item) => item.ownerOrg.id === tenant.id)
        .map((item) => [item.name, item.id]),
    );
    for (const template of plan.scheduleTemplates) {
      if (templateIds.has(template.name)) {
        lines.push(`「${template.name}」已存在`);
        continue;
      }
      const { saveScheduleDemandTemplate } = await client.request<{
        saveScheduleDemandTemplate: { item: { id: string } };
      }>(SAVE_TEMPLATE, {
        input: {
          name: template.name,
          shortName: template.shortName,
          startTime: template.startTime,
          endTime: template.endTime,
          positionKey: template.positionKey,
          tasks: template.tasks,
          paletteKey: template.color,
        },
      });
      templateIds.set(template.name, saveScheduleDemandTemplate.item.id);
      lines.push(`建立「${template.name}」`);
    }
    const { scheduleDemandWeekTemplates } = await client.request<{
      scheduleDemandWeekTemplates: { items: OwnedRow[] };
    }>(WEEK_TEMPLATES);
    const weekNames = new Set(
      scheduleDemandWeekTemplates.items
        .filter((item) => item.ownerOrg.id === tenant.id)
        .map((item) => item.name),
    );
    for (const week of plan.scheduleWeekTemplates) {
      if (weekNames.has(week.name)) {
        lines.push(`週範本「${week.name}」已存在`);
        continue;
      }
      await client.request(SAVE_WEEK_TEMPLATE, {
        input: {
          name: week.name,
          days: week.days.map((names) =>
            names.map((name) => {
              const id = templateIds.get(name);
              if (id === undefined) {
                throw new Error(`週範本用到的範本「${name}」不存在`);
              }
              return id;
            }),
          ),
        },
      });
      lines.push(`建立週範本「${week.name}」`);
    }
    return lines;
  },
};
