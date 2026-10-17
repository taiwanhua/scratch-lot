# 帳號與租戶(現況說明)

回答「誰能登入、屬於哪裡、租戶怎麼長出來」。決策理由見 ADR-0003(帳號體系)與 ADR-0009(租戶開通)。詞彙見 `CONTEXT.md`「帳號與租戶」。

## 兩套帳號

| 項目     | 使用者(User)        | 會員(Customer)                     |
| -------- | ------------------- | ---------------------------------- |
| 登入哪裡 | admin 後台          | front 前台                         |
| 資料表   | `users`             | `customers`                        |
| 權限     | 角色 + 權限(RBAC)   | 不進角色體系;固定能力 + 資料擁有權 |
| token    | `aud = admin`       | `aud = front`(會員登入尚未實作)    |
| 登入識別 | `account`(表內唯一) | `account`(表內唯一)                |

- 拿錯 `aud` 的 token 打 API 一律拒絕。
- `email` 只用在寄信(啟用、忘記密碼),不當登入識別。
- 兩張表各自唯一,跨表不互斥。

正本:`apps/api/src/auth/token.service.ts`、`apps/api/src/database/schemas/user.schema.ts`、`apps/api/src/database/schemas/customer.schema.ts`、ADR-0003「帳號分離」

## Token 與密碼

- access token:JWT HS256,預設 15 分鐘,只存在分頁記憶體。payload 只有 userId 與當前組織。
- refresh token:預設 30 天,httpOnly cookie;資料庫只存雜湊(`refresh_tokens`),可輪替、可「登出所有裝置」。
- 密碼:`@node-rs/argon2` 雜湊。seed 與 api 用同一套件。
- 登入不可枚舉:帳號不存在與密碼錯誤回同一個 `INVALID_CREDENTIALS`,耗時也相同(帳號不存在時對假雜湊跑一次 argon2)。
- 忘記密碼:Email 不存在也回「已寄出」。
- 登入節流:同帳號連續失敗 5 次鎖 1 分鐘(記憶體計數,單實例)。
- 錯誤碼語意見 `docs/standards/api/graphql-schema.md` GQL-04。

正本:`apps/api/src/auth/auth.config.ts`、`apps/api/src/auth/auth.service.ts`、`apps/api/src/auth/login-throttle.ts`、`apps/api/src/auth/refresh-cookie.ts`

## 多分頁:同一瀏覽器只有一個登入者

refresh cookie 整個瀏覽器共用,所以「誰後登入,全部分頁跟著他」。

| 分頁收到的廣播        | 反應                                                                        |
| --------------------- | --------------------------------------------------------------------------- |
| `logout`              | 清記憶體 token、清該使用者的路由頁籤、清 react-query 快取 → 回登入頁        |
| `login`,同一個 userId | 忽略                                                                        |
| `login`,別的 userId   | 清本分頁狀態 → 回 `booting` → 不可關閉的提示 → 1–2 秒後用 cookie 換票回 `/` |

- 通道是 `BroadcastChannel`,名稱登記在 `docs/branding.md`。
- 不做 `storage` 事件退路。
- 要同時用兩個帳號:開不同瀏覽器設定檔或無痕視窗。

正本:`apps/admin/src/app/providers/MultiTabSession/`、`apps/admin/src/lib/base/auth/session-channel.ts`

## 組織樹與租戶

```
根組織(平台營運方,key root)
├─ 租戶頂層 A(根的直接子組織 = 一個租戶)
│   ├─ 分店 A/1
│   └─ 分店 A/2
└─ 租戶頂層 B
```

- 每份組織文件存 `ancestors`(由根到父)。子樹查詢一句 `find({ ancestors: X })`。
- 使用者可屬多個組織(`org_user`),token 只帶一個**當前組織**。
- 當前組織只決定兩件事:新資料寫到哪個組織、業務頁的預設篩選。不參與權限計算。
- 使用者至少要有一個所屬組織(移除最後一個 → `LAST_ORG`)。
- **租戶時區**:租戶頂層的 `orgs.settings.timezone`(IANA 名稱),整個租戶的日期時間顯示與「某一天」的換算都以它為準;沒設或不是 `Intl` 認得的名稱時退回預設 `Asia/Taipei`。根組織與它自己的資料讀根組織自己的 `settings.timezone`(也是資料範圍規則換算「哪一天」的依據)。兩者都在組織管理的編輯彈窗設定(`system.org-manager.set-timezone`)。
- 組織可設主管(核心關聯 `org_manager`,一個組織可多位),審核流程以它解析「主管」審核者;在組織管理設定(`docs/modules/org-manager.md`)。

正本:`apps/api/src/database/schemas/org.schema.ts`、`apps/api/src/auth/operator-context.service.ts`、`apps/api/src/users/users.service.ts`、`apps/api/src/database/tenant-timezone.ts`

## 角色授予的資格

- 資格:使用者的所屬組織中,至少一個落在角色**擁有組織**的子樹內。
- 只在授予當下檢查一次。下層的人可直接被授予上層的角色。
- 跨租戶授予禁止;要授予先把人加進組織。
- 授予不改變所屬組織,也不改變可見範圍。
- 「組織外」標示:持有者的所屬組織都不在該角色擁有組織的子樹內。授予照常有效。
- 防越權(誰可以授出)見 `docs/concepts/authorization.md`「防越權」。

正本:`apps/api/src/roles/role-users.service.ts`、`apps/api/src/users/org-qualification.service.ts`、ADR-0003「所屬組織與角色授予」

## 從組織移除使用者

移除所屬組織時,不自動解除角色。確認彈窗三選一(`UserOrgRemovalPolicy`):

| 選項                           | 解除哪些授予                          |
| ------------------------------ | ------------------------------------- |
| `KEEP_ALL`                     | 都不解除                              |
| `REVOKE_OWNED_BY_ORG`          | 擁有組織 = 被移除組織的角色           |
| `REVOKE_ALL_UNQUALIFIED`(預設) | 上一檔 + 移除後失去全部子樹支撐的角色 |

- 失去資格 = 角色擁有組織的子樹 ∩ 剩餘所屬組織 = 空集合。
- dry-run 逐筆回原因:`OWNED_BY_REMOVED_ORG`、`NO_REMAINING_SUBTREE_SUPPORT`(兩者可同時成立)。
- 看得出 (b)(c) 差別的例子:擁有組織在被移除組織的**上層**、但不包住剩下所屬組織的角色。驗收配置見 `docs/testing/permission-scenarios.md` 劇本 9。
- 保留的角色功能照常;資料仍受可見範圍與資料範圍規則限制。
- 操作者的選擇與解除清單寫進 `audit_logs`。

正本:`apps/api/src/users/models/user-payloads.model.ts`、`apps/api/src/users/org-qualification.service.ts`、ADR-0003「從組織移除使用者」

## 租戶開通

根組織操作者(需 `system.org-manager.tenant-ops.provision`)在組織管理填表開通,系統自動:

1. 建租戶頂層(根的直接子組織),寫入開通表單填的租戶短碼(`orgs.slug`,全站唯一,只有根組織能改)。
2. 複製一份「租戶管理員」模板角色到租戶名下;只綁表單勾選的模組,每個模組各一筆 `*`。副本以 `roles.settings.templateKey = "tenant-admin"` 標記來源。
3. 建首任租戶管理員帳號,綁 `org_user` 與 `user_role`。不設密碼,寄啟用信。
4. 設 `orgs.ownerUserId` = 首任管理員(租戶擁有者)。

- 模板 = 全部模組扣除根組織專屬(模組與權限、資料範圍,以及權限容器租戶作業、類別作業),每個模組一筆 `*`。
- 副本就是該租戶的天花板。seed 新增的模組只進模板,既有租戶的副本不會自動拿到。
- 四步是一個交易:任一步失敗全部回復;啟用信在交易成功後才寄。
- 「新增子組織」是另一個輕量入口,不走這個流程。

正本:`apps/api/src/orgs/tenant-ops.service.ts`、`apps/db-migrator/seeds/base/role-bindings.ts`、`docs/modules/org-manager.md`

## 租戶擁有者保護

| 動作                           | 租戶內的人                                        | 根組織 |
| ------------------------------ | ------------------------------------------------- | ------ |
| 解除擁有者的租戶管理員授予     | 不可                                              | 可     |
| 把擁有者移出租戶 / 停用擁有者  | 不可                                              | 可     |
| 轉移擁有者                     | 不可                                              | 可     |
| 停用 / 刪除 / 搬移租戶頂層本身 | 不可                                              | 可     |
| 設可見性開關                   | 擁有者或持 `system.org-manager.set-visibility` 者 | 可     |
| 設租戶時區                     | 持 `system.org-manager.set-timezone` 者           | 可     |

正本:`apps/api/src/orgs/owner-protection.service.ts`、ADR-0009「租戶擁有者」

## 撤銷開通

開錯的租戶走「撤銷開通」,不走刪除(刪除前置的「無成員」對租戶頂層永遠不過)。

- 權限 `system.org-manager.tenant-ops.revoke-provision`,根組織專屬。
- 只在「還沒有人用」時允許;前置檢查與刪除共用同一支函式,不過 → `PROVISION_NOT_REVOKABLE` + reasons。
- 抹掉三樣:租戶頂層、角色副本、首任管理員帳號,連同它們的核心關聯。**硬刪除**,讓同一組帳號能重新開通。
- `audit_logs` 不抹;撤銷本身記一筆 `org.revoke-provision`。

正本:`apps/api/src/orgs/tenant-ops.service.ts`、`docs/modules/org-manager.md`、ADR-0009「撤銷開通」

## 啟用與重設密碼連結

| 連結     | 預設效期 | 環境變數                   |
| -------- | -------- | -------------------------- |
| 啟用帳號 | 7 天     | `ACTIVATION_TOKEN_TTL`     |
| 重設密碼 | 30 分鐘  | `PASSWORD_RESET_TOKEN_TTL` |

- 單次使用、存雜湊,`action_tokens` 有 TTL index。
- 啟用逾期走「忘記密碼」自助取得新連結。
- 在使用者管理新增使用者時,可改用「初始密碼 + 首登強改」(`UserActivationMode.PASSWORD`);預設仍是寄啟用信(`EMAIL`)。
- 密碼流程三個入口與 admin 三頁的行為見 `docs/modules/user-manager.md`「密碼流程」。

正本:`apps/api/src/auth/password/password.config.ts`、`apps/api/src/auth/password/action-token.service.ts`、`docs/env-registry.md`
