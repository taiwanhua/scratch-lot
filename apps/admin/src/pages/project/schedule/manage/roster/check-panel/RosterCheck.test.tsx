import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { setupFakeViewport } from "@/test/viewport";

import { renderSchedulePage } from "../../../schedule-test-support";

setupFakeViewport();

const ROSTER = "/schedule/manage?tab=roster&month=2026-11";

const scrollIntoView = jest.fn();

beforeAll(() => {
  // jsdom 沒有 scrollIntoView;[查看] 捲到格子時呼叫
  Element.prototype.scrollIntoView = scrollIntoView;
});

const openPanel = async (user: { click: (el: Element) => Promise<void> }) => {
  await user.click(
    await screen.findByRole("button", { name: "限制 1 · 提醒 6" }),
  );
  return screen.findByRole("complementary", { name: "檢核" });
};

/**
 * 排班表的檢核面板與發布(SC-18、SC-15a–d、SC-19;規格 14.5「檢核面板」「發布」):
 * 假 api 見 `test/msw/project/schedule-roster-handlers.ts`(檢核結果 `schedule-check-fixtures.ts`)。
 */
describe("排班作業:檢核面板與發布", () => {
  it("檢核按鈕「限制 1 · 提醒 6」→ 面板:限制在前、篩選、[查看] 捲到那一格;✕ 收合", async () => {
    const { user } = renderSchedulePage({ path: ROSTER });
    const panel = await openPanel(user);
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

    await user.click(within(panel).getByRole("button", { name: "限制 1" }));
    expect(within(panel).getAllByRole("listitem")).toHaveLength(1);

    scrollIntoView.mockClear();
    await user.click(
      within(panel).getByRole("button", {
        name: "查看:林美麗 本月畫休 5 天,超過上限 4 天",
      }),
    );
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });

    await user.click(within(panel).getByRole("button", { name: "關閉檢核" }));
    expect(
      screen.queryByRole("complementary", { name: "檢核" }),
    ).not.toBeInTheDocument();
  });

  it("有違反限制 → 「不能發布」:列出違反,[發布] 停用", async () => {
    const { user, rosterFake } = renderSchedulePage({ path: ROSTER });
    await user.click(await screen.findByRole("button", { name: "發布" }));
    const dialog = await screen.findByRole("dialog", { name: "不能發布" });
    expect(
      await within(dialog).findByText("有 1 項違反限制,改好才能發布。"),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(7);
    expect(within(dialog).getByRole("button", { name: "發布" })).toBeDisabled();
    expect(rosterFake.inputs.published).toEqual([]);
  });

  it("只有提醒 → 列出提醒,[仍要發布] → 已發布,[發布] 不再顯示", async () => {
    const { user, rosterFake } = renderSchedulePage({
      path: ROSTER,
      roster: { check: "reminders" },
    });
    await user.click(await screen.findByRole("button", { name: "發布" }));
    const dialog = await screen.findByRole("dialog", {
      name: "發布 11 月排班?",
    });
    expect(
      await within(dialog).findByText("有 6 項提醒,可以照樣發布。"),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "仍要發布" }));
    await waitFor(() => {
      expect(rosterFake.inputs.published).toHaveLength(1);
    });
    expect(await screen.findByText(/^已發布 · /u)).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "發布" }),
      ).not.toBeInTheDocument();
    });
  });

  it("全部符合 → 確認視窗寫會通知幾位被排到的人,[發布];檢核按鈕是灰色的勾", async () => {
    const { user } = renderSchedulePage({
      path: ROSTER,
      roster: { check: "clear" },
    });
    expect(
      await screen.findByRole("button", { name: "檢核:沒有問題" }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "發布" }));
    const dialog = await screen.findByRole("dialog", {
      name: "發布 11 月排班?",
    });
    expect(
      await within(dialog).findByText(
        "全部符合規則。發布後會通知 5 位被排到的人;之後修改要填異動原因。",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "發布" })).toBeEnabled();
  });

  it("沒有 publish 權限 → 看不到 [發布]", async () => {
    renderSchedulePage({
      path: ROSTER,
      omit: ["schedule.manage.publish"],
    });
    await screen.findByRole("button", { name: "限制 1 · 提醒 6" });
    expect(
      screen.queryByRole("button", { name: "發布" }),
    ).not.toBeInTheDocument();
  });

  it("已發布:排班對話框多「異動原因」(必填);沒選不送,選了一起送", async () => {
    const { user, rosterFake } = renderSchedulePage({
      path: ROSTER,
      roster: { isPublished: true },
    });
    expect(
      await screen.findByText("已發布 · 10/28 李店長"),
    ).toBeInTheDocument();
    const wang = await screen.findByRole("button", { name: "王小明 11/1" });
    await user.click(within(wang).getByRole("button", { name: /^早/ }));
    const dialog = await screen.findByRole("dialog", {
      name: "排班 · 王小明 11/1(日)",
    });
    const reason = within(dialog).getByRole("combobox", { name: /異動原因/ });
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(reason).toHaveAttribute("aria-invalid", "true");
    });
    await user.click(reason);
    await user.click(await screen.findByRole("option", { name: "換班" }));
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(rosterFake.inputs.entries.at(-1)?.changeReason).toEqual({
        reasonKey: "shift-swap",
      });
    });
  });

  it("已發布:移除這天所有排班的原因只填一次", async () => {
    const { user, rosterFake } = renderSchedulePage({
      path: ROSTER,
      roster: { isPublished: true },
    });
    await user.click(
      await screen.findByRole("button", { name: "11/1 的更多動作" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "移除這天所有排班" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /^移除 11\/1/u,
    });
    await user.click(
      within(dialog).getByRole("combobox", { name: /異動原因/ }),
    );
    await user.click(await screen.findByRole("option", { name: "其他" }));
    await user.click(within(dialog).getByRole("button", { name: "移除" }));
    expect(rosterFake.inputs.removedDayInputs).toEqual([]);
    await user.type(
      within(dialog).getByRole("textbox", { name: /原因說明/ }),
      "颱風停班",
    );
    await user.click(within(dialog).getByRole("button", { name: "移除" }));
    await waitFor(() => {
      expect(rosterFake.inputs.removedDayInputs.at(-1)?.changeReason).toEqual({
        reasonKey: "other",
        reasonNote: "颱風停班",
      });
    });
  });
});
