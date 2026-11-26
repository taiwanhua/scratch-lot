import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FormSubmissionStatus } from "@repo/graphql";

import { wholesaleForm } from "@/test/msw/project/lottery/wholesale-fixtures";
import {
  restoreViewportAfterEach,
  setMobileViewport,
  setupFakeViewport,
} from "@/test/viewport";

import { renderWholesalePage } from "../wholesale-test-support";

setupFakeViewport();
restoreViewportAfterEach();

const LIST = "/purchasing/wholesale";

/** 批售單列表(規格 21.3「列表」;Figma WS-01)。 */
describe("批售單列表", () => {
  it("欄位、收款方式、本數、結算(待收 17,200 / 已結清 / —);草稿本人可刪", async () => {
    renderWholesalePage({ path: LIST });
    const table = await screen.findByRole("table", { name: "批售單列表" });
    const serial = await within(table).findByText("W-0001");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "單號",
      "出貨分店",
      "批售客戶",
      "收款方式",
      "本數",
      "批售金額",
      "結算",
      "狀態",
      "",
    ]);
    const row = within(serial.closest("tr") as HTMLElement);
    expect(row.getByText("中山店")).toBeInTheDocument();
    expect(row.getByText("好運彩券行")).toBeInTheDocument();
    expect(row.getByText("收到錢再核准")).toBeInTheDocument();
    expect(row.getByText("2 本")).toBeInTheDocument();
    expect(row.getByText("37,200")).toBeInTheDocument();
    expect(row.getByText("待收 17,200")).toBeInTheDocument();
    const completed = within(
      within(table).getByText("W-0004").closest("tr") as HTMLElement,
    );
    expect(completed.getByText("已結清")).toBeInTheDocument();
    const automatic = within(
      within(table).getByText("W-0002").closest("tr") as HTMLElement,
    );
    expect(automatic.getByText("—")).toBeInTheDocument();
    expect(within(table).getAllByRole("button", { name: /刪除/ })).toHaveLength(
      1,
    );
    expect(
      screen.getByRole("button", { name: "+ 新增批售單" }),
    ).toBeInTheDocument();
  });

  it("四種篩選都送給 api,頁碼回第 1 頁", async () => {
    const user = userEvent.setup();
    const { wholesaleFake } = renderWholesalePage({ path: LIST });
    await screen.findByText("W-0001");
    const choose = async (label: string, option: string | RegExp) => {
      await user.click(screen.getByRole("combobox", { name: label }));
      await user.click(await screen.findByRole("option", { name: option }));
    };
    await choose("出貨分店", "中山店");
    await choose("批售客戶", /好運彩券行/);
    await choose("收款方式", "收到錢再核准");
    await choose("狀態(含草稿)", "草稿");
    await waitFor(() => {
      expect(wholesaleFake.listInputs.at(-1)).toMatchObject({
        fromOrgId: "org-store-a",
        customerId: "wholesale-1",
        paymentMode: "collect_first",
        status: FormSubmissionStatus.Draft,
        page: 1,
      });
    });
    await choose("狀態(含草稿)", "全部");
    await waitFor(() => {
      expect(wholesaleFake.listInputs.at(-1)?.status).toBeNull();
    });
  });

  it("沒有新增權限看不到 [+ 新增]", async () => {
    renderWholesalePage({
      path: LIST,
      omit: ["purchasing.wholesale.create"],
      forms: { moduleForms: [{ ...wholesaleForm, canCreate: false }] },
    });
    await screen.findByText("W-0001");
    expect(screen.queryByRole("button", { name: "+ 新增批售單" })).toBeNull();
  });

  it("手機:每筆一張卡片(單號 · 客戶、狀態標籤),篩選收進抽屜", async () => {
    setMobileViewport();
    renderWholesalePage({ path: LIST });
    expect(await screen.findByText(/W-0001/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("待收 17,200")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /篩選/ })).toBeInTheDocument();
  });
});
