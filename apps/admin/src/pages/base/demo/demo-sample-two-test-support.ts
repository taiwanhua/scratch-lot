import { screen } from "@testing-library/react";
import { HttpResponse } from "msw";
import type { ReactNode } from "react";

import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import { type TestModule, authWorld } from "@/test/msw/auth-handlers";
import {
  type DemoTwoWorldOptions,
  demoTwoWorld,
} from "@/test/msw/demo-sample-two-handlers";
import { demoTwoItems } from "@/test/msw/demo-two-fixtures";
import { api, server } from "@/test/msw/server";
import { toTenantTree } from "@/test/msw/tenant-org-tree";
import { renderApp } from "@/test/render";

import { SAMPLE_TWO_MODULE_KEYS } from "./demo-sample-two-config";

/**
 * 示範模組2 三頁測試的共用場景(TEST-08:一份形狀,測試檔只寫行為)。
 *
 * 與示範模組1 的場景同型但**分開一份**:兩個模組的模組樹、權限、夾具都不一樣,
 * 硬併成一份會讓「對照組少了什麼」在測試裡看不出來。
 *
 * 兩個旋鈕分開轉(與示範模組1 同):
 * - **綁了哪些模組**(`pages`)決定進得去哪一頁 —— 隱藏頁沒綁 = 殼的無權限頁
 * - **持有哪些權限**(`permissions`)決定頁內看得到什麼(這裡只有新增鈕)
 */

export const SAMPLE_TWO_ROUTES = {
  list: "/demo/sample-two",
  viewPage: "/demo/sample-two/view-page",
  createPage: "/demo/sample-two/create-page",
  editPage: "/demo/sample-two/edit-page",
} as const;

/** 對照組的四筆權限(語意同示範模組1;編輯 / 刪除實際看 `item.abilities`)。 */
export const SAMPLE_TWO_ALL_PERMISSIONS = [
  `${SAMPLE_TWO_MODULE_KEYS.list}.view`,
  `${SAMPLE_TWO_MODULE_KEYS.list}.create`,
  `${SAMPLE_TWO_MODULE_KEYS.list}.edit`,
  `${SAMPLE_TWO_MODULE_KEYS.list}.delete`,
];

/** 只看得到列表與單筆(沒有新增鈕)。 */
export const SAMPLE_TWO_VIEW_ONLY = [`${SAMPLE_TWO_MODULE_KEYS.list}.view`];

export type SampleTwoPageKey = keyof typeof SAMPLE_TWO_ROUTES;

export const SAMPLE_TWO_ALL_PAGES: SampleTwoPageKey[] = [
  "list",
  "viewPage",
  "createPage",
  "editPage",
];

const module_ = (
  id: string,
  key: string,
  name: string,
  parentId: string | null,
  sidebarType: ModuleSidebarType,
  order: number,
  route: string,
  permissions: readonly string[],
): TestModule => ({
  id,
  key,
  name,
  parentId,
  sidebarType,
  engine: ModuleEngine.Fixed,
  order,
  route,
  icon: null,
  permissions: [...permissions],
});

/**
 * `me.modules`:示範群組 → 示範模組2 + 指定的隱藏頁(**沒有次群組** —— 對照組掛在
 * 示範群組直下,這是它示範的第二層結構;模組文件「與示範模組1 的差異」)。
 *
 * 四筆權限全掛在列表頁那一層(對照組沒有頁面自有權限)。
 */
export const sampleTwoModulesWith = (
  permissions: readonly string[],
  pages: readonly SampleTwoPageKey[] = SAMPLE_TWO_ALL_PAGES,
): TestModule[] => {
  const has = (page: SampleTwoPageKey) => pages.includes(page);
  const tree: TestModule[] = [
    module_(
      "m-demo",
      "demo",
      "示範群組",
      null,
      ModuleSidebarType.Group,
      2,
      "/demo",
      [],
    ),
  ];

  if (has("list")) {
    tree.push(
      module_(
        "m-two",
        SAMPLE_TWO_MODULE_KEYS.list,
        "示範模組2",
        "m-demo",
        ModuleSidebarType.Link,
        2,
        SAMPLE_TWO_ROUTES.list,
        permissions,
      ),
    );
  }
  if (has("viewPage")) {
    tree.push(
      module_(
        "m-two-view",
        SAMPLE_TWO_MODULE_KEYS.viewPage,
        "詳情",
        "m-two",
        ModuleSidebarType.Hidden,
        1,
        SAMPLE_TWO_ROUTES.viewPage,
        [],
      ),
    );
  }
  if (has("createPage")) {
    tree.push(
      module_(
        "m-two-create",
        SAMPLE_TWO_MODULE_KEYS.createPage,
        "新增",
        "m-two",
        ModuleSidebarType.Hidden,
        2,
        SAMPLE_TWO_ROUTES.createPage,
        [],
      ),
    );
  }
  if (has("editPage")) {
    tree.push(
      module_(
        "m-two-edit",
        SAMPLE_TWO_MODULE_KEYS.editPage,
        "編輯",
        "m-two",
        ModuleSidebarType.Hidden,
        3,
        SAMPLE_TWO_ROUTES.editPage,
        [],
      ),
    );
  }
  return tree;
};

export interface RenderSampleTwoOptions {
  path?: string;
  permissions?: readonly string[];
  pages?: readonly SampleTwoPageKey[];
  world?: DemoTwoWorldOptions;
  /** 掛在路由旁的探針(測「設定物件換一份會怎樣」用,見 `renderApp`) */
  extra?: ReactNode;
}

export const renderSampleTwo = ({
  path = SAMPLE_TWO_ROUTES.list,
  permissions = SAMPLE_TWO_ALL_PERMISSIONS,
  pages = SAMPLE_TWO_ALL_PAGES,
  world = {},
  extra,
}: RenderSampleTwoOptions = {}) => {
  const fake = demoTwoWorld({ items: demoTwoItems, ...world });
  server.use(
    ...fake.handlers,
    // 「共用給」欄位(OrgTreeSelect 的 tenant 模式)查的整棵租戶樹
    api.query("TenantOrgTree", () =>
      HttpResponse.json({
        data: {
          tenantOrgTree: toTenantTree([
            {
              id: "org-tenant",
              name: "總部",
              children: [
                { id: "org-store-a", name: "中山店", parentId: "org-tenant" },
                { id: "org-store-b", name: "新竹店", parentId: "org-tenant" },
              ],
            },
          ]),
        },
      }),
    ),
    ...authWorld({
      hasRefreshCookie: true,
      modules: sampleTwoModulesWith(permissions, pages),
    }).handlers,
  );
  return { ...renderApp({ path, extra }), fake };
};

/** 清單的一列(以名稱找);清單是後到的,所以等它出現。 */
export const findSampleTwoRowOf = (name: string) =>
  screen.findByRole("row", { name: new RegExp(name) });
