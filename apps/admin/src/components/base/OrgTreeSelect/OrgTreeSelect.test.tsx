import { describe, expect, it } from "@jest/globals";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { SelectField } from "@repo/ui/select-field";

import { tenantTree } from "@/test/msw/org-fixtures";
import type { TestOrgNode } from "@/test/msw/org-manager-handlers";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import {
  checkboxOf,
  field,
  fieldRoot,
  node,
  openPanel,
  renderSelect,
  rowOf,
  treeLabels,
  valueText,
} from "./org-tree-select-test-support";

restoreViewportAfterEach();

/** 欄位右側的下拉箭頭(MUI 圖示自帶 `data-testid`) */
const arrow = (): SVGElement => {
  const icon = fieldRoot().querySelector<SVGElement>(
    "[data-testid=ArrowDropDownIcon]",
  );
  if (icon === null) {
    throw new Error("找不到下拉箭頭");
  }
  return icon;
};

describe("OrgTreeSelect", () => {
  it("點欄位:打開欄位下方的浮動面板,搜尋框取得焦點", async () => {
    const { user } = renderSelect();
    const combobox = field();
    expect(combobox).toHaveAttribute("aria-expanded", "false");
    const search = await openPanel(user);

    await waitFor(() => {
      expect(search).toHaveFocus();
    });
    expect(await screen.findByRole("tree", { name: "組織" })).toBeVisible();
    expect(combobox).toHaveAttribute("aria-expanded", "true");
    // 浮動面板不是全螢幕對話框,沒有 [確定]
    expect(screen.queryByRole("button", { name: "確定" })).toBeNull();
  });

  it("手機寬:點欄位改開全螢幕對話框(標題 + 搜尋 + 樹 + [確定]),搜尋框取得焦點", async () => {
    setMobileViewport();
    const { user } = renderSelect();
    const search = await openPanel(user);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("組織")).toBeVisible();
    await waitFor(() => {
      expect(search).toHaveFocus();
    });
    expect(await within(dialog).findByRole("tree")).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "確定" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("輸入關鍵字:樹留下命中的節點與它的祖先、子樹,其餘隱藏", async () => {
    const { user } = renderSelect();
    const search = await openPanel(user);
    await screen.findByText("A 店");

    await user.type(search, "北區");

    await waitFor(() => {
      expect(treeLabels()).toEqual(["示範公司", "北區", "A 店", "B 店"]);
    });
  });

  it("單選:點一個節點 → 選定並關閉面板,欄位顯示組織名稱", async () => {
    const { user } = renderSelect();
    await openPanel(user);

    await user.click(await screen.findByText("B 店"));

    expect(valueText()).toBe("org-b");
    expect(screen.queryByRole("tree")).toBeNull();
    expect(field()).toHaveValue("B 店");
    expect(field()).toHaveAttribute("aria-expanded", "false");
  });

  it("多選:勾節點 → 面板不關,欄位以標籤列出已選組織", async () => {
    const { user } = renderSelect({ isMultiSelect: true });
    await openPanel(user);
    await screen.findByText("A 店");

    fireEvent.click(checkboxOf("A 店"));
    fireEvent.click(checkboxOf("C 店"));

    expect(valueText()).toBe("org-a,org-c");
    expect(screen.getByRole("tree")).toBeVisible();
    expect(within(fieldRoot()).getByText("A 店")).toBeVisible();
    expect(within(fieldRoot()).getByText("C 店")).toBeVisible();
  });

  it("多選:已選數量 = 上限 → 其餘未勾的節點停用,面板底部顯示「最多選 N 個」", async () => {
    const { user } = renderSelect({ isMultiSelect: true, maxCount: 2 });
    await openPanel(user);
    await screen.findByText("A 店");

    fireEvent.click(checkboxOf("A 店"));
    expect(screen.getByText("已選 1 / 上限 2")).toBeVisible();
    fireEvent.click(checkboxOf("B 店"));

    expect(screen.getByText("最多選 2 個")).toBeVisible();
    expect(checkboxOf("C 店")).toBeDisabled();
    expect(checkboxOf("南區")).toBeDisabled();
    // 已勾的照常可以取消
    expect(checkboxOf("A 店")).toBeEnabled();

    fireEvent.click(checkboxOf("C 店"));
    expect(valueText()).toBe("org-a,org-b");
  });

  it("點停用節點(範圍外或 disabledReasons):不能選;節點右側有原因,滑過顯示原因", async () => {
    const tree: TestOrgNode[] = [
      node("org-co", "示範公司", null, {
        children: [
          node("org-a", "A 店", "org-co"),
          // 現況 api 不回範圍外的組織(恆為 false);這裡刻意標 true,要驗相容路徑仍停用並有原因
          node("org-x", "X 店", "org-co", { outOfScope: true }),
        ],
      }),
    ];
    const { user } = renderSelect(
      { disabledReasons: { "org-a": "已由 王小明 對應" } },
      tree,
    );
    await openPanel(user);

    const reason = await within(rowOf("A 店")).findByText("已由 王小明 對應");
    await user.click(within(rowOf("A 店")).getByText("A 店"));
    expect(valueText()).toBe("");
    expect(screen.getByRole("tree")).toBeVisible();

    await user.hover(reason);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "已由 王小明 對應",
    );
    await user.unhover(reason);

    await user.click(within(rowOf("X 店")).getByText("X 店"));
    expect(valueText()).toBe("");
    await user.hover(within(rowOf("X 店")).getByText("不在你的管理範圍內"));
    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "不在你的管理範圍內",
      );
    });
  });

  it("已選的組織之後變成停用:標籤仍顯示、可以取消,樹上不能再勾回", async () => {
    const { user } = renderSelect({
      isMultiSelect: true,
      initial: ["org-a"],
      disabledReasons: { "org-a": "已由 王小明 對應" },
    });
    const tagText = await within(fieldRoot()).findByText("A 店");
    const remove = tagText
      .closest(".MuiChip-root")
      ?.querySelector(".MuiChip-deleteIcon");
    if (remove === null || remove === undefined) {
      throw new Error("標籤沒有取消鈕");
    }

    await user.click(remove);
    expect(valueText()).toBe("");
    // × 只取消,不會順手打開面板
    expect(screen.queryByRole("tree")).toBeNull();

    await openPanel(user);
    await screen.findByText("A 店");
    expect(checkboxOf("A 店")).toBeDisabled();
    fireEvent.click(checkboxOf("A 店"));
    expect(valueText()).toBe("");
  });

  it("可見範圍內沒有組織:面板顯示空狀態「沒有可選的組織」", async () => {
    const { user } = renderSelect({}, []);
    await openPanel(user);

    expect(await screen.findByText("沒有可選的組織")).toBeVisible();
    expect(screen.queryByRole("tree")).toBeNull();
  });

  it("只列操作者可見範圍內的組織:租戶視角看不到平台根組織與其他租戶", async () => {
    const { user } = renderSelect({}, tenantTree);
    await openPanel(user);

    await screen.findByText("租戶 A");
    expect(treeLabels()).toEqual([
      "租戶 A",
      "A-1 內容組",
      "A-1-1 編輯組",
      // 停用的分店照常列出,名稱後帶「已停用」標籤
      "A-2 台北分店已停用",
      "A-2-1 門市櫃台已停用",
    ]);
    const tree = screen.getByRole("tree");
    expect(within(tree).queryByText("平台根組織")).toBeNull();
    expect(within(tree).queryByText("租戶 B")).toBeNull();
  });
  it('高度跟 TextField 同一組 size:不給是 medium,size="small" 單選、多選都是 small,外框只有一層 InputBase', () => {
    const { unmount } = renderSelect();
    expect(fieldRoot()).not.toHaveClass("MuiInputBase-sizeSmall");
    unmount();

    const single = renderSelect({ size: "small" });
    expect(fieldRoot()).toHaveClass("MuiInputBase-sizeSmall");
    single.unmount();

    renderSelect({ size: "small", isMultiSelect: true });
    expect(fieldRoot()).toHaveClass("MuiInputBase-sizeSmall");
    // 欄位就是一個 TextField:外框裡不再套第二層 InputBase(多一層就多一份上下內距)
    expect(fieldRoot().querySelectorAll(".MuiInputBase-root")).toHaveLength(0);
  });
  it("下拉箭頭同 SelectField:同一個實心三角形,打開時轉 180°", async () => {
    const select = render(
      <SelectField
        label="對照"
        value="a"
        options={[{ value: "a", label: "A" }]}
        onChange={() => {
          // 只比對箭頭外觀
        }}
      />,
    );
    const selectArrowPath = select.container
      .querySelector(".MuiSelect-icon path")
      ?.getAttribute("d");
    select.unmount();

    const { user } = renderSelect();
    expect(arrow().querySelector("path")?.getAttribute("d")).toBe(
      selectArrowPath,
    );
    expect(getComputedStyle(arrow()).transform).not.toBe("rotate(180deg)");

    await openPanel(user);
    expect(getComputedStyle(arrow()).transform).toBe("rotate(180deg)");
  });
});
