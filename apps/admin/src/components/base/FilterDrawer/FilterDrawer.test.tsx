import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";

import { authWorld } from "@/test/msw/auth-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import { FilterDrawerHarness } from "./FilterDrawerHarness";

restoreViewportAfterEach();

const renderHarness = () => {
  server.use(...authWorld({ hasRefreshCookie: true }).handlers);
  return renderApp({
    path: "/overview",
    extra: createElement(FilterDrawerHarness),
  });
};

const applied = () => screen.getByTestId("applied").textContent;

/** 打開抽屜,回抽屜本身。 */
const openDrawer = async (user: ReturnType<typeof renderHarness>["user"]) => {
  await user.click(await screen.findByRole("button", { name: "篩選 (1)" }));
  return screen.findByRole("presentation");
};

/**
 * 列表篩選(RW-01 / RW-01b):電腦是篩選列、改了立刻套用;窄螢幕是抽屜,改的是草稿。
 */
describe("FilterDrawer", () => {
  it("電腦:欄位直接在外面,改了立刻寫回;沒有 [篩選] 按鈕", async () => {
    const { user } = renderHarness();
    const field = await screen.findByRole("textbox", { name: "狀態" });
    await user.clear(field);
    await user.type(field, "x");
    expect(applied()).toBe("x");
    expect(screen.queryByRole("button", { name: /^篩選/ })).toBeNull();
  });

  it("抽屜:改的是草稿,還沒 [套用] 不寫回;[套用] 才寫回並關閉", async () => {
    setMobileViewport();
    const { user } = renderHarness();
    const drawer = await openDrawer(user);
    const field = within(drawer).getByRole("textbox", { name: "狀態" });
    await user.clear(field);
    await user.type(field, "discontinued");
    expect(applied()).toBe("on_sale");

    await user.click(within(drawer).getByRole("button", { name: "套用" }));
    expect(applied()).toBe("discontinued");
    await waitFor(() => {
      expect(screen.queryByRole("presentation")).toBeNull();
    });
  });

  it("抽屜:[清除] 把草稿改回空值(還要 [套用] 才寫回)", async () => {
    setMobileViewport();
    const { user } = renderHarness();
    const drawer = await openDrawer(user);
    await user.click(within(drawer).getByRole("button", { name: "清除" }));
    expect(within(drawer).getByRole("textbox", { name: "狀態" })).toHaveValue(
      "",
    );
    expect(applied()).toBe("on_sale");
    await user.click(within(drawer).getByRole("button", { name: "套用" }));
    expect(applied()).toBe("");
    expect(
      await screen.findByRole("button", { name: "篩選" }),
    ).toBeInTheDocument();
  });

  it("抽屜:改了草稿直接關掉 → 不寫回;再打開是套用中的值", async () => {
    setMobileViewport();
    const { user } = renderHarness();
    const drawer = await openDrawer(user);
    const field = within(drawer).getByRole("textbox", { name: "狀態" });
    await user.clear(field);
    await user.type(field, "changed");
    await user.click(within(drawer).getByRole("button", { name: "關閉" }));
    await waitFor(() => {
      expect(screen.queryByRole("presentation")).toBeNull();
    });
    expect(applied()).toBe("on_sale");

    const reopened = await openDrawer(user);
    expect(within(reopened).getByRole("textbox", { name: "狀態" })).toHaveValue(
      "on_sale",
    );
  });
});
