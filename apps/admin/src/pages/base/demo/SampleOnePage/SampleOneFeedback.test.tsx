import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { findSnackbarAlert, querySnackbar } from "@/test/snackbar";

import { findRowOf, renderSampleOne } from "../demo-sample-one-test-support";

/**
 * 操作結果提示:示範模組共版型的成功與失敗各一案(對照組 `demoSampleTwo`
 * 走同一份共版型與同一支 hook,文案各自一份)。
 * 「一律跳一則」的規則在 `docs/standards/react/data-fetching.md` DATA-06。
 */
describe("示範模組1 的操作結果提示", () => {
  it("切換啟用成功 → 跳「已停用這一筆資料。」(依這次切成什麼決定說法)", async () => {
    const { user: actor, fake } = renderSampleOne();
    const row = await findRowOf("醬燒雞腿排");
    expect(querySnackbar()).toBeNull();

    await actor.click(
      within(row).getByRole("switch", { name: "切換「醬燒雞腿排」的啟用狀態" }),
    );

    await waitFor(() => {
      expect(fake.inputs.setDemoItemOneEnabled).toEqual([
        { id: "demo-1", enabled: false },
      ]);
    });
    expect(await findSnackbarAlert()).toEqual({
      text: "已停用這一筆資料。",
      severity: "success",
    });
  });

  it("切換啟用失敗 → 跳失敗提示,列表上那一條說明仍然留著", async () => {
    const { user: actor } = renderSampleOne({
      world: { failures: { SetDemoItemOneEnabled: { code: "FORBIDDEN" } } },
    });
    const row = await findRowOf("醬燒雞腿排");

    await actor.click(
      within(row).getByRole("switch", { name: "切換「醬燒雞腿排」的啟用狀態" }),
    );

    const message = "你沒有執行這個動作的權限。";
    expect(await findSnackbarAlert()).toEqual({
      text: message,
      severity: "error",
    });
    // Snackbar 不取代列表上的錯誤顯示:兩者並存(DATA-06)
    expect(screen.getAllByText(message)).toHaveLength(2);
  });
});
