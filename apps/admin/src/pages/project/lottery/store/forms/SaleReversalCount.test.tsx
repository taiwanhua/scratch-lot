import { beforeEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { writeLocalCashPoint } from "@/lib/project/lottery/local-cash-point";

import { renderStore } from "../store-test-support";

const STORE_A = "org-store-a";

/**
 * 張數店的撤銷售出申請新增頁(張數店規格 7.3 第 1、3–5 點、13.2;Figma CS-14;驗收 16.4 U2、U6、U7 的畫面部分):
 * 刷到不是確定張號的已售列在「已對號」、[+ 加一列:依遊戲 + 張數](收銀點預設本機、最多 N 張)、
 * 全店重刷帶入原因「盤點錯誤」與不退款、依張數撤銷不符條件帶入「遊戲 + 張數」列。
 */
describe("張數店:撤銷售出申請新增頁", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("U2 / U7:刷到未售的張列在「已對號」;依遊戲 + 張數一列(本機收銀點、最多 2 張);送出依張號與依遊戲 + 張數兩種列", async () => {
    writeLocalCashPoint(STORE_A, "cp-counter");
    const { user, runtime } = renderStore({
      path: `/store/create-page/sale_reversal?org=${STORE_A}`,
      forms: { countMode: "count" },
    });
    const scan = await screen.findByRole("textbox", {
      name: "刷條碼加入張數",
    });
    // 等讀到盤點制度(張數店才有「依遊戲 + 張數」)
    await screen.findByRole("button", { name: "+ 加一列:依遊戲 + 張數" });
    await user.type(scan, "056527-070{Enter}");
    expect(
      await screen.findByText("5164 · 056527 · #070(刷條碼加入)"),
    ).toBeInTheDocument();
    expect(screen.getByText("已對號")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "+ 加一列:依遊戲 + 張數" }),
    );
    expect(
      await screen.findByRole("combobox", { name: "收銀點" }),
    ).toHaveTextContent("店內櫃台(本機)");
    await user.click(screen.getByRole("combobox", { name: "遊戲" }));
    await user.click(
      await screen.findByRole("option", { name: "5164 發大財" }),
    );
    expect(screen.getByText("最多 2 張")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "多一張" }));
    expect(screen.getByRole("button", { name: "多一張" })).toBeDisabled();

    await user.click(screen.getByRole("combobox", { name: "原因" }));
    await user.click(await screen.findByRole("option", { name: "客人退貨" }));
    // 退款金額 = 1 張 + 2 張
    expect(screen.getByText("600")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(runtime.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    const [sent] = runtime.inputs.createAndSubmitFormSubmission;
    expect(sent).toMatchObject({
      values: {
        refund_amount: 600,
        lines: [
          {
            line_kind: "by_ticket",
            book: "b-1",
            ticket_nos: "070",
            tickets: 1,
            cash_point: "cp-counter",
            amount: 200,
          },
          {
            line_kind: "by_count",
            game: "g-5164",
            cash_point: "cp-counter",
            count: 2,
            amount: 400,
          },
        ],
      },
    });
  });

  it("U6 全店重刷「記已售但還在」進來:原因帶「盤點錯誤」、不退款,列記重刷刷到的位置", async () => {
    const { user, runtime } = renderStore({
      path: `/store/create-page/sale_reversal?org=${STORE_A}&ticket=b-1-t20&place=cp-outdoor&reason=stocktake-error`,
      forms: { countMode: "count" },
    });
    expect(
      await screen.findByRole("button", { name: /^#020/u }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "原因" })).toHaveTextContent(
      "盤點錯誤",
    );
    expect(screen.getByRole("radio", { name: "否" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(runtime.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    expect(runtime.inputs.createAndSubmitFormSubmission[0]).toMatchObject({
      values: {
        reason: "stocktake-error",
        refund: "no",
        lines: [{ ticket_nos: "020", cash_point: "cp-outdoor" }],
      },
    });
  });

  it("依張數撤銷不符條件進來:帶入「遊戲 + 張數」列(收銀點、遊戲、張數)", async () => {
    renderStore({
      path: `/store/create-page/sale_reversal?org=${STORE_A}&game=g-5164&point=cp-counter&count=2`,
      forms: { countMode: "count" },
    });
    const game = await screen.findByRole("combobox", { name: "遊戲" });
    await waitFor(() => {
      expect(game).toHaveTextContent("5164 發大財");
    });
    expect(screen.getByRole("combobox", { name: "收銀點" })).toHaveTextContent(
      "店內櫃台",
    );
    expect(screen.getByLabelText("張數")).toHaveTextContent("2");
    expect(screen.getByText("最多 2 張")).toBeInTheDocument();
  });

  it("編號店:沒有「依遊戲 + 張數」;刷到未售的張不能加入", async () => {
    const { user } = renderStore({
      path: `/store/create-page/sale_reversal?org=${STORE_A}`,
    });
    const scan = await screen.findByRole("textbox", {
      name: "刷條碼加入張數",
    });
    await user.type(scan, "056527-070{Enter}");
    expect(
      await screen.findByText("這張不是本店已售,或已在其他撤銷售出申請上"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+ 加一列:依遊戲 + 張數" }),
    ).toBeNull();
    expect(within(document.body).queryByText("已對號")).toBeNull();
  });
});
