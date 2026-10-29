# 通知與通知設定(技術)

## 用途

通知是存在 `notifications` 的一則訊息(CONTEXT.md「通知」),由業務程式碼(流程引擎、專案)經單一入口 `notify()` 產生:同一個入口寫站內通知、送 `notification` 信號、寄 email。收件人分兩類:**當事人通知**由事件決定(審核者、申請人…),**負責人提醒**由類型宣告的組織範圍 × 人員條件決定,租戶管理員在「通知設定」頁(`system.notification-settings`)調整人員條件。類型也可以宣告「可調時間」(某日期前 N 天 / 逾期後每天 / 每月第 N 天),租戶在同一頁調整提前天數與寄送時間,排程工作依它決定什麼時候寄。同一頁另有「側欄數字」區塊:租戶調整誰看得到各模組的側欄數字(人員條件,見「側欄數字」一節)。

本檔是通知的 api 正本:`notify()`、類型 / 管道 / 連結的登記、可調時間與排程接口、通知清單 API、通知設定 API 與權限。

正本:`apps/api/src/notifications/`

## 模組 key 與畫面

| key                            | 名稱     | sidebarType | 路由                            | 備註                                                            |
| ------------------------------ | -------- | ----------- | ------------------------------- | --------------------------------------------------------------- |
| `system.notification-settings` | 通知設定 | link        | `/system/notification-settings` | 掛「系統管理」群組,排在既有 8 項之後(`order: 9`);不是根組織專屬 |

- 側欄初始圖示 `notifications`(可在「模組與權限」頁更換)。
- 通知鈴、通知清單、個人設定的管道開關**不是模組**:頂端列與個人設定所有登入者都能用,不經模組權限(同個人偏好)。

正本:`apps/db-migrator/seeds/base/modules/system.ts`

## 權限表

每個模組固定有一筆 `<key>.*`(seed 自動產生,本表不列)。綁定原則:綁「按鈕 / 欄位所在的那一頁」(ADR-0004)。

| 權限 key                            | 它是哪一頁的什麼                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `system.notification-settings.view` | 看通知類型、組織範圍、目前的收件人條件與提醒時間;看側欄數字清單與誰看得到                                               |
| `system.notification-settings.edit` | 編輯收件人條件與提醒時間、側欄數字誰看得到、還原預設 + API(人員條件不能選所有人;使用者 / 角色須屬本租戶;提醒時間照範圍) |

租戶管理員模板自動帶整個模組(`system.notification-settings.*`)。

## 資料

- **`notifications`**:一位收件人一筆。`tenantId` / `orgId`(事件所在)、`recipientId`、`type`、`title` / `body`(寫入當下依類型範本、以收件人的語言產生)、`refType` / `refId`(連結目標)、`dedupeKey`、`channels`(這則送出的管道)、`readAt`。
  - **`(recipientId, dedupeKey)` 唯一**:同一位收件人、同一個 `dedupeKey` 只有一筆;重複呼叫 `notify()` 不再寫入、不再送信號、不再寄信。
  - **TTL**:`createdAt` 90 天後自動刪除。
  - `channels` 不含 `in-app`(收件人關掉站內、只收 email)的那幾筆照樣存,只為去重;通知清單與未讀數不算它們。
  - 屬收件人自己的資料,不掛 tenantScope:只由收件人依 `recipientId` 讀寫,與目前組織無關。
- **`notification_settings`**:`{ tenantId, type, audience, schedule }`,**`(tenantId, type)` 唯一**,`updatedBy` / `updatedAt` 由基礎欄位提供。`type` 是負責人提醒,或宣告了可調時間的當事人通知。
  - `audience`:人員條件;沒有這筆、或為 `null` = 用類型宣告的預設人員條件。當事人通知永遠是 `null`。
  - `schedule`:提醒時間(形狀見下方「可調時間」);沒有這筆、或為 `null` = 用類型宣告的預設。沒宣告可調時間的類型永遠是 `null`。
  - `scheduleUpdatedAt`:提醒時間最後一次調整 / 還原的時間(只有 `schedule` 變動才寫;`updatedAt` 也會因收件人變動而動,排程不看它)。排程補寄時,早於它的應寄時點不補;從沒動過 = `null`。
  - 「還原預設」把指定的那一欄(或可調的全部)寫回 `null`(保留這筆,`updatedBy` / `updatedAt` 記下還原的人與時間)。
  - 整個租戶一套(不分下層組織)。以 `tenantId` 為邊界的租戶設定,不掛 tenantScope。

正本:`apps/api/src/database/schemas/notification.schema.ts`、`notification-setting.schema.ts`

## 登記

三種登記都是底座 + 專案兩份,在 `app.module.ts` 經 `NotificationRegistryModule.forRoot(PROJECT_NOTIFICATIONS)` 合成(格式不對或重複 → app 起不來);專案的固定入口是 `apps/api/src/project/notifications.ts`(`{ types, links }`)。

### 通知類型

| 欄位              | 說明                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `key`             | `<領域>.<名稱>`:小寫英數與 `-`,以 `.` 分段、至少兩段(例 `workflow.task-created`);不可含 `_`            |
| `name`            | 顯示名稱(繁中預設;前端可依 key 從訊息檔覆寫)                                                           |
| `defaultChannels` | 多選、至少一個,必須是已登記的管道                                                                      |
| `canDisable`      | `{ <管道>: boolean }`,逐一宣告 `defaultChannels` 的每個管道可否由收件人關閉                            |
| `template`        | `{ <語系>: (params) => { title, body } }`;一定要有 `zh-TW`。收件人的語言:完全相同 → 同語言 → `zh-TW`   |
| `category`        | `party`(當事人通知)/ `responsible`(負責人提醒)                                                         |
| `orgScope`        | 負責人提醒才有(必填):`{ ref: "event-org" \| "tenant", range: "self" \| "descendants" \| "ancestors" }` |
| `defaultAudience` | 負責人提醒才有(必填):預設人員條件,只能用使用者 / 角色 / 權限(不能所有人、不含所屬組織欄)               |
| `recipientNote`   | 當事人通知才能給(選填):收件人說明,通知設定頁顯示「由事件決定(<說明>)」;不可空白                        |
| `schedule`        | 選填:可調時間 `{ default, dateLabel? }`(下一節);負責人提醒與當事人通知都可以宣告,沒宣告 = 一發生就寄   |

底座本輪的 6 種(都沒宣告可調時間)與各自的範本參數見 `apps/api/src/notifications/base-notification-types.ts`(`workflow.task-created`、`workflow.result`、`workflow.overdue`、`workflow.cc`、`printing.job-failed`、`printing.agent-offline`)。

### 可調時間

類型的 `schedule.default` 決定寫法與預設值,租戶只能改值、不能換寫法。時間一律以**租戶時區**計(`database/tenant-timezone.ts`,排程工作的 `ScheduledJobTenant.timezone`)。

| 寫法(`kind`)    | 欄位                                        | 意思                                                        |
| --------------- | ------------------------------------------- | ----------------------------------------------------------- |
| `days-before`   | `daysBefore`(0–365、1–5 個、不重複)、`time` | 某日期前 N 天的 `time` 寄,0 = 當天;日期由排程工作帶入       |
| `daily-overdue` | `time`                                      | 日期(逾期起算日)的隔天起每天 `time` 寄,直到排程工作不再呼叫 |
| `monthly`       | `dayOfMonth`(1–31)、`time`                  | 每月第 N 天的 `time` 寄;那個月沒有這一天就用月底            |

- `time` 是 `HH:mm`,只能落在 15 分鐘格子(00:00、00:15 … 23:45),與排程間隔一致。
- `dateLabel`(只有 `days-before` 能給,例「到期」)是日期的稱呼,通知設定頁摘要寫成「到期前 30、7 天及當天 09:00」;沒給 = 「日期前 …」。admin 先查 `admin.notifications.scheduleDateLabels.<類型 key>`。
- `recipientNote`(當事人通知)同樣可在 admin 以 `admin.notifications.recipientNotes.<類型 key>` 覆寫,查不到才用登記的值。
- 存著的 `schedule` 寫法與類型目前宣告的不同(類型改了宣告)→ 當沒調整,清單與排程都用預設。
- 格式、範圍常數與 `validateSchedule` 的正本是 `@repo/domain/notification-schedule`(api 與 admin 共用);「該不該寄」的 `scheduleHitAt` 只在 api。
- 預設值不合範圍或寫法不認得、`dateLabel` 給了別的寫法 → app 起不來(同其他登記)。
- 日期本身(例:到期日)不在通知設定裡,由各自的資料與排程工作決定。

正本:`packages/domain/src/notification-schedule/`、`apps/api/src/notifications/notification-schedule.ts`

### 排程接口

宣告了可調時間的提醒由專案的排程工作(`registerScheduledJob`,`every: "15m"`;`docs/deployment.md`「Cloud Scheduler」)觸發,每次對每個租戶:

1. `NotificationSettingsService.effectiveSchedule(tenantId, type)` → `{ schedule, modifiedAt }`:這個租戶這個類型目前生效的提醒時間(調整過的,或類型宣告的預設;根組織 `tenantId = null` 只有預設)與提醒時間的最後修改時間(`scheduleUpdatedAt`;沒動過 = `null`)。類型沒宣告可調時間 → 拋錯(程式錯誤)。
2. `scheduleHitAt(schedule, { scheduledFor, timezone, date?, modifiedAt })`:取 `(scheduledFor − 6 小時, scheduledFor]` 內**最近一個**應寄時點,回 `{ at, localDate, daysBefore?, occurrence }`;沒有、或那個時點早於 `modifiedAt` → `null`。`date` 是 `days-before` 的目標日或 `daily-overdue` 的逾期起算日(`monthly` 不用)。
3. 命中就呼叫 `notify()`,`dedupeKey` 一定要含 `occurrence`(`YYYY-MM-DD`,`days-before` 另加 `#d<天數>`,所以 30 / 7 / 0 各自獨立):同一時點之後再被叫到會回同一個 `occurrence`,由 `notify()` 的去重擋掉,寄過就不再寄。

- **準時**:時間到了之後的第一次排程寄出(通常晚不到 15 分鐘)。
- **漏跑補寄**:某幾格排程沒跑到(停機、Cloud Scheduler 呼叫失敗),之後第一次被叫到時,6 小時內最近一個應寄時點還沒寄就補寄(例:09:00 漏跑 → 09:15 補寄;09:30 再叫到不重寄)。補寄窗與排程工作的 `DAILY_CATCH_UP_MS` 同為 6 小時(`SCHEDULE_CATCH_UP_MS`),超過就放棄,免得新部署把昨天的時點補寄出去。
- **改了時間不補**:應寄時點早於提醒時間的最後修改時間就不寄,從下一個時點照新設定(例:08:45 把 09:00 改成 08:30 → 今天 08:30 不補、今天 09:00 的舊時點也不再寄,明天起 08:30)。修改時間記在 `notification_settings.scheduleUpdatedAt`,只在提醒時間調整 / 還原時寫(只改收件人不動它)。

正本:`apps/api/src/notifications/notification-settings.service.ts`、`notification-schedule.ts`

### 管道

已登記 `in-app`(寫 `notifications` + 對收件人送 `notification` 信號)與 `email`(寄信)。新增管道 = 在 `NOTIFICATION_CHANNELS` 加 key、寫一個 `NotificationChannelAdapter` 並加進 `NotificationsCoreModule` 的 `NOTIFICATION_CHANNEL_ADAPTERS`(兩邊對不上 → 起不來);所有類型都能把它放進 `defaultChannels`,`notify()` 的呼叫方式不變。轉接器在交易提交後才收到該管道的這批,失敗只記 log。

### 連結

`{ refType, path }`,`path` 是 admin 站內路徑、以 `{refId}` 代入(例 `workflow-instance` → `/apply-center/view-page/{refId}`)。通知清單回的 `link` 與 email 裡的完整網址(`ADMIN_APP_URL` + `path`)都由它換出;沒登記的 `refType` → 沒有連結。

### 個人偏好的管道開關

每種類型(底座 + 專案)的每個 `defaultChannels` 自動成為一個個人偏好(`user_preferences`,見 `docs/data-model.md`),由 `notificationPreferenceDefinitions` 推導、經 `UserPreferenceRegistryModule.forRoot` 的第二個參數合成:

- key:**`notification_<類型 key 的 . 換成 _>_<管道>`**,例 `workflow.task-created` × `in-app` → `notification_workflow_task-created_in-app`。偏好 key 不能含 `.`;類型與管道 key 都不含 `_`,以 `_` 切開就能還原。
- 布林、預設 `true`(開)。`canDisable` 為否的管道登記 `allowedValues: [true]`:送 `false` → `VALIDATION_FAILED`(`reason: INVALID_VALUE`);`notify()` 也一律視為開著。
- 只對類型的 `defaultChannels` 給開關:使用者不能自行打開類型預設沒有的管道(「新增管道後所有類型都能勾選」指的是登記類型時)。
- `notification_` 前綴保留給推導來源:底座與專案手寫的偏好 key 用這個開頭,app 起不來。

正本:`apps/api/src/notifications/notification-registry.ts`、`notification-registry.module.ts`、`apps/api/src/user-preferences/user-preference-registry.ts`

## `notify()`

```ts
notify({ type, tenantId, orgId, recipients?, params?, ref?, dedupeKey })
```

| 參數         | 說明                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| `type`       | 已登記的類型 key;沒登記 → 拋錯(程式錯誤)                                                                 |
| `tenantId`   | 事件所在的租戶頂層 id(根組織 = `null`);信號送到這個租戶,負責人提醒依它讀通知設定                         |
| `orgId`      | 事件所在的組織;負責人提醒的組織範圍(`event-org`)從它起算                                                 |
| `recipients` | 當事人通知必填:`{ kind: "users", userIds }` 或 `{ kind: "audience", audience, context? }`;負責人提醒不給 |
| `params`     | 範本參數(值是字串或 `null`)                                                                              |
| `ref`        | `{ type, id }`,經連結登記換成路徑;沒有連結不給                                                           |
| `dedupeKey`  | 同一位收件人、同一個 key 只通知一次                                                                      |

1. 解析收件人(去重、只留啟用中的使用者)。負責人提醒 = `listAudience`(類型的組織範圍 AND 人員條件);人員條件每次觸發都重讀通知設定,所以調整後的下一次就依新條件。事件在根組織(`tenantId = null`)的負責人提醒沒有收件人(記 log)。
2. 讀收件人的偏好:每個 `defaultChannels` 是否開著(`canDisable` 為否的一律開);全部關掉的人不送。
3. **交易內**寫 `notifications`(`(recipientId, dedupeKey)` 已有就整個略過;去重一次查、新的一次寫,收件人多寡不影響指令數,TX-06)。呼叫端已在交易內就併進去(動作回復 → 沒有通知、沒有信號、沒有信);不在交易內就自己開一個。
4. 交易提交後依管道交給轉接器:站內 = 一次 `/publish` 帶所有收件人的 `user:<id>`(信號 `{ type: "notification" }`,不合併);email = 先一次讀所有收件人的信箱(讀取失敗這批不寄、只記 log),再逐封寄出。

**email 總開關** `WORKFLOW_MAIL_ENABLED`(`docs/env-registry.md`):不是 `"true"` 時所有通知類型的 email 只寫 log、不寄,站內通知照常(啟用信、重設密碼信不受它管);每次寄送時讀。收件人再經 `MailService` 的 `MAIL_ALLOWLIST`。寄信失敗只記 log,不影響觸發它的動作。

**通知信的語言**:主旨與內文是通知的標題 / 內容(範本以收件人的語言產生);外框(問候語、連結說明、署名)也依收件人的個人偏好 `locale`:英文(`en`、`en-US`…)用英文、以品牌名署名(專案設定的署名只有繁中一份),其餘一律繁中。正本 `apps/api/src/mail/mail-templates.ts` 的 `buildNotificationEmail`。

正本:`apps/api/src/notifications/notification.service.ts`、`notification-channels.ts`

## api 介面

```graphql
# 我的通知(所有登入者;只讀寫自己的、只列站內通知,與目前組織無關)
myNotifications(input: MyNotificationsInput!): MyNotificationsPayload!   # { items, pageSize, nextCursor, totalCount, unreadCount },新到舊、游標分頁
myNotificationUnreadCount: MyNotificationUnreadCountPayload!            # { count }
myNotificationPreferences: MyNotificationPreferencesPayload!            # { items: [NotificationTypePreference!]! }
markNotificationsRead(input: MarkNotificationsReadInput!): MarkNotificationsReadPayload!   # { unreadCount }
markAllNotificationsRead: MarkNotificationsReadPayload!

# 通知設定(system.notification-settings.view / edit)
notificationSettings(input: NotificationSettingsInput!): NotificationSettingsPayload!       # { items, page, pageSize, totalCount }
updateNotificationSetting(input: UpdateNotificationSettingInput!): NotificationSettingPayload!   # { setting }
resetNotificationSetting(input: ResetNotificationSettingInput!): NotificationSettingPayload!     # { setting }

input MyNotificationsInput {
  unreadOnly: Boolean # 缺席 / null / false = 全部;true = 只列未讀
  after: String # 上一批的 nextCursor;缺席 / null = 從最新的開始
  pageSize: Int = 20 # 上限 100
}

type MyNotificationsPayload {
  items: [Notification!]!
  pageSize: Int!
  nextCursor: String # 下一批的游標(原樣送回 after);沒有更多 = null
  totalCount: Int! # 符合篩選的總數(不受游標影響)
  unreadCount: Int!
}

type Notification {
  id: ID!
  type: String! # 通知類型 key
  title: String!
  body: String!
  refType: String
  refId: String
  link: String # 連結登記表換成的 admin 站內路徑;沒有連結 = null
  readAt: DateTime # null = 未讀
  createdAt: DateTime!
}

input MarkNotificationsReadInput {
  ids: [ID!]! # 只動自己的未讀通知;別人的、不存在的、不是 ObjectId 的略過,不報錯
}

type NotificationTypePreference {
  type: String!
  name: String!
  channels: [NotificationChannelPreference!]! # 依 defaultChannels 的順序
}

type NotificationChannelPreference {
  channel: String! # in-app / email
  preferenceKey: String! # 開關寫回 updateMyPreferences 用的 key
  enabled: Boolean!
  canDisable: Boolean! # false = 開關停用(送 false → VALIDATION_FAILED)
}

input NotificationSettingsInput {
  keyword: String # 比對類型名稱與 key
  page: Int = 1
  pageSize: Int = 20
}

type NotificationSetting {
  type: String!
  name: String!
  category: String! # responsible(負責人提醒)/ party(當事人通知)
  orgScope: NotificationOrgScope # { ref, range },類型宣告、唯讀;當事人通知 = null
  audience: JSONObject # 目前生效的人員條件(調整過的,或類型宣告的預設);當事人通知 = null
  isDefault: Boolean! # true = 收件人沒有調整,用預設;當事人通知一律 true
  defaultAudience: JSONObject # 類型宣告的預設(還原後會變回它);當事人通知 = null
  recipientNote: String # 當事人通知的收件人說明;沒有 = null
  schedule: NotificationSchedule # 目前生效的提醒時間;沒宣告可調時間 = null(發生時就寄)
  defaultSchedule: NotificationSchedule # 類型宣告的預設提醒時間;沒宣告 = null
  isScheduleDefault: Boolean! # true = 提醒時間沒有調整;沒宣告一律 true
  scheduleDateLabel: String # DAYS_BEFORE 的日期稱呼(例「到期」);沒有 = null
  updatedAt: DateTime # 最後一次調整 / 還原;從沒動過 = null
  updatedBy: ID
}

type NotificationSchedule {
  kind: NotificationScheduleKind! # DAYS_BEFORE / DAILY_OVERDUE / MONTHLY
  daysBefore: [Int!] # DAYS_BEFORE 才有,其他 = null
  dayOfMonth: Int # MONTHLY 才有,其他 = null
  time: String! # HH:mm,15 分鐘一格
}

input UpdateNotificationSettingInput {
  type: String!
  audience: JSONObject # 人員條件(@repo/domain/audience 的形狀);負責人提醒才能給
  schedule: NotificationScheduleInput # 宣告了可調時間的類型才能給
}

input NotificationScheduleInput {
  kind: NotificationScheduleKind! # 必須是類型宣告的寫法
  daysBefore: [Int!] # DAYS_BEFORE:0–365、1–5 個、不重複
  dayOfMonth: Int # MONTHLY:1–31
  time: String! # HH:mm,15 分鐘一格
}

input ResetNotificationSettingInput {
  type: String!
  part: NotificationSettingPart # AUDIENCE / SCHEDULE
}
```

**欄位語意**(GQL-06 / GQL-07):

- 管道開關本身用既有的 `updateMyPreferences({ settings: { [preferenceKey]: true | false | null } })` 寫;`null` = 回到預設(開)。
- `notificationSettings` 列**所有負責人提醒 + 宣告了可調時間的當事人通知**(依登記順序;其他當事人通知不在通知設定頁)。租戶 = 操作者目前組織所屬的租戶;站在根組織時只看得到預設(`isDefault` / `isScheduleDefault` 都是 `true`),不能改。
- `updateNotificationSetting` 的 `audience` / `schedule`:**缺席或 `null` = 不動**;兩個都缺席或 `null` → `VALIDATION_FAILED`(`NOTHING_TO_UPDATE`)。前端只送使用者碰過的那一塊。
  - `audience`:不能「所有人」、不含所屬組織欄(組織範圍由類型宣告);條件裡指定的使用者與角色要屬本租戶(使用者:所屬組織在租戶子樹內;角色:擁有組織在租戶子樹內)。當事人通知送 `audience` → `AUDIENCE_NOT_ADJUSTABLE`。
  - `schedule`:`kind` 必須是類型宣告的寫法,只給該寫法的欄位,範圍同「可調時間」;沒宣告可調時間的類型送 `schedule` → `SCHEDULE_NOT_ADJUSTABLE`。
- `resetNotificationSetting` 的 `part`:`AUDIENCE` = 只把 `audience` 寫回 `null`、`SCHEDULE` = 只把 `schedule` 寫回 `null`;**缺席或 `null` = 這個類型可調的部分全部還原**(負責人提醒的收件人 + 宣告了的提醒時間)。指定的部分這個類型不能調 → `AUDIENCE_NOT_ADJUSTABLE` / `SCHEDULE_NOT_ADJUSTABLE`。
- `MarkNotificationsReadPayload.unreadCount` 是動作後的未讀數,前端拿來更新 🔔,不必再查一次。

## admin 頁面

### 通知鈴與通知清單

頂端列的 🔔(`components/base/NotificationBell/`)所有登入者都有,不看權限;只讀寫自己的通知。

- **未讀數**:0 不顯示,超過 99 顯示 `99+`。
- **清單**:依時間新到舊,一次 20 則(`hooks/base/useNotifications.ts`),捲到底載入下一批,沒有更多時不再載入;可切「全部 / 未讀」,另有「全部標為已讀」。下一批帶上一批的 `nextCursor`,從上一批最後一則往下接:載入途中來了新通知不會重複;「未讀」清單點過的通知留在畫面上(下次重抓才拿掉),下一批也不會因它離開篩選而漏掉。
- **點一則**:未讀的先標已讀,有連結就打開(api 依連結登記表換好的站內路徑),沒有連結只標已讀。連結頁面沒有權限或資料已不在 → 照常標已讀,由頁面顯示既有的無權限 / 找不到狀態。
- **新通知提示**(`hooks/base/useNotificationAlerts.ts`):收到 `notification` 信號 → 一則統一的 Snackbar(Severity=Info、有標題、沒有動作)。1 秒內陸續到的信號算同時收到:只到 1 則時標題、內容取最新一則未讀通知(拿不到退回「你有 1 則新通知」);多則只跳一則「你有 N 則新通知」。送出端不合併信號,所以合併在這裡做。
- 未讀數與開著的清單由信號登記表重抓(`docs/concepts/frontend-architecture.md`),提示只管跳出。
- 通知超過 90 天由 TTL 刪除,清單不再出現。

### 通知設定頁

通知設定頁(`pages/base/system/NotificationSettingsPage/`),版面沿用示範模組列表:說明 + 搜尋 + 表格卡片 + 頁碼。使用者說明在 `apps/admin/src/md/module-help/base/system.notification-settings.help.md`。

- **清單**:一列一種類型(負責人提醒 + 宣告了可調時間的當事人通知),欄位是通知類型、組織範圍、收件人、提醒時間、操作。組織範圍唯讀,由 `orgScope` 換成一行白話(`ref`:觸發事件的組織 / 最上層組織;`range`:本身 / 含下層 / 含上層);當事人通知顯示「—」。收件人是人員條件的一行摘要(與流程設計器的審核者框共用 `useAudienceSummary`),沒調整過的(`isDefault`)標「預設」;當事人通知唯讀「由事件決定(`recipientNote`)」。提醒時間是一行摘要(`notification-schedule.ts` 的 `useScheduleSummary`:「到期前 30、7 天及當天 09:00」「隔天起每天 09:00」「每月 3 號 09:00」),沒調整過的標「預設」,沒宣告的顯示「—(發生時)」。日期稱呼依類型 key 先查 `admin.notifications.scheduleDateLabels.<類型 key>`,沒有用 api 的 `scheduleDateLabel`,再沒有是「日期」。
- **網址**(REACT-14,`app/base/url-state-inventory.ts`):`list` 存搜尋與頁碼;`edit` 存正在編輯的類型 key(`?edit=printing.agent-offline`),打開時以類型 key 查 `notificationSettings`、挑出 key 完全相同的那一筆,不靠目前這一頁的清單。不放網址:還原預設的確認(確認類彈窗)、編輯彈窗裡的條件(未存輸入)。
- **唯讀**:沒有 `system.notification-settings.edit` → 沒有操作欄;網址帶 `?edit=` 時清掉參數、不打開。站在根組織時也唯讀,並說明要先切換組織:判斷用 `hooks/base/useIsAtRootOrg.ts`(`me` 已載入且 `me.currentOrg.tenantId === null`;表單管理共用同一支),手上有根組織專屬模組的超級管理員站在租戶時照常可改。`me` 還沒載入時還不知道,按鈕先不出現、`?edit=` 先留著,載入後才決定打開或清掉。api 仍會擋(`TENANT_ONLY`),萬一擋下,對話框顯示同一句說明。
- **編輯框**(`EditNotificationSettingDialog`):有幾塊顯示幾塊 ——「收件人」(`category = responsible`)、「提醒時間」(`schedule` 不是 `null`);標題依塊數是「編輯收件人 / 編輯提醒時間 / 編輯通知設定」。兩塊各有 [還原預設]:那一塊調整過 → 立即送 `resetNotificationSetting({ part })`、對話框不關、清單重抓;只改了草稿 → 就地改回預設。[儲存] 只送碰過的那一塊;都沒碰就直接關閉。
- **收件人那塊**:`AudiencePicker` 不允許「所有人」(`allowAll: false`)、欄位只有使用者 / 角色 / 權限(`notification-audience.ts`,對齊 api `NOTIFICATION_AUDIENCE_OPTIONS`);頂端資訊框說明組織範圍由類型決定、不能改。[儲存] 前先本地驗證(空群組、沒挑值),api 擋下的 `AUDIENCE_INVALID` / `OUT_OF_TENANT` 以 `extensions.path` 標回那一列(`audienceIssueFromPath`),其餘錯誤顯示在對話框內。成功後失效所有 `NotificationSettings` 查詢。
- **提醒時間那塊**(`ScheduleEditor`):寫法由類型決定;某日期前 N 天 = 提前天數一格一個(`[+ 加一個]` 到 5 個為止、每格旁 [×] 移除,剩一個時不能移)+ 寄送時間;逾期後每天 = 寄送時間;每月第 N 天 = 第幾天 + 寄送時間。寄送時間是 `TimePicker`(`minutesStep` 15,選單的分鐘只列 00 / 15 / 30 / 45;鍵盤打得出不在格子上的時間)。[儲存] 前本地驗證(0–365 整數、不重複、至少一個;1–31;寄送時間是 15 分鐘格子上的 `HH:mm`,`isScheduleTime`),api 擋下的 `SCHEDULE_INVALID` 依 `path`(例 `daysBefore[1]`)標回那一格。
- **還原預設(清單)**:只在任何一塊調整過的列可按;確認框逐行寫出還原後的預設收件人與提醒時間。送出不帶 `part`(兩塊一起還原)。成功後清單回到類型宣告的值並標「預設」。
- **類型名稱的語系**:畫面上的類型名稱一律經 `lib/base/notification-type-name.ts` 的 `useNotificationTypeName()`:有 `admin.notifications.types.<類型 key>`(key 的 `.` 就是巢狀層級)用它,沒有退回 api 的 `name`。底座 6 種類型兩個語系都有文案;專案的類型在專案字典加同樣的 key,沒加的顯示登記的名稱。通知設定頁與個人設定的通知管道開關(`PreferencesTab`)共用這一支;🔔 清單與新通知提示顯示的是通知的標題 / 內容(寫入當下依收件人的語言產生),不顯示類型名稱,之後要顯示也走這一支。
- **與 Figma 的差異(刻意)**:通知類型清單的「預設管道」欄不做(`NotificationSetting` 沒有管道欄位,管道由收件人在個人設定開關);編輯收件人的「所屬組織」條件不做(人員條件不含所屬組織,組織範圍由類型宣告);組織範圍用通用的「觸發事件的組織」,不逐類型寫「印表機所在組織」。
- **測試**:`NotificationSettingsPage.test.tsx`(清單、搜尋、編輯、錯誤標回條件列、還原預設、英文名稱與退回)、`NotificationSettingsSchedule.test.tsx`(提醒時間欄、編輯框的塊數、改值與各自還原、範圍檢查、時間選單)、`NotificationSettingsAccess.test.tsx`(沒有 edit 權限、站在根組織、超級管理員站在租戶、`?edit=` 的開啟與清除;共用 `notification-settings-test-support.ts`),假 api 是有狀態的 `test/msw/notification-settings-handlers.ts`(mock 模式也用它)。

正本:`apps/admin/src/pages/base/system/NotificationSettingsPage/`(提醒時間:`notification-schedule.ts`、`ScheduleEditor.tsx`)、`apps/admin/src/lib/base/notification-type-name.ts`、`apps/admin/src/test/msw/notification-settings-handlers.ts`

## 側欄數字

側欄模組名稱旁的數字由程式登記(`SidebarBadgeRegistry`,`docs/concepts/frontend-architecture.md`「側欄計數登記制」);**誰看得到**做成跟通知收件人一樣的人員條件,租戶在通知設定頁的「側欄數字」區塊調整。數什麼要寫程式,租戶不能新增列;之後每登記一個數字,區塊自動多一列。

- **列出哪些**:程式有登記、**而且這個租戶有開通**的模組(租戶頂層擁有的租戶管理員副本綁了那個模組;ADR-0009 開通時勾選)。找不到副本(資料不完整)時不收窄、列出全部登記。站在根組織時列出全部登記、都是預設、不能改(`TENANT_ONLY`)。
- **預設**:沒調整 = 程式登記(綁了模組就算;登記了 `requires` 時再要求那條權限,`holdsPermission`)。
- **調整**:存租戶自己的人員條件,存法同通知設定(程式預設 + 租戶覆寫 + 還原預設)。人員條件與通知收件人同一套:不能「所有人」、只有使用者 / 角色 / 權限(`SIDEBAR_BADGE_AUDIENCE_OPTIONS`);使用者與角色要屬本租戶(與通知收件人共用 `audience/audience-tenant-check.ts`)。「權限」條件只算實際授予的權限,超級管理員也不例外(不走 `*` 同層回退、不套超級管理員的略過;與通知收件人同一套規則,`AudienceService`)。
- **計算**(`sidebarBadges`):先判斷「綁了模組」(仍是前提),調整過的再用 `AudienceService.matchesAudience(operator, audience)` 判斷、**不再看 `requires`**;符合才算數字。數字本身照舊依操作者可見範圍(各模組的 `count`)。租戶 = 操作者目前組織所屬的租戶。
- **角色刪除**:人員條件引用的角色不能刪,引用處 `kind = sidebar-badge`、`name` = 模組名稱(`docs/modules/role-manager.md`「被人員條件引用」)。

**資料**:`sidebar_badge_settings`:`{ tenantId, moduleKey, audience }`,**`(tenantId, moduleKey)` 唯一**,`updatedBy` / `updatedAt` 由基礎欄位提供。`audience = null`(或沒有這筆)= 程式預設;還原預設把它寫回 `null`(保留這筆)。以 `tenantId` 為邊界的租戶設定,不掛 tenantScope;選這張新表、不擴充 `notification_settings` 的理由:那張表的 `type` 是通知類型 key,清單、引用掃描、排程都以「已登記的通知類型」過濾,把模組 key 混進去每一處都要加例外。

```graphql
# 側欄數字設定(system.notification-settings.view / edit)
sidebarBadgeSettings: SidebarBadgeSettingsPayload!                                          # { items, totalCount },依登記順序、不分頁
updateSidebarBadgeSetting(input: UpdateSidebarBadgeSettingInput!): SidebarBadgeSettingPayload!   # { setting }
resetSidebarBadgeSetting(input: ResetSidebarBadgeSettingInput!): SidebarBadgeSettingPayload!     # { setting }

type SidebarBadgeSetting {
  moduleKey: String!
  moduleName: String! # modules.name;模組不存在時退回 key
  descriptionKey: String # 「數什麼」在 admin 訊息檔的完整 key(登記時給);沒有 = null
  requires: String # 程式預設要求的權限 key;沒有 = null
  audience: JSONObject # 租戶調整過的人員條件;沒調整 = null(用程式預設)
  isDefault: Boolean!
  updatedAt: DateTime
  updatedBy: ID
}

input UpdateSidebarBadgeSettingInput {
  moduleKey: String!
  audience: JSONObject! # 不能「所有人」、只有使用者 / 角色 / 權限
}

input ResetSidebarBadgeSettingInput {
  moduleKey: String!
}
```

- 錯誤:`VALIDATION_FAILED` + `reason` `UNKNOWN_BADGE`(沒登記、或這個租戶沒開通)/ `AUDIENCE_INVALID` / `OUT_OF_TENANT`(後兩者帶 `path`),`extensions.moduleKey` 帶模組 key;站在根組織 → `FORBIDDEN` + `TENANT_ONLY`。正本 `apps/api/src/sidebar-badges/sidebar-badges-error.ts`。
- 稽核:`sidebar-badge-settings.edit` / `sidebar-badge-settings.reset`,`targetType = "sidebar_badge_setting"`,`before` / `after` 帶 `moduleKey` 與 `audience`。

**admin**(`SidebarBadgeSettingsSection.tsx`,放在通知類型清單下方):一列一個數字,欄位是模組、數什麼(`descriptionKey` 查得到就顯示,否則「—」)、誰看得到、操作。誰看得到一律以「可進入這個模組」開頭:沒調整 =「可進入這個模組的人」(登記了 `requires` 則「可進入這個模組、且符合「權限 持有 …」的人」)並標「預設」;調整過 =「可進入這個模組、且符合「<人員條件摘要>」的人」(`useAudienceSummary`)。[修改] 開與通知收件人同一個 `AudiencePicker`(`EditSidebarBadgeDialog`,網址 `?badge=<模組 key>`;起始條件 = 調整過的那份,沒調整時從「持有 `requires`」或一列空的「角色」開始);[還原預設] 先確認、只在調整過的列可按。權限與唯讀判斷同通知類型清單(沒有 edit、站在根組織 = 沒有操作欄,`?badge=` 清掉)。存完同時失效 `SidebarBadgeSettings` 與 `SidebarBadges`。文案在 `admin.sidebarBadgeSettings.*`,底座登記的說明文字在 `admin.sidebarBadgeSettings.descriptions.<模組 key>`;專案登記的數字把說明寫進專案字典,`descriptionKey` 指到它。同一份說明也由 `sidebarBadges` 回傳,當側欄數字的提示(滑鼠移上 / 觸控長按;`docs/concepts/frontend-architecture.md`「側欄計數」)。

**測試**:api `apps/api/src/sidebar-badges/sidebar-badge-settings.test.ts`(預設行為不變、覆寫成角色後誰拿得到、覆寫取代 `requires`、還原預設、租戶隔離、開通的模組、各種擋下)、`roles/role-in-use.test.ts`(`sidebar-badge` 引用);admin `NotificationSettingsBadges.test.tsx`(假 api `test/msw/sidebar-badge-settings-handlers.ts`,mock 模式也用它)。

正本:`apps/api/src/sidebar-badges/`、`apps/admin/src/pages/base/system/NotificationSettingsPage/SidebarBadgeSettingsSection.tsx`

## 錯誤

| 情況                                                       | 回什麼                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 權限不足(通知設定的 `.view` / `.edit`)                     | `FORBIDDEN`(由 `@RequirePermission` 擋)                                                          |
| 站在根組織改通知設定                                       | `FORBIDDEN`,`extensions.reason: TENANT_ONLY`                                                     |
| 類型沒登記、或不在通知設定頁上(沒宣告可調時間的當事人通知) | `VALIDATION_FAILED`,`reason: UNKNOWN_TYPE`                                                       |
| 當事人通知送 `audience` / 還原收件人                       | `VALIDATION_FAILED`,`reason: AUDIENCE_NOT_ADJUSTABLE`                                            |
| 沒宣告可調時間卻送 `schedule` / 還原提醒時間               | `VALIDATION_FAILED`,`reason: SCHEDULE_NOT_ADJUSTABLE`                                            |
| 提醒時間不合寫法或範圍                                     | `VALIDATION_FAILED`,`reason: SCHEDULE_INVALID`,`path` 指到出錯的欄位(例 `daysBefore[2]`、`time`) |
| `audience` 與 `schedule` 都沒給                            | `VALIDATION_FAILED`,`reason: NOTHING_TO_UPDATE`                                                  |
| 人員條件格式不對(含所有人、所屬組織欄)                     | `VALIDATION_FAILED`,`reason: AUDIENCE_INVALID`,`path` 指到出錯的條件列                           |
| 條件裡的使用者 / 角色不屬本租戶                            | `VALIDATION_FAILED`,`reason: OUT_OF_TENANT`,`path` 指到那個值                                    |
| 個人偏好關掉 `canDisable = false` 的管道                   | `VALIDATION_FAILED`,`reason: INVALID_VALUE`,`key`(個人偏好的既有錯誤)                            |
| 我的通知清單的 `after` 解不開(不是上一批的 `nextCursor`)   | `VALIDATION_FAILED`,`reason: INVALID_CURSOR`                                                     |

`extensions.type` 帶出錯的類型 key。

正本:`apps/api/src/notifications/notifications-error.ts`、`apps/api/src/user-preferences/user-preferences-error.ts`

## 稽核

`updateNotificationSetting` 寫 `notification-settings.edit`、`resetNotificationSetting` 寫 `notification-settings.reset`;`targetType = "notification_setting"`,`targetId` 為該筆設定,`before` / `after` 帶 `type`、`audience` 與 `schedule`(還原的那一欄 = `null`)。

正本:`apps/api/src/notifications/notification-settings.service.ts`

## 測試

- api:`apps/api/src/notifications/notifications.test.ts`(`notify()` 的去重、交易回復、偏好 × 總開關、通知清單、負責人提醒 × 通知設定、錯誤;只有底座類型時提醒時間全部 `null`)、`notification-registry.test.ts`(登記驗證含可調時間、偏好 key 編碼、範本語系、連結)、`notification-schedule.test.ts`(三種寫法「該不該寄」的表格測試、租戶時區)、`notification-schedule-settings.test.ts`(通知設定的各種操作:以 `jest.mock` 換上 `test-support/schedule-fixture.ts` 的測試類型)
- 流程通知:`apps/api/src/workflows/workflow-engine/workflow-engine.test.ts`(「通知信」那組)

正本:上列檔案
