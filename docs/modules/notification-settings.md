# 通知與通知設定(技術)

## 用途

通知是存在 `notifications` 的一則訊息(CONTEXT.md「通知」),由業務程式碼(流程引擎、專案)經單一入口 `notify()` 產生:同一個入口寫站內通知、送 `notification` 信號、寄 email。收件人分兩類:**當事人通知**由事件決定(審核者、申請人…),**負責人提醒**由類型宣告的組織範圍 × 人員條件決定,租戶管理員在「通知設定」頁(`system.notification-settings`)調整人員條件。

本檔是通知的 api 正本:`notify()`、類型 / 管道 / 連結的登記、通知清單 API、通知設定 API 與權限。

正本:`apps/api/src/notifications/`、底座規格第 5 章

## 模組 key 與畫面

| key                            | 名稱     | sidebarType | 路由                            | 備註                                                            |
| ------------------------------ | -------- | ----------- | ------------------------------- | --------------------------------------------------------------- |
| `system.notification-settings` | 通知設定 | link        | `/system/notification-settings` | 掛「系統管理」群組,排在既有 8 項之後(`order: 9`);不是根組織專屬 |

- 側欄初始圖示 `notifications`(可在「模組與權限」頁更換)。
- 通知鈴、通知清單、個人設定的管道開關**不是模組**:頂端列與個人設定所有登入者都能用,不經模組權限(同個人偏好)。

正本:`apps/db-migrator/seeds/base/modules/system.ts`

## 權限表

每個模組固定有一筆 `<key>.*`(seed 自動產生,本表不列)。綁定原則:綁「按鈕 / 欄位所在的那一頁」(ADR-0004)。

| 權限 key                            | 它是哪一頁的什麼                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `system.notification-settings.view` | 看負責人提醒類型、組織範圍與目前的收件人條件                                 |
| `system.notification-settings.edit` | 編輯收件人條件、還原預設 + API(人員條件不能選所有人;使用者 / 角色須屬本租戶) |

租戶管理員模板自動帶整個模組(`system.notification-settings.*`)。

## 資料

- **`notifications`**:一位收件人一筆。`tenantId` / `orgId`(事件所在)、`recipientId`、`type`、`title` / `body`(寫入當下依類型範本、以收件人的語言產生)、`refType` / `refId`(連結目標)、`dedupeKey`、`channels`(這則送出的管道)、`readAt`。
  - **`(recipientId, dedupeKey)` 唯一**:同一位收件人、同一個 `dedupeKey` 只有一筆;重複呼叫 `notify()` 不再寫入、不再送信號、不再寄信。
  - **TTL**:`createdAt` 90 天後自動刪除。
  - `channels` 不含 `in-app`(收件人關掉站內、只收 email)的那幾筆照樣存,只為去重;通知清單與未讀數不算它們。
  - 屬收件人自己的資料,不掛 tenantScope:只由收件人依 `recipientId` 讀寫,與目前組織無關。
- **`notification_settings`**:`{ tenantId, type, audience }`,**`(tenantId, type)` 唯一**,`updatedBy` / `updatedAt` 由基礎欄位提供。沒有這筆、或 `audience` 為 `null` = 用類型宣告的預設人員條件;「還原預設」把 `audience` 寫回 `null`(保留這筆,`updatedBy` / `updatedAt` 記下還原的人與時間)。以 `tenantId` 為邊界的租戶設定,不掛 tenantScope。

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

底座本輪的 6 種與各自的範本參數見 `apps/api/src/notifications/base-notification-types.ts`(`workflow.task-created`、`workflow.result`、`workflow.overdue`、`workflow.cc`、`printing.job-failed`、`printing.agent-offline`)。

### 管道

已登記 `in-app`(寫 `notifications` + 對收件人送 `notification` 信號)與 `email`(寄信)。新增管道 = 在 `NOTIFICATION_CHANNELS` 加 key、寫一個 `NotificationChannelAdapter` 並加進 `NotificationsCoreModule` 的 `NOTIFICATION_CHANNEL_ADAPTERS`(兩邊對不上 → 起不來);所有類型都能把它放進 `defaultChannels`,`notify()` 的呼叫方式不變。轉接器在交易提交後才收到該管道的這批,失敗只記 log。

### 連結

`{ refType, path }`,`path` 是 admin 站內路徑、以 `{refId}` 代入(例 `workflow-instance` → `/apply-center/view-page/{refId}`)。通知清單回的 `link` 與 email 裡的完整網址(`ADMIN_APP_URL` + `path`)都由它換出;沒登記的 `refType` → 沒有連結。

### 個人偏好的管道開關

每種類型(底座 + 專案)的每個 `defaultChannels` 自動成為一個個人偏好(`user_preferences`,規格 10.6),由 `notificationPreferenceDefinitions` 推導、經 `UserPreferenceRegistryModule.forRoot` 的第二個參數合成:

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
3. **交易內**依序寫 `notifications`(`(recipientId, dedupeKey)` 已有就整個略過)。呼叫端已在交易內就併進去(動作回復 → 沒有通知、沒有信號、沒有信);不在交易內就自己開一個。
4. 交易提交後依管道交給轉接器:站內 = 一次 `/publish` 帶所有收件人的 `user:<id>`(信號 `{ type: "notification" }`,不合併);email = 逐封寄出。

**email 總開關** `WORKFLOW_MAIL_ENABLED`(`docs/env-registry.md`):不是 `"true"` 時所有通知類型的 email 只寫 log、不寄,站內通知照常(啟用信、重設密碼信不受它管);每次寄送時讀。收件人再經 `MailService` 的 `MAIL_ALLOWLIST`。寄信失敗只記 log,不影響觸發它的動作。

**通知信的語言**:主旨與內文是通知的標題 / 內容(範本以收件人的語言產生);外框(問候語、連結說明、署名)也依收件人的個人偏好 `locale`:英文(`en`、`en-US`…)用英文、以品牌名署名(專案設定的署名只有繁中一份),其餘一律繁中。正本 `apps/api/src/mail/mail-templates.ts` 的 `buildNotificationEmail`。

正本:`apps/api/src/notifications/notification.service.ts`、`notification-channels.ts`

## api 介面

```graphql
# 我的通知(所有登入者;只讀寫自己的、只列站內通知,與目前組織無關)
myNotifications(input: MyNotificationsInput!): MyNotificationsPayload!   # { items, page, pageSize, totalCount, unreadCount },新到舊
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
  page: Int = 1
  pageSize: Int = 20 # 上限 100
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
  orgScope: NotificationOrgScope! # { ref, range },類型宣告、唯讀
  audience: JSONObject! # 目前生效的人員條件(調整過的,或類型宣告的預設)
  isDefault: Boolean! # true = 沒有調整,用預設
  defaultAudience: JSONObject! # 類型宣告的預設(還原後會變回它)
  updatedAt: DateTime # 最後一次調整 / 還原;從沒動過 = null
  updatedBy: ID
}

input UpdateNotificationSettingInput {
  type: String! # 負責人提醒類型
  audience: JSONObject! # 人員條件(@repo/domain/audience 的形狀)
}

input ResetNotificationSettingInput {
  type: String!
}
```

**欄位語意**(GQL-06 / GQL-07):

- 管道開關本身用既有的 `updateMyPreferences({ settings: { [preferenceKey]: true | false | null } })` 寫;`null` = 回到預設(開)。
- `notificationSettings` 只列負責人提醒類型(當事人通知不在通知設定頁設定)。租戶 = 操作者目前組織所屬的租戶;站在根組織時只看得到預設(`isDefault: true`),不能改。
- `updateNotificationSetting` 的 `audience`:不能「所有人」、不含所屬組織欄(組織範圍由類型宣告);條件裡指定的使用者與角色要屬本租戶(使用者:所屬組織在租戶子樹內;角色:擁有組織在租戶子樹內)。
- `MarkNotificationsReadPayload.unreadCount` 是動作後的未讀數,前端拿來更新 🔔,不必再查一次。

## 錯誤

| 情況                                     | 回什麼                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| 權限不足(通知設定的 `.view` / `.edit`)   | `FORBIDDEN`(由 `@RequirePermission` 擋)                                |
| 站在根組織改通知設定                     | `FORBIDDEN`,`extensions.reason: TENANT_ONLY`                           |
| 類型沒登記、或不是負責人提醒             | `VALIDATION_FAILED`,`reason: UNKNOWN_TYPE`                             |
| 人員條件格式不對(含所有人、所屬組織欄)   | `VALIDATION_FAILED`,`reason: INVALID_AUDIENCE`,`path` 指到出錯的條件列 |
| 條件裡的使用者 / 角色不屬本租戶          | `VALIDATION_FAILED`,`reason: OUT_OF_TENANT`,`path` 指到那個值          |
| 個人偏好關掉 `canDisable = false` 的管道 | `VALIDATION_FAILED`,`reason: INVALID_VALUE`,`key`(個人偏好的既有錯誤)  |

`extensions.type` 帶出錯的類型 key。

正本:`apps/api/src/notifications/notifications-error.ts`、`apps/api/src/user-preferences/user-preferences-error.ts`

## 稽核

`updateNotificationSetting` 寫 `notification-settings.edit`、`resetNotificationSetting` 寫 `notification-settings.reset`;`targetType = "notification_setting"`,`targetId` 為該筆設定,`before` / `after` 帶 `type` 與 `audience`(還原後 `audience = null`)。

正本:`apps/api/src/notifications/notification-settings.service.ts`

## 測試

- api:`apps/api/src/notifications/notifications.test.ts`(`notify()` 的去重、交易回復、偏好 × 總開關、通知清單、負責人提醒 × 通知設定、錯誤)、`notification-registry.test.ts`(登記驗證、偏好 key 編碼、範本語系、連結)
- 流程通知:`apps/api/src/workflows/workflow-engine/workflow-engine.test.ts`(「通知信」那組)

正本:上列檔案
