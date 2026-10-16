import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { DEMO_FORM_ROUTES } from "@/test/msw/form-fixtures";

import {
  ROW_A,
  ROW_B,
  arrayRuntimeOptions,
  arraySubmission,
  lineRow,
  restoreViewportAfterEach,
  setMobileViewport,
} from "./form-array-test-support";
import { renderShopping } from "./form-module-test-support";

const EDIT_PATH = `${DEMO_FORM_ROUTES.editPage}/sub-1`;
const VIEW_PATH = `${DEMO_FORM_ROUTES.viewPage}/sub-1`;

restoreViewportAfterEach();

const line = (rowId: string, name: string, qty: string) => ({
  rowId,
  name,
  qty,
  price: "10",
  subtotal: null,
});

const renderEdit = (fieldErrors: Record<string, unknown>[]) =>
  renderShopping({
    path: EDIT_PATH,
    world: {
      ...arrayRuntimeOptions(),
      submissions: [arraySubmission()],
      failures: {
        UpdateFormSubmission: {
          code: "VALIDATION_FAILED",
          extensions: { fields: ["lines"], fieldErrors },
        },
      },
    },
  });

describe("明細列(錯誤 / 唯讀 / 手機)", () => {
  it("每一格的錯誤標在那一格(以 rowId + 子欄定位)", async () => {
    const { user } = renderEdit([
      {
        fieldKey: "lines",
        rowId: ROW_A,
        columnKey: "name",
        code: "REQUIRED",
        message: "「品名」為必填",
      },
    ]);
    await screen.findByRole("table", { name: "明細" });
    await user.click(screen.getByRole("button", { name: "儲存修改" }));

    expect(
      await within(lineRow(0)).findByText("「品名」為必填"),
    ).toBeInTheDocument();
  });

  it("列數錯誤顯示在表尾", async () => {
    const { user } = renderEdit([
      {
        fieldKey: "lines",
        code: "MIN_ROWS",
        message: "「明細」至少要有 3 列",
      },
    ]);
    await screen.findByRole("table", { name: "明細" });
    await user.click(screen.getByRole("button", { name: "儲存修改" }));

    const section = screen.getByRole("region", { name: "明細" });
    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "「明細」至少要有 3 列",
    );
  });

  it("唯讀檢視:同一張表格,每格顯示存值、沒有新增 / 刪除 / 複製", async () => {
    renderShopping({
      path: VIEW_PATH,
      world: { ...arrayRuntimeOptions(), submissions: [arraySubmission()] },
    });

    const table = await screen.findByRole("table", { name: "明細" });
    expect(
      within(lineRow(1)).getByRole("textbox", { name: "品名" }),
    ).toHaveValue("香蕉");
    expect(within(table).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "+ 新增一列" })).toBeNull();
  });

  it("修訂差異:以 rowId 對列標示新增 / 刪除 / 移動 / 改值", async () => {
    const ROW_C = "00000000-0000-4000-8000-00000000000c";
    const ROW_D = "00000000-0000-4000-8000-00000000000d";

    const submission = arraySubmission();
    const { user } = renderShopping({
      path: VIEW_PATH,
      world: {
        ...arrayRuntimeOptions(),
        submissions: [
          {
            ...submission,
            revision: 2,
          },
        ],
        snapshots: {
          "sub-1": {
            1: {
              item: "採買",
              lines: [
                line(ROW_A, "蘋果", "1"),
                line(ROW_B, "香蕉", "1"),
                line(ROW_C, "梨子", "1"),
              ],
            },
            2: {
              item: "採買",
              lines: [
                line(ROW_B, "香蕉", "3"),
                line(ROW_A, "蘋果", "1"),
                line(ROW_D, "芭樂", "1"),
              ],
            },
          },
        },
      },
    });

    await user.click(await screen.findByRole("button", { name: "修訂紀錄" }));
    const dialog = await screen.findByRole("dialog", { name: "修訂紀錄" });
    await user.click(
      within(dialog).getByRole("button", { name: "與前一修訂的差異" }),
    );
    const diff = await within(dialog).findByRole("table", {
      name: "明細 的明細差異",
    });
    expect(
      within(diff)
        .getAllByRole("row")
        .slice(1)
        .map((row) =>
          within(row)
            .getAllByText(/^(新增|刪除|移動|改值)$/u)
            .map((tag) => tag.textContent),
        ),
    ).toEqual([["移動", "改值"], ["新增"], ["刪除"]]);
  });

  it("手機寬:每列一張卡片(子欄直排)", async () => {
    setMobileViewport();
    renderShopping({
      path: VIEW_PATH,
      world: { ...arrayRuntimeOptions(), submissions: [arraySubmission()] },
    });

    const cards = await screen.findByRole("list", { name: "明細" });
    expect(
      within(cards)
        .getAllByRole("listitem")
        .map((card) => card.getAttribute("aria-label")),
    ).toEqual(["第 1 列", "第 2 列"]);
    expect(screen.queryByRole("table", { name: "明細" })).toBeNull();
  });
});
