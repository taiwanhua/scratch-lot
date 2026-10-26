# 經銷商管理(技術)

## 用途

刮刮樂的經銷商主檔:甲類(向公司批購)、乙類(有店面,可對應一家分店、登記牌租)與關係人(受託人、代理人、介紹人),以及三者之間的關聯、甲類的見簽、證照到期 / 牌租繳費提醒與側欄計數。需求來源:專案規格 3.1、3.2、3.4、5.2、5.3、5.4。

正本:`apps/db-migrator/seeds/project/dealers.ts`、`apps/api/src/project/lottery/dealers/`

## 模組 key 與畫面

| key                            | 名稱       | sidebarType             | 路由                              | 自有權限 |
| ------------------------------ | ---------- | ----------------------- | --------------------------------- | -------- |
| `dealers`                      | 經銷商管理 | link(列表頁)            | `/dealers`                        | 見權限表 |
| `dealers.view-page`            | 經銷商詳情 | hidden                  | `/dealers/view-page/<id>`         | 僅 `*`   |
| `dealers.create-page`          | 新增經銷商 | hidden                  | `/dealers/create-page`            | 僅 `*`   |
| `dealers.edit-page`            | 編輯經銷商 | hidden                  | `/dealers/edit-page/<id>`         | 僅 `*`   |
| `dealers.contacts`             | 關係人     | hidden(權限容器,無路由) | —                                 | 見權限表 |
| `dealers.contacts.view-page`   | 關係人詳情 | hidden                  | `/dealers/contact-view-page/<id>` | 僅 `*`   |
| `dealers.contacts.create-page` | 新增關係人 | hidden                  | `/dealers/contact-create-page`    | 僅 `*`   |
| `dealers.contacts.edit-page`   | 編輯關係人 | hidden                  | `/dealers/contact-edit-page/<id>` | 僅 `*`   |

列表頁一頁三個分頁(甲類 | 乙類 | 關係人);關係人分頁要綁 `dealers.contacts`。Figma:經銷商 95:14 的 DE-01–DE-08(平板 / 手機照規則 RW-01–04)。

正本:`apps/db-migrator/seeds/project/dealers.ts`、`apps/admin/src/app/project/module-pages.ts`

## 權限表

本模組**沒有 `view` 權限**(規格 3.2):進得去哪一頁看 `me.modules` 有沒有那個模組(ADR-0011),api 的讀取也以「綁了 `dealers`」守門。

| 權限 key                                    | moduleId 指向      | 它是哪一頁的什麼                                                   |
| ------------------------------------------- | ------------------ | ------------------------------------------------------------------ |
| `dealers.*`、`dealers.contacts.*`           | 各自的節點         | wildcard,seed 自動產生                                             |
| `dealers.create`                            | 經銷商管理(列表頁) | [+ 新增經銷商] + `createLotteryDealer`                             |
| `dealers.edit`                              | 經銷商管理(列表頁) | [編輯](含解約、關聯)、[登記見簽] + `updateLotteryDealer`、見簽兩支 |
| `dealers.show-last-purchase-base-date`      | 經銷商管理(列表頁) | 欄位級:最近一次批購基準日看得到                                    |
| `dealers.edit-last-purchase-base-date`      | 經銷商管理(列表頁) | 欄位級:最近一次批購基準日改得動                                    |
| `dealers.show-last-self-purchase-base-date` | 經銷商管理(列表頁) | 欄位級:最近一次本人批購基準日看得到                                |
| `dealers.edit-last-self-purchase-base-date` | 經銷商管理(列表頁) | 欄位級:最近一次本人批購基準日改得動                                |
| `dealers.contacts.create`                   | 關係人(容器)       | [+ 新增關係人] + `createLotteryDealerContact`                      |
| `dealers.contacts.edit`                     | 關係人(容器)       | [編輯](含停用、身分)+ `updateLotteryDealerContact`                 |

**開通時建立的角色**(規格 3.3;配方 `apps/db-migrator/seeds/project/onboarding/role-grants/dealers.ts`):總部管理 = 兩層 `*` 全部;店長 = 綁列表、詳情、關係人分頁與關係人詳情(看得到,不含主檔修改、不含兩個欄位級權限);店員 = 不給。

**側欄計數**:角色綁了 `dealers` 就看得到數字(登記時不填 `requires`,底座預設以模組綁定判斷,不要求 `view`);總部管理與店長都有,數字照各自的可見範圍。

正本:`apps/db-migrator/seeds/project/dealers.ts`(`permissions`)

## 資料

四張表(地圖見 [docs/project/data-model.md](../../project/data-model.md),欄位逐欄註解在 schema 檔):

| collection                | 用途                                                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lottery_dealers`         | 經銷商(甲 / 乙);`orgId` = 建立者當時的組織;資料共用「可共用、預設不共用、可編輯」,另給對應分店看(`storeOrgId` 是 `org_lottery_dealer` 的副本,同交易寫入;ADR-0014);證號、身分證字號租戶內唯一(部分唯一索引,軟刪除不算) |
| `lottery_dealer_contacts` | 關係人;身分多選(受託人 / 代理人 / 介紹人);身分證字號租戶內唯一                                                                                                                                                        |
| `lottery_dealer_signins`  | 見簽;唯一 `(dealerId, year, quarter)`;`orgId` 同經銷商                                                                                                                                                                |
| `lottery_relationships`   | 關聯(形狀比照底座 `business_relationships`);唯一 `(tenantId, type, firstId, secondId, meta.role)`,反查 `(tenantId, type, secondId)`                                                                                   |

`lottery_relationships` 本模組用三種 type:`lottery_dealer_lottery_dealer_contact`(經銷商 → 關係人,`meta.role`)、`lottery_dealer_lottery_dealer`(甲類 → 乙類,共同銷售處所)、`org_lottery_dealer`(分店 → 乙類,對應分店)。`org_lottery_bank_account` 由帳戶管理在同一張表新增 type。關聯的 `orgId` = 所屬經銷商的 `orgId`;解除 = 軟刪除,唯一索引只算未刪除的列。

**批購日**:`lastPurchaseDate` / `lastSelfPurchaseDate` = max(基準日, 有效進貨單上最新的批購日期),由 `purchase-dates.ts` 的 `DealerPurchaseDates.recomputeDealerPurchaseDates(session, tenantId, dealerId, actorId?)` 寫(`actorId` = 讓日期變了的人,寫進 `updatedBy`;沒有 = 系統身分)。本模組在基準日變動時呼叫;進貨單在送出 / 駁回 / 作廢時呼叫,並以 `registerSource(source)` 提供進貨單那一份候選日期。

**lookup 來源 `lottery_dealer`**:欄位 `name`、`licenseNo`、`type`;可篩 `status`(`active` / `suspended` / `terminated`)、`type`(`a` / `b`);權限 `null`(可見範圍內公開)。

正本:`apps/api/src/project/database/lottery-dealers/`、`apps/api/src/project/lookup-providers.ts`

## 規則

- **類型**建立後唯讀;甲類才有的欄位(兩個批購基準日、共同銷售處所、受託人)與乙類才有的欄位(店面、牌租、對應分店)給錯類型 → `NOT_FOR_TYPE`。
- **關聯上限**:甲類代理人 2、受託人 2、介紹人 1;乙類代理人 2、介紹人 1、不能有受託人。**新掛上**的關係人要有那個身分且啟用中;經銷商本人(身分證字號相同)不能登記;同一人對同一經銷商可同時擔任多種身分。已掛上的關係人之後停用,關聯保留。
- **共同銷售處所**:只能選乙類、新選的不能是解約的;甲類要先有共同銷售處所才能設代理人。移除共同銷售處所但還有代理人 → `CONFLICT`(`AGENTS_REQUIRE_CO_SALES`,列出代理人);帶 `releaseAgents: true` 重送一併解除。
- **對應分店**:只有乙類;要是租戶底下的組織(不是最上層組織本身);一對一,已被其他乙類對應 → `STORE_OCCUPIED`。乙類可以不選(畫面提醒)。
- **牌租**:有週期就要繳費日;週期是季或年時起算月份必填;由季 / 年改成月時起算月份寫回 null。繳費日 = 每期第一個月的第 N 日,那個月沒有這一天用月底。
- **關係人取消身分**:那個身分還有關聯 → `CONFLICT`(`ROLE_IN_USE`,只列操作者看得到的經銷商上的關聯,看不到的只回筆數 `hiddenCount`,畫面提示「另有 N 筆你看不到的關聯也會一起解除」);帶 `releaseRelationships: true` 重送一併解除 —— 這是**例外寫入**:看不到的經銷商上的關聯以租戶為邊界解除(`dealer-links.service.ts` 的 `releaseContactRoles`)。
- **資料共用(ADR-0014)**:經銷商看得到 = 可見範圍、共用給(`shareOrgs`,編輯頁「共用給」欄位,要 `dealers.edit`)、或乙類的對應分店。共用進來的只能看(`isShared`、`abilities` 全 false、寫入 `NOT_FOUND`)。看得到經銷商就看得到它的關聯與引用的名稱(關聯列以租戶為邊界讀;名稱經 `findRefsInTenant`)。租戶內唯一(證號、身分證字號)與對應分店是否已被占用以 `existsInTenant` 檢查;共同銷售人數、已被對應的分店、關係人掛在哪些經銷商以租戶為邊界反查(`tenantBoundaryContext`)。別租戶一律看不到。
- **沒有刪除**:經銷商只能解約、關係人只能停用;解約 / 停用後不能再被選取(挑選器帶 `selectable` / `status: ACTIVE`),既有關聯保留。
- **主檔與關聯同一個交易**;每一筆關聯的新增 / 解除各寫一筆稽核。
- **見簽**:每年每季一筆;見簽日不限定落在該季;已過沒登記的季別 `MISSING`(警告色)、本季沒登記 `OPEN`、未到 `NOT_STARTED`(不能登記)。
- **側欄計數 `dealers`**:操作者可見範圍內、不是解約的經銷商中,證照到期日 ≤ 今天 + 30 天(含已過期),或甲類的最近一次批購日 / 本人批購日距今超過 180 天(都無紀錄的不算);同一位只算一次。「今天」以租戶時區計。新增 / 編輯後對操作者送 `badge:dealers`。
- **提醒(B14)**:排程工作 `lottery.dealer-reminders`(每 15 分鐘;以 `tenantBoundaryContext` 逐租戶讀)對每個租戶、每位不是解約的經銷商判斷 `scheduleHitAt`:證照到期(預設到期日前 30、7、0 天 09:00;過期後不再寄)、牌租繳費提醒(乙類,預設繳費日前 3、0 天 09:00)。事件組織 = 乙類的對應分店,甲類或沒有對應分店 = 租戶;`dedupeKey` 帶經銷商、目標日與時點;連結到那位經銷商的詳情頁(`lottery-dealer`,`lottery-notifications.md`「連結」)。提醒時間由通知設定頁調整(規格 3.5)。

正本:`apps/api/src/project/lottery/dealers/dealer-links.service.ts`、`dealers.service.ts`、`dealer-reminders.service.ts`、`dealer-badge.ts`

## api 介面

| 端點                                                                      | 守門                               | 說明                                                                                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lotteryDealers(input)`                                                   | 綁 `dealers`                       | 清單:`type` 必填;`keyword`(證號、姓名、店名、身分證字號)、`status`、`selectable`、`purchaseOverDays`、`currentQuarterSigned`、`licenseState`、分頁 |
| `lotteryDealer(id)`                                                       | 綁 `dealers`                       | 單筆;看不到 → `NOT_FOUND`                                                                                                                          |
| `lotteryDealerSignins(dealerId, year)`                                    | 綁 `dealers`                       | 某年四季(一定四筆)                                                                                                                                 |
| `lotteryDealerCoSellers(dealerId)`                                        | 綁 `dealers`                       | 乙類的共同銷售人(整個租戶,反查)                                                                                                                    |
| `lotteryOccupiedStores`                                                   | 綁 `dealers`                       | 已對應乙類的分店(整個租戶)                                                                                                                         |
| `createLotteryDealer(input)` / `updateLotteryDealer(input)`               | `dealers.create` / `edit`          | 主檔 + 關聯                                                                                                                                        |
| `registerLotteryDealerSignin(input)` / `updateLotteryDealerSignin(input)` | `dealers.edit`                     | 見簽                                                                                                                                               |
| `lotteryDealerContacts(input)` / `lotteryDealerContact(id)`               | 綁 `dealers`                       | 關係人清單(`keyword` 比對姓名、手機、身分證字號;`role`、`status`)/ 單筆                                                                            |
| `createLotteryDealerContact(input)` / `updateLotteryDealerContact(input)` | `dealers.contacts.create` / `edit` | 關係人                                                                                                                                             |

**input 的缺席 / `null`(GQL-06)**:

- 新增:選填欄位缺席與 `null` 同義;兩個批購基準日**有值**才要 `edit-` 權限,`null` 視同缺席。
- 編輯:**缺席 = 不動、`null` = 清空**(落庫 `$set: null`);必填欄位(證號、姓名、狀態、證照兩個日期、身分證字號;關係人的姓名、身分、身分證字號、狀態)送 `null` 視同缺席。關聯清單送 `[]` = 全部解除;`coSalesDealerId` / `storeOrgId` 送 `null` = 解除。兩個批購基準日**只要出現**(含 `null`)就要對應的 `edit-` 權限,否則 `FORBIDDEN` + `reason: FIELD_FORBIDDEN`。
- 日期一律是時點(租戶時區那一天 00:00;admin 以 `lib/base/form-engine/local-day.ts` 換算)。

**輸出**:

- `lastPurchaseBaseDate` / `lastSelfPurchaseBaseDate`:沒有對應的 `show-` 權限時回 `null`(api 不放進回傳物件),前端依權限集決定顯示,不拿值猜權限。
- `lastPurchaseDate` / `lastSelfPurchaseDate`:顯示值(max(基準日, 進貨單));`null` = 無紀錄。`daysSince…` 以租戶時區的今天算。
- `licenseState`:`OK` / `EXPIRING`(30 天內到期,含當天)/ `EXPIRED`。
- 系統資訊(經銷商、關係人都有):`ownerOrgName`(`orgId` 的組織名稱,以租戶的組織樹讀;共用進來的也讀得到)、`createdAt` / `createdBy`、`updatedAt` / `updatedBy`(`baseFieldsPlugin` 的欄位,不查稽核紀錄)。重算批購日只在日期真的變了才寫;修改者 = 讓日期變了的人:經銷商管理觸發的是改基準日的人,進貨單觸發的是送出 / 駁回 / 作廢那張進貨單的人(事後動作的 `actorId`);沒有登入主體的動作(排程等)才是系統身分寫入(修改者清空)。
- `abilities`:**已含權限判斷**(業務模組那一種,GQL-07),前端直接用:`canEdit` = 持有 `dealers.edit`;`canEditLastPurchaseBaseDate` / `canEditLastSelfPurchaseBaseDate` = 甲類且持有對應的 `edit-`。關係人的 `abilities.canEdit` = 持有 `dealers.contacts.edit`。
- `CONFLICT` 的 `extensions.relationships`:`[{ role, dealerId, dealerName, licenseNo, contactId, contactName }]`,`role` 是落庫的小寫值。

正本:`apps/api/src/project/lottery/dealers/dto/`、`models/`、`packages/graphql/src/documents/project/lottery/dealers.graphql`

## admin 頁面

| 頁                            | 內容                                                                                                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 列表(`DealersPage`)           | `PageTabs` 甲類 / 乙類 / 關係人(`?tab=`,篩選在 `?list=`,切分頁清回預設);右上新增鈕跟著分頁換,沒有 `create` 權限不顯示。甲類有快速篩選與三個篩選;甲類、乙類都有「證照到期」欄(`LicenseExpiryTag`,色同詳情頁)與證照快速篩選 / 篩選;三個分頁都有關鍵字搜尋(`keyword`,同步進 `?list=`) |
| 經銷商詳情(`DealerViewPage`)  | 頂部列([← 返回列表] …… [編輯](`abilities.canEdit`),REACT-16)+ 標頭摘要、區塊(檢視時收合;系統資訊 = `SystemInfoFields`,與關係人詳情共用)、詳情分頁(`dealer-detail-tabs.ts` 登記:甲類 見簽紀錄、乙類 共同銷售人)                                                                     |
| 新增 / 編輯(`DealerFormPage`) | 新增頁第一步選類型;區塊 ①經銷商資訊 ②店面(乙類)③牌租(乙類,收合 + 摘要)④基本資訊(編輯頁收合);欄位級權限欄沒有 `show-` 不顯示、沒有 `edit-` 唯讀;移除共同銷售處所的確認框                                                                                                            |
| 關係人詳情 / 新增 / 編輯      | 區塊 ①基本資料 ②聯絡資訊 ③備註 ④系統資訊;詳情列出關聯的經銷商;取消身分的確認框                                                                                                                                                                                                     |

欄位錯誤(新增 / 編輯、關係人、見簽登記):原因寫在欄位正下方 —— 格式錯寫該欄的格式要求(證號 8 碼數字、身分證字號 1 碼英文 + 9 碼數字、長度上限……),api 帶了 `reason` 寫原因(證號重複、人數上限、分店已被對應……);頁面底部只留通用句(REACT-18;`dealer-field-errors.ts`)。

詳情頁的其他分頁由各自的功能追加到 `apps/admin/src/pages/project/lottery/dealers/DealerViewPage/dealer-detail-tabs.ts`:甲類 批購紀錄(進貨單)、乙類 預計要給本數與在店庫存(庫存管理)。

正本:`apps/admin/src/pages/project/lottery/dealers/`

## 錯誤碼

只用通用碼(GQL-04),細分原因放 `extensions.reason`:

| code                | reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FORBIDDEN`         | 無 reason(沒權限 / 沒綁模組);`FIELD_FORBIDDEN`(寫了沒有 `edit-` 權限的欄位級權限欄)                                                                                                                                                                                                                                                                                                                                                                                   |
| `NOT_FOUND`         | 可見範圍外或不存在                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `VALIDATION_FAILED` | 無 reason(格式;`fields` 一次列出);`LICENSE_NO_DUPLICATE`、`NATIONAL_ID_DUPLICATE`、`NOT_FOR_TYPE`、`RENT_DUE_DAY_REQUIRED`、`RENT_START_MONTH_REQUIRED`、`ROLE_LIMIT`、`TRUSTEE_NOT_ALLOWED`、`CONTACT_REPEATED`、`CONTACT_ROLE_MISMATCH`、`CONTACT_DISABLED`、`SELF_RELATION`、`AGENT_REQUIRES_CO_SALES`、`CO_SALES_NOT_CLASS_B`、`DEALER_TERMINATED`、`STORE_OCCUPIED`、`STORE_NOT_BRANCH`、`REFERENCE_NOT_FOUND`、`SIGNIN_DUPLICATE`、`SIGNIN_QUARTER_NOT_STARTED` |
| `CONFLICT`          | `AGENTS_REQUIRE_CO_SALES`、`ROLE_IN_USE`(附 `relationships`)                                                                                                                                                                                                                                                                                                                                                                                                          |

正本:`apps/api/src/project/lottery/dealers/dealers-error.ts`

## 稽核

| 動作                                      | targetType               | before / after                             |
| ----------------------------------------- | ------------------------ | ------------------------------------------ |
| `lottery-dealer.create` / `.edit`         | `lottery_dealer`         | 有變的欄位;兩個批購基準日一律 `[redacted]` |
| `lottery-dealer-contact.create` / `.edit` | `lottery_dealer_contact` | 有變的欄位                                 |
| `lottery-dealer-signin.create` / `.edit`  | `lottery_dealer_signin`  | 年、季、見簽日、備註                       |
| `lottery-relationship.create` / `.delete` | `lottery_relationship`   | `{ type, firstId, secondId, role? }`       |

## 測試

- api:`apps/api/src/project/lottery/dealers/dealers.test.ts`(新增 / 讀取、關聯上限與身分每條一個、共同銷售處所與代理人、解約 / 停用後不能被選、對應分店一對一、欄位級權限四件事、沒有權限、可見範圍)、`dealer-schedule.test.ts`(證照到期與牌租提醒的時間點(注入排程時點)、見簽、側欄計數情境表)
- db-migrator:`apps/db-migrator/seeds/project/dealers.test.ts`(模組宣告、開通時建立的角色)
- admin:`apps/admin/src/pages/project/lottery/dealers/**/*.test.tsx`(按鈕依權限、欄位級權限的顯示 / 唯讀、確認框、見簽登記);假 api `apps/admin/src/test/msw/project/dealers-handlers.ts`

## 使用者說明(help.md)

`apps/admin/src/md/module-help/project/additions/dealers.help.md`

## 平台視角備註

站在根組織的操作者沒有租戶(`tenantId = null`),租戶內唯一與占用的判斷以 `tenantId = null` 為邊界;根組織沒有經銷商提醒。
