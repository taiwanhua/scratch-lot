import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import { delay } from "msw";

import { graphqlError } from "@/test/msw/auth-handlers";

import {
  field,
  fieldRoot,
  node,
  openPanel,
  renderSelect,
  rowOf,
  valueText,
} from "./org-tree-select-test-support";

/** 已選值與樹對不上、查詢狀態、停用組織這幾條邊界(情境表以外,review 補的) */
describe("OrgTreeSelect 邊界", () => {
  it("已選但不在可見範圍內(api 不回):灰標籤「不在你的管理範圍內」可以取消,計入上限", async () => {
    const { user } = renderSelect({
      isMultiSelect: true,
      maxCount: 2,
      initial: ["org-gone", "org-a"],
    });

    const outOfScope =
      await within(fieldRoot()).findByText("不在你的管理範圍內");
    expect(within(fieldRoot()).getByText("A 店")).toBeVisible();

    await openPanel(user);
    expect(await screen.findByText("最多選 2 個")).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("tree")).toBeNull();
    });

    const remove = outOfScope
      .closest(".MuiChip-root")
      ?.querySelector(".MuiChip-deleteIcon");
    if (remove === null || remove === undefined) {
      throw new Error("範圍外的標籤沒有取消鈕");
    }
    await user.click(remove);
    expect(valueText()).toBe("org-a");
  });

  it("單選的值不在可見範圍內:欄位顯示「不在你的管理範圍內」", async () => {
    renderSelect({ initial: ["org-gone"] });

    await waitFor(() => {
      expect(field()).toHaveValue("不在你的管理範圍內");
    });
  });

  it("組織樹還在載入:已選值先不顯示,不會閃一下「不在你的管理範圍內」", async () => {
    renderSelect({ initial: ["org-a"] }, async () => {
      await delay("infinite");
    });

    // 等 app 起來(欄位出現)後,值仍是空的
    await screen.findByRole("combobox", { name: "組織" });
    expect(field()).toHaveValue("");
  });

  it("組織樹查詢失敗:面板顯示錯誤,不是「沒有可選的組織」", async () => {
    const { user } = renderSelect({}, () => graphqlError("FORBIDDEN"));
    await openPanel(user);

    expect(await screen.findByText(/組織清單載入失敗/)).toBeVisible();
    expect(screen.queryByText("沒有可選的組織")).toBeNull();
  });

  it("停用的組織照常可選,樹上帶「已停用」標籤", async () => {
    const tree = [
      node("org-co", "示範公司", null, {
        children: [node("org-closed", "歇業店", "org-co", { enabled: false })],
      }),
    ];
    const { user } = renderSelect({}, tree);
    await openPanel(user);

    expect(await within(rowOf("歇業店")).findByText("已停用")).toBeVisible();
    await user.click(within(rowOf("歇業店")).getByText("歇業店"));

    expect(valueText()).toBe("org-closed");
    expect(screen.queryByRole("tree")).toBeNull();
  });

  it("單選:再點一次已選的節點 → 值不變,面板照樣關閉", async () => {
    const { user } = renderSelect({ initial: ["org-a"] });
    await openPanel(user);

    await user.click(within(rowOf("A 店")).getByText("A 店"));

    expect(valueText()).toBe("org-a");
    expect(screen.queryByRole("tree")).toBeNull();
  });
});
