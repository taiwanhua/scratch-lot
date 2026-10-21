import { describe, expect, it } from "@jest/globals";

import { demoPlan } from "../demo";
import { parseOnboardingPlan } from "./plan";
import { ROLE_GRANT_SECTIONS } from "./role-grants";
import { roleGrantOf } from "./roles";

const BASE_PLAN = {
  branches: [{ name: "中山店" }, { name: "信義店" }],
  users: [
    {
      account: "a",
      email: "a@example.test",
      name: "甲",
      branches: ["中山店"],
      roles: ["clerk"],
    },
  ],
};

describe("開通資料:排班人員與人力需求範本(班表管理)", () => {
  it("沒給 = 空清單", () => {
    const plan = parseOnboardingPlan(BASE_PLAN);
    expect(plan.scheduleStaff).toEqual([]);
    expect(plan.scheduleTemplates).toEqual([]);
    expect(plan.scheduleWeekTemplates).toEqual([]);
  });

  it.each([
    [
      "主要分店兩家",
      {
        scheduleStaff: [
          {
            account: "a",
            branches: [
              { name: "中山店", isPrimary: true },
              { name: "信義店", isPrimary: true },
            ],
          },
        ],
      },
      "恰好一家主要分店",
    ],
    [
      "不在 users 的帳號",
      { scheduleStaff: [{ account: "b", branches: [] }] },
      "不在 users 內",
    ],
    [
      "不在 branches 的分店",
      {
        scheduleStaff: [
          { account: "a", branches: [{ name: "台中店", isPrimary: true }] },
        ],
      },
      "不在 branches 內",
    ],
    [
      "簡稱三個字",
      {
        scheduleTemplates: [
          {
            name: "早班",
            shortName: "早班一",
            startTime: "08:30",
            endTime: "14:30",
            positionKey: "restock",
            tasks: [],
          },
        ],
      },
      "1–2 字",
    ],
    [
      "週範本用到不存在的範本",
      {
        scheduleWeekTemplates: [
          { name: "一般週", days: [["早班"], [], [], [], [], [], []] },
        ],
      },
      "不在 scheduleTemplates 內",
    ],
  ])("%s → 拒絕", (_name, extra, message) => {
    expect(() => parseOnboardingPlan({ ...BASE_PLAN, ...extra })).toThrow(
      message,
    );
  });

  it("示範資料:排班人員都是示範帳號、每人一家主要分店;範本與週範本形狀合法", () => {
    const plan = demoPlan("owner@example.test");
    expect(parseOnboardingPlan(plan)).toEqual(plan);
    const accounts = new Set(plan.users.map((user) => user.account));
    for (const staff of plan.scheduleStaff) {
      expect(accounts.has(staff.account)).toBe(true);
      expect(staff.branches.filter((branch) => branch.isPrimary)).toHaveLength(
        1,
      );
    }
    expect(plan.scheduleTemplates.map((template) => template.name)).toEqual([
      "早班",
      "晚班",
      "補貨",
    ]);
    expect(plan.scheduleWeekTemplates.map((week) => week.name)).toEqual([
      "一般週",
    ]);
  });
});

describe("開通時建立的角色:班表管理那一段(規格 3.3)", () => {
  it("總部管理:班表管理各模組全部(含上下班時間改用打卡時間)", () => {
    const grant = roleGrantOf("hq", ROLE_GRANT_SECTIONS);
    expect(grant.permissionKeys).toEqual(
      expect.arrayContaining([
        "schedule.my.*",
        "schedule.manage.*",
        "schedule.settings.*",
        "schedule.attendance.*",
      ]),
    );
  });

  it("店長:排班作業與排班設定,但沒有 use-punch-time、edit-default-rules", () => {
    const grant = roleGrantOf("store-manager", ROLE_GRANT_SECTIONS);
    expect(grant.permissionKeys).toEqual(
      expect.arrayContaining([
        "schedule.manage.edit",
        "schedule.manage.edit-calendar",
        "schedule.settings.edit-org-rules",
      ]),
    );
    expect(grant.permissionKeys).not.toContain("schedule.manage.*");
    expect(grant.permissionKeys).not.toContain(
      "schedule.manage.use-punch-time",
    );
    expect(grant.permissionKeys).not.toContain(
      "schedule.settings.edit-default-rules",
    );
  });

  it("店員:我的班表;看不到排班作業與排班設定", () => {
    const grant = roleGrantOf("clerk", ROLE_GRANT_SECTIONS);
    expect(grant.moduleKeys).toContain("schedule.my");
    expect(grant.moduleKeys).not.toContain("schedule.manage");
    expect(grant.moduleKeys).not.toContain("schedule.settings");
  });
});
