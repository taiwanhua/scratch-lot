# 角色管理(技術)

## 用途

管理角色:在操作者的管理範圍內新增角色(選擁有組織 = 管轄邊界)、改名稱 / 描述、編輯權限矩陣(角色可進哪些模組、持有哪些權限)、分配使用者、停用 / 刪除。角色種類(種子 / 預設角色 / 自建)決定可改動範圍。相關 ADR:[0004 權限模型](../adr/0004-permission-model.md)、[0011 查詢與判斷流程](../adr/0011-permission-resolution-flow.md)、[0003 雙帳號體系](../adr/0003-dual-account-system.md)(擁有組織、授予資格)。

正本:`apps/api/src/roles/`、`apps/admin/src/pages/base/system/RoleManagerPage/`、`packages/domain/src/permission/`

## 模組 key 與畫面

| key                   | 名稱     | sidebarType             | 自有權限 |
| --------------------- | -------- | ----------------------- | -------- |
| `system.role-manager` | 角色管理 | link(清單 + 頁籤詳情頁) | 見權限表 |

- 路由:`/system/role-manager`。沒有隱藏頁:所有動作都是頁上的彈窗或頁內頁籤。
- Figma「角色管理」44:44:左清單(搜尋 + 分頁)+ 右頁籤(權限設定;分配使用者)。設計稿權限設定頁籤上的資料範圍 Radio 沒有實作 —— 資料範圍規則在獨立的 [資料範圍](./data-scope.md) 模組設定;彈窗:新增 / 編輯角色、加入使用者 69:697、刪除 / 停用確認、放棄變更。頁籤用 `Draft/Tabs`(由 `Draft/Tab` 69:655 組成,登記見 `docs/branding.md`)。

正本:`apps/db-migrator/seeds/base/modules/system.ts`、`apps/admin/src/app/module-pages.tsx`

## 權限表

綁定原則:綁「按鈕 / 欄位所在的那一頁」(ADR-0004)。每個模組固定有一筆 `<key>.*`(seed 自動產生,本表不列)。

| 權限 key                             | 它是哪一頁的什麼                                                                                                                                                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system.role-manager.view`           | 看角色清單、單筆(權限矩陣、分配使用者兩個頁籤);沒有它整頁進不去內容                                                                                                                                                                                                              |
| `system.role-manager.create`         | 「新增角色」按鈕 + API(擁有組織限操作者管理範圍內,預設當前組織)                                                                                                                                                                                                                  |
| `system.role-manager.edit`           | 編輯名稱 / 描述 + API                                                                                                                                                                                                                                                            |
| `system.role-manager.edit-matrix`    | 權限矩陣「儲存」+ API(role_module / role_permission 整份覆蓋;subset-only 防越權;預設角色有天花板,非 root 只能縮不能擴)                                                                                                                                                           |
| `system.role-manager.assign-users`   | 分配使用者頁籤的「加入使用者」「移除」+ API(user_role;候選 = 管理範圍內尚未持有者,資格 = 所屬組織在角色擁有組織子樹內)                                                                                                                                                           |
| `system.role-manager.toggle-enabled` | 停用 / 啟用角色 + API(停用後持有者的該角色立即不生效,PermissionResolver 已排除 enabled=false)。**有這個權限不代表每個角色都切得動** —— 還要過角色種類規則:種子不可切、預設角色只有 root、不可停用操作者自己正持有的角色(見規則;列上顯示與否讀 `Role.abilities.canToggleEnabled`) |
| `system.role-manager.delete`         | 刪除角色 + API(前置:無授予、非種子角色、非租戶副本、沒被人員條件引用;軟刪除)                                                                                                                                                                                                     |

正本:`apps/db-migrator/seeds/base/modules/system.ts`、`apps/admin/src/pages/base/system/RoleManagerPage/role-manager-permissions.ts`

## 資料

- `roles`:`key`、`isSystem`(種子角色,seed runner 一律補齊)、`settings.templateKey`(開通租戶複製出的租戶管理員副本 = `"tenant-admin"`,ADR-0009)、`enabled` + 基礎欄位。**`Role.kind` 不是資料庫欄位**,是 api 依操作者算出的回傳欄位。
- `permissions`:`moduleId` 指向擁有模組。
- `core_relationships`:`org_role`(擁有組織)、`role_module`、`role_permission`、`user_role`。角色軟刪除時關聯不動(ADR-0007 / ADR-0001)。
- seed:種子角色 `super-admin`(超級管理員,僅根組織可授予)與 `tenant-admin`(租戶管理員模板);模板由底座與專案的模組宣告共同推導,包含非根組織專屬模組及其 wildcard。專案新增模組登記在 `seeds/project/registry.ts`,既有租戶副本的授權仍由根組織管理。

正本:`apps/api/src/database/schemas/role.schema.ts`、`apps/api/src/database/schemas/permission.schema.ts`、`apps/api/src/database/schemas/core-relationship.schema.ts`、`apps/db-migrator/seeds/base/roles.ts`、`apps/db-migrator/seeds/base/role-bindings.ts`

## 規則

**擁有組織 = 管轄邊界**(ADR-0003「擁有組織 = 角色的管轄邊界」):新增角色時選擁有組織(預設當前組織,限操作者管理範圍內),欄位下固定提示「這個角色的持有者可以管理此組織與它底下的所有組織」;要不同範圍就建不同角色。擁有組織建立後不可改 —— 改管轄邊界等於換一個角色。

**授權變更由本模組寫 `audit_logs`**(RelationService 不記)。

**詞彙對應**:文件的「租戶副本」(`Role.isTemplateCopy`,開通租戶時複製的租戶管理員副本)在 **UI 與 help.md 一律稱「預設角色」**(租戶使用者看得到的畫面不出現平台視角詞彙,FIGMA-04);技術文件與模型一律用「租戶副本」。

### 角色種類與可改動範圍

規則正本 [ADR-0004「角色種類與可改動範圍」](../adr/0004-permission-model.md);本節補模組側的錯誤碼與落點。三種判準互斥,由上往下取第一個成立者。api 依**操作者**算好 `Role.kind`(`SYSTEM` / `TEMPLATE_COPY` / `CUSTOM`)與 `Role.abilities`(`canEdit` / `canEditMatrix` / `canToggleEnabled` / `canDelete`),**前端只讀、不重算**。

| 角色種類                             | 判準                             | 改名 / 描述 | 權限矩陣                                                             | 停用                                | 刪除       | 分配使用者 |
| ------------------------------------ | -------------------------------- | ----------- | -------------------------------------------------------------------- | ----------------------------------- | ---------- | ---------- |
| **種子**(超級管理員、租戶管理員模板) | `isSystem`(seed runner 一律補齊) | 不可        | 唯讀                                                                 | 不可                                | 不可       | 可         |
| **預設角色**(租戶副本)               | `settings.templateKey`           | 租戶可      | **上限 = 內建租戶管理員模板** — root:模板範圍內放寬 / 收窄;租戶:收窄 | 只有 root(自鎖保護)                 | 不可       | 可         |
| **自建角色**                         | 其餘                             | 可          | 依 subset-only                                                       | 可,但不可停用操作者自己正持有的角色 | 無授予時可 | 可         |

- `saveRoleMatrix` 的 `shrinkOnly` 判準是「**非 root 且是預設角色**」—— root 對預設角色可以放寬(平台方本來就該能替租戶開新模組),但放寬不出模板的範圍。
- **預設角色的天花板**(規則正本 ADR-0004):上限 = 內建「租戶管理員」模板角色**目前**的 `role_module` / `role_permission`,讀出後 `normalizeGrant` 到全樹。`saveRoleMatrix` 對 `TEMPLATE_COPY` 多一道 `isSubsetOf(desired, templateGrant)`,不符 → `ROLE_OUT_OF_REACH` + `reason TEMPLATE_CEILING`。判斷順序是 subset-only → 天花板 → `shrinkOnly`,所以「自己也沒有」與「模板沒有」分得出來。
- 停用的自鎖:**不可停用操作者自己正持有的角色**(啟用不受此限)。模組側是同一條自鎖原則:`setModuleEnabled` / `setPermissionEnabled` 打到 `system.module-manager` 子樹或其權限 → `FORBIDDEN`(reason `SELF_LOCK`),見 [module-manager.md](./module-manager.md)。
- UI 落點:清單列的編輯 / 停用 / 刪除按鈕讀 `abilities`;種子角色的矩陣唯讀並說明「系統內建角色,內容隨版本更新」。

### 防越權(subset-only)

矩陣勾選送出時做 subset-only 防越權驗證,模組與權限皆是:**持有 `X.*` 可授出 X 這層任何權限與 `X.*`;只持有個別筆的可授出該筆,但不可授出 `*`**(措辭與 ADR-0004「防越權與稽核」一致,不是「有 `*` 才能授出」)。分配使用者的資格 = 所屬組織落在角色擁有組織子樹內。

### 權限矩陣規則(逐條)

純函式正本 `@repo/domain/permission`(`matrix.ts`),`matrix.test.ts` 的案名逐條對應本節;實作與測試一律引用這裡的編號。畫面:依模組層級顯示樹,模組粗體、可勾選(**勾模組 = 給路由**);各模組的權限縮排列於其下。

| 編號     | 規則                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M-01** | **勾下層補上層**:勾下層模組必連動勾上層;**勾一筆權限也要補上它的擁有模組與各層祖先**(模組沒綁時該權限是死資料,ADR-0011 先取模組再掛權限)。不是把權限丟掉;樹外的 key 一律丟棄                                                                                                                                                                                                                                                            |
| **M-02** | **有子孫被勾的上層為勾選且不可取消**:UI 上該列勾選框 `disabled` 但**整列仍可展開**(`@repo/ui/tree` 的 `disabledCheckIds`);要整棵收掉用「清空整組」或先取消下層                                                                                                                                                                                                                                                                          |
| **M-03** | **`*` 與同層互斥連動**:勾「全部(`*`)」→ 同層每一筆跟著勾;取消其中任一筆 → `*` 解除、改存其餘個別筆。**`*` 只代表該模組自己這一層**(ADR-0004 同層語意),不涵蓋子模組                                                                                                                                                                                                                                                                      |
| **M-04** | **收斂只存 `*` 一筆**:同層全勾時 `role_permission` 只存 `<模組>.*`;已持有 `*` 恆維持 `*`(`*` 含未來新增)                                                                                                                                                                                                                                                                                                                                |
| **M-05** | **整組全選 / 清空**:頂層群組列旁的切換 = 對子樹**每個模組**寫入 `*`(並勾上模組)/ 清除 `*`;**清空同時清掉子樹的模組勾選**,不只清 `*`(只清 `*` 會留下一排仍被勾的模組,與按鈕字面不符)。子樹以外不受影響                                                                                                                                                                                                                                   |
| **M-06** | **群組列的勾選狀態是衍生的**:子樹每個模組都有 `*` 才顯示勾,**不另存**群組層級的記錄                                                                                                                                                                                                                                                                                                                                                     |
| **M-07** | **沒有個別權限的模組**(群組、`api` 容器、純權限容器):同層是空集合,**只有明確勾了 `*` 才存**;不可因「同層全勾」而自動生出 `*`(否則每次正規化都無中生有)。**與 M-10 是同一條原則的兩半**:M-07 管「這個模組**本來就沒有**個別權限」,M-10 管「餵進來的那棵樹上**看不到** `*` 列」;兩者的結論一樣 —— **不要無中生有一筆 `<模組>.*`**,改動任一條時兩條一起看                                                                                  |
| **M-08** | **三態 indeterminate 的定義**:**模組已勾、且它的直接子列(子模組 + 這一層的權限)只勾了一部分** → 該列顯示 mixed(`aria-checked="mixed"`)。連動一律由呼叫端算,`@repo/ui/tree` 只負責呈現                                                                                                                                                                                                                                                   |
| **M-09** | **收斂與 subset 比對的基準是全樹**,不是裁成操作者權限集的顯示樹(ADR-0004「儲存」;細節見 api 介面的「矩陣的兩棵樹」)                                                                                                                                                                                                                                                                                                                     |
| **M-10** | **樹上沒有 `*` 列的模組就是沒有 `*`**:矩陣只替「這一層列得出權限」的模組推導 `<模組>.*`;整層一筆權限都沒有時,整組全選不寫 `*`、群組列的勾選狀態也不要求它,硬送進來的 `<模組>.*` 依 M-01 的「樹外 key 一律丟棄」處理。顯示樹會把操作者搆不到的 `*` 列剪掉,生出來的那一筆使用者**看不到也取消不掉**,送出只會換來 `ROLE_OUT_OF_REACH`。**`expandGrant`(展開給 UI 顯示)同規則**:這一層列不出權限時,角色即使持有 `<模組>.*` 也不展開、不輸出 |

正本:`apps/api/src/roles/role-rules.ts`、`apps/api/src/roles/roles.service.ts`、`apps/api/src/roles/role-matrix.service.ts`、`packages/domain/src/permission/matrix.ts`、`docs/adr/0004-permission-model.md`

## api 介面

GQL-06 / GQL-07:可選輸入欄位的「缺席 / null」語意與回傳欄位語意的正本在本節,前端段只引用、不另寫解釋。

| 端點                                                                    | 權限 key         | 說明                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roles(input: RolesInput!): RolesPayload!`                              | `view`           | 範圍 = 擁有組織在操作者**管理範圍**內的角色;`keyword` 比對名稱與描述(不分大小寫的部分比對);`ownerOrgId` 見下方「缺席 / null 的語意」                                                                                      |
| `role(id: ID!): RolePayload!`                                           | `view`           | 單筆;管理範圍外視同不存在(`NOT_FOUND`,不透露差別)                                                                                                                                                                         |
| `createRole(input: CreateRoleInput!): RolePayload!`                     | `create`         | 擁有組織限管理範圍內(範圍外 `FORBIDDEN`);新角色不綁任何模組 / 權限                                                                                                                                                        |
| `updateRole(input: UpdateRoleInput!): RolePayload!`                     | `edit`           | 只有名稱與描述;**擁有組織建立後不可改**(ADR-0003);種子角色 → `FORBIDDEN`(reason `SYSTEM_ROLE`)                                                                                                                            |
| `setRoleEnabled(input: …): RolePayload!`                                | `toggle-enabled` | 依角色種類擋:種子角色一律不可切 → `FORBIDDEN`(`SYSTEM_ROLE`);預設角色(租戶副本)只有根組織的操作者可切 → `FORBIDDEN`(`TEMPLATE_COPY_ROOT_ONLY`);**不可停用操作者自己正持有的角色** → `FORBIDDEN`(`SELF_LOCK`,啟用不受此限) |
| `deleteRole(input: DeleteRoleInput!): DeletePayload!`                   | `delete`         | 前置四項不過 → `ROLE_NOT_DELETABLE` + `extensions.reasons`(被人員條件引用時另帶 `extensions.references`);軟刪除,關聯不動                                                                                                  |
| `roleMatrix(roleId: ID!): RoleMatrixPayload!`                           | `view`           | 見下方「矩陣的兩棵樹」                                                                                                                                                                                                    |
| `saveRoleMatrix(input: …): RoleMatrixPayload!`                          | `edit-matrix`    | 整份覆蓋(限矩陣回的那棵樹);`ROLE_OUT_OF_REACH`(預設角色超過模板天花板時附 `reason TEMPLATE_CEILING`);種子角色的矩陣唯讀 → `FORBIDDEN`(`SYSTEM_ROLE`)                                                                      |
| `roleUsers(roleId: ID!, input: …): RoleUsersPayload!`                   | `view`           | 被授予這個角色的**所有人**(含管理範圍外的「組織外」持有者 — 列不出來就移不掉)                                                                                                                                             |
| `roleUserCandidates(roleId: ID!, input: …): RoleUserCandidatesPayload!` | `assign-users`   | 「加入使用者」彈窗的候選:操作者**管理範圍**內、**尚未持有**這個角色的人,每筆附 `eligible`;`keyword` 比對姓名 / 帳號 / Email。角色在管理範圍外 → `NOT_FOUND`                                                               |
| `grantRoleUsers(input: …): RoleUsersPayload!`                           | `assign-users`   | **增量加入**(不是全量覆蓋);資格不符 → `USER_NOT_ELIGIBLE` + `extensions.roleId` / `ownerOrgName`;已持有者重送冪等。資格判斷與使用者頁的 `assignUserRoles` 共用 `OrgQualificationService.assertEligible`                   |
| `revokeRoleUsers(input: …): RoleUsersPayload!`                          | `assign-users`   | 擁有者保護 → `OWNER_PROTECTED`;未持有者重送冪等                                                                                                                                                                           |

**缺席 / null 的語意**(GQL-06):

- `RolesInput.ownerOrgId`:**缺席與 `null` 同義** —— 不篩,回整個管理範圍。給值時**只比對擁有組織本身,不含子樹**(角色的管轄邊界就是它的擁有組織);指到管理範圍外的組織回**空清單**,不是 `FORBIDDEN` / `NOT_FOUND`(不透露該組織存在)。可與 `keyword` 疊加。
- `CreateRoleInput.ownerOrgId`:**缺席與 `null` 同義** —— 都取操作者的當前組織。
- `UpdateRoleInput.name`:缺席 / `null` = 不動(名稱不可清空)。
- `UpdateRoleInput.description`:**缺席 = 不動、`null` = 清空**(空字串同 `null`)。

**回傳欄位的語意**(GQL-07):

- `Role.ownerOrg`:擁有組織;清單只回管理範圍內的角色,所以正常恆有值,資料損毀(無 `org_role`)時為 `null`。
- `Role.ownerOrg.tenantTop`:擁有組織所屬的**租戶頂層**(`orgs.ancestors[1]`,見 `orgs/org-mapper.ts` 的 `tenantTopIdOf`)。角色選單靠它分組 —— 每個租戶都有自己的「租戶管理員」,根組織視角只看角色名稱分不出來。擁有組織本身是租戶頂層時 = 它自己;擁有組織是根組織(種子角色)、或租戶頂層落在操作者管理範圍外時為 `null`。
- `Role.kind`:`SYSTEM` / `TEMPLATE_COPY` / `CUSTOM`,判準見規則的「角色種類與可改動範圍」。`isSystem` / `isTemplateCopy` 是它的兩個布林投影,留著相容。
- `Role.abilities`:`canEdit` / `canEditMatrix` / `canToggleEnabled` / `canDelete` —— 這個角色**依種類規則**允許的四個動作,api 依操作者算好(`apps/api/src/roles/role-rules.ts`),**前端不重算**。**不含權限 key 的判斷**:「有沒有 `system.role-manager.edit`」由 `@RequirePermission` 與前端的 `usePermissions` 各守一層,顯示按鈕的條件是兩者相乘(`rowAbilityOf`)。
- `Role.isSystem`:種子角色(`super-admin` / `tenant-admin` 模板);`Role.isTemplateCopy`:開通租戶複製出來的副本(`settings.templateKey`,ADR-0009)。兩者都不可刪。
- `Role.userCount`:被授予的人數,**含「組織外」的授予**(ADR-0003:授予照常有效)。
- `RoleUser.orgs`:該使用者的所屬組織,只列操作者管理範圍內的(範圍外的連 id 都不露)。
- `RoleUser.outOfScope`:所屬組織皆不在角色擁有組織的子樹內 → UI 標 Warning Tag「組織外」。
- `RoleUser.ownerProtected`:移除會被 `OWNER_PROTECTED` 擋下 → UI 把「移除」設為 disabled。
- `RoleUserCandidate.eligible`:所屬組織至少一個落在角色擁有組織的子樹內(ADR-0003 的授予資格,與 `RoleUser.outOfScope` 同一份判斷、反向)。**不合格的人照樣回**,由前端 disabled 並就地說明原因 —— 直接不列會讓找不到人的人以為「這個人不見了」,而不知道是資格不符。判定權仍在 api:硬送 `grantRoleUsers` 一樣回 `USER_NOT_ELIGIBLE`。
- `RoleMatrixPayload.shrinkOnly`:**非 root 且**這個角色是租戶管理員副本,矩陣只能縮不能擴。
- `RoleMatrixPayload.ceiling`:預設角色(租戶副本)的**矩陣上限** = 內建「租戶管理員」模板角色目前的授予,**已展開 `*`、已收到顯示樹內**(與 `granted` 同一套投影);其他種類的角色為 `null`。前端把天花板外的列設成不可勾 —— root 與租戶都套(租戶另受 `shrinkOnly`)。
- `RoleMatrixPayload.granted`:**已展開 `*`**(含 `*` 本身與展開後的同層各筆),直接餵 `@repo/domain/permission` 的連動純函式。

**矩陣的兩棵樹**(規則來源 ADR-0004 防越權 + ADR-0011 的 enabled 剔除):

- 後端內部以**全樹**(全部 enabled 模組 + 各模組全部 enabled 權限)做 `normalizeGrant` / `isSubsetOf`。`*` 的收斂語意是「這一層的每一筆都給了」,拿一棵被裁過的樹去收斂會讓「只看得到 5 筆、勾滿 5 筆」被存成 `*` 而擴權 —— 所以比對基準一定是全樹。
- `roleMatrix.modules` 回的是**顯示樹** = 全樹 ∩ 操作者自身的有效權限集(超級管理員 = 全部)。矩陣上沒出現的就是勾不到的,前端不必自己再算一次防越權。
- **顯示樹是「連同模組底下的個別權限列一起逐筆剪」的**(`role-matrix.service.ts` 的 `buildView`):先以 `holder.moduleKeys` 濾出 `visibleModules`,再對每一筆權限各跑一次 `isSubsetOf` 濾出 `visiblePermissions`,最後才 `buildMatrixTree(visibleModules, visiblePermissions)`。**所以顯示樹上會出現「模組在、但它底下一筆權限都沒有」的節點** —— 那不是資料壞掉,是操作者剛好有那個模組的路由、卻沒有它任何一筆權限。M-07 / M-10 要處理的正是這種節點:對它整組全選**不寫 `*`**、群組列的勾選狀態也不要求它。寫矩陣的測試夾具時要照著這個形狀寫(TEST-12)。
- `saveRoleMatrix` 的整份覆蓋**只作用在顯示樹的範圍**:操作者搆不到的既有綁定不被清掉(與 `assignUserRoles`「操作者觸及不到的既有授予不動」同一條原則)。

正本:`apps/api/src/roles/roles.resolver.ts`、`apps/api/src/roles/role-matrix.service.ts`、`apps/api/src/roles/role-users.service.ts`、`apps/api/src/roles/models/`、`packages/graphql/src/documents/base/roles.graphql`

## admin 頁面

左清單(搜尋 + 分頁)+ 右頁籤(權限矩陣 / 分配使用者)。勾選連動一律呼叫 `@repo/domain/permission`,顯示與計算餵同一棵 `roleMatrix.modules`;前端不自己拼樹、不自己算防越權。換算的薄殼在 `apps/admin/src/lib/base/role-matrix-208.ts`。

**未儲存離開**:矩陣有未送出的勾選時,離開前要問。「離開」有兩類,分兩路接:

- **切頁籤、換選角色**:頁面自己攔,跳「放棄變更」確認彈窗。
- **關分頁、重新整理、上一頁**:交給 `beforeunload`,用瀏覽器自己的提示(文案不可控,只求不靜默丟失;`hooks/base/useUnsavedGuard.ts`)。

儲存成功後只精準 invalidate 該角色的 `RoleMatrix` 與 `Roles`(DATA-02 / 04),不整頁重抓。

**`shrinkOnly` 與 `ceiling` 的前端鎖**:兩把鎖疊在同一組 `disabledCheckIds` 上(`useRoleMatrix` 的 `lockedIds`),算法同一支(`lib/base/role-matrix-208.ts` 的 `rowIdsOutside`:一份授予展開後涵蓋不到的列):

- `RoleMatrixPayload.ceiling` 非 null(= 預設角色)→ 鎖**天花板外的列**並顯示「以系統內建的角色範本為上限」;**root 也鎖**。
- `RoleMatrixPayload.shrinkOnly` 為 true(= 非 root 的預設角色)→ 再鎖**目前沒有勾的列**並顯示「只能縮不能擴」。

兩者都是防呆不是把關 —— 判準仍以 api 為準(subset-only → 天花板 → shrinkOnly)。

**三態 indeterminate 的來源**:mixed 的定義是 M-08:**模組已勾、且直接子列只勾了一部分**。`@repo/ui/tree` 只負責呈現,`indeterminateIds` 由本頁算好傳入。

**頁內頁籤**:用 `@repo/ui/tabs`(`RoleDetailPanel/DetailTabs.tsx`),不用 `PageTabs`:切頁籤要先被「未存的矩陣變更」攔下(REACT-14 的例外)。目前頁籤仍記在網址 `?tab=`(`useUrlState`);左清單的搜尋、擁有組織、頁碼在 `?list=`,選中的角色在 `?detail=<id>`,持有人清單的頁碼在 `?users=`(連同角色 id 一起存,換角色就回第一頁)。

**清單列的動作**(編輯 / 停用 / 刪除)= **權限 × `Role.abilities`**(`rowAbilityOf`,`role-manager-types.ts`):權限決定「這個人能不能做這件事」、`abilities` 決定「這個角色讓不讓做」,兩者相乘才顯示按鈕。刪除送出後收到 `ROLE_NOT_DELETABLE` 才攤開 `extensions.reasons` 四項,`REFERENCED_BY_AUDIENCE` 底下再逐項列出 `extensions.references` 的引用處與處置(`RoleReferenceLine.tsx`,見「錯誤碼」節的「提示怎麼說」;種類認不得的不列),並提示改用停用。列上的刪除鍵不預判引用(`abilities.canDelete` 只看授予與角色種類),被引用要送出後才知道。

**「組織外」標示**:分配使用者列表、使用者管理列表角色欄、指派角色彈窗三處,對失去子樹支撐的授予標 Warning Tag「組織外」+ hover 完整說明(ADR-0003)。

**「加入使用者」彈窗**(`AssignUsersTab/AddUsersDialog.tsx`,Figma 69:697):候選來自 `roleUserCandidates`,掛在 `assign-users` 底下,不借 `users` —— 借了會讓這個彈窗連帶需要 `system.user-manager.view`,能分配使用者的人卻打不開。資格不符的人(`eligible = false`)**顯示但 disabled** 並就地說明原因,資格由 api 算,前端不自己走組織樹。改用 `@repo/ui/autocomplete`,**關鍵字丟回 api 查**(候選有分頁上限,前端手上不會是全量),所以走 `onInputChange`,給了它 Autocomplete 就不再自己過濾一次,否則打第一個字就把「還沒換過來的那批 options」濾成空的。判定權仍在 api(`USER_NOT_ELIGIBLE`)。

### 角色選單怎麼分辨同名角色

三個地方列角色:資料範圍頁的套用對象「指定角色」、使用者頁的「指派角色」、角色管理頁的左清單。每個租戶都有自己的「租戶管理員」,根組織視角只看角色名稱完全分不出來,所以兩層一起上,共用純函式 `apps/admin/src/lib/base/role-options.ts`:

- 每一列「**角色名稱**」為主文字、「**擁有組織**」為次文字(選單裡是兩行;角色管理頁的左清單是單行,用 `roleOptionLabel` 接成「名稱 — 擁有組織」)。
- 跨兩個以上群組時才**分組**;只有一組時不分組 —— 只有一組的標題是雜訊。判斷與取值是兩個函式,因為 MUI 的 `groupBy` 只要給了就一定畫標題;角色管理頁的左清單自己畫分段,另用 `groupRoleOptions` 取巢狀結構。
- **搜尋在選單裡**:三個選單都是 `@repo/ui/autocomplete`,輸入即過濾(比對主文字)。不用 MUI `Select` + 選單外搜尋框 —— `Select` 會把選單裡的子元素一律 clone 成 `role="option"`,搜尋框塞進去會變成一個假選項。角色管理頁**左清單**上方的搜尋框與「依擁有組織篩選」下拉是另一回事,它們是送給 api 的查詢條件。
- 不合格 / 停用 / 管理範圍外的選項**列出來但灰掉**,原因寫在該列的次文字 —— 不能用 Tooltip(MUI 對停用的選項關掉 pointer-events,詳見 STYLE-05)。

**分組有兩套,刻意不統一 —— 哪一頁用哪一套寫在這裡**:

| 頁面 / 選單                                          | 依什麼分組                              | 用哪幾支函式                                                                                                |
| ---------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 資料範圍頁的套用對象「指定角色」(`RuleAudience.tsx`) | **擁有組織**(`Role.ownerOrg` 自己)      | `sortRolesByOwnerOrg`(排序,在 `useDataScopeData`)+ `shouldGroupRolesByOwnerOrg` / `roleOwnerOrgGroupNameOf` |
| 使用者頁的「指派角色」(`AssignRolesDialog.tsx`)      | **租戶頂層**(`Role.ownerOrg.tenantTop`) | `shouldGroupRoles` / `roleGroupNameOf`                                                                      |
| 角色管理頁的左清單(`RoleListPanel.tsx`,自己畫的分段) | **租戶頂層**                            | `groupRoleOptions`(切成巢狀結構,不走 MUI 的 `groupBy`)                                                      |

**為什麼不統一**:兩套回答的是不同問題。資料範圍頁在挑「這條規則要套用給誰」,**組織的粒度**才有意義(同一個租戶底下的南港店角色與內湖店角色要分得開);另外兩處只要能**分辨同名角色**,租戶頂層那一層就夠了,再往下切會讓單一租戶的畫面冒出一堆只有一列的標題。兩套共用同一份排序與「只有一組就不分組」的原則,所以不是兩套邏輯、只是兩個分組鍵。`shouldGroupXxx` 與 `roleXxxGroupNameOf` 一律**成對使用**。

正本:`apps/admin/src/pages/base/system/RoleManagerPage/`(`useRoleMatrix.ts`、`role-manager-types.ts`、`RoleDetailPanel/DetailTabs.tsx`、`AssignUsersTab/AddUsersDialog.tsx`、`RoleListPanel/`)、`apps/admin/src/lib/base/role-matrix-208.ts`、`apps/admin/src/lib/base/role-options.ts`、`apps/admin/src/hooks/base/useUnsavedGuard.ts`

## 錯誤碼

| 情境                                                      | 回應                                                                                                                                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 動到種子角色(改名 / 矩陣 / 停用)                          | `FORBIDDEN`,reason `SYSTEM_ROLE`                                                                                                                                                  |
| 非 root 停用預設角色                                      | `FORBIDDEN`,reason `TEMPLATE_COPY_ROOT_ONLY`                                                                                                                                      |
| 停用操作者自己正持有的角色                                | `FORBIDDEN`,reason `SELF_LOCK`                                                                                                                                                    |
| 擁有組織在管理範圍外(新增)                                | `FORBIDDEN`                                                                                                                                                                       |
| 刪除前置未過(仍有授予 / 種子 / 預設角色 / 被人員條件引用) | `ROLE_NOT_DELETABLE` + `extensions.reasons`(`HAS_GRANTS` / `SYSTEM_ROLE` / `TEMPLATE_COPY` / `REFERENCED_BY_AUDIENCE`);有 `REFERENCED_BY_AUDIENCE` 時另帶 `extensions.references` |
| 矩陣勾到操作者自己沒有的項目                              | `ROLE_OUT_OF_REACH`                                                                                                                                                               |
| 預設角色勾到模板沒有的項目(root 也擋)                     | `ROLE_OUT_OF_REACH`,reason `TEMPLATE_CEILING`                                                                                                                                     |
| 加入的使用者資格不符                                      | `USER_NOT_ELIGIBLE` + `roleId` / `ownerOrgName`                                                                                                                                   |
| 移除擁有者的租戶管理員授予                                | `OWNER_PROTECTED`                                                                                                                                                                 |
| 角色在管理範圍外                                          | `NOT_FOUND`                                                                                                                                                                       |
| 名稱空白、id 不合法                                       | `VALIDATION_FAILED` + `extensions.fields`                                                                                                                                         |

**被人員條件引用(`REFERENCED_BY_AUDIENCE`)**:角色 id 出現在任何人員條件的「角色」條件列(含巢狀群組)就不能刪 —— 刪掉後那些條件指向不存在的角色,通知沒人收、關卡沒人能審,畫面看不出來。停用不受此限(停用的角色在人員條件解析時本來就不算,隨時可恢復)。掃描範圍與 `extensions.references[].kind`:

| `kind`                 | 存在哪                                                           | 範圍                                                                           | 帶的名稱                         |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------- |
| `notification-setting` | `notification_settings.audience`(收件人)                         | 角色所屬租戶;只算目前有登記的通知類型                                          | `name` = 通知類型名稱            |
| `workflow-approver`    | `workflow_versions.steps[].assignee`(審核者)                     | 角色所屬租戶的流程;草稿、目前版本、還有進行中單據(`running` / `blocked`)的版本 | `name` = 流程、`stepName` = 關卡 |
| `workflow-step-cc`     | `workflow_versions.steps[].cc`(關卡的知會對象)                   | 同上                                                                           | 同上                             |
| `workflow-overdue`     | `workflow_versions.steps[].overdue.audience`(逾時提醒的通知對象) | 同上                                                                           | 同上                             |
| `workflow-cc`          | `workflow_versions.cc`(整個流程的知會對象)                       | 同上                                                                           | `name` = 流程                    |
| `data-scope`           | `data_scope_rules.rules[].audience`(套用對象)                    | 全部規則(根組織設定、跨租戶)                                                   | `name` = 資料範圍目標            |
| `sidebar-badge`        | `sidebar_badge_settings.audience`(誰看得到側欄數字)              | 角色所屬租戶;只算目前有登記側欄數字的模組                                      | `name` = 模組名稱                |

角色所屬租戶 = 擁有組織所屬的租戶(根組織的角色只看共用流程與資料範圍;找不到擁有組織是資料損毀,直接丟錯)。退役且沒有進行中單據的版本不再派出審核,不算引用。

流程的四種另帶 `source`(出處)—— `draft` 草稿、`current` 目前版本、`in-use` 進行中單據(`running` / `blocked`)用的版本,`in-use` 再帶 `inUseCount`(單據數)。合併重複的鍵 = `kind` + 名稱 + 關卡 + `source`:同一關出現在多個進行中版本合成一筆、單據數相加;草稿與目前版本各留一筆;目前版本有進行中單據時,`current` 與 `in-use` 各一筆(發布新版後那些單據仍用舊版)。

**提示怎麼說**(admin `RoleReferenceLine.tsx`;每一項都是「為什麼 + 怎麼做」):

| 引用處                       | 處置                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| 通知設定                     | 到「通知設定」把收件人改成其他角色(有通知設定的編輯權限才做成連結) |
| 流程的草稿 / 目前版本        | 到「流程管理」修改這一關並發布(有流程管理的編輯權限才做成連結)     |
| 進行中單據用的版本(`in-use`) | 等這些單據完成,或撤回 / 作廢後再刪除(帶單據數)                     |
| 資料範圍                     | 由系統管理員設定,請聯絡系統管理員修改                              |
| 側欄數字                     | 到「通知設定」的「側欄數字」把條件改成其他角色(連結同通知設定)     |

正本:`apps/api/src/audience/audience-references.service.ts`(`AudienceReferencesService`;條件樹走訪沿用 `@repo/domain/workflow` 的 `audienceStaticIdsOf`)

錯誤碼總表在 GQL-04。前端解讀集中在 `role-manager-error.ts`。

正本:`apps/api/src/roles/roles-error.ts`、`apps/admin/src/pages/base/system/RoleManagerPage/role-manager-error.ts`、`docs/standards/api/graphql-schema.md`

## 稽核

由本模組寫 `audit_logs`(ADR-0004;RelationService 不記):`role.create` / `role.edit` / `role.edit-matrix`(before / after 為綁定差異)/ `role.grant-user` / `role.revoke-user` / `role.toggle-enabled` / `role.delete`。

正本:`apps/api/src/roles/roles.service.ts`、`apps/api/src/roles/role-matrix.service.ts`、`apps/api/src/roles/role-users.service.ts`

## 測試

- api:`apps/api/src/roles/roles.test.ts`、`role-kinds.test.ts`、`role-matrix.test.ts`、`role-matrix-tenant-owner.test.ts`、`role-users.test.ts`(共用 `roles-test-support.ts`)
- 矩陣純函式:`packages/domain/src/permission/matrix.test.ts`(案名對應 M-01〜M-10)
- admin:`apps/admin/src/pages/base/system/RoleManagerPage/RoleManagerPage.test.tsx`、`RoleManagerMatrix.test.tsx`、`RoleManagerUsers.test.tsx`(共用 `role-manager-test-support.ts`)、`apps/admin/src/lib/base/role-matrix-208.test.ts`
- 劇本(`docs/testing/permission-scenarios.md`):劇本 1 wildcard 涵蓋未來、劇本 8 組織外、劇本 10 防越權;E2E 為 `apps/e2e/src/specs/scenario-01-wildcard.spec.ts`、`scenario-08-out-of-scope.spec.ts`、`scenario-10-out-of-reach.spec.ts`

正本:`apps/api/src/roles/`、`packages/domain/src/permission/`、`apps/admin/src/pages/base/system/RoleManagerPage/`、`apps/e2e/src/specs/`、`docs/testing/permission-scenarios.md`

## 使用者說明(help.md)

[system.role-manager.help.md](../../apps/admin/src/md/module-help/base/system.role-manager.help.md)(build 時打包進說明彈窗;租戶副本在這裡一律稱「預設角色」)。

正本:`apps/admin/src/md/module-help/base/system.role-manager.help.md`

## 平台視角備註

- 超級管理員為種子角色、僅根組織可授予。
- 「租戶管理員」角色範本於開通租戶時複製成租戶副本(`settings.templateKey`,ADR-0009);副本的天花板與 root 放寬規則都屬平台視角,help 只說「預設角色」。
- 新專案模組登記在 `apps/db-migrator/seeds/project/registry.ts` 的 `moduleDeclarations`;組裝器將底座與專案的非根組織專屬模組一起推導成模板,不需修改底座綁定。既有租戶副本不會自動取得新增模組,仍由根組織管理授權。

正本:`apps/db-migrator/seeds/base/role-bindings.ts`、`docs/adr/0009-tenant-provisioning.md`
