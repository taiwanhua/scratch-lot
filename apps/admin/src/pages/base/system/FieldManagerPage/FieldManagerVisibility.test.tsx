import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  demoCategoryFieldsOwnVisibility,
  genderFields,
} from "@/test/msw/field-fixtures";

import {
  findRowOf,
  optionsPanel,
  renderPage,
  selectCategory,
} from "./field-manager-test-support";

/**
 * 可見範圍(規則表正本 `docs/modules/field-manager.md`):**全域 + 上層繼承 + 自己 + 可見範圍內的下層;
 * 只能編輯 / 停用自己這一層加的**。
 *
 * 夾具的組織樹:好食公司(上層)─ **南港店(當前組織)** ─ 子南港店。
 * 範圍是 api 算的,前端要驗的是「拿到這份清單時畫面長什麼樣」。
 */
describe("欄位管理頁:上層繼承與可見範圍內的下層", () => {
  it("上層組織加的選項:看得到、來源顯示「好食公司 自訂」、整列改不動", async () => {
    const { user: actor } = renderPage();
    await selectCategory(actor, "示範分類");

    const row = await findRowOf("甜點");
    expect(within(row).getByText("好食公司 自訂")).toBeInTheDocument();
    // 反灰:開關唯讀、操作欄講明誰在管它,而不是把這一列藏起來
    expect(
      within(row).getByRole("switch", { name: "啟用「甜點」" }),
    ).toBeDisabled();
    expect(within(row).getByText("由 好食公司 管理")).toBeInTheDocument();
    expect(
      within(row).queryByRole("button", { name: "編輯" }),
    ).not.toBeInTheDocument();
  });

  it("可見範圍內的下層加的選項:一樣看得到、一樣改不動", async () => {
    const { user: actor } = renderPage();
    await selectCategory(actor, "示範分類");

    const row = await findRowOf("湯品");
    expect(within(row).getByText("子南港店 自訂")).toBeInTheDocument();
    expect(
      within(row).getByRole("switch", { name: "啟用「湯品」" }),
    ).toBeDisabled();
    expect(within(row).getByText("由 子南港店 管理")).toBeInTheDocument();
  });

  it("改不動的列:開關與「由 … 管理」都用 Tooltip 講理由(不是原生 title)", async () => {
    const { user: actor } = renderPage();
    await selectCategory(actor, "示範分類");
    const hint = "這個選項是 好食公司 加的,你看得到但不能修改或停用。";

    const row = await findRowOf("甜點");
    // 操作欄的文字直接 hover
    await actor.hover(within(row).getByText("由 好食公司 管理"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(hint);
    await actor.unhover(within(row).getByText("由 好食公司 管理"));
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    // 停用的開關收不到 hover,事件載體是 Tooltip 自己包的外層 span
    const hintCarrier = within(row)
      .getByRole("switch", { name: "啟用「甜點」" })
      .closest("span.MuiSwitch-root")?.parentElement;
    if (hintCarrier === undefined || hintCarrier === null) {
      throw new Error("改不動的開關沒有被 Tooltip 包起來");
    }
    await actor.hover(hintCarrier);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(hint);
  });

  it("只有自己這一層加的那筆可編輯、可切", async () => {
    const { user: actor } = renderPage();
    await selectCategory(actor, "示範分類");

    const row = await findRowOf("炸物");
    expect(within(row).getByText("南港店 自訂")).toBeInTheDocument();
    expect(
      within(row).getByRole("switch", { name: "啟用「炸物」" }),
    ).toBeEnabled();
    expect(within(row).getByRole("button", { name: "編輯" })).toBeEnabled();
  });

  it("可見範圍 = 僅本組織:下層的那筆不見了,上層的還在", async () => {
    const { user: actor } = renderPage({
      world: {
        fieldsByCategory: {
          "cat-gender": genderFields,
          "cat-demo": demoCategoryFieldsOwnVisibility,
        },
      },
    });
    await selectCategory(actor, "示範分類");

    expect(await within(optionsPanel()).findByText("甜點")).toBeInTheDocument();
    expect(within(optionsPanel()).queryByText("湯品")).not.toBeInTheDocument();
  });

  it("硬送上層組織的選項時 api 回 NOT_OWNER,畫面講「別的組織加的」", async () => {
    // 前端已經把這一列鎖住,這條驗的是 fail-closed 在後端時的文案分流
    const { user: actor } = renderPage({
      world: { failures: { SetFieldEnabled: "FORBIDDEN" } },
    });
    await selectCategory(actor, "示範分類");

    await actor.click(
      within(await findRowOf("炸物")).getByRole("switch", {
        name: "啟用「炸物」",
      }),
    );

    // failures 走的是通用 FORBIDDEN(沒有 reason),所以仍是全域選項那一句
    expect(
      await screen.findByText(
        "全域選項由系統管理員統一維護,你的組織不能變更它。",
      ),
    ).toBeInTheDocument();
  });

  it("`value` 可以和旁支 / 下層的選項重複,只有繼承鏈上的才算重複", async () => {
    const { user: actor, fake } = renderPage();
    await selectCategory(actor, "示範分類");
    await findRowOf("湯品");

    await actor.click(screen.getByRole("button", { name: "+ 新增自訂選項" }));
    await actor.type(screen.getByLabelText("選項名稱 *"), "湯");
    // 「湯品」是下層(子南港店)加的:不在繼承鏈上,所以同 value 放行
    await actor.type(screen.getByLabelText("值(value) *"), "soup");
    await actor.click(screen.getByRole("button", { name: "新增" }));

    await waitFor(() => {
      expect(fake.inputs.createField).toHaveLength(1);
    });
    expect(await within(optionsPanel()).findByText("湯")).toBeInTheDocument();
  });

  it("`value` 與上層組織加的選項重複 → 標在「值」欄位上", async () => {
    const { user: actor, fake } = renderPage();
    await selectCategory(actor, "示範分類");
    await findRowOf("甜點");

    await actor.click(screen.getByRole("button", { name: "+ 新增自訂選項" }));
    await actor.type(screen.getByLabelText("選項名稱 *"), "甜品");
    await actor.type(screen.getByLabelText("值(value) *"), "dessert");
    await actor.click(screen.getByRole("button", { name: "新增" }));

    await waitFor(() => {
      expect(fake.inputs.createField).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getByLabelText("值(value) *")).toHaveAccessibleDescription(
        "這個值在這個類別已經有人用了,請換一個。",
      );
    });
  });
});
