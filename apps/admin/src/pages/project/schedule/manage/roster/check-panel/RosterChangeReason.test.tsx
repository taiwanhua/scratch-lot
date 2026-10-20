import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  restoreViewportAfterEach,
  setMobileViewport,
  setupFakeViewport,
} from "@/test/viewport";

import { renderSchedulePage } from "../../../schedule-test-support";

setupFakeViewport();
restoreViewportAfterEach();

const ROSTER = "/schedule/manage?tab=roster&month=2026-11";

/**
 * 已發布後的「異動原因」(SC-19;規格 14.5)與手機的 [發布] 按鈕(SC-55 / 56)。
 * 假 api 見 `test/msw/project/schedule-roster-handlers.ts`。
 */
describe("排班作業:已發布後的異動原因、手機 [發布]", () => {
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

  it("手機:[發布] 獨立成按鈕放在 [⋯] 右邊,不收進 [⋯] 選單", async () => {
    setMobileViewport();
    const { user } = renderSchedulePage({ path: ROSTER });
    const publish = await screen.findByRole("button", { name: "發布" });
    const more = screen.queryByRole("button", { name: "更多" });
    // 目前 [⋯] 裡還沒有其他按鈕(套用範本、自動排班由之後的功能追加)
    expect(more).not.toBeInTheDocument();
    await user.click(publish);
    expect(
      await screen.findByRole("dialog", { name: "不能發布" }),
    ).toBeInTheDocument();
  });
});
