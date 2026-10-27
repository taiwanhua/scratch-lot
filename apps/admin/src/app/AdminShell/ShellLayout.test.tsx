import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { renderFormsPage } from "@/pages/base/system/FormsPage/forms-page-test-support";
import { renderWorkflows } from "@/pages/base/system/WorkflowsPage/workflows-page-test-support";
import { mediaRulesOf } from "@/test/media-rules";
import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import { demoGroupNode, superAdminModules } from "@/test/msw/module-fixtures";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/** 主題斷點(MUI 預設,`packages/ui` 的 theme 沒改):lg 1200、xl 1536。 */
const LG = 1200;
const XL = 1536;

/** `lg` 起(`@media (min-width:1200px)`)那條的 `min-width`(jsdom 不套 @media,讀宣告)。 */
const contentMinWidth = (): string =>
  mediaRulesOf(screen.getByTestId("shell-content"), LG);

describe("殼的內容區最小寬度(lg 以上才套;視窗更窄時由內容區水平捲動)", () => {
  it("平板以下(< lg)不設最小寬度:sm / md 斷點沒有 min-width 宣告,xs 是 0", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
        .handlers,
    );
    renderApp({ path: "/overview" });
    await screen.findByRole("navigation", { name: "主選單" });

    const content = screen.getByTestId("shell-content");
    expect(mediaRulesOf(content, 0)).toContain("min-width: 0");
    expect(mediaRulesOf(content, 600)).not.toContain("min-width");
    expect(mediaRulesOf(content, 900)).not.toContain("min-width");
    expect(contentMinWidth()).toContain("min-width");
  });

  it("殼層預設以 lg 為準,收合側欄後重算;水平捲動只在 <main>,外框不捲", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
        .handlers,
    );
    const { user } = renderApp({ path: "/overview" });
    const nav = await screen.findByRole("navigation", { name: "主選單" });

    // 斷點 − 側欄(30 單位)− 左右內距(非手機版面 3 單位 × 2)
    const expanded = contentMinWidth();
    expect(expanded).toContain(`${String(LG)}px`);
    expect(expanded).toContain("30 * var(--mui-spacing)");

    await user.click(within(nav).getByRole("button", { name: "收合側欄" }));
    // 收合後側欄只剩 8 單位,最小寬度跟著變大(視窗 ≥ 斷點時仍放得下,不多出捲軸)
    const collapsed = contentMinWidth();
    expect(collapsed).toContain(`${String(LG)}px`);
    expect(collapsed).not.toContain("30 * var(--mui-spacing)");
    // 側欄(8 單位)與左右內距(6 單位)各一次
    expect(collapsed.split("(8 * var(--mui-spacing))")).toHaveLength(2);
    expect(collapsed.split("(6 * var(--mui-spacing))")).toHaveLength(2);
    // 水平捲動只發生在 <main>:它自己 overflow: auto,殼的外框 overflow: hidden(document 不捲)
    const main = screen.getByRole("main");
    expect(globalThis.getComputedStyle(main).overflow).toBe("auto");
    const frame = main.parentElement?.parentElement ?? document.body;
    expect(globalThis.getComputedStyle(frame).overflow).toBe("hidden");
  });

  it("側欄收合時模組樹那一格不橫捲(不出 x 捲軸),兩種寬度都能垂直捲", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
        .handlers,
    );
    const { user } = renderApp({ path: "/overview" });
    const nav = await screen.findByRole("navigation", { name: "主選單" });
    const content = within(nav).getByTestId("side-nav-content");

    // 展開:選單長時這一格垂直捲動
    expect(globalThis.getComputedStyle(content).overflowY).toBe("auto");

    await user.click(within(nav).getByRole("button", { name: "收合側欄" }));
    // 收合:兩軸明確設;只寫 overflow-y: auto 時 x 會被連帶算成 auto(圖示格比欄內寬多 1px)
    const collapsed = globalThis.getComputedStyle(content);
    expect(collapsed.overflowX).toBe("hidden");
    expect(collapsed.overflowY).toBe("auto");
  });

  it("表單管理沿用殼層預設 lg(設計器在 xl 以下自己換版,1440 寬不再水平溢出)", async () => {
    renderFormsPage();

    await screen.findByRole("navigation", { name: "主選單" });
    expect(contentMinWidth()).toContain(`${String(LG)}px`);
    expect(contentMinWidth()).not.toContain(`${String(XL)}px`);
  });

  it("流程管理也沿用殼層預設 lg", async () => {
    renderWorkflows();

    await screen.findByRole("navigation", { name: "主選單" });
    expect(contentMinWidth()).toContain(`${String(LG)}px`);
    expect(contentMinWidth()).not.toContain(`${String(XL)}px`);
  });
});

describe("殼的垂直捲動(STYLE-08:內容頁不釘高,交給 <main> 捲)", () => {
  it("<main> 垂直可捲;內容區那一層不裁切(沒有 overflow: hidden)", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
        .handlers,
    );
    renderApp({ path: "/overview" });
    await screen.findByRole("navigation", { name: "主選單" });
    // jsdom 不展開 overflow 簡寫:宣告 overflow: auto 或 overflow-y: auto 都算
    const mainStyle = globalThis.getComputedStyle(screen.getByRole("main"));
    expect([mainStyle.overflow, mainStyle.overflowY]).toContain("auto");
    const content = globalThis.getComputedStyle(
      screen.getByTestId("shell-content"),
    );
    expect([content.overflow, content.overflowY]).not.toContain("hidden");
  });
});

describe("殼的內容區內距", () => {
  it("<main> 內距:手機寬 8px(1 單位)、sm 起 24px(3 單位)", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
        .handlers,
    );
    renderApp({ path: "/overview" });
    await screen.findByRole("navigation", { name: "主選單" });

    const main = screen.getByRole("main");
    // 響應式值各自在一條 @media 裡(xs = min-width:0px),jsdom 不套 @media,讀宣告原文
    // (1 單位 MUI 直接寫成 var(--mui-spacing),不包 calc)
    expect(mediaRulesOf(main, 0)).toContain("padding: var(--mui-spacing);");
    expect(mediaRulesOf(main, 600)).toContain(
      "padding: calc(3 * var(--mui-spacing));",
    );
  });
});

describe("AppBar 標題", () => {
  it("群組路由轉走前不閃「無權限」標題", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
        .handlers,
    );
    // 群組路由只 render 一次就轉走,最後的畫面看不到那一瞬間:記下過程中出現過的每一段文字
    // (新增 / 移除的節點與被改掉的舊文字)
    const seen: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        seen.push(record.oldValue ?? "");
        for (const node of [...record.addedNodes, ...record.removedNodes]) {
          seen.push(node.textContent ?? "");
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: true,
    });

    renderApp({ path: "/system" });
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/system/org-manager",
      );
    });
    observer.disconnect();

    expect(seen.join("\n")).not.toContain("沒有權限進入此頁面");
  });

  it("群組底下沒有能進的頁 → 停在無權限頁,標題照常顯示「無權限」", async () => {
    server.use(
      ...authWorld({
        hasRefreshCookie: true,
        modules: [overviewModule, demoGroupNode],
      }).handlers,
    );

    renderApp({ path: "/demo" });

    expect(
      await screen.findByRole("heading", { name: "沒有權限進入此頁面" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("banner")).getByText("沒有權限進入此頁面"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/demo$/);
  });
});
