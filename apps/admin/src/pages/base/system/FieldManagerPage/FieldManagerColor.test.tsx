import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  demoCategoryFields,
  demoCategoryFieldsAsRoot,
  fieldsByCategory,
} from "@/test/msw/field-fixtures";
import { renderApp } from "@/test/render";

import {
  VIEW_ONLY,
  findRowOf,
  optionsPanel,
  renderPage,
  selectCategory,
} from "./field-manager-test-support";

/** 示範分類的合併清單,指定幾筆的顏色。 */
const demoWithColors = (colors: Record<string, string>) => ({
  ...fieldsByCategory,
  "cat-demo": demoCategoryFields.map((field) => ({
    ...field,
    color: colors[field.id] ?? null,
  })),
});

/**
 * 欄位管理:選項的「顏色」欄(Figma BS-13 289:87534;色票面板 289:88006)。
 * 誰能改 = api 的 `canToggleEnabled` ∩ `system.field-manager.edit`;只能從十組色票選。
 */
describe("欄位管理:選項顏色", () => {
  it("「顏色」欄接在「顯示名稱」後面;租戶看得到全域選項的顏色,但改不動", async () => {
    const { user } = renderPage({
      world: { fieldsByCategory: demoWithColors({ "f-staple": "green" }) },
    });
    await selectCategory(user, "示範分類");

    const headers = within(optionsPanel()).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent).slice(0, 3)).toEqual([
      "顯示名稱",
      "顏色",
      "值(value)",
    ]);

    const staple = await findRowOf("主食");
    expect(within(staple).getByText("綠")).toBeInTheDocument();
    expect(
      within(staple).queryByRole("button", { name: /的顏色/ }),
    ).not.toBeInTheDocument();
    // 沒設顏色、改不動:顯示「不設定」文字(Figma 289:87612)
    expect(
      within(await findRowOf("小菜")).getByText("不設定"),
    ).toBeInTheDocument();
  });

  it("本組織加的選項:點格子開色票面板選;送出後重查,格子顯示新的顏色", async () => {
    const { user, fake } = renderPage();
    await selectCategory(user, "示範分類");

    const fried = await findRowOf("炸物");
    await user.click(
      within(fried).getByRole("button", { name: "「炸物」的顏色" }),
    );
    await user.click(
      within(await screen.findByRole("dialog", { name: "選擇顏色" })).getByRole(
        "button",
        { name: "橘" },
      ),
    );

    expect(fake.inputs.setFieldColor).toEqual([
      { id: "f-fried", color: "orange" },
    ]);
    await waitFor(() => {
      expect(
        within(
          within(fried).getByRole("button", { name: "「炸物」的顏色" }),
        ).getByText("橘"),
      ).toBeInTheDocument();
    });
    expect(await screen.findByText("已更新顏色。")).toBeInTheDocument();
  });

  it("點「不設定」清掉顏色(送 null)", async () => {
    const { user, fake } = renderPage({
      world: { fieldsByCategory: demoWithColors({ "f-fried": "red" }) },
    });
    await selectCategory(user, "示範分類");
    await user.click(
      within(await findRowOf("炸物")).getByRole("button", {
        name: "「炸物」的顏色",
      }),
    );
    await user.click(
      within(await screen.findByRole("dialog", { name: "選擇顏色" })).getByRole(
        "button",
        { name: "不設定" },
      ),
    );

    expect(fake.inputs.setFieldColor).toEqual([{ id: "f-fried", color: null }]);
  });

  it("上層 / 下層組織加的選項:看得到,改不動(只顯示「不設定」)", async () => {
    const { user } = renderPage();
    await selectCategory(user, "示範分類");
    for (const label of ["甜點", "湯品"]) {
      const row = await findRowOf(label);
      expect(
        within(row).queryByRole("button", { name: /的顏色/ }),
      ).not.toBeInTheDocument();
      expect(within(row).getByText("不設定")).toBeInTheDocument();
    }
  });

  it("沒有 edit 權限:自己這一層的選項也只顯示,標籤不能點", async () => {
    const { user } = renderPage({
      permissions: VIEW_ONLY,
      world: { fieldsByCategory: demoWithColors({ "f-fried": "red" }) },
    });
    await selectCategory(user, "示範分類");
    const fried = await findRowOf("炸物");
    expect(within(fried).getByText("紅")).toBeInTheDocument();
    expect(
      within(fried).queryByRole("button", { name: /的顏色/ }),
    ).not.toBeInTheDocument();
  });

  it("儲存失敗:頁面提示原因,格子維持原本的顏色", async () => {
    const { user } = renderPage({
      world: { failures: { SetFieldColor: "NOT_FOUND" } },
    });
    await selectCategory(user, "示範分類");
    const fried = await findRowOf("炸物");
    await user.click(
      within(fried).getByRole("button", { name: "「炸物」的顏色" }),
    );
    await user.click(
      within(await screen.findByRole("dialog", { name: "選擇顏色" })).getByRole(
        "button",
        { name: "青" },
      ),
    );

    expect(
      await screen.findAllByText(
        "找不到這個類別或選項,可能已被移除,請重新整理。",
      ),
    ).not.toHaveLength(0);
    expect(
      within(fried).getByRole("button", { name: "「炸物」的顏色" }),
    ).toHaveTextContent("不設定");
  });

  it("root 為全域選項選色票,儲存後重新整理仍在", async () => {
    const { user, unmount } = renderPage({
      world: {
        fieldsByCategory: {
          ...fieldsByCategory,
          "cat-demo": demoCategoryFieldsAsRoot,
        },
      },
    });
    await selectCategory(user, "示範分類");
    await user.click(
      within(await findRowOf("主食")).getByRole("button", {
        name: "「主食」的顏色",
      }),
    );
    await user.click(
      within(await screen.findByRole("dialog", { name: "選擇顏色" })).getByRole(
        "button",
        { name: "青" },
      ),
    );
    await screen.findByText("已更新顏色。");

    // 重新整理:整個 app 重新掛載(同一個假伺服器,資料留著)
    unmount();
    const reloaded = renderApp({ path: "/system/field-manager" });
    await selectCategory(reloaded.user, "示範分類");
    const staple = await findRowOf("主食");
    await waitFor(() => {
      expect(
        within(
          within(staple).getByRole("button", { name: "「主食」的顏色" }),
        ).getByText("青"),
      ).toBeInTheDocument();
    });
  });
});
