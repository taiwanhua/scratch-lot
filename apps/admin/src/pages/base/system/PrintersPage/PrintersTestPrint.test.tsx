import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";

import { formatTemporal } from "@repo/domain/form";
import { PrintJobError } from "@repo/graphql";

// jsdom 不會畫 canvas:轉圖換成固定的 base64(受測頁面必須在替身掛上之後才載入,先例 useRegexSafety.test.ts)
const testPageImageOf = jest.fn<(node: HTMLElement) => Promise<string>>();
testPageImageOf.mockResolvedValue("iVBORw0KGgo=");
jest.unstable_mockModule("./TestPrintDialog/test-page-image", () => ({
  testPageImageOf,
}));
const { renderPrinters } = await import("./printers-test-support");
const { setupFakeViewport } = await import("@/test/viewport");
const { FakeSocket } = await import("@/test/realtime");
const { api, server } = await import("@/test/msw/server");

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

describe("印表機管理:[測試列印] 等結果的方式", () => {
  // 即時通道:把瀏覽器的 WebSocket 換成假的,API 發憑證(測試預設的憑證是 null = 慢速模式)
  const sockets: InstanceType<typeof FakeSocket>[] = [];
  const OriginalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    sockets.length = 0;
    globalThis.WebSocket = class extends FakeSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    } as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
  });

  it("即時通道連著:等待中先不查;收到 print-result 信號才查 printJob → 已印出", async () => {
    const { user, printing } = renderPrinters();
    // renderPrinters 登記的憑證是 null;這一筆排在最前面(MSW 先列的先贏)
    server.use(
      api.query("RealtimeTicket", () =>
        HttpResponse.json({
          data: {
            realtimeTicket: {
              ticket: "t1",
              connectUrl: "wss://rt.test/connect",
              expiresAt: Math.floor(Date.now() / 1000) + 600,
              topics: ["user:user-1"],
            },
          },
        }),
      ),
    );
    await waitFor(() => {
      expect(sockets.length).toBeGreaterThan(0);
    });
    const socket = sockets.at(-1);
    act(() => {
      socket?.open();
    });

    const dialog = await openTestPrint(user);
    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "正在送出測試頁…",
    );
    await waitFor(() => {
      expect(printing.inputs.testPrint).toHaveLength(1);
    });
    const jobId = printing.jobs[0].id;
    expect(printing.inputs.printJob).toEqual([]);

    act(() => {
      socket?.receive({
        op: "signal",
        topic: "user:user-1",
        signal: { type: "print-result", id: jobId },
      });
    });
    expect(
      await within(dialog).findByText(
        "已印出測試頁:請核對字體大小、對齊、條碼、QR code 與切紙。",
      ),
    ).toBeInTheDocument();
    expect(printing.inputs.printJob).toEqual([jobId]);
  });

  it("沒連上即時通道(慢速模式):建立後馬上查一次 printJob", async () => {
    const { user, printing } = renderPrinters();

    const dialog = await openTestPrint(user);
    await within(dialog).findByText(
      "已印出測試頁:請核對字體大小、對齊、條碼、QR code 與切紙。",
    );
    expect(printing.inputs.printJob).toHaveLength(1);
  });
});

describe("印表機管理:[測試列印] 測試頁的時間", () => {
  it("印的是租戶時區(Asia/Taipei)的開窗時間,不是 UTC", async () => {
    const before = new Date().toISOString();
    const { user } = renderPrinters();

    await openTestPrint(user);
    await waitFor(() => {
      expect(testPageImageOf).toHaveBeenCalled();
    });
    const after = new Date().toISOString();
    const [node] = testPageImageOf.mock.calls.at(-1) ?? [];
    const text = node?.textContent ?? "";
    const taipei = [before, after].map((iso) =>
      formatTemporal(iso, { type: "datetime", timezone: "Asia/Taipei" }),
    );
    expect(taipei.some((time) => text.includes(time))).toBe(true);
    const utc = [before, after].map((iso) =>
      formatTemporal(iso, { type: "datetime", timezone: "UTC" }),
    );
    expect(utc.some((time) => text.includes(time))).toBe(false);
  });
});
