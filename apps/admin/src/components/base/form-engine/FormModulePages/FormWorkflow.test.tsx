import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { FormSubmissionStatus, WorkflowInstanceStatus } from "@repo/graphql";

import { authWorld } from "@/test/msw/auth-handlers";
import { submissionFragment } from "@/test/msw/form-fixtures";
import {
  type FormRuntimeWorldOptions,
  formRuntimeWorld,
} from "@/test/msw/form-runtime-handlers";
import { demoGroupNode } from "@/test/msw/module-fixtures";
import { server } from "@/test/msw/server";
import {
  APPLICANT,
  DEMO_GROUP_FORM_KEY,
  DEMO_GROUP_FORM_ROUTES,
  LEAVE_FORM_KEY,
  applyCenterModules,
  demoGroupFormModules,
  instanceFragment,
  leaveDefinition,
} from "@/test/msw/workflow-fixtures";
import {
  type WorkflowRuntimeWorldOptions,
  workflowRuntimeWorld,
} from "@/test/msw/workflow-runtime-handlers";
import { renderApp } from "@/test/render";
import { setupFakeViewport } from "@/test/viewport";

setupFakeViewport();

beforeAll(async () => {
  // 懶載入的三頁依序預載(同時 import 同一條依賴鏈,ESM 模式的 jest 會撞快取)
  await import("./FormListPage");
  await import("./FormViewPage");
  await import("./FormEditPage");
});

const leaveForm = {
  key: LEAVE_FORM_KEY,
  name: "病假單",
  moduleKey: DEMO_GROUP_FORM_KEY,
  currentVersion: 1,
  tabLabelTemplate: null,
  allowDraft: true,
  canCreate: true,
};

const leave = (overrides: Parameters<typeof submissionFragment>[0] = {}) =>
  submissionFragment({
    id: "sub-leave-1",
    moduleKey: DEMO_GROUP_FORM_KEY,
    formKey: LEAVE_FORM_KEY,
    formName: "病假單",
    values: { kind: "病假", days: "3", reason: "病假三天", approver: null },
    summary: { title: "病假三天", date: null, amount: null },
    createdBy: APPLICANT,
    currentInstanceId: "inst-1",
    ...overrides,
  });

const renderLeave = (
  path: string,
  forms: FormRuntimeWorldOptions,
  runtime?: WorkflowRuntimeWorldOptions,
) => {
  const formWorld = formRuntimeWorld({
    moduleForms: [leaveForm],
    versions: { [`${LEAVE_FORM_KEY}@1`]: leaveDefinition() },
    ...forms,
  });
  const workflowWorld = workflowRuntimeWorld(
    runtime ?? { instances: [instanceFragment()] },
  );
  server.use(
    ...authWorld({
      hasRefreshCookie: true,
      modules: [
        demoGroupNode,
        ...demoGroupFormModules([`${DEMO_GROUP_FORM_KEY}.*`]),
        ...applyCenterModules(),
      ],
    }).handlers,
    ...formWorld.handlers,
    ...workflowWorld.handlers,
  );
  return { ...renderApp({ path }), forms: formWorld };
};

describe("表單模組 × 審核流程", () => {
  it("列表狀態 chip 七值;綁流程的已完成不顯示「編輯」、顯示「作廢」(理由必填)", async () => {
    const statuses = [
      FormSubmissionStatus.Reviewing,
      FormSubmissionStatus.Returned,
      FormSubmissionStatus.Withdrawn,
      FormSubmissionStatus.Rejected,
      FormSubmissionStatus.Voided,
    ];
    const { user, forms } = renderLeave(DEMO_GROUP_FORM_ROUTES.list, {
      submissions: [
        ...statuses.map((status, index) =>
          leave({
            id: `sub-${status}`,
            status,
            summary: { title: `單 ${String(index)}`, date: null, amount: null },
            abilities: {
              canEdit: false,
              canSaveDraft: false,
              canDelete: false,
              canEditField: [],
              canWithdraw: false,
              canVoid: false,
              canCopy: false,
            },
          }),
        ),
        leave({
          id: "sub-done",
          status: FormSubmissionStatus.Completed,
          summary: { title: "已核准的單", date: null, amount: null },
          abilities: {
            canEdit: false,
            canSaveDraft: false,
            canDelete: false,
            canEditField: [],
            canWithdraw: false,
            canVoid: true,
            canCopy: false,
          },
        }),
        leave({
          id: "sub-blocked",
          status: FormSubmissionStatus.Reviewing,
          blocked: true,
          summary: { title: "卡住的單", date: null, amount: null },
        }),
      ],
    });

    const table = await screen.findByRole("table", {
      name: /示範表單\(群組內\)/,
    });
    for (const label of [
      "審核中",
      "已退回",
      "已撤回",
      "已駁回",
      "已作廢",
      "已完成",
    ]) {
      expect(await within(table).findByText(label)).toBeInTheDocument();
    }
    expect(within(table).getByText("審核中(待處理)")).toBeInTheDocument();
    expect(
      within(table).queryByRole("button", { name: "編輯「已核准的單」" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(table).getByRole("button", { name: "作廢「已核准的單」" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "作廢這張單" });
    const confirm = within(dialog).getByRole("button", { name: "作廢" });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByRole("textbox", { name: "作廢理由" }),
      "日期填錯",
    );
    await user.click(confirm);

    await waitFor(() => {
      expect(forms.inputs.voidSubmission).toEqual([
        { id: "sub-done", expectedEditVersion: 2, reasonNote: "日期填錯" },
      ]);
    });
  });

  it("表單設了作廢原因類別:作廢對話框是「作廢原因」下拉,選「其他」說明必填;作廢後詳情顯示選項名稱與說明", async () => {
    const { user, forms } = renderLeave(
      `${DEMO_GROUP_FORM_ROUTES.viewPage}/sub-leave-1`,
      {
        submissions: [
          leave({
            status: FormSubmissionStatus.Completed,
            abilities: {
              canEdit: false,
              canSaveDraft: false,
              canDelete: false,
              canEditField: [],
              canWithdraw: false,
              canVoid: true,
              canCopy: false,
            },
          }),
        ],
        voidReasonOptions: {
          [LEAVE_FORM_KEY]: {
            categoryKey: "void-reason",
            items: [
              { value: "wrong-date", label: "日期填錯" },
              { value: "other", label: "其他" },
            ],
          },
        },
      },
      {
        instances: [
          instanceFragment({ status: WorkflowInstanceStatus.Approved }),
        ],
      },
    );

    const section = await screen.findByRole("region", { name: "審核" });
    await user.click(within(section).getByRole("button", { name: "作廢" }));
    const dialog = await screen.findByRole("dialog", { name: "作廢這張單" });
    const confirm = within(dialog).getByRole("button", { name: "作廢" });
    expect(confirm).toBeDisabled();
    // 沒有自由填寫的「作廢理由」,改成下拉 + 說明
    expect(
      within(dialog).queryByRole("textbox", { name: "作廢理由" }),
    ).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("combobox", { name: /作廢原因/ }),
    );
    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["日期填錯", "其他"]);
    await user.click(within(listbox).getByRole("option", { name: "其他" }));
    expect(confirm).toBeDisabled();
    expect(
      within(dialog).getByText("選「其他」時請填寫說明"),
    ).toBeInTheDocument();
    await user.type(
      within(dialog).getByRole("textbox", { name: /說明/ }),
      "改期了",
    );
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => {
      expect(forms.inputs.voidSubmission).toEqual([
        {
          id: "sub-leave-1",
          expectedEditVersion: 2,
          reasonKey: "other",
          reasonNote: "改期了",
        },
      ]);
    });
    expect(
      await within(section).findByText("作廢原因:其他(改期了)"),
    ).toBeInTheDocument();
  });

  it("已作廢、沒有其他可做的動作時,詳情仍顯示作廢原因(只有選項時不帶說明)", async () => {
    renderLeave(
      `${DEMO_GROUP_FORM_ROUTES.viewPage}/sub-leave-1`,
      {
        submissions: [
          leave({
            status: FormSubmissionStatus.Voided,
            voidReason: null,
            voidReasonKey: "wrong-date",
            voidReasonLabel: "日期填錯",
            abilities: {
              canEdit: false,
              canSaveDraft: false,
              canDelete: false,
              canEditField: [],
              canWithdraw: false,
              canVoid: false,
              canCopy: false,
            },
          }),
        ],
      },
      {
        instances: [
          instanceFragment({ status: WorkflowInstanceStatus.Approved }),
        ],
      },
    );

    const section = await screen.findByRole("region", { name: "審核" });
    expect(
      await within(section).findByText("作廢原因:日期填錯"),
    ).toBeInTheDocument();
  });

  it("詳情頁掛審核區塊;申請人在還沒人審前可撤回", async () => {
    const { user, forms } = renderLeave(
      `${DEMO_GROUP_FORM_ROUTES.viewPage}/sub-leave-1`,
      {
        submissions: [
          leave({
            status: FormSubmissionStatus.Reviewing,
            abilities: {
              canEdit: false,
              canSaveDraft: false,
              canDelete: false,
              canEditField: [],
              canWithdraw: true,
              canVoid: false,
              canCopy: false,
            },
          }),
        ],
      },
      {
        instances: [
          instanceFragment({
            abilities: { canWithdraw: true, canManage: false },
          }),
        ],
      },
    );

    const section = await screen.findByRole("region", { name: "審核" });
    expect(within(section).getByText("目前關卡:直屬主管")).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "撤回" }));
    const dialog = await screen.findByRole("dialog", { name: "撤回申請" });
    await user.click(within(dialog).getByRole("button", { name: "撤回" }));

    await waitFor(() => {
      expect(forms.inputs.withdrawSubmission).toEqual([
        { id: "sub-leave-1", expectedEditVersion: 2 },
      ]);
    });
  });

  it("已作廢的單「複製為新單」→ 進該模組編輯頁;被清空的欄位提示在來源頁", async () => {
    const { user, forms } = renderLeave(
      `${DEMO_GROUP_FORM_ROUTES.viewPage}/sub-leave-1`,
      {
        submissions: [
          leave({
            status: FormSubmissionStatus.Voided,
            voidReason: "日期填錯",
            abilities: {
              canEdit: false,
              canSaveDraft: false,
              canDelete: false,
              canEditField: [],
              canWithdraw: false,
              canVoid: false,
              canCopy: true,
            },
          }),
        ],
        copyClearedFields: [],
      },
      {
        instances: [
          instanceFragment({ status: WorkflowInstanceStatus.Approved }),
        ],
      },
    );

    const section = await screen.findByRole("region", { name: "審核" });
    expect(within(section).getByText("作廢理由:日期填錯")).toBeInTheDocument();
    await user.click(
      within(section).getByRole("button", { name: "複製為新單" }),
    );

    await waitFor(() => {
      expect(forms.inputs.copySubmissionToDraft).toHaveLength(1);
    });
    expect(
      await screen.findByRole("heading", { name: /編輯/ }),
    ).toBeInTheDocument();
  });

  it("被退回的單:編輯頁提示改完再送會重審,帶畫面上的值一次送出(不先存草稿)", async () => {
    const { user, forms } = renderLeave(
      `${DEMO_GROUP_FORM_ROUTES.editPage}/sub-leave-1`,
      {
        submissions: [
          leave({
            status: FormSubmissionStatus.Returned,
            abilities: {
              canEdit: true,
              canSaveDraft: true,
              canDelete: true,
              canEditField: ["kind", "days", "reason", "approver"],
              canWithdraw: false,
              canVoid: false,
              canCopy: false,
            },
          }),
        ],
        submitAs: {
          status: FormSubmissionStatus.Reviewing,
          instanceId: "inst-2",
        },
      },
    );

    expect(await screen.findByText(/這張單被退回修改/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "送出" }));

    await waitFor(() => {
      expect(forms.inputs.submitFormSubmission).toHaveLength(1);
    });
    expect(forms.inputs.submitFormSubmission[0]).toMatchObject({
      id: "sub-leave-1",
      values: expect.objectContaining({ kind: "病假" }),
    });
    expect(forms.inputs.saveFormDraft).toHaveLength(0);
    expect(forms.inputs.updateFormSubmission).toHaveLength(0);
  });
});
