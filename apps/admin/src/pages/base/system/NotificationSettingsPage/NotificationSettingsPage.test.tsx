import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  inRoles,
  notificationTypes,
} from "@/test/msw/notification-settings-handlers";
import { querySnackbar } from "@/test/snackbar";

import {
  renderPage,
  rowOf,
  table,
  waitForRows,
} from "./notification-settings-test-support";

/**
 * 通知設定頁:
 * 清單、唯讀、編輯收件人、還原預設、網址上的編輯彈窗、錯誤標回條件列、類型名稱的語系。
 */
describe("通知設定頁", () => {
  it("列出負責人提醒類型:名稱、組織範圍(唯讀)、收件人摘要與「預設」標記", async () => {
    renderPage();
    await waitForRows();

    const agentRow = rowOf("列印代理程式離線");
    expect(within(agentRow).getByText("觸發事件的組織含上層")).toBeVisible();
    expect(within(agentRow).getByText(/權限 持有/)).toBeVisible();
    expect(within(agentRow).getByText("預設")).toBeVisible();
    expect(within(rowOf("到期提醒")).getByText("最上層組織")).toBeVisible();
    expect(screen.getByText("共 2 筆,每頁 20 筆")).toBeVisible();
  });

  it("搜尋寫進網址 ?list=,只列符合的類型", async () => {
    const { user } = renderPage();
    await waitForRows();

    await user.type(
      screen.getByRole("textbox", { name: "搜尋通知類型" }),
      "到期",
    );

    await waitFor(() => {
      expect(within(table()).queryByText("列印代理程式離線")).toBeNull();
    });
    expect(within(table()).getByText("到期提醒")).toBeVisible();
    expect(decodeURIComponent(globalThis.location.search)).toContain("到期");
  });

  it("編輯收件人:對話框說明組織範圍、不能選所有人、沒有所屬組織欄;儲存後清單顯示新條件", async () => {
    const { user, fake } = renderPage();
    await waitForRows();

    await user.click(
      within(rowOf("列印代理程式離線")).getByRole("button", { name: "編輯" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "編輯收件人:列印代理程式離線",
    });
    expect(globalThis.location.search).toContain("edit=printing.agent-offline");
    expect(
      within(dialog).getByText(/組織範圍:觸發事件的組織含上層/),
    ).toBeVisible();
    // 不允許「所有人」:沒有二選一
    expect(within(dialog).queryByRole("radio", { name: "所有人" })).toBeNull();

    // 欄位只有使用者 / 角色 / 權限
    await user.click(within(dialog).getByRole("combobox", { name: "欄位" }));
    const options = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(["使用者", "角色", "權限"]);
    await user.click(screen.getByRole("option", { name: "角色" }));

    await user.click(within(dialog).getByRole("combobox", { name: "值" }));
    const roleOptions = await screen.findAllByRole("option");
    const support = roleOptions.find((option) =>
      option.textContent.startsWith("客服"),
    );
    expect(support).toBeDefined();
    await user.click(support as Element);

    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(fake.inputs.update).toEqual([
      {
        type: "printing.agent-offline",
        audience: inRoles(["role-support"]),
      },
    ]);
    await waitFor(() => {
      expect(
        within(rowOf("列印代理程式離線")).getByText("角色 屬於 客服"),
      ).toBeVisible();
    });
    expect(within(rowOf("列印代理程式離線")).queryByText("預設")).toBeNull();
    expect(globalThis.location.search).not.toContain("edit=");
  });

  it("api 擋下 OUT_OF_TENANT → 依 path 標在那一列條件,不關閉", async () => {
    const { user } = renderPage({
      world: {
        failures: {
          UpdateNotificationSetting: {
            code: "VALIDATION_FAILED",
            extensions: {
              reason: "OUT_OF_TENANT",
              type: "printing.agent-offline",
              path: "filter.children[0].value.values[0]",
            },
          },
        },
      },
    });
    await waitForRows();

    await user.click(
      within(rowOf("列印代理程式離線")).getByRole("button", { name: "編輯" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    expect(
      await within(dialog).findByText("這個對象不在你的組織內"),
    ).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("api 回 TENANT_ONLY(例如別的分頁剛切到根組織)→ 對話框顯示要先切換組織", async () => {
    const { user } = renderPage({
      world: {
        failures: {
          UpdateNotificationSetting: {
            code: "FORBIDDEN",
            extensions: { reason: "TENANT_ONLY" },
          },
        },
      },
    });
    await waitForRows();

    await user.click(
      within(rowOf("列印代理程式離線")).getByRole("button", { name: "編輯" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    expect(
      await within(dialog).findByText(
        "這裡不能調整收件人,請先切換到要設定的組織",
      ),
    ).toBeVisible();
    // 錯誤已就地顯示在對話框裡,不再跳提示(同一句不出現兩次)
    expect(querySnackbar()).toBeNull();
  });

  it("還原預設:先確認(顯示預設條件)→ 清單回到類型宣告的條件並標「預設」", async () => {
    const { user, fake } = renderPage({
      world: {
        types: [
          {
            type: "printing.agent-offline",
            name: "列印代理程式離線",
            orgScope: { ref: "event-org", range: "ancestors" },
            defaultAudience: {
              mode: "match",
              filter: {
                op: "AND",
                children: [
                  {
                    field: "permission",
                    cond: "in",
                    value: { kind: "static", values: ["system.printers.edit"] },
                  },
                ],
              },
            },
            audience: inRoles(["role-support"]),
          },
        ],
      },
    });
    await waitForRows();

    const row = rowOf("列印代理程式離線");
    expect(within(row).getByText("角色 屬於 客服")).toBeVisible();
    expect(within(row).queryByText("預設")).toBeNull();

    await user.click(within(row).getByRole("button", { name: "還原預設" }));
    const dialog = await screen.findByRole("dialog", {
      name: "還原預設:列印代理程式離線",
    });
    expect(
      within(dialog).getByText(/收件人會改回預設:權限 持有/),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "還原預設" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(fake.inputs.reset).toEqual([{ type: "printing.agent-offline" }]);
    await waitFor(() => {
      expect(within(rowOf("列印代理程式離線")).getByText("預設")).toBeVisible();
    });
    expect(
      within(rowOf("列印代理程式離線")).getByText(/權限 持有/),
    ).toBeVisible();
    expect(
      within(rowOf("列印代理程式離線")).getByRole("button", {
        name: "還原預設",
      }),
    ).toBeDisabled();
  });

  it("英文介面:有文案的類型用訊息檔的名稱,沒有的退回 api 的 name", async () => {
    renderPage({ locale: "en" });

    await waitFor(() => {
      expect(
        screen.getByRole("table", { name: "Notification types" }),
      ).toBeInTheDocument();
    });
    const englishTable = screen.getByRole("table", {
      name: "Notification types",
    });
    expect(
      await within(englishTable).findByText("Print agent offline"),
    ).toBeVisible();
    // 專案類型沒有英文文案 → 顯示登記的名稱
    expect(within(englishTable).getByText("到期提醒")).toBeVisible();
    expect(
      within(englishTable).getByText(
        "Organization of the event and its parents",
      ),
    ).toBeVisible();
  });

  it("還原預設失敗 → 錯誤顯示在確認框裡、不另跳提示", async () => {
    const { user } = renderPage({
      world: {
        types: notificationTypes({
          "printing.agent-offline": { audience: inRoles(["role-support"]) },
        }),
        failures: {
          ResetNotificationSetting: {
            code: "FORBIDDEN",
            extensions: { reason: "TENANT_ONLY" },
          },
        },
      },
    });
    await waitForRows();

    await user.click(
      within(rowOf("列印代理程式離線")).getByRole("button", {
        name: "還原預設",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "還原預設" }));

    expect(
      await within(dialog).findByText(
        "這裡不能調整收件人,請先切換到要設定的組織",
      ),
    ).toBeVisible();
    expect(querySnackbar()).toBeNull();
  });
});
