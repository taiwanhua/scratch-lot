# 檔案儲存與交易信件(現況說明)

回答「檔案放哪、怎麼上傳與讀取、信怎麼寄」。決策理由見 ADR-0010。環境變數見 `docs/env-registry.md`。

## 兩個 bucket

| bucket               | 讀取   | 用途                                        |
| -------------------- | ------ | ------------------------------------------- |
| `GCS_BUCKET_PRIVATE` | 私有   | 預設;登入後才看的檔(商標、附件、表單上傳欄) |
| `GCS_BUCKET_PUBLIC`  | 公開讀 | 要 CDN、SEO、og:image 或給未登入者看的檔    |

- 放哪一顆由**用途(`purpose`)**決定,不另給參數。
- bucket 名稱由 `GCS_BUCKET_PRIVATE` / `GCS_BUCKET_PUBLIC` 設定。沒設私有 bucket → 改用記錄用 adapter(網址是假的,檔案不會真的上傳)。
- 簽名走執行身分的 IAM signBlob,沒有金鑰檔。

正本:`apps/api/src/storage/storage.config.ts`、`apps/api/src/storage/storage.module.ts`、`apps/api/src/storage/gcs-storage.service.ts`

## 用途表

每個用途在三張表各一行,key 是同一組 `UploadPurpose`:

| 用途              | bucket | 前綴        | 檔型                                       | 上限 | 誰能要上傳票                                         |
| ----------------- | ------ | ----------- | ------------------------------------------ | ---- | ---------------------------------------------------- |
| `ORG_LOGO`        | 私有   | `org-logos` | png / jpg / webp                           | 2MB  | `system.org-manager.edit` 或 `…tenant-ops.provision` |
| `DEMO_COVER`      | 公開   | `demo`      | png / jpg / webp                           | 2MB  | `demo.sub.sample-one.create` 或 `.edit`              |
| `DEMO_ATTACHMENT` | 私有   | `demo`      | 圖片 + pdf / doc / docx / xls / xlsx / zip | 20MB | 同上                                                 |
| `FORM_ATTACHMENT` | 私有   | `form`      | 同 `DEMO_ATTACHMENT`                       | 20MB | 任一表單模組(`engine = form`)的 `create` 或 `edit`   |

- 三張表:`UPLOAD_VISIBILITIES`(bucket)、`UPLOAD_PATH_PREFIXES`(前綴)、`UPLOAD_RULES`(檔型與上限)。
- 誰能要上傳票:`storage.resolver.ts` 的 `PURPOSE_PERMISSIONS`;表單模組是執行期才有的,`FORM_ATTACHMENT` 改由 resolver 掃操作者的 `me.modules` 判斷。
- 新模組要存檔:登記一個 purpose,四處各補一行。不碰基建。

正本:`apps/api/src/storage/upload-rules.ts`、`apps/api/src/storage/storage.resolver.ts`

## 上傳流程

```
前端 ──createUploadUrl(purpose, contentType, size)──▶ api
       api:驗權限 → 驗檔型 / 大小 → 產 <前綴>/<uuid>.<副檔名> → 簽 V4 上傳網址(10 分鐘)
前端 ──PUT 檔案──▶ GCS(不經過 api)
前端 ──儲存表單(帶 objectPath)──▶ api
       api:isOwnedUploadPath(objectPath) 通過才寫進資料欄位
```

- 不合規 → `UPLOAD_REJECTED`。
- 路徑不放 orgId / userId(簽票時組織可能還不存在,如開通租戶的商標)。
- 歸屬靠兩件事:寫入端的權限,與 `isOwnedUploadPath`。

正本:`apps/api/src/storage/storage.service.ts` 的 `createUploadUrl`、`apps/admin/src/components/base/crud/useDemoUpload.ts`

## 路徑歸屬檢查

`isOwnedUploadPath(path)` 判斷「這是不是本 api 簽出來的路徑」:前綴 + uuid + **該前綴**允許的副檔名。

- 白名單依前綴取聯集,不取全站聯集。放寬附件不會讓 `org-logos/<uuid>.zip` 通過。
- 兩個用途共用前綴時,副檔名互相放寬。`demo` 前綴可接受:封面與附件在不同 bucket,塞錯欄位只會指到不存在的物件。
- 共用前綴的條件:講得出「塞錯也不會外洩」。講不出就各給一個前綴。
- 讀取、公開網址、刪除都先過這一關;不通過回 `null` / `false`,不碰任意物件。

正本:`apps/api/src/storage/upload-rules.ts` 的 `isOwnedUploadPath`

## 讀取

| bucket | DB 存什麼 | 讀取方式                                                       |
| ------ | --------- | -------------------------------------------------------------- |
| 私有   | 物件路徑  | `readUrlOf`:現簽短效讀取網址(`GCS_SIGNED_URL_TTL`,預設 1 小時) |
| 公開   | 物件路徑  | `publicUrlOf`:組穩定公開 URL,不簽名、不過期                    |

- 私有檔的可取範圍 = 該筆資料的可查範圍。呼叫端先經 BaseRepository 查到那筆,再簽網址。
- 例:`demoItemOneAttachmentUrl` 先 `mustFind`(含租戶保底與資料範圍規則),再 `readUrlOf`。
- 表單上傳欄:`formSubmissionAttachmentUrl` 先確認讀得到那筆提交(與那個修訂)、那一欄是上傳欄、操作者過得了欄位級權限,才簽。
- 商標只在客戶端問 `logoUrl` 時才簽。
- 側欄商標:當前組織自己的;沒有就沿 `ancestors` 由近到遠找第一個有商標的上層。

正本:`apps/api/src/storage/storage.service.ts`、`apps/api/src/demo-items-one/demo-items-one.service.ts`、`apps/api/src/forms/form-runtime/form-submissions.service.ts` 的 `attachmentUrl`、`apps/api/src/auth/operator-context.service.ts`、`docs/testing/permission-scenarios.md` 劇本 11 / 15

## 換檔與孤兒物件

- 換檔即刪舊:`updateOrg` 把 `logoPath` 換掉或清空後,刪舊物件。刪不掉只記 log,不擋更新。
- 「上傳了但沒送出」的物件沒有任何欄位指向它,api 也不知道它存在。不掃描、不做 TTL 清理。
- 開通租戶失敗由交易整個回復(資料庫的寫入),不碰 bucket;已上傳的商標物件同上一條,沒有欄位指向它。
- 真要清孤兒,在 bucket 設 lifecycle rule(前綴 + 年齡),不在 api 寫掃描器。

正本:`apps/api/src/orgs/orgs.service.ts`、`apps/api/src/storage/storage.service.ts` 的 `deleteObject`

## 測試用端點

- `GCS_API_ENDPOINT` 只在劇本 E2E 設:api 以假憑證簽網址,指向 fake GCS 容器。
- 雲端環境都不設,走 ADC 與真 GCS。

正本:`apps/api/src/storage/storage.config.ts`、`apps/e2e/docker-compose.yml`

## 交易信件

| 項目     | 現況                                                                   |
| -------- | ---------------------------------------------------------------------- |
| 供應商   | Resend(`RESEND_API_KEY`;沒設 → 記錄用 adapter,信印到 stdout)           |
| 寄件人   | `projectMail.senderEmail`(啟用前驗證專案寄件網域 SPF + DKIM)           |
| 介面     | `MailService`:啟用信、重設密碼信、審核流程的任務通知與結果通知         |
| 防誤寄   | `MAIL_ALLOWLIST`:有值時只寄名單內信箱;空 = 不限,各環境依自己的需求設定 |
| 品牌文字 | 登記在 `docs/branding.md`                                              |

- 換供應商只換 adapter,呼叫端不動。
- 審核流程的通知信另受 `WORKFLOW_MAIL_ENABLED` 開關控制(`docs/modules/workflows.md`)。
- 連結效期與單次使用見 `docs/concepts/accounts-and-tenants.md`「啟用與重設密碼連結」。

正本:`apps/api/src/mail/mail.service.ts`、`apps/api/src/mail/mail.config.ts`、`apps/api/src/mail/mail.module.ts`、`apps/api/src/mail/mail-templates.ts`
