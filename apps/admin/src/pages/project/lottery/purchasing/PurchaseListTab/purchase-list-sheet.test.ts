import { describe, expect, it } from "@jest/globals";

import { type PurchaseList, purchaseListSheetOf } from "./purchase-list-sheet";

const LIST: PurchaseList = {
  __typename: "LotteryPurchaseList",
  orgIds: ["org-a", "org-b"],
  rows: [
    {
      __typename: "LotteryPurchaseListRow",
      gameId: "g1",
      gameCode: "5201",
      name: "金好運",
      unitPrice: 200,
      branches: [
        { __typename: "LotteryPurchaseListBranch", orgId: "org-a", books: 2 },
        { __typename: "LotteryPurchaseListBranch", orgId: "org-b", books: 1 },
      ],
      totalBooks: 3,
      estimatedAmount: 55_200,
    },
    {
      __typename: "LotteryPurchaseListRow",
      gameId: "g2",
      gameCode: "5133",
      name: "招財貓",
      unitPrice: 1000,
      branches: [
        { __typename: "LotteryPurchaseListBranch", orgId: "org-b", books: 1 },
      ],
      totalBooks: 1,
      estimatedAmount: 23_000,
    },
  ],
  requisitions: [],
};

describe("採購清單 → Excel 工作表(規格 8.1)", () => {
  it("遊戲 × 分店加總;沒叫的分店是空格;合計本數與預估批購金額", () => {
    const sheet = purchaseListSheetOf(
      LIST,
      (orgId) => (orgId === "org-a" ? "中山店" : "新竹店"),
      {
        sheetName: "採購清單",
        note: "只列待購買的叫貨單",
        game: "遊戲",
        totalBooks: "合計本數",
        estimatedAmount: "預估批購金額",
        gameLabel: (row) => `${row.gameCode} ${row.name}`,
      },
    );
    expect(sheet.columns.map((column) => column.header)).toEqual([
      "遊戲",
      "中山店",
      "新竹店",
      "合計本數",
      "預估批購金額",
    ]);
    expect(sheet.rows).toEqual([
      {
        game: "5201 金好運",
        "org:org-a": 2,
        "org:org-b": 1,
        totalBooks: 3,
        estimatedAmount: 55_200,
      },
      {
        game: "5133 招財貓",
        "org:org-a": null,
        "org:org-b": 1,
        totalBooks: 1,
        estimatedAmount: 23_000,
      },
    ]);
    expect(sheet.notes).toEqual(["只列待購買的叫貨單"]);
  });
});
