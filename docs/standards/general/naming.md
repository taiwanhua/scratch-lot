# 命名(GEN)

## GEN-01 檔名依內容分三種:元件 PascalCase、hook camelCase、其餘 kebab-case

(決策見 ADR-0012;lint:`@repo/eslint-config/frontend-style` 的 `unicorn/filename-case` 三條,admin / front / ui 皆已啟用)

正本:`packages/config-eslint/frontend-style.js`、`apps/admin/eslint.config.js`、`apps/front/eslint.config.js`、`packages/ui/eslint.config.mjs`

| 檔案是什麼                                  | 檔名                               | 例                                                        |
| ------------------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| React 元件(`.tsx`)                          | **PascalCase**,檔名 = 匯出的元件名 | `SideNav.tsx`、`SideNav.test.tsx`、`Button.stories.tsx`   |
| hook(含 zustand store,回傳值給元件用的都算) | **camelCase**,`use` 開頭           | `useMe.ts`、`useSession.ts`、`useRouteTabsStore.ts`       |
| 其餘:工具、常數、型別、設定、測試支援       | **kebab-case**                     | `module-tree.ts`、`auth-fetch.ts`、`paths.ts`、`setup.ts` |

資料夾規則(與 STRUCT-03 的分層搭配):

- 元件**有子元件才開同名資料夾**;單檔就夠的元件直接放檔,不硬開資料夾。例外是**頁面一律資料夾**(路由 = 資料夾,STRUCT-03)。
- 子元件放在**唯一使用它的父元件**資料夾底下;同一層有多個葉元件可用一個 PascalCase「分組資料夾」收起來(裡面沒有同名元件)。
- **路徑別名 `@/` = 該 app 的 `src/`**(tsconfig `paths` + Vite alias + jest `moduleNameMapper` 三處同一份約定;Next 原生讀 tsconfig):往上兩層以上的引用一律 `@/`(`@/hooks/base/useMe`、`@/lib/base/paths`),同資料夾、子資料夾、或只往上一層的用相對路徑(`./SortableTab`、`../user-manager-types`)。`@/` 與 `@repo/*` 不衝突:前者只攔 `@/` 開頭,後者是 workspace 套件名。
- **不用 `index.ts` barrel**,import 寫到檔案:`import { SideNav } from "./SideNav/SideNav"`。子元件只給父用這件事靠位置與 review 表達,不靠 index 藏。**唯一例外是 packages 的對外出口檔**(`packages/ui/src/button.ts` → `export * from "./Button/Button"`):bunchee 只從 `exports` 名反推 `src/<名>.ts`,子路徑要 kebab、元件檔要 PascalCase,所以每個子路徑一個 3 行出口檔;它是套件邊界不是內部捷徑,package 內部 import 仍寫到檔案。
- 測試與 story 跟元件同資料夾、同名:`Foo.tsx` / `Foo.test.tsx` / `Foo.stories.tsx`(ui 的三件套)。分組資料夾(如 `icons/`)底下一組小元件共用一個測試檔時,以資料夾名的 PascalCase 命名(`icons/Icons.test.tsx`)。
- **Windows 改大小寫的坑**:`git` 的 `core.ignorecase=true` 會讓 `button/` → `Button/` 這種只改大小寫的搬移在 index 留下舊名,Linux CI 上找不到檔。改名後用 `git rm -r --cached <舊路徑>` 再 `git add <新路徑>`,並以 `git ls-files | grep -i <名>` 確認 index 只有一份。

```
✅ app/AdminShell/SideNav/SideNav.tsx
✅ app/AdminShell/SideNav/NavNodes/NavNodes.tsx
✅ app/AdminShell/SideNav/NavNodes/NavItems/NavGroupItem.tsx   ← 分組資料夾 NavItems,裡面兩個葉元件
✅ app/AdminShell/SideNav/NavNodes/NavItems/NavLinkItem.tsx
✅ hooks/base/useMe.ts     lib/base/module-tree.ts
   (遞迴樹拆成葉元件時,葉元件不 import 回遞迴層 — NavGroupItem 收 `children`,遞迴只留在 NavNodes,否則撞 `import-x/no-cycle`)
❌ features/shell/side-nav.tsx(一檔四個元件、kebab)   ❌ SideNav/index.ts
```

框架例外(lint 已排除):Next.js `app/` 路由檔(`page.tsx`、`layout.tsx`…)由框架命名並 default export;app 組裝層的非元件 tsx(`main.tsx`、`routes.tsx`、`module-pages.tsx`)與 `test/` 底下的測試支援檔(`render.tsx`、MSW handlers)用 kebab。`__tests__` 目錄慣例保留。lint 只檢查**檔名**(含把 `use-me.ts` 改成 `useMe.ts`),資料夾命名靠規範與 review。

## GEN-02 識別符英文,使用者可見文案繁體中文

變數、函數、型別、GraphQL schema 一律英文;渲染到畫面上的文字、錯誤訊息的使用者可讀部分一律繁體中文。

```tsx
✅ const emptyMessage = "還沒有食譜,快來新增第一道菜!";
❌ const 空訊息 = "No recipes yet";
```

## GEN-03 型別 PascalCase;props 介面叫 `XxxProps`;不加 `I` 前綴

```ts
✅ interface LinkProps { … }
❌ interface ILink { … }
```

## GEN-04 布林值用 is / has / should / can 開頭

```ts
✅ const isLoading = …;  const hasError = …;  newTab?: boolean; // 既有例外,沿用
❌ const loading = …;    const error = …;     // 讀不出是布林
```

## GEN-05 自己命名時縮寫詞當一般單字;沿用外部庫的名稱不改

```ts
✅ const apiUrl = …;  const toJsonString = …;           // 自己命名
✅ import { GraphQLClient } from "graphql-request";        // 外部庫,原樣沿用
❌ const APIURL = …;
```

## GEN-06 workspace 套件名一律 `@repo/` 前綴,無例外

apps 與 packages 的 `package.json` name 統一加 scope,避免與 npm 套件撞名(例:app 叫 `storybook` 會和它依賴的 `storybook` 套件衝突)。

```
✅ "@repo/admin"、"@repo/api"、"@repo/ui"
❌ "admin"、"storybook"
```
