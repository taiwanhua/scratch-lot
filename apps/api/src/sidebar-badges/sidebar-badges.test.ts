import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { ok } from "../forms/test-support/form-fixtures";
import {
  type Person,
  WORKFLOW_MODULE,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  decideOn,
  person,
  setupWorld,
  submitLeave,
  useWorkflow,
  usersStep,
} from "../workflows/test-support/workflow-fixtures";
import {
  SidebarBadgeRegistrationError,
  SidebarBadgeRegistry,
} from "./sidebar-badge-registry";
import {
  PROBE_BADGE_COUNT,
  ProbeBadgesModule,
} from "./test-support/probe-badges.module";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const SIDEBAR_BADGES = /* GraphQL */ `
  query SidebarBadges {
    sidebarBadges {
      moduleKey
      count
    }
  }
`;

const APPLY_CENTER_COUNTS = /* GraphQL */ `
  query ApplyCenterCounts {
    applyCenterCounts {
      myTasks
    }
  }
`;

interface Badge {
  moduleKey: string;
  count: number;
}

describe("側欄計數(sidebarBadges)", () => {
  let api: AuthTestApp;
  let world: World;
  let reviewer: Person;

  async function badgesOf(who: Person): Promise<Record<string, number>> {
    const data = await ok<{ sidebarBadges: Badge[] }>(
      api,
      who.token,
      SIDEBAR_BADGES,
    );
    return Object.fromEntries(
      data.sidebarBadges.map((badge) => [badge.moduleKey, badge.count]),
    );
  }

  beforeAll(async () => {
    api = await startAuthTestApp(
      "sidebar_badges",
      { WORKFLOW_MAIL_ENABLED: "false" },
      [ProbeBadgesModule],
    );
    world = await setupWorld(api, api.connection, 1);
    const [first] = world.staff;
    if (!first) {
      throw new Error("staff[0] 不存在");
    }
    reviewer = first;
    await useWorkflow(world, "badge_flow", {
      steps: [usersStep("one", [reviewer])],
    });
  });

  afterAll(async () => {
    await api.close();
  });

  it("申請中心 = 待我處理的任務數(與 applyCenterCounts.myTasks 相同),審核後跟著減少", async () => {
    const first = await submitLeave(world);
    await submitLeave(world);

    const before = await badgesOf(reviewer);
    expect(before["apply-center"]).toBe(2);
    const counts = await ok<{ applyCenterCounts: { myTasks: number } }>(
      api,
      reviewer.token,
      APPLY_CENTER_COUNTS,
    );
    expect(before["apply-center"]).toBe(counts.applyCenterCounts.myTasks);

    await decideOn(world, reviewer, first.id, "APPROVE");
    await expect(badgesOf(reviewer)).resolves.toMatchObject({
      "apply-center": 1,
    });
    // 申請人沒有待處理的任務:數字是 0(照樣回傳,前端只在大於 0 時顯示)
    await expect(badgesOf(world.applicant)).resolves.toMatchObject({
      "apply-center": 0,
    });
  });

  it("沒權限的模組不回傳數字:沒有 apply-center.view 的人拿不到申請中心那一筆", async () => {
    const outsider = await person(
      api,
      world.connection,
      world.tenant,
      world.tenant,
      {
        moduleKeys: [WORKFLOW_MODULE],
        permissionKeys: [`${WORKFLOW_MODULE}.*`],
      },
    );

    const badges = await badgesOf(outsider);

    expect(badges).toEqual({ [WORKFLOW_MODULE]: PROBE_BADGE_COUNT });
  });

  it("持有 view 的模組都回傳;某一筆計算失敗只略過那一筆", async () => {
    // 租戶管理員看得到 system.workflows(探針一律拋錯)、申請中心與 demo.form
    const badges = await badgesOf(world.admin);

    expect(badges).toEqual({
      "apply-center": 0,
      [WORKFLOW_MODULE]: PROBE_BADGE_COUNT,
    });
  });
});

const count = () => Promise.resolve(0);

describe("SidebarBadgeRegistry", () => {
  it("模組 key 重複登記 → 拋錯(app 起不來)", () => {
    const registry = new SidebarBadgeRegistry();
    registry.registerBadge({ moduleKey: "orders", count });
    expect(() => {
      registry.registerBadge({ moduleKey: "orders", count });
    }).toThrow(SidebarBadgeRegistrationError);
  });

  it("模組 key 空白或前後有空白 → 拋錯", () => {
    const registry = new SidebarBadgeRegistry();
    for (const moduleKey of ["", "  ", " orders"]) {
      expect(() => {
        registry.registerBadge({ moduleKey, count });
      }).toThrow(SidebarBadgeRegistrationError);
    }
    expect(registry.badges()).toEqual([]);
  });
});
