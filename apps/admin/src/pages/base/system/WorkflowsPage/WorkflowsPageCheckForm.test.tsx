import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  leaveDefinition,
  leaveWorkflowDefinition,
  reviewStep,
  workflowFragment,
  workflowVersionFragment,
} from "@/test/msw/workflow-fixtures";
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
  // 懶載入頁面的依賴鏈(React Flow、dagre、檢查器)先載好,不算進 findBy* 的等待(TEST-08)
  await import("./WorkflowsPage");
});

const CHECK_FORM_HINT =
  "設計時用來對照的表單:列出可選的欄位、驗證審核者欄位與跳過條件。實際送出時以綁定的表單為準,綁定時會再驗一次。";

/** 草稿已存了檢查用表單「病假單」(= 重新整理後讀回來的樣子)。 */
const withSavedCheckForm = () => {
  const options = defaultDesignOptions();
  const [draft, ...rest] = options.versions?.leave_review ?? [];
  return {
    ...options,
    versions: {
      leave_review: [
        workflowVersionFragment(leaveWorkflowDefinition(), {
          ...draft,
          checkFormKey: "sick_leave",
        }),
        ...rest,
      ],
    },
  };
};

const chooseFieldSource = async (
  user: ReturnType<typeof renderWorkflows>["user"],
  canvas: HTMLElement,
): Promise<HTMLElement> => {
  clickNode(canvas, "人資");
  const panel = propertiesPanel();
  await user.click(within(panel).getByRole("combobox", { name: "審核者來源" }));
  await user.click(await screen.findByRole("option", { name: "表單欄位" }));
  return panel;
};

describe("流程管理:檢查用表單與「檢查」", () => {
  it("存過的檢查用表單載入就選好;「表單欄位」來源的欄位選單來自它;換掉算未存、存草稿帶上", async () => {
    const { user, world } = renderWorkflows({ world: withSavedCheckForm() });
    const canvas = await findCanvas();
    const select = screen.getByRole("combobox", { name: "檢查用表單" });
    await waitFor(() => {
      expect(select).toHaveTextContent("病假單");
    });
    expect(screen.getByText(CHECK_FORM_HINT)).toBeInTheDocument();
    expect(screen.queryByText("有未存的變更")).toBeNull();

    const panel = await chooseFieldSource(user, canvas);
    await user.click(within(panel).getByRole("combobox", { name: "欄位" }));
    expect(
      await screen.findByRole("option", { name: "代理主管" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "天數" })).toBeNull();
    await user.keyboard("{Escape}");

    await user.click(select);
    await user.click(await screen.findByRole("option", { name: "不指定" }));
    expect(screen.getByText("有未存的變更")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "存草稿" }));

    await waitFor(() => {
      expect(world.inputs.saveDraft).toHaveLength(1);
    });
    expect(world.inputs.saveDraft[0]?.definition.checkFormKey).toBeNull();
  });

  it("檢查用表單沒有使用者引用欄:欄位下拉下方說明要先在表單設計器加一個並發布", async () => {
    const definition = leaveDefinition();
    const { user } = renderWorkflows({
      world: withSavedCheckForm(),
      catalog: {
        checkFormDefinition: {
          ...definition,
          fields: definition.fields.filter(
            (candidate) => candidate.type !== "reference",
          ),
        },
      },
    });
    const canvas = await findCanvas();
    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "檢查用表單" }),
      ).toHaveTextContent("病假單");
    });

    const panel = await chooseFieldSource(user, canvas);

    expect(
      await within(panel).findByText(
        "檢查用表單沒有「引用(使用者)」欄位;請先在表單設計器加一個資料來源為使用者的引用欄位並發布。",
      ),
    ).toBeInTheDocument();
  });

  it("新草稿(修訂 0)預設第一張綁定的表單;存過、存了 null 的草稿不預設", async () => {
    const bound = [
      { formKey: "sick_leave", formName: "病假單", moduleKey: "demo.form" },
    ];
    const withRevision = (draftRevision: number) => {
      const options = defaultDesignOptions();
      const [draft, ...rest] = options.versions?.leave_review ?? [];
      return {
        ...options,
        workflows: [workflowFragment({ boundForms: bound })],
        versions: {
          leave_review: [
            workflowVersionFragment(leaveWorkflowDefinition(), {
              ...draft,
              draftRevision,
              checkFormKey: null,
            }),
            ...rest,
          ],
        },
      };
    };
    const fresh = renderWorkflows({ world: withRevision(0) });
    await findCanvas();
    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "檢查用表單" }),
      ).toHaveTextContent("病假單");
    });
    expect(screen.queryByText("有未存的變更")).toBeNull();
    fresh.unmount();

    renderWorkflows({ world: withRevision(2) });
    await findCanvas();
    expect(
      screen.getByRole("combobox", { name: "檢查用表單" }),
    ).toHaveTextContent("不指定");
  });

  it("沒選檢查用表單:欄位下拉顯示「請先選檢查用表單」;按「檢查」提示欄位沒驗、結構照跑", async () => {
    const { user, world } = renderWorkflows();
    const canvas = await findCanvas();
    const panel = await chooseFieldSource(user, canvas);
    const fieldSelect = within(panel).getByRole("combobox", { name: "欄位" });
    expect(fieldSelect).toHaveTextContent("請先選檢查用表單");
    expect(fieldSelect).toHaveAttribute("aria-disabled", "true");

    await user.click(screen.getByRole("button", { name: "檢查" }));

    const result = await screen.findByRole("region", { name: "完整檢查" });
    expect(
      within(result).getByText(
        "沒有選檢查用表單:跳過條件沒有對照表單時只做結構檢查;審核者的表單欄位來源仍以各自的表單驗。",
      ),
    ).toBeInTheDocument();
    expect(world.inputs.validate).toHaveLength(1);
    expect(world.inputs.validate[0]?.checkFormKey).toBeNull();
  });

  it("既有的跳過條件公式載入後在「跳過這一關」的「符合跳過條件」;沒選檢查用表單時保留目前欄位、提示「請先選檢查用表單」", async () => {
    const options = defaultDesignOptions();
    const [, ...rest] = options.versions?.leave_review ?? [];
    renderWorkflows({
      world: {
        ...options,
        versions: {
          leave_review: [
            workflowVersionFragment(
              {
                steps: [
                  reviewStep("manager", "直屬主管"),
                  reviewStep("hr", "人資", {
                    skipWhen: { "<=": [{ var: "days" }, 1] },
                  }),
                ],
                edges: null,
              },
              { baseVersion: 1 },
            ),
            ...rest,
          ],
        },
      },
    });
    const canvas = await findCanvas();

    clickNode(canvas, "人資");

    const block = within(propertiesPanel()).getByRole("group", {
      name: "跳過這一關(符合任一項就跳過)",
    });
    expect(
      within(block).getByRole("checkbox", { name: "符合跳過條件" }),
    ).toBeChecked();
    expect(
      within(block).getByRole("checkbox", { name: "申請人屬於這些組織" }),
    ).not.toBeChecked();
    // 原本單獨的「跳過條件」欄位不再出現
    expect(
      within(propertiesPanel()).queryByRole("group", { name: "跳過條件" }),
    ).toBeNull();
    const skip = within(block).getByRole("group", { name: "符合跳過條件" });
    const field = within(skip).getByRole("combobox", { name: "欄位" });
    // 目前的值不被提示字蓋掉
    expect(field).toHaveTextContent("days");
    expect(field).toHaveAttribute("aria-disabled", "true");
    expect(within(skip).getByText("請先選檢查用表單")).toBeInTheDocument();
  });

  it("檢查結果依關卡列出;點一筆定位到那一關(選取節點、打開屬性面板)", async () => {
    const { user } = renderWorkflows({
      world: {
        ...withSavedCheckForm(),
        validation: {
          // 只有 api 看得到的問題(前端沒有使用者目錄):併進即時檢查的結果一起列
          errors: [],
          warnings: [
            {
              code: "USER_INVALID",
              message: "關卡 hr 指定的使用者 u9 已停用",
              stepKey: "hr",
              stepIndex: 1,
              edgeIndex: null,
              property: "userIds",
              exprPath: null,
            },
          ],
        },
      },
    });
    await findCanvas();

    await user.click(screen.getByRole("button", { name: "檢查" }));

    const result = await screen.findByRole("region", { name: "完整檢查" });
    const list = await within(result).findByRole("list", {
      name: "「人資」的問題",
    });
    expect(
      within(result).queryByText(
        "沒有選檢查用表單:跳過條件沒有對照表單時只做結構檢查;審核者的表單欄位來源仍以各自的表單驗。",
      ),
    ).toBeNull();
    await user.click(
      within(list).getByRole("button", { name: /使用者 u9 已停用/ }),
    );

    expect(
      within(propertiesPanel()).getByRole("region", { name: "關卡「人資」" }),
    ).toBeInTheDocument();
  });
});
