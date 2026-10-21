import { describe, expect, it, jest } from "@jest/globals";
import { screen, within } from "@testing-library/react";
import { createElement, useEffect } from "react";

import {
  type ApprovalReviewProps,
  WorkflowExtensionsContext,
} from "@/hooks/base/useWorkflowExtensions";
import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import { server } from "@/test/msw/server";
import { instanceFragment, taskFragment } from "@/test/msw/workflow-fixtures";
import { renderApp } from "@/test/render";

import { MyTask } from "./MyTask";

/** 測試用的審核畫面擴充:畫一句警告,`blocked` 時停用 [核准]。 */
const reviewOf = (blocked: boolean) => {
  const Review = ({ task, onStateChange }: ApprovalReviewProps) => {
    useEffect(() => {
      onStateChange({ approveDisabled: blocked });
    }, [onStateChange]);
    return createElement("p", null, `警告:${task.stepName}`);
  };
  return Review;
};

const renderMyTask = (reviews: ReturnType<typeof reviewOf>[]) => {
  server.use(
    ...authWorld({ hasRefreshCookie: true, modules: [overviewModule] })
      .handlers,
  );
  const reviewsOf = jest.fn<(moduleKey: string) => typeof reviews>(
    () => reviews,
  );
  renderApp({
    path: "/overview",
    extra: createElement(
      WorkflowExtensionsContext.Provider,
      { value: { notify: jest.fn(), reviewsOf } },
      createElement(MyTask, {
        instance: instanceFragment(),
        task: taskFragment(),
        onDecided: jest.fn(),
      }),
    ),
  });
  return { reviewsOf };
};

/**
 * 依模組登記的審核畫面擴充(`Review`;`docs/modules/workflows.md`「依模組登記的審核擴充」):
 * 不論審核區塊掛在哪一頁,我的任務上方畫模組的警告、回報 `approveDisabled` 就停用 [核准]。
 */
describe("我的任務:模組登記的審核畫面擴充", () => {
  it("回報停用 → 任務上方顯示警告、[核准] 停用,[駁回] [退回修改] 照常", async () => {
    const { reviewsOf } = renderMyTask([reviewOf(true)]);

    expect(await screen.findByText("警告:直屬主管")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: /直屬主管/ });
    expect(within(group).getByRole("button", { name: "核准" })).toBeDisabled();
    expect(within(group).getByRole("button", { name: "駁回" })).toBeEnabled();
    expect(reviewsOf).toHaveBeenCalledWith(instanceFragment().moduleKey);
  });

  it("沒有回報停用 / 沒有登記 → [核准] 照常", async () => {
    renderMyTask([reviewOf(false)]);

    expect(await screen.findByText("警告:直屬主管")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "核准" })).toBeEnabled();
  });
});
