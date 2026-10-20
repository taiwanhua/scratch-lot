import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { renderPurchasePage } from "../purchase-test-support";

/**
 * 進貨單列表(規格 8.2「列表欄位」;Figma PU-04):配置欄 + 點收進度 + 結算 + 狀態;[+ 新增] 看新增權限。
 */
describe("進貨單列表", () => {
  it("點收進度(5 / 6)、結算(待退 2,000、已結清),草稿沒有結算", async () => {
    renderPurchasePage({ path: "/purchasing/purchase" });
    const table = await screen.findByRole("table", { name: "進貨單列表" });
    const row = (serialNo: string) =>
      within(table).getByText(serialNo).closest("tr") as HTMLElement;
    expect(await within(table).findByText("5 / 6")).toBeInTheDocument();
    expect(within(row("P-0031")).getByText("待退 2,000")).toBeInTheDocument();
    expect(within(row("P-0030")).getByText("已結清")).toBeInTheDocument();
    expect(within(row("P-0034")).getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "+ 新增" })).toBeInTheDocument();
  });

  it("沒有新增權限看不到 [+ 新增]", async () => {
    renderPurchasePage({
      path: "/purchasing/purchase",
      omit: ["purchasing.purchase.create"],
    });
    await screen.findByRole("table", { name: "進貨單列表" });
    expect(screen.queryByRole("button", { name: "+ 新增" })).toBeNull();
  });
});
