import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import {
  inRoles,
  sidebarBadges,
} from "@/test/msw/notification-settings-handlers";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import { renderPage } from "./notification-settings-test-support";

restoreViewportAfterEach();

const isFullScreen = (dialog: HTMLElement) =>
  dialog.classList.contains("MuiDialog-paperFullScreen");

/** 條件列(欄位 → 條件 → 值 → 刪除)那一排:「欄位」下拉所在的那一層。 */
const conditionRowOf = (dialog: HTMLElement): HTMLElement => {
  const field = within(dialog).getByRole("combobox", { name: "欄位" });
  const row = field.closest(".MuiFormControl-root")?.parentElement;
  if (!row) {
    throw new Error("找不到條件列");
  }
  return row;
};

/**
 * 斷點(RW-04):有表單欄位的彈窗(編輯收件人、修改側欄數字)在手機(< sm)全螢幕,條件列放不下時換行;
 * 只有一兩句話的還原確認維持置中小視窗;電腦不全螢幕。
 */
describe("通知設定頁:手機版彈窗", () => {
  it("手機:修改側欄數字全螢幕,條件列可換行", async () => {
    setMobileViewport();
    renderPage({
      world: { badges: sidebarBadges() },
      search: "?badge=demo.orders",
    });

    const dialog = await screen.findByRole("dialog", {
      name: "修改誰看得到:訂單",
    });
    expect(isFullScreen(dialog)).toBe(true);
    expect(getComputedStyle(conditionRowOf(dialog)).flexWrap).toBe("wrap");
  });

  it("手機:編輯通知收件人也全螢幕", async () => {
    setMobileViewport();
    renderPage({ search: "?edit=printing.agent-offline" });

    const dialog = await screen.findByRole("dialog", {
      name: "編輯收件人:列印代理程式離線",
    });
    expect(isFullScreen(dialog)).toBe(true);
    expect(getComputedStyle(conditionRowOf(dialog)).flexWrap).toBe("wrap");
  });

  it("手機:還原預設的確認維持小視窗", async () => {
    setMobileViewport();
    const { user } = renderPage({
      world: {
        badges: sidebarBadges({
          "demo.orders": { audience: inRoles(["role-support"]) },
        }),
      },
    });
    const table = await screen.findByRole("table", { name: "側欄數字清單" });
    const cell = await within(table).findByText("訂單");
    const row = cell.closest("tr");
    await user.click(
      within(row as HTMLElement).getByRole("button", { name: "還原預設" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "還原預設:訂單",
    });
    expect(isFullScreen(dialog)).toBe(false);
  });

  it("電腦:修改側欄數字不是全螢幕", async () => {
    renderPage({
      world: { badges: sidebarBadges() },
      search: "?badge=demo.orders",
    });

    const dialog = await screen.findByRole("dialog", {
      name: "修改誰看得到:訂單",
    });
    expect(isFullScreen(dialog)).toBe(false);
  });
});
