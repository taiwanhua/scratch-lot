import path from "node:path";

import { describe, expect, it } from "@jest/globals";

import { defaultLocale } from ".";
import {
  flattenKeys,
  keysOf,
  namespacesOf,
  readProjectFile,
} from "./message-keys";
import { referencedKeys } from "./usage-scan";

/**
 * 死鍵守門:字典裡的鍵在 `apps/admin/src`、`apps/front/src` 沒有任何引用就失敗。
 * 掃描做法(字面字串 × namespace 的配對、配對範圍、掃不到什麼)寫在 `usage-scan.ts` 檔頭。
 *
 * 失敗時二選一:①真的沒人用了 → 兩語系一起刪掉那個鍵;②鍵是執行期組出來的 → 加進下方
 * `DYNAMIC_KEYS` 並寫理由。**不要**為了讓測試過而在程式碼裡寫一個沒用到的字串。
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SOURCE_ROOTS = [
  path.join(REPO_ROOT, "apps", "admin", "src"),
  path.join(REPO_ROOT, "apps", "front", "src"),
];

/**
 * 靜態掃描看不到、由執行期的值組出來的鍵。以 `.` 結尾的是前綴(底下全部算有引用),
 * 其餘是單一個鍵。每一條都寫「值從哪裡來」,之後有人要刪才知道去哪裡確認。
 */
const DYNAMIC_KEYS: readonly { key: string; reason: string }[] = [
  {
    key: "admin.lotteryMasterData.errors.",
    reason:
      "`t(`errors.${code}`)`,code 由 `pages/project/lottery/master-data/master-data-error.ts` 從 api 錯誤碼與 reason 換算",
  },
  {
    key: "admin.lotteryMasterData.status.",
    reason:
      "`t(status)` / `t(`status.${status}`)`,status 是遊戲狀態 `GAME_STATUSES`",
  },
  {
    key: "admin.lotteryMasterData.gameForm.fields.",
    reason: "遊戲詳情的基本資料以欄位 key 組出標題(`GameBasicTab`)",
  },
  {
    key: "admin.lotteryMasterData.gameView.tabs.",
    reason:
      "詳情頁分頁標題 `t(`gameView.tabs.${labelKey}`)`,labelKey 取自 `game-detail-tabs.ts`",
  },
  {
    key: "admin.lotteryDealers.badgeDescription",
    reason:
      "經銷商側欄計數的「數什麼」:由 api 側欄計數登記的 `descriptionKey` 給(`dealer-badge.ts`),畫面在 `SidebarBadgeSettingsSection`",
  },
  {
    key: "admin.lotteryAccounts.badgeDescription",
    reason:
      "帳戶管理側欄計數的「數什麼」:由 api 側欄計數登記的 `descriptionKey` 給(`accounts-badge.ts`)",
  },
  {
    key: "admin.lotteryAccounts.errors.",
    reason:
      "`t(`errors.${code}`)`,code 由 `lib/project/lottery/accounts-error.ts` 從 api 錯誤碼與 reason 換算",
  },
  {
    key: "admin.lotteryAccounts.status.",
    reason: "帳戶狀態 `BANK_ACCOUNT_STATUSES`(`status.${status}`)",
  },
  {
    key: "admin.lotteryAccounts.transactionTypes.",
    reason: "銀行交易類型 `BANK_TRANSACTION_TYPES`(`transactionTypes.${type}`)",
  },
  {
    key: "admin.lotteryAccounts.movementTypes.",
    reason: "現金流水類型 `CASH_MOVEMENT_TYPES`(`movementTypes.${type}`)",
  },
  {
    key: "admin.lotteryAccounts.places.",
    reason: "現金流水的從 / 到 `CASH_PLACES`(`places.${place}`)",
  },
  {
    key: "admin.lotteryAccounts.withdrawReasons.",
    reason: "出庫原因 `WITHDRAW_REASONS`(`withdrawReasons.${reason}`)",
  },
  {
    key: "admin.lotteryAccounts.outstanding.kinds.",
    reason: "待結清種類 `to_pay` / `to_refund` / `to_receive`(api 的 `kind`)",
  },
  {
    key: "admin.lotteryAccounts.settlement.buttons.",
    reason:
      "收付按鈕 `settlement.buttons.${role}.${button}`(`components/project/lottery/SettlementPanel/settlement-text.ts`)",
  },
  {
    key: "admin.sidebarBadgeSettings.descriptions.",
    reason:
      "通知設定頁「側欄數字」的「數什麼」:完整 key 由 api 側欄計數登記的 `descriptionKey` 給(`SidebarBadgeSettingsSection`)",
  },
  {
    key: "admin.shell.userMenu.modes.",
    reason:
      "`t(`modes.${mode}`)`,mode 逐一取自 `@repo/ui/app-theme-provider` 的 `COLOR_MODES`",
  },
  {
    key: "admin.login.errors.",
    reason:
      "`t(`errors.${errorKey}`)`,errorKey 由 `login-error.ts` 從 api 錯誤碼換算",
  },
  {
    key: "admin.changePassword.errors.",
    reason:
      "`t(`errors.${errorKey}`)`,errorKey 由 `change-password-error.ts` 從 api 錯誤碼換算",
  },
  {
    key: "admin.orgManager.delete.reasons.",
    reason:
      "`t(`reasons.${reason}`)`,reason 是 api `ORG_NOT_DELETABLE` 帶回的 `OrgNotDeletableReason`",
  },
  {
    key: "admin.roleManager.delete.reasons.",
    reason:
      "`t(`reasons.${reason}`)`,reason 是 api `ROLE_NOT_DELETABLE` 帶回的 `RoleNotDeletableReason`",
  },
  {
    key: "admin.roleManager.delete.references.",
    reason:
      "`t(`references.${kind}`)`,kind 是 api `ROLE_NOT_DELETABLE` 帶回的 `extensions.references[].kind`",
  },
  {
    key: "admin.userManager.orgChange.reasons.",
    reason: "`t(`reasons.${reason}`)`,reason 是 `setUserOrgs` dry-run 回的列舉",
  },
  {
    key: "admin.userManager.copyOrgRoles.blockers.",
    reason:
      "`t(`blockers.${code}`)`,code 是 `copyUserOrgRoles` 回的 `CopyUserOrgRolesBlockerCode` 列舉",
  },
  {
    key: "admin.userManager.form.genderOptions.",
    reason:
      "`t(`genderOptions.${gender}`)`,gender 逐一取自 GraphQL 的 `Gender` 列舉",
  },
  {
    key: "admin.forms.upgrade.skipReasons.",
    reason:
      "`t(`skipReasons.${reason}`)`,reason 是 api `upgradeFormSubmissions` 回的跳過原因(`FORM_UPGRADE_SKIP_REASONS`)",
  },
  {
    key: "admin.moduleIcons.",
    reason:
      "`tIcons(key)`,key 是 `@repo/ui` 圖示登錄表的 29 個短詞(I18N-01 的覆寫 prop)",
  },
  {
    key: "admin.dataScope.conditions.",
    reason: "`tConditions(cond)`,cond 取自 `CONDITIONS_BY_TYPE[field.type]`",
  },
  {
    key: "admin.dataScope.dynamic.",
    reason: "`tDynamic(ref)`,ref 是動態值來源的列舉(`current-user` 等)",
  },
  {
    key: "admin.dataScope.reasons.",
    reason:
      "`tReasons(issue.reason)`,reason 是 `RuleInvalidReason`(`data-scope-issues.ts` / api 回傳)",
  },
  {
    key: "admin.audiencePicker.fields.",
    reason:
      "`t(`fields.${field}`)`,field 取自 AudiencePicker 的 `fields`(`@repo/domain/audience` 的 `AUDIENCE_FIELDS`)",
  },
  {
    key: "admin.audiencePicker.ranges.",
    reason:
      "`t(`ranges.${range}`)`,range 取自 `@repo/domain/audience` 的 `AUDIENCE_ORG_RANGES`",
  },
  {
    key: "admin.audiencePicker.emptyGroup",
    reason:
      "資料範圍 `RuleCard` 的 `tPicker(issue.localReason)`,localReason 由 `data-scope-issues.ts` 本地驗證給(空群組)",
  },
  {
    key: "admin.audiencePicker.emptyValue",
    reason:
      "資料範圍 `RuleCard` 的 `tPicker(issue.localReason)`,localReason 由 `data-scope-issues.ts` 本地驗證給(條件列沒挑值)",
  },
  {
    key: "admin.demoSampleOne.status.",
    reason: "`t(`status.${row.status}`)`,status 是示範模組1 的狀態列舉",
  },
  {
    key: "admin.demoSampleOne.history.actions.",
    reason:
      "`t(`actions.${historyActionKeyOf(entry.action)}`)`,來源是異動紀錄的 action",
  },
  {
    key: "admin.demoSampleOne.errors.fields.",
    reason:
      "`tErrors(`fields.${field}`)`,field 是 api `VALIDATION_FAILED` 逐項回報的欄位名",
  },
  {
    key: "admin.demoSampleTwo.errors.fields.",
    reason: "同示範模組1:`VALIDATION_FAILED` 回報的欄位名",
  },
  {
    key: "admin.demoSampleOne.fields.coverPath",
    reason:
      "異動紀錄 `tFields(field)` 的 field 是 api 欄位名(存的是 path,不是畫面上的 cover)",
  },
  {
    key: "admin.demoSampleOne.fields.attachmentPath",
    reason: "同上:異動紀錄裡附件欄位的 api 欄位名",
  },
  {
    key: "admin.formEngine.errors.",
    reason:
      "`tErrors(code)`,code 由 `lib/base/form-engine/form-errors.ts` 的 `formErrorOf` 從 api 錯誤碼換算",
  },
  {
    key: "admin.formEngine.list.slots.",
    reason:
      "`t(`slots.${spec.key}`)`,key 是列表欄位配置的摘要槽(title / date / amount)與單號 serialNo",
  },
  {
    key: "admin.moduleManager.listColumns.builtinColumns.",
    reason:
      "`t(`builtinColumns.${column}`)`,column 取自 `LIST_BUILTIN_COLUMNS`(列表內建欄 form / status / createdBy)",
  },
  {
    key: "admin.formEngine.pages.actions.",
    reason:
      "`t(subject.action)`,action 是頁籤模板的頁面種類 `TabLabelAction`(view / edit / create)",
  },
  {
    key: "admin.forms.errors.",
    reason: "`tErrors(code)`,code 同 `formErrorOf` 的換算(表單管理頁)",
  },
  {
    key: "admin.forms.versions.statuses.",
    reason:
      "`t(`statuses.${item.status}`)`,status 是 GraphQL 的 `FormVersionStatus`",
  },
  {
    key: "admin.forms.designer.types.",
    reason:
      "`t(`types.${type}`)`,type 逐一取自 `@repo/domain/form` 的 `FIELD_TYPES`",
  },
  {
    key: "admin.forms.property.types.",
    reason: "同上:屬性面板顯示欄位的 `type`",
  },
  {
    key: "admin.forms.property.widgets.",
    reason: "`t(`widgets.${kind}`)`,kind 取自 widget 登錄表(`widgetKindsFor`)",
  },
  {
    key: "admin.forms.property.sources.",
    reason: "`t(`sources.${kind}`)`,kind 是 `ValueSource` 的三種",
  },
  {
    key: "admin.forms.columns.sources.",
    reason:
      "`t(`sources.${kind}`)`,kind 取自明細子欄值來源的 `SOURCE_KINDS`(使用者填 / 列內公式)",
  },
  {
    key: "admin.forms.options.sources.",
    reason: "`t(`sources.${kind}`)`,kind 是 `FieldOptions` 的三種來源",
  },
  {
    key: "admin.forms.lookupSource.providers.",
    reason:
      "`t(`providers.${provider.key}`)`(`useLookupCatalog.ts` 的 `useProviderLabel`),key 是 api `formLookupProviders` 回的底座來源(`isBase`):user / org / form_submission",
  },
  {
    key: "admin.forms.lookupSource.fields.",
    reason: "`t(`fields.${field}`)`,field 是 lookup provider 可回的欄位",
  },
  {
    key: "admin.forms.rules.formats.",
    reason: "`t(`formats.${format}`)`,format 取自 `TEXT_FORMATS`",
  },
  {
    key: "admin.forms.settings.slots.",
    reason: "`t(`slots.${slot}`)`,slot 是摘要槽(title / date / amount)",
  },
  {
    key: "admin.forms.deleteField.slots.",
    reason: "`t(`slots.${reference.slot}`)`,slot 是 `ExpressionSlot`",
  },
  {
    key: "admin.forms.deleteField.summarySlots.",
    reason: "`t(`summarySlots.${reference.slot}`)`,slot 是摘要槽",
  },
  {
    key: "admin.forms.expression.kinds.",
    reason: "`t(`kinds.${item}`)`,item 是表達式節點種類",
  },
  {
    key: "admin.forms.expression.contexts.",
    reason: "`t(`contexts.${item}`)`,item 取自 `CONTEXT_VAR_PATHS`(`ctx.now`…)",
  },
  {
    key: "admin.forms.expression.operators.",
    reason: "`t(`operators.${item}`)`,item 取自 `EXPRESSION_OPERATORS`",
  },
  {
    key: "admin.forms.expression.constants.",
    reason: "`t(`constants.${item}`)`,item 是常數種類",
  },
  {
    key: "admin.forms.expression.units.",
    reason:
      "`t(`units.${unit}`)`,unit 取自 `DATE_DIFF_UNITS`(`dateDiff` 的單位)",
  },
  {
    key: "admin.forms.expression.directions.",
    reason:
      "`t(`directions.${direction}`)`,direction 取自 `DATE_ADD_DIRECTIONS`(`dateAdd` 的方向)",
  },
  {
    key: "admin.forms.expression.calendarUnits.",
    reason:
      "`t(`calendarUnits.${unit}`)`,unit 取自 `LOCAL_CALENDAR_UNITS`(`dateAdd` 的日曆單位)",
  },
  {
    key: "admin.forms.property.defaultKinds.",
    reason:
      "`t(`defaultKinds.${item}`)`,item 取自 `defaultKindsOf(type)`(固定值 / 公式;`none` 直接引用)",
  },
  {
    key: "admin.forms.property.defaultSystem.",
    reason:
      "`t(`defaultSystem.${…}`)`,由 `REFERENCE_DEFAULT_PATHS`(填寫者 / 填寫者的組織)換算",
  },
  {
    key: "admin.forms.rules.uploadTypes.",
    reason:
      "`t(`uploadTypes.${group.key}`)`,key 取自 `lib/base/form-engine/upload-types.ts` 的 `UPLOAD_TYPE_GROUPS`",
  },
  {
    key: "admin.forms.property.keyProblems.",
    reason:
      "`t(`keyProblems.${problem}`)`,problem 是 `fieldKeyProblemOf` 回的原因(格式 / 保留字 / 重複)",
  },
  {
    key: "admin.forms.edit.placeholderNames.",
    reason:
      "`t(`placeholderNames.${placeholder}`)`,placeholder 取自 `TAB_LABEL_PLACEHOLDERS`(頁籤模板佔位符)",
  },
  {
    key: "admin.forms.lookupSource.summarySlots.",
    reason:
      "`t(`summarySlots.${slot}`)`,slot 是 `form_submission` 欄位目錄裡的摘要槽",
  },
  {
    key: "admin.forms.detail.serialPeriods.",
    reason:
      "`t(`serialPeriods.${period}`)`,period 取自 `SERIAL_PERIODS`(單號的期間 none / year / month)",
  },
  {
    key: "admin.forms.detail.serialSeparators.",
    reason:
      "`t(`serialSeparators.${option.key}`)`,key 取自 `SerialFormatField` 的分隔符選項(dash / underscore / slash / dot / none)",
  },
  {
    key: "admin.moduleManager.listColumns.slots.",
    reason: "`t(`slots.${slot}`)`,slot 取自 `SUMMARY_SLOTS`",
  },
  {
    key: "admin.approval.submissionStatus.",
    reason:
      "`t(status)` / `tStatus(value)`,status 是 GraphQL 的 `FormSubmissionStatus`(七值)",
  },
  {
    key: "admin.approval.section.statuses.",
    reason:
      "`t(`statuses.${instance.status}`)`,status 是 `WorkflowInstanceStatus`",
  },
  {
    key: "admin.approval.progress.statuses.",
    reason: "`t(`statuses.${step.status}`)`,status 是 `WorkflowStepStatus`",
  },
  {
    key: "admin.approval.progress.modes.",
    reason: "`t(`modes.${step.mode}`)`,mode 是會簽模式(`any` / `all`)",
  },
  {
    key: "admin.approval.decisions.",
    reason:
      "`tDecision(decision.decision)`,值是實例上的決定(`approved` / `rejected` / `returned`)",
  },
  {
    key: "admin.approval.timeline.kinds.",
    reason: "`t(`kinds.${event.kind}`)`,kind 是實例 `history` 的事件種類",
  },
  {
    key: "admin.approval.timeline.autoApproveBlocked.",
    reason:
      "`t(`autoApproveBlocked.${event.reason}`)`,自動通過被守門擋下:reason 是哪一種自動通過",
  },
  {
    key: "admin.approval.timeline.reasons.",
    reason:
      "`t(`reasons.${event.reason}`)`,reason 取自 `HISTORY_REASONS`(跳過 / 自動通過的原因)",
  },
  {
    key: "admin.approval.decide.buttons.",
    reason: "`t(`buttons.${item}`)`,item 是 GraphQL 的 `WorkflowDecision`",
  },
  {
    key: "admin.approval.decide.titles.",
    reason: "同上:決定跳窗的標題",
  },
  {
    key: "admin.approval.decide.bodies.",
    reason: "同上:決定跳窗的說明",
  },
  {
    key: "admin.approval.decide.confirms.",
    reason: "同上:決定跳窗的確認鈕",
  },
  {
    key: "admin.approval.decide.feedback.",
    reason:
      "`t(`feedback.${variables.input.decision}`)`,送出的 `WorkflowDecision`",
  },
  {
    key: "admin.applyCenter.tasks.statuses.",
    reason:
      "`t(`statuses.${row.status}`)`,status 是 GraphQL 的 `WorkflowTaskStatus`",
  },
  {
    key: "admin.workflows.errors.",
    reason:
      "`tErrors(code)`,code 由 `lib/base/workflow/workflow-errors.ts` 的 `workflowErrorOf` 從 api 錯誤碼 / reason 換算",
  },
  {
    key: "admin.seedExport.errors.",
    reason:
      "`tErrors(code)`,code 由 `lib/seed-export.ts` 的 `seedExportErrorOf` 從 api 錯誤碼 / reason / fields 換算(匯出專案設定彈窗)",
  },
  {
    key: "admin.workflows.versions.statuses.",
    reason:
      "`t(`statuses.${item.status}`)`,status 是 GraphQL 的 `WorkflowVersionStatus`",
  },
  {
    key: "admin.workflows.opErrors.",
    reason:
      "`tOp(state.opError)`,值是 `lib/base/workflow/flow-model.ts` 的 `FlowOpError`",
  },
  {
    key: "admin.workflows.step.modes.",
    reason:
      "`t(`modes.${mode}`)` / `tMode(step.mode)`,mode 取自 `APPROVAL_MODES`",
  },
  {
    key: "admin.workflows.step.modeHints.",
    reason: "`t(`modeHints.${step.mode}`)`,同上",
  },
  {
    key: "admin.workflows.assignee.kinds.",
    reason: "`t(`kinds.${kind}`)`,kind 取自 `ASSIGNEE_KINDS`",
  },
  {
    key: "admin.workflows.assignee.purposes.",
    reason:
      "`t(`purposes.${purpose}.<文案>`)`,purpose 是流程設計器的 `PeoplePurpose`(審核者 / 知會對象 / 通知對象)",
  },
  {
    key: "admin.forms.binding.problems.",
    reason:
      "`t(`problems.${issue.problem}`)`,problem 是 api 綁定時檢查的 `BindingIssue.problem`",
  },
  {
    key: "admin.demoSampleOne.form.categoryUnavailable",
    reason:
      "`SampleOneCategoryField` 用的 `t` 由 `components/base/crud/DemoForm` 經 context 傳入,兩者不在同一個資料夾",
  },
  // 示範模組的鍵寫在 `pages/base/demo/` 的設定物件,`t` 開在共用元件 `components/base/crud/`:
  // 兩邊不在同一個資料夾,掃描配不到。逐鍵列出(不用前綴),之後新增的死鍵才不會被整段蓋過去
  ...["name", "category", "note", "status", "enabled", "actions"].map(
    (column) => ({
      key: `admin.demoSampleOne.columns.${column}`,
      reason:
        "`components/base/crud/DemoListTable` 的 `tColumns(column.key)`,key 取自 `pages/base/demo/SampleOneModule.tsx` 的 `list.columns`",
    }),
  ),
  ...["name", "note", "enabled", "actions"].map((column) => ({
    key: `admin.demoSampleTwo.columns.${column}`,
    reason:
      "`components/base/crud/DemoListTable` 的 `tColumns(column.key)`,key 取自 `pages/base/demo/SampleTwoModule.tsx` 的 `list.columns`",
  })),
  {
    key: "admin.demoSampleOne.form.internalNoteReadonly",
    reason:
      "`components/base/crud/DemoFormFields` 的 `t(field.readonlyHintKey)`,值寫在 `pages/base/demo/SampleOneModule.tsx` 的表單欄位設定",
  },
  {
    key: "admin.demoSampleOne.form.coverHint",
    reason:
      "`components/base/crud/DemoFormFields` 的 `t(definition.hintKey)`,值寫在 `pages/base/demo/SampleOneModule.tsx` 的封面上傳欄設定",
  },
  {
    key: "admin.demoSampleOne.form.coverCurrent",
    reason:
      "`components/base/crud/DemoFormFields` 的 `t(definition.previewLabelKey)`,值寫在 `pages/base/demo/SampleOneModule.tsx` 的封面上傳欄設定",
  },
  {
    key: "admin.demoSampleOne.form.attachmentHint",
    reason:
      "`components/base/crud/DemoFormFields` 的 `t(definition.hintKey)`,值寫在 `pages/base/demo/SampleOneModule.tsx` 的附件上傳欄設定",
  },
  {
    key: "admin.notifications.preferences.channels.",
    reason:
      "個人設定偏好分頁的 `t(`channels.${channel}`)`,channel 是 api `myNotificationPreferences` 回的管道 key(`in-app`、`email`;沒登記文案的管道顯示 key 本身)",
  },
  {
    key: "admin.printers.jobStatus.",
    reason:
      "`PrintJobStatusTag` 的 `t(job.status)` 與列印紀錄的結果篩選,值是 GraphQL 的 `PrintJobStatus` 列舉",
  },
  {
    key: "admin.printers.jobError.",
    reason:
      "`tJobError(job.error)`(列印紀錄的結果、測試列印與列印按鈕的失敗原因),值是 GraphQL 的 `PrintJobError` 列舉",
  },
  {
    key: "admin.printButton.errors.",
    reason:
      "列印按鈕送出失敗的提示 `t(`errors.${printButtonErrorOf(error).code}`)`(錯誤碼表在 `lib/base/print-button.ts`)",
  },
  {
    key: "admin.notifications.types.",
    reason:
      "`lib/base/notification-type-name.ts` 的 `t(`types.${type}`)`,type 是 api 回的通知類型 key(`workflow.task-created` 等;沒有文案的類型退回 api 的 `name`)",
  },
  {
    key: "admin.approval.timeline.delegated.",
    reason:
      "`ApprovalTimeline` 的 `t(`delegated.${event.kind}`)`,kind 是帶了被代理者的 `task_created` / `approved` / `rejected` / `returned`",
  },
  {
    key: "admin.personalSettings.delegations.statuses.",
    reason:
      "`t(`statuses.${row.status}`)`,status 逐一取自 GraphQL 的 `UserDelegationStatus` 列舉(`DelegationsTab`)",
  },
  {
    key: "admin.personalSettings.delegations.errors.",
    reason:
      "`t(`errors.${delegationsErrorKey(error)}`)`,`delegations-error.ts` 把 api 錯誤換成 `<code>` 或 `reasons.<reason>`(碼與 reason 列舉見同檔)",
  },
  {
    key: "admin.schedule.tabs.",
    reason:
      "專案 `components/project/schedule/ScheduleTabsPage` 的 `t(`tabs.${labelKey}`)`,labelKey 取自各頁的分頁登記 `pages/project/schedule/<模組>/<模組>-tabs.ts`",
  },
  {
    key: "admin.schedule.errors.",
    reason:
      "`tErrors(scheduleErrorOf(error).code)`,code 由 `pages/project/schedule/schedule-error.ts` 從 api 錯誤碼換算",
  },
  {
    key: "admin.schedule.employment.",
    reason:
      "`tEmployment(employmentType)`,值取自 `@repo/domain/project/schedule-settings` 的 `SCHEDULE_EMPLOYMENT_TYPES`(api 回的 `employmentType`)",
  },
  {
    key: "admin.schedule.weekTemplates.weekdays.",
    reason: "`t(`weekdays.${day}`)`,day 為 0–6(`WEEK_DAY_COUNT`)",
  },
  {
    key: "admin.schedule.weekTemplates.weekdayLong.",
    reason: "`t(`weekdayLong.${day}`)`,day 為 0–6(`WEEK_DAY_COUNT`)",
  },
  {
    key: "admin.schedule.calendar.weekdays.",
    reason: "行事曆月曆的星期列 `t(`weekdays.${day}`)`,day 為 0–6",
  },
  {
    key: "admin.schedule.rules.labels.",
    reason:
      "規則頁的 `t(`labels.${key}`)`,key 取自 api 回的規則(定義清單 `@repo/domain/project/schedule-settings` 的 `SCHEDULE_RULE_DEFINITIONS`)",
  },
  {
    key: "admin.schedule.rules.levels.",
    reason:
      "`t(`levels.${level}`)`,level 為 `SCHEDULE_RULE_LEVELS`(limit / reminder)",
  },
  {
    key: "admin.schedule.rules.units.",
    reason:
      "`rule-display.ts` 的 `t(`units.${unit}`)`,unit 取自規則定義的 `unit`",
  },
  {
    key: "admin.schedule.rules.unitNames.",
    reason:
      "`RuleValueEditor` 的 `t(`unitNames.${unit}`)`,unit 取自規則定義的 `unit`",
  },
  {
    key: "admin.schedule.legend.items.",
    reason:
      "專案 `components/project/schedule/ScheduleLegend` 的 `t(`items.${item}`)`,item 取自呼叫端傳入的 `ScheduleLegendItem`",
  },
  {
    key: "admin.schedule.roster.columns.",
    reason:
      "排班表統計欄表頭 `t(`columns.${column}`)`,column 取自 `@repo/domain/project/schedule-settings` 的 `SCHEDULE_ROSTER_STAT_COLUMNS`",
  },
  {
    key: "admin.schedule.roster.columnPicker.options.",
    reason:
      "[⚙ 顯示欄位] 的 `t(`columnPicker.options.${column}`)`,column 同上(`SCHEDULE_ROSTER_STAT_COLUMNS`)",
  },
  {
    key: "admin.schedule.roster.views.",
    reason:
      "排班表檢視切換 `t(`views.${labelKey}`)`,labelKey 取自 `pages/project/schedule/manage/roster/roster-views.ts`",
  },
  {
    key: "admin.schedule.roster.cell.roles.",
    reason:
      "職責文字 `t(`roles.${role}`)` / `tRoster(`cell.roles.${role}`)`,role 是 api 回的 `leader` / `helper`(`SCHEDULE_TASK_ROLES`)",
  },
  {
    key: "admin.schedule.roster.demandDialog.roles.",
    reason: "人力需求對話框的職責區塊,role 同上(`DemandTaskList`)",
  },
  {
    key: "admin.schedule.roster.demandDialog.limits.",
    reason: "人力需求對話框的職責區塊,role 同上(`DemandTaskList`)",
  },
  {
    key: "admin.schedule.roster.demandDialog.empty.",
    reason: "人力需求對話框的職責區塊,role 同上(`DemandTaskList`)",
  },
  {
    key: "admin.schedule.roster.demandDialog.add.",
    reason: "人力需求對話框的職責區塊,role 同上(`DemandTaskList`)",
  },
  {
    key: "admin.schedule.roster.impact.roles.",
    reason: "解除確認的職責文字,role 同上(`DemandImpactDialog`)",
  },
  {
    key: "admin.tagPalettes.names.",
    reason:
      "專案 `components/project/TagPaletteChip` 的 `t(paletteKey)`(namespace `admin.tagPalettes.names`),paletteKey 逐一取自 `@repo/domain/project/tag-palette` 的 `TAG_PALETTE_KEYS`",
  },
  {
    key: "admin.lotteryReports.reports.",
    reason:
      "專案輸出報表的報表名稱:`registerReport({ name })` 的訊息 key(`pages/project/lottery/reports/report-registrations.ts`),頁面以 `t(report.name)` 取用",
  },
  {
    key: "admin.lotteryReports.periodPicker.kinds.",
    reason:
      "專案 `components/project/ReportPeriodPicker` 的 `t(`kinds.${kind}`)`,kind 取自報表登記的 `conditions.period`(`REPORT_PERIOD_KINDS`)",
  },
  {
    key: "admin.lotteryReports.periodPicker.weekdays.",
    reason:
      "專案 `components/project/ReportPeriodPicker` 的 `t(`weekdays.${day}`)`,day 是 0(星期日)到 6",
  },
  {
    key: "admin.lotteryReports.errors.",
    reason:
      "專案輸出報表的 `t(`lotteryReports.errors.${code}`)`,code 由 `pages/project/lottery/reports/ReportsPage/reports-error.ts` 從 api 錯誤碼換算",
  },
];

const isCoveredByDynamicKeys = (key: string): boolean =>
  DYNAMIC_KEYS.some((entry) =>
    entry.key.endsWith(".") ? key.startsWith(entry.key) : key === entry.key,
  );

const allKeys = () => {
  const leaves = new Set<string>();
  const branches = new Set<string>();
  for (const namespace of namespacesOf(defaultLocale)) {
    const keys = keysOf(defaultLocale, namespace);
    for (const key of keys.leaves) {
      leaves.add(key);
    }
    for (const key of keys.branches) {
      branches.add(key);
    }
  }
  // 專案新增的後台文案併進 admin namespace,同樣要有引用(替換檔沒有自己的鍵)
  const project = flattenKeys(readProjectFile(defaultLocale, "admin"), "admin");
  for (const key of project.leaves) {
    leaves.add(key);
  }
  for (const key of project.branches) {
    branches.add(key);
  }
  return { leaves, branches };
};

describe("字典沒有死鍵", () => {
  const { leaves, branches } = allKeys();

  it("每個鍵都在 admin / front 的程式碼裡被引用(或列在 DYNAMIC_KEYS)", () => {
    const referenced = referencedKeys(SOURCE_ROOTS, leaves, branches);

    const dead = [...leaves].filter(
      (key) => !referenced.has(key) && !isCoveredByDynamicKeys(key),
    );

    expect(dead).toEqual([]);
  });

  it("DYNAMIC_KEYS 的每一條都還對得上字典(鍵刪光了白名單要跟著刪)", () => {
    const stale = DYNAMIC_KEYS.filter((entry) =>
      entry.key.endsWith(".")
        ? ![...leaves].some((key) => key.startsWith(entry.key))
        : !leaves.has(entry.key),
    ).map((entry) => entry.key);

    expect(stale).toEqual([]);
  });
});
