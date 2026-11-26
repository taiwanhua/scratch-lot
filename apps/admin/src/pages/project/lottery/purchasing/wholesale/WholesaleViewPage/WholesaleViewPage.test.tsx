import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { WorkflowStepStatus } from "@repo/graphql";

import { wholesaleSubmissions } from "@/test/msw/project/lottery/wholesale-fixtures";
import {
  MANAGER,
  applyCenterModules,
  instanceFragment,
  instanceStep,
  planItem,
  taskFragment,
} from "@/test/msw/workflow-fixtures";

import { renderWholesalePage } from "../wholesale-test-support";

const VIEW = "/purchasing/wholesale/view-page";

/** 批售單的替換檢視頁與申請中心的區塊(規格 21.3、21.4;Figma WS-03a、WS-03b、WS-03c、WS-03d、WS-04)。 */
describe("批售單檢視頁", () => {
  it("收到錢再核准・審核中:標頭、批售中的本、結算(待收 17,200)與「還差 17,200 元沒收」", async () => {
    renderWholesalePage({ path: `${VIEW}/doc-w1` });
    expect(
      await screen.findByRole("heading", { name: "批售單 W-0001" }),
    ).toBeInTheDocument();
    expect(screen.getByText("出貨確認")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "中山店 → 好運彩券行 · 2 本 · 收款方式 收到錢再核准 · 批售金額 37,200",
      ),
    ).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "5164 發大財" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "遊戲 / 本號",
      "張數",
      "整本金額",
      "批購金額率",
      "批售金額",
      "狀態",
    ]);
    expect(within(table).getAllByText("批售中")).toHaveLength(2);
    expect(within(table).getAllByText("93%")).toHaveLength(2);
    expect(await screen.findByText("待收")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收款" })).toBeInTheDocument();
    expect(screen.getByText("還差 17,200 元沒收")).toBeInTheDocument();
  });

  it("多收:提示「多收 300 元,請先記退款」", async () => {
    renderWholesalePage({
      path: `${VIEW}/doc-w1`,
      wholesale: { received: 37_500 },
    });
    expect(
      await screen.findByText("多收 300 元,請先記退款"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退款" })).toBeInTheDocument();
  });

  it("從帳戶入帳・審核中:批售金額 / 已收 0 與核准時自動入帳的說明,沒有 [收款]", async () => {
    renderWholesalePage({ path: `${VIEW}/doc-w2` });
    expect(
      await screen.findByText(
        "核准時自動入帳 19,000 到 台銀 中山分行 ····12345(批售收入);核准前不能收款",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/收款方式 從帳戶入帳\(台銀 中山分行 ····12345\)/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "收款" })).toBeNull();
  });

  it("已完成:本是「已批售」;沒有 [刪除]", async () => {
    renderWholesalePage({ path: `${VIEW}/doc-w4` });
    expect(await screen.findByText("已批售")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /刪除/ })).toBeNull();
  });

  it("草稿:沒有結算區;本人可刪可編輯", async () => {
    renderWholesalePage({ path: `${VIEW}/sub-w3` });
    expect(
      await screen.findByRole("heading", { name: "批售單" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /刪除/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("結算")).toBeNull();
  });
});

describe("批售單在申請中心", () => {
  it("出貨確認:同一份本清單與結算區塊,店長在審核頁看得到 [收款] 與 [核准]", async () => {
    renderWholesalePage({
      path: "/apply-center/view-page/inst-w1",
      extraModules: applyCenterModules(),
      forms: {
        submissions: wholesaleSubmissions().map((submission) =>
          submission.id === "doc-w1"
            ? { ...submission, currentInstanceId: "inst-w1" }
            : submission,
        ),
      },
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
                plan: [planItem("ship-1", MANAGER, { taskId: "task-ship" })],
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
    expect(
      await screen.findByRole("table", { name: "5164 發大財" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "收款" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "核准" })).toBeInTheDocument();
    });
  });
});
