import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import { currentSearch, urlJson } from "@/test/url-reload";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import { renderPage } from "./user-manager-test-support";

const table = () => screen.queryByRole("table", { name: "使用者清單" });

describe("使用者管理:手機寬一次只顯示一邊(主從)", () => {
  restoreViewportAfterEach();

  it("組織樹滿版 → 點組織切到使用者清單(網址帶組織)→ [← 返回] 回到樹;重新整理停在同一個組織", async () => {
    setMobileViewport();
    const first = renderPage();
    const org = await screen.findByText("內容組");
    expect(table()).toBeNull();

    await first.user.click(org);
    await waitFor(() => {
      expect(table()).not.toBeNull();
    });
    expect(screen.getByText("內容組")).not.toBeVisible();
    await waitFor(() => {
      expect(urlJson("list")).toMatchObject({ org: "org-content" });
    });
    const search = currentSearch();

    await first.user.click(screen.getByRole("button", { name: "← 返回" }));
    await waitFor(() => {
      expect(screen.getByText("內容組")).toBeVisible();
    });
    expect(table()).toBeNull();
    first.unmount();

    renderPage({ search });
    await waitFor(() => {
      expect(table()).not.toBeNull();
    });
  });

  it("sm 以上兩欄並排,沒有 [← 返回]", async () => {
    renderPage();
    expect(await screen.findByText("內容組")).toBeInTheDocument();
    expect(table()).not.toBeNull();
    expect(screen.queryByRole("button", { name: "← 返回" })).toBeNull();
  });
});
