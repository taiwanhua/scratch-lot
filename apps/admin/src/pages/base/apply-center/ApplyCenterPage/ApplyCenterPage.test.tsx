import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { FormSubmissionStatus, WorkflowTaskStatus } from "@repo/graphql";

import {
  APPLY_CENTER_ROUTE,
  applicationRow,
  taskFragment,
} from "@/test/msw/workflow-fixtures";
import { setupFakeViewport } from "@/test/viewport";

import {
  defaultRuntime,
  renderApplyCenter,
} from "../apply-center-test-support";

setupFakeViewport();

beforeAll(async () => {
  // 懶載入的頁面先載進模組快取(TEST-08)
  await import("./ApplyCenterPage");
});

describe("申請中心", () => {
  it("我的申請:跨模組列出狀態 chip(含待處理)與目前關卡(平行時多個);依狀態篩選", async () => {
    const { user, runtime } = renderApplyCenter({
      path: APPLY_CENTER_ROUTE,
      runtime: {
        ...defaultRuntime(),
        applications: [
          applicationRow({
            blocked: true,
            activeSteps: [
              { stepKey: "finance", name: "財務部審核" },
              { stepKey: "legal", name: "法務部審核" },
            ],
          }),
          applicationRow({
            id: "sub-leave-2",
            status: FormSubmissionStatus.Returned,
            summary: { title: "事假一天", date: null, amount: null },
            activeSteps: [],
          }),
        ],
      },
    });

    const table = await screen.findByRole("table", { name: "我的申請" });
    expect(await within(table).findByText("病假三天")).toBeInTheDocument();
    expect(within(table).getByText("審核中(待處理)")).toBeInTheDocument();
    expect(
      within(table).getByText("財務部審核、法務部審核"),
    ).toBeInTheDocument();
    expect(within(table).getByText("已退回")).toBeInTheDocument();
    expect(
      within(table).getByRole("button", { name: "繼續編輯「事假一天」" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "狀態" }));
    await user.click(await screen.findByRole("option", { name: "已退回" }));

    await waitFor(() => {
      expect(runtime.inputs.myApplications.at(-1)?.status).toBe(
        FormSubmissionStatus.Returned,
      );
    });
  });

  it("待我審核:待處理 / 已處理切換;標題來自實例快照;點「審核」進申請中心詳情", async () => {
    const { user, runtime } = renderApplyCenter({
      path: APPLY_CENTER_ROUTE,
      runtime: {
        ...defaultRuntime(),
        tasks: [
          taskFragment({ id: "task-manager-1" }),
          taskFragment({
            id: "task-old",
            instanceId: "inst-old",
            status: WorkflowTaskStatus.Approved,
            summary: { title: "舊修訂的標題", date: null, amount: null },
          }),
        ],
      },
    });
    await screen.findByRole("table", { name: "我的申請" });

    await user.click(screen.getByRole("tab", { name: /^待我審核/ }));
    const table = await screen.findByRole("table", { name: "待我審核" });
    expect(await within(table).findByText("病假三天")).toBeInTheDocument();
    expect(within(table).getByText("小明")).toBeInTheDocument();
    expect(within(table).queryByText("舊修訂的標題")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "處理狀態" }));
    await user.click(await screen.findByRole("option", { name: "已處理" }));
    // 已處理沒有列勾選,表格換了一個(重新取)
    expect(
      await within(
        await screen.findByRole("table", { name: "待我審核" }),
      ).findByText("舊修訂的標題"),
    ).toBeInTheDocument();
    expect(runtime.inputs.myTasks.at(-1)?.done).toBe(true);
  });

  it("「新申請」:選模組 → 選表單 → 進該模組的新增頁", async () => {
    const { user } = renderApplyCenter({ path: APPLY_CENTER_ROUTE });
    await screen.findByRole("table", { name: "我的申請" });

    await user.click(screen.getByRole("button", { name: "新申請" }));
    const dialog = await screen.findByRole("dialog", { name: "新申請" });
    expect(
      within(dialog).getByRole("combobox", { name: "模組" }),
    ).toHaveTextContent("示範表單(群組內)");
    expect(
      within(dialog).getByRole("combobox", { name: "表單" }),
    ).toHaveTextContent("病假單");
    await user.click(within(dialog).getByRole("button", { name: "前往填寫" }));

    expect(
      await screen.findByRole("heading", { name: /病假單/ }),
    ).toBeInTheDocument();
  });
});
