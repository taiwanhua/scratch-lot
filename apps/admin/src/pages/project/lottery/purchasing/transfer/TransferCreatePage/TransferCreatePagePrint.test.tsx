import { describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

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
const { HttpResponse } = await import("msw");
const { renderTransferPage } = await import("../transfer-test-support");
const { api, server } = await import("@/test/msw/server");
const { transferReceiving } =
  await import("@/test/msw/project/lottery/transfer-fixtures");
const { FormSubmissionStatus, WorkflowStepStatus } =
  await import("@repo/graphql");
const { instanceFragment, instanceStep } =
  await import("@/test/msw/workflow-fixtures");

/**
 * 送出後的審核實例:第一關「出貨確認」被跳過(出貨分店的人自己送)或還在進行中。
 * 送出(新增頁 / 引擎編輯頁)都回這個實例。
 */
const submitInto = (firstStep: "skipped" | "active") => ({
  forms: {
    submitAs: {
      status: FormSubmissionStatus.Reviewing,
      instanceId: "inst-submitted",
    },
  },
  workflow: {
    instances: [
      instanceFragment({
        id: "inst-submitted",
        moduleKey: "purchasing.transfer",
        formKey: "transfer",
        activeStepKeys: [firstStep === "skipped" ? "receive" : "ship"],
        steps: [
          instanceStep("ship", "出貨確認", {
            status:
              firstStep === "skipped"
                ? WorkflowStepStatus.Skipped
                : WorkflowStepStatus.Active,
          }),
          instanceStep("receive", "點收", {
            status:
              firstStep === "skipped"
                ? WorkflowStepStatus.Active
                : WorkflowStepStatus.Pending,
          }),
        ],
      }),
    ],
  },
});

const CREATE = "/purchasing/transfer/create-page/transfer";

/** 送出之後的點收區塊:`shipped` = 第一關有沒有被跳過(出貨分店的人自己送 → 送出當下就出貨)。 */
const receivingAfterSubmit = (shipped: boolean) => {
  server.use(
    api.query("LotteryTransferReceiving", ({ variables }) => {
      const { submissionId } = variables as { submissionId: string };
      const receiving = transferReceiving("doc-t8");
      return HttpResponse.json({
        data: {
          lotteryTransferReceiving: {
            ...receiving,
            submissionId,
            rows: receiving.rows.map((row) => ({ ...row, shipped })),
          },
        },
      });
    }),
  );
};

const submitOneBook = async (user: ReturnType<typeof userEvent.setup>) => {
  const scan = await screen.findByRole("textbox", { name: "刷條碼加入選取" });
  await user.type(scan, "5201-1-001233-050-0-6{Enter}");
  await screen.findByRole("table", { name: "調貨明細" });
  await user.click(screen.getByRole("button", { name: "送出" }));
};

/**
 * 調貨出貨單「第一關通過後(含跳過)」的跳過那一半(規格第 12 章):送出時第一關被跳過就印 ——
 * 新增頁送出、引擎編輯頁重新送出都一樣(依模組登記的送出後動作,`TransferShipmentEffect`)。
 */
describe("調貨單送出時第一關被跳過 → 調貨出貨單", () => {
  it("新增頁送出、第一關被跳過(送出當下就出貨)→ 送出一個列印工作", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake, formsFake } = renderTransferPage({
      path: `${CREATE}?requisition=R-0022&to=org-store-b`,
      printing: {},
      ...submitInto("skipped"),
    });
    receivingAfterSubmit(true);

    await submitOneBook(user);

    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(formsFake.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    expect(printingFake?.created[0]).toMatchObject({
      documentType: "lottery-transfer-shipment",
      refType: "lottery-transfer-shipment",
    });
    expect(receiptPngOf.mock.calls.at(-1)?.[0].textContent).toContain(
      "調貨出貨單",
    );
  });

  it("第一關沒被跳過(還在出貨確認)→ 不印", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake, formsFake } = renderTransferPage({
      path: `${CREATE}?requisition=R-0022&to=org-store-b`,
      printing: {},
      ...submitInto("active"),
    });
    receivingAfterSubmit(true);

    await submitOneBook(user);

    await waitFor(() => {
      expect(formsFake.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "送出" })).toBeNull();
    });
    expect(printingFake?.created).toEqual([]);
    expect(receiptPngOf).not.toHaveBeenCalled();
  });

  it("引擎編輯頁重新送出、第一關被跳過 → 送出一個列印工作", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake, formsFake } = renderTransferPage({
      path: "/purchasing/transfer/edit-page/sub-t9",
      printing: {},
      ...submitInto("skipped"),
    });
    receivingAfterSubmit(true);

    await user.click(await screen.findByRole("button", { name: "送出" }));

    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(formsFake.inputs.submitFormSubmission).toHaveLength(1);
    expect(printingFake?.created[0]).toMatchObject({
      refType: "lottery-transfer-shipment",
      refId: "sub-t9",
    });
  });
});
