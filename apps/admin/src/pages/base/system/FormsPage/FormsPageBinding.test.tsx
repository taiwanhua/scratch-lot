import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { authWorld } from "@/test/msw/auth-handlers";
import { formDesignWorld } from "@/test/msw/form-design-handlers";
import {
  FORMS_ROUTE,
  formFragment,
  formsModules,
} from "@/test/msw/form-fixtures";
import { formRuntimeWorld } from "@/test/msw/form-runtime-handlers";
import { server } from "@/test/msw/server";
import { workflowDesignWorld } from "@/test/msw/workflow-design-handlers";
import {
  workflowFragment,
  workflowsModules,
} from "@/test/msw/workflow-fixtures";
import { renderApp } from "@/test/render";

import {
  FORMS_ALL,
  defaultDesignOptions,
  preloadFormsPage,
} from "./forms-page-test-support";

preloadFormsPage();

/** 租戶視角的「購物單」(分派來的共用表單,本組織已啟用)。 */
const tenantForm = (overrides: Parameters<typeof formFragment>[0] = {}) =>
  formFragment({
    tenantEnabled: true,
    abilities: {
      canEdit: false,
      canAssign: false,
      canSetEnabled: true,
      canFork: true,
    },
    ...overrides,
  });

const bindingOptions = () => ({
  shopping_list: [
    {
      workflowKey: "leave_review",
      workflowName: "病假審核",
      isShared: false,
      canBind: true,
      issues: [],
    },
    {
      workflowKey: "leave_shared",
      workflowName: "共用病假審核",
      isShared: true,
      canBind: false,
      issues: [
        {
          stepKey: "hr",
          stepNumber: 2,
          problem: "AUDIENCE_IN_SHARED",
          detail: "審核者條件用了角色",
        },
      ],
    },
  ],
});

/** 表單管理 + 流程管理(「建客製流程」捷徑要連得到流程管理頁)。 */
const renderBinding = (form = tenantForm()) => {
  const workflows = workflowDesignWorld({
    workflows: [workflowFragment()],
    forms: [form],
    bindingOptions: bindingOptions(),
  });
  server.use(
    ...authWorld({
      hasRefreshCookie: true,
      modules: [
        ...formsModules(FORMS_ALL),
        ...workflowsModules(["system.workflows.view"]).slice(1),
      ],
    }).handlers,
    ...formDesignWorld({ ...defaultDesignOptions(), forms: [form] }).handlers,
    ...formRuntimeWorld().handlers,
    ...workflows.handlers,
  );
  return { ...renderApp({ path: FORMS_ROUTE }), workflows };
};

describe("表單管理:流程綁定欄", () => {
  it("下拉只列可直接綁的流程 + 不走流程;選了就綁(bindFormWorkflow)", async () => {
    const { user, workflows } = renderBinding();

    const group = await screen.findByRole("group", { name: "流程綁定" });
    await user.click(
      within(group).getByRole("combobox", { name: "送出後走的審核流程" }),
    );
    expect(
      screen.queryByRole("option", { name: "共用病假審核" }),
    ).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "病假審核" }));

    await waitFor(() => {
      expect(workflows.inputs.bind).toEqual([
        { formKey: "shopping_list", workflowKey: "leave_review" },
      ]);
    });
  });

  it("不能直接綁的流程列出原因;共用流程附「建客製流程」捷徑", async () => {
    renderBinding();

    const region = await screen.findByRole("region", {
      name: "不能直接綁的流程",
    });
    expect(within(region).getByText("共用病假審核")).toBeInTheDocument();
    expect(
      within(region).getByText(/第 2 關:審核者條件用了使用者、角色或指定組織/),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("button", { name: "建客製流程" }),
    ).toBeInTheDocument();
  });

  it("改成不走流程 → 先警告「進過審核的單再送出會被擋」,確認才解除", async () => {
    const { user, workflows } = renderBinding(
      tenantForm({
        workflowBinding: {
          workflowKey: "leave_review",
          workflowName: "病假審核",
          isValid: true,
        },
      }),
    );
    const group = await screen.findByRole("group", { name: "流程綁定" });
    await user.click(
      within(group).getByRole("combobox", { name: "送出後走的審核流程" }),
    );
    await user.click(await screen.findByRole("option", { name: "不走流程" }));

    const dialog = await screen.findByRole("dialog", { name: "解除流程綁定" });
    expect(within(dialog).getByText(/已經進過審核的單/)).toBeInTheDocument();
    expect(workflows.inputs.unbind).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "解除綁定" }));

    await waitFor(() => {
      expect(workflows.inputs.unbind).toEqual([{ formKey: "shopping_list" }]);
    });
  });

  it("綁定指向被收回或不存在的流程 → 「綁定的流程已失效」(清單與欄位都標)", async () => {
    renderBinding(
      tenantForm({
        workflowBinding: {
          workflowKey: "gone_review",
          workflowName: "被收回的流程",
          isValid: false,
        },
      }),
    );

    expect(await screen.findByText(/流程已被收回或不存在/)).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "表單清單" });
    expect(within(list).getByText("綁定的流程已失效")).toBeInTheDocument();
  });

  it("本組織停用的表單不出現流程綁定欄", async () => {
    renderBinding(tenantForm({ tenantEnabled: false }));

    expect(
      await screen.findByRole("switch", { name: "在本組織啟用" }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("group", { name: "流程綁定" }),
    ).not.toBeInTheDocument();
  });
});
