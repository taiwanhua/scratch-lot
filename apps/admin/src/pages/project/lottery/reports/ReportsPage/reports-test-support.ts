import { HttpResponse } from "msw";

import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import {
  type TestModule,
  authWorld,
  overviewModule,
} from "@/test/msw/auth-handlers";
import type { TestOrgNode } from "@/test/msw/org-manager-handlers";
import { api, server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/**
 * 輸出報表頁的渲染場景:`me.modules` 有輸出報表(權限由測試給)、組織樹兩家分店、
 * 測試報表的查詢 `FixtureReport`(記下 input;`fail` 給了就回那個錯誤)。
 * 報表登記清單由測試檔以 `jest.unstable_mockModule` 換成 `reports-fixtures.ts`。
 */

const reportsModule = (permissions: readonly string[]): TestModule => ({
  id: "m-reports",
  key: "reports",
  name: "輸出報表",
  parentId: null,
  sidebarType: ModuleSidebarType.Link,
  engine: ModuleEngine.Fixed,
  order: 14,
  route: "/reports",
  icon: "chart",
  permissions: [...permissions],
});

const branch = (id: string, name: string): TestOrgNode => ({
  id,
  name,
  parentId: "org-hq",
  enabled: true,
  outOfScope: false,
  ownerUserId: null,
  children: [],
});

const ORG_TREE: TestOrgNode[] = [
  {
    ...branch("org-hq", "好運彩券行"),
    parentId: null,
    children: [
      branch("org-zhongshan", "中山店"),
      branch("org-hsinchu", "新竹店"),
    ],
  },
];

/** 假伺服器記下的報表查詢 input;`fail` 給了就回那個錯誤。 */
export interface FixtureReportServer {
  inputs: Record<string, unknown>[];
}

export const renderReportsPage = ({
  permissions,
  search = "",
  fail,
}: {
  permissions: readonly string[];
  search?: string;
  fail?: { code: string; reason?: string };
}) => {
  const fake: FixtureReportServer = { inputs: [] };
  server.use(
    ...authWorld({
      hasRefreshCookie: true,
      modules: [overviewModule, reportsModule(permissions)],
    }).handlers,
    api.query("OrgTree", () =>
      HttpResponse.json({ data: { orgTree: ORG_TREE } }),
    ),
    api.query("FixtureReport", ({ variables }) => {
      fake.inputs.push(variables.input as Record<string, unknown>);
      if (fail !== undefined) {
        return HttpResponse.json({
          errors: [{ message: "fail", extensions: fail }],
        });
      }
      const orgIds = (variables.input as { orgIds: string[] }).orgIds;
      return HttpResponse.json({
        data: {
          fixtureReport: orgIds.map((orgId, index) => ({
            orgId,
            sales: (index + 1) * 100,
          })),
        },
      });
    }),
  );
  return { ...renderApp({ path: `/reports${search}` }), fake };
};
