import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  VIEW_ONLY,
  categoryList,
  findRowOf,
  optionsPanel,
  renderPage,
  selectCategory,
} from "./field-manager-test-support";

/**
 * 欄位管理頁的主流程(Figma 90:2 + 新增選項 211:176)。
 * 種子選項的唯讀規則在 `FieldManagerSeed.test.tsx`;上層 / 下層的可見範圍在
 * `FieldManagerVisibility.test.tsx`(可見範圍規則表)。
 */
describe("欄位管理頁(/system/field-manager)", () => {
  it("預設選第一個類別;換類別後右表格換成該類別的合併清單", async () => {
    const { user: actor } = renderPage();

    // 預設選中的是第一個類別(性別),表格是它的四個全域種子選項
    expect(await screen.findByText("性別 — 選項")).toBeInTheDocument();
    expect(
      await within(optionsPanel()).findByText("不透露"),
    ).toBeInTheDocument();

    await selectCategory(actor, "示範分類");

    expect(await within(optionsPanel()).findByText("炸物")).toBeInTheDocument();
    expect(
      within(optionsPanel()).queryByText("不透露"),
    ).not.toBeInTheDocument();
  });

  it("來源欄分「全域」與「<加它的組織> 自訂」,停用的選項照樣列出來", async () => {
    const { user: actor } = renderPage();
    await selectCategory(actor, "示範分類");

    // 種子選項:來源「全域」
    expect(
      within(await findRowOf("主食")).getByText("全域"),
    ).toBeInTheDocument();
    // 本組織自訂:來源帶自己的組織名(名稱由 api 逐列給,不取 session 的當前組織)
    expect(
      within(await findRowOf("炸物")).getByText("南港店 自訂"),
    ).toBeInTheDocument();
    // 停用只是狀態,選項不刪 — 它仍在清單上,只是開關是關的
    expect(
      within(await findRowOf("飲品")).getByRole("switch", {
        name: "啟用「飲品」",
      }),
    ).not.toBeChecked();
  });

  it("新增自訂選項:送出後清單重查,新的那筆出現在表格上", async () => {
    const { user: actor, fake } = renderPage();
    await selectCategory(actor, "示範分類");
    await findRowOf("炸物");
    const callsBefore = fake.calls.fields;

    await actor.click(screen.getByRole("button", { name: "+ 新增自訂選項" }));
    await actor.type(screen.getByLabelText("選項名稱 *"), "湯麵");
    await actor.type(screen.getByLabelText("值(value) *"), "noodle");
    await actor.type(screen.getByLabelText("排序"), "5");
    await actor.click(screen.getByRole("button", { name: "新增" }));

    await waitFor(() => {
      expect(fake.inputs.createField).toHaveLength(1);
    });
    expect(fake.inputs.createField[0]).toMatchObject({
      categoryId: "cat-demo",
      label: "湯麵",
      value: "noodle",
      order: 5,
      description: null,
    });
    expect(await within(optionsPanel()).findByText("湯麵")).toBeInTheDocument();
    expect(fake.calls.fields).toBeGreaterThan(callsBefore);
  });

  it("值與同類別既有選項重複 → FIELD_VALUE_DUPLICATE 標在「值」欄位上", async () => {
    const { user: actor, fake } = renderPage();
    await selectCategory(actor, "示範分類");
    await findRowOf("主食");

    await actor.click(screen.getByRole("button", { name: "+ 新增自訂選項" }));
    await actor.type(screen.getByLabelText("選項名稱 *"), "主餐");
    // 與全域種子的「主食」同一個 value:唯一索引擋不到,由 api 的表單驗證擋
    await actor.type(screen.getByLabelText("值(value) *"), "staple");
    await actor.click(screen.getByRole("button", { name: "新增" }));

    await waitFor(() => {
      expect(fake.inputs.createField).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getByLabelText("值(value) *")).toHaveAccessibleDescription(
        "這個值在這個類別已經有人用了,請換一個。",
      );
    });
    // 彈窗留著讓人改值,沒有被當成成功關掉
    expect(screen.getByRole("button", { name: "新增" })).toBeInTheDocument();
  });

  it("只有 view 權限:沒有新增鈕、沒有啟用開關、沒有編輯", async () => {
    const { user: actor } = renderPage({ permissions: VIEW_ONLY });
    await selectCategory(actor, "示範分類");

    expect(
      screen.queryByRole("button", { name: "+ 新增自訂選項" }),
    ).not.toBeInTheDocument();
    expect(
      within(await findRowOf("炸物")).queryByRole("button", { name: "編輯" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    // 開關換成唯讀狀態標籤
    expect(
      within(await findRowOf("飲品")).getByText("已停用"),
    ).toBeInTheDocument();
    // 類別清單本身一律唯讀
    expect(within(categoryList()).getByText("示範分類")).toBeInTheDocument();
  });
});
