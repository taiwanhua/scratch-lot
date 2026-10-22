import { describe, expect, it } from "@jest/globals";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";

import { authWorld } from "@/test/msw/auth-handlers";
import { delegationWorld } from "@/test/msw/delegation-handlers";
import { api, server } from "@/test/msw/server";
import { renderApp } from "@/test/render";
import { findSnackbarAlert } from "@/test/snackbar";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

const DAY_MS = 86_400_000;

/**
 * 個人設定「代理人」分頁。
 * 夾具:一筆未開始(李小華 10/20–10/24,備註「出國」)、一筆已結束(陳大文 9/1–9/3);時區 Asia/Taipei。
 */
const renderDelegations = (
  options: Parameters<typeof delegationWorld>[0] = {},
  modules?: NonNullable<Parameters<typeof authWorld>[0]>["modules"],
) => {
  const world = delegationWorld(options);
  server.use(
    ...world.handlers,
    ...authWorld({
      hasRefreshCookie: true,
      ...(modules !== undefined && { modules }),
    }).handlers,
  );
  return {
    ...renderApp({ path: "/settings/personal?tab=delegations" }),
    world,
  };
};

const findTable = async () => {
  await screen.findByText("李小華");
  return screen.getByRole("table", { name: "我的代理" });
};

/** 打開日期欄的日曆選一天(MUI X 的日曆按鈕在轉場中是 pointer-events: none,以 fireEvent 點)。 */
const pickDay = async (label: string, day: string) => {
  const group = await screen.findByRole("group", { name: label });
  fireEvent.click(
    within(group.parentElement ?? document.body).getByRole("button", {
      name: /choose date/i,
    }),
  );
  fireEvent.click(await screen.findByRole("gridcell", { name: day }));
};

describe("代理人分頁", () => {
  it("清單:代理人、起(當天 00:00)、迄(結束日 23:59)、備註、狀態;已結束的沒有刪除", async () => {
    renderDelegations();

    const table = await findTable();
    const rows = within(table).getAllByRole("row");
    const upcoming = rows[1];
    const ended = rows[2];
    expect(upcoming).toHaveTextContent("李小華");
    expect(upcoming).toHaveTextContent("2026-10-20 00:00");
    expect(upcoming).toHaveTextContent("2026-10-24 23:59");
    expect(upcoming).toHaveTextContent("出國");
    expect(upcoming).toHaveTextContent("未開始");
    expect(
      within(upcoming).getByRole("button", {
        name: "刪除 李小華 的代理",
      }),
    ).toBeVisible();
    expect(ended).toHaveTextContent("已結束");
    expect(within(ended).queryByRole("button")).toBeNull();
    expect(screen.getByText("共 2 筆")).toBeVisible();
    expect(
      screen.getByText(
        "代理期間內,輪到你審核的任務改派給代理人。代理開始前已派給你的任務不會自動轉移。",
      ),
    ).toBeVisible();
  });

  it("分頁列有「偏好 | 代理人」,新增代理鈕只在代理人分頁", async () => {
    const { user } = renderDelegations();

    await findTable();
    const tabs = screen.getByRole("tablist", { name: "個人設定分頁" });
    expect(within(tabs).getByRole("tab", { name: "代理人" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: "+ 新增代理" })).toBeVisible();
    await user.click(within(tabs).getByRole("tab", { name: "偏好" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "+ 新增代理" })).toBeNull();
    });
  });

  it("角色沒有被分配任何模組的使用者:照常打開代理人分頁並可新增代理(起 = 開始日 00:00、迄 = 結束日 24:00)", async () => {
    const { user, world } = renderDelegations({}, []);

    await findTable();
    await user.click(screen.getByRole("button", { name: "+ 新增代理" }));
    const dialog = await screen.findByRole("dialog", { name: "新增代理" });
    await user.click(within(dialog).getByRole("combobox", { name: "代理人" }));
    await user.click(await screen.findByRole("option", { name: /王小明/ }));
    await pickDay("開始", "20");
    await pickDay("結束", "24");
    await user.type(
      within(dialog).getByRole("textbox", { name: "備註" }),
      "出差",
    );
    await user.click(within(dialog).getByRole("button", { name: "新增" }));

    await waitFor(() => {
      expect(world.calls.create).toHaveLength(1);
    });
    const [sent] = world.calls.create;
    expect(sent).toMatchObject({ delegateUserId: "user-wang", note: "出差" });
    const startAt = Date.parse(sent.startAt);
    const endAt = Date.parse(sent.endAt);
    // Asia/Taipei 00:00 = 前一天 16:00Z;迄 = 結束日的隔天 00:00(20 日起、24 日止 → 5 天)
    expect(new Date(startAt).getUTCHours()).toBe(16);
    expect(endAt - startAt).toBe(5 * DAY_MS);
    const alert1 = await findSnackbarAlert();
    expect(alert1.text).toBe("已新增代理");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "新增代理" })).toBeNull();
    });
    expect(await screen.findByText("王小明")).toBeVisible();
  });

  it("新增被擋(和既有代理期間重疊)→ 提示原因,彈窗留著", async () => {
    const { user } = renderDelegations({
      createRejectReason: "DELEGATION_OVERLAP",
    });

    await findTable();
    await user.click(screen.getByRole("button", { name: "+ 新增代理" }));
    const dialog = await screen.findByRole("dialog", { name: "新增代理" });
    await user.click(within(dialog).getByRole("combobox", { name: "代理人" }));
    await user.click(await screen.findByRole("option", { name: /王小明/ }));
    await pickDay("開始", "20");
    await pickDay("結束", "21");
    await user.click(within(dialog).getByRole("button", { name: "新增" }));

    const alert2 = await findSnackbarAlert();
    expect(alert2.text).toBe("和你已設定的代理期間重疊");
    expect(screen.getByRole("dialog", { name: "新增代理" })).toBeVisible();
  });

  it("代理人候選載入失敗(網路錯誤)→ 顯示載入失敗,不說成沒有權限", async () => {
    const { user } = renderDelegations();
    server.use(api.query("MyDelegateCandidates", () => HttpResponse.error()));

    await findTable();
    await user.click(screen.getByRole("button", { name: "+ 新增代理" }));
    const dialog = await screen.findByRole("dialog", { name: "新增代理" });
    await user.click(within(dialog).getByRole("combobox", { name: "代理人" }));

    expect(
      await screen.findByText("人員清單載入失敗,請稍後再試"),
    ).toBeVisible();
    expect(screen.queryByText("你沒有檢視使用者清單的權限")).toBeNull();
  });

  it("刪除未結束的代理:確認後從清單拿掉", async () => {
    const { user, world } = renderDelegations();

    await findTable();
    await user.click(
      screen.getByRole("button", { name: "刪除 李小華 的代理" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "刪除 李小華 的代理?",
    });
    await user.click(within(dialog).getByRole("button", { name: "刪除" }));

    await waitFor(() => {
      expect(world.calls.delete).toEqual(["delegation-1"]);
    });
    const alert3 = await findSnackbarAlert();
    expect(alert3.text).toBe("已刪除代理");
    await waitFor(() => {
      expect(screen.queryByText("李小華")).toBeNull();
    });
  });
});

describe("代理人分頁:窄螢幕(STYLE-11)", () => {
  restoreViewportAfterEach();

  it("手機寬:表格最小寬 960,窄過它由表格容器橫向捲動,不把代理人、日期擠成一字一行", async () => {
    setMobileViewport();
    renderDelegations();

    const table = await findTable();
    expect(globalThis.getComputedStyle(table).minWidth).toBe("960px");
    const container = table.closest<HTMLElement>(".MuiTableContainer-root");
    if (container === null) {
      throw new Error("找不到表格容器");
    }
    const style = globalThis.getComputedStyle(container);
    expect([style.overflow, style.overflowX]).toContain("auto");
  });
});
