import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  restoreViewportAfterEach,
  setMobileViewport,
  setupFakeViewport,
} from "@/test/viewport";

import { renderSchedulePage } from "../../../schedule-test-support";
import {
  fastUser,
  findButton,
  findDialog,
  findLabelled,
  findMenuItem,
  findOption,
} from "../roster-test-queries";

setupFakeViewport();

/** 整頁測試:事件之間不讓出計時器(`fastUser`);查詢見 `roster-test-queries.ts`。 */
const renderRoster = (options: Parameters<typeof renderSchedulePage>[0]) => ({
  ...renderSchedulePage(options),
  user: fastUser(),
});
restoreViewportAfterEach();

const ROSTER = "/schedule/manage?tab=roster&month=2026-11";

/**
 * 已發布後的「異動原因」(SC-19;規格 14.5)與手機的 [發布] 按鈕(SC-55 / 56)。
 * 假 api 見 `test/msw/project/schedule-roster-handlers.ts`。
 */
describe("排班作業:已發布後的異動原因、手機 [發布]", () => {
  it("已發布:排班對話框多「異動原因」(必填);沒選不送,選了一起送", async () => {
    const { user, rosterFake } = renderRoster({
      path: ROSTER,
      roster: { isPublished: true },
    });
    expect(
      await screen.findByText("已發布 · 10/28 李店長"),
    ).toBeInTheDocument();
    const wang = await findLabelled("王小明 11/1");
    await user.click(within(wang).getByRole("button", { name: /^早/ }));
    const dialog = await findDialog("排班 · 王小明 11/1(日)");
    const reason = within(dialog).getByRole("combobox", { name: /異動原因/ });
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(reason).toHaveAttribute("aria-invalid", "true");
    });
    await user.click(reason);
    await user.click(await findOption("換班"));
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(rosterFake.inputs.entries.at(-1)?.changeReason).toEqual({
        reasonKey: "shift-swap",
      });
    });
  });

  it("已發布:移除這天所有排班的原因只填一次", async () => {
    const { user, rosterFake } = renderRoster({
      path: ROSTER,
      roster: { isPublished: true },
    });
    await user.click(await findLabelled("11/1 的更多動作"));
    await user.click(await findMenuItem("移除這天所有排班"));
    const dialog = await findDialog(/^移除 11\/1/u);
    await user.click(
      within(dialog).getByRole("combobox", { name: /異動原因/ }),
    );
    await user.click(await findOption("其他"));
    await user.click(within(dialog).getByRole("button", { name: "移除" }));
    expect(rosterFake.inputs.removedDayInputs).toEqual([]);
    await user.click(within(dialog).getByRole("textbox", { name: /原因說明/ }));
    await user.paste("颱風停班");
    await user.click(within(dialog).getByRole("button", { name: "移除" }));
    await waitFor(() => {
      expect(rosterFake.inputs.removedDayInputs.at(-1)?.changeReason).toEqual({
        reasonKey: "other",
        reasonNote: "颱風停班",
      });
    });
  });

  it("手機:[發布] 獨立成按鈕放在 [⋯] 右邊;[⋯] 裡是 [套用範本] [自動排班],選單關掉後對話框照樣開著", async () => {
    setMobileViewport();
    const { user } = renderRoster({ path: ROSTER });
    const publish = await findButton("發布");
    await user.click(await findLabelled("更多"));
    expect(await findMenuItem("套用範本")).toBeInTheDocument();
    expect(await findMenuItem("自動排班")).toBeInTheDocument();
    expect(
      [...document.querySelectorAll('[role="menuitem"]')].map(
        (item) => item.textContent,
      ),
    ).not.toContain("發布");
    await user.click(await findMenuItem("自動排班"));
    expect(await findDialog("自動排班")).toBeInTheDocument();
    await user.click(
      within(await findDialog("自動排班")).getByRole("button", {
        name: "取消",
      }),
    );
    await user.click(publish);
    expect(await findDialog("不能發布")).toBeInTheDocument();
  });
});
