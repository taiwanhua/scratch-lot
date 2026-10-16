import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { currentSearch, urlParam } from "@/test/url-reload";

import {
  clickNode,
  detail,
  renderPage,
  waitForTree,
} from "./org-manager-test-support";

describe("組織管理:選中的組織與詳情頁籤存在網址(REACT-14)", () => {
  it("選中的組織(`?detail=`)與「成員」頁籤(`?tab=`)重新整理後都還在", async () => {
    const first = renderPage();
    await waitForTree();
    await clickNode(first.user, "A-1 內容組");
    await within(detail()).findByText("A-1 內容組");
    await first.user.click(screen.getByRole("tab", { name: "成員" }));
    await screen.findByText("A-1 內容組 — 成員");
    await waitFor(() => {
      expect(urlParam("tab")).toBe("members");
    });
    const selected = urlParam("detail");
    expect(selected).not.toBeNull();
    first.unmount();

    renderPage({ search: currentSearch() });

    expect(await screen.findByText("A-1 內容組 — 成員")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "成員" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(urlParam("detail")).toBe(selected);
  });

  it("網址上的組織不在樹裡(手改、已刪除)→ 退回樹根", async () => {
    renderPage({ search: "?detail=org-missing" });
    await waitForTree();

    expect(
      await within(detail()).findByRole("button", { name: "編輯" }),
    ).toBeInTheDocument();
    expect(within(detail()).queryByText("A-1 內容組")).toBeNull();
  });
});
