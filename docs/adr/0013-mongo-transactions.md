# 引入 Mongo 交易:一個使用者動作 = 一個交易

> 現況說明見 `docs/concepts/data-layer-and-isolation.md`「交易」;寫法見 `docs/standards/api/transactions.md`(TX)。

## 決策

- **一個使用者動作 = 一個交易**:動作裡任何一步失敗,這個動作的所有寫入一起回復。不再為每個多步驟寫入各自設計「條件更新 + 冪等 + 補償 / 分步接續」。
- **所有環境都是 replica set**:正式環境 MongoDB Atlas 本來就是;本機 Docker 的 `mongo` 是單一成員 replica set;api 與 db-migrator 的測試(本機與 CI)由 jest globalSetup 起單一成員 `MongoMemoryReplSet`。CI 不再用 `mongo:7` service container 跑測試。
- **單一入口** `TransactionService.withTransaction(fn)`(`apps/api/src/database/transaction.ts`):沿用 Mongoose 內建的 `connection.transaction`(driver 的 `session.withTransaction`),寫入衝突等暫時性錯誤自動整個重跑,重試前由 Mongoose 重設文件狀態;預設上限 60 秒。已在交易內再呼叫 → 在同一個交易裡執行(沒有獨立回復點)。
- **session 傳遞**:Mongoose 開 `transactionAsyncLocalStorage`,交易內的 Mongoose 操作自動帶 session(專屬 repository 也涵蓋);`BaseRepository` 的讀寫方法另接受選填 `session`,明給 `null` 可刻意在交易外讀寫。租戶保底、資料範圍規則與帶不帶 session 無關,一律照套。交易結束即關閉,晚到的非同步工作不再算在交易內。
- **交易內不得有外部副作用或行程內的非冪等副作用**(寄信、HTTP、GCS、Cloudflare、快取作廢):`afterCommit(cb)` 登記到目前交易,提交成功後依序執行、失敗只記 log;回復則丟棄。對外 adapter 的入口以執行期斷言 `assertOutsideTransaction` 擋下交易內呼叫。資料庫寫入(如 `notifications`)放在交易內;交易內不吞資料庫錯誤,冪等改用先查或 upsert。
- **例外**:
  - **樂觀鎖**(`editVersion` / `version`)保留:它防的是兩人先後編輯時後存蓋掉先存,讀與寫隔了使用者的編輯時間,不是一個交易能涵蓋的範圍。
  - **`apps/db-migrator` 的大批次遷移**:不包成單一交易(受交易的時間與大小上限限制),每批一個交易 + 檢查點續跑(ADR-0002)。

## 理由

- 單節點時代的補救方式每個功能都要重新設計,而且每種設計都有自己的故障窗口要測;交易讓「全部成功或全部沒發生」成為資料層的保證。
- 自動重試會重跑整個 `fn`,外部副作用無法跟著回復也會重複發生,所以只能排到提交之後;交易後動作失敗不回復已提交的資料,與「通知 / 信號盡力而為」一致。
- 用執行期斷言而不是 lint:外部呼叫常隔著好幾層 service,靜態規則看不出呼叫當下是否在交易內;斷言放在 adapter 入口,任何經過它的測試都會失敗。
- 本機、CI 與正式環境同為 replica set,交易相關的行為(回復、重試、上限)在測試就測得到。

## 取捨

- 單一成員 replica set 的啟動比單節點慢幾秒;測試以 globalSetup 整次共用一個,攤平成本。
- 交易有 60 秒上限,動作應在毫秒級;長時間的批次工作不能包成單一交易。
- 本機既有的 Docker volume 換成 replica set 啟動時,資料保留;連線字串要加 `directConnection=true&replicaSet=<Compose 專案名>`(成員位址登記為 `localhost:27017`,容器內外與改過主機埠時都連得到;replica set 以專案名命名,連錯專案直接失敗)。
- `transactionAsyncLocalStorage` 是 mongoose 實例的全域設定;非交易的程式碼不受影響(沒有進行中的交易就不帶 session)。

## 影響

- 新的多步驟寫入一律包進 `withTransaction`,不再新增補償刪除或分步接續。
- 既有的補救機制(開通租戶的補償刪除、表單送出的分步接續等)逐一改成交易;改完前仍照原機制運作。
- 新增對外 adapter(HTTP、Cloudflare 等)時,入口要呼叫 `assertOutsideTransaction`。
