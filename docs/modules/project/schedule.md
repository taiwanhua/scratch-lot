# 班表管理(技術)

排班與出勤(專案規格第 14 章)的內部技術文件:群組 `schedule` 與四個子模組 `schedule.my`、`schedule.manage`、`schedule.settings`、`schedule.attendance`。租戶使用者看的說明在 `apps/admin/src/md/module-help/project/additions/schedule.<子模組>.help.md`。

## 用途

- **獨立的專案模組**:不引用刮刮樂的任何資料表或程式(依賴方向:刮刮樂 → 排班,`apps/api/src/project/project-lint.test.ts` 守)。刮刮樂要在排班畫面上顯示東西、或擋排班的刪除,經下方「給刮刮樂的登記接縫」登記。
- 本文件目前寫到:模組宣告與權限、排班設定(排班人員、人力需求範本、人力需求週範本、規則)、行事曆、畫休(我的畫休、畫休總覽、代改、畫休規則、開放 / 截止通知)。排班表、打卡、出勤紀錄、支援需求單、補打卡申請由各自的功能追加小節。

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
| 補打卡申請 | `makeup-punch`    | `schedule.attendance` | 一關:店長限定「分店」                                              |
| 支援需求單 | `support-request` | `schedule.manage`     | 一關:人員條件「角色 總部管理 且 所屬組織屬於租戶(最上層組織本身)」 |

## 資料

唯一索引一律是 partial(`partialFilterExpression: { deletedAt: { $type: "null" } }`,軟刪除的不算);同時寫入撞到唯一索引時回與事前檢查同一個 `VALIDATION_FAILED`。

八張租戶表,schema 在 `apps/api/src/project/database/schedule/`(逐欄註解),登記 `registration.ts`(`SCHEDULE_SETTINGS_REGISTRATION`)。都掛 `baseFieldsPlugin` 與 `tenantScopePlugin({ moduleData: true })`(`tenantId` 由建立時推導);沒有宣告資料範圍目標(只受可見範圍保底)。

| collection                       | 一筆是                                    | 歸屬 `orgId`                                | 唯一 / 說明                                                                                                                                                                                          |
| -------------------------------- | ----------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schedule_staff`                 | 排班檔案(使用者子檔)                      | 建立它的組織(當前組織)                      | 一人一份:唯一 `(tenantId, userId)`;讀取與修改照一般可見性                                                                                                                                            |
| `schedule_relationships`         | `org_schedule_staff`:排班人員可以排某分店 | `firstId`(分店)                             | `meta = { canLead, isPrimary, sortOrder }`;唯一 `(type, firstId, secondId)`(只算未刪除的);拿掉一家店 = 軟刪除                                                                                        |
| `schedule_settings`              | 某組織對某條規則的自訂                    | 自訂它的組織                                | 唯一 `(orgId, key)`(只算未刪除的);[還原] = 軟刪除                                                                                                                                                    |
| `schedule_demand_templates`      | 人力需求範本                              | 建立它的組織                                | 執行任務 `tasks[] = { taskId, role, taskKey }`                                                                                                                                                       |
| `schedule_demand_week_templates` | 人力需求週範本                            | 建立它的組織                                | `days` 7 格(0 = 星期日),每格是範本 id                                                                                                                                                                |
| `schedule_calendar_days`         | 某組織某天的店休 / 特殊日                 | 設定它的組織                                | 唯一 `(orgId, date)`(只算未刪除的)                                                                                                                                                                   |
| `schedule_day_offs`              | 畫休(屬於人)                              | 租戶頂層(人的資料,同排班檔案)               | `kind` 整天畫休 `full-day` / 時段不可排 `time-range`(`startTime` / `endTime`);同一人同一天未刪除的整天畫休唯一 `(tenantId, userId, date)`(partial);代改記 `by`、`reason`、`reasonNote`;刪除 = 軟刪除 |
| `schedule_day_off_locks`         | 畫休寫入的守門文件(一家店一個月一筆)      | 租戶頂層(鎖的店記在 `storeId`,不擋刪除分店) | 唯一 `(orgId, storeId, month)`;只用 `version` 製造寫入衝突                                                                                                                                           |

## 規則

### 組織鏈與「看得到上層」

範本、週範本、規則、行事曆都「沿組織樹往上找」:組織鏈 = 自己 → 上層 → … → 最上層組織(不含根組織)。上層組織通常不在操作者的可見範圍裡,讀這些資料時以提升範圍的讀取上下文、配**明列的組織鏈**條件查(`apps/api/src/project/schedule/shared/schedule-org.ts`,先例同欄位管理的 `fields/field-visibility.ts`)。根組織沒有排班(對根組織查 → `VALIDATION_FAILED`,欄位 `orgId`)。

### 排班人員(規格 14.3)

- **一人一份(規格 14.1:使用者子檔,一對一)**:同一租戶裡一個使用者只有一份排班檔案(唯一 `(tenantId, userId)`)。[加入排班] 建立時 `orgId` = 當前組織,讀取與修改照一般可見性(看不到那個組織的檔案 → `NOT_FOUND`、改不到);跨店支援由支援需求單把人加進那家店。
- **候選使用者** = 所屬組織落在操作者可見範圍內(且在當前組織的租戶裡)的使用者;[加入排班] 只能加這些人、而且整個租戶裡還沒有他的檔案(已加入 → `VALIDATION_FAILED`,欄位 `userIds`,同時加入也一樣;看不到 → `NOT_FOUND`)。已被操作者看不到的組織加入的人,候選清單標「已在其他組織加入」(`joinedElsewhere`)、勾選框停用。
- 可以排的分店只能加操作者看得到的(看不到 → `NOT_FOUND`)。存檔時 `orgs` 整份取代「操作者看得到的那幾家」;看不到的分店的關聯保留不動。
- **主要分店每人一家**:有任何可以排的分店時恰好一家(含看不到的分店的關聯一起算),否則 `VALIDATION_FAILED`(欄位 `orgs`)。主要分店在看不到的分店時列表回 `primaryElsewhere = true`。
- **候選人**(手動與自動排班同一份名單):`ScheduleStaffService.listScheduleCandidates(operator, orgId, at?)` —— 有排班檔案、啟用、帳號啟用、可以排的分店包含這家店的人;`at`(預設現在)只決定哪些關聯算數(那之前加入、那之後才拿掉的都算);回傳的 `canLead` / `isPrimary` / `sortOrder` 與排班檔案、帳號的啟用都是**現在的值**。不看操作者的可見範圍(呼叫端先確認看得到這家店)。

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

### 行事曆(規格 14.5)

- 某家店某天以**最接近的那一層**為準(`apps/api/src/project/schedule/calendar/calendar-resolution.ts`):上層設店休、本店沒設 → 本店那天店休;本店自設特殊日 → 以本店為準。同一層同一天只有一筆(重複 → `VALIDATION_FAILED`,欄位 `date`)。
- 特殊日:類別(欄位管理「特殊日類別」啟用中的選項,否則欄位 `category`)、名稱必填,顏色選填;店休:類別與顏色一律存 null。
- 寫入要 `schedule.manage.edit-calendar`,寫在選的那家店那一層;上層設的那一天本店改不了(`FORBIDDEN`,`NOT_OWNER`)。排班作業共用 `ScheduleCalendarService.effectiveDays(operator, orgId, from, to)`。

### 畫休(規格 14.1 `schedule_day_offs`、14.2、14.5「畫休總覽」、14.6「我的畫休」)

- **屬於人**:一筆歸屬租戶頂層;那段時間這個人可以排的每一家店都不能排。整天畫休一天一筆(重複 → `VALIDATION_FAILED`,欄位 `kind`;同時送出由唯一索引擋下,回同一個錯誤);時段不可排一天可以多段,`HH:mm`、結束晚於開始、不跨午夜,和同一天既有的或同一次送的其他段重疊 → `VALIDATION_FAILED`(欄位 `slots`,相接不算重疊)。整天 + 時段可以同一天並存。
- **畫休的算法**(`apps/api/src/project/schedule/day-offs/day-off-rules.ts`):那一天只要有任何一種就算 1 天、1 人;「最多連續休假」只算整天畫休(跨月也連續)。
- **檢查函式**:畫休類四條規則(`maxMonthlyDayOffs`、`minMonthlyDayOffs`、`maxConsecutiveDaysOff`、`maxDailyDayOffStaff`)由 `ScheduleDayOffsService` 啟動時以 `registerRuleEvaluator` 登記;資料由呼叫端準備:人的規則給這個人前後各一個月的畫休,店的規則給**以這家店為主要分店的人**的畫休。違反附 `detail`(`actual`、`limit`、期間類的 `from` / `to`)給畫面組文案。
- **用哪家店的設定**:人的規則與開放期間都用這個人的**主要分店**的生效值;同日最多畫休人數檢查主要分店那一天。
- **同時送出**:登記 / 代改 / 刪除把「讀畫休 → 檢查重疊 → 跑規則 → 寫入」放在同一個交易,交易一開始對守門文件(主要分店 × 月份,`schedule_day_off_locks`)`$inc`;同一家店同一個月同時進來的寫入互相衝突、由 `TransactionService` 重跑,同日人數、每月上限、時段重疊不會被同時送出繞過(守門文件在交易外先建好)。
- **存檔規則**:存檔後限制等級的違反比存檔前多(新的、或超出更多)→ 不存,`VALIDATION_FAILED`(欄位 `date`,`extensions.violations` 列出擋下的違反);提醒照存,回在 `violations`。「每月最少畫休」不擋存檔(登記途中本來就不足,擋刪除會讓人改不掉登記錯的那天),照樣列在違規清單。
- **開放期間**(規則 `dayOffWindow`,`apps/api/src/project/schedule/day-offs/day-off-window.ts`):目標月的開放期間 = 前一個月的 N 日至 M 日(超過月底用月底);今天(租戶時區,`ScheduleClock`)在期間內 = 開放中。這條規則沒有等級,只看值、不看開關,登記檢查與通知用同一個判斷(`dayOffWindowValueOf`)。**本人**只能在開放中登記 / 刪除那個目標月的畫休,其他時候 → `FORBIDDEN`(`reason: OUTSIDE_DAY_OFF_WINDOW`)。
- **代改**(`edit-day-offs`):對象要是選的那家店(要看得到)的排班人員(否則 `NOT_FOUND`);不受開放期間限制;那個月的截止日(對象主要分店的開放期間)已過 → `reason` 必填(欄位管理「代改畫休原因」啟用中的選項),選「其他」`reasonNote` 必填(否則 `VALIDATION_FAILED`,欄位 `reason` / `reasonNote`);截止前原因選填。記代改人 `by`;代改刪除先寫入代改人與原因再軟刪除。代改一樣跑規則。
- **畫休總覽**:候選人(可以排這家店的排班人員)這個月的畫休;同日畫休人數只計 `isPrimary` 的人;「尚未畫休」= 這個月還沒畫任何一天的候選人。
- **給其他功能**:`ScheduleDayOffsService.listUnavailable(orgId, from, to)` 回這家店的候選人每人每天的整天畫休 / 時段不可排(只列有畫休的日子;不看操作者的可見範圍)。

### 畫休開放 / 即將截止通知(規格 3.4、3.5、14.11)

- 排程 `schedule.day-off-reminders`(每 15 分鐘,`apps/api/src/project/schedule/day-offs/day-off-reminders.service.ts`):逐租戶、逐家有排班人員的分店,依那家店規則「畫休開放期間」的生效值算出開放日 / 截止日,「這個時點該不該寄」用底座 `scheduleHitAt`(租戶時區;漏跑 6 小時內補寄;改了時間不補)。
- 兩型都是當事人通知,收件人 = 可以排這家店的排班人員(`listScheduleCandidates`);同一人可以排兩家店 → 各一則。`dedupeKey` = `<類型>:<分店>:<目標月>:<時點>`。
- 可調時間宣告在 `apps/api/src/project/notifications.ts`:畫休開放 = 開放日前 0 天 09:00、畫休即將截止 = 截止日前 1 天 09:00(租戶可在通知設定頁改;收件人唯讀「由事件決定(可以排這家店的排班人員)」)。

## api 介面

GraphQL 文件 `packages/graphql/src/documents/project/schedule/schedule-settings.graphql`。`orgId` 缺席或 null = 當前組織(GQL-06)。

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
| `addMyScheduleDayOffs(input: { date, kind, slots?, note? })` / `deleteMyScheduleDayOff(input: { id })`                                                                          | `schedule.my.edit-day-offs`        | 本人登記 / 刪除;回新增的畫休與存檔後的提醒                                                                                                                                                                                     |
| `scheduleDayOffOverview(input: { orgId?, month? })`                                                                                                                             | `schedule.manage.view-day-offs`    | 畫休總覽:那家店的開放期間、`canEdit`(`edit-day-offs`)、候選人與這個月已畫天數、有畫休的日子                                                                                                                                    |
| `addScheduleDayOffsOnBehalf(input: { orgId?, userId, date, kind, slots?, reason?, reasonNote? })` / `deleteScheduleDayOffOnBehalf(input: { orgId?, id, reason?, reasonNote? })` | `schedule.manage.edit-day-offs`    | 代改                                                                                                                                                                                                                           |

### 給其他功能的 service

`ScheduleModule` 匯出:`ScheduleStaffService.listScheduleCandidates`、`ScheduleRulesService.effectiveSettingsForOrg`、`ScheduleCalendarService.effectiveDays`、`ScheduleDayOffsService.listUnavailable`、`SchedulePermissions`。

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
- 分店選擇器一律 `OrgTreeSelect scope="visible"`(用法表 ④ ⑤:整棵租戶樹、可見範圍內的才能選):規則、行事曆的分店、排班人員可以排的分店。
- 側欄排序:班表管理群組 `order` 80。
- 能不能改的按鈕一律讀 api 算好的旗標(`canEdit` / `canCreate`),不與 `usePermissions` 相乘。
- 手機:列表改卡片、有表單欄位的對話框全螢幕、刪除確認維持置中小視窗(規格 16.0)。
- 下拉選項經 `hooks/project/schedule/useScheduleFieldOptions`;顏色經 `TagPaletteSelect` / `TagPaletteChip`。

## 錯誤碼

只用通用碼(GQL-04):`NOT_FOUND`(看不到)、`VALIDATION_FAILED`(`fields` 指到欄位)、`FORBIDDEN`(`reason`:`NOT_OWNER` 上層建立的、`MISSING_PERMISSION` 沒有這個組織要的規則權限、`OUTSIDE_DAY_OFF_WINDOW` 本人在畫休開放期間外修改)。畫休違反限制:`VALIDATION_FAILED` + `extensions.violations`。前端文案 `admin.schedule.errors.*`(`pages/project/schedule/schedule-error.ts`)。

## 稽核

`schedule-staff.create` / `.edit`(`schedule_staff`)、`schedule-setting.customize` / `.restore`(`schedule_setting`)、`schedule-demand-template.create` / `.edit` / `.delete`、`schedule-demand-week-template.create` / `.edit` / `.delete`、`schedule-calendar-day.create` / `.edit` / `.delete`、`schedule-day-off.create` / `.delete`(`schedule_day_off`;代改的 `by`、`reason` 一併記)。

## 測試

- api:`apps/api/src/project/schedule/schedule-settings.test.ts`(真 GraphQL + 真 MongoDB)、`rules/rule-resolution.test.ts`(生效值表格)、`day-offs/schedule-day-offs.test.ts`(畫休、代改、規則、`listUnavailable`、注入時鐘的開放 / 截止通知)、`day-offs/day-off-rules.test.ts`(畫休算法與開放期間表格)、`integration/integration.test.ts`;domain:`packages/domain/src/project/schedule-settings/schedule-settings.test.ts`(規則順序快照)。
- admin:`pages/project/schedule/settings/ScheduleSettingsPage.test.tsx`、`manage/ScheduleManagePage.test.tsx`、`settings/RulesTab/rule-display.test.ts`、`my/ScheduleMyDayOffs.test.tsx`、`manage/DayOffOverview.test.tsx`、`lib/project/schedule-day-offs.test.ts`;假 api `src/test/msw/project/schedule-*.ts`(mock 模式共用)。
- seed / 開通:`apps/db-migrator/seeds/project/schedule.test.ts`、`onboarding/schedule-onboarding.test.ts`。

## 使用者說明(help.md)

每個子模組一份(檔名 = 模組 key,頁面的問號開的就是它):`apps/admin/src/md/module-help/project/additions/schedule.{my,manage,settings,attendance}.help.md`。圖例寫在 `schedule.manage` 與 `schedule.my`(項目隨排班表等功能補齊)。群組 `schedule` 沒有頁面,不放說明。
