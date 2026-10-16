# 印表機管理與列印(技術)

## 用途

店內收據機(58mm、ESC/POS、網路版)的列印。雲端連不進店內網路,所以由裝在分店電腦上的**代理程式**(`apps/print-agent`)主動向 API 拿**列印工作**:

```
任何裝置 [列印] → 瀏覽器把單據轉成寬 384 點的黑白 PNG → API 建立 print_job
→ 交易後送出 print-agent:<代理程式> 的 print-job 信號
→ 代理程式認領 → 拿圖片 → ESC/POS → TCP 9100 → 收據機
→ 代理程式回報 已印 / 失敗 → API 送出 user:<要求人> 的 print-result
```

即時通道故障時,代理程式每 60 秒輪詢一次;信號與輪詢同時到也只會印一次(見「認領」)。

本文件寫 api 端:資料、配對、代理程式 API、下載、權限;後台頁面見「admin 頁面」節。

正本:`apps/api/src/printing/`、`packages/domain/src/printing/`

## 模組 key 與權限表

| key               | 名稱       | sidebarType | 路由               | 說明                                                            |
| ----------------- | ---------- | ----------- | ------------------ | --------------------------------------------------------------- |
| `system.printers` | 印表機管理 | link        | `/system/printers` | 系統管理群組最後一項(8 項 → 通知設定 → 印表機管理);圖示 `print` |
| `api.printing`    | 列印       | hidden      | 無                 | 純 API 權限容器(`api` 樹,ADR-0004):各單據的列印按鈕             |

| 權限 key                 | 它是什麼                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `system.printers.view`   | 看印表機、代理程式、列印紀錄三個分頁(`printers` / `printAgents` / `printJobs`)      |
| `system.printers.create` | 新增代理程式、新增印表機、下載安裝檔(`printAgentRelease` / `printAgentDownloadUrl`) |
| `system.printers.edit`   | 編輯印表機、停用印表機 / 代理程式、重新配對、測試列印                               |
| `api.printing.print`     | 列印(`createPrintJob`、`printablePrinters`、`documentPrintCount`)                   |
| `api.printing.reprint`   | 補印(`createPrintJob` 帶 `isReprint: true` 時另要它,由 service 判)                  |

沒有收據機的租戶不授予 `api.printing.*`,列印按鈕就不顯示。

- **主要入口是開通租戶**:開通時的權限選擇不勾 `api.printing`(租戶管理員副本就不含列印);之後要加再由根組織調整。
- 租戶管理員**模板**照模板規則含這兩個模組(新模組自動納入);**既有租戶的副本不會自動拿到**(ADR-0009),要用的既有租戶由根組織替它的角色加上。

正本:`apps/db-migrator/seeds/base/modules/system.ts`(`PRINTERS_KEY`)、`apps/db-migrator/seeds/base/modules/api.ts`(`API_PRINTING_KEY`)

## 資料

三張模組資料表(`moduleData`,`moduleKey = system.printers`),都掛在分店(`orgId`)上:

- **`print_agents`**:`name`、`keyHash`、`pairingCodeHash` + `pairingExpiresAt`、`lastSeenAt`、`version`、`enabled`。金鑰與配對碼**只存雜湊**(SHA-256;兩者都是伺服器產生的高熵亂數,不需要慢雜湊)。
- **`printers`**:`agentId`、`name`、`host`、`port`(預設 9100)、`paperWidth`(58)、`isDefault`、`enabled`、`status` + `statusAt`。**印表機只記到分店層**,分店 = 代理程式的分店;專案要「收銀點的印表機」自己加欄位。
- **`print_jobs`**:`printerId`、`agentId`(建立時的快照,信號送給它)、`documentType`、`refType` + `refId`、`documentName`(單據顯示名稱,列印失敗通知用;選填)、`image`(PNG,預設查詢不帶)、`status`、`error`、`isReprint`、`printNo`、`reprintReason`、`reprintNote`、`requestedBy`、`sentAt`、`printedAt`。
- 補印原因存欄位管理的系統類別 `reprint-reason` 的選項值(底座 seed:`lost` 遺失、`damaged` 破損、`other` 其他;租戶可加自訂選項)。

欄位與索引見 `docs/data-model.md`「列印」;刪組織 / 撤銷開通的前置檢查含這三張表。

正本:`apps/api/src/database/schemas/print-agent.schema.ts`、`printer.schema.ts`、`print-job.schema.ts`

## 規則

### 列印只走代理程式,不讓網站當接收端

**規則**:列印一律是「瀏覽器 → API 建立工作 → 代理程式拿工作 → 收據機」;同一台電腦按 [列印] 也走雲端。不做瀏覽器直連本機代理程式、不讓網站(瀏覽器分頁)當列印的接收端,也不做 WebUSB 列印。

**理由**:

- 網站是 HTTPS,本機代理程式是 HTTP;瀏覽器對「公開網站連本地網路」的限制(混合內容、Private Network Access)一直在收緊,直連容易某天失效,店家無從排除。
- 平板、手機沒辦法直連收據機;走同一條雲端路徑,任何裝置都能印,行為一致,約一秒內。
- 網站分頁關掉、電腦換人用就收不到;代理程式以服務執行、開機自動啟動,不受瀏覽器狀態影響。
- 認領、逾時、補印次數、權限都在 API 一處判斷;接收端只有代理程式一種,不必維護第二條路徑。

### 配對

1. [新增代理程式](`createPrintAgent`):選分店、名稱 → 回 **8 碼配對碼**(10 分鐘,只回這一次)。伺服器網址由後台以自己打的 API origin 顯示(與 GraphQL 同一台,不另設環境變數)。
2. 代理程式 `POST /print-agent/pair { code }` → 長期**代理程式金鑰**(只回這一次)。配對是一次條件更新:「配對碼雜湊相符、未過期、代理程式啟用中」才命中,同時清掉配對碼。**過期、用過、不對一律 401**(不透露差別)。
3. 每個帶金鑰的請求都以雜湊查啟用中的代理程式,查到即記 `lastSeenAt`:**撤銷立即生效**。
4. 代理程式的資料層上下文 = 可見範圍只有自己的分店(`agentOperator`),再加上「工作的 `agentId` = 自己」:**金鑰只能領自己分店的工作**。

### 認領、回報

- 拿工作(`GET /print-agent/jobs`)只列**自己的、等待中、2 分鐘內**的工作;逾時的先標失敗。
- **認領**(`POST .../claim`)是條件更新「自己的、等待中、2 分鐘內 → 已送出」:信號與輪詢同時到(或兩個請求同時到)只有一個 200,其餘 409。認領成功才印。
- 圖片(`GET .../image`)只給已送出、自己認領的工作。
- **回報**(`POST .../result`)只能從已送出轉成已印 / 失敗,轉完對要求人送 `print-result`;重複回報、或已送出超過 2 分鐘才回報,都是 409(後者先標失敗 `no-result`,不管有沒有人先讀過)。

### 離線、逾時、重新配對與停用

離線判斷與工作逾時都是 **2 分鐘**(`@repo/domain/printing` 的 `PRINT_AGENT_OFFLINE_AFTER_MS` / `PRINT_JOB_CLAIM_TIMEOUT_MS`)。

| 情況                                  | 結果                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 代理程式 2 分鐘內輪詢 / 心跳過        | 已連線。連著即時通道時靠每 60 秒的心跳(`POST /print-agent/heartbeat`)維持 `lastSeenAt`                                          |
| `lastSeenAt` 超過 2 分鐘              | 離線(`PrintAgent.online = false`、`Printer.agentOnline = false`)                                                                |
| 送出列印時代理程式已離線              | 仍建立工作,但直接標失敗 `AGENT_OFFLINE`,不送 `print-job`;按鈕依回傳立即顯示「✗ 失敗:代理程式離線」                              |
| 工作「等待中」超過 2 分鐘沒有被認領   | 標失敗 `AGENT_OFFLINE`,送 `print-result`                                                                                        |
| 工作「已送出」超過 2 分鐘沒有回報結果 | 標失敗 `NO_RESULT`(「未收到列印結果」,與代理程式離線分開:可能已經出紙),送 `print-result`;之後的回報 409                         |
| 代理程式啟動時拉到超過 2 分鐘的舊工作 | 不在清單、認領 409(已經標失敗)                                                                                                  |
| [重新配對](`resetPrintAgentPairing`)  | 清掉金鑰(舊金鑰立即 401)、產生新配對碼(10 分鐘);印表機設定保留                                                                  |
| [停用](`disablePrintAgent`)           | 金鑰與配對碼失效、旗下印表機在列印按鈕上不可選、等待中與已送出(還沒回報)的工作直接標失敗 `AGENT_DISABLED` 並各送 `print-result` |

- **逾時在哪裡判斷**(等待中與已送出兩種逾時相同):讀取時順手判斷(代理程式拿工作 / 認領、`printJob`、`printJobs`),另有排程工作 `printing.expire-stale-jobs` 每 15 分鐘補掃(沒有人讀的工作)。列印按鈕送出後 2 分鐘還沒收到 `print-result`,查一次 `printJob` 就會拿到逾時結果。 排程的兩段(逾時工作、離線代理程式)各自 try/catch,一段失敗另一段照跑;單筆失敗只記 log、繼續下一筆。
- **代理程式清單**:`printAgents` 預設只列啟用中的;`includeDisabled: true` 才連已停用的一起列(畫面的「顯示已停用」開關)。
- **停用是終態**(紀錄不刪,列印紀錄要對得上是哪一台):已停用的代理程式不能重新配對(`CONFLICT`,`reason AGENT_DISABLED`);要再用就新增代理程式,把印表機改掛過去(`updatePrinter` 的 `agentId`,限同分店)。

### 列印工作

- `documentName`(選填):單據的顯示名稱,只用在列印失敗通知;沒給時通知顯示「單據類型 + 編號」。測試頁不存,通知依收件人語言顯示「測試頁 <印表機名稱>」。

- 圖片:PNG、寬度 = 紙寬點數(58mm = 384 點)、上限 512KB(`PRINT_IMAGE_MAX_BYTES`);base64 放在 GraphQL input(可帶 `data:image/png;base64,` 前綴)。api 的 JSON body 上限因此調為 1MB(`apps/api/src/main.ts`)。
- `printNo` = 建立當下這張單據(`refType` + `refId`)**已印**的次數 + 1;失敗、等待中不算。
- 補印:`reprintReason` 必填且須是 `reprint-reason` 類別裡看得到的啟用選項;選 `other` 時 `reprintNote` 必填。非補印時兩欄一律寫 null(送了也忽略)。
- 測試列印(`printPrinterTestPage`):`documentType = printer-test-page`、`refType = printer`、`refId` = 印表機 id;守 `system.printers.edit`,不要 `api.printing.print`。

### 通知

兩種通知類型登記在 `apps/api/src/notifications/base-notification-types.ts`(範本參數以它為準),由 `PrintingNotifier` 觸發:

| 類型                     | 何時                                                                                                               | 收件人                                                                     | `dedupeKey`                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------- |
| `printing.job-failed`    | 工作標失敗:代理程式回報失敗、等待中逾時、已送出逾時(未收到列印結果)、代理程式停用、送出時代理程式已離線;已印不通知 | 要求人                                                                     | `printing.job-failed:<工作 id>`                     |
| `printing.agent-offline` | 已配對、啟用中的代理程式 `lastSeenAt` 超過 2 分鐘:排程每 15 分鐘掃一次,送出列印時遇到離線也順手觸發                | 照通知設定;預設持有 `system.printers.edit`,組織範圍 = 代理程式的分店含上層 | `printing.agent-offline:<代理程式 id>:<lastSeenAt>` |

- 「標失敗 + 通知」同一個交易(`notify()` 併進呼叫端的交易),`print-result` 照 `publishAfterCommit` 在提交後送;回復就沒有通知也沒有信號。
- 失敗原因在範本裡換成各語言的一句話(缺紙、代理程式離線…)。
- 離線提醒的 `dedupeKey` 帶 `lastSeenAt`:同一次離線只通知一次;重新上線(`lastSeenAt` 前進)後再離線是新的一次。送出列印時觸發的離線提醒盡力而為,失敗只記 log,不影響已建立的工作。

## api 介面

### GraphQL(後台)

形式見 GQL-02 / GQL-03。

| 端點                                                                        | 權限                                     | 說明                                                                                                       |
| --------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `printAgents(input: PrintAgentsInput!): PrintAgentsPayload!`                | `system.printers.view`                   | `orgId?`、`includeDisabled?`(預設 false = 只列啟用中的)+ 分頁                                              |
| `createPrintAgent(input: { orgId, name }): PrintAgentPairingPayload!`       | `system.printers.create`                 | 回 `agent` + `pairingCode` + `pairingExpiresAt`;分店須在可見範圍內                                         |
| `resetPrintAgentPairing(input: { id }): PrintAgentPairingPayload!`          | `system.printers.edit`                   | 重新配對                                                                                                   |
| `disablePrintAgent(input: { id }): PrintAgentPayload!`                      | `system.printers.edit`                   | 停用                                                                                                       |
| `printers(input: PrintersInput!): PrintersPayload!`                         | `system.printers.view`                   | `orgId?`、`agentId?`、`enabled?`、`keyword?`(名稱 / 主機)+ 分頁                                            |
| `createPrinter(input: CreatePrinterInput!): PrinterPayload!`                | `system.printers.create`                 | `agentId`(須啟用中,否則 `agentId INVALID`)、`name`、`host`、`port?`(9100)、`paperWidth?`(58)、`isDefault?` |
| `updatePrinter(input: UpdatePrinterInput!): PrinterPayload!`                | `system.printers.edit`                   | `id` + `agentId?` / `name?` / `host?` / `port?` / `isDefault?`                                             |
| `setPrinterEnabled(input: { id, enabled }): PrinterPayload!`                | `system.printers.edit`                   | 停用 / 啟用印表機                                                                                          |
| `printPrinterTestPage(input: { printerId, image }): PrintJobPayload!`       | `system.printers.edit`                   | 測試列印                                                                                                   |
| `printAgentRelease: PrintAgentReleasePayload!`                              | `system.printers.create`                 | 下載區:`latestVersion`(還沒發布為 null)+ `files`                                                           |
| `printAgentDownloadUrl(input: { platform }): PrintAgentDownloadUrlPayload!` | `system.printers.create`                 | 最新版本該平台的下載網址(1 小時);沒有 → `NOT_FOUND`                                                        |
| `printablePrinters(orgId: ID!): PrintablePrintersPayload!`                  | `api.printing.print`                     | 列印按鈕的選單:這家分店可選的印表機 + `defaultPrinterId`;不分頁                                            |
| `documentPrintCount(input: { refType, refId }): DocumentPrintCountPayload!` | `api.printing.print`                     | `printedCount`(> 0 時按鈕變 [補印])                                                                        |
| `createPrintJob(input: CreatePrintJobInput!): PrintJobPayload!`             | `api.printing.print`(補印另要 `reprint`) | 建立工作                                                                                                   |
| `printJob(id: ID!): PrintJobPayload!`                                       | 要求人本人,或 `system.printers.view`     | 收到 `print-result` 後查結果;其餘 `NOT_FOUND`                                                              |
| `printJobs(input: PrintJobsInput!): PrintJobsPayload!`                      | `system.printers.view`                   | 列印紀錄,新到舊:`orgId?`、`printerId?`、`status?`、`refType?` + `refId?`                                   |

欄位語意:

- **input 的缺席 / null**(GQL-06):`updatePrinter` 的可選欄位缺席或 null 都是「不動」(沒有可清空的欄位);`createPrinter` 的 `port` / `paperWidth` / `isDefault` 缺席或 null = 預設值;`createPrintJob` 的 `isReprint` 缺席或 null = false,非補印時 `reprintReason` / `reprintNote` 不論給什麼都寫 null。
- `PrintAgent.paired`:有有效金鑰。`pairingExpiresAt`:有等待中的配對碼時的到期時間(配對碼本身只在產生時回一次)。`online`:啟用且 `lastSeenAt` 在 2 分鐘內。`updateAvailable`:版本比 manifest 的最新版本舊(讀不到 manifest、版本不認得時 false)。
- `Printer.available`:印表機啟用且代理程式啟用(**離線仍可選**,送出時立即失敗)。`agentOnline`:代理程式已連線。
- `PrintJob.requestedBy`:查不到使用者時 null。`error` 只在 `FAILED` 時有值。
- 圖片不經 GraphQL 回傳。
- 本模組不回 `abilities`:按鈕顯示依前端自己的權限集(`usePermissions`)。

operation 文件:`packages/graphql/src/documents/base/printing.graphql`。

### 代理程式 HTTP

路徑與 body 形狀的正本是 `@repo/domain/printing` 的 `PRINT_AGENT_API_PATHS` 與型別;伺服器網址 = API origin。除了配對,都帶 `Authorization: Bearer <代理程式金鑰>`。

| 方法與路徑                          | 說明                                                                                                                     | 失敗                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `POST /print-agent/pair`            | `{ code, version? }` → `{ agentId, key, name }`                                                                          | 401:配對碼不對 / 過期 / 用過                   |
| `GET /print-agent/jobs`             | `{ printers: [{ id, name, host, port, paperWidth, enabled }], jobs: [{ id, printerId, createdAt }] }`                    | 401                                            |
| `POST /print-agent/jobs/:id/claim`  | `{ job, printer }`                                                                                                       | 409:別人已認領 / 逾時 / 不是自己的或不是等待中 |
| `GET /print-agent/jobs/:id/image`   | `image/png`                                                                                                              | 404:不是自己認領的已送出工作                   |
| `POST /print-agent/jobs/:id/result` | `{ status: "printed" \| "failed", error? }` → 204;`error` 為 `paper-out` / `printer-offline` / `other`(不認得歸 `other`) | 400 body 不對;409 不是已送出                   |
| `POST /print-agent/realtime-ticket` | `{ ticket, connectUrl, expiresAt }`(只含 `print-agent:<自己>`;即時通道停用時三個 null)                                   | 401                                            |
| `POST /print-agent/heartbeat`       | `{ version, printers?: [{ id, status }] }` → 204;只更新自己名下的印表機                                                  | 401                                            |

每個帶金鑰的請求都算一次「看到代理程式」;代理程式每 60 秒送一次心跳(`PRINT_AGENT_HEARTBEAT_INTERVAL_MS`)。

正本:`apps/api/src/printing/print-agent.controller.ts`、`print-agent-auth.guard.ts`

### 信號

| 信號           | 頻道                     | 何時                                                                 |
| -------------- | ------------------------ | -------------------------------------------------------------------- |
| `print-job`    | `print-agent:<代理程式>` | 建立「等待中」的工作,交易提交後(`publishAfterCommit`);`id` = 工作 id |
| `print-result` | `user:<要求人>`          | 已印 / 失敗(回報、逾時、停用);`id` = 工作 id                         |

## 下載

1. 發布 workflow 把四個平台的壓縮檔放進私有 bucket 的 `print-agent/<版本>/`,並寫 `print-agent/manifest.json`(格式正本:`@repo/domain/printing` 的 `PrintAgentManifest` / `parsePrintAgentManifest`):

   ```json
   {
     "latest": "1.2.0",
     "releases": [
       {
         "version": "1.2.0",
         "publishedAt": "2026-10-17T00:00:00.000Z",
         "files": [
           {
             "platform": "windows-x64",
             "name": "print-agent-windows-x64.zip",
             "sha256": "<64 位 hex>",
             "size": 123
           }
         ]
       }
     ]
   }
   ```

2. API 以既有檔案服務讀 manifest(`StorageService.readReleaseObject`,只收 `print-agent/` 前綴),按下載時簽 **1 小時**的讀取網址(`releaseDownloadUrlOf`)。manifest 在記憶體快取 60 秒(代理程式清單比版本用);按下載一律重讀。
3. manifest 讀不到或格式不對 → 當作還沒發布(清單照常、`updateAvailable` 全 false、下載 `NOT_FOUND`)。

## 錯誤

不新增 code(GQL-04):

| code                | 什麼情況                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FORBIDDEN`         | 缺端點的權限;補印缺 `api.printing.reprint`                                                                                                                                         |
| `NOT_FOUND`         | 代理程式 / 印表機 / 工作在可見範圍外或不存在;`printJob` 不是要求人也沒有 `view`;安裝檔沒有該平台                                                                                   |
| `VALIDATION_FAILED` | `fields` + `fieldErrors: [{ fieldKey, code, message }]`;`code`:`REQUIRED`、`INVALID`、`PRINTER_UNAVAILABLE`(印表機或它的代理程式已停用)、`INVALID_IMAGE`(不是 PNG、寬度不對、太大) |
| `CONFLICT`          | `reason AGENT_DISABLED`:重新配對已停用的代理程式                                                                                                                                   |

正本:`apps/api/src/printing/printing-error.ts`

## 稽核

`print-agent.create` / `.reset-pairing` / `.disable`(`targetType` `print_agent`)、`printer.create` / `.edit` / `.toggle-enabled`(`targetType` `printer`)。列印工作本身就是紀錄,不另寫稽核;代理程式的 HTTP 端點沒有操作者,不寫稽核。

## 測試

- api:`apps/api/src/printing/print-agent.test.ts`(配對、認領競爭、分店隔離、撤銷、離線 / 逾時 / 重新配對 / 停用表每列一個)、`print-jobs.test.ts`(建立權限、補印表的 API 列、權限表的 API 列、預設印表機、下載);夾具 `test-support/printing-fixtures.ts`。
- 共用契約:`packages/domain/src/printing/printing.test.ts`;代理程式訂閱憑證:`apps/api/src/realtime/realtime-ticket.service.test.ts`。

## admin 頁面

後台的印表機管理頁(`system.printers`)與列印按鈕元件尚未實作;目前只有 api 與 operation 文件。
