import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import { currentSearch, urlParam } from "@/test/url-reload";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import { matrixCheckbox, renderRolePage } from "./role-manager-test-support";

const list = () => screen.queryByRole("list", { name: "角色清單" });
const detailTab = () => screen.queryByRole("tab", { name: "分配使用者" });

describe("角色管理:手機寬一次只顯示一邊(主從)", () => {
  restoreViewportAfterEach();

  it("清單滿版 → 點角色切到詳情(網址帶選取)→ [← 返回] 回到清單;重新整理停在同一個角色", async () => {
    setMobileViewport();
    const first = renderRolePage();
    expect(await screen.findByText("審核員")).toBeInTheDocument();
    expect(detailTab()).toBeNull();

    await first.user.click(screen.getByText("審核員"));
    await waitFor(() => {
      expect(detailTab()).not.toBeNull();
    });
    expect(list()).toBeNull();
    await waitFor(() => {
      expect(urlParam("detail")).not.toBeNull();
    });
    const search = currentSearch();

    await first.user.click(screen.getByRole("button", { name: "← 返回" }));
    await waitFor(() => {
      expect(list()).not.toBeNull();
    });
    expect(detailTab()).toBeNull();
    expect(urlParam("detail")).toBeNull();
    first.unmount();

    renderRolePage({ search });
    await waitFor(() => {
      expect(detailTab()).not.toBeNull();
    });
    expect(list()).toBeNull();
  });

  it("sm 以上兩欄並排,沒有 [← 返回]", async () => {
    renderRolePage();
    expect(await screen.findByText("審核員")).toBeInTheDocument();
    expect(detailTab()).not.toBeNull();
    expect(screen.queryByRole("button", { name: "← 返回" })).toBeNull();
  });
});

describe("角色管理:手機寬返回時的未存攔截", () => {
  restoreViewportAfterEach();

  it("矩陣有未存變更 → [← 返回] 先問 → 放棄 → 回清單,再點同一個角色是原本的勾選", async () => {
    setMobileViewport();
    const { user } = renderRolePage();
    await user.click(await screen.findByText("內容編輯"));
    await screen.findByText("內容編輯 — 權限設定");
    await screen.findByText("示範模組1");
    const create = "新增demo.sub.sample-one.create";
    await user.click(matrixCheckbox(create));
    expect(matrixCheckbox(create)).toBeChecked();

    await user.click(screen.getByRole("button", { name: "← 返回" }));
    expect(await screen.findByText("放棄未儲存的變更?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "放棄變更" }));
    await waitFor(() => {
      expect(list()).not.toBeNull();
    });
    expect(urlParam("detail")).toBeNull();

    await user.click(screen.getByText("內容編輯"));
    await screen.findByText("內容編輯 — 權限設定");
    await screen.findByText("示範模組1");
    expect(matrixCheckbox(create)).not.toBeChecked();
    expect(screen.queryByText("有未儲存的變更")).toBeNull();
  });
});
