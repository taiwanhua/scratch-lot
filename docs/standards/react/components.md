# React 元件寫法(REACT)

## REACT-01 箭頭函數 + 具名匯出;props 用 `export interface XxxProps` 獨立宣告

(決策見 ADR-0012;lint:`func-style` / `react/function-component-definition`,admin / front / ui 皆已啟用。正本:`packages/config-eslint/frontend-style.js`)

```tsx
✅ export interface ShellAppBarProps {
     me: MeQuery["me"];
     title: string;
   }
   export const ShellAppBar = ({ me, title }: ShellAppBarProps) => { … };

❌ export function ShellAppBar({ me, title }: Readonly<ShellAppBarProps>) { … }   // function 宣告 + Readonly 包 props
❌ export const ShellAppBar = ({ me, title }: { me: …; title: string }) => { … }   // props 型別寫在參數裡
❌ export default ({ href }: any) => { … }
```

- 元件、hook、一般函式**一律箭頭函數**;只有需要 overload 或 `function*` 的才用 `function` 宣告,並以行內豁免附原因(STRUCT-05)。
- props 型別**獨立宣告、`export`、用 `interface`**(GEN-03 命名 `XxxProps`);參數不再包 `Readonly<>`(props 本來就不該改,包起來只是雜訊)。**例外**:props 是外部庫型別的直通別名(`export type ButtonProps = MuiButtonProps`,含 union、泛型)時用 `type`,因為 `interface extends` 對 union 不成立、對空 body 會撞 `no-empty-object-type`;自己定義形狀的才用 `interface`(ui 的慣例)。
- Next.js 的 page / layout 也照箭頭函數寫,只是最後 `export default HomePage`(`const HomePage = async ({ params }: HomePageProps) => { … }; export default HomePage;`),不需要豁免 `func-style`。
- Next.js 的 page / layout 必須 default export,屬框架要求的例外。

## REACT-02 狀態放哪:照決策樹;跨元件的用戶端狀態用 zustand

(決策見 ADR-0012:zustand 是唯一的跨元件狀態容器)

1. 伺服器資料 → TanStack Query(codegen hooks),**不要**複製進 useState 或 store。
2. URL 能表達的(頁碼、篩選、排序、頁內分頁、打開的詳情)→ URL。admin 一律經 `useUrlState`,頁內分頁用 `PageTabs`(REACT-14);哪些不進 URL 也見 REACT-14。
3. 只有單一元件用 → `useState`。
4. 跨元件的用戶端狀態(登入狀態、語言、路由頁籤…)→ **zustand**:`stores/{base,project}/useXxxStore.ts`,需要跨重新整理保留的用 `persist` middleware(sessionStorage / localStorage 由該狀態的規則決定)。
5. context **只剩注入用**(theme、QueryClient、Intl provider、`AuthSession` 實例),不承載會變的狀態;redux / 自刻 `useSyncExternalStore` store 不用。注入用的 context 物件**與它的 hook 同檔、放 `hooks/`**(`hooks/base/useSession.ts` 同時匯出 `SessionContext` 與 `useSession`),provider 元件放 `app/providers/`。

```ts
✅ export const useLocaleStore = create<LocaleState>()(persist((set) => ({ … }), { name: adminStorageKeys.locale, storage: localeStorage }));
❌ const LocaleContext = createContext<{ locale; setLocale }>(…)   // 承載狀態的 context
```

### `persist` 的兩件事

**① 沿用既有 storage key 與格式時要保住舊格式**(`docs/branding.md` 登記的那些)。`persist` 預設寫 `{ state, version }` 的 JSON 封包,直接套上去會讓既存值失效、既有測試的 storage 斷言也會壞。先分辨既存格式是哪一種再決定怎麼寫:

- **既存格式本來就是 `persist` 的 JSON 封包**(只是換了 storage 後端、換了 key、讀取時要多墊一層搬移)→ **只換 `StateStorage`**:自訂一個 `getItem` / `setItem` / `removeItem` 的三方法物件,用 `createJSONStorage(() => …)` 包起來交給 `persist`。序列化仍由 zustand 做,`version` / `migrate` 也照常運作。先例 `stores/base/useSideNavStore.ts`。
- **既存格式不是 JSON 封包**(裸字串、自己手寫的格式)→ 才整份自訂 `PersistStorage<S>`(`getItem` 要自己回 `{ state, version }`),因為序列化的形狀根本對不上。先例 `stores/base/useLocaleStore.ts`(localStorage 存的是 `"en"` 這種語言代碼字串)與 `stores/base/useRouteTabsStore.ts`。

換句話說:`createJSONStorage` 管「存到哪」,`PersistStorage` 管「存成什麼形狀」;只有後者不對時才寫後者。

**② key 依使用者分把的**(如頁籤的 `…:<userId>`),store 提供 `bind(userId)` 以 `persist.setOptions({ name }) + rehydrate()` 換 key,不要把 userId 寫死在 `name`。

## REACT-03 業務邏輯離開 JSX

JSX 內只放渲染邏輯;超過幾行的計算、轉換、條件組合抽成 hooks(有狀態)或 utils(純函數)— 這也是讓邏輯可測的前提。

```tsx
✅ const { totalMinutes } = useRecipeStats(recipe);
❌ <p>{recipe.steps.reduce((a, s) => a + s.minutes, 0) + (recipe.prep ? … : …)}</p>
```

## REACT-04 front 預設 Server Component,`"use client"` 下推到葉子

只有需要互動(事件、hooks、瀏覽器 API)的元件才標 `"use client"`,而且標在最小的葉子元件上,不要整頁標掉。(admin 是純 client 的 Vite app,不適用本條。)

## REACT-05 props 傳遞超過兩層先重組,composition 優先於 context

```tsx
✅ <RecipeCard actions={<DeleteButton id={recipe.id} />} />   // 用 children/slot 組合
❌ <RecipeCard onDelete={onDelete} />  // onDelete 只是為了往下傳第三層
```

## REACT-06 遵守 `eslint-plugin-react-hooks` v7 的 compiler 規則

lint 入口啟用的 react-hooks v7 除了 `rules-of-hooks` / `exhaustive-deps`,還有 React Compiler 的一組規則,它們實質決定狀態要怎麼寫:

- `set-state-in-effect`:**effect 內不可直接 setState**(同步 storage、依網址補 tab 這類「衍生狀態」都算)。要嘛在 render 期間用 `useMemo` 推導,要嘛把狀態放進 zustand store(REACT-02),由 store 的 action 與 `persist` 處理副作用
- `refs`:render 期間不讀寫 `ref.current`;只在事件處理與 effect 內用
- `globals`:render 期間不改模組層變數
- `immutability`:props / state 不就地修改,陣列用 `toSorted` / 展開建新值

判斷順序:能用 `useMemo` 從既有 state / props 推導 → 推導;需要跨元件、跨 render 存活且有副作用(storage、channel)→ zustand store;仍不夠再談。

render 期呼叫 store action **只允許冪等的初始化**(放 `useState` 的 lazy 初始化器,只跑一次;例:殼 mount 時 `bind(userId)` + `sync()` 讓首次渲染就有 tab),其餘 action 一律在 effect 或事件處理內。

## REACT-07 一檔一元件;單檔以 300 行為目標,超過就拆

(決策見 ADR-0012;lint 硬上限 `max-lines` 400,admin / front / ui 皆已啟用)

- 一個 `.tsx` 只匯出一個元件(檔名 = 元件名,GEN-01);同檔可以有它專用的小型 helper,但不能有第二個元件。
- 300 行是**目標不是門檻**:301 行不算違規,重點是切得合理。拆法依序:子元件(放到同名資料夾底下,GEN-01)→ 有狀態的邏輯抽 hook(`useXxx.ts`,只有這個元件用就跟元件同資料夾)→ 純函式抽到 `lib/`(REACT-03)。
- **300 與 400 都不計註解與空行**:與 lint 設定一致 —— `packages/config-eslint/frontend-style.js` 的 `max-lines` 是 `{ max: 400, skipBlankLines: true, skipComments: true }`,所以數的是**程式碼行**。純型別 + JSDoc 的介面檔(如 `components/base/crud/demo-module-config.ts`,檔案超過 300 行)實際程式碼遠低於 300,不算超標、也不必為了行數把註解搬走。判斷要不要拆時看 lint 報的數字,不看編輯器的行號。
- 400 行由 lint 擋,超過就一定要拆;300 到 400 之間的在 PR 說明為何不拆。

```
✅ RouteTabs/RouteTabs.tsx(列的組裝)+ RouteTabs/SortableTab.tsx(單一 tab)+ RouteTabs/useRouteTabs.ts
❌ route-tabs.tsx 315 行,RouteTabs 與 SortableTab 同檔
```

## REACT-08 彈窗的初始值:關閉即卸載、props 進 `useState`、非同步資料外層 gate

REACT-06 禁止 effect 內 setState,所以「開彈窗時把資料塞進表單」不能寫 `useEffect(() => setValues(data), [data])`。固定模式(組織管理、使用者管理的彈窗都這樣寫):

- 彈窗**關閉就卸載**(`open && <Dialog …/>`),每次開啟都是新的元件;
- 初始值由 props 帶入 `useState` 的初始化器(`useState(() => toForm(org))`);
- 需要先取單筆的編輯彈窗,在外層 gate:資料到了才掛載表單元件(`org.data ? <EditOrgForm org={org.data} /> : <Loading />`)。

## REACT-09 槽位(slot)元件一律是模組層常數;逐列資料走 context

(適用所有吃 `slots` / `components` 的外部庫;先例是 `@repo/ui` 包 `RichTreeView` 的 `Tree/`)

MUI X 的 `RichTreeView`、DataGrid 這類元件收的是**元件本身**,不是元素。把槽位元件定義在 render 內(或用閉包把該列的資料綁進去),每次 render 都是一個新的函式身分 → 整棵樹重新掛載,狀態、焦點與展開都會掉。

- 槽位元件**寫在模組層**(自己的檔案,PascalCase;REACT-07),`slots={{ item: TreeItemRow }}` 傳的是常數;
- 逐列要用的資料由**容器先攤平成一份 `ReadonlyMap<id, RowState>`,經 context 交給槽位元件**,槽位元件用 `useContext` 自取,不靠 props 閉包;
- context 只當注入通道(REACT-02 第 5 點),值本身是 `useMemo` 出來的唯讀快照。

```tsx
✅ // Tree/tree-rows.ts:型別 + context(kebab,非元件)
   // Tree/TreeItemRow.tsx:槽位元件,useTreeRow(itemId) 取自己那一列
   <RichTreeView slots={{ item: TreeItemRow }} />
❌ <RichTreeView slots={{ item: (props) => <Row {...props} state={rows.get(props.itemId)} /> }} />
```

**ui 包裝層的 props 分工**:**內容類**的 props(`labelSuffix`、`actions`、`disabled` — 這一列長什麼樣)跟著**節點資料**走;**狀態類**的 props(`selectedIds`、`expandedIds`、`indeterminateIds`、`disabledCheckIds`)是**扁平的 id 陣列**。理由是後者每勾一次就變,若塞回節點資料就得重建整棵 `items`,而重建 `items` 會讓底層元件重建內部 store —— 權限矩陣每點一下都要付那個代價。

## REACT-10 提示文字一律用 `@repo/ui/tooltip`,不寫原生 `title`;預設 `describeChild`

正本:`packages/ui/src/Tooltip/Tooltip.tsx`

`@repo/ui/tooltip` 的 `Tooltip` **與 MUI 的預設不同,`describeChild` 預設是 `true`**,理由是提示在共用介面一律是「補充說明」而不是「這顆按鈕叫什麼」:

- `describeChild` 為 `true` → 掛 `aria-describedby`,**元素原本的無障礙名稱留著**;
- MUI 的預設(`false`)會掛 `aria-label`,**把名稱整個蓋掉** ——「停用」按鈕會變成叫「平台根組織不可停用」。

規則與呼叫端要知道的四件事:

- **app 裡不要再寫原生 `title`**(STYLE-05 的元件牆同理):原生 `title` 的外觀不受 theme 控制、延遲不可調、觸控裝置看不到。
- 真的需要提示**當名稱**時(圖示按鈕沒有可見文字)才明示 `describeChild={false}`,並在 PR 說明為什麼。典型是**沒有可見文字的圖示按鈕**:側欄收合態的圖示列(`SideNav/NavRail`,提示就是模組名稱)、列表列尾的檢視 / 編輯 / 刪除圖示鈕、設計器裡的移除鈕 —— 留 `describeChild` 為 `true` 會做出一個「沒有無障礙名稱、只有描述」的按鈕。判準是**「提示的文字念出來就是這顆元件的名字」**;只要元素本身已有可見文字(按鈕上有字、旁邊有 label),提示就是補充,維持預設。
- **disabled 子元素由元件內部包 `span`**(disabled 元素不發 hover 事件),呼叫端不要自己再包一層;可用的元素則直接掛在 child 上,`aria-describedby` 仍指向它本身。
- `title` 傳 `""` / `undefined` 就不提示,所以條件式提示直接寫 `title={isLocked ? hint : ""}`,不要條件式地換掉整棵子樹。

**測試怎麼斷言**(配 TEST-08 / TEST-09):提示是 portal 出去、hover 後才出現的節點,用 `await userEvent.hover(trigger)` + `await screen.findByRole("tooltip")` 取它的文字。**不要驗 `toHaveAttribute("title", …)`** —— 改用 `Tooltip` 之後 DOM 上根本沒有 `title`,舊斷言會紅。

## REACT-11 表單下拉一律用 `@repo/ui/select-field` 的 `SelectField`

正本:`packages/ui/src/SelectField/SelectField.tsx`

表單裡「從固定幾個選項挑一個(或幾個)」的欄位,一律用 `SelectField`:**`label` 就是浮動標籤兼無障礙名稱,欄位下的說明用 `helperText`**,選項以 `options: { value, label, disabled? }[]` 傳入。

```tsx
✅ <SelectField label={t("owner")} value={ownerId} displayEmpty helperText={t("ownerHint")}
     options={[{ value: "", label: t("ownerUnset") }, ...candidates]} onChange={setOwnerId} />
❌ <Typography variant="caption">{t("owner")}</Typography>
   <Select aria-label={t("owner")} …><MenuItem …/></Select>          // 裸 Select + 自畫標題
❌ <TextField select label={t("owner")} …><MenuItem …/></TextField>   // 各自拼,空值 / 型別轉換各寫一份
```

- **空值項**(「未指定」「全部」)放進 `options`(`value: ""`)並開 `displayEmpty`;不要另外用 `Typography` 畫提示或標題。
- `onChange` 收到的是**選項的 `value` 本身**(以 `options` 查表),`Value` 可以是 enum / 字面量聯集,呼叫端不再 `event.target.value as X`。
- 多選用 `multiple`(選項自帶勾選框、`onChange` 依點選先後回整個陣列),收合摘要不合用時給 `renderValue`。
- 需要搜尋、分組、次文字或 chip 時改用 `@repo/ui/autocomplete`(STYLE-05 的分工:選項少於十個、不需搜尋 → `SelectField`)。
- 殼的當前組織切換器也是 `SelectField`(標籤「當前組織」)。**不適用**:幾個互斥選項、切了立刻生效的設定(頭像選單的外觀、語言)用 `@repo/ui/segmented-control`;選單式動作(登出)用 `@repo/ui/menu`。

## REACT-12 彈窗開著時,提示也要念得到:live region 不能是彈窗開啟前就在 body 裡的節點

MUI 的 modal manager 在 Dialog 開啟那一刻把 body 底下**已存在**的其他節點全標 `aria-hidden`,掛在 app 根節點裡的 Snackbar 因此看得到、念不到;admin 的解法是 `app/providers/SnackbarAnnouncer.tsx` —— 每一則提示各自 portal 一個視覺隱藏的 `role="status"` 到 body 末端(掛上時間晚於彈窗開啟),只在 Snackbar 被藏起來時才填字,測試以 `findByRole("status")` / `test/snackbar.ts` 的 `findSnackbarAlert()` 驗,**不帶 `hidden: true`**。

## REACT-13 表格欄位的渲染簽章:`render(ctx)`;小表用 `Table`、大量資料用 `DataTable`

正本:`packages/ui/src/DataTable/cell-render-context.ts`(型別)、`packages/ui/src/DataTable/DataTable.tsx`、`packages/ui/src/Table/Table.tsx`

兩個表格元件的欄位共用同一份渲染參數 `CellRenderContext<Row>`:

```ts
interface CellRenderContext<Row> {
  value: unknown; // 由 column.accessor(欄位名或函式)取出的值
  row: Row;
  rows: readonly Row[]; // 顯示順序(排序後),rows[index] === row
  index: number;
  column: CellRenderColumn<Row>; // key / header / accessor / align / width / minWidth / pinned / isSortable / isEmphasized
}
```

- **`DataTable`**:`render?: (ctx) => ReactNode`;沒給 `render` 時直接顯示 `ctx.value`(字串、數字原樣,空值與物件不顯示)。排序比的也是 `accessor` 取出的值,所以要能排序的欄一定要給 `accessor`。
- **`Table`**:`render: (row, ctx) => ReactNode`,`ctx` 是**選填的第二參數**,只看 `row` 的既有寫法不必改;`ctx.value` 只在給了 `accessor` 時才有值。
- 要看「別列」的邏輯(合計、累計、與上一列比較、奇偶列)一律從 `ctx.rows` / `ctx.index` 取,不要在呼叫端另外維護一份排序後的陣列 —— 排序改變時兩邊會對不上。
- `ctx` **不帶翻譯函式**(I18N-01:`@repo/ui` 語言無關);欄內文字由呼叫端在閉包裡用自己的 `t` 取。
- 布林旗標依 GEN-04 命名(`isSortable`、`isEmphasized`);`pinned` 是 `"left" | "right"`。

**選哪一個**:

| 情境                                                           | 用                          |
| -------------------------------------------------------------- | --------------------------- |
| 治理頁的小表、彈窗裡的表、有分頁的清單(一頁幾十列)             | `@repo/ui/table` 的 `Table` |
| 大量資料(上百到上萬列)、需要欄寬拖拉、欄位固定、表頭排序的列表 | `@repo/ui/data-table`       |

`DataTable` 的三件事:①列虛擬捲動,**捲動容器要有確定的高度**(父層是 STYLE-08 的 `flex: 1; minHeight: 0` 欄,或以 `containerSx` 給 `height` / `maxHeight`),高度跟著內容長時等於沒有虛擬化;②排序與欄寬都是「給了就受控(`sort` + `onSortChange`、`columnWidths` + `onColumnWidthsChange`),沒給就內部管」,資料已由 api 排好時加 `isManualSorting`;③儲存格不折行、超出寬度以省略號截斷(列高一致,虛擬捲動才量得準),要完整內容就加寬或在 `render` 裡放 `Tooltip`。

## REACT-14 admin 的頁面狀態放網址:一律用 `useUrlState`,頁內分頁用 `PageTabs`

正本:`apps/admin/src/hooks/base/useUrlState.ts`、`apps/admin/src/lib/base/url-state.ts`、`apps/admin/src/components/base/PageTabs/`

重新整理、分享網址之後,頁面都要回到同一個狀態;殼的路由頁籤也記「路徑 + 網址參數」,切走再切回來、從側欄點已開著的那一頁,都回到離開時的條件(關掉頁籤再從側欄打開才是預設條件);頁面內的「返回列表 / 取消 / 存完離開」也經 `useRouteTabHref` 帶回列表頁籤記下的條件,不直接 `navigate(listRoute)`。新頁面**不自行讀寫 `useSearchParams`**(也不直接用 nuqs),一律經 `useUrlState(key, schema)`:

```ts
✅ const listSchema = z.object({ status: z.enum(["all", "done"]), page: z.number().int().min(1) })
     .default({ status: "all", page: 1 });          // 模組層常數;預設值就寫在 schema
   const [list, setList] = useUrlState("list", listSchema);
   setList((current) => ({ ...current, page: 2 }));  // ?list={"status":"all","page":2}
❌ const [searchParams, setSearchParams] = useSearchParams();   // 自己解析、自己驗、自己給預設值
❌ const [page, setPage] = useState(1);                          // 能進網址的篩選留在 useState
```

- **一個 key 一包值**:同一個區塊的篩選、關鍵字、排序、頁碼放同一個 key(物件寫 JSON);同一頁有兩個互不相干的區塊(對應不同 API)才分兩個 key。字串直接寫(`?tab=mine`)。
- **schema 必須 `.default(…)`**(型別上就只收帶預設值的 schema,沒帶編譯不過):網址沒有這個 key、或被手改壞(JSON 壞掉、值不在列舉裡、舊格式)時回到預設值,不報錯,壞掉的那一個 key 以 `replace` 從網址清掉;寫回預設值時 key 自動從網址拿掉。schema 放模組層常數。
- **頂層 schema 不要用「字串與其他型別的 union」,也不要用 `z.coerce`**:字串原樣寫進網址,讀回時先把原字串交給 schema,所以 `z.union([z.string(), z.number()])` 寫進去的 `2` 讀回來會變成字串 `"2"`,`z.coerce` 也會把任何字串硬轉過去。要混型別就包成物件(`{ kind, value }`)。
- 寫入是 `replace`(不堆上一頁紀錄),並經 react-router 的 navigate,`useLocation` 讀到的網址與畫面一致。
- **頁內分頁用 `PageTabs`**,不要自己拿 `Tabs` + `useUrlState` 拼:它把目前分頁記在 `?tab=`、依 `permission` 藏掉沒權限的分頁、只剩一個分頁時不顯示分頁籤、放不下時單列捲動並把選到的分頁捲進可視範圍。只有兩類例外直接用 `@repo/ui/tabs`(受控 `value` / `onChange`):
  - **切換需要被攔下**:例如有未存變更時要先確認(設計器的「設計 / 預覽」、版本檢視、角色管理的「權限設定 / 分配使用者」);`PageTabs` 不提供 `onBeforeChange`。不綁在某一筆上的(角色管理)目前分頁仍以 `useUrlState` 記在 `?tab=`。
  - **分頁綁在某一筆資料上**:換一筆資料就該回到第一頁(以 `key={id}` 重來),記在網址反而會讓分頁跟著跑到別筆。

| 放進網址                                                                                     | 不放進網址                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 列表的篩選、關鍵字、排序、頁碼                                                               | 表單還沒存的輸入內容                                                                                                                                   |
| 報表的期間、分店、報表種類                                                                   | 敏感資料(身分證字號、金額明細等)                                                                                                                       |
| 頁內分頁(`PageTabs`)                                                                         | 大量資料(例如勾選的大量 id)                                                                                                                            |
| 目前打開的詳情:主從版面選中的那一筆(例 `?detail=<id>`)、唯讀的檢視彈窗(例 `?dialog=retired`) | 暫時性介面狀態(展開、hover 等)                                                                                                                         |
|                                                                                              | 編輯、新增、確認類彈窗(刪除 / 停用 / 撤銷):內容是還沒存的輸入或一次性的動作確認,重新整理就該從頭來;放進網址等於分享出去的連結一打開就停在「確定刪除?」 |

- **key 慣例**:列表一包 `list`;主從版面選中的那一筆 `detail`(`hooks/base/useUrlSelectedId`);頁內分頁 `tab`;唯讀的檢視彈窗 `dialog`(值是彈窗名)。不用 `view`:mock 開發模式以 `?view=tenant` 切視角。
- **新頁面要登記進入口清單**:底座頁登記在 `apps/admin/src/app/base/url-state-inventory.ts`、專案頁在 `app/project/url-state-inventory.ts`,寫明這一頁放進網址的 key(`app/url-state-inventory.test.ts` 比對)。`useUrlState` 以外直接 import `useSearchParams` 或 nuqs 由 ESLint(`no-restricted-imports`)擋下。各頁的盤點見 `docs/concepts/frontend-architecture.md`「既有頁面改用的盤點」。
