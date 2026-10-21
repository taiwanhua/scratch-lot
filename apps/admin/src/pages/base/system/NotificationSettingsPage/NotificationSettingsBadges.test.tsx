import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  inRoles,
  sidebarBadges,
} from "@/test/msw/notification-settings-handlers";

import { NOTIFICATION_SETTINGS_PERMISSIONS } from "./notification-settings-permissions";
import { renderPage } from "./notification-settings-test-support";

const badgeTable = () => screen.getByRole("table", { name: "側欄數字清單" });

/** 側欄數字區塊的某一列(依模組名稱找)。 */
const badgeRowOf = (name: string): HTMLElement => {
  const row = within(badgeTable())
    .getAllByRole("row")
    .find((item) => within(item).queryByText(name) !== null);
  if (row === undefined) {
    throw new Error(`找不到「${name}」那一列`);
  }
  return row;
};

/** 區塊載完、權限名稱也解析完才開始斷言。 */
const waitForBadges = async () => {
  await waitFor(() => {
    expect(within(badgeTable()).getByText("申請中心")).toBeInTheDocument();
  });
  await waitFor(() => {
    expect(within(badgeTable()).queryByText(/載入中/)).toBeNull();
  });
};

/**
 * 通知設定頁的「側欄數字」區塊:列出登記的數字、預設 / 調整過的「誰看得到」、[修改](網址 `?badge=`)、
 * [還原預設]、唯讀。
 */
describe("通知設定頁:側欄數字", () => {
  it("列出登記的數字:模組、數什麼(說明文字;沒有 =「—」)、誰看得到(預設標「預設」)", async () => {
    renderPage({ world: { badges: sidebarBadges() } });
    await waitForBadges();

    const apply = badgeRowOf("申請中心");
    expect(within(apply).getByText("待你處理的審核件數")).toBeVisible();
    expect(
      within(apply).getByText(/可進入這個模組、且符合「權限 持有/),
    ).toBeVisible();
    expect(within(apply).getByText("預設")).toBeVisible();

    const orders = badgeRowOf("訂單");
    expect(within(orders).getByText("—")).toBeVisible();
    expect(within(orders).getByText("可進入這個模組的人")).toBeVisible();
    // 沒調整過的不能還原
    expect(
      within(orders).getByRole("button", { name: "還原預設" }),
    ).toBeDisabled();
  });

  it("[修改]:網址記 ?badge=,與通知收件人同一個選擇器;儲存後列顯示新條件、不再標預設", async () => {
    const { user, fake } = renderPage({ world: { badges: sidebarBadges() } });
    await waitForBadges();

    await user.click(
      within(badgeRowOf("訂單")).getByRole("button", { name: "修改" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "修改誰看得到:訂單",
    });
    expect(globalThis.location.search).toContain("badge=demo.orders");
    expect(within(dialog).getByText(/要先能進入「訂單」/)).toBeVisible();
    expect(within(dialog).queryByRole("radio", { name: "所有人" })).toBeNull();

    // 預設沒有要求權限:從一列空的「角色」條件開始;欄位只有使用者 / 角色 / 權限
    const field = within(dialog).getByRole("combobox", { name: "欄位" });
    expect(field).toHaveTextContent("角色");
    await user.click(field);
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["使用者", "角色", "權限"]);
    await user.click(screen.getByRole("option", { name: "角色" }));
    await user.click(within(dialog).getByRole("combobox", { name: "值" }));
    const roleOptions = await screen.findAllByRole("option");
    const support = roleOptions.find((option) =>
      option.textContent.startsWith("客服"),
    );
    await user.click(support as Element);
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(fake.inputs.badgeUpdate).toEqual([
      { moduleKey: "demo.orders", audience: inRoles(["role-support"]) },
    ]);
    await waitFor(() => {
      expect(
        within(badgeRowOf("訂單")).getByText(
          "可進入這個模組、且符合「角色 屬於 客服」的人",
        ),
      ).toBeVisible();
    });
    expect(within(badgeRowOf("訂單")).queryByText("預設")).toBeNull();
    expect(globalThis.location.search).not.toContain("badge=");
  });

  it("修改要求權限的預設:編輯框從「持有那條權限」開始", async () => {
    const { user } = renderPage({
      world: { badges: sidebarBadges() },
      search: "?badge=apply-center",
    });
    const dialog = await screen.findByRole("dialog", {
      name: "修改誰看得到:申請中心",
    });
    expect(
      within(dialog).getByRole("combobox", { name: "欄位" }),
    ).toHaveTextContent("權限");
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("api 擋下 OUT_OF_TENANT → 標在那一列條件,不關閉", async () => {
    const { user } = renderPage({
      world: {
        badges: sidebarBadges({
          "demo.orders": { audience: inRoles(["role-support"]) },
        }),
        failures: {
          UpdateSidebarBadgeSetting: {
            code: "VALIDATION_FAILED",
            extensions: {
              reason: "OUT_OF_TENANT",
              moduleKey: "demo.orders",
              path: "filter.children[0].value.values[0]",
            },
          },
        },
      },
      search: "?badge=demo.orders",
    });
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    expect(
      await within(dialog).findByText("這個對象不在你的組織內"),
    ).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("[還原預設]:先確認(寫出預設)→ 列回到程式預設並標「預設」", async () => {
    const { user, fake } = renderPage({
      world: {
        badges: sidebarBadges({
          "demo.orders": { audience: inRoles(["role-support"]) },
        }),
      },
    });
    await waitForBadges();

    await user.click(
      within(badgeRowOf("訂單")).getByRole("button", { name: "還原預設" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "還原預設:訂單",
    });
    expect(
      within(dialog).getByText("誰看得到會改回預設:可進入這個模組的人。"),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "還原預設" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(fake.inputs.badgeReset).toEqual([{ moduleKey: "demo.orders" }]);
    await waitFor(() => {
      expect(within(badgeRowOf("訂單")).getByText("預設")).toBeVisible();
    });
  });

  it("唯讀:沒有 edit 沒有操作欄,網址的 ?badge= 被清掉、不打開", async () => {
    renderPage({
      permissions: [NOTIFICATION_SETTINGS_PERMISSIONS.view],
      world: { badges: sidebarBadges() },
      search: "?badge=demo.orders",
    });
    await waitForBadges();

    expect(
      within(badgeTable()).queryByRole("button", { name: "修改" }),
    ).toBeNull();
    await waitFor(() => {
      expect(globalThis.location.search).not.toContain("badge=");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("沒有登記任何側欄數字 → 區塊顯示空狀態", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "側欄數字清單" });
    expect(
      await within(table).findByText("目前沒有可以設定的側欄數字"),
    ).toBeVisible();
  });
});
