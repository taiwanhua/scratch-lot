import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { PrintJobError } from "@repo/graphql";

// jsdom 不會畫 canvas:轉圖換成固定的 base64(受測頁面必須在替身掛上之後才載入,先例 useRegexSafety.test.ts)
const testPageImageOf = jest.fn<(node: HTMLElement) => Promise<string>>();
testPageImageOf.mockResolvedValue("iVBORw0KGgo=");
jest.unstable_mockModule("./TestPrintDialog/test-page-image", () => ({
  testPageImageOf,
}));
const { renderPrinters } = await import("./printers-test-support");
const { setupFakeViewport } = await import("@/test/viewport");

setupFakeViewport();

beforeAll(async () => {
  await import("./PrintersPage");
});

const openTestPrint = async (
  user: ReturnType<typeof renderPrinters>["user"],
) => {
  await user.click(
    await screen.findByRole("button", { name: "測試列印「櫃台收據機」" }),
  );
  return screen.findByRole("dialog", { name: "測試列印 · 櫃台收據機" });
};

describe("印表機管理:[測試列印] 三種結果", () => {
  it("成功:印出測試頁,提示核對項目;送出的是測試頁轉出的圖", async () => {
    const { user, printing } = renderPrinters();

    const dialog = await openTestPrint(user);
    expect(
      await within(dialog).findByText(
        "已印出測試頁:請核對字體大小、對齊、條碼、QR code 與切紙。",
      ),
    ).toBeInTheDocument();
    expect(printing.inputs.testPrint).toEqual([
      { printerId: "printer-counter", image: "iVBORw0KGgo=" },
    ]);
    // 轉圖的來源就是測試頁本身(表頭有印表機名稱與 IP)
    const [node] = testPageImageOf.mock.calls.at(-1) ?? [];
    expect(node?.textContent).toContain("櫃台收據機 · 192.0.2.50");
    expect(
      within(dialog).queryByRole("button", { name: "重試" }),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "關閉" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("缺紙:顯示原因與 [重試];重試再送一次", async () => {
    const { user, printing } = renderPrinters({
      world: { testPrintResult: PrintJobError.PaperOut },
    });

    const dialog = await openTestPrint(user);
    expect(
      await within(dialog).findByText("失敗:缺紙。補紙後再按一次 [測試列印]。"),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "重試" }));
    await within(dialog).findByText("失敗:缺紙。補紙後再按一次 [測試列印]。");
    expect(printing.inputs.testPrint).toHaveLength(2);
  });

  it("代理程式離線:建立時就失敗,顯示最後連線時間與 [重試]", async () => {
    const { user } = renderPrinters({
      world: { testPrintResult: PrintJobError.AgentOffline },
    });

    const dialog = await openTestPrint(user);
    expect(
      await within(dialog).findByText(
        "失敗:代理程式離線(最後連線 2026-10-16 22:01)。",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "重試" }),
    ).toBeInTheDocument();
  });

  it("api 擋下(例:沒有權限):沒有建成工作,顯示原因與 [重試]", async () => {
    const { user } = renderPrinters({
      world: { failures: { PrintPrinterTestPage: "FORBIDDEN" } },
    });

    const dialog = await openTestPrint(user);
    expect(
      await within(dialog).findByText("沒有送出:你沒有這項操作的權限"),
    ).toBeInTheDocument();
  });
});
