import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderTransferPage } from "../transfer-test-support";

const CREATE = "/purchasing/transfer/create-page/transfer";

/**
 * 調貨單的替換新增頁(規格 8.4;Figma PU-09):整本加入、張數格子選張、刷條碼加入選取、
 * 沒有 `partial-tickets` 不出現格子、送出存值。
 */
describe("調貨單新增頁", () => {
  it("刷沒拆過的本 → 整本加入;調貨金額 = 批購金額合計;送出帶單頭與明細", async () => {
    const user = userEvent.setup();
    const { formsFake } = renderTransferPage({
      path: `${CREATE}?requisition=R-0022&to=org-store-b`,
    });
    const scan = await screen.findByRole("textbox", {
      name: "刷條碼加入選取",
    });
    await user.type(scan, "5201-1-001233-050-0-6{Enter}");
    const table = await screen.findByRole("table", { name: "調貨明細" });
    expect(within(table).getByText("5201-001233")).toBeInTheDocument();
    expect(within(table).getByText("整本")).toBeInTheDocument();
    expect(within(table).getByText("9,200")).toBeInTheDocument();
    // 收貨店 5201 預計 3、已給 2、在途 1 → 超過 1 本,只警告(規格 7.6)
    expect(screen.getByText("5201 金好運:多 1 本")).toBeInTheDocument();
    // 收貨分店選不到時的說明
    expect(
      screen.getByText(
        "看不到收貨分店時:調貨由總部開單,或請管理員把你加入收貨分店",
      ),
    ).toBeInTheDocument();
    // 同一本再刷 → 已經在明細裡
    await user.type(scan, "5201-1-001233-050-0-6{Enter}");
    expect(await screen.findByText("這本已經在明細裡")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(formsFake.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    const [sent] = formsFake.inputs.createAndSubmitFormSubmission;
    expect(sent.values).toMatchObject({
      from_branch: "org-store-a",
      to_branch: "org-store-b",
      requisition: "R-0022",
      lines: [
        expect.objectContaining({
          book: { id: "book-1233", label: "5201-001233" },
          mode: "whole",
          tickets: 100,
          amount: 10_000,
          rate: 92,
        }),
      ],
    });
  });

  it("拆過的本:刷到的那張先選起,連號快選再加 → [加入選取] 成一列選張(金額 = 面額 × 張數)", async () => {
    const user = userEvent.setup();
    renderTransferPage({ path: `${CREATE}?to=org-store-b` });
    await user.type(
      await screen.findByRole("textbox", { name: "刷條碼加入選取" }),
      "5164-1-056527-012-0-6{Enter}",
    );
    const grid = await screen.findByRole("group", { name: "張數格子" });
    expect(
      within(grid).getByRole("button", { name: "#012 已選" }),
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "連號快選的起號" }),
      "013",
    );
    await user.type(
      screen.getByRole("textbox", { name: "連號快選的迄號" }),
      "016",
    );
    await user.click(screen.getByRole("button", { name: "加入" }));
    await user.click(screen.getByRole("button", { name: "加入選取(5 張)" }));
    const table = await screen.findByRole("table", { name: "調貨明細" });
    expect(within(table).getByText("選張")).toBeInTheDocument();
    expect(within(table).getByText("#012–016")).toBeInTheDocument();
    expect(within(table).getByText("1,000")).toBeInTheDocument();
    expect(within(table).getByText("920")).toBeInTheDocument();
  });

  it("沒有 `partial-tickets`:拆過的本不出現格子,刷到只提示(L784)", async () => {
    const user = userEvent.setup();
    renderTransferPage({
      path: `${CREATE}?to=org-store-b`,
      omit: ["purchasing.transfer.partial-tickets"],
    });
    await user.type(
      await screen.findByRole("textbox", { name: "刷條碼加入選取" }),
      "5164-1-056527-012-0-6{Enter}",
    );
    expect(
      await screen.findByText("這本拆過了,只能選張;你沒有零碎張數的權限"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "張數格子" })).toBeNull();
  });

  it("送出失敗:api 回的欄位錯誤標在對應欄位(取代平常的說明),明細的顯示在明細區", async () => {
    const user = userEvent.setup();
    renderTransferPage({
      path: `${CREATE}?to=org-store-b`,
      forms: {
        failures: {
          CreateAndSubmitFormSubmission: {
            code: "VALIDATION_FAILED",
            extensions: {
              fields: ["to_branch", "lines"],
              fieldErrors: [
                {
                  fieldKey: "to_branch",
                  code: "INVALID",
                  message: "收貨分店已停用",
                },
                {
                  fieldKey: "lines",
                  rowId: "r1",
                  columnKey: "book",
                  code: "LOCKED",
                  message: "這本已被其他單據鎖定",
                },
              ],
            },
          },
        },
      },
    });
    const scan = await screen.findByRole("textbox", {
      name: "刷條碼加入選取",
    });
    await user.type(scan, "5201-1-001233-050-0-6{Enter}");
    await screen.findByRole("table", { name: "調貨明細" });
    await user.click(screen.getByRole("button", { name: "送出" }));
    expect(await screen.findByText("收貨分店已停用")).toHaveClass("Mui-error");
    expect(
      screen.queryByText(
        "看不到收貨分店時:調貨由總部開單,或請管理員把你加入收貨分店",
      ),
    ).toBeNull();
    expect(screen.getByText("這本已被其他單據鎖定")).toBeInTheDocument();
  });
});
