import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { FIELD_MANAGER_PERMISSIONS } from "@/components/base/FieldManager/field-manager-permissions";
import {
  demoCategoryFieldsAsRoot,
  fieldsByCategory,
} from "@/test/msw/field-fixtures";
import { renderApp } from "@/test/render";

import {
  findRowOf,
  renderColorPage,
  selectCategory,
} from "./field-manager-color-test-support";

/**
 * 欄位管理的客製替換頁(選項多一欄「顏色」,規格 18.5;Figma BS-13 289:87534)。
 * 走正式的頁面登記(`app/project/page-replacements.ts`)、路由與殼;登記本身與解除後回到底座頁見
 * `app/project/page-replacements.test.ts`、`app/project/FieldManagerReplacementRemoved.test.tsx`。
 */
describe("欄位管理:選項顏色(客製替換頁)", () => {
  it("「顏色」欄接在「顯示名稱」後面;租戶看得到全域選項的顏色,但改不動", async () => {
    const { user } = renderColorPage({
      colors: {
        colorsByCategory: {
          "demo-category": [
            { fieldId: "f-staple", value: "staple", paletteKey: "green" },
          ],
        },
      },
    });
    await selectCategory(user, "示範分類");

    const headers = within(
      screen.getByRole("region", { name: "欄位選項" }),
    ).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent).slice(0, 3)).toEqual([
      "顯示名稱",
      "顏色",
      "值(value)",
    ]);

    const staple = await findRowOf("主食");
    expect(await within(staple).findByText("綠")).toBeInTheDocument();
    expect(within(staple).queryByRole("combobox")).not.toBeInTheDocument();
    // 沒設顏色的全域選項:顯示「—」
    expect(within(await findRowOf("小菜")).getByText("—")).toBeInTheDocument();
  });

  it("本組織加的選項可以從色票選;送出後重查,格子顯示新的顏色", async () => {
    const { user, colorFake } = renderColorPage();
    await selectCategory(user, "示範分類");

    const fried = await findRowOf("炸物");
    await user.click(
      within(fried).getByRole("combobox", { name: "「炸物」的顏色" }),
    );
    await user.click(await screen.findByRole("option", { name: "橘" }));

    expect(colorFake.inputs).toEqual([
      { fieldId: "f-fried", paletteKey: "orange" },
    ]);
    await waitFor(() => {
      expect(
        within(
          within(fried).getByRole("combobox", { name: "「炸物」的顏色" }),
        ).getByText("橘"),
      ).toBeInTheDocument();
    });
    expect(await screen.findByText("已更新顏色")).toBeInTheDocument();
  });

  it("上層 / 下層組織加的選項:看得到,改不動(只顯示標籤或「—」)", async () => {
    const { user } = renderColorPage();
    await selectCategory(user, "示範分類");
    for (const label of ["甜點", "湯品"]) {
      const row = await findRowOf(label);
      expect(within(row).queryByRole("combobox")).not.toBeInTheDocument();
      expect(within(row).getByText("—")).toBeInTheDocument();
    }
  });

  it("沒有 edit 權限:自己這一層的選項也只顯示,不出現下拉", async () => {
    const { user } = renderColorPage({
      permissions: [FIELD_MANAGER_PERMISSIONS.view],
      colors: {
        colorsByCategory: {
          "demo-category": [
            { fieldId: "f-fried", value: "fried", paletteKey: "red" },
          ],
        },
      },
    });
    await selectCategory(user, "示範分類");
    const fried = await findRowOf("炸物");
    expect(await within(fried).findByText("紅")).toBeInTheDocument();
    expect(within(fried).queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("root 為全域選項選色票,儲存後重新整理仍在", async () => {
    const { user, unmount } = renderColorPage({
      world: {
        fieldsByCategory: {
          ...fieldsByCategory,
          "cat-demo": demoCategoryFieldsAsRoot,
        },
      },
    });
    await selectCategory(user, "示範分類");
    await user.click(
      within(await findRowOf("主食")).getByRole("combobox", {
        name: "「主食」的顏色",
      }),
    );
    await user.click(await screen.findByRole("option", { name: "青" }));
    await screen.findByText("已更新顏色");

    // 重新整理:整個 app 重新掛載(同一個假伺服器,資料留著)
    unmount();
    const reloaded = renderApp({ path: "/system/field-manager" });
    await selectCategory(reloaded.user, "示範分類");
    const staple = await findRowOf("主食");
    await waitFor(() => {
      expect(
        within(
          within(staple).getByRole("combobox", { name: "「主食」的顏色" }),
        ).getByText("青"),
      ).toBeInTheDocument();
    });
  });
});
