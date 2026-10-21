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
const { HttpResponse } = await import("msw");
const { FormSubmissionStatus, WorkflowStepStatus } =
  await import("@repo/graphql");
const { renderTransferPage } = await import("../transfer-test-support");
const { api, server } = await import("@/test/msw/server");
const { transferReceiving, transferSubmissions } =
  await import("@/test/msw/project/lottery/transfer-fixtures");
const { transferSettlement } =
  await import("@/test/msw/project/lottery/transfer-settlement-fixtures");
const {
  MANAGER,
  applyCenterModules,
  instanceFragment,
  instanceStep,
  planItem,
  taskFragment,
} = await import("@/test/msw/workflow-fixtures");

const VIEW = "/purchasing/transfer/view-page/doc-t8";

/** T-0008 掛著第一關「出貨確認」的審核實例,任務在登入者(中山店店長)手上。 */
const shipStage = () => ({
  forms: {
    submissions: transferSubmissions().map((submission) =>
      submission.id === "doc-t8"
        ? { ...submission, currentInstanceId: "inst-t8" }
        : submission,
    ),
  },
  workflow: {
    instances: [
      instanceFragment({
        id: "inst-t8",
        submissionId: "doc-t8",
        moduleKey: "purchasing.transfer",
        formKey: "transfer",
        activeStepKeys: ["ship"],
        steps: [
          instanceStep("ship", "出貨確認", {
            status: WorkflowStepStatus.Active,
            plan: [planItem("ship-1", MANAGER, { taskId: "task-ship" })],
          }),
          instanceStep("receive", "點收"),
        ],
      }),
    ],
    tasks: [
      taskFragment({
        id: "task-ship",
        instanceId: "inst-t8",
        submissionId: "doc-t8",
        moduleKey: "purchasing.transfer",
        formKey: "transfer",
        stepKey: "ship",
        stepName: "出貨確認",
        taskKey: "ship-1",
      }),
    ],
  },
});

/** 核准之後 api 把明細改成在途(第一關通過的事後動作);假 api 依「決定過了沒」回出貨前 / 後。 */
const shipAfterDecide = (decided: () => boolean) => {
  server.use(
    api.query("LotteryTransferReceiving", () => {
      const receiving = transferReceiving("doc-t8");
      return HttpResponse.json({
        data: {
          lotteryTransferReceiving: {
            ...receiving,
            rows: receiving.rows.map((row) => ({
              ...row,
              shipped: decided(),
            })),
          },
        },
      });
    }),
  );
};

const approve = async (user: ReturnType<typeof userEvent.setup>) => {
  const group = await screen.findByRole("group", {
    name: /出貨確認/,
  });
  await user.click(within(group).getByRole("button", { name: "核准" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: /核准|確認/ }));
};

/**
 * 調貨出貨單、調貨付款收據的列印(規格第 12 章、8.4;Figma RC-06、RC-07)。
 */
describe("調貨單檢視頁:調貨出貨單 / 調貨付款收據", () => {
  it("第一關出貨確認核准 → 送出一個列印工作(調貨出貨單,印出貨分店的印表機):出貨店 → 收貨店、號碼區段、三個簽名欄", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake, workflowFake } = renderTransferPage({
      path: VIEW,
      printing: {},
      ...shipStage(),
    });
    shipAfterDecide(() => (workflowFake?.inputs.decide.length ?? 0) > 0);

    await approve(user);

    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      documentType: "lottery-transfer-shipment",
      refType: "lottery-transfer-shipment",
      refId: "doc-t8",
      documentName: "調貨出貨單 T-0008",
    });
    const text = receiptPngOf.mock.calls.at(-1)?.[0].textContent ?? "";
    expect(text).toContain("調貨出貨單");
    expect(text).toContain("中山店 → 新竹店");
    expect(text).toContain("號碼:#090~099(10 張)");
    expect(text).toContain("出貨人簽名");
    expect(text).toContain("送貨人簽名");
    expect(text).toContain("收貨人簽名");
  });

  it("核准失敗(交易沒成功)→ 不送列印", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const stage = shipStage();
    const { printingFake, workflowFake } = renderTransferPage({
      path: VIEW,
      printing: {},
      ...stage,
      workflow: {
        ...stage.workflow,
        failures: { DecideTask: { code: "FORBIDDEN" } },
      },
    });
    // 就算之後讀到在途,決定沒成功就不該印(不靠「沒有新調出的列」擋)
    shipAfterDecide(() => (workflowFake?.inputs.decide.length ?? 0) > 0);

    await approve(user);

    await screen.findAllByText(/權限|無法|失敗/);
    expect(workflowFake?.inputs.decide).toHaveLength(1);
    expect(printingFake?.created).toEqual([]);
    expect(receiptPngOf).not.toHaveBeenCalled();
  });

  it("從申請中心詳情頁核准第一關(不經調貨單頁)→ 一樣送出一個列印工作(依模組登記的審核後動作)", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake, workflowFake } = renderTransferPage({
      path: "/apply-center/view-page/inst-t8",
      printing: {},
      ...shipStage(),
      extraModules: applyCenterModules(),
    });
    shipAfterDecide(() => (workflowFake?.inputs.decide.length ?? 0) > 0);

    await approve(user);

    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      refType: "lottery-transfer-shipment",
      refId: "doc-t8",
      documentName: "調貨出貨單 T-0008",
    });
    expect(receiptPngOf.mock.calls.at(-1)?.[0].textContent).toContain(
      "號碼:#090~099(10 張)",
    );
  });

  it("收貨店付過現金 → 標頭有「調貨付款收據」[列印];印的是付款店、收款人、現金與送貨人簽收", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake } = renderTransferPage({
      path: "/purchasing/transfer/view-page/doc-t10",
      printing: {},
    });

    const label = await screen.findByText("調貨付款收據");
    const group = label.parentElement;
    if (group === null) throw new Error("找不到付款收據的列印按鈕");
    await waitFor(() => {
      expect(within(group).getByRole("button", { name: "列印" })).toBeEnabled();
    });
    await user.click(within(group).getByRole("button", { name: "列印" }));

    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      refType: "lottery-transfer-payment",
      refId: "cash-t10",
      documentName: "調貨付款收據 T-0010",
    });
    const text = receiptPngOf.mock.calls.at(-1)?.[0].textContent ?? "";
    expect(text).toContain("中山店 · 小金庫");
    expect(text).toContain("王小明(送貨人)");
    expect(text).toContain("19,504");
    expect(text).toContain("送貨人簽收");
    expect(screen.getByText("調貨出貨單")).toBeInTheDocument();
  });

  it("收貨店 [付款] 選現金 → 寫入成功後自動印調貨付款收據;選銀行 → 不印", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake } = renderTransferPage({
      path: "/purchasing/transfer/view-page/doc-t10",
      printing: {},
    });
    const base = transferSettlement("doc-t10");
    if (base === null) throw new Error("缺 T-0010 的收付夾具");
    const [receiver, shipper] = base.sides;
    const [paid] = base.records;
    // 收貨店還沒付:[付款] 先填 1,000
    const unpaid = {
      ...base,
      sides: [
        {
          ...receiver,
          buttons: receiver.buttons.map((button) => ({
            ...button,
            defaultAmount: button.button === "out" ? 1000 : 0,
            canUse: button.button === "out",
          })),
        },
        shipper,
      ],
      records: [],
    };
    let recorded = 0;
    server.use(
      api.query("LotterySettlement", () =>
        HttpResponse.json({ data: { lotterySettlement: { item: unpaid } } }),
      ),
      api.mutation("RecordLotterySettlement", ({ variables }) => {
        recorded += 1;
        const { input } = variables as {
          input: { method: string; handler: string | null };
        };
        const id = `rec-new-${String(recorded)}`;
        return HttpResponse.json({
          data: {
            recordLotterySettlement: {
              recordId: id,
              item: {
                ...unpaid,
                records: [
                  {
                    ...paid,
                    id,
                    method: input.method,
                    cashPlace: input.method === "cash" ? "vault" : null,
                    accountLabel: input.method === "cash" ? null : "台灣銀行",
                    handler: input.handler,
                    amount: 1000,
                  },
                ],
              },
            },
          },
        });
      }),
    );

    const pay = async (method: "現金" | "銀行") => {
      const [payButton] = await screen.findAllByRole("button", {
        name: "付款",
      });
      await user.click(payButton);
      const dialog = await screen.findByRole("dialog", { name: "付款" });
      await user.click(
        within(dialog).getByRole("combobox", { name: "付款方式" }),
      );
      await user.click(await screen.findByRole("option", { name: method }));
      if (method === "現金") {
        await user.type(
          within(dialog).getByRole("textbox", { name: /經手人/ }),
          "王小明(送貨人)",
        );
      } else {
        await user.click(
          within(dialog).getByRole("combobox", { name: /帳戶/ }),
        );
        const [account] = await screen.findAllByRole("option");
        await user.click(account);
      }
      await user.click(within(dialog).getByRole("button", { name: "確認" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "付款" })).toBeNull();
      });
    };

    await pay("現金");
    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      refType: "lottery-transfer-payment",
      refId: "rec-new-1",
    });
    const text = receiptPngOf.mock.calls.at(-1)?.[0].textContent ?? "";
    expect(text).toContain("中山店 · 小金庫");
    expect(text).toContain("1,000");

    await pay("銀行");
    expect(recorded).toBe(2);
    expect(printingFake?.created).toHaveLength(1);
  });

  it("草稿沒有 [列印]", async () => {
    renderTransferPage({
      path: "/purchasing/transfer/view-page/sub-t9",
      printing: {},
    });
    expect(await screen.findByText(/調貨單 T-0009/)).toBeInTheDocument();
    expect(
      transferSubmissions().find((item) => item.id === "sub-t9")?.status,
    ).toBe(FormSubmissionStatus.Draft);
    expect(screen.queryByText("調貨出貨單")).toBeNull();
  });
});
