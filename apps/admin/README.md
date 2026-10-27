# @repo/admin

多租戶後台管理(Vite + React,部署成 nginx 靜態站台)。頁面與規則的正本在 `docs/modules/`,
資料流與規範見 `docs/standards/`(前端從 `react/` 與 `testing/testing.md` 看起)。

```
pnpm --filter @repo/admin dev          # http://localhost:3001,連真的 api(VITE_GRAPHQL_ENDPOINT)
pnpm --filter @repo/admin dev:mock     # http://localhost:3002,連 MSW 假 api,不需要帳號
pnpm exec turbo run test --filter=@repo/admin
```

## mock 開發模式(`dev:mock`)

沒有 dev 帳號、也不想連真 api 時用它:跑的是**真的 `App`**(同一組 providers、路由與頁面),
只有網路層被 MSW 的 service worker 接管,夾具就是測試那一批(`src/test/msw/`)。
admin 票的 PR 要附這個模式的截圖,見 `docs/agents/issue-tracker.md`。

- 預設**自動登入 root**、落在總覽;組織 / 使用者 / 角色 / 模組與權限 / 欄位 / 資料範圍都有假資料
- `?view=tenant` 切租戶管理員視角、`?auth=off` 停在登入頁(任何帳密都能登入)
- 專案頁在根組織視角(預設)只顯示「請先切換到要管理的機構」的提示:截圖 / 驗收專案頁請加 `?view=tenant`,或用右上角的當前組織切到機構
- 深層網址與重新整理都可用

檔案:`mock.html`(入口頁)、`src/mock/`(進入點 + worker + 假世界的組裝)、
`mock-public/mockServiceWorker.js`(`msw init` 的產物)、`vite.mock.config.ts`(只有這支設定讀得到它們)。
正式 build 走 `vite.config.ts` + `index.html`,**產物不含 msw**(`grep -c msw dist/assets/*.js` 為 0)。
細節與注意事項見 `docs/standards/testing/testing.md` TEST-08 的「mock 開發模式」。
