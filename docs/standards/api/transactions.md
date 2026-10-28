# 交易用法(TX)

決策見 ADR-0013;現況說明見 `docs/concepts/data-layer-and-isolation.md`「交易」。

## TX-01 一個使用者動作 = 一個 `withTransaction`

多步驟寫入一律包進 `TransactionService.withTransaction(fn)`(`apps/api/src/database/transaction.ts`),不另寫補償刪除、分步接續,也不自己 `startSession` / `connection.transaction`。

```ts
✅ await this.transactions.withTransaction(async (session) => {
     const order = await this.orders.create(operator, input, { session });
     await this.items.updateMany(operator, filter, update, { session });
     return order;
   });
❌ const order = await this.orders.create(operator, input);
   try { await this.items.updateMany(…); } catch { await this.orders.hardDeleteById(…); }
```

- 已在交易內的 service 再呼叫 `withTransaction` 會直接在同一個交易裡執行,**沒有獨立的回復點**:內層拋錯若被外層 `catch` 後繼續,內層已做的寫入會隨外層一起提交。要回復就讓錯誤往外拋,不要在外層吞掉。
- 預設上限 60 秒(`timeoutMs` 可改);動作應在毫秒級,長批次(db-migrator 的大批次遷移)改成每批一個交易 + 檢查點續跑。上限由 `withTransaction` 自己計時:每次嘗試開始前與 `fn` 結束後(提交前)各檢查一次,超過就拋 `TransactionTimeoutError`(`GraphQLError`,`extensions.code = TRANSACTION_TIMEOUT`,前端顯示「處理時間過長、已取消、資料沒有變更」)、整個回復且不再重試;單一操作卡住時由伺服器的 `transactionLifetimeLimitSeconds`(預設 60 秒)中止交易。**不要把 `timeoutMS` 交給 driver 的 `withTransaction`**:mongodb 7.x 會讓交易內游標的 getMore 帶上 `maxTimeMS`、被 server 拒絕,交易內讀超過一批(101 筆)就失敗。連線字串與 MongoClient 也不要設 `timeoutMS`(session 會繼承,交易就會再啟用同一套逾時)。

## TX-02 讀寫預設帶目前交易的 session;原生 collection 自己帶;交易內不平行讀寫

repository 一律把目前交易的 session 明確交給 driver:沒帶 `session`(`undefined`)時用 `currentSession() ?? null`(`apps/api/src/database/transaction.ts`)—— `BaseRepository` 的讀寫方法、專屬 repository(`workflow_tasks`、`business_relationships`)與 `WorkflowSubmissionStore` 都這樣做,所以 service 在 `withTransaction` 裡呼叫 repository 不必逐一傳 `fn` 收到的 `session`。Mongoose 另開了 `transactionAsyncLocalStorage`,其他沒帶 session 的 Mongoose 操作(`save()`、`insertMany`、query)也會自動加入,只是保險。

```ts
✅ await this.transactions.withTransaction(async () => {
     const order = await this.orders.create(operator, input); // 自動帶目前交易的 session
     await this.items.updateMany(operator, filter, update);
   });
✅ // 新的原生 collection 存取:自己帶 currentSession()
   await this.model.collection.updateOne(filter, update, { session: currentSession() });
❌ await this.model.db.collection("orgs").findOne(filter); // 原生 driver 不會自動加入交易
```

- **原生 driver 的 `collection(...)` 存取不會自動加入**:新增這類存取(含專屬 repository / store 裡的)必須自帶 `currentSession()`(或方法收 `SessionOptions`、沒給時用 `currentSession()`)。不在交易內的寫入會在交易回復後留下來,而且寫到交易鎖住的文件時會等到交易結束(看起來像卡住)。
- **交易內不要用 `Promise.all` 平行讀寫**:同一個 session 上的操作要依序 `await`。平行發出時,一個失敗、其他還在跑,錯誤處理與回復的順序無法保證。
- **刻意在交易外讀寫要明給 `{ session: null }`**:例如跨請求共用的快取載入(`DataScopeService` 載入規則),不能讀到某個尚未提交的交易內容,也不能被綁在別人的交易上。
- 租戶保底與資料範圍規則與 session 無關,帶 session 不能放寬任何範圍。

## TX-03 交易內不得有外部或行程內的非冪等副作用;用 `afterCommit`

寄信、HTTP 呼叫、GCS 寫入(複製 / 刪除)、Cloudflare(即時信號),以及**行程內的非冪等副作用**(作廢共用快取、改記憶體狀態、計數)都不能在 `fn` 裡做:自動重試會重跑整個 `fn`,回復也收不回已經發生的副作用(快取作廢得太早,別的請求會在提交前就把舊值重新載入)。改用 `afterCommit(cb)` 登記到目前交易:

```ts
await this.transactions.withTransaction(async (session) => {
  await this.notifications.create(operator, notice, { session }); // 資料庫寫入:交易內
  afterCommit(() => this.mail.sendNotificationEmail(input)); // 外部動作:交易後
  afterCommit(() => this.cache.delete(key)); // 行程內副作用:交易後
});
```

- 交易提交後依登記順序執行;某一個失敗只記 log,不影響其他與已提交的資料。回復(含被自動重試丟掉的那一輪)則不執行。
- `afterCommit` 在回應送出前執行,**會算進請求的回應時間**;慢的外部動作仍要盡力而為、設逾時。
- 交易結束(提交或回復)後,`fn` 裡排出去、晚到的非同步工作不再算在交易內:`afterCommit` 拋錯、`currentSession()` 回 undefined。「結束」以 driver 為準 —— driver 一提交 / 回復(`session.inTransaction()` 轉為 false)就算交易外,不等 `withTransaction` 返回;被自動重試丟掉的那一輪也一樣。不在交易內呼叫 `afterCommit` 會拋錯。
- **防線是執行期斷言**:對外 adapter 的入口呼叫 `assertOutsideTransaction("<動作>")`,在交易內被呼叫就拋錯,經過它的測試必然失敗。現有入口:`MailService` 寄信、`StorageService.deleteObject` / `copyPrivateObject`、`RealtimePublisher.publish` 送出信號(交易內改用 `publishAfterCommit`);**新增對外 adapter 要在入口加上它**。只讀、無副作用的呼叫(簽讀取 / 上傳網址)不加。

## TX-04 交易內不吞資料庫錯誤;冪等改用先查或 upsert

交易內的寫入一旦出錯(重複鍵、驗證失敗、寫入衝突),這個交易就只能回復:`catch` 住之後繼續寫,後面的操作會因交易已中止而失敗,或讓「看起來成功、其實沒寫進去」的結果提交出去;寫入衝突被吞掉時,driver 也就無法自動重試。

```ts
❌ try { await this.permissions.create(operator, row, { session }); }
   catch (error) { if (!isDuplicateKeyError(error)) throw error; } // 「別人已建好」
✅ const existing = await this.permissions.findOne(operator, { key }, { session });
   if (!existing) await this.permissions.create(operator, row, { session });
```

- 需要冪等(重試、重複送出)時,先查再寫,或用 upsert / `$setOnInsert`;並發下的最終裁決交給唯一索引,錯誤往外拋,讓整個交易重試或回報。
- **記錄「這次嘗試失敗了」的稽核不能放在會拋錯的交易內**:交易回復時稽核一起消失。這類紀錄放在交易外(錯誤往外拋之後,在交易外寫)。

## TX-05 交易不取代樂觀鎖

`editVersion` / `version` 的條件更新照舊:它防的是兩個人先後編輯、後存蓋掉先存,讀與寫之間隔著使用者的編輯時間,不在同一個交易裡。

## TX-06 交易內對多筆資料的讀寫要整批做,不逐筆來回

交易內每一次讀寫都是一次資料庫往返,而且依序 `await`(TX-02)。逐筆讀寫時往返數隨筆數成長:本機往返幾乎是 0 毫秒看不出來,雲端每次幾十毫秒,幾百筆就超過 60 秒上限(TX-01),整個動作逾時回復。

```ts
❌ for (const item of items) {
     const row = await this.rows.findOne(operator, { _id: item.id });
     await this.rows.findOneAndUpdate(operator, { _id: item.id, version: row.version }, update);
   }
✅ const rows = await this.rows.findMany(operator, { _id: { $in: ids } });
   const modified = await this.rows.updateMany(
     operator,
     { _id: { $in: ids }, version },
     update,
   );
   if (modified !== ids.length) throw conflictError(); // 筆數不符 = 有幾筆已被別人改
```

- **讀**:一次 `findMany({ _id: { $in } })`(或 `$or` 多組條件),在記憶體裡分組;不在迴圈裡 `findOne` / `count`。
- **條件更新**:條件與要改的欄位都相同的一組一次 `updateMany`,樂觀鎖(TX-05)照樣帶在條件裡;**寫入筆數與這組筆數不符 → 拋衝突**,整個交易回復(不吞掉,TX-04)。
  - 以寫入筆數判衝突時,**更新一定要帶 `$inc` 版本**(或保證每筆的值一定會變):`updateMany` 回的是 `modifiedCount`,符合條件但值沒變的列不算,會被誤判成衝突。
  - 每筆要改的值不同時(例:每一本自己的單價)依值分組,**組數隨值的種類成長**:每多一種值多一次往返。防退化測試要放一組值各不相同的資料,確認多出的次數只等於多出的種類數。
  - 值的種類幾乎和筆數一樣多(例:每筆各自的開始時間)時,改用 `bulkUpdateByIds`:一次 `bulkWrite`,每筆帶自己的值與條件。
- **批次出口**(都在 `BaseRepository` / `AuditService`,**都必須在交易內**,空清單不送指令):

  | 出口                                                   | 用途                                   | 回傳 / 筆數不符時                                                                                                                                                                                                                                                                                |
  | ------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `createMany(operator, docs)`                           | 新增多筆(同組織的租戶推導只查一次)     | 一筆沒過整批不寫                                                                                                                                                                                                                                                                                 |
  | `softDeleteMany(operator, ids)`                        | 軟刪多筆(一次 `updateMany`)            | 有不存在 / 已刪除 / 範圍外的 → 底座直接拋 `CONFLICT`(`writeCountConflictError`,`EDIT_VERSION_MISMATCH`),交易回復、沒有部分提交                                                                                                                                                                   |
  | `bulkUpdateByIds(operator, [{ id, update, filter? }])` | 每筆值不同的條件更新(一次 `bulkWrite`) | 同上(以 `matchedCount` 判,值沒變的列也算命中,不必為了判衝突加 `$inc`)。只收 `$set` / `$unset` / `$inc` / `$push`(單一元素或 `$each`),不收位置運算子、`arrayFilters`、`$pull`;`$set` / `$unset`(必填欄位擋下)/ `$push` 的值照 schema 驗,欄位保護同 `updateById`,加密欄位照樣加密,同批重複 id 拋錯 |
  | `reassignOrgMany(operator, ids, newOrgId)`             | 搬家(全有或全無、一筆稽核)             | 回 `mismatched`                                                                                                                                                                                                                                                                                  |
  | `AuditService.recordMany(operator, inputs)`            | 稽核多筆(一次 `createMany`)            | 每筆與 `record` 同形狀;粒度不變,原本逐筆幾筆就給幾筆。**必須在交易內**(`record` 不用)                                                                                                                                                                                                            |

  ```ts
  ❌ for (const entry of entries) {
       await this.entries.softDeleteById(operator, entry._id);
       await this.audit.record(operator, { action: "x.delete", targetId: entry._id });
     }
  ✅ await this.entries.softDeleteMany(operator, ids); // 筆數不符 → 拋 CONFLICT,整個交易回復
     await this.audit.recordMany(operator, ids.map((targetId) => ({ action: "x.delete", targetId })));
  ```

- **先讀再整批寫回**時,讀取條件併上 `BaseRepository.writableFilterOf(operator)`(寫入範圍:可見範圍 + 資料範圍,不含共用分支):讀得到、寫不到的唯讀共用資料不會讀進來,整批寫回也不會因此筆數不符。
- **同一筆在同一批出現多次**(先 A 再 B 兩個變動):依出現順序分輪,每輪每筆最多一次,往返數只隨輪數成長。
- 迴圈裡呼叫的若是會讀寫資料庫的 service 方法(守門、原因檢查),先依輸入去重,同樣的輸入只呼叫一次。
- **防退化測試數資料庫指令次數,不計時**:`apps/api/src/database/test-support/db-commands.ts` 的 `countDbCommands` 數一段動作送出的指令,`expectDbCommandsAtMost` 斷言上限;上限與筆數無關,同一個動作做 1 筆與多筆,多筆不得比 1 筆多出幾次以上。計時在 CI 上不穩定,本機往返又近乎 0,抓不到逐筆讀寫。

正本:`apps/api/src/database/transaction.ts`、`apps/api/src/database/transaction.test.ts`、`apps/api/src/database/base.repository.ts`、`apps/api/src/database/batch-writes.test.ts`

## TX-07 交易外的列表 / 頁面讀取也整批讀,不逐列查(N+1)

TX-06 管交易內;交易外的讀取一樣是依序往返:列表每一列再各查一次關聯、報表每一筆各查一次明細,往返數隨列數成長,一頁 50 列 × 4 次 × 50 毫秒就是 10 秒;資料隨時間累積的(全部歷史資料、所有組織)會一直變慢,最後撞到請求上限。

```ts
❌ const result = [];
   for (const row of rows) {
     result.push({ ...row, owner: await this.users.findById(operator, row.ownerId) });
   }
   return result;
✅ const owners = await this.users.findMany(operator, {
     _id: { $in: [...new Set(rows.map((row) => String(row.ownerId)))] },
   });
   const ownerOf = new Map(owners.map((owner) => [String(owner._id), owner]));
   return rows.map((row) => ({ ...row, owner: ownerOf.get(String(row.ownerId)) ?? null }));
```

- 依整頁(或整批)的 id 去重後一次 `findMany({ $in })`,在記憶體裡對回每一列。
- 改成 `Promise.all(rows.map(...))` 平行送出也不行:每列仍是一次指令,指令數照樣隨列數成長;一次送出幾十上百個查詢會佔滿連線池,同時間其他請求要排隊,資料庫負載也跟著放大。
- 每列要的是「各組最後一筆 / 最早一筆 / 合計」時,用一次 `aggregate`(`$match` + `$group`),不逐組查。
- 上下文、租戶邊界(`tenantBoundaryContext`,2 次往返)、設定、定義版本這類「同一個值」先建好一次,不在每列重建。
- 筆數會隨時間無上限成長的掃描(例:全部已完成的資料),除了批次讀,還要先用條件或索引縮到「還需要看的」那些。
- 防退化測試同 TX-06:`countDbCommands` 數 1 列與一整頁,指令數相同。
