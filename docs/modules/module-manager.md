# 模組與權限(技術)

## 用途

讓根組織檢視整棵模組樹(含隱藏頁、權限容器與 `api` 權限樹)與每個模組宣告的權限,並做三件執行期的事:停用 / 啟用模組(連動子樹)、停用 / 啟用權限(全域 kill switch)、更換模組的側欄圖示。模組與權限的結構本身由 seed 宣告、走 code + PR,這一頁不能新增或改名。

表單模組的兩件事也開在這一頁,規則正本在 `docs/modules/forms.md`:右面板的「列表欄位配置」(「列表欄位配置」節)與頁首的「退役權限清理」(「退役權限清理」節)。

正本:`docs/adr/0002-seed-data-vs-business-data.md`、`docs/adr/0004-permission-model.md`

## 模組 key 與畫面

| key                     | 名稱       | sidebarType | 路由                     | 備註                                            |
| ----------------------- | ---------- | ----------- | ------------------------ | ----------------------------------------------- |
| `system.module-manager` | 模組與權限 | link        | `/system/module-manager` | 掛「系統管理」群組;**根組織專屬**(`isRootOnly`) |

- 畫面:Figma「Screen / 模組與權限」89:2(主畫面 89:214、停用確認 211:331)—— 左模組樹 + 右面板(除 `enabled`、`icon` 與表單模組的列表欄位配置外唯讀)。
- 側欄初始圖示 `apps`。

正本:`apps/db-migrator/seeds/base/modules/system.ts`、`docs/standards/general/figma.md`(FIGMA-09 節點表)

## 權限表

每個模組固定有一筆 `<key>.*`(seed 自動產生,本表不列)。綁定原則:綁「按鈕 / 欄位所在的那一頁」(ADR-0004)。

| 權限 key                                          | 它是哪一頁的什麼                                                                                                                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system.module-manager.view`                      | 看模組樹與各模組的權限清單(唯讀)                                                                                                                                                                         |
| `system.module-manager.toggle-enabled`            | 模組 / 權限的 `enabled` 切換 + API(停用父模組連動整棵子樹;停用權限 = 全域 kill switch,連超級管理員也不給;停用確認彈窗 Figma「Overlay / 停用模組確認」)                                                   |
| `system.module-manager.set-icon`                  | 模組的側欄圖示選擇器 + API。**獨立於 `.toggle-enabled`**:換圖示只改側欄長相、隨時換得回來,停用卻會讓所有租戶少掉整塊功能,兩件事的後果差太遠,不共用一把鑰匙                                               |
| `system.module-manager.delete-retired-permission` | 「退役權限清理」的刪除 + API:刪表單發布產生、已退役的欄位級權限(三層檢查:草稿仍用到擋下、只剩已完成要確認、沒人用直接刪;「用到」含升級後舊修訂綁的版本;規則正本 `docs/modules/forms.md`「退役權限清理」) |

模組本身 `isRootOnly`(seed 層),租戶管理員模板不含。

正本:`apps/db-migrator/seeds/base/modules/system.ts`

## 資料

- **`modules`**:模組樹(物化路徑 `ancestors`)。`enabled`、`icon`、`settings` 是 ADR-0002 的「初始 seed 值的欄位」(`seeds/base/modules.ts` 的 `initialSeedValueFields: ["enabled", "icon", "settings"]`),seed 重跑不覆蓋人改過的值;`engine`(`fixed` / `form`)與其餘結構欄位每次 seed 以 key 冪等同步。
- **`modules.settings.list`**:表單模組的列表欄位配置,由 `setModuleListColumns` 寫入(形狀與驗證見 `docs/modules/forms.md`「列表欄位配置」)。`settings` 是初始 seed 值欄位:seed 建立時使用專案初值、模組宣告或預設 `{}`,之後重跑不覆蓋,root 設的列表欄位配置不會被部署洗掉。
- **`permissions`**:`moduleId` 指向擁有它的模組;`enabled` 同為初始 seed 值欄位。`source = seed` 是 seed 宣告的權限,`source = dynamic` 是表單發布產生的欄位級權限;`retiredAt` 有值 = 已退役(模組樹與權限矩陣都不列,由「退役權限清理」處理)。
- **隱藏的 `api` 模組**掛純 API 權限(沒有畫面)。
- `isRootOnly` 只存在於 seed 宣告層、**不落庫**(`module-declaration.ts`),執行期無從得知,故不在任何回傳欄位內。

**側欄圖示**:`modules.icon` 是側欄圖示的 key,**正本是白名單** `@repo/domain/module-icon` 的 `MODULE_ICON_KEYS`(30 個 key)。前後端共用同一份:api 用它擋輸入,`@repo/ui` 的圖示登錄表以它為型別來源 —— 少一個 key 就 `check-types` 紅,不會出現「api 存得進去、側欄畫不出來」。`null` = 沒指定,側欄用預設圖示;前端認不得的 key 也一律退回預設圖示。

seed 只給初值:專案在 `apps/db-migrator/seeds/project/settings.ts` 的 `moduleInitialValues` 依模組 key 指定 `enabled`、`icon`、`settings`;未指定的圖示沿用模組宣告。以下是底座 `seeds/base/modules/*.ts` 的圖示預設,建立後由根組織在這一頁換:

| 模組                                                         | 初始 icon       |
| ------------------------------------------------------------ | --------------- |
| `overview` 總覽                                              | `dashboard`     |
| `apply-center` 申請中心                                      | `mail`          |
| `system` 系統管理                                            | `settings`      |
| `system.org-manager` 組織管理                                | `business`      |
| `system.org-manager.tenant-ops` 租戶作業                     | `key`           |
| `system.user-manager` 使用者管理                             | `people`        |
| `system.role-manager` 角色管理                               | `shield`        |
| `system.module-manager` 模組與權限                           | `apps`          |
| `system.field-manager` 欄位管理                              | `label`         |
| `system.field-manager.category-ops` 類別作業                 | `category`      |
| `system.data-scope` 資料範圍                                 | `filter`        |
| `system.forms` 表單管理                                      | `list`          |
| `system.workflows` 流程管理                                  | `account-tree`  |
| `system.notification-settings` 通知設定                      | `notifications` |
| `system.printers` 印表機管理                                 | `print`         |
| `demo` 示範群組                                              | `extension`     |
| `demo.sub` 示範次群組                                        | `folder`        |
| `demo.sub.sample-one` 示範模組1                              | `grid`          |
| `demo.sample-two` 示範模組2                                  | `list`          |
| `demo-form` / `demo.form` / `demo.sub.form` 三個示範表單模組 | `description`   |
| `api` API 能力                                               | `tune`          |
| `api.printing` 列印                                          | `print`         |
| 其餘隱藏頁                                                   | 不給(`null`)    |

seed 唯一會寫入既有文件 `icon` 的情形是**這一欄根本不存在**(文件建立時還沒有圖示欄)—— 那時補初值,否則已經種過的環境永遠拿不到圖示。所以 `setModuleIcon` 清空時寫的是 `icon: null` 而不是 `$unset`:欄位留著才算「人改過的值」,下次部署不會把宣告的初值補回來。

正本:`apps/api/src/database/schemas/module.schema.ts`、`apps/api/src/database/schemas/permission.schema.ts`、`apps/db-migrator/seeds/base/modules.ts`、`apps/db-migrator/seeds/base/module-declaration.ts`、`packages/domain/src/module-icon/keys.ts`

## 規則

- **根組織專屬,兩道門**:`isRootOnly` 讓租戶的 `me.modules` 裡沒有它(路由層擋);service 再守「當前組織是根組織」(`OwnerProtectionService.isRootOperator`,與租戶作業、資料範圍同一個判斷點)—— 權限可能經角色被帶到別的組織,**站在哪裡**才是判準。
- **停用模組連動子樹**:自己 + 全部子孫(`modules.ancestors` 含自己者)一併寫成 `enabled=false`。
- **啟用只啟用自己這一節**:子樹當初為何被關掉,這裡沒有資訊可還原,一律由人逐層決定。
- **停用權限 = 全域 kill switch**:任何人都不再持有它,連超級管理員也不給、`X.*` 也展不出它(ADR-0011 步驟 4)。
- **兩個切換都冪等**:送與現值相同的 `enabled` 不報錯,照樣寫一筆稽核;`setModuleIcon` 同慣例。
- **自鎖保護**:停用 `system.module-manager` 自己,一旦關掉就沒有任何畫面能把它開回來 —— 與角色的「不可停用自己正持有的角色」是同一條原則,只是主體換成模組樹。`setModuleEnabled` / `setPermissionEnabled` 的目標落在 `system.module-manager` 子樹內(模組本身、其子模組、以及它們的權限)→ `FORBIDDEN` + `reason = "SELF_LOCK"`。子樹判定走**物化路徑**(`modules.ancestors`),不切 key 字串(ADR-0004「反向歸屬不解析字串」)。
- **換圖示不套自鎖**:換圖示不會讓任何人進不來,換錯了照樣能再換 —— `SELF_LOCK` 守的是「關掉就再也開不回來」,所以這一頁自己的圖示也換得了。換圖示也不連動任何東西。
- **結構異動走 code + PR**:除兩種 `enabled`、`icon` 與表單模組的列表欄位配置外全部唯讀(ADR-0002);新模組依 `docs/agents/module-scaffold.md`。
- **權限容器**:`sidebarType = hidden` 且**沒有 route** 的節點(例如 `system.org-manager.tenant-ops` 與整棵 `api` 樹)只掛權限、沒有畫面,存在的理由是讓底下那幾條權限可以單獨授予 / 停用。它們不是頁面,不受隱藏頁 `-page` 命名規則約束(ADR-0004「頁面(模組)的進入權」),`me.modules` 對它們回 `route: null`。seed 的命名規約把「`-page` 結尾 ⇔ hidden 且有 route」寫成硬規則,違規在種資料時就被擋下。

正本:`apps/api/src/modules/module-manager.service.ts`(`assertRootOperator`、`assertNotSelfLock`)、`apps/db-migrator/src/seed/seed-key-convention.ts`

## api 介面

```graphql
moduleTree: [ModuleAdminNode!]!                                  # 全樹(樹根陣列,子節點掛 children)
setModuleEnabled(input: { id, enabled }): ModuleAdminPayload!    # 停用連動子樹;啟用只啟用自己
setModuleIcon(input: { id, icon }): ModuleAdminPayload!          # 側欄圖示;icon 為白名單 key 或 null
setPermissionEnabled(input: { id, enabled }): PermissionAdminPayload!
```

四者皆根組織專屬:`@RequirePermission` 先守權限(`.view` / `.toggle-enabled` / `.set-icon`),service 再守根組織(見「規則」)。

`setModuleIcon` 的 **`icon` 缺席與 `null` 同義**(GQL-06),兩者都是「清掉,側欄改用預設圖示」—— 這個 input 只有一個可寫欄位,沒有「部分更新」可言,所以不造第三種狀態。

### 回傳欄位語意(GQL-07:正本在此,前端段只引用)

| 欄位                          | 語意                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `moduleTree`                  | **全樹**:含側欄看不到的 `hidden` 節點、隱藏的 `api` 權限樹,以及**已停用**的模組與權限。停用一律以 `enabled` 表示,不以「不回」表示(不然停用後就再也開不回來)。與 `me.modules`(「我能用什麼」,吃 enabled 當過濾)是兩種相反的讀法 |
| `ModuleAdminNode.parentId`    | 上層模組 id;本樹的根為 `null`。`setModuleEnabled` 回的那一枝,其根節點的 `parentId` 仍是真實的上層 id(與 `OrgNode` 的樹根一律 `null` 不同)                                                                                      |
| `ModuleAdminNode.enabled`     | **這個節點自己的**停用狀態。停用連動子樹時子孫的值已一併落庫,所以樹上讀到什麼就是什麼,不必再回頭看祖先                                                                                                                         |
| `ModuleAdminNode.route`       | 路由**只有自己那一段**(不是完整路徑;完整路徑由各層的 route 串起來)。`null` = 這個節點不對應任何畫面 ⇒ **`sidebarType = HIDDEN` 且 `route` 為 `null` 就是「權限容器」**。前端據此把它標成「權限容器」而不是「隱藏頁」           |
| `ModuleAdminNode.children`    | 下層模組(側欄順序:`order` → `key`);葉節點為空陣列                                                                                                                                                                              |
| `ModuleAdminNode.icon`        | 側欄圖示 key(白名單 `@repo/domain/module-icon`);`null` = 沒指定,側欄用預設圖示。`me.modules[].icon` 是同一個值、同一個語意                                                                                                     |
| `ModuleAdminNode.engine`      | 頁面組裝方式:`FIXED` = 固定欄位模組、`FORM` = 表單模組(seed 宣告 `engine: "form"`,每次 seed 同步,頁面不能改)。`me.modules[].engine` 是同一個值                                                                                 |
| `ModuleAdminNode.permissions` | 這個模組**這一層**的權限(含已停用者,不含已退役者);`<key>.*` 恆排最前,其餘依 key                                                                                                                                                |
| `PermissionAdmin.enabled`     | 全域 kill switch:false 時任何人都不再持有它,連超級管理員也不給、`X.*` 也展不出它(ADR-0011 步驟 4)                                                                                                                              |
| `setModuleEnabled` 的回傳     | 被切換的模組**及其整棵子樹**的最新狀態(前端直接換掉樹上的這一枝)                                                                                                                                                               |

正本:`apps/api/src/modules/`(`module-manager.resolver.ts`、`module-manager.service.ts`、`models/module-admin.model.ts`)、`apps/api/schema.gql`(`ModuleAdminNode`)

## admin 頁面

`apps/admin/src/pages/base/system/ModuleManagerPage/`:左 `ModuleTreePanel.tsx`(治理面全樹)+ 右 `ModuleDetailPanel/`(所選模組的資料與它這一層的權限清單)、`DisableModuleDialog.tsx`(停用確認)、`RetiredPermissionsDialog/`(退役權限清理)、`useModuleManagerData.ts`。列表欄位配置的彈窗與表單管理共用 `pages/base/system/ListColumnsDialog/`;這兩個表單相關彈窗以 `lazy-form-dialogs.ts` 懶載入(它們會帶進表單引擎的定義與計算器,首屏不載)。

| 行為         | 做法                                                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 樹上的標示   | 群組 / 隱藏頁 / 權限容器掛類型 `Tag`(連結是多數,不掛);`enabled=false` 另掛「停用」`Tag`。各類型的完整說法在右側「側欄類型」那一列                                                                                                                             |
| 停用模組     | 先開確認彈窗(文案說明連動整棵子樹、重新啟用只開自己)→ `SetModuleEnabled` → invalidate `ModuleTree` + `me`                                                                                                                                                     |
| 啟用模組     | 不確認,直接送出(只影響自己這一節,可逆)                                                                                                                                                                                                                        |
| 權限開關     | 不確認,直接 `SetPermissionEnabled`;清單上方固定一句話說明「停用 = 所有持有者立即失去」                                                                                                                                                                        |
| 換圖示       | 右面板「圖示」欄位選一個白名單 key → 不確認、直接 `SetModuleIcon` → invalidate `ModuleTree` + `me`(側欄立即更新);依 `system.module-manager.set-icon` 顯示:有權限給 `@repo/ui/module-icon-picker`,沒有只顯示目前圖示與名稱。清空 = 送 `icon: null`(回預設圖示) |
| 右面板欄位   | key、側欄類型、引擎、排序、描述、圖示。「引擎」只在模組連結(`sidebarType = LINK`)顯示:「表單引擎」或「固定欄位」                                                                                                                                              |
| 列表欄位配置 | 只在 `engine = FORM` 的模組出現;「設定列表欄位」鈕依 `system.forms.edit`(api 另守站在根組織),開 `ListColumnsDialog`(規則見 `docs/modules/forms.md`「列表欄位配置」)                                                                                           |
| 退役權限清理 | 頁首按鈕,有本頁就看得到清單;「刪除」依 `system.module-manager.delete-retired-permission`(三層檢查見 `docs/modules/forms.md`「退役權限清理」)                                                                                                                  |
| 唯讀         | 除兩種 `enabled`、`icon` 與列表欄位配置外全部唯讀                                                                                                                                                                                                             |
| 動作的顯示   | 依 `system.module-manager.toggle-enabled`;沒有這筆權限時開關不渲染,改以狀態 `Tag` 呈現                                                                                                                                                                        |
| 自鎖防呆     | `system.module-manager` 這一枝的開關 `disabled` 並附說明「此模組用於管理模組本身,不可停用」,不等送出才吃錯(api 仍會以 `SELF_LOCK` 擋)                                                                                                                         |
| 非根組織     | 不在頁面判斷 —— 本模組 `isRootOnly`,租戶的 `me.modules` 裡沒有它,路由層就擋掉(ADR-0011)                                                                                                                                                                       |

### 「權限容器」節點(文案正本)

| 落點             | 文案                                                      |
| ---------------- | --------------------------------------------------------- |
| 樹上的類型 `Tag` | 「權限容器」(不是「隱藏頁」)                              |
| 右面板的描述     | 「這一層只掛權限、沒有畫面,讓這些權限可以單獨授予或停用」 |

判斷函式 `ModuleManagerPage/module-admin-tree.ts` 的 `isPermissionContainer`:**直接讀 `moduleTree` 回的 `route`**(`sidebarType = Hidden` 且 `route` 為 `null`)。help.md 同步一句相同白話。

正本:`apps/admin/src/pages/base/system/ModuleManagerPage/`(`module-admin-tree.ts`、`ModuleDetailPanel/`、`RetiredPermissionsDialog/`、`module-manager-permissions.ts`、`module-manager-types.ts`)、`apps/admin/src/pages/base/system/ListColumnsDialog/`

## 錯誤碼

沒有本模組專屬的新錯誤碼 —— `SELF_LOCK` 是既有 `FORBIDDEN` 的 `reason`,不是新的 `code`(GQL-04 的表只在 `FORBIDDEN` 那一列註明)。

| 情況                                                                                  | 回什麼                                                                       |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 權限不足                                                                              | `FORBIDDEN`(由 `@RequirePermission` 擋)                                      |
| 當前組織不是根組織                                                                    | `FORBIDDEN`                                                                  |
| `setModuleEnabled` / `setPermissionEnabled` 的目標落在 `system.module-manager` 子樹內 | `FORBIDDEN` + `extensions.reason = "SELF_LOCK"`                              |
| 模組 / 權限 id 查無(含 id 格式不合法)                                                 | `NOT_FOUND`                                                                  |
| `setModuleIcon` 的 `icon` 不在白名單內                                                | `VALIDATION_FAILED`,`extensions.fields = ["icon"]`(讓前端把錯標回圖示選擇器) |

正本:`apps/api/src/modules/module-manager-error.ts`、`apps/admin/src/pages/base/system/ModuleManagerPage/module-manager-error.ts`

## 稽核

| 動作                        | `targetType` | 內容                                                                      |
| --------------------------- | ------------ | ------------------------------------------------------------------------- |
| `module.toggle-enabled`     | `module`     | `after.cascadedModuleKeys` 列出這一次被連動關掉的子孫 key(啟用時為空陣列) |
| `module.set-icon`           | `module`     | `before` / `after` 各帶 `{ key, icon }`                                   |
| `permission.toggle-enabled` | `permission` |                                                                           |

冪等的重送(值與現值相同)照樣寫一筆。

正本:`apps/api/src/modules/module-manager.service.ts`(`AUDIT`)

## 測試

- api:`apps/api/src/modules/module-manager.test.ts`(根組織守門、連動子樹、自鎖、圖示白名單、稽核);權限解析層的 kill switch 在 `apps/api/src/permission/permission.test.ts`
- admin:`apps/admin/src/pages/base/system/ModuleManagerPage/` 的 `ModuleManagerPage.test.tsx`、`ModuleManagerToggles.test.tsx`、`ModuleManagerIcon.test.tsx`、`ModuleManagerForms.test.tsx`(列表欄位配置、退役權限清理)、`module-admin-tree.test.ts`;共用 harness `module-manager-test-support.ts`
- seed:`apps/db-migrator/src/seed/seed-key-convention.test.ts`(`-page` 命名規約)
- 劇本 E2E(`docs/testing/permission-scenarios.md`):劇本 10 越權(硬送 `system.module-manager.*` 回 `ROLE_OUT_OF_REACH`,`scenario-10-out-of-reach.spec.ts`)、劇本 16 租戶視角側欄沒有本頁(`scenario-16-tenant-perspective.spec.ts`);另有一條手動項:root 停用「示範模組2」→ 租戶側欄少一項,重新啟用只開這一個節點

正本:上列檔案、`docs/testing/permission-scenarios.md`

## 使用者說明(help.md)

[system.module-manager.help.md](../../apps/admin/src/md/module-help/base/system.module-manager.help.md) —— 根組織專屬模組,help 的讀者是系統管理員;文案同樣不寫平台視角詞彙。

正本:`apps/admin/src/md/module-help/base/system.module-manager.help.md`

## 平台視角備註

- 停用模組 / 權限對**所有租戶**同時生效(模組與權限是全平台共用的一棵樹),這是「上線後臨時關掉某塊功能」的開關;租戶管理員看不到這一頁。
- `isRootOnly` 不落庫:須從底座與專案的模組宣告判斷;自身或任一祖先標記即為根組織專屬。來源由 `apps/db-migrator/seeds/registry.ts` 組裝,租戶管理員模板一併扣除這些節點。

正本:`apps/db-migrator/seeds/base/modules/system.ts`、`apps/db-migrator/seeds/base/module-declaration.ts`
