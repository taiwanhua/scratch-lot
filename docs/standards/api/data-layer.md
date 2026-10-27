# 資料層(DATA)

現況說明見 `docs/concepts/data-layer-and-isolation.md`;交易相關的規則另見 `transactions.md`(TX)。

## DATA-01 Mongoose 連線與 model 只在資料層取用

`InjectConnection`、`InjectModel`、`MongooseModule`、`getModelToken`、`getConnectionToken` 只能出現在 `src/database/**`、`src/project/database/**`(與 `app.module.ts`)。功能模組(`orgs/`、`forms/`、`project/lottery/` 等)一律注入資料登記導出的出口:repository、專屬 store(例:`SerialCountersStore`、`TenantPurgeStore`)或 `TransactionService`。

```ts
✅ // orgs/demo-tenant-purge.service.ts
   constructor(private readonly store: TenantPurgeStore) {}
❌ // orgs/demo-tenant-purge.service.ts
   constructor(@InjectConnection() private readonly connection: Connection) {}
```

- 需要原生 collection(繞過 BaseRepository 的語意,如原子 `$inc`、整租戶硬刪)時,在 `database/` 寫一個只做那件事的 store,由 `database.module.ts` 提供與匯出;判斷能不能做、交易、審計留在功能模組。store 的每個讀寫自帶交易 session(TX-02)。
- 由 ESLint `no-restricted-imports` 擋下(`apps/api/eslint.config.mjs`),對注入的 Model 直接查詢另由 `@repo/no-raw-model-query` 擋(ADR-0005)。測試檔不在範圍內。

正本:`apps/api/eslint.config.mjs`、`apps/api/src/database/database.module.ts`、`apps/api/src/database/tenant-purge.store.ts`
