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
      "`t(`slots.${spec.key}`)`,key 是列表欄位配置的摘要槽(title / date / amount)",
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
