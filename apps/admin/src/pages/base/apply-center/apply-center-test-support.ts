import { FormSubmissionStatus } from "@repo/graphql";

import { authWorld } from "@/test/msw/auth-handlers";
import { submissionFragment } from "@/test/msw/form-fixtures";
import {
  type FormRuntimeWorld,
  type FormRuntimeWorldOptions,
  formRuntimeWorld,
} from "@/test/msw/form-runtime-handlers";
import { demoGroupNode } from "@/test/msw/module-fixtures";
import { server } from "@/test/msw/server";
import {
  APPLICANT,
  DEMO_GROUP_FORM_KEY,
  LEAVE_FORM_KEY,
  applicationRow,
  applyCenterModules,
  demoGroupFormModules,
  instanceFragment,
  leaveDefinition,
  taskFragment,
} from "@/test/msw/workflow-fixtures";
import {
  type WorkflowRuntimeWorld,
  type WorkflowRuntimeWorldOptions,
  workflowRuntimeWorld,
} from "@/test/msw/workflow-runtime-handlers";
import { renderApp } from "@/test/render";

/**
 * 申請中心與審核區塊測試的共用場景:登入者是 `user-1`(小華,「直屬主管」關的承辦人),
 * 申請人小明送了一張病假單(`sub-leave-1`,修訂 1,實例 `inst-1`)。
 */
export const leaveSubmission = (
  overrides: Parameters<typeof submissionFragment>[0] = {},
) =>
  submissionFragment({
    id: "sub-leave-1",
    moduleKey: DEMO_GROUP_FORM_KEY,
    formKey: LEAVE_FORM_KEY,
    formName: "病假單",
    status: FormSubmissionStatus.Reviewing,
    values: { kind: "病假", days: "3", reason: "病假三天", approver: null },
    summary: { title: "病假三天", date: null, amount: null },
    createdBy: APPLICANT,
    currentInstanceId: "inst-1",
    abilities: {
      canEdit: false,
      canSaveDraft: false,
      canDelete: false,
      canEditField: [],
      canWithdraw: false,
      canVoid: false,
      canCopy: false,
    },
    ...overrides,
  });

export const defaultRuntime = (): WorkflowRuntimeWorldOptions => ({
  instances: [instanceFragment()],
  tasks: [taskFragment({ id: "task-manager-1" })],
  applications: [applicationRow()],
  applicable: [
    {
      moduleKey: DEMO_GROUP_FORM_KEY,
      moduleName: "示範表單(群組內)",
      forms: [
        {
          key: LEAVE_FORM_KEY,
          name: "病假單",
          moduleKey: DEMO_GROUP_FORM_KEY,
          currentVersion: 1,
          tabLabelTemplate: null,
        },
      ],
    },
  ],
});

export const defaultFormRuntime = (): FormRuntimeWorldOptions => ({
  moduleForms: [
    {
      key: LEAVE_FORM_KEY,
      name: "病假單",
      moduleKey: DEMO_GROUP_FORM_KEY,
      currentVersion: 1,
      tabLabelTemplate: null,
      allowDraft: true,
      canCreate: true,
    },
  ],
  versions: { [`${LEAVE_FORM_KEY}@1`]: leaveDefinition() },
  submissions: [leaveSubmission()],
});

export interface ApplyCenterSetup {
  path: string;
  runtime?: WorkflowRuntimeWorldOptions;
  forms?: FormRuntimeWorldOptions;
  formModulePermissions?: readonly string[];
}

export const renderApplyCenter = ({
  path,
  runtime = defaultRuntime(),
  forms = defaultFormRuntime(),
  formModulePermissions = [`${DEMO_GROUP_FORM_KEY}.*`],
}: ApplyCenterSetup): ReturnType<typeof renderApp> & {
  runtime: WorkflowRuntimeWorld;
  forms: FormRuntimeWorld;
} => {
  const workflowWorld = workflowRuntimeWorld(runtime);
  const formWorld = formRuntimeWorld(forms);
  server.use(
    ...authWorld({
      hasRefreshCookie: true,
      modules: [
        ...applyCenterModules(),
        demoGroupNode,
        ...demoGroupFormModules(formModulePermissions),
      ],
    }).handlers,
    ...workflowWorld.handlers,
    ...formWorld.handlers,
  );
  return {
    ...renderApp({ path }),
    runtime: workflowWorld,
    forms: formWorld,
  };
};
