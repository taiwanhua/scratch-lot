import { HttpResponse } from "msw";
import { createTranslator } from "use-intl";

import { defaultLocale, messages } from "@repo/i18n";

import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import type { TestOrgNode } from "@/test/msw/org-manager-handlers";
import { reportsModule } from "@/test/msw/reports-fixtures";
import { api, server } from "@/test/msw/server";
import { toTenantTree } from "@/test/msw/tenant-org-tree";
import { renderApp } from "@/test/render";

/**
 * 輸出報表頁的渲染場景:`me.modules` 有輸出報表(權限由測試給)、組織樹(預設一個總部底下兩個組織;
 * 可見範圍與管理範圍同一棵,分別計次)、測試報表的查詢 `FixtureReport`(記下 input;`fail` 給了就回那個錯誤)。
 * 底座的報表登記由測試檔以 `jest.unstable_mockModule` 換成 `reports-fixtures.ts`;專案自己的報表測試傳自己的組織樹,
 * 查詢的假 api 自己另外接。
 */

/**
 * 畫面上的輸出報表文案(合成後的字典,含專案的替換;`admin` namespace):
 * 斷言不寫死字面值,換了用詞的專案照樣跑得過。
 */
export const adminText = createTranslator({
  locale: defaultLocale,
  messages: messages[defaultLocale],
  namespace: "admin",
});

const orgNode = (id: string, name: string): TestOrgNode => ({
  id,
  name,
  parentId: "org-hq",
  enabled: true,
  outOfScope: false,
  ownerUserId: null,
  children: [],
});

/** 一棵「總部 + 底下的組織」的組織樹(`children` 是 `[id, 名稱]`)。 */
export const orgTreeOf = (
  root: string,
  children: readonly (readonly [string, string])[],
): TestOrgNode[] => [
  {
    ...orgNode("org-hq", root),
    parentId: null,
    children: children.map(([id, name]) => orgNode(id, name)),
  },
];

const DEFAULT_ORG_TREE = orgTreeOf("示範總部", [
  ["org-north", "北區"],
  ["org-south", "南區"],
]);

/** 假伺服器記下的報表查詢 input;`fail` 有值時回那個錯誤(測試中途可改,模擬「預覽成功、匯出失敗」)。 */
export interface FixtureReportServer {
  inputs: Record<string, unknown>[];
  fail: { code: string; reason?: string } | undefined;
  /** 兩種組織樹各被查了幾次(組織選擇器應查可見範圍(整棵租戶樹 `TenantOrgTree`),不查管理範圍 `OrgTree`) */
  orgTreeCalls: { managed: number; visible: number };
}

export const renderReportsPage = ({
  permissions,
  search = "",
  fail,
  orgTree = DEFAULT_ORG_TREE,
}: {
  permissions: readonly string[];
  search?: string;
  fail?: { code: string; reason?: string };
  orgTree?: TestOrgNode[];
}) => {
  const fake: FixtureReportServer = {
    inputs: [],
    fail,
    orgTreeCalls: { managed: 0, visible: 0 },
  };
  server.use(
    ...authWorld({
      hasRefreshCookie: true,
      modules: [overviewModule, reportsModule(permissions)],
    }).handlers,
    api.query("OrgTree", () => {
      fake.orgTreeCalls.managed += 1;
      return HttpResponse.json({ data: { orgTree } });
    }),
    api.query("TenantOrgTree", () => {
      fake.orgTreeCalls.visible += 1;
      return HttpResponse.json({
        data: { tenantOrgTree: toTenantTree(orgTree) },
      });
    }),
    api.query("FixtureReport", ({ variables }) => {
      fake.inputs.push(variables.input as Record<string, unknown>);
      if (fake.fail !== undefined) {
        return HttpResponse.json({
          errors: [{ message: "fail", extensions: fake.fail }],
        });
      }
      const orgIds = (variables.input as { orgIds: string[] }).orgIds;
      return HttpResponse.json({
        data: {
          fixtureReport: orgIds.map((orgId, index) => ({
            orgId,
            amount: (index + 1) * 100,
          })),
        },
      });
    }),
  );
  return { ...renderApp({ path: `/reports${search}` }), fake };
};
