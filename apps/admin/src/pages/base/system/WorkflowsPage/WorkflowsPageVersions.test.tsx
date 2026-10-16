import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { server } from "@/test/msw/server";
import {
  leaveWorkflowDefinition,
  purchaseWorkflowDefinition,
  workflowFragment,
  workflowVersionFragment,
} from "@/test/msw/workflow-fixtures";
import { workflowRuntimeWorld } from "@/test/msw/workflow-runtime-handlers";
import { setupReactFlowEnvironment } from "@/test/react-flow";

import {
  clickNode,
  defaultDesignOptions,
  findCanvas,
  propertiesPanel,
  renderWorkflows,
} from "./workflows-page-test-support";

setupReactFlowEnvironment();

beforeAll(async () => {
  await import("./WorkflowsPage");
});

const twoWorkflows = () => ({
  ...defaultDesignOptions(),
  workflows: [
    workflowFragment(),
    workflowFragment({
      key: "overtime_review",
      name: "加班審核",
      hasDraft: false,
    }),
  ],
});

describe("流程管理:版本、發布擋錯、未存變更防呆", () => {
  it("發布擋錯(VALIDATION_FAILED)→ 就地列出檢查器指出的問題", async () => {
    const { user } = renderWorkflows({
      world: {
        ...defaultDesignOptions(),
        failures: {
          PublishWorkflowVersion: {
            code: "VALIDATION_FAILED",
            extensions: {
              fields: ["definition"],
              issues: [
                {
                  code: "ROLE_ID_MISSING",
                  message: "關卡「人資」的角色還沒選",
                  location: { stepKey: "hr" },
                },
              ],
            },
          },
        },
      },
    });
    await findCanvas();
    await user.click(screen.getByRole("tab", { name: "流程版本" }));
    await user.click(await screen.findByRole("button", { name: "發布" }));
    const dialog = await screen.findByRole("dialog", { name: "發布草稿" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "變更說明" }),
      "加人資關",
    );

    await user.click(within(dialog).getByRole("button", { name: "發布" }));

    expect(
      await within(dialog).findByText("關卡「人資」的角色還沒選"),
    ).toBeInTheDocument();
  });

  it("設計器有未存的變更:發布跳窗提示並可先存;換流程先問(留下 / 放棄 / 先存)", async () => {
    const { user, world } = renderWorkflows({ world: twoWorkflows() });
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    await user.click(
      within(propertiesPanel()).getByRole("button", { name: "在後面加一關" }),
    );

    await user.click(screen.getByRole("tab", { name: "流程版本" }));
    await user.click(await screen.findByRole("button", { name: "發布" }));
    const dialog = await screen.findByRole("dialog", { name: "發布草稿" });
    expect(
      within(dialog).getByText("設計器有還沒存的變更:發布的是上次存的草稿。"),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "先存草稿" }));
    await user.type(
      within(dialog).getByRole("textbox", { name: "變更說明" }),
      "多一關",
    );
    await user.click(within(dialog).getByRole("button", { name: "發布" }));
    await waitFor(() => {
      expect(world.inputs.publish).toHaveLength(1);
    });
    expect(world.inputs.saveDraft).toHaveLength(1);
    expect(world.inputs.publish[0]?.expectedDraftRevision).toBe(2);
  });

  it("換流程時有未存的變更 → 跳窗;選「留在設計」不換、「放棄變更」才換", async () => {
    const { user } = renderWorkflows({ world: twoWorkflows() });
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    await user.clear(
      within(propertiesPanel()).getByRole("textbox", { name: "名稱" }),
    );
    await user.type(
      within(propertiesPanel()).getByRole("textbox", { name: "名稱" }),
      "人資部",
    );

    const list = screen.getByRole("list", { name: "流程清單" });
    await user.click(within(list).getByText("加班審核"));
    const dialog = await screen.findByRole("dialog", {
      name: "還有沒存的變更",
    });
    await user.click(within(dialog).getByRole("button", { name: "留在設計" }));
    expect(
      screen.getByRole("heading", { name: "病假審核" }),
    ).toBeInTheDocument();

    await user.click(within(list).getByText("加班審核"));
    await user.click(
      within(
        await screen.findByRole("dialog", { name: "還有沒存的變更" }),
      ).getByRole("button", { name: "放棄變更" }),
    );
    expect(
      await screen.findByRole("heading", { name: "加班審核" }),
    ).toBeInTheDocument();
  });

  it("以此為基底建流程(fork):挑已發布版本、填新 key;建好後選中新流程", async () => {
    const { user, world } = renderWorkflows({
      world: {
        ...defaultDesignOptions(),
        workflows: [
          workflowFragment({
            isShared: true,
            ownerOrgId: null,
            abilities: {
              canEdit: false,
              canPublish: false,
              canAssign: false,
              canFork: true,
            },
          }),
        ],
      },
    });
    await screen.findByRole("heading", { name: "病假審核" });

    await user.click(screen.getByRole("button", { name: "以此為基底建流程" }));
    const dialog = await screen.findByRole("dialog", {
      name: "以「病假審核」為基底建流程",
    });
    await user.type(
      within(dialog).getByRole("textbox", { name: "新流程 key" }),
      "a",
    );
    await user.click(within(dialog).getByRole("button", { name: "建立" }));

    await waitFor(() => {
      expect(world.inputs.fork).toHaveLength(1);
    });
    expect(world.inputs.fork[0]).toMatchObject({
      sourceKey: "leave_review",
      sourceVersion: 1,
      key: "leave_review_a",
    });
  });

  it("有阻擋清單權限才出現「阻擋清單」入口,點了進隱藏頁", async () => {
    const { user } = renderWorkflows({
      blockedPermissions: ["system.workflows.blocked-page.reassign"],
      world: {
        ...defaultDesignOptions(),
        versions: {
          leave_review: [
            workflowVersionFragment(leaveWorkflowDefinition(), {
              baseVersion: 1,
            }),
          ],
        },
      },
    });
    server.use(...workflowRuntimeWorld().handlers);

    await user.click(await screen.findByRole("button", { name: "阻擋清單" }));

    expect(
      await screen.findByRole("heading", { name: "阻擋清單" }),
    ).toBeInTheDocument();
  });

  it("非設計器產生順序的定義(api / fork 建的平行流程,陣列與鍵順序不同)打開不算未存:換流程不跳窗", async () => {
    const definition = purchaseWorkflowDefinition();
    const shuffled = {
      steps: definition.steps.toReversed(),
      edges: definition.edges?.toReversed() ?? null,
    };
    const { user } = renderWorkflows({
      world: {
        workflows: [
          workflowFragment({ key: "purchase_review", name: "採購審核" }),
          workflowFragment({
            key: "overtime_review",
            name: "加班審核",
            hasDraft: false,
          }),
        ],
        versions: {
          purchase_review: [
            workflowVersionFragment(shuffled, {
              workflowKey: "purchase_review",
            }),
          ],
        },
      },
    });
    const canvas = await screen.findByRole("region", { name: "流程圖" });
    await within(canvas).findByRole("group", { name: "原部門初審" });
    expect(screen.queryByText("有未存的變更")).not.toBeInTheDocument();

    await user.click(
      within(screen.getByRole("list", { name: "流程清單" })).getByText(
        "加班審核",
      ),
    );

    expect(
      await screen.findByRole("heading", { name: "加班審核" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "還有沒存的變更" }),
    ).not.toBeInTheDocument();
  });
});
