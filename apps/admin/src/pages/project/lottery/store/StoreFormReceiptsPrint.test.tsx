import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

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
const { HttpResponse } = await import("msw");
const { FormSubmissionStatus } = await import("@repo/graphql");
const { api, server } = await import("@/test/msw/server");
const { sampleCheckoutDetail } =
  await import("@/test/msw/project/lottery/checkout-fixtures");
const { sampleDailyCloseDetail } =
  await import("@/test/msw/project/lottery/daily-close-fixtures");
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

/** 結帳確認申請送出後,檢視頁 / 送出後動作讀到的結帳單(假 api 只認得固定的兩張,這裡依送出的 id 回)。 */
const checkoutDetailAs = (type: "shift" | "daily") => {
  server.use(
    api.query("LotteryCheckout", ({ variables }) => {
      const { submissionId } = variables as { submissionId: string };
      const detail =
        type === "daily" ? sampleDailyCloseDetail() : sampleCheckoutDetail();
      return HttpResponse.json({
        data: { lotteryCheckout: { ...detail, submissionId } },
      });
    }),
  );
};

const countInput = (value: number) =>
  screen.getByRole("spinbutton", {
    name: `張 / 枚 ${value.toLocaleString("en-US")}`,
  });

/**
 * 申請的 58mm 單據(規格第 12 章):交班結帳 / 日結(結帳確認申請的送出後動作)、撤銷售出申請(退款給客人)
 * 送出成功 → 一個列印工作,送出失敗 → 沒有;結帳確認申請檢視頁 [列印]。
 */
describe("店面的 58mm 單據:申請送出後自動列印", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    receiptPngOf.mockClear();
  });

  it("交班結帳:按鈕 [送出並列印結帳單];送出失敗 → 不印;送出成功 → 一張交班結帳單", async () => {
    const user = fastUser();
    const fill = async () => {
      await screen.findByRole("heading", { name: "交班結帳 · 店內櫃台" });
      await user.click(screen.getByRole("button", { name: "下一步" }));
      await screen.findByText("② 兌獎(本班 3 筆)");
      await user.click(screen.getByRole("button", { name: "下一步" }));
      await screen.findByText("實點(依面額清點)");
      await user.type(countInput(1000), "12");
      await user.type(countInput(100), "3");
      await user.type(countInput(50), "1");
      await user.click(screen.getByRole("button", { name: "下一步" }));
      await screen.findByText("交接");
      await user.click(
        screen.getByRole("button", { name: "送出並列印結帳單" }),
      );
    };
    const path = `/store/create-page/checkout_confirm?org=${STORE_A}&shift=shift-counter`;

    const failing = renderStore({
      path,
      printing: PRINTING,
      formRuntime: {
        failures: {
          CreateAndSubmitFormSubmission: { code: "VALIDATION_FAILED" },
        },
      },
    });
    checkoutDetailAs("shift");
    await fill();
    await waitFor(() => {
      expect(failing.runtime.inputs.createAndSubmitFormSubmission).toHaveLength(
        1,
      );
    });
    await settle();
    expect(failing.printingFake?.created).toEqual([]);
    failing.unmount();

    const { printingFake } = renderStore({
      path,
      printing: PRINTING,
      formRuntime: { submitAs: { status: FormSubmissionStatus.Reviewing } },
    });
    checkoutDetailAs("shift");
    await fill();
    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      documentType: "lottery-store-shift-checkout",
      refType: "lottery-store-shift-checkout",
    });
    expect(printedText()).toContain("交班結帳單");
    expect(printedText()).toContain("店內櫃台");
  });

  it("沒有收據機 → 交班精靈的按鈕是 [送出]", async () => {
    const user = fastUser();
    renderStore({
      path: `/store/create-page/checkout_confirm?org=${STORE_A}&shift=shift-counter`,
    });
    await screen.findByRole("heading", { name: "交班結帳 · 店內櫃台" });
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(await screen.findByRole("button", { name: "下一步" }));
    await screen.findByText("實點(依面額清點)");
    await user.type(countInput(1000), "12");
    await user.type(countInput(100), "3");
    await user.type(countInput(50), "1");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await screen.findByText("交接");
    expect(screen.getByRole("button", { name: "送出" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "送出並列印結帳單" }),
    ).toBeNull();
  });

  it("日結:送出失敗 → 不印;送出成功 → 一張日結單", async () => {
    const user = fastUser();
    const fill = async () => {
      await screen.findByRole("heading", { name: "日結 · 中山店" });
      await user.click(screen.getByRole("button", { name: "下一步" }));
      await screen.findByText("② 全店盤點");
      await user.click(screen.getByRole("button", { name: "下一步" }));
      await screen.findByText("期初(10/13 日結清點)");
      await user.type(countInput(1000), "24");
      await user.click(screen.getByRole("button", { name: "下一步" }));
      await screen.findByText("④ 存入銀行");
      await user.click(screen.getByRole("button", { name: "下一步" }));
      await screen.findByText("⑤ 確認");
      await user.click(
        screen.getByRole("button", { name: "送出結帳確認申請" }),
      );
    };
    const path = `/store/create-page/checkout_confirm?org=${STORE_A}&type=daily`;

    const failing = renderStore({
      path,
      printing: PRINTING,
      dailyCloseOptions: { allApproved: true },
      formRuntime: {
        failures: {
          CreateAndSubmitFormSubmission: { code: "VALIDATION_FAILED" },
        },
      },
    });
    checkoutDetailAs("daily");
    await fill();
    await waitFor(() => {
      expect(failing.runtime.inputs.createAndSubmitFormSubmission).toHaveLength(
        1,
      );
    });
    await settle();
    expect(failing.printingFake?.created).toEqual([]);
    failing.unmount();

    const { printingFake } = renderStore({
      path,
      printing: PRINTING,
      dailyCloseOptions: { allApproved: true },
      formRuntime: { submitAs: { status: FormSubmissionStatus.Reviewing } },
    });
    checkoutDetailAs("daily");
    await fill();
    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      documentType: "lottery-store-daily-close",
    });
    expect(printedText()).toContain("日結單");
    expect(printedText()).toContain("小金庫 留存");
  });

  it("撤銷售出申請(退款給客人):按鈕 [送出並列印收據];送出失敗 → 不印;送出成功(審核中)→ 一張退貨退款收據,標「待核准」", async () => {
    const user = fastUser();
    const fill = async () => {
      const scan = await screen.findByRole("textbox", {
        name: "刷條碼加入張數",
      });
      await user.type(scan, "056527-012{Enter}");
      await screen.findByRole("heading", {
        name: "5164 發大財 · 本號 056527",
      });
      await user.click(screen.getByRole("combobox", { name: "原因" }));
      await user.click(await screen.findByRole("option", { name: "客人退貨" }));
      await user.click(screen.getByRole("button", { name: "送出並列印收據" }));
    };
    const path = `/store/create-page/sale_reversal?org=${STORE_A}`;

    const failing = renderStore({
      path,
      printing: PRINTING,
      formRuntime: {
        failures: {
          CreateAndSubmitFormSubmission: { code: "VALIDATION_FAILED" },
        },
      },
    });
    await fill();
    await waitFor(() => {
      expect(failing.runtime.inputs.createAndSubmitFormSubmission).toHaveLength(
        1,
      );
    });
    await settle();
    expect(failing.printingFake?.created).toEqual([]);
    failing.unmount();

    const { printingFake } = renderStore({
      path,
      printing: PRINTING,
      formRuntime: { submitAs: { status: FormSubmissionStatus.Reviewing } },
    });
    await fill();
    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      documentType: "lottery-store-sale-refund",
      refType: "lottery-store-sale-refund",
    });
    const text = printedText();
    expect(text).toContain("退貨退款收據");
    expect(text).toContain("待核准");
    expect(text).toContain("5164 發大財");
    expect(text).toContain("#012");
  });

  it("撤銷售出申請(不退款給客人)→ 按鈕 [送出]、送出後不印", async () => {
    const user = fastUser();
    const { printingFake, runtime } = renderStore({
      path: `/store/create-page/sale_reversal?org=${STORE_A}`,
      printing: PRINTING,
    });
    const scan = await screen.findByRole("textbox", {
      name: "刷條碼加入張數",
    });
    await user.type(scan, "056527-012{Enter}");
    await screen.findByRole("heading", { name: "5164 發大財 · 本號 056527" });
    await user.click(screen.getByRole("combobox", { name: "原因" }));
    await user.click(await screen.findByRole("option", { name: "客人退貨" }));
    await user.click(screen.getByRole("radio", { name: "否" }));
    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(runtime.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    await settle();
    expect(printingFake?.created).toEqual([]);
  });

  it("結帳確認申請檢視頁:頁首 [列印] 印交班結帳單(和送出時同一份版面)", async () => {
    const user = fastUser();
    const { printingFake } = renderStore({
      path: "/store/view-page/sub-checkout-42",
      printing: PRINTING,
    });
    await screen.findByRole("button", { name: "列印" });
    // 停用時 Tooltip 會包一層,可以按之後按鈕節點會換新:每次重新找
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "列印" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "列印" }));
    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      documentType: "lottery-store-shift-checkout",
      refId: "sub-checkout-42",
    });
    expect(printedText()).toContain("交班結帳單");
  });
});
