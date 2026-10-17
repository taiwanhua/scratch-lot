import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  WorkflowDecision,
  WorkflowInstanceStatus,
  WorkflowStepStatus,
} from "@repo/graphql";

import {
  APPLY_VIEW_ROUTE,
  HR,
  MANAGER,
  instanceFragment,
  instanceStep,
  planItem,
  taskFragment,
} from "@/test/msw/workflow-fixtures";

import {
  defaultRuntime,
  renderApplyCenter,
} from "../apply-center-test-support";

beforeAll(async () => {
  await import("./ApplyCenterViewPage");
});

/** 採購單三部門平行:財務已通過、法務待審、採購找不到審核者(阻擋)。 */
const parallelInstance = () =>
  instanceFragment({
    status: WorkflowInstanceStatus.Blocked,
    activeStepKeys: ["legal", "purchase"],
    abilities: { canWithdraw: false, canManage: true },
    steps: [
      instanceStep("review", "原部門初審", {
        status: WorkflowStepStatus.Completed,
        plan: [planItem("review-1", MANAGER)],
        decisions: [
          {
            taskKey: "review-1",
            user: MANAGER,
            decision: "approved",
            comment: null,
            at: "2026-09-20T02:00:00.000Z",
          },
        ],
      }),
      instanceStep("finance", "財務部審核", {
        status: WorkflowStepStatus.Completed,
      }),
      instanceStep("legal", "法務部審核", {
        mode: "all",
        status: WorkflowStepStatus.Active,
        plan: [planItem("legal-1", HR)],
      }),
      instanceStep("purchase", "採購部審核", {
        status: WorkflowStepStatus.Active,
        blocked: true,
      }),
      instanceStep("merge", "三部門匯合", {
        kind: "join",
        mode: null,
        allowReturn: false,
      }),
      instanceStep("confirm", "原部門確認"),
    ],
  });

const progressRows = async () =>
  within(await screen.findByRole("list", { name: "關卡進度" })).getAllByRole(
    "listitem",
  );

describe("申請中心詳情頁(view-page)", () => {
  it("該修訂的快照唯讀渲染 + 審核區塊;分支進度每個節點一列(已通過 / 審核中 / 待處理 / 等待所有分支)", async () => {
    renderApplyCenter({
      path: `${APPLY_VIEW_ROUTE}/inst-1`,
      runtime: { ...defaultRuntime(), instances: [parallelInstance()] },
    });

    expect(
      await screen.findByRole("heading", { name: "檢視・病假三天" }),
    ).toBeInTheDocument();
    expect(await screen.findByDisplayValue("病假")).toBeInTheDocument();
    const rows = await progressRows();
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "原部門初審:已通過",
      "財務部審核:已通過",
      "法務部審核:審核中",
      "採購部審核:待處理",
      "三部門匯合:等待所有分支",
      "原部門確認:還沒到",
    ]);
    expect(
      screen.getByText("目前關卡:法務部審核、採購部審核"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/有關卡找不到審核者或審核者已失效/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重試推進" }),
    ).toBeInTheDocument();
  });

  it("我的任務:核准理由選填;駁回理由必填(沒寫不能送)→ decideTask 帶 editVersion 與理由", async () => {
    const { user, runtime } = renderApplyCenter({
      path: `${APPLY_VIEW_ROUTE}/inst-1`,
    });
    const actions = await screen.findByRole("group", {
      name: "我在「直屬主管」的審核",
    });

    await user.click(within(actions).getByRole("button", { name: "駁回" }));
    const dialog = await screen.findByRole("dialog", {
      name: "駁回「直屬主管」",
    });
    const confirm = within(dialog).getByRole("button", { name: "駁回" });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByRole("textbox", { name: "理由" }),
      "日期不對",
    );
    await user.click(confirm);

    await waitFor(() => {
      expect(runtime.inputs.decide).toEqual([
        {
          taskId: "task-manager-1",
          expectedEditVersion: 1,
          decision: WorkflowDecision.Reject,
          comment: "日期不對",
        },
      ]);
    });
  });

  it("此關已結束(STEP_CLOSED)→ 提示「此關已結束」並重載", async () => {
    const { user } = renderApplyCenter({
      path: `${APPLY_VIEW_ROUTE}/inst-1`,
      runtime: { ...defaultRuntime(), closedTaskIds: ["task-manager-1"] },
    });
    const actions = await screen.findByRole("group", {
      name: "我在「直屬主管」的審核",
    });

    await user.click(within(actions).getByRole("button", { name: "核准" }));
    const dialog = await screen.findByRole("dialog", {
      name: "核准「直屬主管」",
    });
    await user.click(within(dialog).getByRole("button", { name: "核准" }));

    expect(
      await screen.findByText("此關已結束或任務已變更,已重新載入最新狀態。"),
    ).toBeInTheDocument();
  });

  it("核准後關卡進度記上「小華(已核准)」,任務鈕消失;時間軸列出送出與派任", async () => {
    const { user } = renderApplyCenter({
      path: `${APPLY_VIEW_ROUTE}/inst-1`,
      runtime: {
        ...defaultRuntime(),
        tasks: [taskFragment({ id: "task-manager-1" })],
      },
    });
    const actions = await screen.findByRole("group", {
      name: "我在「直屬主管」的審核",
    });
    const timeline = screen.getByRole("region", { name: "審核歷程" });
    expect(within(timeline).getByText("送出審核")).toBeInTheDocument();
    expect(
      within(timeline).getByText("「直屬主管」派給 小華"),
    ).toBeInTheDocument();

    await user.click(within(actions).getByRole("button", { name: "核准" }));
    await user.click(
      within(
        await screen.findByRole("dialog", { name: "核准「直屬主管」" }),
      ).getByRole("button", { name: "核准" }),
    );

    expect(await screen.findByText("小華(已核准)")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole("group", { name: "我在「直屬主管」的審核" }),
      ).not.toBeInTheDocument();
    });
  });

  it("這一關不允許退回 → 不出現「退回修改」;全案終局時匯合節點顯示「已結束」", async () => {
    renderApplyCenter({
      path: `${APPLY_VIEW_ROUTE}/inst-1`,
      runtime: {
        ...defaultRuntime(),
        instances: [
          instanceFragment({
            steps: [
              instanceStep("manager", "直屬主管", {
                status: WorkflowStepStatus.Active,
                allowReturn: false,
                plan: [planItem("manager-1", MANAGER)],
              }),
              instanceStep("merge", "三部門匯合", {
                kind: "join",
                mode: null,
                allowReturn: false,
                status: WorkflowStepStatus.Terminated,
              }),
            ],
          }),
        ],
      },
    });
    const actions = await screen.findByRole("group", {
      name: "我在「直屬主管」的審核",
    });

    expect(
      within(actions).getByRole("button", { name: "核准" }),
    ).toBeInTheDocument();
    expect(
      within(actions).queryByRole("button", { name: "退回修改" }),
    ).not.toBeInTheDocument();
    const rows = await progressRows();
    expect(rows.map((row) => row.getAttribute("aria-label"))).toContain(
      "三部門匯合:已結束",
    );
  });

  it("時間軸寫出跳過是哪一項成立、自動通過的原因(B4 / B5)", async () => {
    const event = (
      kind: string,
      stepKey: string,
      reason: string | null,
      who: typeof MANAGER | null = null,
      code: string | null = null,
    ) => ({
      at: "2026-09-20T02:00:00.000Z",
      kind,
      stepKey,
      taskKey: who === null ? null : `${stepKey}-1`,
      user: who,
      toUser: null,
      comment: null,
      result: null,
      reason,
      code,
    });
    renderApplyCenter({
      path: `${APPLY_VIEW_ROUTE}/inst-1`,
      runtime: {
        ...defaultRuntime(),
        instances: [
          instanceFragment({
            steps: [
              instanceStep("store", "分店主管", {
                status: WorkflowStepStatus.Skipped,
              }),
              instanceStep("finance", "財務", {
                status: WorkflowStepStatus.Skipped,
              }),
              instanceStep("manager", "直屬主管", {
                status: WorkflowStepStatus.Completed,
              }),
              instanceStep("hr", "人資", {
                status: WorkflowStepStatus.Active,
              }),
            ],
            history: [
              event("step_skipped", "store", "skip_orgs"),
              event("step_skipped", "finance", "skip_condition"),
              event("approved", "manager", "auto_applicant", MANAGER),
              event("approved", "hr", "auto_prior_approver", HR),
              event("approved", "hr", null, HR),
              event(
                "auto_approve_blocked",
                "manager",
                "auto_applicant",
                MANAGER,
                "UNKNOWN_PROJECT_CODE",
              ),
              event(
                "auto_approve_blocked",
                "hr",
                "auto_prior_approver",
                HR,
                "UNKNOWN_PROJECT_CODE",
              ),
            ],
          }),
        ],
      },
    });
    const timeline = await screen.findByRole("region", { name: "審核歷程" });
    expect(
      within(timeline).getByText("「分店主管」申請人屬於指定的組織,略過"),
    ).toBeInTheDocument();
    expect(
      within(timeline).getByText("「財務」符合跳過條件,略過"),
    ).toBeInTheDocument();
    expect(
      within(timeline).getByText(
        "小華 在「直屬主管」核准(申請人是審核者,自動通過)",
      ),
    ).toBeInTheDocument();
    expect(
      within(timeline).getByText(
        "人資阿美 在「人資」核准(已在前關核准,自動通過)",
      ),
    ).toBeInTheDocument();
    // 自動通過被守門擋下:專案沒有 `admin.lifecycle.<碼>` 文案 → 中性通用句
    expect(
      within(timeline).getByText(
        "「直屬主管」申請人自動通過未成立:目前不符合自動通過的條件",
      ),
    ).toBeInTheDocument();
    expect(
      within(timeline).getByText(
        "「人資」人資阿美 已在前關核准,自動通過未成立:目前不符合自動通過的條件",
      ),
    ).toBeInTheDocument();
    // 人按的核准沒有原因:照事件種類
    expect(
      within(timeline).getByText("人資阿美 在「人資」核准"),
    ).toBeInTheDocument();
  });
  it("代理派任(B15):進度寫「代理人(代理 原審核者)」,時間軸寫「由代理人代理原審核者」", async () => {
    renderApplyCenter({
      path: `${APPLY_VIEW_ROUTE}/inst-1`,
      runtime: {
        ...defaultRuntime(),
        instances: [
          instanceFragment({
            steps: [
              instanceStep("manager", "直屬主管", {
                status: WorkflowStepStatus.Active,
                plan: [planItem("manager-1", HR, { delegator: MANAGER })],
              }),
            ],
            history: [
              {
                at: "2026-09-20T02:00:00.000Z",
                kind: "task_created",
                stepKey: "manager",
                taskKey: "manager-1",
                user: HR,
                toUser: null,
                comment: null,
                result: null,
                reason: null,
                code: null,
                delegator: MANAGER,
              },
            ],
          }),
        ],
      },
    });
    const timeline = await screen.findByRole("region", { name: "審核歷程" });
    expect(
      within(timeline).getByText("「直屬主管」由 人資阿美 代理 小華"),
    ).toBeInTheDocument();
    const rows = await progressRows();
    expect(rows[0]).toHaveTextContent("人資阿美(代理 小華)");
  });
});
