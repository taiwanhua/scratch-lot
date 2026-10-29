import { FIELD_MANAGER_MODULE_KEY } from "@/components/base/FieldManager/field-manager-permissions";
import { OverviewPage } from "@/pages/base/OverviewPage/OverviewPage";
import {
  APPLY_CENTER_MODULE_KEY,
  APPLY_CENTER_VIEW_PAGE_KEY,
} from "@/pages/base/apply-center/apply-center-keys";
import {
  LazyApplyCenterPage,
  LazyApplyCenterViewPage,
} from "@/pages/base/apply-center/lazy-apply-center-view-page";
import { SampleOneFormPage } from "@/pages/base/demo/SampleOneFormPage/SampleOneFormPage";
import { SampleOnePage } from "@/pages/base/demo/SampleOnePage/SampleOnePage";
import { SampleOneViewPage } from "@/pages/base/demo/SampleOneViewPage/SampleOneViewPage";
import { SampleTwoFormPage } from "@/pages/base/demo/SampleTwoPage/SampleTwoFormPage";
import { SampleTwoPage } from "@/pages/base/demo/SampleTwoPage/SampleTwoPage";
import { SampleTwoViewPage } from "@/pages/base/demo/SampleTwoPage/SampleTwoViewPage";
import { SAMPLE_ONE_MODULE_KEYS } from "@/pages/base/demo/demo-sample-one-config";
import { SAMPLE_TWO_MODULE_KEYS } from "@/pages/base/demo/demo-sample-two-config";
import { DataScopePage } from "@/pages/base/system/DataScopePage/DataScopePage";
import { DATA_SCOPE_MODULE_KEY } from "@/pages/base/system/DataScopePage/data-scope-permissions";
import { FieldManagerPage } from "@/pages/base/system/FieldManagerPage/FieldManagerPage";
import { FORMS_MODULE_KEY } from "@/pages/base/system/FormsPage/forms-permissions";
import { LazyFormsPage } from "@/pages/base/system/FormsPage/lazy-forms-page";
import { ModuleManagerPage } from "@/pages/base/system/ModuleManagerPage/ModuleManagerPage";
import { MODULE_MANAGER_MODULE_KEY } from "@/pages/base/system/ModuleManagerPage/module-manager-permissions";
import { NotificationSettingsPage } from "@/pages/base/system/NotificationSettingsPage/NotificationSettingsPage";
import { NOTIFICATION_SETTINGS_MODULE_KEY } from "@/pages/base/system/NotificationSettingsPage/notification-settings-permissions";
import { OrgManagerPage } from "@/pages/base/system/OrgManagerPage/OrgManagerPage";
import { ORG_MANAGER_MODULE_KEY } from "@/pages/base/system/OrgManagerPage/org-manager-permissions";
import { LazyPrintersPage } from "@/pages/base/system/PrintersPage/lazy-printers-page";
import { PRINTERS_MODULE_KEY } from "@/pages/base/system/PrintersPage/printers-permissions";
import { RoleManagerPage } from "@/pages/base/system/RoleManagerPage/RoleManagerPage";
import { ROLE_MANAGER_MODULE_KEY } from "@/pages/base/system/RoleManagerPage/role-manager-permissions";
import { UserManagerPage } from "@/pages/base/system/UserManagerPage/UserManagerPage";
import { USER_MANAGER_MODULE_KEY } from "@/pages/base/system/UserManagerPage/user-manager-permissions";
import { LazyWorkflowBlockedPage } from "@/pages/base/system/WorkflowBlockedPage/lazy-workflow-blocked-page";
import { LazyWorkflowsPage } from "@/pages/base/system/WorkflowsPage/lazy-workflows-page";
import {
  WORKFLOWS_BLOCKED_PAGE_KEY,
  WORKFLOWS_MODULE_KEY,
} from "@/pages/base/system/workflows-permissions";

import type { ModulePageSource } from "../module-page-registry";

/** 總覽模組 key(seed 正本:apps/db-migrator/seeds/base/modules/overview.ts;admin 不能 import db-migrator,STRUCT-01)。 */
export const OVERVIEW_MODULE_KEY = "overview";

/** 示範表單(頂層):表單模組掛在側欄頂層(seed 正本 apps/db-migrator/seeds/base/modules/demo-form.ts,`engine: "form"`)。 */
export const DEMO_FORM_MODULE_KEY = "demo-form";

/** 示範表單(群組內):表單模組掛在 `demo` 群組底下(seed 正本 apps/db-migrator/seeds/base/modules/demo.form.ts,`engine: "form"`)。 */
export const DEMO_GROUP_FORM_MODULE_KEY = "demo.form";

/** 示範表單(次群組內):表單模組掛在 `demo.sub` 次群組底下(seed 正本 apps/db-migrator/seeds/base/modules/demo.sub.form.ts,`engine: "form"`)。 */
export const DEMO_SUB_GROUP_FORM_MODULE_KEY = "demo.sub.form";

/**
 * 底座的模組頁面來源(組裝層,STRUCT-03):底座模組實作時在此登記;專案的頁面不寫在這裡
 * (新增 → `app/project/module-pages.ts`,替換底座頁 → `app/project/page-replacements.ts`)。
 * 沒登記的模組由殼顯示佔位頁(模組名)。路由本身仍由 `me.modules` 決定,這裡只決定「進去看到什麼」。
 *
 * `minWidth` = 這一頁排得下的最窄視窗(主題斷點;沒寫 = 殼層預設 `md`,平板寬就完整顯示;`AdminShell/shell-geometry.ts`)。
 * 目前底座頁都沒宣告:兩個設計器在 `xl` 以下、平板寬各自換版(`pages/base/system/designer-layout.ts`)。
 */
export const baseModulePages: ModulePageSource = {
  pages: [
    { key: OVERVIEW_MODULE_KEY, Page: OverviewPage },
    // 示範模組1 四個 key = 四頁;新增與編輯是**同一個共版型元件**,情境由 `module.key` 判斷
    { key: SAMPLE_ONE_MODULE_KEYS.list, Page: SampleOnePage },
    { key: SAMPLE_ONE_MODULE_KEYS.viewPage, Page: SampleOneViewPage },
    { key: SAMPLE_ONE_MODULE_KEYS.createPage, Page: SampleOneFormPage },
    { key: SAMPLE_ONE_MODULE_KEYS.editPage, Page: SampleOneFormPage },
    // 示範模組2 四個 key = 四頁;與示範模組1 同一組共用元件,差別只在設定物件
    { key: SAMPLE_TWO_MODULE_KEYS.list, Page: SampleTwoPage },
    { key: SAMPLE_TWO_MODULE_KEYS.viewPage, Page: SampleTwoViewPage },
    { key: SAMPLE_TWO_MODULE_KEYS.createPage, Page: SampleTwoFormPage },
    { key: SAMPLE_TWO_MODULE_KEYS.editPage, Page: SampleTwoFormPage },
    { key: ORG_MANAGER_MODULE_KEY, Page: OrgManagerPage },
    { key: MODULE_MANAGER_MODULE_KEY, Page: ModuleManagerPage },
    { key: FIELD_MANAGER_MODULE_KEY, Page: FieldManagerPage },
    { key: USER_MANAGER_MODULE_KEY, Page: UserManagerPage },
    { key: ROLE_MANAGER_MODULE_KEY, Page: RoleManagerPage },
    { key: DATA_SCOPE_MODULE_KEY, Page: DataScopePage },
    // 表單管理:懶載入(設計器不進首屏 bundle);沿用殼層預設 `md`,設計器在 `xl` 以下自己換版
    // (`pages/base/system/designer-layout.ts`)
    { key: FORMS_MODULE_KEY, Page: LazyFormsPage },
    // 審核流程:流程管理、阻擋清單、申請中心兩頁籤與詳情,全部懶載入(不進首屏 bundle);
    // 流程設計器(流程圖 + 關卡屬性)同表單管理沿用 `md`、在 `xl` 以下收窄屬性面板
    { key: WORKFLOWS_MODULE_KEY, Page: LazyWorkflowsPage },
    { key: WORKFLOWS_BLOCKED_PAGE_KEY, Page: LazyWorkflowBlockedPage },
    // 通知設定:負責人提醒的收件人
    { key: NOTIFICATION_SETTINGS_MODULE_KEY, Page: NotificationSettingsPage },
    { key: APPLY_CENTER_MODULE_KEY, Page: LazyApplyCenterPage },
    { key: APPLY_CENTER_VIEW_PAGE_KEY, Page: LazyApplyCenterViewPage },
    // 印表機管理:懶載入(測試頁的條碼 / QR code 零件不進首屏 bundle)
    { key: PRINTERS_MODULE_KEY, Page: LazyPrintersPage },
  ],
  // 三個示範表單模組(頂層 / 群組內 / 次群組內):四個 key 全用表單引擎的預設組裝;
  // 表單綁了流程時,詳情頁下方自動掛審核區塊(預設組裝含)
  forms: [
    { moduleKey: DEMO_FORM_MODULE_KEY },
    { moduleKey: DEMO_GROUP_FORM_MODULE_KEY },
    { moduleKey: DEMO_SUB_GROUP_FORM_MODULE_KEY },
  ],
};
