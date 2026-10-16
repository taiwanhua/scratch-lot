import { beforeEach, describe, expect, it } from "@jest/globals";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { routeTabsStorageKey } from "@/lib/base/route-tabs";
import { testUser } from "@/test/msw/auth-handlers";
import { findSnackbarAlert } from "@/test/snackbar";
import { urlParam } from "@/test/url-reload";

import { USER_MANAGER_PERMISSIONS } from "./user-manager-permissions";
import {
  ALL_PERMISSIONS,
  renderPage,
  rowOf,
} from "./user-manager-test-support";

/**
 * 編輯彈窗記在網址 `?edit=<id>`(規格 10.1、REACT-14 的編輯彈窗情境表):使用者管理是完整測的那一頁,
 * 情境表每一列一個測試。
 */

const USER_MANAGER = "/system/user-manager";

beforeEach(() => {
  sessionStorage.clear();
});

describe("使用者管理:編輯彈窗存在網址 `?edit=<id>`", () => {
  it("帶 `?edit=<id>` 進入 → 以 id 讀那一筆最新資料,打開編輯彈窗", async () => {
    renderPage({ search: "?edit=user-ming" });

    const dialog = await screen.findByRole("dialog", {
      name: "編輯使用者 — 王小明",
    });
    expect(await within(dialog).findByLabelText("姓名 *")).toHaveValue(
      "王小明",
    );
  });

  it("沒有編輯權限 → 不打開、以 replace 清掉 `?edit=`,停在列表", async () => {
    renderPage({
      permissions: ALL_PERMISSIONS.filter(
        (key) => key !== USER_MANAGER_PERMISSIONS.edit,
      ),
      search: "?edit=user-ming",
    });

    expect(await screen.findByText("王小明")).toBeInTheDocument();
    await waitFor(() => {
      expect(urlParam("edit")).toBeNull();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("那一筆不存在或看不到 → 不打開、清掉參數、提示「找不到這筆資料」", async () => {
    renderPage({ search: "?edit=user-gone" });

    expect(await findSnackbarAlert()).toEqual({
      text: "找不到這筆資料",
      severity: "warning",
    });
    await waitFor(() => {
      expect(urlParam("edit")).toBeNull();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("從列表按「編輯」→ 網址寫入 `?edit=<id>`;取消或存完關閉 → 清掉", async () => {
    const { user: actor, fake } = renderPage();
    await screen.findByText("王小明");

    await actor.click(
      within(rowOf("王小明")).getByRole("button", { name: "編輯" }),
    );
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(urlParam("edit")).toBe("user-ming");
    });
    await actor.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(urlParam("edit")).toBeNull();
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    await actor.click(
      within(rowOf("王小明")).getByRole("button", { name: "編輯" }),
    );
    const again = await screen.findByRole("dialog", {
      name: "編輯使用者 — 王小明",
    });
    await actor.click(within(again).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(fake.inputs.updateUser).toHaveLength(1);
    });
    await waitFor(() => {
      expect(urlParam("edit")).toBeNull();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("切到別的頁籤再切回來 → 頁籤記住的參數裡有 `?edit=`,彈窗跟著回來", async () => {
    const { user: actor } = renderPage({ search: "?edit=user-ming" });
    await screen.findByRole("dialog", { name: "編輯使用者 — 王小明" });
    await waitFor(() => {
      const stored = JSON.parse(
        sessionStorage.getItem(routeTabsStorageKey(testUser.id)) ?? "[]",
      ) as { route: string; search?: string }[];
      expect(stored.find((entry) => entry.route === USER_MANAGER)?.search).toBe(
        "?edit=user-ming",
      );
    });

    // 彈窗開著時背景被設成 aria-hidden(使用者點得到,無障礙樹裡藏起來),所以查詢帶 hidden
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "主選單", hidden: true }),
      ).getByRole("link", { name: "總覽", hidden: true }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/overview");
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    await actor.click(
      within(screen.getByRole("tablist", { name: "路由頁籤" })).getByRole(
        "tab",
        { name: "使用者管理" },
      ),
    );

    expect(
      await screen.findByRole("dialog", { name: "編輯使用者 — 王小明" }),
    ).toBeInTheDocument();
    expect(urlParam("edit")).toBe("user-ming");
  });
});
