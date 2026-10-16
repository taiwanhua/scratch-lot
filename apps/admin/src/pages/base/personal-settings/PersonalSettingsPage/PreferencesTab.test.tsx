import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import { delay } from "msw";

import { authWorld } from "@/test/msw/auth-handlers";
import {
  notificationPreferenceDefaults,
  notificationPreferenceKey,
  notificationWorld,
} from "@/test/msw/notification-handlers";
import { api, server } from "@/test/msw/server";
import { renderApp } from "@/test/render";
import { findSnackbarAlert } from "@/test/snackbar";

/**
 * 個人設定「偏好」分頁的通知管道開關(底座規格 10.6、第 5 章「開關三層」的個人層;Figma BS-05 257:4821)。
 * 類型與 `canDisable` 照 api `base-notification-types.ts`;寫入走 `updateMyPreferences`,
 * key 由 api 給的 `preferenceKey`(`notification_<類型 . → _>_<管道>`)。
 */
const renderPreferences = () => {
  const auth = authWorld({
    hasRefreshCookie: true,
    preferences: notificationPreferenceDefaults(),
  });
  const notifications = notificationWorld({ preferences: auth.preferences });
  server.use(...notifications.handlers, ...auth.handlers);
  /** 每次 `UpdateMyPreferences` 送出的 `settings`(驗只送有變動的 key) */
  const sentSettings: Record<string, unknown>[] = [];
  server.events.on("request:start", async ({ request }) => {
    const body = (await request.clone().json()) as {
      operationName?: string;
      variables?: { input?: { settings?: Record<string, unknown> } };
    };
    const settings = body.variables?.input?.settings;
    if (body.operationName === "UpdateMyPreferences" && settings) {
      sentSettings.push(settings);
    }
  });
  return {
    ...renderApp({ path: "/settings/personal?tab=preferences" }),
    auth,
    sentSettings,
  };
};

/** 等表格載好(第一列出現)再回傳。 */
const findTable = async () => {
  await screen.findByText("待你審核");
  return screen.getByRole("table", { name: "通知管道" });
};

describe("偏好分頁:通知管道開關", () => {
  it("打開偏好分頁:只有通知管道開關,沒有語言選項", async () => {
    renderPreferences();

    const table = await findTable();
    expect(
      within(table).getByRole("columnheader", { name: "站內通知" }),
    ).toBeVisible();
    expect(
      within(table).getByRole("columnheader", { name: "Email" }),
    ).toBeVisible();
    expect(within(table).getByText("待你審核")).toBeVisible();
    const main = screen.getByRole("main");
    expect(within(main).queryByRole("combobox")).toBeNull();
    expect(within(main).queryByText("語言")).toBeNull();
  });

  it("canDisable = false 的開關為停用狀態(待你審核的站內通知不能關)", async () => {
    renderPreferences();
    await findTable();

    expect(
      screen.getByRole("switch", { name: "待你審核:站內通知" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: "待你審核:站內通知" }),
    ).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "待你審核:Email" }),
    ).toBeEnabled();
  });

  it("只對類型的預設管道給開關:知會沒有 Email 開關", async () => {
    renderPreferences();
    await findTable();

    expect(
      screen.getByRole("switch", { name: "知會:站內通知" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "知會:Email" })).toBeNull();
  });

  it("關掉申請結果的 Email 並儲存:寫入對應的偏好 key,重新載入後維持關閉", async () => {
    const { user, auth, sentSettings } = renderPreferences();
    await findTable();
    const save = screen.getByRole("button", { name: "儲存" });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole("switch", { name: "申請結果:Email" }));
    expect(save).toBeEnabled();
    await user.click(save);

    const alert = await findSnackbarAlert();
    expect(alert.text).toBe("已儲存通知設定");
    expect(
      auth.preferences[notificationPreferenceKey("workflow.result", "email")],
    ).toBe(false);
    // 只送有變動的那一個 key(語言同步另一支寫入的不算)
    expect(sentSettings.filter((settings) => !("locale" in settings))).toEqual([
      { [notificationPreferenceKey("workflow.result", "email")]: false },
    ]);
    await waitFor(() => {
      expect(save).toBeDisabled();
    });
    expect(
      screen.getByRole("switch", { name: "申請結果:Email" }),
    ).not.toBeChecked();
  });

  it("儲存後到重抓回來之前:開關維持新值,不閃回舊值(DATA-04)", async () => {
    const { user } = renderPreferences();
    await findTable();
    // 之後的重抓永遠不回應:畫面停在「寫入成功、重抓還沒回來」那一幀
    server.use(
      api.query("MyNotificationPreferences", async () => {
        await delay("infinite");
      }),
    );
    const toggle = screen.getByRole("switch", { name: "申請結果:Email" });

    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "儲存" }));

    await findSnackbarAlert();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "儲存" })).toBeDisabled();
    });
    expect(
      screen.getByRole("switch", { name: "申請結果:Email" }),
    ).not.toBeChecked();
  });

  it("開關改回原值:不算變動,儲存鈕停用", async () => {
    const { user } = renderPreferences();
    await findTable();
    const toggle = screen.getByRole("switch", { name: "審核逾時:站內通知" });

    await user.click(toggle);
    await user.click(toggle);

    expect(screen.getByRole("button", { name: "儲存" })).toBeDisabled();
  });
});
