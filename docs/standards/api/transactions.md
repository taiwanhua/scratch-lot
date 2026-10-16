# 交易用法(TX)

決策見 ADR-0013;現況說明見 `docs/concepts/data-layer-and-isolation.md`「交易」。

## TX-01 一個使用者動作 = 一個 `withTransaction`

多步驟寫入一律包進 `TransactionService.withTransaction(fn)`(`apps/api/src/database/transaction.ts`),不另寫補償刪除、分步接續或自己 `startSession`。

```ts
✅ await this.transactions.withTransaction(async (session) => {
     const order = await this.orders.create(operator, input, { session });
     await this.items.updateMany(operator, filter, update, { session });
     return order;
   });
❌ const order = await this.orders.create(operator, input);
   try { await this.items.updateMany(…); } catch { await this.orders.hardDeleteById(…); }
```

- 已在交易內的 service 再呼叫 `withTransaction` 會加入同一個交易;被呼叫的 service 不必知道自己是不是外層。
- 預設上限 60 秒;動作應在毫秒級,長批次(db-migrator 的大批次遷移)改成每批一個交易 + 檢查點續跑。

## TX-02 session 傳給每一個讀寫

`fn` 收到的 `session` 傳給每一個 repository 呼叫(`{ session }`,`BaseRepository` 的讀寫方法都有這個選填參數)。`BaseRepository` 沒帶時會自動用目前交易的 session,但專屬 repository(`WorkflowsRepository`、`RelationService`…)與原生 collection 存取不會 —— 明確傳是規則,自動加入只是保險。

- 不在交易內的寫入會在交易回復後留下來,而且寫到交易鎖住的文件時會等到交易結束(看起來像卡住)。
- 租戶保底與資料範圍規則與 session 無關,帶 session 不能放寬任何範圍。

## TX-03 交易內不得有外部副作用;用 `afterCommit`

寄信、HTTP 呼叫、GCS 寫入(複製 / 刪除)、Cloudflare(即時信號)都不能在 `fn` 裡做:自動重試會重跑整個 `fn`,回復也收不回已經發生的副作用。改用 `afterCommit(cb)` 登記到目前交易:

```ts
await this.transactions.withTransaction(async (session) => {
  await this.notifications.create(operator, notice, { session }); // 資料庫寫入:交易內
  afterCommit(() => this.mail.sendWorkflowTaskEmail(input)); // 外部動作:交易後
});
```

- 交易提交後依登記順序執行;某一個失敗只記 log,不影響其他與已提交的資料。回復(含被自動重試丟掉的那一輪)則不執行。
- 不在交易內呼叫 `afterCommit` 會拋錯。
- **防線是執行期斷言**:對外 adapter 的入口呼叫 `assertOutsideTransaction("<動作>")`,在交易內被呼叫就拋錯,經過它的測試必然失敗。現有入口:`MailService` 寄信、`StorageService.deleteObject` / `copyPrivateObject`;**新增對外 adapter 要在入口加上它**。只讀、無副作用的呼叫(簽讀取 / 上傳網址)不加。

## TX-04 交易不取代樂觀鎖

`editVersion` / `version` 的條件更新照舊:它防的是兩個人先後編輯、後存蓋掉先存,讀與寫之間隔著使用者的編輯時間,不在同一個交易裡。

正本:`apps/api/src/database/transaction.ts`、`apps/api/src/database/transaction.test.ts`、`apps/api/src/database/base.repository.ts`
