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
const { WorkflowStepStatus } = await import("@repo/graphql");
const { renderPurchasePage } = await import("./purchase-test-support");
const { purchaseSubmissions } =
  await import("@/test/msw/project/lottery/purchase-fixtures");
const { WRONG_STORE_CODE } =
  await import("@/test/msw/project/lottery/purchase-handlers");
const {
  MANAGER,
  applyCenterModules,
  instanceFragment,
  instanceStep,
  planItem,
  taskFragment,
} = await import("@/test/msw/workflow-fixtures");

const APPLY_VIEW = "/apply-center/view-page/inst-p33";

/** P-0033 掛著點收關的審核實例,任務在登入者(中山店店長)手上;只有申請中心(通知連結)進來。 */
const receiveStage = () => ({
  forms: {
    submissions: purchaseSubmissions().map((submission) =>
      submission.id === "doc-p33"
        ? { ...submission, currentInstanceId: "inst-p33" }
        : submission,
    ),
  },
  workflow: {
    instances: [
      instanceFragment({
        id: "inst-p33",
        submissionId: "doc-p33",
        moduleKey: "purchasing.purchase",
        moduleName: "進貨單",
        formKey: "purchase",
        formName: "進貨單",
        activeStepKeys: ["receive"],
        steps: [
          instanceStep("receive", "點收", {
            status: WorkflowStepStatus.Active,
            plan: [planItem("receive-1", MANAGER, { taskId: "task-receive" })],
          }),
        ],
      }),
    ],
    tasks: [
      taskFragment({
        id: "task-receive",
        instanceId: "inst-p33",
        submissionId: "doc-p33",
        moduleKey: "purchasing.purchase",
        formKey: "purchase",
        stepKey: "receive",
        stepName: "點收",
        taskKey: "receive-1",
      }),
    ],
  },
  extraModules: applyCenterModules(),
});

/**
 * 進貨單在申請中心詳情頁的點收區塊(審核擴充 `Section`;規格 8.2「店長從申請中心進入,在審核頁逐本刷條碼點收」):
 * 和檢視頁同一個點收區塊,畫在審核區塊上方。
 */
describe("申請中心詳情頁:進貨單點收", () => {
  it("提示與點收區塊在審核區塊上方;刷到單上的本 → 已點收;[完成這次點收] 自動印進貨點收單;之後 [核准] 照常", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake, purchaseFake, workflowFake } = renderPurchasePage({
      path: APPLY_VIEW,
      printing: {},
      ...receiveStage(),
    });
    expect(
      await screen.findByText(/還有 1 本沒點收;核准前要全部點收/),
    ).toBeInTheDocument();
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    const actions = await screen.findByRole("group", {
      name: "我在「點收」的審核",
    });
    // 點收區塊在審核區塊上方
    expect(
      scan.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.type(scan, "0056531099{Enter}");
    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: /5164 發大財 · 200 元.*叫貨 5,已刷 5,已點收 5 \/ 5/,
        }),
      ).toBeInTheDocument();
    });
    expect(purchaseFake.scanned).toEqual(["0056531099"]);
    // 點收進度換上 api 回的那一份:提示跟著消失
    expect(screen.queryByText(/還有 1 本沒點收/)).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "完成這次點收(1 本)" }),
    );
    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      documentType: "lottery-purchase-receiving",
      refId: "batch-1",
      documentName: "進貨點收單 P-0033(兩聯)",
    });

    await user.click(within(actions).getByRole("button", { name: "核准" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /核准|確認/ }));
    await waitFor(() => {
      expect(workflowFake?.inputs.decide).toHaveLength(1);
    });
    expect(workflowFake?.inputs.decide[0]).toMatchObject({
      taskId: "task-receive",
    });
  });

  it("送錯分店:擋下並彈窗提示;[通知總部更正] → 通知建立者", async () => {
    const user = userEvent.setup();
    const { purchaseFake } = renderPurchasePage({
      path: APPLY_VIEW,
      ...receiveStage(),
    });
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    await user.type(scan, `${WRONG_STORE_CODE}{Enter}`);
    const dialog = await screen.findByRole("dialog", {
      name: "這本不是送到這家店",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "通知總部更正" }),
    );
    await waitFor(() => {
      expect(purchaseFake.notified).toEqual([WRONG_STORE_CODE]);
    });
  });
});
