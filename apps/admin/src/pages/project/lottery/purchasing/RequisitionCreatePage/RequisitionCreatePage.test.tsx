import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { expectButtonOrder } from "@/test/button-order";
import { requisitionFormWorld } from "@/test/msw/project/lottery/purchasing-fixtures";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import { renderPurchasingPage } from "../purchasing-test-support";

const CREATE = "/purchasing/requisition/create-page/requisition";

/**
 * 叫貨單的替換新增頁(規格 8.1;Figma PU-02):列出販售中的遊戲,填叫幾本、存草稿或送出。
 */
describe("叫貨單新增頁", () => {
  restoreViewportAfterEach();

  it("店長預設自己的分店;新遊戲在最上、標【新】,銷售欄顯示「—」", async () => {
    const { purchasingFake } = renderPurchasingPage({ path: CREATE });
    const table = await screen.findByRole("table", { name: "販售中的遊戲" });
    expect(await within(table).findByText(/5201 金好運/)).toBeInTheDocument();
    expect(purchasingFake.candidateOrgIds).toContain("org-store-a");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent.slice(0, 12))).toEqual([
      expect.stringContaining("5201"),
      expect.stringContaining("5198"),
      expect.stringContaining("5164"),
      expect.stringContaining("5150"),
      expect.stringContaining("5133"),
    ]);
    const first = within(rows[0]);
    expect(first.getByText("新")).toBeInTheDocument();
    expect(first.getAllByText("—")).toHaveLength(2);
    expect(within(rows[2]).getByText("180")).toBeInTheDocument();
  });

  it("站在最上層組織(總部)不預設分店,選了才列遊戲", async () => {
    const { purchasingFake } = renderPurchasingPage({
      path: CREATE,
      currentOrg: "tenant",
    });
    expect(await screen.findByText("先選叫貨分店")).toBeInTheDocument();
    expect(purchasingFake.candidateOrgIds).toEqual([]);
  });

  it("填叫幾本:合計與預估批購金額;超過預計要給本數只提醒、可以送出;0 本的列不寫入", async () => {
    const user = userEvent.setup();
    const { formsFake } = renderPurchasingPage({ path: CREATE });
    const table = await screen.findByRole("table", { name: "販售中的遊戲" });
    await within(table).findByText(/5133 招財貓/);
    const inputs = within(table).getAllByRole("spinbutton", { name: "叫幾本" });
    const [newGame, , hot, , lucky] = inputs;
    await user.clear(newGame);
    await user.type(newGame, "2");
    await user.clear(hot);
    await user.type(hot, "1");
    await user.clear(lucky);
    await user.type(lucky, "2");
    // 200 × 100 × 92% × 3 + 1,000 × 25 × 92% × 2 = 101,200
    expect(
      screen.getByText("共叫 5 本,預估批購 101,200 元"),
    ).toBeInTheDocument();
    expect(screen.getByText("超過預計要給本數(1)")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "只看要叫的" }));
    await waitFor(() => {
      expect(within(table).queryByText(/5198 鼠來寶/)).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(formsFake.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    const [sent] = formsFake.inputs.createAndSubmitFormSubmission;
    const values = (sent.values ?? {}) as {
      branch?: string;
      lines?: { game: { id: string }; books: number }[];
    };
    expect(sent.formKey).toBe("requisition");
    expect(values.branch).toBe("org-store-a");
    expect(
      (values.lines ?? []).map((line) => [line.game.id, line.books]),
    ).toEqual([
      ["game-5201", 2],
      ["game-5164", 1],
      ["game-5133", 2],
    ]);
  });

  it("存草稿:同一張表單、建一筆草稿", async () => {
    const user = userEvent.setup();
    const { formsFake } = renderPurchasingPage({ path: CREATE });
    const table = await screen.findByRole("table", { name: "販售中的遊戲" });
    await within(table).findByText(/5201 金好運/);
    const [first] = within(table).getAllByRole("spinbutton", {
      name: "叫幾本",
    });
    await user.clear(first);
    await user.type(first, "1");
    // 動作列(REACT-16):補上 [取消],順序 [取消] → [存草稿] → [送出]
    expectButtonOrder(["取消", "存草稿", "送出"]);
    await user.click(screen.getByRole("button", { name: "存草稿" }));
    await waitFor(() => {
      expect(formsFake.inputs.createFormDraft).toHaveLength(1);
    });
    expect(formsFake.inputs.createAndSubmitFormSubmission).toHaveLength(0);
  });

  it("手機:遊戲改成卡片,一行列出庫存、在途、近 7 / 30 天", async () => {
    setMobileViewport();
    renderPurchasingPage({ path: CREATE });
    expect(
      await screen.findByText(
        "庫存 35 張 · 在途 0 本 · 近 7 天 42 · 近 30 天 180",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "販售中的遊戲" })).toBeNull();
  });

  it("送出失敗:api 回的欄位錯誤標在對應欄位(期望到貨日),明細的顯示在遊戲清單上方", async () => {
    const user = userEvent.setup();
    renderPurchasingPage({
      path: CREATE,
      forms: requisitionFormWorld({
        failures: {
          CreateAndSubmitFormSubmission: {
            code: "VALIDATION_FAILED",
            extensions: {
              fields: ["expected_date", "lines"],
              fieldErrors: [
                {
                  fieldKey: "expected_date",
                  code: "OUT_OF_RANGE",
                  message: "期望到貨日不能早於今天",
                },
                {
                  fieldKey: "lines",
                  code: "MAX_ROWS",
                  message: "明細最多 200 列",
                },
              ],
            },
          },
        },
      }),
    });
    const table = await screen.findByRole("table", { name: "販售中的遊戲" });
    await within(table).findByText(/5201 金好運/);
    const [first] = within(table).getAllByRole("spinbutton", {
      name: "叫幾本",
    });
    await user.clear(first);
    await user.type(first, "1");
    await user.click(screen.getByRole("button", { name: "送出" }));
    expect(await screen.findByText("期望到貨日不能早於今天")).toHaveClass(
      "Mui-error",
    );
    expect(screen.getByText("明細最多 200 列")).toBeInTheDocument();
  });
});
