import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";

import {
  requisitionFormWorld,
  requisitionSubmissions,
} from "@/test/msw/project/lottery/purchasing-fixtures";
import { api, server } from "@/test/msw/server";

import { renderPurchasingPage } from "../purchasing-test-support";

/**
 * 叫貨單的替換編輯頁(規格 8.1):和新增頁同一個畫面(列出販售中的遊戲),帶入原內容
 * (叫貨分店、每個遊戲叫幾本、rowId);存草稿 / 送出沿用表單引擎。
 */
describe("叫貨單編輯頁", () => {
  it("草稿:帶入 5164 叫 5 本;改本數再存草稿 → 同一列(rowId 照舊);送出", async () => {
    const user = userEvent.setup();
    const { formsFake } = renderPurchasingPage({
      path: "/purchasing/requisition/edit-page/sub-req-0024",
    });
    expect(
      await screen.findByRole("heading", { name: "編輯叫貨單 R-0024" }),
    ).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "販售中的遊戲" });
    const row = within(table)
      .getAllByRole("row")
      .find((item) => item.textContent.includes("5164"));
    if (row === undefined) {
      throw new Error("5164 的列不在表上");
    }
    const books = within(row).getByRole("spinbutton");
    expect(books).toHaveValue(5);
    await user.clear(books);
    await user.type(books, "7");
    await user.click(screen.getByRole("button", { name: "存草稿" }));
    await waitFor(() => {
      expect(formsFake.inputs.saveFormDraft).toHaveLength(1);
    });
    const [saved] = formsFake.inputs.saveFormDraft;
    expect(saved.id).toBe("sub-req-0024");
    expect(saved.values).toMatchObject({
      branch: "org-store-a",
      expected_date: "2026-10-19T16:00:00.000Z",
      lines: [
        {
          rowId: "00000000-0000-4000-8000-sub-req-0024",
          game: { id: "game-5164", label: "發大財" },
          books: 7,
        },
      ],
    });
    await user.click(await screen.findByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(formsFake.inputs.submitFormSubmission).toHaveLength(1);
    });
  });

  it("停售遊戲的列畫面上列不出來:提示並原樣存回", async () => {
    const user = userEvent.setup();
    const stopped = {
      rowId: "row-stopped",
      game: { id: "game-9999", label: "已停售遊戲" },
      books: 3,
      note: null,
    };
    const { formsFake } = renderPurchasingPage({
      path: "/purchasing/requisition/edit-page/sub-req-0024",
      forms: requisitionFormWorld({
        submissions: requisitionSubmissions().map((item) =>
          item.id === "sub-req-0024"
            ? {
                ...item,
                values: {
                  ...item.values,
                  lines: [
                    ...(item.values.lines as Record<string, unknown>[]),
                    stopped,
                  ],
                },
              }
            : item,
        ),
      }),
    });
    expect(
      await screen.findByText(
        "這些遊戲已不在販售中,畫面沒有列出,會照原樣保留:已停售遊戲",
      ),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "存草稿" }));
    await waitFor(() => {
      expect(formsFake.inputs.saveFormDraft).toHaveLength(1);
    });
    expect(formsFake.inputs.saveFormDraft[0]?.values?.lines).toContainEqual({
      rowId: "row-stopped",
      game: { id: "game-9999", label: "已停售遊戲" },
      books: 3,
      note: null,
    });
  });

  it("遊戲清單讀不到 → 顯示讀取失敗,不畫空白表單", async () => {
    renderPurchasingPage({
      path: "/purchasing/requisition/edit-page/sub-req-0024",
    });
    server.use(
      api.query("LotteryRequisitionCandidates", () =>
        HttpResponse.json({ errors: [{ message: "boom" }] }),
      ),
    );
    expect(
      await screen.findByText("讀不到這家店的遊戲清單,請重新整理"),
    ).toBeInTheDocument();
  });
});
