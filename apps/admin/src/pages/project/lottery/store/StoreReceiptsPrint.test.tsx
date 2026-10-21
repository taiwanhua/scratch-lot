import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

// jsdom 不會畫 canvas:轉圖換成固定的 PNG(受測頁面必須在替身掛上之後才載入,先例 TransferCreatePagePrint.test.tsx)
const PNG = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const receiptPngOf = jest.fn<(node: HTMLElement) => Promise<Blob>>(() =>
  Promise.resolve(new Blob([PNG], { type: "image/png" })),
);
jest.unstable_mockModule(
  "@/lib/project/lottery/receipts/receipt-image",
  () => ({
    receiptPngOf,
  }),
);
const { writeLocalCashPoint } =
  await import("@/lib/project/lottery/local-cash-point");
const { sampleStoreBoard } =
  await import("@/test/msw/project/lottery/store-fixtures");
const { fastUser } =
  await import("../../schedule/manage/roster/roster-test-queries");
const { renderStore } = await import("./store-test-support");

const STORE_A = "org-store-a";
const PRINTING = {};

/** 最後一張轉圖的單據文字。 */
const printedText = () => receiptPngOf.mock.calls.at(-1)?.[0].textContent ?? "";

/** 等一下,確定沒有晚到的列印工作(「不印」的情境)。 */
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 300);
  });

const headerOf = async (name: string): Promise<HTMLElement> => {
  const heading = await screen.findByRole("heading", { name });
  const card = heading.closest<HTMLElement>(".MuiCard-root");
  if (card === null) {
    throw new Error(`找不到收銀點標題列:${name}`);
  }
  return card;
};

/**
 * 看板的 58mm 單據自動列印(規格第 12 章;`printReceiptAfterCommit`):投庫、出庫、開班領零用金、存銀行
 * 寫入成功 → 一個列印工作,寫入失敗 → 沒有;沒有收據機(沒有 `api.printing.print`)→ 不印。
 */
describe("店面的 58mm 單據:看板動作後自動列印", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    receiptPngOf.mockClear();
  });

  it("投庫:超過抽屜應有(寫入失敗)→ 不印;改小送出成功 → 一張投庫單(收銀點、QR 連到即時現金帳那一筆)", async () => {
    writeLocalCashPoint(STORE_A, "cp-counter");
    const user = fastUser();
    const { printingFake } = renderStore({ printing: PRINTING });
    const counter = await headerOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "投庫" }));
    const dialog = await screen.findByRole("dialog", {
      name: "投庫 · 抽屜 → 小金庫",
    });
    const amount = within(dialog).getByRole("textbox", { name: /金額/u });
    await user.type(amount, "20000");
    await user.click(within(dialog).getByRole("button", { name: "投庫" }));
    await within(dialog).findByText("投庫金額不能超過抽屜目前的應有現金");
    await settle();
    expect(printingFake?.created).toEqual([]);

    await user.clear(amount);
    await user.type(amount, "5000");
    await user.click(within(dialog).getByRole("button", { name: "投庫" }));
    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      documentType: "lottery-store-vault-deposit",
      refType: "lottery-store-vault-deposit",
      refId: "mv-1",
    });
    expect(printedText()).toContain("投庫單");
    expect(printedText()).toContain("店內櫃台");
    expect(printedText()).toContain("5,000");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("出庫:超過小金庫應有(寫入失敗)→ 不印;成功 → 一張出庫單(原因 = 補零錢)", async () => {
    writeLocalCashPoint(STORE_A, "cp-counter");
    const user = fastUser();
    const { printingFake } = renderStore({ printing: PRINTING });
    const counter = await headerOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "出庫" }));
    const dialog = await screen.findByRole("dialog", {
      name: "出庫 · 小金庫 → 抽屜",
    });
    await user.click(within(dialog).getByRole("combobox", { name: /原因/u }));
    await user.click(await screen.findByRole("option", { name: "補零錢" }));
    const amount = within(dialog).getByRole("textbox", { name: /金額/u });
    await user.type(amount, "50000");
    await user.click(within(dialog).getByRole("button", { name: "出庫" }));
    await within(dialog).findByText(
      "小金庫應有不足,請先用現金更正單登記小金庫實際的錢",
    );
    await settle();
    expect(printingFake?.created).toEqual([]);

    await user.clear(amount);
    await user.type(amount, "500");
    await user.click(within(dialog).getByRole("button", { name: "出庫" }));
    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      documentType: "lottery-store-vault-withdraw",
      refId: "mv-1",
    });
    expect(printedText()).toContain("出庫單");
    expect(printedText()).toContain("小金庫 → 店內櫃台抽屜");
    expect(printedText()).toContain("補零錢");
  });

  it("沒有收據機(沒有 api.printing.print)→ 投庫成功也不印", async () => {
    writeLocalCashPoint(STORE_A, "cp-counter");
    const user = fastUser();
    const { printingFake, fake } = renderStore({
      printing: { permissions: [] },
    });
    const counter = await headerOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "投庫" }));
    const dialog = await screen.findByRole("dialog", {
      name: "投庫 · 抽屜 → 小金庫",
    });
    await user.type(
      within(dialog).getByRole("textbox", { name: /金額/u }),
      "1000",
    );
    await user.click(within(dialog).getByRole("button", { name: "投庫" }));
    await waitFor(() => {
      expect(fake.inputs.deposit).toHaveLength(1);
    });
    await settle();
    expect(printingFake?.created).toEqual([]);
    expect(receiptPngOf).not.toHaveBeenCalled();
  });

  it("開班從小金庫領零用金:超過小金庫應有(失敗)→ 不印;成功 → 一張出庫單(原因 = 開班零用金);沒領 → 不印", async () => {
    const user = fastUser();
    const board = sampleStoreBoard();
    const { printingFake } = renderStore({
      printing: PRINTING,
      world: { board: { ...board, vaultExpected: 3000 } },
    });
    const machine = await headerOf("彩券機旁");
    await user.click(within(machine).getByRole("button", { name: "開班" }));
    const dialog = await screen.findByRole("dialog", {
      name: "開班 · 彩券機旁",
    });
    const float = await within(dialog).findByRole("textbox", {
      name: "從小金庫領零用金",
    });
    await user.type(float, "5000");
    await user.click(within(dialog).getByRole("button", { name: "仍要開班" }));
    await within(dialog).findByText(/小金庫應有不足/u);
    await settle();
    expect(printingFake?.created).toEqual([]);

    await user.clear(float);
    await user.type(float, "3000");
    await user.click(within(dialog).getByRole("button", { name: "仍要開班" }));
    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      documentType: "lottery-store-vault-withdraw",
    });
    expect(printedText()).toContain("出庫單");
    expect(printedText()).toContain("開班零用金");
    expect(printedText()).toContain("3,000");
  });

  it("開班沒領零用金 → 不印", async () => {
    const user = fastUser();
    const { printingFake, fake } = renderStore({ printing: PRINTING });
    const machine = await headerOf("彩券機旁");
    await user.click(within(machine).getByRole("button", { name: "開班" }));
    const dialog = await screen.findByRole("dialog", {
      name: "開班 · 彩券機旁",
    });
    await within(dialog).findByRole("textbox", { name: "從小金庫領零用金" });
    await user.click(within(dialog).getByRole("button", { name: "仍要開班" }));
    await waitFor(() => {
      expect(fake.inputs.open).toHaveLength(1);
    });
    await settle();
    expect(printingFake?.created).toEqual([]);
  });

  it("存銀行:沒有可用帳戶(失敗)→ 不印;成功 → 一張存款單(經手人、存入帳戶、金額)", async () => {
    const user = fastUser();
    const failing = renderStore({
      printing: PRINTING,
      dailyCloseOptions: { bankForm: { accounts: [] } },
    });
    await user.click(await screen.findByRole("button", { name: "存銀行" }));
    const blocked = await screen.findByRole("dialog");
    await within(blocked).findByText(/沒有可用的銀行帳戶/u);
    expect(
      within(blocked).getByRole("button", { name: "確認存入" }),
    ).toBeDisabled();
    await settle();
    expect(failing.printingFake?.created).toEqual([]);
    failing.unmount();

    const { printingFake, dailyClose } = renderStore({ printing: PRINTING });
    await user.click(await screen.findByRole("button", { name: "存銀行" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("中山店 · 小金庫目前應有 24,000");
    await user.type(
      within(dialog).getByRole("textbox", { name: /金額/u }),
      "20000",
    );
    await user.click(within(dialog).getByRole("button", { name: "確認存入" }));
    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(dailyClose.inputs.deposits).toHaveLength(1);
    expect(printingFake?.created[0]).toMatchObject({
      documentType: "lottery-store-bank-deposit",
      refId: "mv-bank-1",
    });
    expect(printedText()).toContain("存款單");
    expect(printedText()).toContain("台灣銀行 中山分行 ****12345");
    expect(printedText()).toContain("20,000");
  });
});
