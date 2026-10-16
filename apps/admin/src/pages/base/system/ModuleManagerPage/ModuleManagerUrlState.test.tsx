import { describe, expect, it } from "@jest/globals";
import { waitFor, within } from "@testing-library/react";

import { currentSearch, urlParam } from "@/test/url-reload";

import {
  clickNode,
  detail,
  renderPage,
  waitForTree,
} from "./module-manager-test-support";

describe("模組與權限:選中的節點存在網址(REACT-14)", () => {
  it("選中的節點寫進 `?detail=`;重新整理後右面板還是那一個", async () => {
    const first = renderPage();
    await waitForTree();
    await clickNode(first.user, "組織管理");
    expect(
      await within(detail()).findByText("system.org-manager"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(urlParam("detail")).not.toBeNull();
    });
    first.unmount();

    renderPage({ search: currentSearch() });
    await waitForTree();

    expect(
      await within(detail()).findByText("system.org-manager"),
    ).toBeInTheDocument();
    expect(within(detail()).queryByText("overview")).toBeNull();
  });

  it("網址上的節點不在樹裡(手改、換了組織)→ 退回第一棵樹的根", async () => {
    renderPage({ search: "?detail=module-missing" });
    await waitForTree();

    expect(await within(detail()).findByText("overview")).toBeInTheDocument();
  });
});
