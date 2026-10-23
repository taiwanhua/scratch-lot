import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { useSideNavStore } from "@/stores/base/useSideNavStore";
import { setupFakeViewport } from "@/test/viewport";

import { renderSchedulePage } from "../../../schedule-test-support";
import {
  fastUser,
  findButton,
  findDialog,
  findLabelled,
  queryButton,
} from "../roster-test-queries";
import { NAV_COLLAPSED_BY_CHECK_KEY } from "./side-nav-mark";

setupFakeViewport();

/** 整頁測試:事件之間不讓出計時器(`fastUser`);查詢見 `roster-test-queries.ts`。 */
const renderRoster = (options: Parameters<typeof renderSchedulePage>[0]) => ({
  ...renderSchedulePage(options),
  user: fastUser(),
});

const ROSTER = "/schedule/manage?tab=roster&month=2026-11";

const animate = jest.fn();

beforeAll(() => {
  // jsdom 沒有 Element.animate;[查看] 捲到格子後在格子上閃爍
  Element.prototype.animate = animate as unknown as Element["animate"];
});

const openPanel = async (user: { click: (el: Element) => Promise<void> }) => {
  await user.click(await findButton("限制 1 · 提醒 6"));
  return findLabelled("檢核");
};

/**
 * 排班表的檢核面板與發布(SC-18、SC-15a–d、SC-19;規格 14.5「檢核面板」「發布」):
 * 已發布後的異動原因與手機 [發布] 在 `RosterChangeReason.test.tsx`(拆檔讓 CI 平行跑)。
 * 假 api 見 `test/msw/project/schedule-roster-handlers.ts`(檢核結果 `schedule-check-fixtures.ts`)。
 */
describe("排班作業:檢核面板與發布", () => {
  it("檢核按鈕「限制 1 · 提醒 6」→ 面板:限制在前、篩選、[查看] 捲到那一格;✕ 收合", async () => {
    useSideNavStore.setState({ isCollapsed: false });
    const { user } = renderRoster({ path: ROSTER });
    const panel = await openPanel(user);
    // 面板打開:側欄收成圖示列,記下是面板收的(重新整理的還原見 side-nav-mark.test.ts)
    expect(useSideNavStore.getState().isCollapsed).toBe(true);
    expect(sessionStorage.getItem(NAV_COLLAPSED_BY_CHECK_KEY)).toBe("1");
    const items = within(panel).getAllByRole("listitem");
    expect(items).toHaveLength(7);
    expect(items[0]).toHaveTextContent(
      "限制林美麗 本月畫休 5 天,超過上限 4 天",
    );
    expect(
      within(panel).getByText(
        "人力不足:11/1 晚班 店內櫃台 14:30–22:00 缺 1 人(協同)(可排 1 人)",
      ),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(
        "人力不足:11/4 早班 店內櫃台 08:30–14:30 缺 1 人(協同):沒有可排的人(2 人畫休、1 人時段不可排、2 人已排其他班)",
      ),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(
        "畫休日有排班:陳大文 11/6 14:00–22:00(排於其他分店)",
      ),
    ).toBeInTheDocument();
    // 期間是半開區間 `[起 00:00, 迄隔天 00:00)`:顯示的迄日 = `to` 的前一天
    expect(
      within(panel).getByText(/陳大文 11\/6–11\/12 連續上班 7 天/),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(/李小華 11\/4 22:00 下班到 11\/5 08:30 上班/),
    ).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "限制 1" }));
    expect(within(panel).getAllByRole("listitem")).toHaveLength(1);

    animate.mockClear();
    await user.click(
      within(panel).getByRole("button", {
        name: "查看:林美麗 本月畫休 5 天,超過上限 4 天",
      }),
    );
    // 捲到林美麗 11/1 那一格並閃爍
    await waitFor(() => {
      expect(animate).toHaveBeenCalled();
    });
    expect((animate.mock.contexts[0] as HTMLElement).dataset.rosterCell).toBe(
      "u-lin|2026-11-01",
    );

    await user.click(within(panel).getByRole("button", { name: "關閉檢核" }));
    expect(screen.queryByLabelText("檢核")).not.toBeInTheDocument();
    // 關上:展開回去、清掉記號
    expect(useSideNavStore.getState().isCollapsed).toBe(false);
    expect(sessionStorage.getItem(NAV_COLLAPSED_BY_CHECK_KEY)).toBeNull();
  });

  it("有違反限制 → 「不能發布」:列出違反,[發布] 停用", async () => {
    const { user, rosterFake } = renderRoster({ path: ROSTER });
    await user.click(await findButton("發布"));
    const dialog = await findDialog("不能發布");
    expect(
      await within(dialog).findByText("有 1 項違反限制,改好才能發布。"),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(7);
    expect(within(dialog).getByRole("button", { name: "發布" })).toBeDisabled();
    expect(rosterFake.inputs.published).toEqual([]);
  });

  it("只有提醒 → 列出提醒,[仍要發布] → 已發布,[發布] 不再顯示", async () => {
    const { user, rosterFake } = renderRoster({
      path: ROSTER,
      roster: { check: "reminders" },
    });
    await user.click(await findButton("發布"));
    const dialog = await findDialog("發布 11 月排班?");
    expect(
      await within(dialog).findByText("有 6 項提醒,可以照樣發布。"),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "仍要發布" }));
    await waitFor(() => {
      expect(rosterFake.inputs.published).toHaveLength(1);
    });
    expect(await screen.findByText(/^已發布 · /u)).toBeInTheDocument();
    await waitFor(() => {
      expect(queryButton("發布")).not.toBeInTheDocument();
    });
  });

  it("全部符合 → 確認視窗寫會通知幾位被排到的人,[發布];檢核按鈕是灰色的勾", async () => {
    const { user } = renderRoster({
      path: ROSTER,
      roster: { check: "clear" },
    });
    expect(await findLabelled("檢核:沒有問題")).toBeInTheDocument();
    await user.click(await findButton("發布"));
    const dialog = await findDialog("發布 11 月排班?");
    expect(
      await within(dialog).findByText(
        "全部符合規則。發布後會通知 5 位被排到的人;之後修改要填異動原因。",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "發布" })).toBeEnabled();
  });

  it("沒有 publish 權限 → 看不到 [發布]", async () => {
    renderRoster({
      path: ROSTER,
      omit: ["schedule.manage.publish"],
    });
    await findButton("限制 1 · 提醒 6");
    expect(queryButton("發布")).not.toBeInTheDocument();
  });
});
