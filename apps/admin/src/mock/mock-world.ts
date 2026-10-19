import {
  GraphQLHandler,
  type RequestHandler,
  type WebSocketHandler,
} from "msw";

import {
  FormSubmissionStatus,
  FormVersionStatus,
  WorkflowInstanceStatus,
  WorkflowStepStatus,
} from "@repo/graphql";

import { authWorld } from "@/test/msw/auth-handlers";
import { dataScopeTargets, savedRule } from "@/test/msw/data-scope-fixtures";
import { dataScopeWorld } from "@/test/msw/data-scope-handlers";
import { delegationWorld } from "@/test/msw/delegation-handlers";
import { demoHistory, demoItems } from "@/test/msw/demo-fixtures";
import { demoWorld } from "@/test/msw/demo-sample-one-handlers";
import { demoTwoWorld } from "@/test/msw/demo-sample-two-handlers";
import { demoTwoItems } from "@/test/msw/demo-two-fixtures";
import {
  currentOrg,
  fieldCategories,
  fieldsByCategory,
  upperOrg,
} from "@/test/msw/field-fixtures";
import { fieldWorld } from "@/test/msw/field-manager-handlers";
import { formDesignWorld } from "@/test/msw/form-design-handlers";
import {
  SHOPPING_FORM_KEY,
  field,
  formFragment,
  shoppingDefinition,
  submissionFragment,
  versionFragment,
} from "@/test/msw/form-fixtures";
import { formRuntimeWorld } from "@/test/msw/form-runtime-handlers";
import { formUpgradeWorld } from "@/test/msw/form-upgrade-handlers";
import { moduleAdminTree } from "@/test/msw/module-admin-fixtures";
import { moduleAdminWorld } from "@/test/msw/module-manager-handlers";
import {
  notificationPreferenceDefaults,
  notificationWorld,
  sampleNotifications,
} from "@/test/msw/notification-handlers";
import { notificationSettingsWorld } from "@/test/msw/notification-settings-handlers";
import {
  orgDetails,
  orgManagerCandidates,
  orgManagersByOrg,
  orgMemberCandidates,
  orgMembersByOrg,
  rootTree,
  tenantModuleOptions,
  tenantTree,
} from "@/test/msw/org-fixtures";
import { orgWorld } from "@/test/msw/org-manager-handlers";
import { printingWorld } from "@/test/msw/printing-handlers";
import {
  candidates,
  grantedFixture,
  matrixModules,
  roleUsers,
} from "@/test/msw/role-fixtures";
import { roleWorld } from "@/test/msw/role-manager-handlers";
import { userWorld } from "@/test/msw/user-manager-handlers";
import { workflowDesignWorld } from "@/test/msw/workflow-design-handlers";
import {
  APPLICANT,
  HR,
  LEAVE_FORM_KEY,
  MANAGER,
  applicationRow,
  instanceFragment,
  instanceStep,
  leaveDefinition,
  planItem,
  taskFragment,
} from "@/test/msw/workflow-fixtures";
import {
  autoApproveBlockedEvent,
  historyEvent,
} from "@/test/msw/workflow-history-fixtures";
import { workflowRuntimeWorld } from "@/test/msw/workflow-runtime-handlers";

import {
  type MockView,
  mockRoles,
  mockUsers,
  modulesForView,
  orgsForView,
} from "./mock-fixtures";
import { mockNotificationSettings } from "./mock-notification-settings";
import { mockWorkflowDesign } from "./mock-workflow-design";

/**
 * mock 開發模式的假 api:把 `src/test/msw/` 的各頁 world 併成**一份**瀏覽器端 handlers。
 *
 * 併起來的唯一難處是**共用端點**:`orgTree` / `org` / `users` / `roles` 四個操作有兩三個 world
 * 各自實作了一份,而 MSW 是「先列的先贏」—— 放任重複的話,誰先誰贏取決於陣列順序,
 * 拿到的會是某一頁刻意簡化過的版本(例:`orgWorld` 的 `users` 不做組織子樹過濾,
 * 使用者管理頁點左樹就不會篩)。所以這裡替每個共用端點指定一個**正本 world**,
 * 其餘 world 的同名 handler 直接濾掉:
 *
 * | 操作      | 正本      | 理由                                        |
 * | --------- | --------- | ------------------------------------------- |
 * | `orgTree` | orgWorld  | 視角(root / 租戶)決定哪一棵樹              |
 * | `org`     | orgWorld  | 依 id 回各自的明細;別的 world 一律回同一筆 |
 * | `users`   | userWorld | 有組織子樹過濾、關鍵字、分頁                |
 * | `roles`   | roleWorld | 有關鍵字與分頁                              |
 *
 * 夾具一律取自 `src/test/msw/`(那一份對著 api 的斷言校準過,TEST-08),只有
 * 使用者清單在 `mock-fixtures.ts`。
 */

/**
 * `setupWorker()` / `server.use()` 收的 handler 型別(msw 內部叫 `AnyHandler`,
 * 沒有從套件根匯出,所以在這裡重寫一次)。
 */
type MockHandler = RequestHandler | WebSocketHandler;

export interface MockWorldOptions {
  /** 視角:root(根組織,看得到全部模組)或 tenant(租戶管理員,少了兩個 `isRootOnly` 模組) */
  view: MockView;
  /** 一開機就有有效的 refresh cookie = 自動登入;false 會停在登入頁(任何帳密都能登入) */
  authenticated: boolean;
}

/** 濾掉指定 GraphQL 操作的 handler(共用端點的去重;非 GraphQL 的 handler 一律留著)。 */
const withoutOperations = (
  handlers: readonly MockHandler[],
  dropped: readonly string[],
): MockHandler[] =>
  handlers.filter((handler) => {
    if (!(handler instanceof GraphQLHandler)) {
      return true;
    }
    const { operationName } = handler.info;
    return (
      typeof operationName !== "string" || !dropped.includes(operationName)
    );
  });

export const mockHandlers = ({
  view,
  authenticated,
}: MockWorldOptions): MockHandler[] => {
  // 視角決定哪一棵組織樹;使用者管理的「子樹過濾」也要同一棵,不然點左樹會篩不到人
  const orgTree = view === "root" ? rootTree : tenantTree;
  // 個人偏好先放好通知管道開關的 key(`UpdateMyPreferences` 只收已有的 key),通知假 api 讀同一份
  const auth = authWorld({
    hasRefreshCookie: authenticated,
    modules: modulesForView(view),
    orgs: orgsForView(view),
    // 根組織視角站在根組織(`tenantId: null`);租戶視角站在租戶 A(切換組織後沿用,mock 不重算)
    currentOrgTenantId: view === "root" ? null : "org-tenant-a",
    preferences: notificationPreferenceDefaults(),
  });

  return [
    // 登入線:Login / Refresh / Me / SwitchOrg / 改密碼…(`hasRefreshCookie` 即「已登入」)
    ...auth.handlers,
    // 通知鈴 / 通知清單 / 偏好分頁的管道開關
    ...notificationWorld({
      notifications: sampleNotifications(),
      preferences: auth.preferences,
    }).handlers,
    // 個人設定的代理人分頁
    ...delegationWorld().handlers,
    // 組織管理:`users` 讓給 userWorld
    ...withoutOperations(
      orgWorld({
        orgTree,
        orgs: orgDetails,
        members: orgMembersByOrg,
        memberCandidates: orgMemberCandidates,
        managers: orgManagersByOrg,
        managerCandidates: orgManagerCandidates,
        moduleOptions: tenantModuleOptions,
      }).handlers,
      ["Users"],
    ),
    // 使用者管理:`orgTree` / `org` 讓給 orgWorld、`roles` 讓給 roleWorld
    ...withoutOperations(userWorld({ users: mockUsers, orgTree }).handlers, [
      "OrgTree",
      "Org",
      "Roles",
    ]),
    // 角色管理;角色清單為何取 `mockRoles` 見 `mock-fixtures.ts`
    ...withoutOperations(
      roleWorld({
        roles: mockRoles,
        modules: matrixModules,
        granted: grantedFixture,
        users: roleUsers,
        candidates,
      }).handlers,
      ["OrgTree"],
    ),
    // 模組與權限:有狀態的樹,切換後重查看得到新值
    ...moduleAdminWorld({ tree: moduleAdminTree }).handlers,
    // 資料範圍:`savedRule` 讓左清單一開始就有一筆「已設規則」
    ...withoutOperations(
      dataScopeWorld({
        targets: dataScopeTargets,
        rules: [savedRule],
        permissionModules: matrixModules,
      }).handlers,
      ["Roles", "Users", "OrgTree", "AudiencePermissionOptions"],
    ),
    // 通知設定(`mock-notification-settings.ts`):`Roles` 讓給 roleWorld,權限候選樹由它提供
    ...withoutOperations(
      notificationSettingsWorld(mockNotificationSettings()).handlers,
      ["Roles"],
    ),
    // 欄位管理:`currentOrg` 只決定新增選項的擁有組織標籤
    ...fieldWorld({
      categories: fieldCategories,
      fieldsByCategory,
      currentOrg,
      upperOrgIds: [upperOrg.id],
    }).handlers,
    // 示範模組1 三頁:`CreateUploadUrl` 讓給 orgWorld(共用端點,正本只留一份)
    ...withoutOperations(
      demoWorld({ items: demoItems, history: demoHistory }).handlers,
      ["CreateUploadUrl"],
    ),
    // 示範模組2 三頁:兩支示範模組的端點各自獨立,沒有共用端點要去重
    ...demoTwoWorld({ items: demoTwoItems }).handlers,
    // 表單引擎:表單管理(一張共用表單,已發布 v1 + 一份草稿)與示範表單(頂層)(兩筆提交);
    // 設計器「類別」下拉的 `FieldCategories` 讓給欄位管理(共用端點,正本只留一份)
    ...withoutOperations(
      formDesignWorld({
        forms: [formFragment()],
        versions: {
          [SHOPPING_FORM_KEY]: [
            versionFragment(shoppingDefinition(), { baseVersion: 1 }),
            versionFragment(shoppingDefinition(), {
              id: `ver-${SHOPPING_FORM_KEY}-1`,
              version: 1,
              status: FormVersionStatus.Published,
              changelog: "第一版",
            }),
          ],
        },
      }).handlers,
      ["FieldCategories"],
    ),
    // 版本面板「將舊版資料升級到此版」:計畫給兩個補值欄位(單選 / 日期),看得到補值依型別呈現
    ...formUpgradeWorld({
      plan: {
        groups: [{ fromVersion: 1, count: 2 }],
        fillTargets: [
          field("priority", "優先順序", "select", {
            widget: { kind: "dropdown" },
            rules: { required: true },
            options: {
              kind: "static",
              items: [
                { value: "high", label: "高", order: 1, enabled: true },
                { value: "low", label: "低", order: 2, enabled: true },
              ],
            },
          }),
          field("due", "到貨日", "date", { widget: { kind: "datePicker" } }),
        ] as unknown as Record<string, unknown>[],
      },
    }).handlers,
    ...formRuntimeWorld({
      moduleForms: [
        {
          key: SHOPPING_FORM_KEY,
          name: "購物單",
          moduleKey: "demo-form",
          currentVersion: 1,
          tabLabelTemplate: null,
          allowDraft: true,
          canCreate: true,
        },
        {
          key: LEAVE_FORM_KEY,
          name: "病假單",
          moduleKey: "demo.form",
          currentVersion: 1,
          tabLabelTemplate: null,
          allowDraft: true,
          canCreate: true,
        },
      ],
      versions: {
        [`${SHOPPING_FORM_KEY}@1`]: shoppingDefinition(),
        [`${LEAVE_FORM_KEY}@1`]: leaveDefinition(),
      },
      submissions: [
        submissionFragment(),
        submissionFragment({
          id: "sub-2",
          summary: { title: "牛奶", date: null, amount: "120" },
          values: { item: "牛奶", qty: "3", unit_price: "40", total: "120" },
        }),
        ...leaveSubmissions(),
      ],
    }).handlers,
    // 審核流程:流程管理(假資料在 `mock-workflow-design.ts`)、申請中心與詳情、阻擋清單
    ...workflowDesignWorld(mockWorkflowDesign()).handlers,
    ...workflowRuntimeWorld(mockWorkflowRuntime()).handlers,
    // 印表機管理:兩台代理程式 / 印表機、三筆列印紀錄;測試列印一律印成功。
    // 組織樹由 orgWorld 提供(printingWorld 本來就不含 `OrgTree`)
    ...printingWorld().handlers,
  ];
};

/** 示範表單(群組內)的兩筆提交:審核中(派給登入者小華)、已核准(可作廢)。 */
const leaveSubmissions = () => [
  submissionFragment({
    id: "sub-leave-1",
    moduleKey: "demo.form",
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
  }),
  submissionFragment({
    id: "sub-leave-2",
    moduleKey: "demo.form",
    formKey: LEAVE_FORM_KEY,
    formName: "病假單",
    status: FormSubmissionStatus.Completed,
    values: { kind: "事假", days: "1", reason: "事假一天", approver: null },
    summary: { title: "事假一天", date: null, amount: null },
    currentInstanceId: "inst-2",
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
];

/** 申請中心 / 詳情 / 阻擋清單的假資料:一張待小華審核、一張採購單平行分支(採購那條阻擋)。 */
const mockWorkflowRuntime = () => ({
  instances: [
    instanceFragment({ abilities: { canWithdraw: false, canManage: true } }),
    instanceFragment({
      id: "inst-2",
      submissionId: "sub-leave-2",
      status: WorkflowInstanceStatus.Blocked,
      workflowKey: "purchase_review",
      workflowName: "採購審核",
      summary: { title: "事假一天", date: null, amount: null },
      activeStepKeys: ["legal", "purchase"],
      abilities: { canWithdraw: false, canManage: true },
      steps: [
        instanceStep("review", "原部門初審", {
          status: WorkflowStepStatus.Completed,
        }),
        instanceStep("finance", "財務部審核", {
          status: WorkflowStepStatus.Skipped,
        }),
        instanceStep("legal", "法務部審核", {
          mode: "all",
          status: WorkflowStepStatus.Active,
          plan: [planItem("legal-1", HR, { taskId: "task-legal-1" })],
        }),
        instanceStep("purchase", "採購部審核", {
          status: WorkflowStepStatus.Active,
          blocked: true,
          plan: [
            planItem("purchase-1", MANAGER, {
              assigneeState: "invalid",
              taskId: "task-purchase-1",
            }),
          ],
        }),
        instanceStep("merge", "三部門匯合", {
          kind: "join",
          mode: null,
          allowReturn: false,
        }),
        instanceStep("confirm", "原部門確認"),
      ],
      // 時間軸示範跳過、自動通過的原因,與自動通過被守門擋下(錯誤碼沒有文案 → 通用句)
      history: [
        historyEvent("started", null, null, APPLICANT),
        historyEvent("step_entered", "review", null),
        historyEvent("approved", "review", "auto_applicant", APPLICANT),
        historyEvent("step_completed", "review", null),
        historyEvent("step_skipped", "finance", "skip_orgs"),
        historyEvent("step_entered", "legal", null),
        historyEvent("approved", "legal", "auto_prior_approver", HR),
        historyEvent("step_entered", "purchase", null),
        autoApproveBlockedEvent("purchase", MANAGER, "STOCK_NOT_COUNTED"),
        historyEvent("blocked", "purchase", null),
      ],
    }),
  ],
  // 待我審核三筆(批次核准):「出差三天」核准時被專案守門擋下(錯誤碼沒有文案 → 通用句)
  tasks: [
    taskFragment({ id: "task-manager-1" }),
    taskFragment({
      id: "task-manager-2",
      instanceId: "inst-3",
      formName: "採購申請單",
      stepName: "部門主管",
      summary: { title: "辦公椅 5 張", date: null, amount: null },
    }),
    taskFragment({
      id: "task-manager-3",
      instanceId: "inst-4",
      formName: "出差申請單",
      stepName: "財務複核",
      summary: { title: "出差三天", date: null, amount: null },
    }),
  ],
  blockedTaskReasons: { "task-manager-3": "LEAVE_QUOTA_SHORT" },
  applications: [
    applicationRow(),
    applicationRow({
      id: "sub-leave-2",
      blocked: true,
      summary: { title: "事假一天", date: null, amount: null },
      currentInstanceId: "inst-2",
      activeSteps: [
        { stepKey: "legal", name: "法務部審核" },
        { stepKey: "purchase", name: "採購部審核" },
      ],
    }),
  ],
  applicable: [
    {
      moduleKey: "demo.form",
      moduleName: "示範表單(群組內)",
      forms: [
        {
          key: LEAVE_FORM_KEY,
          name: "病假單",
          moduleKey: "demo.form",
          currentVersion: 1,
          tabLabelTemplate: null,
        },
      ],
    },
  ],
  blocked: { blocked: ["inst-2"], needsAdvance: ["inst-1"] },
});
