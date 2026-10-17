import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { WorkflowTaskStatus } from "@repo/graphql";

import { APPLY_CENTER_ROUTE, taskFragment } from "@/test/msw/workflow-fixtures";
import { currentSearch } from "@/test/url-reload";
import { setupFakeViewport } from "@/test/viewport";

import {
  defaultRuntime,
  renderApplyCenter,
} from "../apply-center-test-support";

setupFakeViewport();

beforeAll(async () => {
  await import("./ApplyCenterPage");
});

const TASKS_ROUTE = `${APPLY_CENTER_ROUTE}?tab=tasks`;

/** 三張待我審核的單:甲照常、乙被專案守門擋下、丙已被別人處理。 */
const threeTasks = () => [
  taskFragment({ id: "task-a", instanceId: "inst-a" }),
  taskFragment({
    id: "task-b",
    instanceId: "inst-b",
    summary: { title: "事假一天", date: null, amount: null },
  }),
  taskFragment({
    id: "task-c",
    instanceId: "inst-c",
    summary: { title: "出差三天", date: null, amount: null },
  }),
];

describe("申請中心:批次核准(底座規格 3.10 B18,Figma BS-07a / BS-07b)", () => {
  it("勾選 3 筆 → [核准(3)] 填共同意見 → 結果逐筆列出;失敗的保持勾選、成功的離開清單", async () => {
    const { user, runtime } = renderApplyCenter({
      path: TASKS_ROUTE,
      runtime: {
        ...defaultRuntime(),
        tasks: threeTasks(),
        blockedTaskReasons: { "task-b": "LEAVE_QUOTA_SHORT" },
        closedTaskIds: ["task-c"],
      },
    });
    const table = await screen.findByRole("table", { name: "待我審核" });
    await within(table).findByText("出差三天");
    expect(screen.queryByText(/^已選/)).toBeNull();

    await user.click(
      screen.getByRole("checkbox", { name: "勾選「病假三天」" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "勾選「事假一天」" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "勾選「出差三天」" }),
    );
    expect(screen.getByText("已選 3 筆")).toBeInTheDocument();
    expect(
      screen.getByText("只能批次核准;駁回、退回請逐筆處理"),
    ).toBeInTheDocument();
    // 勾選屬大量資料,不放網址(10.1)
    expect(currentSearch()).not.toContain("task-");

    await user.click(screen.getByRole("button", { name: "核准(3)" }));
    const dialog = await screen.findByRole("dialog", { name: "批次核准" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "共同意見(選填)" }),
      "同意",
    );
    await user.click(within(dialog).getByRole("button", { name: "核准 3 筆" }));

    expect(
      await within(dialog).findByText("1 筆已核准,2 筆未完成(其他筆不受影響)"),
    ).toBeInTheDocument();
    expect(runtime.inputs.batchApprove).toEqual([
      { taskIds: ["task-a", "task-b", "task-c"], comment: "同意" },
    ]);
    const results = within(dialog).getByRole("table", { name: "批次核准結果" });
    const rowOf = (title: string) => {
      const row = within(results).getByText(title).closest("tr");
      if (row === null) {
        throw new Error(`結果表沒有「${title}」`);
      }
      return within(row);
    };
    expect(rowOf("病假三天").getByText("已核准")).toBeInTheDocument();
    expect(rowOf("事假一天").getByText(/^被擋下:/)).toBeInTheDocument();
    expect(rowOf("出差三天").getByText("這件已不在你手上")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "關閉" }));
    await waitFor(() => {
      expect(within(table).queryByText("病假三天")).not.toBeInTheDocument();
    });
    expect(screen.getByText("已選 2 筆")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "勾選「事假一天」" }),
    ).toBeChecked();
  });

  it("全部成功 → 結果寫「N 筆已核准」;按「清除」取消全部勾選", async () => {
    const { user } = renderApplyCenter({
      path: TASKS_ROUTE,
      runtime: { ...defaultRuntime(), tasks: threeTasks().slice(0, 2) },
    });
    const table = await screen.findByRole("table", { name: "待我審核" });
    await within(table).findByText("事假一天");

    await user.click(screen.getByRole("checkbox", { name: "全選本頁" }));
    expect(screen.getByText("已選 2 筆")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清除" }));
    expect(screen.queryByText(/^已選/)).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "全選本頁" }));
    await user.click(screen.getByRole("button", { name: "核准(2)" }));
    const dialog = await screen.findByRole("dialog", { name: "批次核准" });
    await user.click(within(dialog).getByRole("button", { name: "核准 2 筆" }));
    expect(await within(dialog).findByText("2 筆已核准")).toBeInTheDocument();
  });

  it("已處理的清單沒有勾選框;換篩選條件時清掉勾選", async () => {
    const { user } = renderApplyCenter({
      path: TASKS_ROUTE,
      runtime: {
        ...defaultRuntime(),
        tasks: [
          ...threeTasks().slice(0, 1),
          taskFragment({
            id: "task-done",
            instanceId: "inst-done",
            status: WorkflowTaskStatus.Approved,
          }),
        ],
      },
    });
    const table = await screen.findByRole("table", { name: "待我審核" });
    await within(table).findByText("病假三天");
    await user.click(
      screen.getByRole("checkbox", { name: "勾選「病假三天」" }),
    );
    expect(screen.getByText("已選 1 筆")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "處理狀態" }));
    await user.click(await screen.findByRole("option", { name: "已處理" }));
    // 已處理沒有列勾選(表格換了一個,重新取)
    await waitFor(() => {
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    });
    expect(screen.getByRole("table", { name: "待我審核" })).not.toBe(table);
    expect(screen.queryByText(/^已選/)).toBeNull();
  });
});
