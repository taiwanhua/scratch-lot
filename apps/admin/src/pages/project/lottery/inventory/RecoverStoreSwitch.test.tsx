import { describe, expect, it, jest } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { RecoverTicketDialog } from "@/components/project/lottery/RecoverTicketDialog/RecoverTicketDialog";
import { inventoryOrgs } from "@/test/msw/project/lottery/inventory-fixtures";

import { renderInventory } from "./inventory-test-support";

const book = {
  gameCode: "5164",
  gameName: "發大財",
  unitPrice: 200,
  bookNo: "0056527",
};
const tickets = [
  { id: "t-071", version: 3, ticketNo: "071", status: "investigating" },
];

/**
 * 刷到實體的尋回(規格 7.4;api `recoverTargetOf`):目前組織是一家店時只能尋回到它。
 * 同時屬於兩家店的店長在看板看的店 ≠ 目前組織 → 對話框直接提示先切換,停用送出。目前組織 = 中山店。
 */
describe("尋回對話框:刷到的店不是正在操作的店", () => {
  it("看板看的是新竹店、目前組織是中山店 → 提示「要先把右上角切換到這家店」、[尋回] 停用", async () => {
    renderInventory({
      path: "/inventory",
      extra: (
        <RecoverTicketDialog
          book={book}
          tickets={tickets}
          store={inventoryOrgs.storeB}
          onClose={jest.fn()}
        />
      ),
    });
    const dialog = await screen.findByRole("dialog", { name: "尋回 1 張" });
    expect(
      await within(dialog).findByText("要先把右上角切換到「新竹店」才能尋回"),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "尋回" })).toBeDisabled();
  });

  it("看板看的就是目前組織(中山店)→ 沒有提示、可以送出", async () => {
    renderInventory({
      path: "/inventory",
      extra: (
        <RecoverTicketDialog
          book={book}
          tickets={tickets}
          store={inventoryOrgs.storeA}
          onClose={jest.fn()}
        />
      ),
    });
    const dialog = await screen.findByRole("dialog", { name: "尋回 1 張" });
    expect(within(dialog).getByRole("button", { name: "尋回" })).toBeEnabled();
    expect(within(dialog).queryByText(/要先把右上角切換/)).toBeNull();
  });
});
