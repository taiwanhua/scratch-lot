import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  restoreViewportAfterEach,
  setMobileViewport,
  setupFakeViewport,
} from "@/test/viewport";

import { renderWholesalePage } from "../wholesale-test-support";

setupFakeViewport();
restoreViewportAfterEach();

const CREATE = "/purchasing/wholesale/create-page/wholesale";

const scanField = () => screen.findByRole("textbox", { name: "刷條碼加入" });

/** 批售單新增頁(規格 21.3;Figma WS-02a–e)。 */
describe("批售單新增頁", () => {
  it("刷條碼加入、整組改批購金額率、選客戶後送出:送 api 的存值(預設收到錢再核准、沒有入帳帳戶)", async () => {
    const user = userEvent.setup();
    const { formsFake } = renderWholesalePage({ path: CREATE });
    const scan = await scanField();
    await waitFor(() => {
      expect(scan).toBeEnabled();
    });
    expect(
      screen.queryByRole("combobox", { name: /入帳帳戶/ }),
    ).not.toBeInTheDocument();
    await user.type(scan, "0056611040{Enter}");
    await screen.findByRole("heading", {
      name: /5164 發大財 · 200 元\(1 本\)小計 18,400/,
    });
    await user.type(scan, "0056612001{Enter}");
    const group = await screen.findByRole("heading", {
      name: /200 元\(2 本\)小計 36,800/,
    });
    expect(group).toBeInTheDocument();
    const groupRate = screen.getByRole("spinbutton", {
      name: "5164 整組的批購金額率",
    });
    await user.clear(groupRate);
    await user.type(groupRate, "93{Enter}");
    await user.tab();
    expect(
      await screen.findByRole("heading", { name: /小計 37,200/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("共 2 本")).toBeInTheDocument();
    // 沒有成本權限:不顯示原成本、預估獲利
    expect(screen.queryByText("原成本")).toBeNull();

    // 沒選客戶不能送
    expect(screen.getByRole("button", { name: "送出" })).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: /批售客戶/ }));
    await user.click(
      await screen.findByRole("option", { name: "好運彩券行 · 0223456789" }),
    );
    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(formsFake.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    const [sent] = formsFake.inputs.createAndSubmitFormSubmission;
    expect(sent.values).toMatchObject({
      from_branch: "org-store-a",
      customer: "wholesale-1",
      payment_mode: "collect_first",
      account: null,
      note: null,
      lines: [
        {
          game: { id: "game-5164", label: "發大財" },
          book: { id: "book-w1", label: "5164-056611" },
          tickets: 100,
          book_price: 20_000,
          rate: 93,
        },
        expect.objectContaining({ rate: 93 }),
      ],
    });
  });

  it("有成本權限:原成本與預估獲利;≤ 0 用警告提示,照樣可以送;改高就沒有警告", async () => {
    const user = userEvent.setup();
    renderWholesalePage({ path: CREATE, wholesale: { showCost: true } });
    const scan = await scanField();
    await waitFor(() => {
      expect(scan).toBeEnabled();
    });
    await user.type(scan, "0056611040{Enter}");
    expect(await screen.findByText("原成本")).toBeInTheDocument();
    expect(screen.getByText("照這個批購金額率沒有獲利")).toBeInTheDocument();
    const rate = screen.getByRole("spinbutton", {
      name: "本號 056611 的批購金額率",
    });
    await user.clear(rate);
    await user.type(rate, "93");
    await user.tab();
    await waitFor(() => {
      expect(screen.queryByText("照這個批購金額率沒有獲利")).toBeNull();
    });
    expect(screen.getByText("200")).toBeInTheDocument();
  });

  it("選從帳戶入帳:出現入帳帳戶,只有一個時自動帶入", async () => {
    const user = userEvent.setup();
    const { formsFake } = renderWholesalePage({ path: CREATE });
    const scan = await scanField();
    await waitFor(() => {
      expect(scan).toBeEnabled();
    });
    await user.click(screen.getByRole("combobox", { name: /收款方式/ }));
    await user.click(await screen.findByRole("option", { name: "從帳戶入帳" }));
    expect(
      await screen.findByRole("combobox", { name: /入帳帳戶/ }),
    ).toHaveTextContent("台銀 中山分行 ····12345");
    await user.click(screen.getByRole("combobox", { name: /批售客戶/ }));
    await user.click(await screen.findByRole("option", { name: /大發彩券行/ }));
    await user.type(scan, "0056613001{Enter}");
    await screen.findByText("共 1 本");
    await user.click(screen.getByRole("button", { name: "存草稿" }));
    await waitFor(() => {
      expect(formsFake.inputs.createFormDraft).toHaveLength(1);
    });
    expect(formsFake.inputs.createFormDraft[0].values).toMatchObject({
      payment_mode: "auto_bank",
      account: "account-1",
      customer: "wholesale-2",
    });
  });

  it("從可批售的本加入:已加入的勾著不能動,一次加入勾選的;同遊戲沿用整組改過的率", async () => {
    const user = userEvent.setup();
    renderWholesalePage({ path: CREATE });
    const scan = await scanField();
    await waitFor(() => {
      expect(scan).toBeEnabled();
    });
    await user.type(scan, "0056611040{Enter}");
    const groupRate = await screen.findByRole("spinbutton", {
      name: "5164 整組的批購金額率",
    });
    await user.clear(groupRate);
    await user.type(groupRate, "95");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "從可批售的本加入" }));
    const dialog = await screen.findByRole("dialog", {
      name: "從可批售的本加入",
    });
    const picked = within(dialog).getByRole("checkbox", {
      name: "選本 056611",
    });
    expect(picked).toBeChecked();
    expect(picked).toBeDisabled();
    expect(within(dialog).getByText("已加入")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("checkbox", { name: "選本 056613" }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: "選本 060120" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "加入 2 本" }));
    expect(await screen.findByText("共 3 本")).toBeInTheDocument();
    // 056613 沿用 5164 的 95;5201 用自己的預設 92
    expect(
      screen.getByRole("heading", { name: /5164 發大財.*小計 38,000/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /5201 金好運.*小計 9,200/ }),
    ).toBeInTheDocument();
  });

  it.each([
    ["0056540012", "056540 拆過的本不能批售"],
    ["0056541012", "056541 調貨中(T-0012),不能批售"],
    ["0056542012", "056542 在別家店,不能批售"],
    ["0059999001", "查不到這本"],
    ["abc", "看不懂這個碼,請刷背面編號、正面編號或正面條碼"],
  ])("刷到 %s → 在刷條碼列下方寫「%s」,不加入", async (code, text) => {
    const user = userEvent.setup();
    renderWholesalePage({ path: CREATE });
    const scan = await scanField();
    await waitFor(() => {
      expect(scan).toBeEnabled();
    });
    await user.type(scan, `${code}{Enter}`);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByText("共 0 本")).toBeInTheDocument();
  });

  it("送出被擋(本不能批售):列出哪一本與原因", async () => {
    const user = userEvent.setup();
    renderWholesalePage({
      path: CREATE,
      forms: {
        failures: {
          CreateAndSubmitFormSubmission: {
            code: "FORBIDDEN",
            extensions: { reason: "WHOLESALE_BOOK_UNAVAILABLE" },
          },
        },
      },
    });
    const scan = await scanField();
    await waitFor(() => {
      expect(scan).toBeEnabled();
    });
    await user.type(scan, "0056611040{Enter}");
    await user.click(screen.getByRole("combobox", { name: /批售客戶/ }));
    await user.click(await screen.findByRole("option", { name: /好運彩券行/ }));
    await user.click(screen.getByRole("button", { name: "送出" }));
    expect(
      await screen.findByText(/有本不能批售.*請看明細下方列出的原因/),
    ).toBeInTheDocument();
  });

  it("總部(最上層組織)不預設出貨分店:先選分店才能刷", async () => {
    renderWholesalePage({ path: CREATE, currentOrg: "tenant" });
    expect(await screen.findByText("請先選出貨分店")).toBeInTheDocument();
    expect(await scanField()).toBeDisabled();
  });

  it("手機:底部動作列寫合計", async () => {
    setMobileViewport();
    const user = userEvent.setup();
    renderWholesalePage({ path: CREATE });
    const scan = await scanField();
    await waitFor(() => {
      expect(scan).toBeEnabled();
    });
    await user.type(scan, "0056611040{Enter}");
    expect(await screen.findByText("批售 18,400")).toBeInTheDocument();
    expect(
      screen.getByText("100 張 · 整本 20,000 · 92% · 批售金額 18,400"),
    ).toBeInTheDocument();
  });
});
