import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import { systemModules } from "@/test/msw/module-fixtures";
import { PRINTERS_ROUTE, printersModule } from "@/test/msw/printing-fixtures";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";
import { setupFakeViewport } from "@/test/viewport";

import { PRINTERS_PERMISSIONS } from "./printers-permissions";
import { renderPrinters } from "./printers-test-support";

setupFakeViewport();

beforeAll(async () => {
  // 懶載入的頁面先載進模組快取(TEST-08)
  await import("./PrintersPage");
});

const { view, create, edit } = PRINTERS_PERMISSIONS;

describe("印表機管理:印表機分頁", () => {
  it("列出名稱、所屬組織、IP:Port、代理程式、預設與狀態;篩選帶進查詢", async () => {
    const { user, printing } = renderPrinters();

    const table = await screen.findByRole("table", { name: "印表機" });
    const counterName = await within(table).findByText("櫃台收據機");
    const counter = counterName.closest("tr");
    expect(counter).not.toBeNull();
    const row = within(counter as HTMLElement);
    expect(row.getByText("A-1 內容組")).toBeInTheDocument();
    expect(row.getByText("192.0.2.50:9100")).toBeInTheDocument();
    expect(await row.findByText("櫃台電腦")).toBeInTheDocument();
    expect(row.getByText("預設")).toBeInTheDocument();
    expect(row.getByText("正常")).toBeInTheDocument();
    // 倉庫的代理程式離線 → 狀態顯示離線(印表機狀態不可信)
    const store = within(
      within(table).getByText("倉庫收據機").closest("tr") as HTMLElement,
    );
    expect(store.getByText("離線")).toBeInTheDocument();
    expect(screen.getByText("共 2 筆")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "狀態" }));
    await user.click(await screen.findByRole("option", { name: "已停用" }));
    await waitFor(() => {
      expect(printing.inputs.printers.at(-1)?.enabled).toBe(false);
    });

    await user.click(screen.getByRole("combobox", { name: "所屬組織" }));
    await user.click(
      await screen.findByRole("option", { name: "租戶 A / A-2 台北分店" }),
    );
    await waitFor(() => {
      expect(printing.inputs.printers.at(-1)?.orgId).toBe("org-store");
    });
  });
});

describe("印表機管理的權限(畫面列,每列一個測試)", () => {
  it("只有 view:三個分頁唯讀 —— 沒有新增按鈕、下載區、列上動作", async () => {
    const { user } = renderPrinters({ permissions: [view] });

    const table = await screen.findByRole("table", { name: "印表機" });
    await within(table).findByText("櫃台收據機");
    expect(
      screen.queryByRole("button", { name: "+ 新增印表機" }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole("button", { name: /測試列印/ }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole("button", { name: /編輯/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "代理程式" }));
    const agents = await screen.findByRole("table", { name: "代理程式" });
    await within(agents).findByText("櫃台電腦");
    expect(
      screen.queryByRole("button", { name: "+ 新增代理程式" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/最新版本/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^下載/ }),
    ).not.toBeInTheDocument();
    expect(
      within(agents).queryByRole("button", { name: /重新配對|停用/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "列印紀錄" }));
    expect(
      await screen.findByRole("table", { name: "列印紀錄" }),
    ).toBeInTheDocument();
  });

  it("view + create:另有 [新增印表機]、[新增代理程式] 與下載區;沒有列上動作", async () => {
    const { user, printing } = renderPrinters({ permissions: [view, create] });

    const table = await screen.findByRole("table", { name: "印表機" });
    await within(table).findByText("櫃台收據機");
    expect(
      screen.getByRole("button", { name: "+ 新增印表機" }),
    ).toBeInTheDocument();
    expect(
      within(table).queryByRole("button", { name: /測試列印|編輯/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "代理程式" }));
    expect(
      await screen.findByText("列印代理程式 · 最新版本 1.2.0"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^下載/ })).toHaveLength(4);
    expect(
      screen.getByRole("button", { name: "+ 新增代理程式" }),
    ).toBeInTheDocument();
    const agents = screen.getByRole("table", { name: "代理程式" });
    await within(agents).findByText("櫃台電腦");
    expect(
      within(agents).queryByRole("button", { name: /重新配對|停用/ }),
    ).not.toBeInTheDocument();
    expect(printing.inputs.release).toBeGreaterThan(0);
  });

  it("沒有 create:不顯示下載區,也不查安裝檔(api 會回 FORBIDDEN)", async () => {
    const { user, printing } = renderPrinters({ permissions: [view, edit] });

    await user.click(await screen.findByRole("tab", { name: "代理程式" }));
    const agents = await screen.findByRole("table", { name: "代理程式" });
    // view + edit:列上有 [重新配對] [停用]
    expect(
      await within(agents).findByRole("button", {
        name: "重新配對「櫃台電腦」",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/列印代理程式/)).not.toBeInTheDocument();
    expect(printing.inputs.release).toBe(0);
    expect(
      screen.queryByRole("button", { name: "+ 新增代理程式" }),
    ).not.toBeInTheDocument();
  });

  it("view + edit:印表機列上有 [測試列印] [編輯];沒有新增按鈕", async () => {
    renderPrinters({ permissions: [view, edit] });

    const table = await screen.findByRole("table", { name: "印表機" });
    expect(
      await within(table).findByRole("button", {
        name: "測試列印「櫃台收據機」",
      }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("button", { name: "編輯「櫃台收據機」" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+ 新增印表機" }),
    ).not.toBeInTheDocument();
  });
});

describe("印表機管理:側欄", () => {
  it("系統管理群組的順序:既有 8 項 → 通知設定 → 印表機管理", async () => {
    // 通知設定頁不在本測試範圍,側欄節點照 seed(order 9)放一個
    const notificationSettings = {
      ...printersModule(),
      id: "m-notification-settings",
      key: "system.notification-settings",
      name: "通知設定",
      order: 9,
      route: "/system/notification-settings",
      icon: "notifications",
      sidebarType: ModuleSidebarType.Link,
      engine: ModuleEngine.Fixed,
      permissions: ["system.notification-settings.*"],
    };
    const governance = [
      ["m-forms", "system.forms", "表單管理", 7],
      ["m-workflows", "system.workflows", "流程管理", 8],
    ].map(([id, key, name, order]) => ({
      ...notificationSettings,
      id: String(id),
      key: String(key),
      name: String(name),
      order: Number(order),
      route: `/${String(key).replace(".", "/")}`,
      icon: null,
      permissions: [`${String(key)}.*`],
    }));
    server.use(
      ...authWorld({
        hasRefreshCookie: true,
        // 刻意不照 order 排:驗前端依 order 排序
        modules: [
          overviewModule,
          printersModule(),
          notificationSettings,
          ...governance,
          ...systemModules,
        ],
      }).handlers,
    );
    renderApp({ path: PRINTERS_ROUTE });

    const nav = await screen.findByRole("navigation", { name: "主選單" });
    await within(nav).findByRole("link", { name: "印表機管理" });
    const names = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent);
    const systemNames = [
      "組織管理",
      "使用者管理",
      "角色管理",
      "模組與權限",
      "欄位管理",
      "資料範圍",
      "表單管理",
      "流程管理",
      "通知設定",
      "印表機管理",
    ];
    const positions = systemNames.map((name) =>
      names.findIndex((text) => text.includes(name)),
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions.toSorted((a, b) => a - b)).toEqual(positions);
  });
});

describe("印表機管理:時間以租戶時區顯示", () => {
  it("列印紀錄的時間換成租戶時區(Asia/Taipei),不是 UTC", async () => {
    const { user } = renderPrinters();

    await user.click(await screen.findByRole("tab", { name: "列印紀錄" }));
    const jobs = await screen.findByRole("table", { name: "列印紀錄" });
    // 13:58Z = 台北 21:58
    expect(
      await within(jobs).findByText("2026-10-16 21:58"),
    ).toBeInTheDocument();
    expect(
      within(jobs).queryByText("2026-10-16 13:58"),
    ).not.toBeInTheDocument();
  });
});
