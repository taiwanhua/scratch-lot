import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { currentSearch, urlParam } from "@/test/url-reload";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import { clickNode, renderPage, waitForTree } from "./org-manager-test-support";

const tree = () => screen.queryByRole("tree", { name: "組織樹" });
const detailRegion = () => screen.queryByRole("region", { name: "組織資料" });
const findDetail = async () =>
  screen.findByRole("region", { name: "組織資料" });

describe("組織管理:手機寬一次只顯示一邊(主從)", () => {
  restoreViewportAfterEach();

  it("樹滿版 → 點組織切到詳情(網址帶選取)→ [← 返回] 回到樹;重新整理停在同一個組織", async () => {
    setMobileViewport();
    const first = renderPage();
    await waitForTree();
    expect(detailRegion()).toBeNull();

    await clickNode(first.user, "A-1 內容組");
    expect(
      await within(await findDetail()).findByText("A-1 內容組"),
    ).toBeInTheDocument();
    expect(tree()).toBeNull();
    await waitFor(() => {
      expect(urlParam("detail")).toBe("org-content");
    });
    const search = currentSearch();

    await first.user.click(screen.getByRole("button", { name: "← 返回" }));
    await waitFor(() => {
      expect(tree()).not.toBeNull();
    });
    expect(detailRegion()).toBeNull();
    expect(urlParam("detail")).toBeNull();
    first.unmount();

    renderPage({ search });
    expect(
      await within(await findDetail()).findByText("A-1 內容組"),
    ).toBeInTheDocument();
    expect(tree()).toBeNull();
  });

  it("sm 以上兩欄並排,沒有 [← 返回]", async () => {
    renderPage();
    await waitForTree();
    expect(detailRegion()).not.toBeNull();
    expect(screen.queryByRole("button", { name: "← 返回" })).toBeNull();
  });
});
