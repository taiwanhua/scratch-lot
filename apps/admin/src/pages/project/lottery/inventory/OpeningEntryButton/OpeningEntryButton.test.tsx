import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { INVENTORY_PERMISSIONS as P } from "@repo/domain/project/lottery";

import {
  inventoryBook,
  sampleInventoryBooks,
} from "@/test/msw/project/lottery/inventory-fixtures";
import { masterDataOrgs } from "@/test/msw/project/lottery/master-data-fixtures";

import { renderInventory } from "../inventory-test-support";

const { storeA } = masterDataOrgs;

/** 期初建檔的本(示範 5164-056601:導入前已賣出 46 張、在手上 54 張)。 */
const openingBook = inventoryBook({
  id: "b-056601",
  bookNo: "0056601",
  lastTicketNo: "101",
  source: "opening",
  purchasedAt: null,
  purchaseDealer: null,
  openingAt: "2026-11-25T01:12:00.000Z",
  openedBy: { __typename: "LotteryInventoryRef", id: "u-1", name: "王小明" },
});

/**
 * 庫存列表的期初建檔(Figma IN-01-3 / CS-22-3;期初建檔規格 3、5.3):頁首 [期初建檔](有權限、綁了頁、選的分店還在進行中)、
 * 來源篩選、期初建檔的本批購日與批購甲類寫「導入前既有」。
 */
describe("庫存列表:期初建檔", () => {
  it("期初建檔的本:批購日、批購甲類寫「導入前既有」;來源選「期初建檔」只送 source", async () => {
    const { user } = renderInventory({
      world: { books: [...sampleInventoryBooks(), openingBook] },
    });
    const row = (await screen.findByText("056601")).closest("tr");
    if (row === null) {
      throw new TypeError("找不到 056601 那一列");
    }
    expect(within(row).getAllByText("導入前既有")).toHaveLength(2);
    await user.click(screen.getByRole("combobox", { name: "來源" }));
    await user.click(await screen.findByRole("option", { name: "期初建檔" }));
    await waitFor(() => {
      expect(screen.queryByText("056527")).not.toBeInTheDocument();
    });
    expect(screen.getByText("056601")).toBeInTheDocument();
    expect(screen.getByText("共 1 本")).toBeInTheDocument();
  });

  it("有 inventory.opening、綁了期初建檔頁、分店還在進行中:頁首 [期初建檔] 帶分店進建檔頁", async () => {
    const { user } = renderInventory({ openingPage: true });
    const button = await screen.findByRole("button", { name: "期初建檔" });
    await user.click(button);
    await waitFor(() => {
      expect(window.location.pathname).toBe("/inventory/opening-page");
    });
    expect(window.location.search).toContain(`org=${storeA.id}`);
  });

  it("分店已結束期初建檔:頁首沒有 [期初建檔]", async () => {
    renderInventory({
      openingPage: true,
      openings: {
        [storeA.id]: {
          bookCount: 2,
          closedAt: "2026-11-30T02:00:00.000Z",
          closedBy: "王總部",
        },
      },
    });
    await screen.findByText("056527");
    expect(
      screen.queryByRole("button", { name: "期初建檔" }),
    ).not.toBeInTheDocument();
  });

  it("沒有 inventory.opening:頁首沒有 [期初建檔]", async () => {
    renderInventory({
      openingPage: true,
      permissions: Object.values(P).filter((key) => key !== P.opening),
    });
    await screen.findByText("056527");
    expect(
      screen.queryByRole("button", { name: "期初建檔" }),
    ).not.toBeInTheDocument();
  });
});
