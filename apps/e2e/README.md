# @repo/e2e — 權限劇本的 E2E

`docs/testing/permission-scenarios.md` 的 29 條劇本,逐條改成 Playwright spec。
**只在手動觸發時跑**(本機 `pnpm e2e`、CI 的 `.github/workflows/e2e.yml`),不進每個 PR 的 CI ——
理由與寫法規範見 `docs/standards/testing/testing.md` 的 TEST-05 與 TEST-11。

## 怎麼跑

```bash
pnpm --filter @repo/e2e e2e:browser   # 第一次:只裝 chromium
pnpm e2e                              # 全部劇本
E2E_GREP="劇本 7" pnpm e2e            # 只跑某一條(`--` 之後的旗標穿不過 `pnpm --filter`)
```

`pnpm e2e` 會自己做完這一串,不需要事先起任何東西:

1. `turbo run build --filter=@repo/api --filter=@repo/admin`
   (admin 的 api 端點是 build 時烘進 bundle 的,所以埠一改就要重建)
2. 起 Mongo:沒給 `E2E_MONGODB_URI` 就用 `mongodb-memory-server`
3. `pnpm --filter @repo/db-migrator run update`(`ROOT_ADMIN_*` 用測試值)
4. 起 fake GCS(有 Docker 才起,見下一節)
5. 起 api(`node apps/api/dist/main.js`,子行程;stdout 導到 `.tmp/api.log`)
6. 起 admin(`vite preview` 的程式介面,吃 `apps/admin/dist` 的靜態檔)

跑完 `globalTeardown` 會把它們收掉。報告在 `playwright-report/`(失敗時附 trace 與截圖)。

Windows 的 PowerShell 沒有 `VAR=… 指令` 這種前綴,寫成 `$env:E2E_GREP="劇本 7"; pnpm e2e`(agent 在 worktree 裡用 Bash 下前綴也會被守衛擋)。

本機反覆跑同一條時,`E2E_SKIP_BUILD=1` 省掉重建;接在自己手動起好的 stack 上除錯用 `E2E_SKIP_STACK=1`。
變數清單見 `.env.example`。同機不同專案要分開 DB、各服務 port、bucket 與 `E2E_COMPOSE_PROJECT`;fake GCS 起停均以 `-p` 指定後者,不沿用 shell 的 `COMPOSE_PROJECT_NAME`。

## 檔案儲存:fake GCS 容器(劇本 11 / 15)

劇本 11(封面公開 URL / 附件簽名下載)與 15(側欄商標繼承)要**真的**把檔案傳上去再讀回來,
所以 harness 用 **Docker Compose** 起 [`fsouza/fake-gcs-server`](https://github.com/fsouza/fake-gcs-server)
(`docker-compose.yml`,版本釘死;選 compose 不選 testcontainers:少一個依賴,CI 與本機同一份檔):

- **本機要跑這兩條:開著 Docker Desktop** 即可,不必自己 `docker compose up` —— harness 會
  `up -d`、以 JSON API 建兩個 bucket(`E2E_GCS_BUCKET_PUBLIC` / `E2E_GCS_BUCKET_PRIVATE`)、
  跑完 `down`(資料放記憶體,容器一收就沒了)。埠預設 4443(`E2E_GCS_PORT`)。
- **本機沒有 Docker(或沒開)**:log 會印一行「找不到可用的 Docker(…):劇本 11 / 15 本輪 skip,其餘照跑」,
  那兩條以 `test.skip` 跳過(原因寫在報告的 skip 說明裡),api 維持記錄用 adapter,其餘劇本不受影響。
- **CI**(`e2e.yml`)設 `E2E_GCS_REQUIRED=1`:起不來就整個失敗,不會變成「兩條 skip、其餘全綠」。
- api 端以 `GCS_API_ENDPOINT` 指到容器、用**假憑證**簽 V4 網址(`apps/api/src/storage/`,
  `docs/env-registry.md`「只在測試用的」)。私鑰預設由 harness 每次現產,repo 裡不放任何金鑰。
- fake GCS **不驗簽章、不分公開 / 私有**:spec 驗的是「api 發了哪個 bucket、有沒有簽名、效期多長」
  與「讀回來的內容就是剛才傳上去的檔」;簽名網址**過期後失效**是真 GCS 的行為,仍屬 dev 的人工驗收。

上傳用的測試檔在 `fixtures/assets/`(幾十 bytes 的 PNG 與 PDF;兩張商標圖顏色不同,
劇本 15 靠讀回來的內容分辨側欄顯示的是哪一張)。

## 檔案怎麼分

```
apps/e2e/
├── playwright.config.ts      只裝 chromium、workers=1、globalSetup / globalTeardown
├── docker-compose.yml        fake GCS 容器(harness 自己 up / down)
├── fixtures/assets/          上傳用的測試檔(劇本 11 / 15)
└── src/
    ├── config.ts             埠 / 主機 / 測試帳密(全部走環境變數,預設值在這裡)
    ├── harness/              起 stack 與收 stack(process.ts 是 spawn / 等待的小工具;fake-gcs.ts 管容器)
    ├── fixtures/             前置資料(全部走 api)、共用的畫面定位與登入
    └── specs/                一條劇本一個 spec:scenario-<兩位數>-<主題>.spec.ts
```

## 三條約定(TEST-11)

- **前置走 api,UI 只走要驗的那一段**:開通租戶、建組織 / 使用者 / 角色、調權限矩陣、建業務資料
  一律用 GraphQL(`fixtures/api.ts`);畫面只負責跑劇本的「預期」在講的那幾步。
- **一條劇本一個租戶**:租戶是產品本身的隔離邊界(ADR-0005),`tenant` fixture 每次開一個新的,
  名稱帶隨機字尾;所以同一個資料庫上重跑、或之後放大平行度都不會互相污染。
- **一條劇本一個 spec**,檔名帶劇本編號;spec 的註解指回 `permission-scenarios.md` 的那一條,
  步驟註解照文件的步驟編號寫,對不上時以文件為準。
