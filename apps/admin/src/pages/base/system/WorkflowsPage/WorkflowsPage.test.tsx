import { beforeAll, describe, expect, it } from "@jest/globals";
import { fireEvent, screen, within } from "@testing-library/react";

import { HR_ROLE_ID } from "@/test/msw/workflow-audience-fixtures";
import {
  leaveWorkflowDefinition,
  workflowFragment,
  workflowVersionFragment,
} from "@/test/msw/workflow-fixtures";
import { setupReactFlowEnvironment } from "@/test/react-flow";
import { findSnackbarAlert } from "@/test/snackbar";

import {
  clickNode,
  defaultDesignOptions,
  findCanvas,
  propertiesPanel,
  renderWorkflows,
} from "./workflows-page-test-support";

setupReactFlowEnvironment();

beforeAll(async () => {
  // 懶載入頁面的依賴鏈(React Flow、dagre、檢查器)先載好,不算進 findBy* 的等待(TEST-08)
  await import("./WorkflowsPage");
});

describe("流程管理:清單與設計器", () => {
  it("左欄列出流程(客製 / 版本 / 綁定表單);右欄的流程圖畫出每一關", async () => {
    renderWorkflows({
      world: {
        ...defaultDesignOptions(),
        workflows: [
          workflowFragment({
            boundForms: [
              {
                formKey: "sick_leave",
                formName: "病假單",
                moduleKey: "demo.form",
              },
            ],
          }),
        ],
      },
    });

    const list = await screen.findByRole("list", { name: "流程清單" });
    expect(within(list).getByText("病假審核")).toBeInTheDocument();
    expect(within(list).getByText("客製")).toBeInTheDocument();
    expect(within(list).getByText("第 1 版")).toBeInTheDocument();
    expect(within(list).getByText("綁定表單:病假單")).toBeInTheDocument();
    const canvas = await findCanvas();
    expect(
      within(canvas).getByRole("group", { name: "人資" }),
    ).toBeInTheDocument();
  });

  // 審核者來源三種分案驗(一案走完 + 存草稿,在全套並行的 CI 上會超過單一測試的 15 秒)
  it("點關卡 → 屬性面板;人員條件顯示摘要,換成主管能選第幾層", async () => {
    const { user } = renderWorkflows();
    const canvas = await findCanvas();
    expect(within(canvas).getByText("審核者:人員條件")).toBeInTheDocument();

    clickNode(canvas, "人資");
    const panel = propertiesPanel();
    const kind = within(panel).getByRole("combobox", { name: "審核者來源" });
    expect(kind).toHaveTextContent("人員條件");
    const reviewers = within(panel).getByRole("group", { name: "審核者條件" });
    expect(
      await within(reviewers).findByText(
        "角色 屬於 人資 且 所屬組織 屬於 【單據所屬組織】(本身)",
      ),
    ).toBeInTheDocument();
    // 主管 → 第 2 層
    await user.click(kind);
    await user.click(await screen.findByRole("option", { name: "主管" }));
    await user.click(within(panel).getByRole("combobox", { name: "第幾層" }));
    await user.click(await screen.findByRole("option", { name: "第 2 層" }));

    expect(
      within(panel).getByRole("combobox", { name: "第幾層" }),
    ).toHaveTextContent("第 2 層");
  });

  it("編輯條件:對話框用 AudiencePicker 編輯,套用後寫回關卡;存草稿帶人員條件", async () => {
    const { user, world } = renderWorkflows();
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    const panel = propertiesPanel();

    await user.click(within(panel).getByRole("button", { name: "編輯條件" }));
    const dialog = await screen.findByRole("dialog", {
      name: "審核者條件 · 人資",
    });
    // 刪掉「所屬組織」那一列(第二列)
    const removes = within(dialog).getAllByRole("button", { name: "刪除" });
    await user.click(removes[1]);
    await user.click(within(dialog).getByRole("button", { name: "套用" }));

    expect(
      await within(panel).findByText("角色 屬於 人資"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "存草稿" }));
    expect(await findSnackbarAlert()).toEqual({
      severity: "success",
      text: "已存草稿",
    });
    expect(world.inputs.saveDraft[0]?.definition.steps[1]).toMatchObject({
      key: "hr",
      assignee: {
        kind: "audience",
        audience: {
          mode: "match",
          filter: {
            op: "AND",
            children: [
              {
                field: "role",
                cond: "in",
                value: { kind: "static", values: [HR_ROLE_ID] },
              },
            ],
          },
        },
      },
    });
  });

  it("編輯條件:沒挑值就套用 → 標在那一列、不關閉;取消不改關卡", async () => {
    const { user } = renderWorkflows();
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    const panel = propertiesPanel();

    await user.click(within(panel).getByRole("button", { name: "編輯條件" }));
    const dialog = await screen.findByRole("dialog", {
      name: "審核者條件 · 人資",
    });
    await user.click(within(dialog).getByRole("button", { name: "+ 條件" }));
    await user.click(within(dialog).getByRole("button", { name: "套用" }));

    expect(within(dialog).getByText("請選擇值。")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(
      await within(panel).findByText(
        "角色 屬於 人資 且 所屬組織 屬於 【單據所屬組織】(本身)",
      ),
    ).toBeInTheDocument();
  });

  it("表單欄位:從檢查用表單只列使用者引用欄;存草稿帶 expectedDraftRevision、整份定義與檢查用表單", async () => {
    const { user, world } = renderWorkflows();
    const canvas = await findCanvas();
    await user.click(screen.getByRole("combobox", { name: "檢查用表單" }));
    await user.click(await screen.findByRole("option", { name: "病假單" }));

    clickNode(canvas, "人資");
    const panel = propertiesPanel();
    await user.click(
      within(panel).getByRole("combobox", { name: "審核者來源" }),
    );
    await user.click(await screen.findByRole("option", { name: "表單欄位" }));
    await user.click(within(panel).getByRole("combobox", { name: "欄位" }));
    expect(
      screen.queryByRole("option", { name: "天數" }),
    ).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "代理主管" }));

    await user.click(screen.getByRole("button", { name: "存草稿" }));

    expect(await findSnackbarAlert()).toEqual({
      severity: "success",
      text: "已存草稿",
    });
    expect(world.inputs.saveDraft).toHaveLength(1);
    const [saved] = world.inputs.saveDraft;
    expect(saved.expectedDraftRevision).toBe(1);
    expect(saved.definition.edges ?? null).toBeNull();
    expect(saved.definition.steps[1]).toMatchObject({
      key: "hr",
      assignee: { kind: "field", formKey: "sick_leave", fieldKey: "approver" },
    });
    expect(saved.definition.checkFormKey).toBe("sick_leave");
  });

  it("共用流程:審核者條件只能用權限與組織來源(沒有指定組織),對話框頂端說明", async () => {
    const { user } = renderWorkflows({
      world: {
        ...defaultDesignOptions(),
        workflows: [workflowFragment({ isShared: true, ownerOrgId: null })],
      },
    });
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    const panel = propertiesPanel();

    await user.click(within(panel).getByRole("button", { name: "編輯條件" }));
    const dialog = await screen.findByRole("dialog", {
      name: "審核者條件 · 人資(共用流程)",
    });
    expect(
      within(dialog).getByText(/共用流程給所有租戶用/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "+ 條件" }));
    // 新加的那一列是第三列(既有:權限、所屬組織)
    const fields = within(dialog).getAllByRole("combobox", { name: "欄位" });
    expect(fields).toHaveLength(3);
    await user.click(fields[2]);
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "權限",
      "所屬組織",
    ]);
  });

  it("草稿已被別人更新 → 存草稿回 CONFLICT,提示並可重新載入", async () => {
    const { user } = renderWorkflows({
      world: {
        ...defaultDesignOptions(),
        failures: {
          SaveWorkflowVersionDraft: {
            code: "CONFLICT",
            extensions: { reason: "DRAFT_REVISION_MISMATCH" },
          },
        },
      },
    });
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    await user.click(
      within(propertiesPanel()).getByRole("button", { name: "在後面加一關" }),
    );

    await user.click(screen.getByRole("button", { name: "存草稿" }));

    expect(
      await screen.findByText("草稿已被別人更新,請重新載入。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新載入" }),
    ).toBeInTheDocument();
  });

  it("檢查器即時跑:錯誤定位到關卡,點一下選中那一關", async () => {
    const definition = leaveWorkflowDefinition();
    const { user } = renderWorkflows({
      world: {
        ...defaultDesignOptions(),
        versions: {
          leave_review: [
            workflowVersionFragment(
              {
                ...definition,
                steps: definition.steps.map((step) =>
                  step.key === "hr"
                    ? {
                        ...step,
                        assignee: {
                          kind: "audience",
                          audience: {
                            mode: "match",
                            filter: { op: "AND", children: [] },
                          },
                        },
                      }
                    : step,
                ),
              },
              { baseVersion: 1 },
            ),
          ],
        },
      },
    });
    const canvas = await findCanvas();
    // 人資關卡的人員條件是空的 → AUDIENCE_INVALID(domain 的檢查器)
    const issues = await screen.findByRole("region", { name: "檢查結果" });
    const issue = await within(issues).findByText(/人資/, {
      selector: ".MuiListItemText-secondary",
    });

    await user.click(issue);

    expect(
      within(propertiesPanel()).getByRole("textbox", { name: "名稱" }),
    ).toHaveValue("人資");
    expect(
      within(canvas).getByRole("group", { name: "人資" }),
    ).toBeInTheDocument();
  });

  it("鍵盤:聚焦節點按 Enter 就選中,屬性面板打開", async () => {
    renderWorkflows();
    const canvas = await findCanvas();
    const node = canvas.querySelector<HTMLElement>(
      '.react-flow__node[data-id="hr"]',
    );
    if (node === null) {
      throw new Error("找不到人資節點");
    }

    node.focus();
    fireEvent.keyDown(node, { key: "Enter" });

    expect(
      await within(propertiesPanel()).findByRole("textbox", { name: "名稱" }),
    ).toHaveValue("人資");
  });

  it("表單超過一頁(100 筆)→ 提示清單已截斷", async () => {
    renderWorkflows({ catalog: { formsTotal: 150 } });
    await findCanvas();

    expect(
      await screen.findByText("表單或角色超過 100 筆,清單已截斷,請縮小範圍。"),
    ).toBeInTheDocument();
  });
});
