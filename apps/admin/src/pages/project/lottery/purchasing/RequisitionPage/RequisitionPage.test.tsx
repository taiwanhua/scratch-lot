import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import {
  requisitionForm,
  requisitionFormWorld,
} from "@/test/msw/project/lottery/purchasing-fixtures";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import { renderPurchasingPage } from "../purchasing-test-support";

const LIST = "/purchasing/requisition";

/**
 * 叫貨、採購單的列表頁(規格 8.1;Figma PU-01、PU-03):分頁 叫貨單 | 採購清單。
 */
describe("叫貨、採購單", () => {
  restoreViewportAfterEach();

  it("叫貨單:欄位照列表欄位配置;已完成細分 待購買 / 已進貨 / 已調貨,草稿與審核中照引擎狀態", async () => {
    renderPurchasingPage({ path: LIST });
    const table = await screen.findByRole("table", { name: "叫貨單列表" });
    expect(await within(table).findByText("R-0024")).toBeInTheDocument();
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["單號", "叫貨分店", "期望到貨日", "本數", "狀態", "建立者"]);
    const stateOf = (serial: string) =>
      within(within(table).getByText(serial).closest("tr") as HTMLElement);
    expect(stateOf("R-0024").getByText("草稿")).toBeInTheDocument();
    expect(stateOf("R-0023").getByText("審核中")).toBeInTheDocument();
    expect(await stateOf("R-0022").findByText("待購買")).toBeInTheDocument();
    expect(stateOf("R-0021").getByText("已進貨")).toBeInTheDocument();
    expect(stateOf("R-0020").getByText("已調貨")).toBeInTheDocument();
    expect(stateOf("R-0022").getByText("新竹店")).toBeInTheDocument();
    expect(stateOf("R-0022").getByText("陳美玲")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ 新增叫貨單" }),
    ).toBeInTheDocument();
  });

  it("採購清單:依遊戲 × 分店加總,沒叫的分店「—」;下方列出待購買的叫貨單;右上 [匯出 Excel]", async () => {
    renderPurchasingPage({ path: `${LIST}?tab=purchase-list` });
    const table = await screen.findByRole("table", { name: "採購清單" });
    await within(table).findByText(/5133 招財貓/);
    // 分店名稱與分店選擇器同一份組織樹
    await within(table).findByRole("columnheader", { name: "中山店" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["遊戲", "中山店", "新竹店", "合計本數", "預估批購金額"]);
    const lucky = within(
      within(table)
        .getByText(/5133 招財貓/)
        .closest("tr") as HTMLElement,
    );
    expect(lucky.getByText("—")).toBeInTheDocument();
    expect(lucky.getByText("23,000")).toBeInTheDocument();
    const pending = screen.getByRole("table", { name: "待購買的叫貨單" });
    expect(within(pending).getByText("R-0022")).toBeInTheDocument();
    expect(within(pending).getByText("R-0019")).toBeInTheDocument();
    // 建立進貨單 / 從其他分店調貨:進貨單、調貨單的功能併回前不顯示
    expect(within(pending).queryByRole("button")).toBeNull();
    expect(
      screen.getByRole("button", { name: "匯出 Excel" }),
    ).toBeInTheDocument();
  });

  it("沒有 purchase-list:看不到採購清單分頁(只剩一個分頁時不顯示分頁籤)", async () => {
    renderPurchasingPage({
      path: `${LIST}?tab=purchase-list`,
      omit: ["purchasing.requisition.purchase-list"],
    });
    expect(
      await screen.findByRole("table", { name: "叫貨單列表" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "採購清單" })).toBeNull();
    expect(screen.queryByRole("table", { name: "採購清單" })).toBeNull();
  });

  it("沒有新增權限:沒有 [+ 新增叫貨單]", async () => {
    renderPurchasingPage({
      path: LIST,
      omit: ["purchasing.requisition.create"],
      // api 依新增權限回 `canCreate`
      forms: requisitionFormWorld({
        moduleForms: [{ ...requisitionForm, canCreate: false }],
      }),
    });
    await screen.findByRole("table", { name: "叫貨單列表" });
    expect(screen.queryByRole("button", { name: "+ 新增叫貨單" })).toBeNull();
  });

  it("手機:叫貨單改成卡片", async () => {
    setMobileViewport();
    renderPurchasingPage({ path: LIST });
    expect(await screen.findByText(/R-0024/)).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "叫貨單列表" })).toBeNull();
  });
});
