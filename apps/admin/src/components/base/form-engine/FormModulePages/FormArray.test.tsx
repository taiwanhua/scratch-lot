import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { DEMO_FORM_ROUTES } from "@/test/msw/form-fixtures";

import {
  arrayRuntimeOptions,
  hideableArrayRuntimeOptions,
  lineRow,
  linesTable,
} from "./form-array-test-support";
import { renderShopping } from "./form-module-test-support";

const CREATE_PATH = `${DEMO_FORM_ROUTES.createPage}/shopping_list`;

type User = ReturnType<typeof renderShopping>["user"];

const renderCreate = () =>
  renderShopping({ path: CREATE_PATH, world: arrayRuntimeOptions() });

const addRow = async (user: User) => {
  await user.click(await screen.findByRole("button", { name: "+ 新增一列" }));
};

/** 在第 `index` 列填數量與單價。 */
const fillRow = async (
  user: User,
  index: number,
  cells: { name?: string; qty: string; price: string },
) => {
  const row = within(lineRow(index));
  if (cells.name !== undefined) {
    await user.type(row.getByRole("textbox", { name: "品名" }), cells.name);
  }
  await user.type(row.getByRole("textbox", { name: "數量" }), cells.qty);
  await user.type(row.getByRole("textbox", { name: "單價" }), cells.price);
};

describe("明細列(填寫)", () => {
  it("新增一列後,小計(列內公式)即時算", async () => {
    const { user } = renderCreate();
    await addRow(user);
    await fillRow(user, 0, { qty: "2", price: "30" });

    expect(
      within(lineRow(0)).getByRole("textbox", { name: "小計" }),
    ).toHaveValue("60");
  });

  it("總價(彙總)= 各列小計相加", async () => {
    const { user } = renderCreate();
    await addRow(user);
    await fillRow(user, 0, { qty: "2", price: "30" });
    await addRow(user);
    await fillRow(user, 1, { qty: "1", price: "15" });

    expect(screen.getByRole("textbox", { name: "總價" })).toHaveValue("75");
  });

  it("刪除一列:那一列不見、總價跟著變", async () => {
    const { user } = renderCreate();
    await addRow(user);
    await fillRow(user, 0, { qty: "2", price: "30" });
    await addRow(user);
    await fillRow(user, 1, { qty: "1", price: "15" });

    await user.click(screen.getByRole("button", { name: "刪除第 1 列" }));

    expect(within(linesTable()).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "總價" })).toHaveValue("15");
  });

  it("複製一列:值照抄、rowId 不同(送出時兩列各自的 rowId)", async () => {
    const { user, world } = renderCreate();
    await user.type(
      await screen.findByRole("textbox", { name: "品項" }),
      "採買",
    );
    await addRow(user);
    await fillRow(user, 0, { name: "蘋果", qty: "2", price: "30" });
    await user.click(screen.getByRole("button", { name: "複製第 1 列" }));
    await user.click(screen.getByRole("button", { name: "送出" }));

    await waitFor(() => {
      expect(world.inputs.createFormDraft).toHaveLength(1);
    });
    const lines = world.inputs.createFormDraft[0]?.values?.lines as {
      rowId: string;
      name: string;
    }[];
    expect(lines.map((line) => line.name)).toEqual(["蘋果", "蘋果"]);
    expect(new Set(lines.map((line) => line.rowId)).size).toBe(2);
  });

  it("明細被顯示條件隱藏:總價即時當空明細算(與後端存值一致),再顯示時列與總價照舊回來", async () => {
    const { user } = renderShopping({
      path: CREATE_PATH,
      world: hideableArrayRuntimeOptions(),
    });
    await addRow(user);
    await fillRow(user, 0, { qty: "2", price: "30" });
    const total = screen.getByRole("textbox", { name: "總價" });
    expect(total).toHaveValue("60");

    await user.click(screen.getByRole("checkbox", { name: /不附明細/ }));

    expect(screen.queryByRole("table", { name: "明細" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "總價" })).toHaveValue("0");

    await user.click(screen.getByRole("checkbox", { name: /不附明細/ }));

    expect(
      within(lineRow(0)).getByRole("textbox", { name: "小計" }),
    ).toHaveValue("60");
    expect(screen.getByRole("textbox", { name: "總價" })).toHaveValue("60");
  });

  it("到 maxRows(2 列)就停:新增與複製都停用", async () => {
    const { user } = renderCreate();
    await addRow(user);
    await addRow(user);

    expect(screen.getByRole("button", { name: "+ 新增一列" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "複製第 1 列" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "在第 2 列上方插入一列" }),
    ).toBeDisabled();
  });

  it("上方插入一列:新的空白列插在那一列上面,原本的列順延", async () => {
    const { user } = renderCreate();
    await addRow(user);
    await fillRow(user, 0, { name: "蘋果", qty: "2", price: "30" });

    await user.click(
      screen.getByRole("button", { name: "在第 1 列上方插入一列" }),
    );

    expect(
      within(lineRow(0)).getByRole("textbox", { name: "品名" }),
    ).toHaveValue("");
    expect(
      within(lineRow(1)).getByRole("textbox", { name: "品名" }),
    ).toHaveValue("蘋果");
    expect(screen.getByRole("textbox", { name: "總價" })).toHaveValue("60");
  });

  it("上移 / 下移:只換順序;第一列不能上移、最後一列不能下移", async () => {
    const { user, world } = renderCreate();
    await user.type(
      await screen.findByRole("textbox", { name: "品項" }),
      "採買",
    );
    await addRow(user);
    await fillRow(user, 0, { name: "蘋果", qty: "2", price: "30" });
    await addRow(user);
    await fillRow(user, 1, { name: "香蕉", qty: "1", price: "15" });

    expect(screen.getByRole("button", { name: "上移第 1 列" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下移第 2 列" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "下移第 1 列" }));

    expect(
      within(lineRow(0)).getByRole("textbox", { name: "品名" }),
    ).toHaveValue("香蕉");
    expect(
      within(lineRow(1)).getByRole("textbox", { name: "小計" }),
    ).toHaveValue("60");

    await user.click(screen.getByRole("button", { name: "上移第 2 列" }));
    await user.click(screen.getByRole("button", { name: "下移第 1 列" }));
    await user.click(screen.getByRole("button", { name: "送出" }));

    await waitFor(() => {
      expect(world.inputs.createFormDraft).toHaveLength(1);
    });
    const lines = world.inputs.createFormDraft[0]?.values?.lines as {
      rowId: string;
      name: string;
    }[];
    expect(lines.map((line) => line.name)).toEqual(["香蕉", "蘋果"]);
  });

  it("表格格子不畫標題(外框沒有 legend 缺口),無障礙名稱仍是子欄標題", async () => {
    const { user } = renderCreate();
    await addRow(user);

    const row = lineRow(0);
    expect(row.querySelector("label")).toBeNull();
    const legends = [...row.querySelectorAll("fieldset legend")];
    expect(legends.length).toBeGreaterThan(0);
    for (const legend of legends) {
      expect(legend.textContent).toBe("\u200B");
    }
    expect(within(row).getByLabelText("品名")).toHaveRole("textbox");
  });
});
