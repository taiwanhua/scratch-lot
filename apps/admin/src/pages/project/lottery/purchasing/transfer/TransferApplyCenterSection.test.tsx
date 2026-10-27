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
const { renderTransferPage } = await import("./transfer-test-support");
const { transferSubmissions } =
  await import("@/test/msw/project/lottery/transfer-fixtures");
const { TRANSFER_WRONG_STORE_CODE } =
  await import("@/test/msw/project/lottery/transfer-handlers");
const {
  MANAGER,
  applyCenterModules,
  instanceFragment,
  instanceStep,
  planItem,
  taskFragment,
} = await import("@/test/msw/workflow-fixtures");

const APPLY_VIEW = "/apply-center/view-page/inst-t10";

/** T-0010(新竹店 → 中山店)掛著第二關「點收」的審核實例,任務在登入者(中山店店長)手上。 */
const receiveStage = () => ({
  forms: {
    submissions: transferSubmissions().map((submission) =>
      submission.id === "doc-t10"
        ? { ...submission, currentInstanceId: "inst-t10" }
        : submission,
    ),
  },
  workflow: {
    instances: [
      instanceFragment({
        id: "inst-t10",
        submissionId: "doc-t10",
        moduleKey: "purchasing.transfer",
        moduleName: "調貨單",
        formKey: "transfer",
        formName: "調貨單",
        activeStepKeys: ["receive"],
        steps: [
          instanceStep("ship", "出貨確認", {
            status: WorkflowStepStatus.Completed,
          }),
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
        instanceId: "inst-t10",
        submissionId: "doc-t10",
        moduleKey: "purchasing.transfer",
        formKey: "transfer",
        stepKey: "receive",
        stepName: "點收",
        taskKey: "receive-1",
      }),
    ],
  },
  extraModules: applyCenterModules(),
});

/**
 * 調貨單在申請中心詳情頁的點收區塊(審核擴充 `Section`;規格 8.4 第二關點收):和檢視頁同一個點收區塊
 * (逐張點收、[完成這次點收] 自動列印、送錯分店),畫在審核區塊上方。
 */
describe("申請中心詳情頁:調貨單點收", () => {
  it("選張的列逐張點收 → [其餘全部到齊…];[完成這次點收] 自動印調貨點收單;之後 [核准] 照常", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake, transferFake, workflowFake } = renderTransferPage({
      path: APPLY_VIEW,
      printing: {},
      ...receiveStage(),
    });
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    const actions = await screen.findByRole("group", {
      name: "我在「點收」的審核",
    });
    expect(
      scan.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.type(scan, "0060112045{Enter}");
    expect(await screen.findByText("部分點收 1 / 12")).toBeInTheDocument();
    expect(transferFake.scanned).toEqual(["0060112045"]);
    await user.click(
      await screen.findByRole("button", { name: "其餘全部到齊…" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "都到了,點收" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "完成這次點收(1 本)" }),
    );
    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      documentType: "lottery-transfer-receiving",
      refId: "tbatch-2",
      documentName: "調貨點收單 T-0010(兩聯)",
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

  it("送錯分店:擋下並彈窗提示是哪一家店的哪一張調貨單", async () => {
    const user = userEvent.setup();
    renderTransferPage({ path: APPLY_VIEW, ...receiveStage() });
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    await user.type(scan, `${TRANSFER_WRONG_STORE_CODE}{Enter}`);
    const dialog = await screen.findByRole("dialog", {
      name: "這本不是送到這家店",
    });
    expect(
      within(dialog).getByText(
        "這本屬於送往「台中店」的調貨單 #T-0011,請交給送貨人帶到台中店,本店不用點收。",
      ),
    ).toBeInTheDocument();
  });
});
