import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { currentSearch, urlParam } from "@/test/url-reload";

import {
  optionsPanel,
  renderPage,
  selectCategory,
} from "./field-manager-test-support";

describe("欄位管理:選中的類別存在網址(REACT-14)", () => {
  it("選中的類別寫進 `?detail=`;重新整理後右表格還是那一個類別", async () => {
    const first = renderPage();
    expect(await screen.findByText("性別 — 選項")).toBeInTheDocument();
    await selectCategory(first.user, "示範分類");
    expect(await within(optionsPanel()).findByText("炸物")).toBeInTheDocument();
    await waitFor(() => {
      expect(urlParam("detail")).not.toBeNull();
    });
    first.unmount();

    renderPage({ search: currentSearch() });

    expect(await screen.findByText("示範分類 — 選項")).toBeInTheDocument();
    expect(await within(optionsPanel()).findByText("炸物")).toBeInTheDocument();
    expect(screen.queryByText("性別 — 選項")).toBeNull();
  });

  it("網址上的類別不在清單裡(手改、已停用)→ 退回第一個類別", async () => {
    renderPage({ search: "?detail=category-missing" });

    expect(await screen.findByText("性別 — 選項")).toBeInTheDocument();
  });
});
