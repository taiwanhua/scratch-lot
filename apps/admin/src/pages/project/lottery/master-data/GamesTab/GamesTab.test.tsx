import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import { renderMasterData } from "../master-data-test-support";

restoreViewportAfterEach();

/**
 * 遊戲列表的篩選(RW-01 / RW-01b,`components/base/FilterDrawer`):
 * 電腦是篩選列、改了立刻套用;窄螢幕是 [篩選 (N)] + 抽屜,按 [套用] 才套用(手機列表是卡片,代號與名稱在同一行)。
 */
describe("遊戲列表的篩選", () => {
  it("電腦:篩選列直接改狀態 → 立刻套用", async () => {
    const { user } = renderMasterData();
    expect(await screen.findByText("金好運")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^篩選/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "狀態" }));
    await user.click(await screen.findByRole("option", { name: "停售" }));
    expect(await screen.findByText("舊彩")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("金好運")).not.toBeInTheDocument();
    });
  });

  it("手機:[篩選 (1)] 打開抽屜;改的是草稿,關掉不套用;[套用] 才套用", async () => {
    setMobileViewport();
    const { user } = renderMasterData();
    expect(await screen.findByText(/金好運/)).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "狀態" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "篩選 (1)" }));
    const drawer = await screen.findByRole("presentation");
    await user.click(within(drawer).getByRole("combobox", { name: "狀態" }));
    await user.click(await screen.findByRole("option", { name: "停售" }));
    await user.click(within(drawer).getByRole("button", { name: "套用" }));

    expect(await screen.findByText(/舊彩/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(/金好運/)).not.toBeInTheDocument();
    });
  });

  it("手機:[清除] 把草稿改回全部,[套用] 後兩種狀態都列,按鈕沒有括號", async () => {
    setMobileViewport();
    const { user } = renderMasterData();
    await user.click(await screen.findByRole("button", { name: "篩選 (1)" }));
    const drawer = await screen.findByRole("presentation");
    await user.click(within(drawer).getByRole("button", { name: "清除" }));
    await user.click(within(drawer).getByRole("button", { name: "套用" }));
    expect(await screen.findByText(/舊彩/)).toBeInTheDocument();
    expect(screen.getByText(/金好運/)).toBeInTheDocument();
    // 抽屜關閉動畫結束、背景不再 aria-hidden 後才找得到按鈕
    expect(
      await screen.findByRole("button", { name: "篩選" }),
    ).toBeInTheDocument();
  });
});
