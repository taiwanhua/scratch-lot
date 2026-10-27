import { describe, expect, it, jest } from "@jest/globals";
import { cleanup, screen, waitFor } from "@testing-library/react";

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

/** 審核實例(`instanceFragment`)的建立時間是 STAMP:之前 = 上一次送出時就出貨的,之後 = 這次才出貨的。 */
const BEFORE = "2026-09-19T08:00:00.000Z";
const AFTER = "2026-09-20T03:00:00.000Z";

/**
 * 送出之後的點收區塊:每一列的出貨時間(null = 還沒出貨);本號依序 056501、056502…
 * 預設一列、這次才出貨(第一關被跳過 → 送出當下就出貨)。
 */
const receivingAfterSubmit = (
  shippedAts: readonly (string | null)[] = [AFTER],
) => {
  server.use(
    api.query("LotteryTransferReceiving", ({ variables }) => {
      const { submissionId } = variables as { submissionId: string };
      const receiving = transferReceiving("doc-t8");
      const [template] = receiving.rows;
      return HttpResponse.json({
        data: {
          lotteryTransferReceiving: {
            ...receiving,
            submissionId,
            rows: shippedAts.map((shippedAt, index) => ({
              ...template,
              rowId: `row-${String(index + 1)}`,
              bookNo: `00565${String(index + 1).padStart(2, "0")}`,
              shipped: shippedAt !== null,
              shippedAt,
            })),
          },
        },
      });
    }),
  );
};

const submitOneBook = async (user: ReturnType<typeof userEvent.setup>) => {
  const scan = await screen.findByRole("textbox", { name: "刷條碼加入選取" });
  await user.type(scan, "5201-1-001233-050-0-6{Enter}");
  await screen.findByRole("table", { name: /^調貨明細/ });
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
    receivingAfterSubmit();

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
    receivingAfterSubmit();

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

  it("退回後重送(使用者 10/21 定案):第一次印 5 本;補 2 本重送 → 只印新的 2 本;沒新增就重送 → 不印", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const resend = async (shippedAts: (string | null)[]) => {
      const { printingFake } = renderTransferPage({
        path: "/purchasing/transfer/edit-page/sub-t9",
        printing: {},
        ...submitInto("skipped"),
      });
      receivingAfterSubmit(shippedAts);
      await user.click(await screen.findByRole("button", { name: "送出" }));
      return printingFake;
    };
    const textOf = () => receiptPngOf.mock.calls.at(-1)?.[0].textContent ?? "";

    const first = await resend(Array.from({ length: 5 }, () => AFTER));
    await waitFor(() => {
      expect(first?.created).toHaveLength(1);
    });
    expect(textOf()).toContain("5164 · 056501");
    expect(textOf()).toContain("5164 · 056505");
    cleanup();

    const second = await resend([
      ...Array.from({ length: 5 }, () => BEFORE),
      AFTER,
      AFTER,
    ]);
    await waitFor(() => {
      expect(second?.created).toHaveLength(1);
    });
    expect(textOf()).toContain("5164 · 056506");
    expect(textOf()).toContain("5164 · 056507");
    expect(textOf()).not.toContain("056501");
    cleanup();

    receiptPngOf.mockClear();
    const third = await resend(Array.from({ length: 7 }, () => BEFORE));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "送出" })).toBeNull();
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
    expect(third?.created).toEqual([]);
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
    receivingAfterSubmit();

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
