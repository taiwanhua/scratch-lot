import { describe, expect, it, jest } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { RecoverTicketDialog } from "@/components/project/lottery/RecoverTicketDialog/RecoverTicketDialog";

import { renderInventory } from "../inventory-test-support";

/** 刷到實體的尋回(店面看板刷到一張待查;不給 `store` → 目前組織是店就回到它,否則選回到哪家店)。 */
const ScannedRecover = () => (
  <RecoverTicketDialog
    book={{
      gameCode: "5164",
      gameName: "發大財",
      unitPrice: 200,
      bookNo: "0056527",
    }}
    tickets={[
      { id: "t-071", version: 3, ticketNo: "071", status: "investigating" },
    ]}
    onClose={jest.fn()}
  />
);

/** REACT-18:庫存管理的對話框,欄位錯了原因寫在欄位正下方。 */
describe("庫存管理:欄位下寫原因", () => {
  it("查刮刮樂:編號看不懂 → 輸入欄下寫原因", async () => {
    const { user } = renderInventory();
    await user.click(await screen.findByRole("button", { name: "查刮刮樂" }));
    const dialog = await screen.findByRole("dialog", { name: "查刮刮樂" });
    const input = within(dialog).getByRole("textbox", {
      name: "刷條碼或輸入背面編號",
    });
    await user.type(input, "abc");
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription("編號格式不對");
  });

  it("尋回:沒選原因、沒選回到哪家店 → 兩欄下各寫原因", async () => {
    // 刷到實體(店面看板)、目前組織不是店 → 要選回到哪家店
    const { user } = renderInventory({
      world: { stores: [{ id: "org-store-b", name: "新竹店" }] },
      extra: <ScannedRecover />,
    });
    const dialog = await screen.findByRole("dialog", { name: "尋回 1 張" });
    await user.click(within(dialog).getByRole("button", { name: "尋回" }));
    expect(within(dialog).getByText("必填,請選擇原因")).toBeInTheDocument();
    expect(
      within(dialog).getByText("必填,請選擇回到哪家店"),
    ).toBeInTheDocument();
  });
});
