# 班表管理(技術)

排班與出勤(專案規格第 14 章)的內部技術文件:群組 `schedule` 與四個子模組 `schedule.my`、`schedule.manage`、`schedule.settings`、`schedule.attendance`。租戶使用者看的說明在 `apps/admin/src/md/module-help/project/additions/schedule.<子模組>.help.md`。

## 用途

- **獨立的專案模組**:不引用刮刮樂的任何資料表或程式(依賴方向:刮刮樂 → 排班,`apps/api/src/project/project-lint.test.ts` 守)。刮刮樂要在排班畫面上顯示東西、或擋排班的刪除,經下方「給刮刮樂的登記接縫」登記。
- 本文件目前寫到:模組宣告與權限、排班設定(排班人員、人力需求範本、人力需求週範本、規則)、行事曆、畫休(我的畫休、畫休總覽、代改、畫休規則、開放 / 截止通知)、支援需求單、排班表(人力需求、排班、填進執行任務、兩種對話框、班表檢視)、檢核與發布(排班類規則、檢核面板、發布、發布後異動與通知)。排班表的其他檢視、自動排班、打卡、出勤紀錄、補打卡申請由各自的功能追加小節。

## 模組 key 與畫面

| key                   | 名稱     | 型別                           | 頁面                                                                                                       |
| --------------------- | -------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `schedule`            | 班表管理 | group                          | —                                                                                                          |
| `schedule.my`         | 我的班表 | link(固定頁)                   | 頁內分頁:班表(最上方打卡)、我的畫休(分頁由對應功能追加)                                                    |
| `schedule.manage`     | 排班作業 | link(表單模組,綁定 支援需求單) | 列表頁換成頁內分頁:排班表、畫休總覽、行事曆、支援需求單(依權限顯示);詳情 / 新增 / 編輯三個隱藏頁用表單引擎 |
| `schedule.settings`   | 排班設定 | link(固定頁)                   | 頁內分頁:排班人員、人力需求範本、人力需求週範本、規則                                                      |
| `schedule.attendance` | 出勤紀錄 | link(表單模組,綁定 補打卡申請) | 列表頁換成頁內分頁:依人員(月)、依分店(日);詳情 / 新增 / 編輯用表單引擎                                     |

- seed:`apps/db-migrator/seeds/project/schedule.ts`(群組 + 四個子模組一次宣告,權限照規格 3.2 全部宣告)。兩個表單模組用 `formModuleDeclaration`;頁內權限的動作段以 `edit-` 開頭的(`edit-day-offs`、`edit-calendar`)骨架不收(避免與表單欄位級動態權限混淆),在骨架外另外加上,落庫為 seed 權限。
- 頁內分頁的登記檔:`apps/admin/src/pages/project/schedule/<模組>/<模組>-tabs.ts`(`ScheduleTabEntry`:`value`、`labelKey`、選填 `permission`、`Content`),每個功能只追加自己那一列;頁殼 `components/project/schedule/ScheduleTabsPage`(底座 `PageTabs`:與網址 `?tab=` 同步、依權限隱藏、只剩一個分頁時不顯示分頁籤;沒有任何分頁時顯示一句說明)。

## 權限表

| 模組                  | 權限                                                                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schedule.my`         | `view`、`punch` 打卡、`edit-day-offs` 畫休                                                                                                                                                                                                                       |
| `schedule.manage`     | 表單四條 `view` / `create` / `edit` / `delete`(支援需求單;`view`、`edit` 同時是排班表的檢視與修改)、`auto-run` 自動排班、`publish` 發布、`view-day-offs` 畫休總覽、`edit-day-offs` 代改畫休、`edit-calendar` 編輯行事曆、`use-punch-time` 上下班時間改用打卡時間 |
| `schedule.settings`   | `view`、`edit-templates`(人力需求範本與週範本)、`edit-staff`(排班人員)、`edit-default-rules`(最上層組織的規則)、`edit-org-rules`(其他組織的規則)                                                                                                                 |
| `schedule.attendance` | 表單四條(補打卡申請)、`view-all` 看全部、`export` 匯出、`reassign-punches` 改對應排班                                                                                                                                                                            |

### 開通時建立的角色

配方在 `apps/db-migrator/seeds/project/onboarding/role-grants/schedule.ts`(規格 3.3;開通清單正本 [lottery-onboarding.md](lottery-onboarding.md)「角色配方」):

| 角色     | 班表管理                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 總部管理 | 各模組 `*`(含 `use-punch-time`)                                                                                                                                                            |
| 店長     | 我的班表 `*`;排班作業(不含 `use-punch-time`);排班設定 `view`、`edit-templates`、`edit-staff`、`edit-org-rules`;出勤紀錄 `view`、`create`、`edit`、`view-all`、`export`、`reassign-punches` |
| 店員     | 我的班表 `*`;出勤紀錄 `view`、`create`(只看自己的、申請補打卡)                                                                                                                             |

### 表單

| 表單       | formKey           | 綁定模組              | 開通時建立的流程                                                   |
| ---------- | ----------------- | --------------------- | ------------------------------------------------------------------ |
| 補打卡申請 | `makeup_punch`    | `schedule.attendance` | 一關:店長限定「分店」                                              |
| 支援需求單 | `support_request` | `schedule.manage`     | 一關:人員條件「角色 總部管理 且 所屬組織屬於租戶(最上層組織本身)」 |

表單代號一律用底線(底座 `FORM_KEY_PATTERN` 不收 `-`;規格 2.1 寫的 `support-request` / `makeup-punch` 指的就是這兩個)。

## 資料

唯一索引一律是 partial(`partialFilterExpression: { deletedAt: { $type: "null" } }`,軟刪除的不算);同時寫入撞到唯一索引時回與事前檢查同一個 `VALIDATION_FAILED`。

十四張租戶表,schema 在 `apps/api/src/project/database/schedule/`(逐欄註解),登記 `registration.ts`(`SCHEDULE_SETTINGS_REGISTRATION`,排班設定與畫休八張)與 `roster-registration.ts`(`SCHEDULE_ROSTER_REGISTRATION`,排班表六張:人力需求、月份狀態、排班、填進執行任務、發布後的異動屬於分店、不共用,排班寫入的「人」守門文件歸租戶頂層;一個人在其他分店的排班以 `tenantBoundaryContext` 讀,見「排班表」)。都掛 `baseFieldsPlugin` 與 `tenantScopePlugin({ moduleData: true })`(`tenantId` 由建立時推導);沒有宣告資料範圍目標(只受可見範圍保底)。範本、週範本、規則設定、行事曆宣告「上層沿用到下層」(ADR-0014);排班檔案宣告「可共用 + 依可以排的分店」;畫休、守門文件、關聯以人為準,以租戶為邊界讀寫(底座 `tenantBoundaryContext`)。

| collection                       | 一筆是                                     | 歸屬 `orgId`                                                    | 唯一 / 說明                                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schedule_staff`                 | 排班檔案(使用者子檔)                       | 建立它的組織(當前組織)                                          | 一人一份:唯一 `(tenantId, userId)`;資料共用「可共用 + sharedByFields = 可以排的分店(`orgIds`,`org_schedule_staff` 的副本,同交易寫入)」:排得到這個人的店看得到他的檔案,但只有歸屬組織在可見範圍內的才改得到                     |
| `schedule_relationships`         | `org_schedule_staff`:排班人員可以排某分店  | `firstId`(分店)                                                 | `meta = { canLead, isPrimary, sortOrder }`;唯一 `(type, firstId, secondId)`(只算未刪除的);拿掉一家店 = 軟刪除                                                                                                                  |
| `schedule_settings`              | 某組織對某條規則的自訂                     | 自訂它的組織                                                    | 唯一 `(orgId, key)`(只算未刪除的);[還原] = 軟刪除                                                                                                                                                                              |
| `schedule_demand_templates`      | 人力需求範本                               | 建立它的組織                                                    | 執行任務 `tasks[] = { taskId, role, taskKey }`                                                                                                                                                                                 |
| `schedule_demand_week_templates` | 人力需求週範本                             | 建立它的組織                                                    | `days` 7 格(0 = 星期日),每格是範本 id                                                                                                                                                                                          |
| `schedule_calendar_days`         | 某組織某天的店休 / 特殊日                  | 設定它的組織                                                    | 唯一 `(orgId, date)`(只算未刪除的)                                                                                                                                                                                             |
| `schedule_day_offs`              | 畫休(讀取以人為準)                         | 登記時的組織:本人 = 當前組織、代改 = 畫休總覽選的那家店(不共用) | `kind` 整天畫休 `full-day` / 時段不可排 `time-range`(`startTime` / `endTime`);同一人同一天未刪除的整天畫休唯一 `(tenantId, userId, date)`(partial);代改記 `by`、`reason`、`reasonNote`;刪除 = 軟刪除                           |
| `schedule_day_off_locks`         | 畫休寫入的守門文件(一家店一個月一筆)       | 租戶頂層(鎖的店記在 `storeId`,不擋刪除分店)                     | 唯一 `(orgId, storeId, month)`;只用 `version` 製造寫入衝突                                                                                                                                                                     |
| `schedule_demands`               | 人力需求(某店某崗位某時間的一組執行任務)   | 分店                                                            | `tasks[] = { taskId, role, taskKey }`(`taskId` 在這筆內唯一);`date` = 開始時點的租戶當地日期;`templateId` null = 未套用範本;`source` 範本 / 週範本 / 手動 / 自動排班補上                                                       |
| `schedule_periods`               | 某家店某個月的排班狀態                     | 分店                                                            | 唯一 `(orgId, month)`;`status` 未發布 / 已發布;`version` 只用來製造寫入衝突(同一家店同一個月的人力需求 / 排班寫入互相重跑);這個月第一次寫入時建立(交易外先建好)                                                                |
| `schedule_entries`               | 排班(人、上下班時間、休息)                 | 分店                                                            | 索引 `(userId, startAt)`;`date` = 上班時點的租戶當地日期(跨午夜算開始那天)                                                                                                                                                     |
| `schedule_task_assignments`      | 排班填進執行任務                           | 分店                                                            | 唯一 `(demandId, taskId)`(一筆執行任務只填一人)、`(entryId, demandId)`(同一筆人力需求只能填一筆);`source` 手動 / 自動(`autoRunId`、`reason` 只留著追查);解除 = 軟刪除                                                          |
| `schedule_entry_locks`           | 排班寫入的「人」守門文件(一個租戶一人一筆) | 租戶頂層(人記在 `userId`,不擋刪除分店)                          | 唯一 `(orgId, userId)`;只用 `version` 製造寫入衝突                                                                                                                                                                             |
| `schedule_changes`               | 發布後的一筆排班 / 人力需求異動            | 分店                                                            | 只新增;`action` `entry.*` / `demand.*`(`create` / `edit` / `delete`)、`userIds` 異動牽涉的人、`before` / `after`、`reasonKey`(排班異動原因)/ `reasonNote`;索引 `(orgId, date)`、`(userIds, createdAt)`(我的班表的「最近異動」) |

## 規則

### 組織鏈與「看得到上層」

範本、週範本、規則、行事曆都「沿組織樹往上找」:組織鏈 = 自己 → 上層 → … → 最上層組織(不含根組織)。這幾張表宣告「上層沿用到下層」:分店的人直接看得到所屬組織上層鏈建的,查詢以操作者的上下文、配**明列的組織鏈**條件;組織名稱以 `scheduleOrgReader`(可見範圍 ∪ 上層鏈)讀(`apps/api/src/project/schedule/shared/schedule-org.ts`)。根組織沒有排班(對根組織查 → `VALIDATION_FAILED`,欄位 `orgId`)。

### 排班人員(規格 14.3)

- **一人一份(規格 14.1:使用者子檔,一對一)**:同一租戶裡一個使用者只有一份排班檔案(唯一 `(tenantId, userId)`)。[加入排班] 建立時 `orgId` = 當前組織。讀取:可見範圍,加上可以排的分店有我的店(跨店支援也看得到,`staff.isShared = true`、標「其他店的排班人員(只能看)」);修改只限歸屬組織在可見範圍內的(別店建的 → `FORBIDDEN`,`reason: NOT_OWNER`);跨店支援由支援需求單把人加進那家店。
- **候選使用者** = 所屬組織落在操作者可見範圍內(且在當前組織的租戶裡)的使用者;[加入排班] 只能加這些人、而且整個租戶裡還沒有他的檔案(已加入 → `VALIDATION_FAILED`,欄位 `userIds`,同時加入也一樣;看不到 → `NOT_FOUND`)。檔案完全看不到的人(別店建的、可以排的分店也沒有我的店),候選清單標「已在其他組織加入」(`joinedElsewhere`)、勾選框停用;篩選時算「已加入」(`joined: true` 列出、`joined: false` 不列)。
- 可以排的分店只能加操作者看得到的(看不到 → `NOT_FOUND`)。存檔時 `orgs` 整份取代「操作者看得到的那幾家」;看不到的分店的關聯保留不動。
- **主要分店每人一家**:有任何可以排的分店時恰好一家(含看不到的分店的關聯一起算),否則 `VALIDATION_FAILED`(欄位 `orgs`)。主要分店在看不到的分店時列表回 `primaryElsewhere = true`。
- **候選人**(手動與自動排班同一份名單):`ScheduleStaffService.listScheduleCandidates(operator, orgId, at?)` —— 有排班檔案、啟用、帳號啟用、可以排的分店包含這家店的人;`at`(預設現在)只決定哪些關聯算數(那之前加入、那之後才拿掉的都算);回傳的 `canLead` / `isPrimary` / `sortOrder` 與排班檔案、帳號的啟用都是**現在的值**。這家店要在操作者的可見範圍內(排程以租戶系統身分呼叫 = 整個租戶),否則回空清單;候選人以租戶為邊界讀。

### 人力需求範本 / 週範本(規格 14.4)

- 可見 = 當前組織這一層 + 所有上層建立的;只有建立它的那一層能改 / 刪(看得到但不是這一層 → `FORBIDDEN`,`reason: NOT_OWNER`)。新增的屬於當前組織。
- 範本:名稱、簡稱 1–2 字、開始 / 結束 `HH:mm`(到分鐘,結束比開始早 = 跨午夜,不能相同)、崗位(「崗位」啟用中的選項,否則欄位 `positionKey`)、執行任務(負責人 0–1、協同 0–10;超過、或任務內容不是「執行任務」啟用中的選項 → `VALIDATION_FAILED`,欄位 `tasks`)、顏色(標籤色票代號或 null)。沒有休息、沒有適用星期。
- 週範本:7 格,每格只能選這一層看得到的範本(不認得的 id → `VALIDATION_FAILED`,欄位 `days`);已刪除的範本讀取時不列。
- 新增一筆負責人 / 協同時,畫面帶入規則「負責人 / 協同預設任務」的生效值。

### 規則(規格 14.2)

- 定義(順序、值的形狀、範圍、預設值)在 `@repo/domain/project/schedule-settings` 的 `SCHEDULE_RULE_DEFINITIONS`(前後端共用);規則頁依它的順序一條一列,自動排班條件另成一組在最下面。

| key                          | 規則                  | 值(`value`)                                                              | 預設                             |
| ---------------------------- | --------------------- | ------------------------------------------------------------------------ | -------------------------------- |
| `maxMonthlyDayOffs`          | 每月最多畫休          | `{ amount }` 天(0–31)                                                    | 8,限制                           |
| `minMonthlyDayOffs`          | 每月最少畫休          | `{ amount }` 天(0–31)                                                    | 4,限制                           |
| `maxConsecutiveWorkDays`     | 最多連續上班          | `{ amount }` 天(1–31)                                                    | 6,提醒                           |
| `maxConsecutiveDaysOff`      | 最多連續休假          | `{ amount }` 天(1–31)                                                    | 3,提醒                           |
| `minRestBetweenShifts`       | 兩班之間最少休息      | `{ amount }` 小時(0–24)                                                  | 11,提醒                          |
| `maxDailyWorkHours`          | 每天最多上班時數      | `{ amount }` 小時(0.5–24,可到 0.5)                                       | 8,提醒                           |
| `dayOffWindow`               | 畫休開放期間          | `{ startDay, endDay }`(每月 1–31 日,開始不晚於結束)                      | 15–25                            |
| `maxDailyDayOffStaff`        | 同日最多畫休人數      | `{ amount }` 人(0–99)                                                    | 2,限制                           |
| `understaffed`               | 人力不足              | `{}`(開關 + 等級)                                                        | 開,提醒                          |
| `multiPositionOverlap`       | 同一時段兼多個崗位    | `{}`(開關 + 等級)                                                        | 關,提醒                          |
| `entryMatchToleranceMinutes` | 對應排班容許時間      | `{ amount }` 分鐘(0–720)                                                 | 60                               |
| `autoDemandWeekTemplateId`   | 預設人力需求週範本    | `{ weekTemplateId }`(這家店看得到、啟用中的週範本 id 或 null)            | null                             |
| `graceMinutes`               | 遲到 / 早退寬限       | `{ lateGraceMinutes, earlyLeaveGraceMinutes }`(0–120 分鐘)               | 5 / 5                            |
| `defaultBreaks`              | 預設休息              | `{ tiers: [{ minMinutes, breakMinutes }] }`(1–10 級,`minMinutes` 不重複) | 滿 4 小時 30 分、滿 8 小時 60 分 |
| `defaultTasks`               | 負責人 / 協同預設任務 | `{ defaultLeaderTaskKey, defaultHelperTaskKey }`(執行任務選項 value)     | 店內事務與帳目負責 / 店內事務    |

自動排班條件(整組):`continuePreviousEntry` 延續同一人的排班(勾)、`leaderCountFirst` 負責人次數多者優先(勾)、`monthlyShiftBalance` 本月班數平均(不勾)、`allowOverlappingDemands` 允許同一人同時段填進多筆人力需求(不勾);勾選 = `enabled`、順序 = `order`。

- **生效值**(`apps/api/src/project/schedule/rules/rule-resolution.ts`):每條規則沿組織鏈找第一個有自訂的組織,找不到用程式預設;一列自訂的開關、值、等級、排序一起覆寫。**自動排班條件整組繼承**:鏈上第一個有任何一條自動排班條件自訂的組織,整組以它為準(它沒寫到的條件用程式預設)。
- **只有「人力不足」「同一時段兼多個崗位」可以關掉**(`isScheduleRuleToggleable`;自動排班條件的開關就是勾選);其他規則送 `enabled = false` → `VALIDATION_FAILED`(欄位 `enabled`)。
- **寫入**:[自訂] 寫本層一列(沒送的欄位照抄目前的生效值);自動排班條件自訂其中一條 = 整組寫成本層自訂。[還原] = 刪掉本層那一條(自動排班條件:整組)。最上層組織要 `edit-default-rules`、其他組織要 `edit-org-rules`(沒有 → `FORBIDDEN`,`reason: MISSING_PERMISSION`);沒有等級的規則送 `level` → `VALIDATION_FAILED`。
- **值只留定義裡的欄位**:存檔前丟掉多送的 key(預設休息每一級只留 `minMinutes` / `breakMinutes`;`pickScheduleRuleValue`)。
- **下拉值要是啟用中的選項**:「負責人 / 協同預設任務」的兩個 key 要是欄位管理「執行任務」啟用中的選項(否則 `VALIDATION_FAILED`,欄位 `value.<key>`)。
- **來源顯示**:本層自訂 →「本店自訂」(最上層組織「本層自訂」),摘要寫「本店自訂:6 天」;沿用 →「沿用:<上層組織名稱>」,上層組織操作者看不到時 api 回 `sourceOrgName: null`、畫面寫「沿用上層設定」;都沒設 →「系統預設」。自訂的列下方灰字「上層:<值>」= 上層的生效值。
- **檢查函式**(違反哪些規則)不在這裡:`apps/api/src/project/schedule/rules/rule-registry.ts` 的 `registerRuleEvaluator(key, evaluator)` 由各功能登記(畫休類規則、排班類規則);手動排班、自動排班、檢核面板、發布都呼叫同一個檢查函式、吃 `ScheduleRulesService.effectiveSettingsForOrg(operator, orgId)` 的生效設定。

### 排班表(規格 14.4「手動新增」、14.5「排班表」)

- **人力需求**(`schedule_demands`):日期、時間(開始 / 結束時點;結束不晚於開始 = 跨午夜,最長 24 小時)、崗位(「崗位」啟用中的選項,否則欄位 `positionKey`)、執行任務(負責人 0–1、協同 0–10,任務內容是「執行任務」啟用中的選項,否則欄位 `tasks`)。`date` 由 api 依租戶時區算(開始時點那一天)。沒有休息。
  - 新增時可帶 `templateId`(班表人力需求區點某一列範本的空白格;要是這家店組織鏈上看得到的範本,否則欄位 `templateId`),那一筆就歸在那一列;沒帶 = 「臨」。
  - **同時存成人力需求範本**(只在新增):要 `schedule.settings.edit-templates`(沒有 → `FORBIDDEN`,`MISSING_PERMISSION`);同一個交易裡經 `ScheduleTemplatesService.saveTemplate` 建立一筆屬於當前組織的範本(時間、崗位、執行任務照這筆),人力需求的 `templateId` 指向它。
  - 修改:執行任務沿用既有的 `taskId`(職責不能改,改了 → 欄位 `tasks`)、沒有 `taskId` 的是新的一筆。**拿掉有人填的任務 = 解除那些人**;解除後一筆都沒填的排班一起刪除(回 `deletedEntryIds`);其中被收銀班次綁定的(`blockedEntryIdsOf`)→ 整筆擋下,`VALIDATION_FAILED` + `extensions.blockedEntryIds`。有人填的人力需求不能搬到別天(欄位 `startAt`)。
  - [刪除人力需求] = 解除全部執行任務(同上規則)後軟刪除。
- **排班**(`schedule_entries` + `schedule_task_assignments`):人員(新增時;要是這家店的候選人 `listScheduleCandidates`,否則欄位 `userId`;修改時不能改)、上下班時點(最長 24 小時)、休息分鐘數(整數、0 ≤ 休息 < 時長,否則欄位 `breakMinutes`)、填進的執行任務 `assignments[{ demandId, taskId }]`。
  - **至少一筆**(零筆 → 欄位 `assignments`);同一筆人力需求只能一筆(重複 → 欄位 `assignments`);人力需求要是這家店、同一天(`date` 相同)的,任務要存在;負責人任務只能填這家店可擔任負責人的人(原本就填著的不再檢查);別筆排班已經填的 → 欄位 `assignments`。兩個請求同時填同一筆任務由唯一索引擋下,回同一個錯誤。
  - **一個人同一時間只有一筆排班,跨店也不能重疊**(相接不算):以租戶為邊界讀這個人所有分店的排班(`roster/roster-people.ts`,`tenantBoundaryContext` 登記用途「以人為準的資料」),重疊 → 欄位 `startAt`。店休那天不能排,跨午夜的班連隔天一起看(欄位 `startAt`)。**畫休那段時間不能排**:以租戶 + 人查這個人的畫休(`ScheduleDayOffsService.unavailableOfPerson`,不經這家店的候選人 —— 修改舊排班時那個人已經不能排這家店也一樣擋),排班碰到的日子(跨午夜含隔天)有整天畫休、或和時段不可排重疊(頭尾相接不算)→ 欄位 `startAt`。
  - **先排班、後登記畫休**(使用者定案):畫休照樣可以登記 / 代改;那段時間已經有這個人的排班(整個租戶,跨店也算)時,`addMyScheduleDayOffs` / `addScheduleDayOffsOnBehalf` 的回應附 `entryConflicts`(日期、上下班時點、分店名稱;看不到的分店 `orgName = null`),畫面提醒「這天已經有排班(…),請通知店長調整班表」。「畫休日有排班」另列進檢核面板(檢核的功能做)。
  - 修改時填進紀錄改成送來的那份:拿掉的軟刪除、新的建立(來源手動);沒變的保留原來的來源(自動排入的被手動改過才變成手動)。
  - **刪除**:被收銀班次綁定 → `VALIDATION_FAILED` + `extensions.blockedEntryIds`;否則軟刪除排班與它的填進紀錄。
  - **移除這天所有排班**:被綁定的略過,回 `deletedIds` / `skippedIds`。已發布後才需要的異動原因由發布的功能加上。
- **同時送出**:同一家店同一個月的寫入在交易一開始對 `schedule_periods.version` `$inc`(文件在交易外先建好),互相衝突、由 `TransactionService` 重跑。新增 / 修改排班另先對這個人的守門文件 `schedule_entry_locks` `$inc`(一個租戶一人一筆;`shared/schedule-person-locks.ts`,以 `tenantBoundaryContext` 寫,用途「例外寫入」):同一個人在**兩家店**同時被排、時間重疊時兩個交易在這筆文件上衝突,重跑的那一方讀到對方的排班而被擋下。畫休的登記 / 代改 / 刪除也在交易一開始碰同一份「人」守門文件(`schedule-day-offs.service.ts` 的 `ensureLocks` / `touchLocks` 呼叫 `SchedulePersonLocks`),排班與畫休同時寫同一人互相衝突、不會互相繞過。不放在 `schedule_staff` 上,是因為那筆是使用者會看、會改的檔案,`$inc` 會連帶改它的 `updatedAt / updatedBy`。
- **讀取**(`scheduleRoster`):這家店要在可見範圍內(`resolveScheduleOrg`;看不到 → `NOT_FOUND`),之後才呼叫「空清單分不出看不到」的 `listScheduleCandidates` / `listUnavailable`。人 = 候選人 + 這個月在這家店有排班、已不是候選人的人(`isCandidate = false`,依姓名 zh-Hant 排在後面)。一併回:人力需求(每筆執行任務帶填的人)、排班(`deletable` = 沒被綁定)、這些人在其他分店的班(看不到那家店 `orgName = null`,畫面寫「已排於其他分店」)、畫休、行事曆、這家店看得到的範本、規則的生效值(預設休息、負責人 / 協同預設任務、每月最多 / 最少畫休)、崗位註記(`positionAnnotationsOf`)。
  - **週檢視跨月**:另給 `from` / `to`(`YYYY-MM-DD`,要一起給、`from` 不晚於 `to`、只能落在這個月前後 6 天內,否則欄位 `from` / `to`)時,人力需求、排班、別家店的班、畫休、行事曆改讀「這個月 ∪ from–to」(`rosterReadRange`);人員統計與發布狀態仍只算這個月。人力需求帶 `createdAt`(時間軸平手排序)、填進紀錄帶 `reason`(自動填進的理由,長條滑過提示)。
- **統計欄**(`roster/roster-stats.ts`,這家店這個月):班數、負責班數(以排班為單位:任一筆填進的是負責就算 1 班)、總工時(每筆下班 − 上班 − 休息,分鐘)、畫休天數(同畫休規則 `dayOffDates`:那天有任何畫休就算 1 天;另回整天畫休天數與只有時段不可排的日子與時段)、最長連續上班(有排班的日子,含其他分店)。
- **[⚙ 顯示欄位]** 存個人偏好 `scheduleRosterColumns`(統計欄 key 逗號分隔,`apps/api/src/project/user-preferences.ts` 登記;定義在 `@repo/domain/project/schedule-settings` 的 `roster.ts`)。
- 前後端共用的純函式(`@repo/domain/project/schedule-settings` 的 `roster.ts`):預設休息(`defaultBreakMinutes`:長度已達門檻的級距中最高的那一級)、選人力需求自動填第一個空的執行任務(`pickOpenTask`)、負責人時間涵蓋(`leaderCoverageGaps`)、總工時寫法(`formatWorkMinutes`)。

### 檢核與發布(規格 14.2 等級、14.5「檢核面板」「發布」、14.1 `schedule_changes`、3.4 排班發布 / 異動)

- **排班類規則的檢查函式**(`apps/api/src/project/schedule/check/roster-rules.ts`,純函式,登記在 `registerRuleEvaluator`;畫休類由 `day-offs/day-off-rules.ts` 登記):
  - `maxConsecutiveWorkDays` 最多連續上班(人):有排班(任何分店)的日子連續超過 N 天;前後各讀 31 天,跨月的連續也算。
  - `minRestBetweenShifts` 兩班之間最少休息(人):**相鄰兩個上班日**,前一天最後下班到後一天第一次上班不到 N 小時(剛好 N 小時通過);同一天的多段排班之間不算。
  - `maxDailyWorkHours` 每天最多上班時數(人):同一天(`date`,跨午夜算開始那天)所有排班(同店多段、跨店)的「下班 − 上班 − 休息」加總超過 N 小時(8 小時:8:00 通過、8:01 違反)。
  - `multiPositionOverlap` 同一時段兼多個崗位(人,預設關閉):同一筆排班填進的人力需求(各自截到排班時間)兩兩有重疊;時間相接不算。
  - `understaffed` 人力不足(店):依時間切段檢查空的執行任務 —— 沒人填 = 整段缺;有人填、但那筆排班只涵蓋一部分 = 沒涵蓋的那段缺;同一筆人力需求同一職責的缺額依時間切段、相鄰同數合併,一段一項。附那段時間**可排**的人數(可以排這家店、沒有畫休、沒被任何分店的排班占用;負責另要可擔任負責人)與不能排的原因人數(不能擔任負責人 → 整天畫休 → 時段不可排 → 已排其他班,每人只算第一個)。店休那天的人力需求不檢查。
- **彙總**(`check/schedule-check.service.ts` 的 `evaluateSchedule(operator, orgId, month)`):用**最新的生效設定**跑一家店一個月的全部規則,再加上不屬於規則的檢核類別:
  - 人的排班類規則用那個人**主要分店**的設定(主要分店不一定看得到:以 `tenantBoundaryContext` 讀,登記用途「以人為準的資料」);只列**牽涉到這家店排班**的違反。
  - 畫休類規則(P07 的檢查函式)列以這家店為主要分店的人;同日最多畫休人數用這家店的設定。
  - `dayOffEntryConflict` 畫休日有排班(先排班、後登記畫休;使用者 10/21 定案,等級提醒):可以排這家店的人,這個月的排班(**含其他分店**)碰到他的整天畫休或和時段不可排重疊;別家店的排班帶 `isOtherStore`,看不到那家店 `orgName = null`。
  - 排序:限制在前、提醒在後;同等級依規則排序(這家店生效設定的 `order`,不屬於規則的類別在最後)→ 日期 → 姓名(zh-Hant)。
  - 每項的 `date` 是 [查看] 要捲到的那一天(這個月內),有 `userId` 的捲到 `userId|date`、店的項目捲到 `|date`(找不到時頁殼退回那一天)。「未對應排班的打卡」由打卡的功能追加一類 `key`。
- **等級**:限制 → 不能存、不能發布;提醒 → 照存照發布。
  - **存排班**(`saveScheduleEntry`)在寫入的交易內跑這個人的排班類規則(他主要分店的設定,`limitViolationsOfEntry`):存檔後**限制**的違反比存檔前嚴重(每條規則超出規則值的總量變大)→ `VALIDATION_FAILED`(欄位 `rules`)+ `extensions.violations`(`key`、`level`、`message`、`actual`、`limit`、`from`、`to`;只列這次造成的)。人力需求的新增 / 修改 / 刪除、刪排班、移除這天所有排班不跑規則(它們不會讓人的規則變嚴重;人力不足要靠排人補,刪人力需求不擋)。
  - **改規則不改已排的班**:已存的排班照留,檢核與發布用新的設定重新標示。
- **發布**(`publishSchedule`,`schedule.manage.publish`;`check/schedule-publish.service.ts`):這個月還沒有狀態文件時先建(未發布);用發布當下的設定重查整月,有限制 → `VALIDATION_FAILED` + `reason: HAS_LIMIT_VIOLATIONS`(`limitCount`);以「狀態仍是未發布、版本沒變」為條件更新成已發布(`publishedAt`、`publishedBy`)並 `$inc version`(和同月的寫入互相衝突)。查完到寫入之間有人改了排班(版本變了)→ 重查,最多 3 次,仍不行 → `reason: CHANGED_DURING_PUBLISH`;已發布 → `reason: ALREADY_PUBLISHED`。**沒有取消發布的端點**。發布後通知這個月在這家店被排到的人(`schedule.published`,`dedupeKey` = `schedule.published:<分店>:<月份>`)。
- **發布後異動**(`changes/schedule-changes.service.ts`):寫入在交易一開始碰 `schedule_periods` 時讀到這幾個月有已發布的 → 輸入的 `changeReason { reasonKey, reasonNote }` 必填(欄位管理「排班異動原因」啟用中的選項;沒給 / 不是選項 → 欄位 `reasonKey`;選「其他」沒說明 → 欄位 `reasonNote`)。每筆異動寫一列 `schedule_changes` 並通知牽涉的人(`schedule.changed`,`dedupeKey` = `schedule.changed:<異動 id>`,內文帶原因的顯示名稱與說明):排班 = 那個人;人力需求 = 改之前填它的人(含因此解除 / 刪除排班的人);移除這天所有排班 = 每筆刪掉的排班各一列(原因只填一次)。未發布的月份不用原因、不記異動。

### 行事曆(規格 14.5)

- 某家店某天以**最接近的那一層**為準(`apps/api/src/project/schedule/calendar/calendar-resolution.ts`):上層設店休、本店沒設 → 本店那天店休;本店自設特殊日 → 以本店為準。同一層同一天只有一筆(重複 → `VALIDATION_FAILED`,欄位 `date`)。
- 特殊日:類別(欄位管理「特殊日類別」啟用中的選項,否則欄位 `category`)、名稱必填,顏色選填;店休:類別與顏色一律存 null。
- 寫入要 `schedule.manage.edit-calendar`,寫在選的那家店那一層;上層設的那一天本店改不了(`FORBIDDEN`,`NOT_OWNER`)。排班作業共用 `ScheduleCalendarService.effectiveDays(operator, orgId, from, to)`。

### 畫休(規格 14.1 `schedule_day_offs`、14.2、14.5「畫休總覽」、14.6「我的畫休」)

- **讀取以人為準**:那段時間這個人可以排的每一家店都不能排(查詢以 `tenantId` + `userId` 為準,不看歸屬組織)。**歸屬組織**(`orgId`,不共用):本人登記 = 當前組織;代改 = 畫休總覽選的那家店。整天畫休一天一筆(重複 → `VALIDATION_FAILED`,欄位 `kind`;同時送出由唯一索引擋下,回同一個錯誤);時段不可排一天可以多段,`HH:mm`、結束晚於開始、不跨午夜,和同一天既有的或同一次送的其他段重疊 → `VALIDATION_FAILED`(欄位 `slots`,相接不算重疊)。整天 + 時段可以同一天並存。
- **畫休的算法**(`apps/api/src/project/schedule/day-offs/day-off-rules.ts`):那一天只要有任何一種就算 1 天、1 人;「最多連續休假」只算整天畫休(跨月也連續)。
- **檢查函式**:畫休類四條規則(`maxMonthlyDayOffs`、`minMonthlyDayOffs`、`maxConsecutiveDaysOff`、`maxDailyDayOffStaff`)由 `ScheduleDayOffsService` 啟動時以 `registerRuleEvaluator` 登記;資料由呼叫端準備:人的規則給這個人前後各一個月的畫休,店的規則給**以這家店為主要分店的人**的畫休。違反附 `detail`(`actual`、`limit`、期間類的 `from` / `to`)給畫面組文案。
- **用哪家店的設定**:人的規則與開放期間都用這個人的**主要分店**的生效值;同日最多畫休人數檢查主要分店那一天。
- **同時送出**:登記 / 代改 / 刪除把「讀畫休 → 檢查重疊 → 跑規則 → 寫入」放在同一個交易,交易一開始對守門文件(主要分店 × 月份,`schedule_day_off_locks`)`$inc`(整天畫休另碰前後一個月:最多連續休假會跨月;碰不到文件 → 丟錯,不靜默失去保護);同一家店同一個月同時進來的寫入互相衝突、由 `TransactionService` 重跑,同日人數、每月上限、時段重疊不會被同時送出繞過(守門文件在交易外先建好)。
- **存檔規則**:存檔後限制等級的違反比存檔前多(新的、或超出更多)→ 不存,`VALIDATION_FAILED`(欄位 `date`,`extensions.violations` 列出擋下的違反);提醒照存,回在 `violations`。「每月最少畫休」不擋存檔(登記途中本來就不足,擋刪除會讓人改不掉登記錯的那天),照樣列在違規清單。
- **開放期間**(規則 `dayOffWindow`,`apps/api/src/project/schedule/day-offs/day-off-window.ts`):目標月的開放期間 = 前一個月的 N 日至 M 日(超過月底用月底);今天(租戶時區,`ScheduleClock`)在期間內 = 開放中。這條規則沒有等級,只看值、不看開關,登記檢查與通知用同一個判斷(`dayOffWindowValueOf`)。**本人**只能在開放中登記 / 刪除那個目標月的畫休,其他時候 → `FORBIDDEN`(`reason: OUTSIDE_DAY_OFF_WINDOW`)。
- **代改**(`edit-day-offs`):對象要是選的那家店(要看得到)的排班人員(否則 `NOT_FOUND`);不受開放期間限制;那個月的截止日(對象主要分店的開放期間)已過 → `reason` 必填(欄位管理「代改畫休原因」啟用中的選項),選「其他」`reasonNote` 必填(否則 `VALIDATION_FAILED`,欄位 `reason` / `reasonNote`);截止前原因選填。記代改人 `by`;代改刪除先寫入代改人與原因再軟刪除。代改一樣跑規則。
- **畫休總覽**:候選人(可以排這家店的排班人員)這個月的畫休;同日畫休人數只計 `isPrimary` 的人;「尚未畫休」= 主要分店是這家、這個月還沒畫任何一天的候選人。
- **給其他功能**:`ScheduleDayOffsService.listUnavailable(operator, orgId, from, to)` 回這家店的候選人每人每天的整天畫休 / 時段不可排(只列有畫休的日子;這家店要在操作者的可見範圍內,否則空清單)。**空清單分不出「沒有畫休」與「看不到這家店」**:呼叫端(排班表、自動排班)要先自己確認看得到這家店(例:`resolveScheduleOrg`,看不到 → `NOT_FOUND`),再呼叫它。

### 支援需求單(規格 8.9、14.10)

分店人力不足時請總部協助;總部在排班作業排好人後核准(支援指派單已取消:看得到兩家店的人直接在排班作業排人)。

- **表單**:受管表單 `support_request`(`apps/db-migrator/seeds/project/revisions/support_request.r1.seed.ts`,在 `seeds/project/registry.ts` 登記;部署時由受管定義 CLI 發布成共用表單,掛在 `schedule.manage`)。表單、提交、修訂、流程都用底座的表單引擎與流程引擎(`form_submissions`),沒有自己的資料表。
- **欄位**:日期(`date`,必填)、崗位(`position`,欄位管理「崗位」`schedule-position`,必填)、開始 / 結束(`start_time` / `end_time`,`HH:mm` 24 小時制,必填,結束要晚於開始;**不能跨午夜**,跨過午夜的需求拆成兩筆)、需要人數(`headcount`,1–99 的整數)、分店(`branch`,組織引用,預設目前組織,必填;Figma SC-14 有這一欄,讓總部看得出是哪家店)、說明(`note`,200 字內)。摘要:標題 = 說明、日期 = 日期;頁籤標題「支援需求單 <日期>」。
- **單號**:受管表單宣告 `serial: { prefix: "S", period: "none", digits: 4 }`,第一次送出時給號,例 `S-0001`(每個租戶各自計數、不分期間;存草稿不給號;機制見底座 `docs/modules/forms.md`「單號」、ADR-0015)。
- **沒有草稿**:表單「允許存草稿」關(seed 宣告 `allowDraft: false`),新增頁只有 [送出](`docs/modules/forms.md`「允許存草稿」)。
- **權限**:看列表與詳情 = `schedule.manage.view`(分頁也看它);新增 = `schedule.manage.create`;審核不看頁面權限(承辦人就能審,`docs/modules/workflows.md`)。
- **表單要先分派**:受管表單是共用表單,租戶要平台管理員在表單管理「分派租戶」後才看得到、才能新增(分派是各環境的資料,不在 seed)。示範指令 `demo create` 由平台管理員建完示範機構後自動分派 registry 登記的每張受管表單;真實租戶由平台管理員分派。
- **列表欄位**:讀 `schedule.manage` 的列表欄位配置(`modules.settings.list`,平台管理員在「模組與權限」調整)。初值在 `apps/db-migrator/seeds/project/settings.ts`(初始 seed 值:模組的 settings 已存在就不覆寫):單號(摘要槽 `serialNo`)、日期、開始、結束、崗位、需要人數、分店 + 內建欄「狀態」(這份初值整份取代 `schedule.ts` 宣告裡的 `settings`)。

#### 建議流程設定

流程不 seed(依租戶的角色 id 建客製流程;共用流程不能用角色條件),由開通腳本的「流程」一步建立(`apps/db-migrator/seeds/project/onboarding/form-workflows/support-request.ts`):

| 項目     | 設定                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------- |
| 流程     | 租戶客製流程「支援需求單審核」,key `<租戶短碼>_support_request`,綁定表單 `support_request`              |
| 第 1 關  | 「總部審核」:審核者 = 人員條件「角色 總部管理」**且**「所屬組織屬於 租戶(最上層組織)、本身」;任一人核准 |
| 跳過     | 無                                                                                                      |
| 自動通過 | 無                                                                                                      |
| 退回     | 可退回修改                                                                                              |

- 只算直接屬於最上層組織的總部管理(開通清單第 2 點:總部人員一律同時加入租戶本身);只屬於某家分店的總部管理角色不會被指派。
- 表單還沒分派給這個租戶時(真實租戶在平台管理員分派之前),開通腳本的「流程」一步略過並提示;表單已綁了流程(租戶自己換過)就沿用不改。
- 沒走開通腳本的租戶:租戶管理員在流程管理照上表建客製流程、發布,再到表單管理把「支援需求單」綁到它。

### 畫休開放 / 即將截止通知(規格 3.4、3.5、14.11)

- 排程 `schedule.day-off-reminders`(每 15 分鐘,`apps/api/src/project/schedule/day-offs/day-off-reminders.service.ts`):逐租戶、逐家有排班人員的分店,依那家店規則「畫休開放期間」的生效值算出開放日 / 截止日,「這個時點該不該寄」用底座 `scheduleHitAt`(租戶時區;漏跑 6 小時內補寄;改了時間不補)。
- 兩型都是當事人通知,收件人 = 可以排這家店的排班人員(`listScheduleCandidates`);同一人可以排兩家店 → 各一則。`dedupeKey` = `<類型>:<分店>:<目標月>:<時點>`。
- 可調時間宣告在 `apps/api/src/project/notifications.ts`:畫休開放 = 開放日前 0 天 09:00、畫休即將截止 = 截止日前 1 天 09:00(租戶可在通知設定頁改;收件人唯讀「由事件決定(可以排這家店的排班人員)」)。

## api 介面

GraphQL 文件 `packages/graphql/src/documents/project/schedule/schedule-settings.graphql`、`schedule-day-offs.graphql`、`schedule-roster.graphql`。`orgId` 缺席或 null = 當前組織(GQL-06)。

| 端點                                                                                                                                                                            | 守門                               | 說明                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scheduleFieldOptions(categoryKey)`                                                                                                                                             | 登入即可                           | 排班類別(`@repo/domain/project/schedule-fields`)的啟用選項合併清單;其他類別 → `VALIDATION_FAILED`                                                                                                                              |
| `scheduleStaff(input: { joined?, keyword? })`                                                                                                                                   | `schedule.settings.view`           | 候選使用者 + 排班檔案;`canEdit` = 有 `edit-staff`                                                                                                                                                                              |
| `addScheduleStaff(input: { userIds })`                                                                                                                                          | `schedule.settings.edit-staff`     | [加入排班]                                                                                                                                                                                                                     |
| `updateScheduleStaff(input: { staffId, employmentType?, enabled?, note?, orgs? })`                                                                                              | `schedule.settings.edit-staff`     | 缺席 = 不動;`note: null` = 清空;`orgs` = 看得到的分店整份取代                                                                                                                                                                  |
| `scheduleDemandTemplates` / `scheduleDemandWeekTemplates(input: { orgId? })`                                                                                                    | `schedule.settings.view`           | 每筆 `ownerOrg`、`canEdit`(當前組織這一層建立的 + `edit-templates`);`canCreate` = 有 `edit-templates`。週範本可帶 `orgId`:列那家店組織鏈上的週範本(規則頁「預設人力需求週範本」用)                                             |
| `saveScheduleDemandTemplate` / `saveScheduleDemandWeekTemplate`                                                                                                                 | `schedule.settings.edit-templates` | 整份送;帶 `id` = 修改;執行任務的 `taskId` 缺席 = 新的一筆(api 產生)                                                                                                                                                            |
| `deleteScheduleDemandTemplate` / `deleteScheduleDemandWeekTemplate`                                                                                                             | `schedule.settings.edit-templates` | 軟刪除                                                                                                                                                                                                                         |
| `scheduleRules(input: { orgId? })`                                                                                                                                              | `schedule.settings.view`           | 整份規則:`effective`、本層自訂時的 `parent`、`source`(`OWN` / `INHERITED` / `DEFAULT`)、`sourceOrgName`、`canEdit`                                                                                                             |
| `customizeScheduleRule(input: { orgId?, key, enabled?, value?, level?, order? })`                                                                                               | `schedule.settings.view` + 依組織  | 缺席的欄位沿用目前的生效值;回整份規則                                                                                                                                                                                          |
| `customizeScheduleAutoRun(input: { orgId?, conditions: [{ key, enabled }] })`                                                                                                   | `schedule.settings.view` + 依組織  | 必須列出每一條條件各一次,順序 = 陣列順序                                                                                                                                                                                       |
| `restoreScheduleRule(input: { orgId?, key })`                                                                                                                                   | `schedule.settings.view` + 依組織  | 自動排班條件的任一 key = 整組還原                                                                                                                                                                                              |
| `scheduleCalendar(input: { orgId?, month })`                                                                                                                                    | `schedule.manage.view`             | `month` = `YYYY-MM`;每天生效的那一筆,`canEdit` = 本層設的且有 `edit-calendar`                                                                                                                                                  |
| `saveScheduleCalendarDay` / `deleteScheduleCalendarDay`                                                                                                                         | `schedule.manage.edit-calendar`    | 寫在 `orgId` 那一層                                                                                                                                                                                                            |
| `myScheduleDayOffs(input: { month? })`                                                                                                                                          | `schedule.my.edit-day-offs`        | 我的畫休:`month` 缺席 = 目標月(下個月);主要分店、開放期間(`state`、`daysLeft`)、`canEdit`(開放中)、`canOverride`(有 `view-day-offs` + `edit-day-offs`)、上下限、我的畫休、主要分店有畫休的日子(`staffCount`、誰)、涉及我的違反 |
| `addMyScheduleDayOffs(input: { date, kind, slots?, note? })` / `deleteMyScheduleDayOff(input: { id })`                                                                          | `schedule.my.edit-day-offs`        | 本人登記 / 刪除;回新增的畫休、存檔後的提醒與和已有排班重疊的 `entryConflicts`                                                                                                                                                  |
| `scheduleDayOffOverview(input: { orgId?, month? })`                                                                                                                             | `schedule.manage.view-day-offs`    | 畫休總覽:那家店的開放期間、`canEdit`(`edit-day-offs`)、候選人與這個月已畫天數、有畫休的日子                                                                                                                                    |
| `addScheduleDayOffsOnBehalf(input: { orgId?, userId, date, kind, slots?, reason?, reasonNote? })` / `deleteScheduleDayOffOnBehalf(input: { orgId?, id, reason?, reasonNote? })` | `schedule.manage.edit-day-offs`    | 代改                                                                                                                                                                                                                           |
| `scheduleRoster(input: { orgId?, month, from?, to? })`                                                                                                                          | `schedule.manage.view`             | 排班表一個月(見「排班表」);`from` / `to` = 週檢視跨月多讀的日子;`canEdit` = 有 `schedule.manage.edit`、`canSaveTemplate` = 有 `edit-templates`                                                                                 |
| `saveScheduleDemand(input: { orgId?, id?, startAt, endAt, positionKey, tasks, templateId?, saveAsTemplate? })`                                                                  | `schedule.manage.edit`             | 整份送;回 `item` 與解除後一起刪的 `deletedEntryIds`                                                                                                                                                                            |
| `deleteScheduleDemand(input: { orgId?, id })`                                                                                                                                   | `schedule.manage.edit`             | 回 `deletedEntryIds`                                                                                                                                                                                                           |
| `saveScheduleEntry(input: { orgId?, id?, userId?, startAt, endAt, breakMinutes, assignments })`                                                                                 | `schedule.manage.edit`             | 新增要 `userId`;修改時人員不變                                                                                                                                                                                                 |
| `deleteScheduleEntry(input: { orgId?, id })` / `removeScheduleDayEntries(input: { orgId?, date })`                                                                              | `schedule.manage.edit`             | 被綁定的擋下 / 略過                                                                                                                                                                                                            |
| 上面五個寫入的 `changeReason: { reasonKey, reasonNote? }`                                                                                                                       | 同上                               | 已發布的月份必填(見「檢核與發布」)                                                                                                                                                                                             |
| `scheduleCheck(input: { orgId?, month })`                                                                                                                                       | `schedule.manage.view`             | 檢核結果:`items`(`key`、`level`、`message`、`userId` / `userName`、`date`、`entryIds`、`actual`、`limit`、`from` / `to`、`startAt` / `endAt`、`isOtherStore`、`orgName`、`understaffed`)、`limitCount`、`reminderCount`        |
| `publishSchedule(input: { orgId?, month })`                                                                                                                                     | `schedule.manage.publish`          | 回 `period` 與通知的人數 `notifiedCount`;被擋見「檢核與發布」                                                                                                                                                                  |

### 給其他功能的 service

`ScheduleModule` 匯出:`ScheduleStaffService.listScheduleCandidates`、`ScheduleRulesService.effectiveSettingsForOrg`、`ScheduleCalendarService.effectiveDays`、`ScheduleDayOffsService.listUnavailable`、`SchedulePermissions`。這四個給其他功能的查詢都要求那家店在操作者的可見範圍內(看不到 / 別租戶 → `NOT_FOUND` 或空清單);排程與自動排班以底座 `tenantBoundaryContext(orgs, null, tenantId)` 呼叫(可見範圍 = 整個租戶)。

### 給刮刮樂的登記接縫

排班只開介面、不知道刮刮樂存在;刮刮樂在自己的模組裡登記。

| 檔案                                                                 | 介面                                                                                                                                          | 用途                                                                                         |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/api/src/project/schedule/integration/position-annotations.ts`  | `registerPositionAnnotationProvider((tenantId, orgId) => Promise<Record<positionKey, string>>)`;讀取 `positionAnnotationsOf(tenantId, orgId)` | 排班表上崗位旁顯示的註記(收銀點名稱);多個提供者依登記順序合併                                |
| `apps/api/src/project/schedule/integration/entry-deletion-guards.ts` | `registerEntryDeletionGuard((tenantId, entryIds) => Promise<Set<entryId>>)`;讀取 `blockedEntryIdsOf(tenantId, entryIds)`                      | 哪些排班不能刪(已被收銀班次綁定);刪排班、移除這天所有排班、刪人力需求連帶刪排班前呼叫,取聯集 |

## admin 頁面

- 頁面:`apps/admin/src/pages/project/schedule/{my,manage,settings,attendance}/`,登記在 `app/project/module-pages.ts`(兩個表單模組只換列表頁);網址狀態登記在 `app/project/url-state-inventory.ts`。
- 我的班表 → 我的畫休(SC-02 / SC-23,分頁 `day-offs`,要 `schedule.my.edit-day-offs`):登記畫休對話框 SC-41a / b、當天詳細 SC-42(ⓘ);開放期間外顯示提示與「到畫休總覽代改」(`canOverride`)。排班作業 → 畫休總覽(SC-06,分頁 `day-offs`,要 `view-day-offs`;`?org=`、`?month=`、`?dayOffFilter=`)與代改(SC-24,看 api 的 `canEdit`)。違反限制被擋下時對話框列出原因(`schedule-error.ts` 的 `dayOffViolationsOf`)。畫休格子、圖例、當天詳細在 `components/project/schedule/DayOffs/`;分店選擇器暫用 `OrgTreeSelect`。
- 排班設定:排班人員(SC-08 / SC-26)、人力需求範本(SC-09a / SC-22a)、人力需求週範本(SC-09b / SC-22b)、規則(SC-10 / SC-27,分店選擇器 `?org=`;「預設人力需求週範本」的名稱與選項取那家店的週範本)。排班作業 → 行事曆(SC-07 / SC-28,`?org=`、`?month=`)。
- 排班作業 → 排班表(SC-03,分頁 `roster`,排在第一個,要 `schedule.manage.view`;`?org=`、`?month=`、`?view=`):頁殼 `pages/project/schedule/manage/roster/RosterPage.tsx`(工具列、檢視切換、`◀ 月 ▶`;每台裝置記住上次選的檢視,電腦預設班表、手機預設日)。擴充點:檢視登記 `roster-views.ts`(班表檢視 `views/RosterGridView.tsx`,其他檢視各自追加一列)、工具列按鈕 `roster-toolbar.ts`(`ROSTER_TOOLBAR_ACTIONS`:[+ 新增排班] 之後的按鈕,手機收進 [⋯];key `apply-templates` 也放在「這個月還沒有人力需求」的畫面;`ROSTER_TOOLBAR_END`:第二列最右邊的檢核按鈕)。各檢視與工具列功能用 `useRoster()`(`roster-context.ts`)拿同一份資料與動作:`openDemand`、`openEntry`、`removeDay`、`scrollToCell(target)`。**工具列的按鈕畫在 `RosterContext` 外面**(拿不到 `useRoster()`,要資料用 `check-panel/` 的 `useRosterCheck()`,它包住整頁);手機時登記 `mobile: "menu"`(預設)的收進 [⋯] 底部選單,**選單一關按鈕就卸載**,按鈕打開的對話框不能畫在按鈕裡(例:[發布] 的確認視窗由 `RosterCheckProvider` 畫);`mobile: "button"` 的獨立成按鈕放在 [⋯] 右邊([發布])。各檢視與工具列功能用 `useRoster()`(`roster-context.ts`)拿同一份資料與動作:`openDemand`、`openEntry`、`removeDay`、`scrollToCell(target)`。
- **月 / 週 / 日檢視**(SC-43–46、SC-60 / 60b / 62;`roster-views.ts` 依 `[ 月 | 週 | 日 | 班表 ]` 登記,`views/` 底下 `Month*` / `Week*` / `Day*`):週 / 日檢視的日期放 `?date=YYYY-MM-DD`(`views/useRosterDate.ts`;不在目前月份時退回今天或 1 日),換到別的月份時同時換 `?month=`;檢視登記可帶 `Navigator`(取代工具列的 `◀ 月 ▶`:週 `◀ 11/8–11/14 ▶`、日 `◀ 11/5(三)▾ ▶` + 選日期月曆 `DayPicker`)與 `readRangeOf`(週檢視跨月時給 `scheduleRoster` 的 `from` / `to`)。
  - 月檢視(`MonthView` / `MonthDayContent`):底座 `MonthCalendar` 單選模式,點日期數字(格子裡標籤與空白處以外)→ `?view=day&date=`;標籤寫法依裝置(`monthTagLines`:電腦 / 平板,手機每筆一顆實心點);點標籤 → 人力需求對話框、點空白處 → 新增人力需求(帶日期);不排班。⏲ 未對應排班的打卡讀 `views/unmatched-punches.ts` 的 `useUnmatchedPunchCounts(orgId, month)`(打卡功能實作前回空)。
  - 週 / 日檢視(`WeekView` / `DayView`,共用 `views/useTimelineGroups.tsx`):底座 `ScheduleTimeline`,排版只用底座 `layoutTimeline`(`@repo/ui/schedule-timeline` 匯出)。容器的條由 `lib/project/schedule-roster-views.ts` 的 `timelineGroupPlansOf` 決定:條數 = 執行任務筆數、負責 → 缺負責 → 協同 → 缺協同(同類依上班時間 → 人員順序 → id)、排序鍵 [崗位順序, 範本順序](臨排最後)、長條對齊上下班時間(超出容器由底座畫延伸段)、同一筆排班同一段時間填進 N 筆 → 「×N」。時點先換成租戶時區的牆上時間(`wallClockMs`),底座依瀏覽器時區畫也落在租戶的時間上。「+N」清單浮層 `WeekMoreList`;手機週 = 7 天清單 `WeekMobileList`、手機日 = 卡片清單 `DayMobileCards`(上下班和需求不同時加註)。
  - **「×N」的定義**(使用者定案):同一筆排班填進的人力需求裡,和這筆人力需求**時間有重疊**(頭尾相接不算)的筆數(含這筆);≥ 2 就顯示「×N」,只部分重疊也算(例:補貨 13:00–17:00 與臨時 15:00–18:00 由同一筆 13:00–18:00 的排班填)。班表檢視的格子「晚 ×2」(`entryChipOf`)與檢核規則「同一時段兼多個崗位」用同一個定義。
  - 選日期月曆的點 = 當天最嚴重的狀態(`dayWorstTones`):有缺負責紅、只缺協同橘、排滿或沒有人力需求不畫;和手機月檢視每筆一顆的點同一套顏色。
  - `scrollToCell`:長條 / 手機卡片的人帶 `userId|date`,月格子、時間軸日期表頭、手機週那一列帶 `|date`;週 / 日檢視的目標不在畫面上時切到那一週 / 那一天。
- **`scrollToCell(target)` 的分工**(檢核面板 [查看]):頁殼切到目標日期的月份、把目標放進 `scrollTarget`,每次重畫找 `[data-roster-cell="<key>"]`(`rosterCellKey`:人 × 日 `userId|date`、只有日期 `|date`),找到就捲過去並在元素上閃爍;目標最多留 10 秒(等換月的資料、等檢視帶到那一天),之後清掉。**各檢視自己負責把目標帶進畫面**(週 / 日檢視讀 `scrollTarget` 切到那一週 / 那一天),而且**每個檢視的格子都要帶 `data-roster-cell`**:有人的格子一律帶 `userId|date`(班表的人員格、週 / 日的長條),只有日期的格子帶 `|date`(月檢視的日期格、日期表頭);找不到 `userId|date` 時頁殼改找那一天的 `|date`。班表檢視的人員格已經帶了。
- 兩種對話框:人力需求對話框 `DemandDialog`(SC-21a–d / SC-33b;移除有人填的列或刪除前的確認 `DemandImpactDialog`)、排班對話框 `EntryDialog`(SC-04a–c、e②③、f / SC-33a;「加入這天的人力需求」`EntryAssignmentRows`,[新增一筆人力需求] 疊開 `DemandDialog`),移除這天所有排班 `RemoveDayDialog`(SC-50),[⚙ 顯示欄位] `RosterColumnPicker`(SC-47)。電腦 / 平板置中、手機全螢幕;沒有 `edit` 時欄位停用、只剩 [關閉]。
- 檢核與發布(SC-18、SC-15a–d、SC-19、SC-57 / SC-58):`manage/roster/check-panel/`(`RosterCheckProvider` 包住整個排班表頁:檢核查詢的 key 掛在 `ROSTER_QUERY_ROOT` 下,任何寫入後一起重查;`RosterCheckLayout` 電腦 / 平板右側面板、手機底部面板(可拉高 / 收合),面板開著時電腦 / 平板的側欄收成圖示列、班表檢視的統計欄暫時收成 [統計 ▸];檢核按鈕登記在 `ROSTER_TOOLBAR_END`;面板最上方給自動排班摘要的擴充點 `check-panel-slots.ts`)與 `manage/roster/publish/`([發布] 登記在 `ROSTER_TOOLBAR_ACTIONS`,已發布不顯示;`PublishDialog` 打開時重查;`useChangeReason` 給排班對話框、人力需求對話框、移除這天所有排班加「異動原因」並讀出存排班被規則擋下的說明)。
- 人力需求區收合、統計欄收成 [統計 ▸] 存在這台裝置(底座 `useSectionCollapse`,頁 id `schedule.roster`;手機預設收合)。手機(SC-59)一次看兩天:人員欄 72、日期欄 74、[統計 ▸] 窄欄 56(底座 `RosterGrid` 的 `collapsedGroupWidth`),人員欄左右留白縮小、「人力需求」標題用小一號的字。
- 圖例元件 `components/project/schedule/ScheduleLegend/`(班表管理所有頁面共用;外觀與格子同一份 `schedule-legend-styles.ts`),各功能追加自己的項目。
- 分店選擇器一律 `OrgTreeSelect scope="visible"`(用法表 ④ ⑤:整棵租戶樹、可見範圍內的才能選):規則、行事曆的分店、排班人員可以排的分店。
- 側欄排序:班表管理群組 `order` 80。
- 能不能改的按鈕一律讀 api 算好的旗標(`canEdit` / `canCreate`),不與 `usePermissions` 相乘。
- 手機:列表改卡片、有表單欄位的對話框全螢幕、刪除確認維持置中小視窗(規格 16.0)。
- 下拉選項經 `hooks/project/schedule/useScheduleFieldOptions`;顏色經 `TagPaletteSelect` / `TagPaletteChip`。
- 排班作業 → 支援需求單(SC-31,分頁 `support-requests`,要 `schedule.manage.view`;`pages/project/schedule/manage/SupportRequestsTab/`):狀態篩選(`?support=`)+ 列表(欄位讀列表欄位配置,算法同底座 `FormSubmissionList`,在 `useSupportRequestColumns`;表格與手機卡片共用;只查 `support_request`)+ [+ 新增](要 `create` 且 `moduleForms` 回這張表單可新增);電腦版點一筆在右側打開(`?detail=`):表單引擎的唯讀詳情 `FormSubmissionDetail` + 審核區塊 `ApprovalSection`(核准 / 駁回 / 退回修改依「我的任務」),標題「<單號> · <分店>」(沒有單號的退回「支援需求單 · <分店>」),「開啟完整頁面」到詳情頁。手機卡片的標題列是配置的前四欄(初值:單號、日期、開始、結束)。平板 / 手機點一筆進詳情頁(右側放不下),手機列表改卡片、篩選收進抽屜(RW-01)。新增頁 SC-14、詳情頁、編輯頁沿用表單引擎的預設組裝(`/schedule/manage/create-page/support_request`)。

## 錯誤碼

只用通用碼(GQL-04):`NOT_FOUND`(看不到)、`VALIDATION_FAILED`(`fields` 指到欄位)、`FORBIDDEN`(`reason`:`NOT_OWNER` 上層建立的、`MISSING_PERMISSION` 沒有這個組織要的規則權限、`OUTSIDE_DAY_OFF_WINDOW` 本人在畫休開放期間外修改)。畫休違反限制:`VALIDATION_FAILED` + `extensions.violations`。排班已被收銀班次綁定(刪排班、刪人力需求或解除任務連帶刪排班):`VALIDATION_FAILED` + `extensions.blockedEntryIds`(`roster/roster-error.ts`;前端 `pages/project/schedule/manage/roster/roster-error.ts`)。存排班違反限制:`VALIDATION_FAILED`(欄位 `rules`)+ `extensions.violations`;發布被擋:`VALIDATION_FAILED`(欄位 `month`)+ `extensions.reason`(`HAS_LIMIT_VIOLATIONS` / `ALREADY_PUBLISHED` / `CHANGED_DURING_PUBLISH`);已發布後沒給異動原因:`VALIDATION_FAILED`(欄位 `reasonKey` / `reasonNote`)。前端文案 `admin.schedule.errors.*`(`pages/project/schedule/schedule-error.ts`;檢核與發布的在 `manage/roster/check-panel/check-errors.ts`、`admin.schedule.roster.publish.errors.*`)。

## 稽核

`schedule-staff.create` / `.edit`(`schedule_staff`)、`schedule-setting.customize` / `.restore`(`schedule_setting`)、`schedule-demand-template.create` / `.edit` / `.delete`、`schedule-demand-week-template.create` / `.edit` / `.delete`、`schedule-calendar-day.create` / `.edit` / `.delete`、`schedule-day-off.create` / `.delete`(`schedule_day_off`;代改的 `by`、`reason` 一併記)、`schedule-demand.create` / `.edit` / `.delete`(`schedule_demand`;解除後一起刪的排班記在 `after.deletedEntries`)、`schedule-entry.create` / `.edit` / `.delete`(`schedule_entry`;填進的執行任務一併記)、`schedule-period.publish`(`schedule_period`;發布時的提醒數)。發布後的異動另寫 `schedule_changes`(給我的班表看,不取代稽核)。

## 測試

- api:`apps/api/src/project/schedule/schedule-settings.test.ts`(真 GraphQL + 真 MongoDB)、`rules/rule-resolution.test.ts`(生效值表格)、`day-offs/schedule-day-offs.test.ts`(畫休、代改、規則、`listUnavailable`、注入時鐘的開放 / 截止通知)、`day-offs/day-off-rules.test.ts`(畫休算法與開放期間表格)、`integration/integration.test.ts`、`roster/schedule-roster.test.ts`(排班表端點)、`roster/roster-stats.test.ts`(統計欄表格)、`check/roster-rules.test.ts`(排班類規則的邊界表格)、`check/schedule-check.test.ts`(檢核、存排班被限制擋、發布三種情況、發布後異動原因與通知);domain:`packages/domain/src/project/schedule-settings/schedule-settings.test.ts`(規則順序快照)、`roster.test.ts`(預設休息、自動填執行任務、負責人時間涵蓋、統計欄偏好)。
- admin:`pages/project/schedule/settings/ScheduleSettingsPage.test.tsx`、`manage/ScheduleManagePage.test.tsx`、`manage/SupportRequestsTab/SupportRequestsTab.test.tsx`(分頁權限、列表、右側審核、新增頁沒有 [存草稿]、手機卡片)、`settings/RulesTab/rule-display.test.ts`、`my/ScheduleMyDayOffs.test.tsx`、`manage/DayOffOverview.test.tsx`、`lib/project/schedule-day-offs.test.ts`、`manage/roster/RosterPage.test.tsx`、`lib/project/schedule-roster.test.ts`、`lib/project/schedule-roster-timeline.test.ts`(規則頁 T-01–T-18)、`lib/project/schedule-roster-views.test.ts`(人數寫法)、`manage/roster/views/{Month,Week,Day}View.test.tsx`(人數寫法、點擊對照、網址參數)、`manage/roster/check-panel/RosterCheck.test.tsx`(檢核面板、發布三種確認視窗、已發布後的異動原因);假 api `src/test/msw/project/schedule-*.ts`(mock 模式共用)。

- seed / 開通:`apps/db-migrator/seeds/project/schedule.test.ts`、`onboarding/schedule-onboarding.test.ts`;受管表單的安裝在 `src/seed/seed-formal-registry.test.ts`(正式 registry 對真 MongoDB);支援需求單的流程(demo create 分派受管表單、開通腳本建流程並綁定、重跑沿用、店長送出 → 審核者 = 總部管理且屬最上層組織的人)在 `onboarding/onboarding-api.test.ts`(真 api)。

## 使用者說明(help.md)

每個子模組一份(檔名 = 模組 key,頁面的問號開的就是它):`apps/admin/src/md/module-help/project/additions/schedule.{my,manage,settings,attendance}.help.md`。圖例寫在 `schedule.manage` 與 `schedule.my`(項目隨排班表等功能補齊)。群組 `schedule` 沒有頁面,不放說明。
