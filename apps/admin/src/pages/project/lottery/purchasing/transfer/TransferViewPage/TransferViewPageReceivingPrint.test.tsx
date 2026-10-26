import { describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

// jsdom 不會畫 canvas:轉圖換成固定的 PNG(受測頁面必須在替身掛上之後才載入,先例 PrintersTestPrint.test.tsx)
const PNG = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const receiptPngOf = jest.fn<(node: HTMLElement) => Promise<Blob>>(() =>
  Promise.resolve(new Blob([PNG], { type: "image/png" })),
);
jest.unstable_mockModule(
  "@/lib/project/lottery/receipts/receipt-image",
  () => ({ receiptPngOf }),
);
const { default: userEvent } = await import("@testing-library/user-event");
const { renderTransferPage } = await import("../transfer-test-support");

/** 每一次轉圖裡的切紙位置數(兩聯 = 1 個:聯與聯之間)。 */
const cutsOfPrints = () =>
  receiptPngOf.mock.calls.map(
    ([node]) => node.querySelectorAll("[data-receipt58-cut]").length,
  );

/**
 * 調貨點收單的列印(規格第 12 章、8.4;Figma RC-10 待畫):收貨店 [完成這次點收] 一次列印兩聯
 * (一個工作、中間切紙),印好後標頭按鈕跟著變 [補印]。已印次數不寫死(`printOnRead`)。
 */
describe("調貨單檢視頁:調貨點收單", () => {
  it("收貨店 [完成這次點收] → 送出一個列印工作(調貨點收單兩聯:收貨店留存、送貨人留存):第 N 次點收、選張寫號碼區段、尚未到的本;簽名欄 點收人、送貨人", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake } = renderTransferPage({
      path: "/purchasing/transfer/view-page/doc-t10",
      printing: { printOnRead: true },
    });
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    await user.type(scan, "0060112045{Enter}");
    await user.click(
      await screen.findByRole("button", { name: "完成這次點收(1 本)" }),
    );

    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toEqual({
      printerId: "printer-1",
      documentType: "lottery-transfer-receiving",
      refType: "lottery-transfer-receiving",
      refId: "tbatch-2",
      documentName: "調貨點收單 T-0010(兩聯)",
      image: expect.any(String),
    });
    expect(cutsOfPrints()).toEqual([1]);
    const text = receiptPngOf.mock.calls.at(-1)?.[0].textContent ?? "";
    expect(text).toContain("第 1 聯 · 收貨店留存");
    expect(text).toContain("第 2 聯 · 送貨人留存");
    expect(text).toContain("新竹店 → 中山店");
    // 第 1 次點收了 056530;這次是第 2 次:060112 選張 #045~056
    expect(text).toContain("第 2 次點收(1 本)");
    expect(text).toContain("060112 號碼:#045~056(12 張)");
    expect(text).not.toContain("056530");
    expect(text).toContain("尚未到的本:無");
    expect(text).toContain("點收人簽名");
    expect(text).toContain("送貨人簽名");
    // 印好之後,標頭的調貨點收單(預設最近一次)跟著變 [補印]
    const label = await screen.findByText("調貨點收單");
    const group = label.parentElement;
    if (group === null) throw new Error("找不到調貨點收單的列印按鈕");
    expect(
      await within(group).findByRole("button", { name: "補印" }),
    ).toBeInTheDocument();
    expect(within(group).getByText("已印 1 次")).toBeInTheDocument();
  });
});
