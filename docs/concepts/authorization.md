# 授權:模組、權限與判斷流程(現況說明)

回答「誰能進哪一頁、頁裡能用什麼、在哪裡判斷」。決策理由見 ADR-0004(權限模型)與 ADR-0011(判斷流程)。看得到哪些資料不在這裡,見 `docs/concepts/data-layer-and-isolation.md`。

## 模組 = 頁面,權限 = 頁面裡的東西

| 概念 | 是什麼                               | 存在哪                                      |
| ---- | ------------------------------------ | ------------------------------------------- |
| 模組 | 側欄 / 路由的一個節點;權限的命名空間 | `modules`(種子;樹,`parentId` + `ancestors`) |
| 權限 | 頁裡的按鈕、欄位、跳窗、flag         | `permissions`(種子;`moduleId` 指向擁有模組) |
| 角色 | 權限的集合,屬於一個組織              | `roles` + 核心關聯                          |

- 可進一頁 = 角色綁了那個模組(`role_module`)。
- 頁裡能用什麼 = 角色綁的權限(`role_permission`)。
- 側欄類型三種:`group`(可展開群組)、`link`(連結頁)、`hidden`(不在側欄)。
- `hidden` 再分兩種:**隱藏頁**(有 route,key 以 `-page` 結尾,如編輯頁)與**權限容器**(無 route,如 `api` 樹、根組織專屬動作的 `system.org-manager.tenant-ops` / `system.field-manager.category-ops`)。
- 停用父模組 = 整棵子樹停用。停用權限 = 全域 kill switch,連超級管理員也不給。

正本:`apps/api/src/database/schemas/module.schema.ts`、`apps/api/src/database/schemas/permission.schema.ts`、`apps/db-migrator/seeds/base/modules/`

## key 命名

- 模組 key 累加父 key:`system.org-manager`、`demo.sub.sample-one`。
- 權限 key = 擁有模組 key + `.` + 動作。動作恆為單段,`*` 是唯一特殊動作。
- 全小寫 kebab-case,以 `.` 分層。例:`demo.sub.sample-one.edit-page.show-history`。
- 切分:最後一段 = 動作,其餘 = 擁有模組 key。
- 歸屬以 `moduleId` 欄位為準,不靠解析字串。
- 權限動作不可以 `-page` 結尾,所以模組 key 與權限 key 永不同字串。
- 規約由 seed 的規約測試強制。

正本:`packages/domain/src/permission/keys.ts`、`apps/db-migrator/src/seed/seed-key-convention.ts`

## 權限綁在哪一頁

- 權限綁「它作為按鈕 / 欄位所在的那一頁」。跨頁共用的綁父模組。
- **頁面自有權限**:只控制某一頁的某個區塊(如編輯頁的變更歷程),綁在那一頁自己的模組上。
- **欄位級權限**:讀 `show-<欄位>`、寫 `edit-<欄位>`。沒有讀權限 → api 不放這欄(GraphQL 回 `null`);input 帶了不能寫的欄位 → `FORBIDDEN` + `FIELD_FORBIDDEN`。
- 欄位級權限的固定配套:稽核歷程記 `"[redacted]"`;清單 `keyword` 不比對受保護欄位。
- API 權限重用頁面權限 key;沒有對應頁面的純 API 能力放隱藏的 `api` 模組樹。

正本:`docs/modules/demo.sub.sample-one.md`「權限表」、`apps/api/src/demo-items-one/demo-item-one-mapper.ts`、`apps/db-migrator/seeds/base/modules/api.ts`

## 表單模組的權限

表單模組(`engine: "form"`)的權限分兩種來源:

| 來源         | 權限                                                                                           | 怎麼來                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| seed 宣告    | 固定四條 `view` / `create` / `edit` / `delete` + 宣告的頁內權限(如 `store.sell`)               | `formModuleDeclaration` 的選填 `permissions: [{ action, name }]`,和固定四條一起產生 |
| 表單動態權限 | 欄位級 `show-<formKey>-<fieldKey>` / `edit-<formKey>-<fieldKey>`;依表單新增 `create-<formKey>` | 執行期產生(`permissions.source = "dynamic"`),欄位級的在表單發布第 3 步建立          |

- 頁內權限的動作不能和固定四條、`*` 或表單動態權限的前綴(`show-` / `edit-` / `create-`)撞形狀,宣告時就擋下。
- 表單動態權限的 key 拆得出 formKey(`parseFormPermissionKey`)。只處理欄位的地方(發布同步、退役權限清理)改用 `parseFieldPermissionKey`,它不認 `create-`:依表單新增權限不會被當成欄位級權限列出或刪除。
- **別租戶的表單動態權限對操作者視同不存在**:表單的 `ownerOrgId` 不是 null、也不是操作者當前組織的租戶(根組織操作者只認共用表單),或表單已不存在(fail-closed)。過濾在 `PermissionResolver.resolve`(超級管理員同樣過濾),所以 `me.modules`、`@RequirePermission`、權限矩陣看到同一份;持該模組 `*` 也蓋不到這些 key(`holdsPermission`)。
- 只有權限集裡有動態權限(持表單模組 `*`,或被授了動態權限)才查 `forms`;只持固定權限的操作者不多一次查詢。

正本:`apps/db-migrator/seeds/base/form-module-declaration.ts`、`apps/api/src/forms/form-permission-keys.ts`、`apps/api/src/permission/foreign-form-permissions.ts`、`docs/modules/forms.md`「模組 key 與權限表」

## Wildcard(同層語意)

- 每個模組固定有一筆 `<模組 key>.*`(群組、隱藏頁、`api` 樹都有;seed 自動產生)。
- `X.*` = 模組 X **這一層**的全部權限,含未來新增。不涵蓋子模組。
- 整組全給 = 子樹每個模組各存一筆 `*`。群組列的勾選狀態是衍生的,不另存。
- 解析是聯集、純加法,沒有 deny。
- 資料庫裡沒有「全域 `*`」。超級管理員靠解析時 bypass。

正本:`packages/domain/src/permission/keys.ts` 的 `hasPermission`、`packages/domain/src/permission/matrix.ts`

## 解析流程(每次請求現查)

```
token → userId
  → user_role:roleIds(停用的角色不計)
      └ 持超級管理員 → 全部 enabled 模組 + 其全部 enabled 權限
  → role_module:moduleIds
  → role_permission:權限(停用的不算)
  → 展開 `X.*`:moduleId = X 的全部 enabled 權限
  → 剔除別租戶的表單動態權限(看當前組織的租戶)
  → 查模組(自己或祖先停用 → 剔除),每個模組掛自己的有效權限
  → me.modules
```

- 單一入口 `PermissionResolver.resolve`。`@RequirePermission` 守門與 `me.modules` 吃同一份結果,兩邊永遠一致。
- 不快取。權限變更下一個請求就生效。
- 當前組織不參與角色與權限的計算;只用來判斷哪些表單動態權限屬於別租戶(見「表單模組的權限」)。
- `me.modules` 每筆:`id`、`key`、`name`、`parentId`、`sidebarType`、`order`、`route`、`icon`、`engine`(`FORM` = 表單模組,admin 依它掛表單引擎的預設組裝)、`permissions`。
- `route` 是完整路徑(父段累加,如 `/demo/sub/sample-one`);權限容器為 `null`。
- `permissions` 只放 moduleId 等於該模組的 key;持 `X.*` 時含 `X.*` 本身與展開後各筆。
- 排序:`order` → `key`;前端以 `parentId` 組樹。

正本:`apps/api/src/permission/permission-resolver.ts`、`apps/api/src/permission/me-modules.resolver.ts`

## 兩道防守

| 在哪 | 做什麼                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| api  | resolver 標 `@RequirePermission(key)`;判斷「key 在集合中,或擁有模組的 `*` 在集合中」(別租戶的表單動態權限一律不算);無權 → `FORBIDDEN` |
| api  | 資料查詢一律經 BaseRepository(租戶保底 + 資料範圍規則)                                                                                |
| 前端 | 路由防守:可進 = 有那個模組路由(見 `docs/concepts/frontend-architecture.md`「路由與導向」)                                             |
| 前端 | 頁內功能:`usePermissions().hasPermission(key)`,同一個判斷函式                                                                         |

- `@RequirePermission` 是單一 key。多選一(如上傳用途)由 resolver 自己查有效權限集合。

正本:`apps/api/src/permission/permission.guard.ts`、`apps/api/src/permission/require-permission.decorator.ts`、`apps/admin/src/hooks/base/usePermissions.ts`

## abilities 的兩種語意

兩種都是 api 依操作者算好、前端只讀。差別在含不含權限判斷:

| 種類                        | 例                                                             | 含權限判斷               | 前端顯示按鈕的條件                       |
| --------------------------- | -------------------------------------------------------------- | ------------------------ | ---------------------------------------- |
| 業務模組的 `item.abilities` | `canEdit` / `canDelete` / `canEditInternalNote`                | 含                       | 直接讀,不與 `usePermissions` 相乘        |
| 治理模組的 `Role.abilities` | `canEdit` / `canEditMatrix` / `canToggleEnabled` / `canDelete` | 不含(只表達角色種類規則) | 與 `usePermissions` 相乘(`rowAbilityOf`) |

- 新模組預設用第一種。只有「同一權限下每一筆還有各自的可不可以」才用第二種,並在模組文件寫明。

正本:`apps/api/src/demo-items-one/demo-item-one-mapper.ts`、`apps/api/src/roles/role-rules.ts`、`docs/modules/role-manager.md`「角色種類與可改動範圍」

## 防越權

| 層       | 規則                                                                       | 被擋時                                   |
| -------- | -------------------------------------------------------------------------- | ---------------------------------------- |
| 權限上限 | 權限矩陣 subset-only:只能授出自己有效權限集的子集;模組只能勾自己也有路由的 | `ROLE_OUT_OF_REACH`                      |
| 粗篩     | 授予角色時,角色的擁有組織要在操作者的管理範圍內(超級管理員 bypass)         | `ROLE_OUT_OF_REACH`                      |
| 天花板   | 預設角色(租戶副本)的矩陣上限 = 租戶管理員模板**目前**的綁定,root 也不例外  | `ROLE_OUT_OF_REACH` + `TEMPLATE_CEILING` |

- 持 `X.*` 可授出 X 這層任何權限與 `X.*`;子模組的 `*` 要自己持有才能授出。
- 「指派角色」(使用者頁)與「分配使用者」(角色頁)是同一件事的兩個入口,判準相同。
- 操作者之後失去權限,已授出的不回收。

正本:`apps/api/src/roles/role-matrix.service.ts`、`apps/api/src/roles/role-users.service.ts`、`docs/modules/user-manager.md`「防越權」

## 角色種類

| 種類     | 判準                   | 改名 | 矩陣                     | 停用                      | 刪除       |
| -------- | ---------------------- | ---- | ------------------------ | ------------------------- | ---------- |
| 種子     | `isSystem`             | 不可 | 唯讀                     | 不可                      | 不可       |
| 預設角色 | `settings.templateKey` | 可   | 上限 = 模板;租戶只能收窄 | 只有 root                 | 不可       |
| 自建     | 其餘                   | 可   | subset-only              | 可,但不可停用自己正持有的 | 無授予時可 |

- 自鎖保護:不讓任何人把自己關在門外。不可停用自己持有的角色;不可停用 `system.module-manager` 子樹或其權限。
- api 算好 `Role.kind` 與 `Role.abilities`,前端不重算。

正本:`apps/api/src/roles/role-rules.ts`、`docs/modules/role-manager.md`「角色種類與可改動範圍」

## 權限矩陣的兩棵樹

| 樹     | 內容                                | 用途                    |
| ------ | ----------------------------------- | ----------------------- |
| 全樹   | 全部 enabled 模組與權限             | 收斂成 `*`、subset 比對 |
| 顯示樹 | 全樹 ∩ 操作者權限集(逐筆剪過權限列) | 畫面上的勾選框          |

- 收斂一定用全樹。拿顯示樹收斂會把「操作者只看得到的 5 筆全勾」存成 `*`,等於授出他沒有的權限。
- 顯示樹上可能「模組在、`*` 列不在」。連動函式不可假設每個模組都有 `*`,否則生出看不到也取消不掉的一筆。
- 矩陣逐條規則(M-01 起)與兩棵樹的細節見 `docs/modules/role-manager.md`「權限矩陣規則(逐條)」「矩陣的兩棵樹」。

正本:`packages/domain/src/permission/matrix.ts`、`apps/api/src/roles/role-matrix.service.ts`

## 稽核

- 寫入 `audit_logs`:誰、何時、動作、對象、前後值(只放有變的欄位)。
- 由執行動作的模組層寫(`AuditService.record`);RelationService 與 BaseRepository 不記。
- 治理模組的授權變更與 CRUD、示範模組的新增 / 編輯 / 停用 / 刪除都有記。action 名見各 `docs/modules/<key>.md`「審計」。
- 只增不改。個資與欄位級權限欄只記「有變」,值記 `"[redacted]"`。

正本:`apps/api/src/audit/audit.service.ts`、`apps/api/src/database/schemas/audit-log.schema.ts`
