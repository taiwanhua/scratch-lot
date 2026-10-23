import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import {
  heightChainOf,
  isListPageShell,
  pageRootOf,
  squeezedPageRootProblem,
} from "@/test/height-chain";
import { authWorld } from "@/test/msw/auth-handlers";
import { delegationWorld } from "@/test/msw/delegation-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

const PREFERENCES_EMPTY =
  "目前沒有可以調整的偏好。外觀與語言在右上角的頭像選單切換。";

/** 個人設定(殼層路由 `/settings/personal`,不是模組、不看權限)。 */
describe("個人設定頁", () => {
  it("打開個人設定的偏好分頁:沒有語言選項", async () => {
    server.use(...authWorld({ hasRefreshCookie: true }).handlers);

    renderApp({ path: "/settings/personal?tab=preferences" });

    expect(await screen.findByText(PREFERENCES_EMPTY)).toBeVisible();
    const main = screen.getByRole("main");
    expect(within(main).queryByRole("combobox")).toBeNull();
    expect(within(main).queryByRole("group", { name: "語言" })).toBeNull();
    expect(within(main).queryByText("語言")).toBeNull();
  });

  it("開 /settings/personal 不帶 tab:顯示偏好分頁(分頁籤「偏好 | 代理人」,偏好選中)", async () => {
    server.use(...authWorld({ hasRefreshCookie: true }).handlers);

    renderApp({ path: "/settings/personal" });

    expect(await screen.findByText(PREFERENCES_EMPTY)).toBeVisible();
    const tabs = screen.getByRole("tablist", { name: "個人設定分頁" });
    expect(within(tabs).getByRole("tab", { name: "偏好" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(tabs).getByRole("tab", { name: "代理人" })).toBeVisible();
  });

  it("沒有任何權限的使用者開個人設定:照常打開(頁名、路由頁籤、說明鈕都在)", async () => {
    server.use(...authWorld({ hasRefreshCookie: true, modules: [] }).handlers);

    renderApp({ path: "/settings/personal" });

    expect(await screen.findByText(PREFERENCES_EMPTY)).toBeVisible();
    const banner = screen.getByRole("banner");
    expect(within(banner).getByText("個人設定")).toBeVisible();
    expect(
      within(banner).getByRole("button", { name: "模組說明" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /個人設定/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByText("沒有權限進入此頁面")).toBeNull();
  });

  it("頭像選單 → 個人設定:開到 /settings/personal", async () => {
    server.use(...authWorld({ hasRefreshCookie: true }).handlers);

    const { user } = renderApp({ path: "/overview" });
    await user.click(await screen.findByRole("button", { name: "小華" }));
    await user.click(screen.getByRole("menuitem", { name: "個人設定" }));

    expect(await screen.findByText(PREFERENCES_EMPTY)).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/settings/personal",
    );
  });

  it("網址尾端多一段不是個人設定:不顯示個人設定頁", async () => {
    server.use(...authWorld({ hasRefreshCookie: true }).handlers);

    renderApp({ path: "/settings/personal/extra" });

    const forbidden = await screen.findAllByText("沒有權限進入此頁面");
    expect(forbidden.length).toBeGreaterThan(0);
    expect(screen.queryByText(PREFERENCES_EMPTY)).toBeNull();
  });
});

describe("個人設定頁的高度(STYLE-08:頁內分頁殼不釘高、不被壓扁,交給 <main> 捲)", () => {
  it("分頁殼的卡片:flex-grow 1、flex-shrink 0(Card 會裁切溢出,壓扁就看不到偏好清單的下半與 [儲存])", async () => {
    server.use(...authWorld({ hasRefreshCookie: true }).handlers);
    renderApp({ path: "/settings/personal?tab=preferences" });
    const root = pageRootOf(
      await screen.findByRole("tablist", { name: "個人設定分頁" }),
    );
    const style = globalThis.getComputedStyle(root);
    expect(style.flexGrow).toBe("1");
    expect(style.flexShrink).toBe("0");
    // 內容頁(偏好、代理人):手機寬、平板寬都整頁捲,不是列表頁殼
    expect(squeezedPageRootProblem(root, 390)).toBeNull();
    expect(squeezedPageRootProblem(root, 1024)).toBeNull();
    expect(isListPageShell(root)).toBe(false);
  });

  it("代理人分頁:表格外面不多開一層捲動,高度鏈直通殼的 <main>", async () => {
    const world = delegationWorld();
    server.use(
      ...world.handlers,
      ...authWorld({ hasRefreshCookie: true }).handlers,
    );
    renderApp({ path: "/settings/personal?tab=delegations" });
    await screen.findByText("李小華");
    const chain = heightChainOf(
      screen.getByRole("table", { name: "我的代理" }),
    );
    expect(chain.at(-1)?.label).toBe("MAIN.MuiBox-root"); // 最外層是 <main>:由殼捲
    expect(chain.slice(1, -1).filter((link) => link.scrolls)).toEqual([]); // 只有表格容器自己捲(橫向)
  });
});
