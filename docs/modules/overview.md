# 總覽(技術)

## 用途

登入後的第一頁。目前只有佔位內容(問候 + 當前組織);實際總覽內容(統計卡、最近項目、公告)尚未定案,定案後各區塊各自讀對應模組的資料。它是**正式模組**而不是寫死的首頁:各租戶要看的總覽內容不同,必須能授權 / 收回,所以進權限體系、不做固定列。

正本:`apps/db-migrator/seeds/base/modules/overview.ts`、`apps/admin/src/pages/base/OverviewPage/OverviewPage.tsx`

## 模組 key 與畫面

| key        | 名稱 | sidebarType | 路由        | 父節點 | order | icon        |
| ---------- | ---- | ----------- | ----------- | ------ | ----- | ----------- |
| `overview` | 總覽 | link        | `/overview` | 無     | 0     | `dashboard` |

頂層 link 模組,`order: 0`,側欄第一列、排在「系統管理」之前。

**畫面**:Figma「Admin 總覽」(`Screen / Admin 總覽` 節點 `20:3`);側欄第一列即 `Draft/AdminSideNav`(節點 `30:52`)的「總覽」NavItem。

正本:`apps/db-migrator/seeds/base/modules/overview.ts`、`apps/admin/src/app/module-pages.tsx`(`OVERVIEW_MODULE_KEY`)

## 權限表

| 權限 key     | moduleId 指向 | 它是哪一頁的什麼                                            |
| ------------ | ------------- | ----------------------------------------------------------- |
| `overview.*` | 總覽          | wildcard(同層語意,ADR-0004);每模組固定一筆,由 seed 自動產生 |

目前沒有個別權限;個別權限(如各統計卡的顯示)待內容定案後補在本表再種。租戶管理員模板綁 `overview` + `overview.*`(非根組織專屬模組,由 `role-bindings.ts` 自動納入);超級管理員 bypass。

正本:`apps/db-migrator/seeds/base/modules/overview.ts`、`apps/db-migrator/seeds/base/modules.ts`、`apps/db-migrator/seeds/base/role-bindings.ts`

## 資料

無自有 collection。畫面資料來自 `me`(`name`、`currentOrg`)。

正本:`apps/admin/src/pages/base/OverviewPage/OverviewPage.tsx`、`apps/admin/src/hooks/base/useMe.ts`

## 規則

- **`/` 的導向**:`/` 轉到側欄深度優先的第一個 link(`firstLinkRoute`);有總覽權限時就是 `/overview`(ADR-0011「路由與導向規則」)。
- **沒綁總覽的角色**:登入後被導到側欄第一個能進的頁;手打 `/overview` 是無權限頁;一個能進的頁都沒有才顯示無權限頁。
- **為什麼進權限體系**:總覽內容會因租戶而異,做成固定列就無法授權 / 收回。

正本:`apps/admin/src/lib/base/module-tree.ts`(`firstLinkRoute`)、`apps/admin/src/app/guards/ModuleRoute/ModuleRoute.tsx`

## api 介面

無自有端點;只用共用的 `me` 查詢。

正本:`packages/graphql/src/documents/base/auth.graphql`

## admin 頁面

`OverviewPage` 顯示問候(`admin.session.greeting`)與當前組織(`currentOrg`;沒有組織時顯示 `noOrg`)。在 `app/base/module-pages.ts` 以 `OVERVIEW_MODULE_KEY` 登記。

正本:`apps/admin/src/pages/base/OverviewPage/OverviewPage.tsx`、`packages/i18n/messages/zh-TW/admin.json`(`admin.session`)

## 錯誤碼

無,因為沒有自有端點。

正本:`apps/admin/src/pages/base/OverviewPage/OverviewPage.tsx`

## 稽核

無,因為沒有寫入動作。

正本:`apps/db-migrator/seeds/base/modules/overview.ts`

## 測試

- 劇本 E2E:`apps/e2e/src/specs/scenario-13-overview-module.spec.ts`(角色沒綁總覽 → 落在側欄第一個能進的頁、手打 `/overview` 無權限;綁回去 → 落在 `/overview`);劇本本文見 [permission-scenarios](../testing/permission-scenarios.md) 劇本 13。
- admin:殼的測試以總覽為預設落點 —— `apps/admin/src/app/AdminShell/AdminShell.test.tsx`、`apps/admin/src/app/AdminShell/SideNav/SideNav.test.tsx`。
- api:`apps/api/src/permission/permission.test.ts`(seed 出的 `overview` 模組)。

正本:`apps/e2e/src/specs/scenario-13-overview-module.spec.ts`、`docs/testing/permission-scenarios.md`

## 使用者說明(help.md)

[overview.help.md](../../apps/admin/src/md/module-help/base/overview.help.md)(租戶使用者說明,build 時打包進說明彈窗)。

正本:`apps/admin/src/md/module-help/base/overview.help.md`

## 平台視角備註

- 總覽內容定案前是佔位頁;加內容時先在本檔權限表補個別權限、再改 seed。
- 新加的模組會自動進租戶管理員模板,但既有租戶的副本不會自動拿到(ADR-0009)—— 總覽之後若加個別權限,既有租戶要另行授予。

正本:`apps/db-migrator/seeds/base/role-bindings.ts`
