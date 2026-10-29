import type { DynamicKey } from "../usage-scan";

/**
 * 專案字典(`messages/<locale>/project/admin.json`)與專案程式的動態 key 白名單:死鍵測試
 * `dead-keys.test.ts` 與底座的白名單合在一起檢查(寫法、理由格式、「每條都要對得上字典」同一套)。
 * 底座的條目留在 `dead-keys.test.ts`,這份只放專案的;底座升級不覆寫這個檔:
 *
 * ```ts
 * {
 *   key: "admin.<專案區塊>.statuses.",
 *   reason: "列表狀態欄的 `t(`statuses.${status}`)`,status 是 api 回的值",
 * }
 * ```
 */
export const PROJECT_DYNAMIC_KEYS: readonly DynamicKey[] = [
  {
    key: "admin.schedule.roster.applyTemplates.presets.",
    reason:
      "套用範本的日子快選 `t(`presets.${preset}`)`,preset 取自 `ApplyTemplatesDialog` 的 `PRESETS`(`DatePreset`,`lib/project/schedule-auto-run.ts`)",
  },
  {
    key: "admin.schedule.roster.autoRun.modes.",
    reason:
      "自動排班的方式 `t(`modes.${item}`)`,item 取自 `AutoRunDialog` 的 `MODES`(= `SCHEDULE_AUTO_RUN_MODES`)",
  },
  {
    key: "admin.schedule.roster.autoRun.errors.",
    reason:
      "自動排班 / 清除被擋 `t(`errors.${reason}`)`,reason 由 `auto-run-status.ts` 的 `autoRunBlockedReasonOf` 從 api `extensions.reason` 換算",
  },
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
    key: "admin.lotteryStore.badgeDescription",
    reason:
      "店面管理側欄計數(日結逾期的店數)的「數什麼」:由 api 側欄計數登記的 `descriptionKey` 給(`daily-close/store-badge.ts`)",
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
    key: "admin.lotteryAccounts.periodClose.statuses.",
    reason:
      "關帳月份的狀態 `PERIOD_STATUSES`(`periodClose.statuses.${status}`;`PeriodCloseTab`)",
  },
  {
    key: "admin.lotteryAccounts.periodClose.documentKinds.",
    reason:
      "擋下關帳的單據種類 `PERIOD_PENDING_KINDS`(api 的 `kind`;`PeriodCloseDialog`)",
  },
  {
    key: "admin.lotteryAccounts.settlement.buttons.",
    reason:
      "收付按鈕 `settlement.buttons.${role}.${button}`(`components/project/lottery/SettlementPanel/settlement-text.ts`)",
  },
  {
    key: "admin.notifications.recipientNotes.",
    reason:
      "`lib/base/notification-type-name.ts` 的 `t(`recipientNotes.${type}`)`,type 是 api 回的通知類型 key(沒有文案退回 api 的 `recipientNote`)",
  },
  {
    key: "admin.notifications.scheduleDateLabels.",
    reason:
      "通知設定頁提醒時間摘要 `tNotifications(`scheduleDateLabels.${type}`)`(`NotificationSettingsPage/notification-schedule.ts`),type 是 api 回的通知類型 key(沒有文案退回 api 的 `scheduleDateLabel`)",
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
    key: "admin.lotteryReports.reports.",
    reason:
      "專案登記的報表名稱:`registerReport({ name })` 的訊息 key(`app/project/reports.ts` 的登記清單),底座輸出報表頁以 `t(report.name)` 取用",
  },
  {
    key: "admin.lotteryReports.extra.",
    reason:
      "專案報表的其他條件名稱:`registerReport({ conditions: { extra: [{ label }] } })` 的訊息 key(`pages/project/lottery/reports/report-registrations.ts`),底座輸出報表頁以 `t(condition.label)` 取用",
  },
  {
    key: "admin.lotteryPurchasing.states.",
    reason:
      "專案 `pages/project/lottery/purchasing/RequisitionsTab/RequisitionStatusTag.tsx` 的 `t(state)`,state 取自 api `lotteryRequisitionStates`(`@repo/domain/project/lottery` 的 `REQUISITION_STATES`)",
  },
  {
    key: "admin.lifecycle.",
    reason:
      "專案掛接點擋下的錯誤碼(叫貨單、進貨單、調貨單、收付):底座 `lib/base/errors.ts` 的 `adminErrorText` 以 `admin.lifecycle.<reason>` 取用(api `requisition-error.ts` 的 `REQUISITION_REASONS`、`purchase-error.ts` 的 `PURCHASE_REASONS`、`transfer-error.ts` 的 `TRANSFER_REASONS`、`accounts-error.ts` 的 `SETTLEMENT_NOT_CLEARED`)",
  },
  {
    key: "admin.lotteryPurchasing.purchase.badgeDescription",
    reason:
      "進貨單側欄計數的「數什麼」:由 api 側欄計數登記的 `descriptionKey` 給(`purchase-registrations.ts`)",
  },
  {
    key: "admin.lotteryPurchasing.purchase.list.kinds.",
    reason:
      "進貨單列表的結算欄 `t(`kinds.${kind}`)`,kind 取自 api `lotteryPurchaseProgress.settlementKind`(`to_pay` / `to_refund`)",
  },
  {
    key: "admin.lotteryPurchasing.purchase.create.scanErrors.",
    reason:
      "進貨單新增頁刷條碼的 `t(`scanErrors.${kind}`)`,kind 取自 `PurchaseCreatePage/purchase-form.ts` 的 `addScannedBook` 結果",
  },
  {
    key: "admin.lotteryPurchasing.transfer.badgeDescription",
    reason:
      "調貨單側欄計數的「數什麼」:由 api 側欄計數登記的 `descriptionKey` 給(`transfer-registrations.ts`)",
  },
  {
    key: "admin.lotteryPurchasing.transfer.list.kinds.",
    reason:
      "調貨單列表的結算欄 `t(`kinds.${kind}`)`,kind 取自 api `lotteryTransferProgress.settlementKind`(`to_pay` / `to_refund` / `to_receive`)",
  },
  {
    key: "admin.lotteryPurchasing.transfer.create.addErrors.",
    reason:
      "調貨單新增頁加入明細的 `t(`addErrors.${kind}`)`,kind 取自 `TransferCreatePage/transfer-form.ts` 的 `AddLineResult`",
  },
  {
    key: "admin.lotteryPurchasing.transfer.view.problems.",
    reason:
      "調貨單檢視頁核准前的提示 `t(`problems.${kind}`)`,kind 取自 `@repo/domain/project/lottery` 的 `transferSettlementProblemOf`",
  },
  {
    key: "admin.lotteryPurchasing.receive.columns.",
    reason:
      "點收區塊的欄名 `t(`columns.${column}`)`(`ReceiveBooksPanel` 的 `ReceiveBookColumn`;使用處可用 `columnLabels` 覆寫)",
  },
  {
    key: "admin.lotteryPurchasing.receive.errors.",
    reason:
      "點收的 `t(`errors.${reason}`)`,reason 由 `PurchaseViewPage/receive-error.ts`(`RECEIVE_REASONS`)、`TransferViewPage/transfer-receive-error.ts`(`TRANSFER_RECEIVE_REASONS`)從 api 的 `extensions.reason` 換算",
  },
  ...(
    [
      "purchaseReceiving",
      "transferShipment",
      "transferReceiving",
      "transferPayment",
    ] as const
  ).map((kind) => ({
    key: `admin.lotteryPurchasing.receipts.${kind}.copies.`,
    reason:
      "兩聯單據的聯別名稱 `t(`${copyI18n}.copies.${copy}`)`,copy 取自 `lib/project/lottery/receipts/receipt-kinds.ts` 各單據宣告的 `copies`",
  })),
  {
    key: "admin.lotteryStore.errors.",
    reason:
      "店面管理的 `t(`errors.${code}`)`,code 由 `lib/project/lottery/store-error.ts`(`storeErrorKey`)從 api 錯誤碼與 reason 換算",
  },
  {
    key: "admin.lotteryStore.redemption.errors.",
    reason:
      "兌獎的 `t(`errors.${code}`)`,code 由 `lib/project/lottery/redemption-error.ts`(`redemptionErrorOf`)從 api 錯誤碼與 reason 換算",
  },
  {
    key: "admin.lotteryStore.redemption.status.",
    reason:
      "兌獎紀錄的 `t(`status.${status}`)`,status 是兌獎狀態 `REDEMPTION_STATUSES`(api 回的值)",
  },
  {
    key: "admin.lotteryInventory.errors.",
    reason:
      "庫存管理的 `t(`errors.${code}`)`,code 由 `lib/project/lottery/inventory-error.ts` 從 api 錯誤碼與 reason 換算",
  },
  {
    key: "admin.lotteryInventory.ticketStatuses.",
    reason:
      "`t(`ticketStatuses.${status}`)`,status 是張的狀態 `TICKET_STATUSES`(api 回的值)",
  },
  {
    key: "admin.lotteryInventory.bookStates.",
    reason:
      "`t(`bookStates.${state}`)`,state 是本的狀態(api 回的 `state`)與篩選值 `INVENTORY_BOOK_FILTER_STATES`",
  },
  {
    key: "admin.lotteryInventory.locations.",
    reason:
      "`t(`locations.${kind}`)`,kind 是張的位置 `TICKET_LOCATION_KINDS`(api 回的值)",
  },
  {
    key: "admin.lotteryInventory.eventTypes.",
    reason:
      "事件時間軸的 `t(`eventTypes.${type}`)`,type 是張數事件類型 `TICKET_EVENT_TYPES`",
  },
  {
    key: "admin.lotteryInventory.sources.",
    reason:
      "本的詳情「來源」的 `t(`sources.${type}`)`,type 是來源事件類型(進貨 / 調入)",
  },
  {
    key: "admin.lotteryStore.stocktake.types.",
    reason:
      "盤點的 `t(`types.${type}`)`,type 是盤點類型 `STOCKTAKE_TYPES`(api 回的值、盤點紀錄的篩選)",
  },
  {
    key: "admin.lotteryStore.stocktake.statuses.",
    reason:
      "盤點紀錄的 `t(`statuses.${status}`)`,status 是盤點單狀態 `STOCKTAKE_STATUSES`(api 回的值、篩選)",
  },
  {
    key: "admin.lotteryStore.stocktake.review.actions.",
    reason:
      "差異核對的 `t(`actions.${action}`)`,action 是差異的處理 `STOCKTAKE_DIFF_ACTIONS`",
  },
  {
    key: "admin.lotteryStore.stocktake.lost.actions.",
    reason:
      "待查清單的 `t(`actions.${action}`)`,action 是待查清單的處理 `STOCKTAKE_LOST_ACTIONS`",
  },
  {
    key: "admin.lotteryStore.stocktake.view.actions.",
    reason:
      "盤點確認申請檢視頁的 `t(`actions.${action}`)`,action 是差異的處理(api 回的盤點單明細)",
  },
  {
    key: "admin.lotteryStore.stocktake.view.methods.",
    reason:
      "盤點確認申請檢視頁的 `t(`methods.${method}`)`,method 是盤點方式 `STOCKTAKE_METHODS`",
  },
  {
    key: "admin.lotteryStore.stocktake.view.lostActions.",
    reason:
      "盤點確認申請檢視頁的 `t(`lostActions.${action}`)`,action 是待查清單的處理(api 回的值)",
  },
  {
    key: "admin.lotteryStore.checkout.steps.",
    reason:
      "交班精靈 Stepper 的 `t(`steps.${step}`)`,step 是 `CHECKOUT_STEPS`(`checkout-keys.ts`)",
  },
  {
    key: "admin.lotteryStore.checkout.items.",
    reason:
      "應有現金逐項的 `t(`items.${item.kind}`)`,kind 是 `EXPECTED_CASH_ITEM_KINDS`(api 回的值)",
  },
  {
    key: "admin.lotteryStore.checkout.forms.",
    reason:
      "審核中的單據 `t(`forms.${impact.formKey}`)`,formKey 是撤銷售出申請 / 現金更正單的表單代號(api 回的值)",
  },
  {
    key: "admin.lotteryStore.checkout.types.",
    reason:
      "結帳類型 `t(`types.${type}`)`,type 是 `CHECKOUT_TYPES`(api 回的值、班次結帳歷史紀錄的篩選)",
  },
  {
    key: "admin.lotteryStore.dailyClose.steps.",
    reason:
      "日結精靈 Stepper 的 `t(`steps.${step}`)`,step 是 `DAILY_CLOSE_STEPS`(`@repo/domain/project/lottery`)",
  },
  {
    key: "admin.lotteryStore.dailyClose.shifts.states.",
    reason:
      "日結第 ① 步各班結帳的 `t(`states.${row.state}`)`,state 是 api 回的值(approved / pending / returned)",
  },
  {
    key: "admin.lotteryStore.dailyClose.vault.items.",
    reason:
      "小金庫應有逐項的 `t(`dailyClose.vault.items.${item.kind}`)`,kind 是 `VAULT_CASH_ITEM_KINDS`(api 回的值)",
  },
  {
    key: "admin.lotteryStore.checkout.list.statuses.",
    reason:
      "班次結帳歷史紀錄的 `t(`list.statuses.${status}`)`,status 是申請的狀態(api 回的值、篩選)",
  },
];
