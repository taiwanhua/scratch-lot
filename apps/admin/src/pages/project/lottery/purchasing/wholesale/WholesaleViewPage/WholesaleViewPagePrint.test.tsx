import { describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

// jsdom 不會畫 canvas:轉圖換成固定的 PNG(受測頁面必須在替身掛上之後才載入,先例 TransferViewPagePrint.test.tsx)
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
const { WorkflowInstanceStatus, WorkflowStepStatus } =
  await import("@repo/graphql");
const { renderWholesalePage } = await import("../wholesale-test-support");
const { api, server } = await import("@/test/msw/server");
const { wholesaleDetail, wholesaleSubmissions } =
  await import("@/test/msw/project/lottery/wholesale-fixtures");
const {
  MANAGER,
  applyCenterModules,
  instanceFragment,
  instanceStep,
  planItem,
  taskFragment,
} = await import("@/test/msw/workflow-fixtures");

const VIEW = "/purchasing/wholesale/view-page";
const SHIPPED_AT = "2026-11-19T02:45:00.000Z";

/** W-0001(收到錢再核准,已收齊 37,200)掛著「出貨確認」的審核實例,任務在登入者(中山店店長)手上。 */
const shipStage = (planned = 1) => ({
  forms: {
    submissions: wholesaleSubmissions().map((submission) =>
      submission.id === "doc-w1"
        ? { ...submission, currentInstanceId: "inst-w1" }
        : submission,
    ),
  },
  wholesale: { received: 37_200 },
  workflow: {
    instances: [
      instanceFragment({
        id: "inst-w1",
        submissionId: "doc-w1",
        moduleKey: "purchasing.wholesale",
        moduleName: "批售單",
        formKey: "wholesale",
        formName: "批售單",
        activeStepKeys: ["ship"],
        steps: [
          instanceStep("ship", "出貨確認", {
            status: WorkflowStepStatus.Active,
            plan: Array.from({ length: planned }, (_, index) =>
              planItem(
                `ship-${String(index + 1)}`,
                MANAGER,
                index === 0 ? { taskId: "task-ship" } : {},
              ),
            ),
          }),
        ],
      }),
    ],
    tasks: [
      taskFragment({
        id: "task-ship",
        instanceId: "inst-w1",
        submissionId: "doc-w1",
        moduleKey: "purchasing.wholesale",
        formKey: "wholesale",
        stepKey: "ship",
        stepName: "出貨確認",
        taskKey: "ship-1",
      }),
    ],
  },
});

/**
 * 核准之後 api 出貨(`completed` 事後動作:寫批售事件 → 有出貨時間);假 api 依「決定過了沒」回出貨前 / 後。
 * `completed` = false:多人核准還沒到齊,審核實例還在進行中、沒有出貨。
 */
const shipAfterDecide = (decided: () => boolean, completed = true) => {
  const [instance] = shipStage().workflow.instances;
  server.use(
    api.query("WorkflowInstance", () => {
      if (!decided()) {
        // 還沒決定:交給審核流程的假 api(它算得出我的任務)
        return;
      }
      const [ship] = instance.steps;
      return HttpResponse.json({
        data: {
          workflowInstance: {
            instance: {
              ...instance,
              myTasks: [],
              status: completed
                ? WorkflowInstanceStatus.Approved
                : WorkflowInstanceStatus.Running,
              activeStepKeys: completed ? [] : ["ship"],
              steps: [
                {
                  ...ship,
                  status: completed
                    ? WorkflowStepStatus.Completed
                    : WorkflowStepStatus.Active,
                },
              ],
            },
          },
        },
      });
    }),
    api.query("LotteryWholesaleDetail", () => {
      const detail = wholesaleDetail("doc-w1", shipStage().forms.submissions);
      return HttpResponse.json({
        data: {
          lotteryWholesaleDetail: {
            ...detail,
            received: 37_200,
            shippedAt: decided() && completed ? SHIPPED_AT : null,
          },
        },
      });
    }),
  );
};

const approve = async (user: ReturnType<typeof userEvent.setup>) => {
  const group = await screen.findByRole("group", { name: /出貨確認/ });
  await user.click(within(group).getByRole("button", { name: "核准" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: /核准|確認/ }));
};

/** 每一次轉圖裡的切紙位置數(兩聯 = 1 個:聯與聯之間)。 */
const cutsOfPrints = () =>
  receiptPngOf.mock.calls.map(
    ([node]) => node.querySelectorAll("[data-receipt58-cut]").length,
  );

const lastPrintText = () =>
  receiptPngOf.mock.calls.at(-1)?.[0].textContent ?? "";

/** 等一下(確認「沒有」送出列印時,讓交易後的動作有時間跑完)。 */
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 300);
  });

/**
 * 批售出貨單、批售收款收據的列印(規格 21.8;驗算 #5、#7;Figma RC-11、RC-12):
 * 兩種都印兩聯(第 1 聯 店鋪留存、第 2 聯 客戶留存)—— 一次列印 = 一個列印工作(兩聯接成一張、中間切紙)。
 */
describe("批售單:批售出貨單 / 批售收款收據", () => {
  it("核准完成(驗算 #7)→ 送出一個列印工作(批售出貨單兩聯):出貨分店 → 批售客戶、本號區段、批售金額、收款方式與已收;不印原成本與獲利", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake, workflowFake } = renderWholesalePage({
      path: `${VIEW}/doc-w1`,
      printing: {},
      ...shipStage(),
    });
    shipAfterDecide(() => (workflowFake?.inputs.decide.length ?? 0) > 0);

    await approve(user);

    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      documentType: "lottery-wholesale-shipment",
      refType: "lottery-wholesale-shipment",
      refId: "doc-w1",
      documentName: "批售出貨單 W-0001(兩聯)",
    });
    expect(cutsOfPrints()).toEqual([1]);
    const text = lastPrintText();
    expect(text).toContain("批售出貨單");
    expect(text).toContain("第 1 聯 · 店鋪留存");
    expect(text).toContain("第 2 聯 · 客戶留存");
    expect(text).toContain("中山店 → 好運彩券行");
    expect(text).toContain("5164 · 056611~056612");
    expect(text).toContain("每本 100 張 · 批購金額率 93%");
    expect(text).toContain("37,200");
    expect(text).toContain("收到錢再核准");
    expect(text).toContain("客戶簽收");
    expect(text).not.toMatch(/成本|獲利/);
  });

  it("多人核准還沒到齊(流程還沒結束、沒有出貨)→ 不印", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake, workflowFake } = renderWholesalePage({
      path: `${VIEW}/doc-w1`,
      printing: {},
      ...shipStage(2),
    });
    shipAfterDecide(() => (workflowFake?.inputs.decide.length ?? 0) > 0, false);

    await approve(user);

    await waitFor(() => {
      expect(workflowFake?.inputs.decide).toHaveLength(1);
    });
    await settle();
    expect(printingFake?.created).toEqual([]);
    expect(receiptPngOf).not.toHaveBeenCalled();
  });

  it("沒有收據機的租戶(沒有 `api.printing.print`):核准照常,不送列印、標頭沒有 [列印]", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { workflowFake } = renderWholesalePage({
      path: `${VIEW}/doc-w1`,
      ...shipStage(),
    });
    shipAfterDecide(() => (workflowFake?.inputs.decide.length ?? 0) > 0);

    await approve(user);

    await waitFor(() => {
      expect(workflowFake?.inputs.decide).toHaveLength(1);
    });
    await settle();
    expect(receiptPngOf).not.toHaveBeenCalled();
    expect(screen.queryByText("批售出貨單")).toBeNull();
    expect(screen.queryByText("批售收款收據")).toBeNull();
  });

  it("從申請中心詳情頁核准(不經批售單頁)→ 一樣送出一個列印工作(依模組登記的審核後動作)", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake, workflowFake } = renderWholesalePage({
      path: "/apply-center/view-page/inst-w1",
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
      refType: "lottery-wholesale-shipment",
      refId: "doc-w1",
      documentName: "批售出貨單 W-0001(兩聯)",
    });
  });

  it("已完成的單:標頭有「批售出貨單」[列印];先選列印哪一聯(預設兩聯都印)→ 一個列印工作", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake } = renderWholesalePage({
      path: `${VIEW}/doc-w4`,
      printing: {},
    });

    const label = await screen.findByText("批售出貨單");
    const group = label.parentElement;
    if (group === null) throw new Error("找不到出貨單的列印按鈕");
    await waitFor(() => {
      expect(within(group).getByRole("button", { name: "列印" })).toBeEnabled();
    });
    await user.click(within(group).getByRole("button", { name: "列印" }));
    const dialog = await screen.findByRole("dialog", { name: "列印" });
    await user.click(within(dialog).getByRole("button", { name: "列印" }));

    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      refType: "lottery-wholesale-shipment",
      refId: "doc-w4",
      documentName: "批售出貨單 W-0004(兩聯)",
    });
    expect(cutsOfPrints()).toEqual([1]);
    expect(lastPrintText()).toContain("5164 · 056614");
  });

  it("草稿沒有 [列印]", async () => {
    renderWholesalePage({ path: `${VIEW}/sub-w3`, printing: {} });
    expect(
      await screen.findByRole("heading", { name: "批售單" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("批售出貨單")).toBeNull();
    expect(screen.queryByText("批售收款收據")).toBeNull();
  });
});
