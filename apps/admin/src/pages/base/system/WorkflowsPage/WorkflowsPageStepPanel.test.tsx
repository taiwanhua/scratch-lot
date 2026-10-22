import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  DEFAULT_OVERDUE_AUDIENCE,
  type ReviewStepDef,
  SKIP_ORG_TENANT,
  type WorkflowDefinition,
} from "@repo/domain/workflow";

import {
  HR_ROLE_ID,
  roleInSubmissionOrg,
} from "@/test/msw/workflow-audience-fixtures";
import {
  WORKFLOWS_ROUTE,
  reviewStep,
  workflowFragment,
  workflowVersionFragment,
} from "@/test/msw/workflow-fixtures";
import { setupReactFlowEnvironment } from "@/test/react-flow";
import { renderApp } from "@/test/render";
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

const SKIP_TITLE = "跳過這一關(符合任一項就跳過)";

/** 「人資」關四個區塊都設好的值(跳過兩項、自動通過、逾時提醒、知會)。 */
const CONFIGURED: Partial<ReviewStepDef> = {
  skipOrgs: { orgIds: [SKIP_ORG_TENANT], includeDescendants: true },
  skipWhen: { "<=": [{ var: "days" }, 1] },
  autoApprove: { priorApprover: true },
  overdue: {
    reviewerAfterHours: 12,
    audienceAfterHours: 36,
    audience: DEFAULT_OVERDUE_AUDIENCE,
  },
  cc: { kind: "manager", level: 2 },
};

/** 整個流程的知會對象。 */
const FLOW_CC = { kind: "manager", level: 1 } as const;

/** 病假審核草稿:「人資」關四個區塊都設好,整個流程的知會對象 = 主管第 1 層。 */
const configuredOptions = () => {
  const definition: WorkflowDefinition = {
    steps: [
      reviewStep("manager", "直屬主管"),
      reviewStep("hr", "人資", {
        assignee: roleInSubmissionOrg(HR_ROLE_ID),
        ...CONFIGURED,
      }),
    ],
    edges: null,
    cc: FLOW_CC,
  };
  const options = defaultDesignOptions();
  const [, ...rest] = options.versions?.leave_review ?? [];
  return {
    ...options,
    versions: {
      leave_review: [
        workflowVersionFragment(definition, { baseVersion: 1 }),
        ...rest,
      ],
    },
  };
};

/** 沒選關卡時,整個流程的知會對象顯示「主管 / 第 1 層」。 */
const expectFlowCc = () => {
  const flow = within(propertiesPanel()).getByRole("region", {
    name: "整個流程的設定",
  });
  expect(
    within(flow).getByRole("combobox", { name: "知會對象" }),
  ).toHaveTextContent("主管");
  expect(
    within(flow).getByRole("combobox", { name: "第幾層" }),
  ).toHaveTextContent("第 1 層");
};

/** 「人資」關四個區塊顯示的是 `CONFIGURED` 的值。 */
const expectConfiguredPanel = () => {
  const panel = propertiesPanel();
  const skip = within(panel).getByRole("group", { name: SKIP_TITLE });
  for (const name of ["申請人屬於這些組織", "最上層組織", "包含下層"]) {
    expect(within(skip).getByRole("checkbox", { name })).toBeChecked();
  }
  expect(
    within(skip).getByRole("checkbox", { name: "符合條件" }),
  ).toBeChecked();
  const prior = within(panel).getByRole("radiogroup", {
    name: "審核者已在前面的關卡核准過時",
  });
  expect(within(prior).getByRole("radio", { name: "自動通過" })).toBeChecked();
  const applicant = within(panel).getByRole("radiogroup", {
    name: "申請人是這一關的審核者時",
  });
  expect(
    within(applicant).getByRole("radio", { name: "剔除申請人" }),
  ).toBeChecked();
  expect(
    within(panel).getByRole("switch", { name: "開啟逾時提醒" }),
  ).toBeChecked();
  expect(
    within(panel).getByRole("spinbutton", { name: "通知審核者的時數" }),
  ).toHaveValue(12);
  expect(
    within(panel).getByRole("spinbutton", { name: "通知「通知對象」的時數" }),
  ).toHaveValue(36);
  const cc = within(panel).getByRole("group", { name: "知會對象" });
  expect(
    within(cc).getByRole("combobox", { name: "知會對象" }),
  ).toHaveTextContent("主管");
  expect(
    within(cc).getByRole("combobox", { name: "第幾層" }),
  ).toHaveTextContent("第 2 層");
};

describe("流程管理:關卡面板的跳過、自動通過與存檔來回", () => {
  it("四個區塊與整個流程的知會對象,載入時顯示存的值", async () => {
    renderWorkflows({ world: configuredOptions() });
    const canvas = await findCanvas();
    expectFlowCc();

    clickNode(canvas, "人資");
    expectConfiguredPanel();
  });

  it("存草稿後重新載入,四個區塊與整個流程的知會對象都不變", async () => {
    const { user, world, unmount } = renderWorkflows({
      world: configuredOptions(),
    });
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    // 只改名稱(讓草稿有未存的變更),其他照原樣送
    await user.type(
      within(propertiesPanel()).getByRole("textbox", { name: "名稱" }),
      "審核",
    );
    await user.click(screen.getByRole("button", { name: "存草稿" }));
    expect(await findSnackbarAlert()).toEqual({
      severity: "success",
      text: "已存草稿",
    });
    const saved = world.inputs.saveDraft[0];
    expect(saved.definition.steps[1]).toMatchObject({
      key: "hr",
      name: "人資審核",
      ...CONFIGURED,
    });
    expect(saved.definition.cc).toEqual(FLOW_CC);

    unmount();
    renderApp({ path: WORKFLOWS_ROUTE });
    const reloaded = await findCanvas();
    expectFlowCc();
    clickNode(reloaded, "人資審核");
    expectConfiguredPanel();
  });

  it("勾「申請人屬於這些組織」預設最上層組織、不含下層;存草稿帶上", async () => {
    const { user, world } = renderWorkflows();
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    const panel = propertiesPanel();

    await user.click(
      within(panel).getByRole("checkbox", { name: "申請人屬於這些組織" }),
    );
    expect(
      within(panel).getByRole("checkbox", { name: "最上層組織" }),
    ).toBeChecked();
    // 客製流程可以另外指定組織
    expect(
      within(panel).getByRole("combobox", { name: "指定組織" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "存草稿" }));

    await waitFor(() => {
      expect(world.inputs.saveDraft).toHaveLength(1);
    });
    expect(world.inputs.saveDraft[0]?.definition.steps[1]).toMatchObject({
      skipOrgs: { orgIds: [SKIP_ORG_TENANT], includeDescendants: false },
    });
  });

  it("自動通過選「自動通過」→ 存草稿只帶開啟的那一項", async () => {
    const { user, world } = renderWorkflows();
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    const applicant = within(propertiesPanel()).getByRole("radiogroup", {
      name: "申請人是這一關的審核者時",
    });

    await user.click(
      within(applicant).getByRole("radio", { name: "自動通過" }),
    );
    await user.click(screen.getByRole("button", { name: "存草稿" }));

    await waitFor(() => {
      expect(world.inputs.saveDraft).toHaveLength(1);
    });
    expect(world.inputs.saveDraft[0]?.definition.steps[1]?.autoApprove).toEqual(
      { applicant: true },
    );
  });

  it('申請人是審核者時有三個選項;選「照常審核」→ 存草稿帶 applicant: "review"', async () => {
    const { user, world } = renderWorkflows();
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    const applicant = within(propertiesPanel()).getByRole("radiogroup", {
      name: "申請人是這一關的審核者時",
    });
    expect(
      within(applicant)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent),
    ).toEqual(["剔除申請人", "自動通過", "照常審核"]);

    await user.click(
      within(applicant).getByRole("radio", { name: "照常審核" }),
    );
    await user.click(screen.getByRole("button", { name: "存草稿" }));

    await waitFor(() => {
      expect(world.inputs.saveDraft).toHaveLength(1);
    });
    expect(world.inputs.saveDraft[0]?.definition.steps[1]?.autoApprove).toEqual(
      { applicant: "review" },
    );
  });

  it("自動通過改成「自動通過」再改回「剔除申請人」→ 定義回到原樣,不算未存的變更", async () => {
    const { user } = renderWorkflows();
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    const applicant = within(propertiesPanel()).getByRole("radiogroup", {
      name: "申請人是這一關的審核者時",
    });

    await user.click(
      within(applicant).getByRole("radio", { name: "自動通過" }),
    );
    expect(screen.getByText("有未存的變更")).toBeInTheDocument();
    await user.click(
      within(applicant).getByRole("radio", { name: "剔除申請人" }),
    );

    expect(screen.queryByText("有未存的變更")).toBeNull();
    expect(screen.getByRole("button", { name: "存草稿" })).toBeDisabled();
  });

  it("共用流程:「申請人屬於這些組織」只有最上層組織,不能指定組織", async () => {
    const { user } = renderWorkflows({
      world: {
        ...defaultDesignOptions(),
        workflows: [workflowFragment({ isShared: true, ownerOrgId: null })],
      },
    });
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    const panel = propertiesPanel();

    await user.click(
      within(panel).getByRole("checkbox", { name: "申請人屬於這些組織" }),
    );
    const tenant = within(panel).getByRole("checkbox", { name: "最上層組織" });
    expect(tenant).toBeChecked();
    expect(tenant).toBeDisabled();
    expect(
      within(panel).queryByRole("combobox", { name: "指定組織" }),
    ).toBeNull();
    expect(
      within(panel).getByText("共用流程只能選最上層組織。"),
    ).toBeInTheDocument();
  });
});
