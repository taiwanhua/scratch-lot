import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderTransferPage } from "../transfer-test-support";

/**
 * 調貨單列表(規格 8.4「列表欄位」;Figma PU-08):配置欄 + 本數 / 張數 + 點收進度 + 結算 + 狀態(在途);
 * [+ 新增] 看新增權限。
 */
describe("調貨單列表", () => {
  it("本數 / 張數、點收進度、結算(待收 1,840)、在途;草稿沒有結算", async () => {
    renderTransferPage({ path: "/purchasing/transfer" });
    const table = await screen.findByRole("table", { name: "調貨單列表" });
    const row = (serialNo: string) =>
      within(table).getByText(serialNo).closest("tr") as HTMLElement;
    expect(await within(table).findByText("1 本 / 12 張")).toBeInTheDocument();
    expect(within(row("T-0010")).getByText("1 / 2")).toBeInTheDocument();
    expect(within(row("T-0010")).getByText("在途")).toBeInTheDocument();
    expect(within(row("T-0008")).getByText("待收 1,840")).toBeInTheDocument();
    expect(within(row("T-0007")).getByText("已結清")).toBeInTheDocument();
    expect(within(row("T-0009")).getAllByText("—").length).toBeGreaterThan(0);
    expect(
      screen.getByText("收貨店不發起調貨單,缺貨請開叫貨單"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ 新增調貨單" }),
    ).toBeInTheDocument();
  });

  it("草稿照引擎的 abilities 有 [刪除]:確認後刪掉、列表不再有它;其他狀態沒有", async () => {
    const user = userEvent.setup();
    renderTransferPage({ path: "/purchasing/transfer" });
    const table = await screen.findByRole("table", { name: "調貨單列表" });
    const serial = await within(table).findByText("T-0009");
    const draft = serial.closest("tr") as HTMLElement;
    expect(
      within(table).queryByRole("button", { name: /刪除 T-0010/ }),
    ).toBeNull();
    await user.click(within(draft).getByRole("button", { name: /刪除/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /刪除/ }));
    await waitFor(() => {
      expect(within(table).queryByText("T-0009")).toBeNull();
    });
  });

  it("沒有新增權限看不到 [+ 新增]", async () => {
    renderTransferPage({
      path: "/purchasing/transfer",
      omit: ["purchasing.transfer.create"],
    });
    await screen.findByRole("table", { name: "調貨單列表" });
    expect(screen.queryByRole("button", { name: "+ 新增調貨單" })).toBeNull();
  });
});
