import {
  DEFAULT_OVERDUE_AUDIENCE,
  SKIP_ORG_TENANT,
  type WorkflowDefinition,
} from "@repo/domain/workflow";
import { WorkflowVersionStatus } from "@repo/graphql";

import { SHOPPING_FORM_KEY } from "@/test/msw/form-fixtures";
import type { WorkflowDesignWorldOptions } from "@/test/msw/workflow-design-handlers";
import {
  LEAVE_FORM_KEY,
  leaveWorkflowDefinition,
  purchaseWorkflowDefinition,
  workflowFragment,
  workflowVersionFragment,
} from "@/test/msw/workflow-fixtures";

/**
 * 共用流程的「財務部審核」:人員條件只能用權限與非指定的組織來源(BS-02c)——
 * 持有「示範模組1 · 檢視」且屬於單據所屬組織。
 */
const sharedPurchaseDefinition = (): WorkflowDefinition => {
  const definition = purchaseWorkflowDefinition();
  return {
    ...definition,
    steps: definition.steps.map((step) =>
      step.key === "finance"
        ? {
            ...step,
            assignee: {
              kind: "audience",
              audience: {
                mode: "match",
                filter: {
                  op: "AND",
                  children: [
                    {
                      field: "permission",
                      cond: "in",
                      value: {
                        kind: "static",
                        values: ["demo.sub.sample-one.view"],
                      },
                    },
                    {
                      field: "org",
                      cond: "in",
                      value: { kind: "dynamic", ref: "submission-org" },
                      range: "self",
                    },
                  ],
                },
              },
            },
          }
        : step,
    ),
  };
};

/**
 * 病假審核草稿的「人資」關:跳過、自動通過、逾時提醒、知會四個區塊都設好(BS-03 的示範值);
 * 整個流程的知會對象 = 直屬主管(屬性面板沒選關卡時看得到)。
 */
const bs03LeaveDefinition = (): WorkflowDefinition => {
  const definition = leaveWorkflowDefinition();
  return {
    ...definition,
    steps: definition.steps.map((step) =>
      step.key === "hr"
        ? {
            ...step,
            skipOrgs: { orgIds: [SKIP_ORG_TENANT], includeDescendants: false },
            skipWhen: { "<": [{ var: "days" }, 3] },
            autoApprove: { priorApprover: true },
            overdue: {
              reviewerAfterHours: 24,
              audienceAfterHours: 48,
              audience: DEFAULT_OVERDUE_AUDIENCE,
            },
            cc: { kind: "manager", level: 2 },
          }
        : step,
    ),
  };
};

/**
 * mock 開發模式的流程管理假資料:直線的「病假審核」(客製,綁了病假單)與平行的「採購審核」
 * (共用,已發布第 1 版 + 一份草稿;版本面板看得到「匯出專案設定」)。
 */
export const mockWorkflowDesign = (): WorkflowDesignWorldOptions => ({
  workflows: [
    workflowFragment({
      boundForms: [
        { formKey: LEAVE_FORM_KEY, formName: "病假單", moduleKey: "demo.form" },
      ],
    }),
    workflowFragment({
      key: "purchase_review",
      name: "採購審核",
      isShared: true,
      ownerOrgId: null,
      ownerOrgName: null,
      hasDraft: true,
    }),
  ],
  versions: {
    leave_review: [
      workflowVersionFragment(bs03LeaveDefinition(), {
        baseVersion: 1,
        cc: { kind: "manager", level: 1 },
      }),
      workflowVersionFragment(leaveWorkflowDefinition(), {
        id: "wv-leave-1",
        version: 1,
        status: WorkflowVersionStatus.Published,
        changelog: "第一版",
      }),
    ],
    purchase_review: [
      workflowVersionFragment(sharedPurchaseDefinition(), {
        id: "wv-purchase-draft",
        workflowKey: "purchase_review",
        baseVersion: 1,
      }),
      workflowVersionFragment(sharedPurchaseDefinition(), {
        id: "wv-purchase-1",
        workflowKey: "purchase_review",
        version: 1,
        status: WorkflowVersionStatus.Published,
        changelog: "第一版",
      }),
    ],
  },
  bindingOptions: {
    [SHOPPING_FORM_KEY]: [
      {
        workflowKey: "leave_review",
        workflowName: "病假審核",
        isShared: false,
        canBind: true,
        issues: [],
      },
      {
        workflowKey: "purchase_review",
        workflowName: "採購審核",
        isShared: true,
        canBind: false,
        issues: [
          {
            stepKey: "finance",
            stepNumber: 2,
            problem: "AUDIENCE_IN_SHARED",
            detail: "審核者條件用了角色",
          },
        ],
      },
    ],
  },
});
