import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { authWorld } from "@/test/msw/auth-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

const PREFERENCES_EMPTY =
  "目前沒有可以調整的偏好。外觀與語言在右上角的頭像選單切換。";

/** 個人設定(規格 10.6;殼層路由 `/settings/personal`,不是模組、不看權限)。 */
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

  it("開 /settings/personal 不帶 tab:顯示偏好分頁;只有一個分頁時不顯示分頁籤", async () => {
    server.use(...authWorld({ hasRefreshCookie: true }).handlers);

    renderApp({ path: "/settings/personal" });

    expect(await screen.findByText(PREFERENCES_EMPTY)).toBeVisible();
    expect(screen.queryByRole("tablist", { name: "個人設定分頁" })).toBeNull();
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
