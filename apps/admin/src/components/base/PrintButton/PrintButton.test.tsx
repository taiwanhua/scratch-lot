import { describe, expect, it } from "@jest/globals";
import { act, screen, waitFor, within } from "@testing-library/react";

import { PRINT_SIGNALS } from "@repo/domain/printing";
import { PrintJobError, PrintJobStatus } from "@repo/graphql";

import { graphqlError } from "@/test/msw/auth-handlers";
import { printerFixture } from "@/test/msw/print-button-handlers";
import { api, server } from "@/test/msw/server";
import { findSnackbarAlert } from "@/test/snackbar";

import {
  findPrintButton,
  renderPrintButton,
  waitForSentJob,
} from "./print-button-test-support";

/**
 * 列印按鈕(底座規格第 6 章「列印按鈕元件」「權限」;Figma `Draft/PrintButton` 51:625):
 * 六種狀態(Default / Sending / Printed / Failed / Reprint / Disabled)各一個測試,
 * 加上權限、`print-result` 失敗原因、選印表機。等結果的節奏見 `PrintButtonTiming.test.tsx`,
 * 補印對話框見 `PrintButtonReprint.test.tsx`。
 */

const status = () =>
  within(screen.getByTestId("print-button")).getByRole("status");

/** 等印表機清單有結果、按鈕灰掉,hover 後回傳提示。 */
const disabledHint = async (
  { user, world }: ReturnType<typeof renderPrintButton>,
  printerReads: () => number = world.printerReads,
) => {
  await waitFor(() => {
    expect(printerReads()).toBe(1);
  });
  await act(async () => {
    await Promise.resolve();
  });
  const button = screen.getByRole("button", { name: "列印" });
  expect(button).toBeDisabled();
  // disabled 的按鈕不發 hover 事件,提示掛在 Tooltip 包的那層 span 上
  await user.hover(button.parentElement ?? button);
  return screen.findByRole("tooltip");
};

describe("列印按鈕:六種狀態", () => {
  it("Default:沒印過 → [列印] 可以按,沒有進度文字", async () => {
    renderPrintButton();

    await findPrintButton();
    expect(status()).toHaveTextContent("");
  });

  it("Sending:按 [列印] → 按鈕不能按、顯示「已送到印表機…」;第一次列印不帶補印欄位", async () => {
    const { user, world, renderImage } = renderPrintButton();

    await user.click(await findPrintButton());

    expect(await within(status()).findByText("已送到印表機…")).toBeVisible();
    expect(screen.getByRole("button", { name: "列印" })).toBeDisabled();
    expect(renderImage).toHaveBeenCalledWith(null);
    expect(world.created).toEqual([
      expect.objectContaining({
        printerId: "printer-1",
        documentType: "receipt",
        refType: "order",
        refId: "order-1",
        documentName: "收據 C-0031",
        image: btoa(String.fromCodePoint(137, 80, 78, 71, 13, 10, 26, 10)),
        isReprint: false,
        reprintReason: null,
        reprintNote: null,
      }),
    ]);
  });

  it("Printed:收到這張工作的 print-result(已印)→ ✓ 已印出,按鈕變 [補印]", async () => {
    const { user, world, emit } = renderPrintButton();
    await user.click(await findPrintButton());
    await waitForSentJob(world);

    world.finish("job-1", PrintJobStatus.Printed);
    emit(PRINT_SIGNALS.result, "job-1");

    expect(await within(status()).findByText("已印出")).toBeVisible();
    expect(await findPrintButton("補印")).toBeVisible();
  });

  it("Failed:收到 print-result(失敗)→ ✗ 失敗:<原因>", async () => {
    const { user, world, emit } = renderPrintButton();
    await user.click(await findPrintButton());
    await waitForSentJob(world);

    world.finish("job-1", PrintJobStatus.Failed, PrintJobError.PaperOut);
    emit(PRINT_SIGNALS.result, "job-1");

    expect(await within(status()).findByText("失敗:缺紙")).toBeVisible();
    // 沒印出來 → 仍是 [列印](不是補印),可以再按
    expect(await findPrintButton("列印")).toBeEnabled();
  });

  it("Reprint:印過的單據 → [補印] +「已印 N 次」", async () => {
    renderPrintButton({ printedCount: 2 });

    expect(await findPrintButton("補印")).toBeVisible();
    expect(status()).toHaveTextContent("已印 2 次");
    expect(screen.queryByRole("button", { name: "列印" })).toBeNull();
  });

  it("Disabled:分店沒有登記印表機 → 灰色,提示「本店未設定印表機」", async () => {
    const view = renderPrintButton({ printers: [] });

    expect(await disabledHint(view)).toHaveTextContent("本店未設定印表機");
  });
});

describe("按鈕灰掉時說得出原因", () => {
  it("有登記但都停用(或代理程式停用)→ 提示「本店的印表機都已停用」", async () => {
    const view = renderPrintButton({
      printers: [printerFixture({ available: false })],
    });

    expect(await disabledHint(view)).toHaveTextContent("本店的印表機都已停用");
  });

  it("印表機清單載入失敗 → 提示重新整理", async () => {
    const view = renderPrintButton();
    // 排在 world 的 handler 前面(MSW 後登記的先贏)
    let failedReads = 0;
    server.use(
      api.query("PrintablePrinters", () => {
        failedReads += 1;
        return graphqlError("FORBIDDEN");
      }),
    );

    expect(await disabledHint(view, () => failedReads)).toHaveTextContent(
      "印表機清單載入失敗,請重新整理後再試",
    );
  });

  it("已印次數查不到 → 當作沒印過,[列印] 照常可按", async () => {
    const { user, world } = renderPrintButton({ failPrintCount: true });

    await user.click(await findPrintButton("列印"));

    await waitFor(() => {
      expect(world.created).toHaveLength(1);
    });
    expect(world.created[0]).toMatchObject({ isReprint: false });
  });
});

describe("權限", () => {
  it("沒有 api.printing.print → 不渲染(也不查印表機)", async () => {
    const { world } = renderPrintButton({ permissions: [] });

    // 登入完成(側欄出現總覽)後仍沒有按鈕
    const overview = await screen.findAllByText("總覽");
    expect(overview.length).toBeGreaterThan(0);
    expect(world.printerReads()).toBe(0);
    expect(screen.queryByRole("button", { name: "列印" })).toBeNull();
    expect(screen.getByTestId("print-button")).toBeEmptyDOMElement();
  });

  it("印過但沒有 api.printing.reprint → 不顯示 [補印],仍顯示已印次數", async () => {
    renderPrintButton({
      permissions: ["api.printing.print"],
      printedCount: 1,
    });

    expect(await screen.findByText("已印 1 次")).toBeVisible();
    expect(screen.queryByRole("button", { name: "補印" })).toBeNull();
    expect(screen.queryByRole("button", { name: "列印" })).toBeNull();
  });
});

describe("列印結果", () => {
  it("送出時代理程式已離線 → 不必等信號,立即 ✗ 失敗:代理程式離線", async () => {
    const { user } = renderPrintButton({
      printers: [printerFixture({ agentOnline: false })],
    });

    await user.click(await findPrintButton());

    expect(
      await within(status()).findByText("失敗:代理程式離線"),
    ).toBeVisible();
  });

  it("別張工作的 print-result 不影響這顆按鈕", async () => {
    const { user, world, emit } = renderPrintButton();
    await user.click(await findPrintButton());
    await waitForSentJob(world);

    emit(PRINT_SIGNALS.result, "job-other");

    await act(async () => {
      await Promise.resolve();
    });
    expect(world.jobReads()).toBe(0);
    expect(status()).toHaveTextContent("已送到印表機…");
  });

  it("單據轉圖片失敗 → 不建立工作,回到 [列印],跳失敗提示", async () => {
    const { user, world, renderImage } = renderPrintButton();
    renderImage.mockRejectedValueOnce(new Error("canvas unavailable"));

    await user.click(await findPrintButton());

    expect(await findSnackbarAlert()).toEqual({
      severity: "error",
      text: "送出列印失敗,請稍後再試",
    });
    expect(await findPrintButton()).toBeEnabled();
    expect(world.created).toEqual([]);
  });

  it("送不出去(API 錯誤)→ 回到 [列印],跳失敗提示", async () => {
    const { user } = renderPrintButton();
    server.use(
      api.mutation("CreatePrintJob", () => graphqlError("VALIDATION_FAILED")),
    );

    await user.click(await findPrintButton());

    expect(await findSnackbarAlert()).toEqual({
      severity: "error",
      text: "印表機已停用或單據圖片不正確,無法列印",
    });
    expect(await findPrintButton()).toBeEnabled();
    expect(status()).toHaveTextContent("");
  });
});

describe("選印表機", () => {
  it("可選的有兩台 → 按下先選;預設那台標「預設」,選另一台就送到那台", async () => {
    const { user, world } = renderPrintButton({
      printers: [
        printerFixture(),
        printerFixture({
          id: "printer-2",
          name: "廚房收據機",
          isDefault: false,
        }),
        printerFixture({ id: "printer-3", name: "停用的", available: false }),
      ],
    });

    await user.click(await findPrintButton());
    const menu = await screen.findByRole("menu", { name: "選擇印表機" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "櫃台收據機(預設)",
      "廚房收據機",
    ]);

    await user.click(
      within(menu).getByRole("menuitem", { name: "廚房收據機" }),
    );

    await waitFor(() => {
      expect(world.created).toEqual([
        expect.objectContaining({ printerId: "printer-2" }),
      ]);
    });
  });

  it("使用處傳入的預設優先於分店預設", async () => {
    const { user } = renderPrintButton({
      printers: [
        printerFixture(),
        printerFixture({
          id: "printer-2",
          name: "廚房收據機",
          isDefault: false,
        }),
      ],
      props: { defaultPrinterId: "printer-2" },
    });

    await user.click(await findPrintButton());

    const menu = await screen.findByRole("menu", { name: "選擇印表機" });
    expect(
      within(menu).getByRole("menuitem", { name: "廚房收據機(預設)" }),
    ).toHaveClass("Mui-selected");
  });
});
