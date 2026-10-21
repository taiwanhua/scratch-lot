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

/** 轉圖的那幾張單據的文字(依序)。 */
const printedTexts = () =>
  receiptPngOf.mock.calls.map(([node]) => node.textContent);

/**
 * 進貨點收單的列印(規格第 12 章、8.2;Figma RC-08):[完成這次點收] 自動印兩張、
 * 標題列 [列印] / [補印]、分店沒有印表機時按鈕停用並說明。
 */
describe("進貨單檢視頁:進貨點收單", () => {
  it("[完成這次點收] → 送出兩個列印工作:第 1 張店鋪留存、第 2 張送貨人留存;只列這次點收的本 + 尚未到的本", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake } = renderPurchasePage({ path: VIEW, printing: {} });
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    await user.type(scan, "0056531099{Enter}");
    await user.click(
      await screen.findByRole("button", { name: "完成這次點收(1 本)" }),
    );

    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(2);
    });
    const expected = {
      printerId: "printer-1",
      documentType: "lottery-purchase-receiving",
      refType: "lottery-purchase-receiving",
      refId: "batch-1",
      documentName: "進貨點收單 P-0033",
      image: expect.any(String),
    };
    expect(printingFake?.created).toEqual([expected, expected]);
    const [store, courier] = printedTexts();
    expect(store).toContain("第 1 張 · 店鋪留存");
    expect(courier).toContain("第 2 張 · 送貨人留存");
    // 這次只刷了 056531:這次點收 1 本;單上的本都到了 → 尚未到的本:無
    expect(store).toContain("第 1 次點收(1 本)");
    expect(store).toContain("本號:056531");
    expect(store).not.toContain("056527");
    expect(store).toContain("尚未到的本:無");
    expect(store).toContain("點收人簽名");
    expect(store).toContain("送貨人簽名");
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

  it("點收兩次 → 補印第一次:和原單一致,只印第一次的本(以第一次計補印次數);上方印「【補印】第 N 次 · 時間 · 原因 · 補印人」", async () => {
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
      printing: { printedCount: 1 },
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
    await receiveAndComplete("0056530101", 2);
    await receiveAndComplete("0056531099", 4);
    expect(printingFake?.created.map((input) => input.refId)).toEqual([
      "batch-1",
      "batch-1",
      "batch-2",
      "batch-2",
    ]);

    // 點收過兩次:選第 1 次再補印
    await user.click(screen.getByRole("combobox", { name: "點收批次" }));
    await user.click(await screen.findByRole("option", { name: /^第 1 次/ }));
    await user.click(screen.getByRole("button", { name: "補印" }));
    const dialog = await screen.findByRole("dialog", { name: "補印" });
    await user.click(
      within(dialog).getByRole("combobox", { name: /補印原因/ }),
    );
    await user.click(await screen.findByRole("option", { name: "破損" }));
    await user.click(within(dialog).getByRole("button", { name: "送出" }));

    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(5);
    });
    expect(printingFake?.created[4]).toMatchObject({
      refType: "lottery-purchase-receiving",
      refId: "batch-1",
      isReprint: true,
      reprintReason: "damaged",
    });
    const text = printedTexts().at(-1) ?? "";
    expect(text).toMatch(
      /【補印】第 2 次 · \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 原因:破損 · 補印人:/,
    );
    expect(text).toContain("第 1 次點收(1 本)");
    expect(text).toContain("本號:056530");
    expect(text).not.toContain("056531");
    expect(text).not.toContain("店鋪留存");
  });

  it("沒有點收批次的舊資料:[補印] 印到目前為止已點收的全部本,以進貨單計次數", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake } = renderPurchasePage({
      path: VIEW,
      printing: { printedCount: 2 },
    });

    await user.click(await screen.findByRole("button", { name: "補印" }));
    const dialog = await screen.findByRole("dialog", { name: "補印" });
    await user.click(
      within(dialog).getByRole("combobox", { name: /補印原因/ }),
    );
    await user.click(await screen.findByRole("option", { name: "破損" }));
    await user.click(within(dialog).getByRole("button", { name: "送出" }));

    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      refType: "lottery-purchase-receiving",
      refId: "doc-p33",
      isReprint: true,
      reprintReason: "damaged",
    });
    const [text] = printedTexts();
    expect(text).toMatch(
      /【補印】第 3 次 · \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 原因:破損 · 補印人:/,
    );
    expect(text).toContain("已點收(5 本)");
    expect(text).toContain("尚未到的本(1 本)");
    expect(text).not.toContain("店鋪留存");
  });
});
