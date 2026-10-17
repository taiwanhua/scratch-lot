import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { findSnackbarAlert } from "@/test/snackbar";

import { NOTIFICATION_SETTINGS_PERMISSIONS } from "./notification-settings-permissions";
import {
  renderPage,
  rowOf,
  table,
  waitForRows,
} from "./notification-settings-test-support";

/**
 * 通知設定頁的唯讀判斷與網址上的編輯彈窗(`?edit=<類型 key>`;REACT-14):沒有 edit 權限、
 * 站在根組織(`me.currentOrg.tenantId === null`)、超級管理員站在租戶、找不到的類型。
 */
describe("通知設定頁:唯讀與編輯網址", () => {
  it("沒有 edit 權限 → 唯讀:沒有操作欄、沒有 [編輯] / [還原預設]", async () => {
    renderPage({ permissions: [NOTIFICATION_SETTINGS_PERMISSIONS.view] });
    await waitForRows();

    expect(within(table()).queryByRole("button", { name: "編輯" })).toBeNull();
    expect(
      within(table()).queryByRole("button", { name: "還原預設" }),
    ).toBeNull();
    expect(
      within(table()).queryByRole("columnheader", { name: "操作" }),
    ).toBeNull();
  });

  it("沒有 edit 權限時網址帶 ?edit= 不打開彈窗,參數被清掉", async () => {
    renderPage({
      permissions: [NOTIFICATION_SETTINGS_PERMISSIONS.view],
      search: "?edit=printing.agent-offline",
    });
    await waitForRows();

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(globalThis.location.search).not.toContain("edit=");
    });
  });

  it("站在根組織 → 唯讀並說明(api 只回預設、改了會 TENANT_ONLY)", async () => {
    renderPage({ isAtRoot: true });
    await waitForRows();

    expect(screen.getByText(/這裡只顯示預設收件人,不能調整/)).toBeVisible();
    expect(within(table()).queryByRole("button", { name: "編輯" })).toBeNull();
  });

  it("站在根組織時網址帶 ?edit= → 不打開、清掉參數", async () => {
    renderPage({ isAtRoot: true, search: "?edit=printing.agent-offline" });
    await waitForRows();

    await waitFor(() => {
      expect(globalThis.location.search).not.toContain("edit=");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("超級管理員(手上有根組織專屬模組)站在租戶 → 可以編輯", async () => {
    const { user } = renderPage({ hasRootOnlyModules: true });
    await waitForRows();

    expect(screen.queryByText(/只顯示預設收件人/)).toBeNull();
    await user.click(
      within(rowOf("列印代理程式離線")).getByRole("button", { name: "編輯" }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "編輯收件人:列印代理程式離線",
      }),
    ).toBeVisible();
  });

  it("網址帶 ?edit=<類型> 重新整理 → 直接打開那一種類型的編輯彈窗", async () => {
    renderPage({ search: "?edit=lottery.stocktake-reminder" });

    expect(
      await screen.findByRole("dialog", { name: "編輯收件人:盤點提醒" }),
    ).toBeVisible();
  });

  it("網址帶 ?edit=<不存在的類型> → 不打開、清掉參數、提示「找不到這筆資料」", async () => {
    renderPage({ search: "?edit=printing.gone" });

    expect(await findSnackbarAlert()).toEqual({
      text: "找不到這筆資料",
      severity: "warning",
    });
    await waitFor(() => {
      expect(globalThis.location.search).not.toContain("edit=");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
