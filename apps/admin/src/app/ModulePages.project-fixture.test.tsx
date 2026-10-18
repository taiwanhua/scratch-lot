import { beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { formModulePages } from "@/components/base/form-engine/FormModulePages/form-module-pages";
import { DEFAULT_TAB_LABEL_TEMPLATE } from "@/lib/base/form-engine/tab-label";
import { setHelpFiles } from "@/test/help-registry";
import {
  type TestModule,
  authWorld,
  overviewModule,
} from "@/test/msw/auth-handlers";
import { superAdminModules } from "@/test/msw/module-fixtures";
import { server } from "@/test/msw/server";
import { ProjectDesignerPage } from "@/test/project-fixture/project-designer-page";
import {
  PROJECT_LEAVE_MODULE_KEY,
  PROJECT_LEAVE_TAB_LABEL_TEMPLATE,
  PROJECT_REPORT_MODULE_KEY,
  PROJECT_REPORT_ROUTE,
  projectReportModule,
} from "@/test/project-fixture/project-fixture-modules";
import { ProjectReportPage } from "@/test/project-fixture/project-report-page";
import { ProjectRolePage } from "@/test/project-fixture/project-role-page";
import { renderApp } from "@/test/render";

import { baseModulePages } from "./base/module-pages";
import {
  formModuleOptions,
  modulePageMinWidths,
  modulePages,
} from "./module-pages";

/**
 * 測試專案(jest 的 `project-fixture`):只把 `app/project/` 的兩份來源換成 `test/project-fixture/` 的夾具
 * (一個新增頁、一個專案表單模組、替換兩個治理頁),其餘全是正式程式 —— 固定組裝入口 `app/module-pages.tsx`、
 * `RootProviders`、路由、`RequireAuth` / `ModuleRoute`、殼與「?」說明。核心接縫一個都沒有 mock。
 */
const ROLE_MANAGER_ROUTE = "/system/role-manager";

const useModules = (modules: TestModule[]) => {
  server.use(...authWorld({ hasRefreshCookie: true, modules }).handlers);
};

const fullModules = [...superAdminModules, projectReportModule];

const withoutKeys = (...keys: string[]): TestModule[] =>
  fullModules.filter((module) => !keys.includes(module.key));

const tabLabels = () =>
  within(screen.getByRole("tablist", { name: "路由頁籤" }))
    .queryAllByRole("tab")
    .map((tab) => tab.textContent);

const openHelp = async (user: ReturnType<typeof renderApp>["user"]) => {
  const banner = await screen.findByRole("banner");
  await user.click(
    await within(banner).findByRole("button", { name: "模組說明" }),
  );
  return screen.findByRole("dialog");
};

beforeEach(() => {
  sessionStorage.clear();
});

describe("測試專案的登記表(真組裝入口)", () => {
  it("新增的頁與表單四頁進表;底座其餘頁仍是原版", () => {
    expect(modulePages[PROJECT_REPORT_MODULE_KEY]).toBe(ProjectReportPage);
    for (const [key, Page] of Object.entries(
      formModulePages(PROJECT_LEAVE_MODULE_KEY),
    )) {
      expect(modulePages[key]).toBe(Page);
    }
    const replaced = new Set(["system.role-manager", "system.forms"]);
    for (const { key, Page } of baseModulePages.pages) {
      if (!replaced.has(key)) {
        expect(modulePages[key]).toBe(Page);
      }
    }
  });

  it("替換換掉同一個 key;明寫寬度的照寫(表單管理 xl),沒寫的沿用底座(角色管理、流程管理用殼層預設)", () => {
    expect(modulePages["system.role-manager"]).toBe(ProjectRolePage);
    expect(modulePages["system.forms"]).toBe(ProjectDesignerPage);
    // 底座頁目前都沒宣告寬度,「省略 = 繼承底座宣告值」的組合規則由 `module-page-registry.test.ts` 守
    expect(modulePageMinWidths).toEqual({ "system.forms": "xl" });
  });

  it("專案表單模組的設定與底座的一起合成,互不影響", () => {
    expect(
      formModuleOptions.get(PROJECT_LEAVE_MODULE_KEY)?.tabLabelTemplate,
    ).toBe(PROJECT_LEAVE_TAB_LABEL_TEMPLATE);
    expect(formModuleOptions.get("demo-form")?.tabLabelTemplate).toBe(
      DEFAULT_TAB_LABEL_TEMPLATE,
    );
  });
});

describe("專案新增的頁:有授權才進得去", () => {
  it("me.modules 有這個模組:側欄、頁籤、標題與內容都是專案頁", async () => {
    useModules(fullModules);
    renderApp({ path: PROJECT_REPORT_ROUTE });

    const page = await screen.findByRole("region", { name: "專案報表頁" });
    expect(within(page).getByText("專案報表(專案新增)")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("專案報表");
    expect(
      within(screen.getByRole("navigation", { name: "主選單" })).getByRole(
        "link",
        { name: "專案報表" },
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(tabLabels()).toEqual(["專案報表"]);
    });
  });

  it("只有這一個模組:`/` 預設導向到它", async () => {
    useModules([projectReportModule]);
    renderApp({ path: "/" });

    expect(
      await screen.findByRole("region", { name: "專案報表頁" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      PROJECT_REPORT_ROUTE,
    );
  });

  it("登記了但沒授權:無權限頁,不 render 專案頁、不生成頁籤、側欄沒有它", async () => {
    useModules(withoutKeys(PROJECT_REPORT_MODULE_KEY));
    renderApp({ path: PROJECT_REPORT_ROUTE });

    expect(
      await screen.findByRole("heading", { name: "沒有權限進入此頁面" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "專案報表頁" }),
    ).not.toBeInTheDocument();
    expect(tabLabels()).toEqual([]);
    expect(
      within(screen.getByRole("navigation", { name: "主選單" })).queryByRole(
        "link",
        { name: "專案報表" },
      ),
    ).not.toBeInTheDocument();
  });

  it("開過之後被撤銷授權:重新整理後不 render,留下的頁籤也被剔除", async () => {
    useModules([overviewModule, projectReportModule]);
    const first = renderApp({ path: "/overview" });
    await screen.findByRole("tablist", { name: "路由頁籤" });
    await first.user.click(
      within(screen.getByRole("navigation", { name: "主選單" })).getByRole(
        "link",
        { name: "專案報表" },
      ),
    );
    await waitFor(() => {
      expect(tabLabels()).toEqual(["總覽", "專案報表"]);
    });
    first.unmount();
    server.resetHandlers();

    // 角色改了:失去專案報表 → 同一分頁重新載入
    useModules([overviewModule]);
    renderApp({ path: PROJECT_REPORT_ROUTE });

    expect(
      await screen.findByRole("heading", { name: "沒有權限進入此頁面" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "專案報表頁" }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(tabLabels()).toEqual(["總覽"]);
    });
  });
});

describe("專案替換治理頁:同網址、同授權開出客製版", () => {
  it("角色管理的網址顯示專案版;模組名與頁籤仍取 me.modules", async () => {
    useModules(fullModules);
    renderApp({ path: ROLE_MANAGER_ROUTE });

    const page = await screen.findByRole("region", { name: "專案角色頁" });
    expect(within(page).getByText("角色管理(專案客製)")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      ROLE_MANAGER_ROUTE,
    );
    expect(screen.getByRole("banner")).toHaveTextContent("角色管理");
    await waitFor(() => {
      expect(tabLabels()).toEqual(["角色管理"]);
    });
  });

  it("撤銷該模組的授權:客製版一樣進不去(替換不另開繞過授權的路)", async () => {
    useModules(withoutKeys("system.role-manager"));
    renderApp({ path: ROLE_MANAGER_ROUTE });

    expect(
      await screen.findByRole("heading", { name: "沒有權限進入此頁面" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "專案角色頁" }),
    ).not.toBeInTheDocument();
    expect(tabLabels()).toEqual([]);
  });
});

/** 測試專案的說明:底座兩份 + 專案新增一份(專案報表)+ 替換一份(角色管理)。 */
const helpFiles = () => {
  setHelpFiles(
    {
      "/src/md/module-help/base/system.role-manager.help.md":
        "# 角色管理\n\n## 這個模組做什麼\n\n底座的角色說明。",
      "/src/md/module-help/base/system.org-manager.help.md":
        "# 組織管理\n\n## 這個模組做什麼\n\n底座的組織說明。",
    },
    {
      additions: {
        "/src/md/module-help/project/additions/project.report.help.md":
          "# 專案報表\n\n## 這個模組做什麼\n\n專案報表的說明。",
      },
      replacements: {
        "/src/md/module-help/project/replacements/system.role-manager.help.md":
          "# 角色管理\n\n## 這個模組做什麼\n\n專案客製的角色說明。",
      },
    },
  );
};

describe("「?」說明:專案新增與替換都看得到", () => {
  beforeAll(async () => {
    // 先載完 Markdown 的 lazy chunk(TEST-08:lazy 元件的頁面測試要先 preload)
    await import("@repo/ui/markdown");
  });

  it("專案新增的頁:顯示專案新增的說明", async () => {
    helpFiles();
    useModules(fullModules);
    const { user } = renderApp({ path: PROJECT_REPORT_ROUTE });

    const dialog = await openHelp(user);

    expect(dialog).toHaveTextContent("模組說明 — 專案報表");
    expect(
      await within(dialog).findByText("專案報表的說明。"),
    ).toBeInTheDocument();
  });

  it("被替換的治理頁:顯示替換後的說明,不是底座原文", async () => {
    helpFiles();
    useModules(fullModules);
    const { user } = renderApp({ path: ROLE_MANAGER_ROUTE });

    const dialog = await openHelp(user);

    expect(
      await within(dialog).findByText("專案客製的角色說明。"),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("底座的角色說明。");
  });

  it("替換了頁面但沒提供說明:仍取底座原說明", async () => {
    setHelpFiles({
      "/src/md/module-help/base/system.role-manager.help.md":
        "# 角色管理\n\n## 這個模組做什麼\n\n底座的角色說明。",
    });
    useModules(fullModules);
    const { user } = renderApp({ path: ROLE_MANAGER_ROUTE });
    await screen.findByRole("region", { name: "專案角色頁" });

    const dialog = await openHelp(user);

    expect(
      await within(dialog).findByText("底座的角色說明。"),
    ).toBeInTheDocument();
  });
});
