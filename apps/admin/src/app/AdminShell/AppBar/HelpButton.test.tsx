import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import { setHelpFiles } from "@/test/help-registry";
import { type TestModule, authWorld } from "@/test/msw/auth-handlers";
import {
  sampleTwoModules,
  superAdminModules,
} from "@/test/msw/module-fixtures";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/**
 * AppBar 的「?」模組說明。內容來自 build 時打包的 `src/md/module-help/*.help.md`;
 * jest 沒有 `import.meta.glob`,測試看到的是 `src/test/help-registry.ts` 的假 registry
 * (jest.config.mjs 的 moduleNameMapper),所以斷言針對「有 / 沒有說明」的行為,不是 md 正本的字句。
 *
 * 內文改成 `React.lazy(() => import("@repo/ui/markdown"))` 後,彈窗開啟到 Markdown
 * 渲染之間多一個 `Suspense` 的 tick,所以第一筆內文斷言一律用 `findBy*` 等(TEST-08)。
 *
 * 先 preload 那支 chunk:第一次 `import()` 要在 jest ESM 裡現載 react-markdown / micromark
 * 整條依賴鏈,全套並行時 CPU 被搶,會把 `findBy*` 的 5 秒與單一測試的 15 秒吃光。放進 `beforeAll`
 * 先載完,元件裡的 `import()` 就直接拿到模組快取,測試只剩一個 `Suspense` tick 要等。
 */
/** 沒有登記頁面的表單模組(殼顯示佔位頁,測試不必餵表單的 GraphQL handler)。 */
const formModule = (key: string, name: string): TestModule => ({
  id: `m-${key}`,
  key,
  name,
  parentId: null,
  sidebarType: ModuleSidebarType.Link,
  engine: ModuleEngine.Form,
  order: 9,
  route: `/${key}`,
  icon: null,
  permissions: [`${key}.view`],
});

describe("模組說明「?」", () => {
  beforeAll(async () => {
    await import("@repo/ui/markdown");
  });

  it("模組路由有對應的 help.md:點開彈窗,標題帶模組名,內文是渲染後的 Markdown", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
        .handlers,
    );

    // 用還沒有真頁面的模組(佔位頁),測試就不必連帶餵該頁的 GraphQL handler
    const { user } = renderApp({ path: "/system/role-manager" });
    const banner = await screen.findByRole("banner");
    const help = await within(banner).findByRole("button", {
      name: "模組說明",
    });
    expect(help).toBeEnabled();

    await user.click(help);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("模組說明 — 角色管理");
    // 內文是 Markdown 渲染的結果,不是原始碼:`##` 變成 heading、`-` 變成清單
    // (Markdown 是 lazy chunk,要等它載完才有 heading)
    expect(
      await within(dialog).findByRole("heading", { name: "這個模組做什麼" }),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
    expect(dialog).not.toHaveTextContent("## 這個模組做什麼");
    // 標題已經寫了模組名,內文不再重複一次 `# 組織管理`
    expect(
      within(dialog).queryByRole("heading", { level: 1 }),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "關閉" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("模組路由沒有對應的 help.md:按鈕 disabled,hover 提示「此頁尚無說明」", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: sampleTwoModules })
        .handlers,
    );

    const { user } = renderApp({ path: "/demo/sample-two/edit-page" });
    const banner = await screen.findByRole("banner");
    const help = await within(banner).findByRole("button", {
      name: "模組說明",
    });

    expect(help).toBeDisabled();
    // 提示改用 @repo/ui 的 Tooltip:停用的按鈕收不到 hover,
    // 事件載體是 Tooltip 自己包的外層 span
    const hintCarrier = help.parentElement;
    if (hintCarrier === null) {
      throw new Error("「?」按鈕沒有被 Tooltip 包起來");
    }
    await user.hover(hintCarrier);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "此頁尚無說明",
    );
  });

  it.each([
    ["form-alpha", "採購申請"],
    ["form-beta", "出差申請"],
  ])(
    "表單模組沒有專屬 help.md:退回表單模組通用說明,標題是模組名(%s)",
    async (key, name) => {
      server.use(
        ...authWorld({
          hasRefreshCookie: true,
          modules: [formModule(key, name)],
        }).handlers,
      );

      const { user } = renderApp({ path: `/${key}` });
      const banner = await screen.findByRole("banner");
      await user.click(
        await within(banner).findByRole("button", { name: "模組說明" }),
      );

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent(`模組說明 — ${name}`);
      expect(
        await within(dialog).findByText("填寫與查看申請單。"),
      ).toBeInTheDocument();
    },
  );

  it("表單模組有專屬 help.md:專屬檔優先", async () => {
    setHelpFiles({
      "/src/md/module-help/form-module.help.md":
        "# 表單模組\n\n## 這個模組做什麼\n\n通用說明。",
      "/src/md/module-help/form-alpha.help.md":
        "# 採購申請\n\n## 這個模組做什麼\n\n採購專屬說明。",
    });
    server.use(
      ...authWorld({
        hasRefreshCookie: true,
        modules: [formModule("form-alpha", "採購申請")],
      }).handlers,
    );

    const { user } = renderApp({ path: "/form-alpha" });
    const banner = await screen.findByRole("banner");
    await user.click(
      await within(banner).findByRole("button", { name: "模組說明" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText("採購專屬說明。"),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("通用說明。");
  });

  it("專案替換了底座的說明:彈窗選到替換後的內容,不是底座原文", async () => {
    setHelpFiles(
      {
        "/src/md/module-help/base/system.role-manager.help.md":
          "# 角色管理\n\n## 這個模組做什麼\n\n底座的角色說明。",
      },
      {
        replacements: {
          "/src/md/module-help/project/replacements/system.role-manager.help.md":
            "# 角色管理\n\n## 這個模組做什麼\n\n客製後的角色說明。",
        },
      },
    );
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
        .handlers,
    );

    const { user } = renderApp({ path: "/system/role-manager" });
    const banner = await screen.findByRole("banner");
    await user.click(
      await within(banner).findByRole("button", { name: "模組說明" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("模組說明 — 角色管理");
    expect(
      await within(dialog).findByText("客製後的角色說明。"),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("底座的角色說明。");
  });

  it("拿掉替換:同一個模組回到底座原說明", async () => {
    setHelpFiles({
      "/src/md/module-help/base/system.role-manager.help.md":
        "# 角色管理\n\n## 這個模組做什麼\n\n底座的角色說明。",
    });
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
        .handlers,
    );

    const { user } = renderApp({ path: "/system/role-manager" });
    const banner = await screen.findByRole("banner");
    await user.click(
      await within(banner).findByRole("button", { name: "模組說明" }),
    );

    expect(
      await within(await screen.findByRole("dialog")).findByText(
        "底座的角色說明。",
      ),
    ).toBeInTheDocument();
  });

  it("專案新增模組的說明:專屬檔照樣優先於表單通用說明", async () => {
    setHelpFiles(
      {
        "/src/md/module-help/base/form-module.help.md":
          "# 表單模組\n\n## 這個模組做什麼\n\n通用說明。",
      },
      {
        additions: {
          "/src/md/module-help/project/additions/form-alpha.help.md":
            "# 採購申請\n\n## 這個模組做什麼\n\n專案新增的採購說明。",
        },
      },
    );
    server.use(
      ...authWorld({
        hasRefreshCookie: true,
        modules: [
          formModule("form-alpha", "採購申請"),
          formModule("form-beta", "出差申請"),
        ],
      }).handlers,
    );

    const { user } = renderApp({ path: "/form-alpha" });
    const banner = await screen.findByRole("banner");
    await user.click(
      await within(banner).findByRole("button", { name: "模組說明" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText("專案新增的採購說明。"),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("通用說明。");
  });

  it("非模組路由(側欄一頁都進不去 → 無權限頁)不顯示「?」", async () => {
    server.use(...authWorld({ hasRefreshCookie: true, modules: [] }).handlers);

    renderApp({ path: "/" });
    await screen.findByRole("heading", { name: "沒有權限進入此頁面" });

    expect(
      within(screen.getByRole("banner")).queryByRole("button", {
        name: "模組說明",
      }),
    ).not.toBeInTheDocument();
  });

  it("help.md 換一份(模擬新增模組說明)就換一份內容,對照表以檔名的模組 key 為準", async () => {
    setHelpFiles({
      "/src/md/module-help/demo.sample-two.help.md":
        "# 示範模組2\n\n## 這個模組做什麼\n\n示範用的假模組。",
    });
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: sampleTwoModules })
        .handlers,
    );

    const { user } = renderApp({ path: "/demo/sample-two" });
    const banner = await screen.findByRole("banner");

    await user.click(
      await within(banner).findByRole("button", { name: "模組說明" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("模組說明 — 示範模組2");
    // 內文要等 lazy 的 Markdown chunk 載完
    expect(
      await within(dialog).findByText("示範用的假模組。"),
    ).toBeInTheDocument();
  });
});
