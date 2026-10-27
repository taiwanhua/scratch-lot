import { describe, expect, it, jest } from "@jest/globals";
import { screen } from "@testing-library/react";
import { createElement } from "react";

import type { ApplyCenterSectionProps } from "@/hooks/base/useWorkflowExtensions";
import {
  APPLY_VIEW_ROUTE,
  DEMO_GROUP_FORM_KEY,
} from "@/test/msw/workflow-fixtures";

/**
 * 依模組登記的審核擴充 `Section`(申請中心詳情頁的表單專屬區塊;`docs/modules/workflows.md`「依模組登記的審核擴充」):
 * 底座的登記換成測試用的兩筆(示範表單有、別的模組有),組裝入口、路由、殼都是真的
 * (ESM 要先登記 mock 再動態載入)。沒有登記的模組 = 原本的畫面,見 `ApplyCenterViewPage.test.tsx`。
 */
const DemoSection = ({ instance, submission }: ApplyCenterSectionProps) =>
  createElement(
    "p",
    null,
    `專屬區塊:${instance.id} / ${submission.id} 修訂 ${String(submission.revision)}`,
  );
const OtherSection = () => createElement("p", null, "別的模組的區塊");

jest.unstable_mockModule("@/app/base/workflow-extensions", () => ({
  baseWorkflowExtensions: [
    { moduleKey: DEMO_GROUP_FORM_KEY, Section: DemoSection },
    { moduleKey: "other.module", Section: OtherSection },
  ],
}));

const {
  defaultFormRuntime,
  defaultRuntime,
  leaveSubmission,
  renderApplyCenter,
} = await import("../apply-center-test-support");

describe("申請中心詳情頁:表單專屬區塊", () => {
  it("實例是單據目前的實例 → 畫這個模組登記的區塊(拿到實例與單據),在審核區塊上方;別的模組登記的不畫", async () => {
    renderApplyCenter({ path: `${APPLY_VIEW_ROUTE}/inst-1` });
    const section = await screen.findByText(
      "專屬區塊:inst-1 / sub-leave-1 修訂 1",
    );
    const actions = await screen.findByRole("group", {
      name: "我在「直屬主管」的審核",
    });
    expect(
      section.compareDocumentPosition(actions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText("別的模組的區塊")).toBeNull();
  });

  it("看的是舊修訂的實例(單據目前掛別的實例)→ 不畫區塊,快照與審核區塊照常", async () => {
    renderApplyCenter({
      path: `${APPLY_VIEW_ROUTE}/inst-1`,
      runtime: defaultRuntime(),
      forms: {
        ...defaultFormRuntime(),
        submissions: [leaveSubmission({ currentInstanceId: "inst-2" })],
      },
    });
    expect(await screen.findByDisplayValue("病假")).toBeInTheDocument();
    expect(
      await screen.findByRole("list", { name: "關卡進度" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/專屬區塊/)).toBeNull();
  });
});
