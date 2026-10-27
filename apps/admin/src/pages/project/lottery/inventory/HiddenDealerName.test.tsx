import { describe, expect, it } from "@jest/globals";
import { screen } from "@testing-library/react";

import {
  sampleBookDetail,
  sampleInventoryBooks,
} from "@/test/msw/project/lottery/inventory-fixtures";

import { renderInventory } from "./inventory-test-support";

/** 甲類沒有共用給讀者的分店時,api 回批購甲類 id、名稱空白(看不到經銷商是設計行為)。 */
const hideDealer = <T extends { purchaseDealer?: { name: string } | null }>(
  book: T,
): T =>
  book.purchaseDealer
    ? { ...book, purchaseDealer: { ...book.purchaseDealer, name: "" } }
    : book;

describe("庫存管理:看不到的批購甲類", () => {
  it("庫存分頁:名稱空白的批購甲類顯示「(看不到)」", async () => {
    renderInventory({
      world: { books: sampleInventoryBooks().map((book) => hideDealer(book)) },
    });
    expect(await screen.findByText("056527")).toBeInTheDocument();
    expect(screen.getAllByText("(看不到)").length).toBeGreaterThan(0);
    expect(screen.queryByText("陳志明 #12345678")).toBeNull();
  });

  it("本的詳情:名稱空白的批購甲類顯示「(看不到)」", async () => {
    const detail = sampleBookDetail();
    renderInventory({
      path: "/inventory/book-page/b-056527",
      world: { details: [{ ...detail, book: hideDealer(detail.book) }] },
    });
    expect(
      await screen.findByRole("heading", { name: "5164 發大財 · 本號 056527" }),
    ).toBeInTheDocument();
    expect(screen.getByText("(看不到)")).toBeInTheDocument();
    expect(screen.queryByText("陳志明 #12345678")).toBeNull();
  });
});
