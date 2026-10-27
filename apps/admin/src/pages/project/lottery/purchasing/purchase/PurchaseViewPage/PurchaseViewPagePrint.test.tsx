import { describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

// jsdom 不會畫 canvas:轉圖換成固定的 PNG(受測頁面必須在替身掛上之後才載入,先例 PrintersTestPrint.test.tsx)
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
const { default: userEvent } = await import("@testing-library/user-event");
const { renderPurchasePage } = await import("../purchase-test-support");
const { purchaseReceiving } =
  await import("@/test/msw/project/lottery/purchase-fixtures");

const VIEW = "/purchasing/purchase/view-page/doc-p33";

/** 轉圖的那幾次列印的文字(依序;一次列印 = 一張圖,兩聯都在裡面)。 */
const printedTexts = () =>
  receiptPngOf.mock.calls.map(([node]) => node.textContent);

/** 每一次轉圖裡的切紙位置數(兩聯 = 1 個:聯與聯之間)。 */
const cutsOfPrints = () =>
  receiptPngOf.mock.calls.map(
    ([node]) => node.querySelectorAll("[data-receipt58-cut]").length,
  );

type Actor = ReturnType<typeof userEvent.setup>;

/** 等標頭按鈕可以按(不能按時外面包一層 span,按鈕節點會換掉:每次重新查)。 */
const enabledButton = (name: "列印" | "補印") =>
  waitFor(() => {
    const found = screen.getByRole("button", { name });
    expect(found).toBeEnabled();
    return found;
  });

/** 標頭 [列印](還沒印過)→「列印哪一聯」選聯別(不選 = 兩聯都印)→ [列印]。 */
const firstPrint = async (user: Actor, copy: string | null = null) => {
  await user.click(await enabledButton("列印"));
  const dialog = await screen.findByRole("dialog", { name: "列印" });
  const copies = within(dialog).getByRole("combobox", { name: /列印哪一聯/ });
  expect(copies).toHaveTextContent("兩聯都印");
  if (copy !== null) {
    await user.click(copies);
    await user.click(await screen.findByRole("option", { name: copy }));
  }
  await user.click(within(dialog).getByRole("button", { name: "列印" }));
};

/** 標頭 [補印] → 選聯別(不選 = 兩聯都補)、原因「破損」→ 送出。 */
const reprint = async (user: Actor, copy: string | null = null) => {
  // 送出中(上一次列印還在等結果)按鈕不能按:等它可以按
  await user.click(await enabledButton("補印"));
  const dialog = await screen.findByRole("dialog", { name: "補印" });
  const copies = within(dialog).getByRole("combobox", { name: /補印哪一聯/ });
  expect(copies).toHaveTextContent("兩聯都補");
  if (copy !== null) {
    await user.click(copies);
    await user.click(await screen.findByRole("option", { name: copy }));
  }
  await user.click(within(dialog).getByRole("combobox", { name: /補印原因/ }));
  await user.click(await screen.findByRole("option", { name: "破損" }));
  await user.click(within(dialog).getByRole("button", { name: "送出" }));
};

/**
 * 進貨點收單的列印(規格第 12 章、8.2;Figma RC-08):[完成這次點收] 一次列印兩聯(一個工作、中間切紙)、
 * 標題列 [列印] / [補印](補印可選聯別)、印完後按鈕跟著變、分店沒有印表機時按鈕停用並說明。
 * 已印次數不寫死:假伺服器照送出、印出的工作計(`printOnRead` = 工作被查到就印好了)。
 */
describe("進貨單檢視頁:進貨點收單", () => {
  it("[完成這次點收] → 送出一個列印工作(兩聯接成一張、中間切紙):第 1 聯 店鋪留存、第 2 聯 送貨人留存;只列這次點收的本 + 尚未到的本", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake } = renderPurchasePage({ path: VIEW, printing: {} });
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    await user.type(scan, "0056531099{Enter}");
    await user.click(
      await screen.findByRole("button", { name: "完成這次點收(1 本)" }),
    );

    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created).toEqual([
      {
        printerId: "printer-1",
        documentType: "lottery-purchase-receiving",
        refType: "lottery-purchase-receiving",
        refId: "batch-1",
        documentName: "進貨點收單 P-0033(兩聯)",
        image: expect.any(String),
      },
    ]);
    expect(cutsOfPrints()).toEqual([1]);
    const [text = ""] = printedTexts();
    expect(text).toContain("第 1 聯 · 店鋪留存");
    expect(text).toContain("第 2 聯 · 送貨人留存");
    expect(text.indexOf("店鋪留存")).toBeLessThan(text.indexOf("送貨人留存"));
    // 這次只刷了 056531:這次點收 1 本;單上的本都到了 → 尚未到的本:無
    expect(text).toContain("第 1 次點收(1 本)");
    expect(text).toContain("本號:056531");
    expect(text).not.toContain("056527");
    expect(text).toContain("尚未到的本:無");
    expect(text).toContain("點收人簽名");
    expect(text).toContain("送貨人簽名");
  });

  it("自動列印印好之後,標頭按鈕跟著變 [補印]「已印 1 次」(不會停在 [列印] 讓人多印一次)", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake } = renderPurchasePage({
      path: VIEW,
      printing: { printOnRead: true },
    });
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    await user.type(scan, "0056531099{Enter}");
    await user.click(
      await screen.findByRole("button", { name: "完成這次點收(1 本)" }),
    );

    expect(
      await screen.findByRole("button", { name: "補印" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("已印 1 次")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "列印" })).toBeNull();
    expect(
      printingFake?.printedCountOf("lottery-purchase-receiving", "batch-1"),
    ).toBe(1);
  });

  it("兩聯接成一張超過高度上限 → 不送列印,提示「單據太長,這次沒有印出,請按 [列印] 分聯印」(這次點收還沒印過)", async () => {
    receiptPngOf.mockClear();
    // 一張 9,000 點高的圖(簽章 + IHDR;超過 8,000 點的上限)
    const tall = new Uint8Array(33);
    tall.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    tall.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
    new DataView(tall.buffer).setUint32(16, 384);
    new DataView(tall.buffer).setUint32(20, 9000);
    receiptPngOf.mockResolvedValueOnce(new Blob([tall], { type: "image/png" }));
    const user = userEvent.setup();
    const { printingFake } = renderPurchasePage({ path: VIEW, printing: {} });
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    await user.type(scan, "0056531099{Enter}");
    await user.click(
      await screen.findByRole("button", { name: "完成這次點收(1 本)" }),
    );

    expect(
      await screen.findByText("單據太長,這次沒有印出,請按 [列印] 分聯印"),
    ).toBeInTheDocument();
    expect(receiptPngOf).toHaveBeenCalledTimes(1);
    expect(printingFake?.created).toEqual([]);
  });

  it("沒有 api.printing(沒有收據機的租戶):[完成這次點收] 照常完成,不送列印、標題列沒有 [列印]", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    renderPurchasePage({ path: VIEW });
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    await user.type(scan, "0056531099{Enter}");
    await user.click(
      await screen.findByRole("button", { name: "完成這次點收(1 本)" }),
    );

    expect(await screen.findByText("這次點收了 1 本")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "列印" })).toBeNull();
    expect(receiptPngOf).not.toHaveBeenCalled();
  });

  it("分店沒有印表機 → [列印] 停用並說明「本店未設定印表機」;[完成這次點收] 不送列印", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake } = renderPurchasePage({
      path: VIEW,
      printing: { printers: [] },
    });

    const print = await screen.findByRole("button", { name: "列印" });
    await waitFor(() => {
      expect(print).toBeDisabled();
    });
    await user.hover(print.parentElement ?? print);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "本店未設定印表機",
    );

    const scan = screen.getByRole("textbox", { name: "刷條碼點收" });
    await user.type(scan, "0056531099{Enter}");
    await user.click(
      await screen.findByRole("button", { name: "完成這次點收(1 本)" }),
    );
    await waitFor(() => {
      expect(printingFake?.printerReads()).toBeGreaterThan(1);
    });
    expect(printingFake?.created).toEqual([]);
  });

  it("點收兩次 → 補印第一次、只補第 2 聯:和原單一致只印第一次的本,原單算第 1 次 → 「【補印】第 2 次」;列印紀錄名稱寫聯別", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    // 056530、056531 都還沒點收
    const base = purchaseReceiving();
    const receiving = {
      ...base,
      receivedCount: 4,
      groups: base.groups.map((group) => ({
        ...group,
        rows: group.rows.map((row) =>
          row.rowId === "row-4" ? { ...row, received: false } : row,
        ),
      })),
    };
    const { printingFake } = renderPurchasePage({
      path: VIEW,
      printing: { printOnRead: true },
      purchase: { receiving },
    });
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    const receiveAndComplete = async (code: string, jobs: number) => {
      await user.type(scan, `${code}{Enter}`);
      await user.click(
        await screen.findByRole("button", { name: "完成這次點收(1 本)" }),
      );
      await waitFor(() => {
        expect(printingFake?.created).toHaveLength(jobs);
      });
    };
    await receiveAndComplete("0056530101", 1);
    await receiveAndComplete("0056531099", 2);
    // 一次點收一個工作(兩聯在同一張圖裡)
    expect(printingFake?.created.map((input) => input.refId)).toEqual([
      "batch-1",
      "batch-2",
    ]);
    await waitFor(() => {
      expect(
        printingFake?.printedCountOf("lottery-purchase-receiving", "batch-1"),
      ).toBe(1);
    });

    // 點收過兩次:選第 1 次再補印,只補送貨人留存
    await user.click(screen.getByRole("combobox", { name: "點收批次" }));
    await user.click(await screen.findByRole("option", { name: /^第 1 次/ }));
    expect(await screen.findByText("已印 1 次")).toBeInTheDocument();
    await reprint(user, "第 2 聯 · 送貨人留存");

    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(3);
    });
    expect(printingFake?.created[2]).toMatchObject({
      refType: "lottery-purchase-receiving",
      refId: "batch-1",
      documentName: "進貨點收單 P-0033(送貨人留存)補印",
      isReprint: true,
      reprintReason: "damaged",
    });
    expect(cutsOfPrints().at(-1)).toBe(0);
    const text = printedTexts().at(-1) ?? "";
    expect(text).toMatch(
      /【補印】第 2 次 · \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 原因:破損 · 補印人:/,
    );
    expect(text).toContain("第 2 聯 · 送貨人留存");
    expect(text).not.toContain("店鋪留存");
    expect(text).toContain("第 1 次點收(1 本)");
    expect(text).toContain("本號:056530");
    expect(text).not.toContain("056531");
  });

  it("沒有點收批次的舊資料:[列印] 印到目前為止已點收的全部本(兩聯);印好後 [補印] 預設兩聯都補 → 「【補印】第 2 次」、兩聯都標補印", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake } = renderPurchasePage({
      path: VIEW,
      printing: { printOnRead: true },
    });

    await firstPrint(user);
    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      refId: "doc-p33",
      documentName: "進貨點收單 P-0033(兩聯)",
      isReprint: false,
    });
    await reprint(user);

    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(2);
    });
    expect(printingFake?.created[1]).toMatchObject({
      refType: "lottery-purchase-receiving",
      refId: "doc-p33",
      documentName: "進貨點收單 P-0033(兩聯)補印",
      isReprint: true,
      reprintReason: "damaged",
    });
    expect(cutsOfPrints()).toEqual([1, 1]);
    const text = printedTexts().at(-1) ?? "";
    expect(text.match(/【補印】第 2 次/g)).toHaveLength(2);
    expect(text).toContain("第 1 聯 · 店鋪留存");
    expect(text).toContain("第 2 聯 · 送貨人留存");
    expect(text).toContain("已點收(5 本)");
    expect(text).toContain("尚未到的本(1 本)");
  });

  it("還沒印過時 [列印] 只印第 1 聯 → 第 1 次(不是補印);之後補印第 2 聯 → 「【補印】第 2 次」;列印紀錄名稱都帶聯別", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake } = renderPurchasePage({
      path: VIEW,
      printing: { printOnRead: true },
    });

    await firstPrint(user, "第 1 聯 · 店鋪留存");
    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      refId: "doc-p33",
      documentName: "進貨點收單 P-0033(店鋪留存)",
      isReprint: false,
    });
    const first = printedTexts().at(-1) ?? "";
    expect(first).toContain("第 1 聯 · 店鋪留存");
    expect(first).not.toContain("送貨人留存");
    expect(first).not.toContain("【補印】");
    expect(cutsOfPrints()).toEqual([0]);

    // 一次 = 一個工作:印出來(已印 1 次)之後按鈕是 [補印],另一聯算補印
    await waitFor(() => {
      expect(
        printingFake?.printedCountOf("lottery-purchase-receiving", "doc-p33"),
      ).toBe(1);
    });
    await reprint(user, "第 2 聯 · 送貨人留存");
    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(2);
    });
    expect(printingFake?.created[1]).toMatchObject({
      documentName: "進貨點收單 P-0033(送貨人留存)補印",
      isReprint: true,
    });
    const second = printedTexts().at(-1) ?? "";
    expect(second).toMatch(/【補印】第 2 次/);
    expect(second).toContain("第 2 聯 · 送貨人留存");
    expect(second).not.toContain("店鋪留存");
  });
});
