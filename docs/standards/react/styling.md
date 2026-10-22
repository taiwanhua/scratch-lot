# Styling(樣式)

適用:front / admin / ui 所有 React 元件。技術選型:MUI + Emotion(`sx` 為主),
theme 為唯一樣式來源(兩層 tokens:品牌層 → 語意層,見 `packages/ui/src/theme/`)。
選型理由:評估過全轉 Tailwind 與 MUI+Tailwind 混用,皆否決 —— 單一樣式系統對 AI 產碼與
review 最友善;Minimal Dashboard 級的統一感靠 theme 工程達成。

## STYLE-01 禁魔法值:樣式值一律取自 theme

顏色、間距、圓角、字級、陰影、斷點不出現裸值(hex、rgb、裸 px)。
取用管道:語意 token(`theme.palette.*`)、`theme.spacing()`(sx 內寫數字即可,如
`p: 2`)、`theme.shape.borderRadius`、`theme.typography.*`、`theme.shadows[n]`。

例外:`0`、`1px`(邊框)、`100%` / `auto` 這類與品牌無關的佈局值。

## STYLE-02 `sx` 為主;重複第三次就抽

- 一次性樣式寫 `sx`;同樣的樣式組合用到**第三次**,抽成 styled 元件或收進 `@repo/ui`
- 禁 `style={}` inline style
- 禁新增 `.css` 檔(現存 `apps/front/src/app/[locale]/styles.css` 為鷹架殘留,元件 MUI 化時一併移除)

## STYLE-03 響應式只用 theme 斷點

用 `sx` 的斷點物件語法(`{ xs: ..., md: ... }`)或 `theme.breakpoints`;不手寫
`@media` 查詢。

## STYLE-04 深色模式只透過 palette

theme 已開 `cssVariables` + light/dark colorSchemes;元件不判斷「現在是深色嗎」、
不寫 `prefers-color-scheme` — 用對語意 token,深色模式自動正確。
使用者切換外觀(跟隨系統 / 亮 / 暗)只走 `@repo/ui/app-theme-provider` 的 `useColorMode`
(選擇由 `AppThemeProvider` 記在 localStorage,key 由 app 傳入並登記在 `docs/branding.md`)。

## STYLE-05 apps 不直接 import MUI/Emotion(lint 強制)

front/admin 只從 `@repo/ui` 拿元件;`@mui/*`、`@emotion/*` 由
`no-restricted-imports` 擋下(`packages/config-eslint` 的 `designSystemWall`,
只套 apps,ui 套件自身可用)。缺的元件到 `packages/ui` 包一層再用 — 就算第一版
只是 re-export,也讓「哪些元件在系統裡」有唯一清單,版本與客製集中一處。

**包一層時碰到外部庫的型別擋路,換掉它的 slot 元件,不要 `as` 硬轉**(先例 `packages/ui/src/Tree/`):
`RichTreeView` 的 `slotProps.checkbox` 只宣告成 `HTMLAttributes`,`indeterminate` / `disabled`
根本傳不進去。做法是 `slots={{ checkbox: TreeItemRowCheckbox }}` 換成自家的
`@repo/ui` `Checkbox`,狀態經 context 交給它(REACT-09)—— 順帶讓三態勾選框的外觀
與 admin 其他勾選框一致(MUI 內建的那顆長得不一樣)。
`as unknown as` 硬轉只是把錯誤推到執行期,而且下一版庫改型別就再撞一次。

**MUI 圖示只在 `packages/ui` 以單檔路徑 import**:`@mui/icons-material` 有上萬個圖示,
`import { X } from "@mui/icons-material"` 或 app 直接相依都會把整包拖進 bundle。`@mui/icons-material`
只列在 `packages/ui` 的 dependencies,apps 拿不到;ui 內一律寫**單檔路徑**
`import X from "@mui/icons-material/XOutlined"`(風格一律 Outlined)。app 拿圖示的出口有兩個:

- **介面圖示**:`@repo/ui/icons` 的具名元件(`EditIcon`、`DeleteIcon`、`LightModeIcon`…),一個圖示一支檔,
  出口在 `packages/ui/src/icons/index.ts`;
- **模組圖示**:`packages/ui/src/icons/module-icon-registry.ts` 的 `MODULE_ICONS` 白名單登錄表(29 個,
  在 admin bundle 約 8 KB 未壓縮),app 只用 `moduleIconOf(key)` 與 `@repo/ui/module-icon-picker`。

要多一個圖示就在 ui 加一支(或在登錄表加一列),順帶在 Figma「Icons」頁加同名變體,不在 app 端 import。

**從登錄表取出的圖示不要在 render 內宣告成變數**:`react-hooks/static-components`
會把元件內的 `const Icon = moduleIconOf(key)` 判成「render 期間產生元件」而報錯 —— 登錄表這種
「元件是資料」的用法一定會撞到。兩種寫法擇一:

```tsx
// 1. 在元件外解構成常數(key 是靜態的時候)
const DashboardIcon = moduleIconOf("dashboard");

// 2. key 是動態的:用 createElement,不要先接成大寫變數
return createElement(moduleIconOf(module.icon), { fontSize: "small" });
```

**目前已知缺的元件:沒有**(缺的期間用原生替代並在 PR 記一筆,不要在 app 裡直接 import MUI)。
常被問到的元件與入口(完整清單的正本是 `packages/ui/package.json` 的 `exports`,每個子路徑對應
`packages/ui/src/<子路徑>.ts` 出口檔與 `packages/ui/src/<元件>/`):

| 元件                                                      | 入口                                                 | 用在哪 / 規則                                  |
| --------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| `Tooltip`                                                 | `@repo/ui/tooltip`                                   | 一切提示文字;用法與 disabled 子元素見 REACT-10 |
| `Tabs`                                                    | `@repo/ui/tabs`                                      | 頁內頁籤;殼的路由頁籤是另一個東西 `RouteTabs`  |
| `SelectField`                                             | `@repo/ui/select-field`                              | 表單下拉:浮動標籤 + helperText(REACT-11)       |
| `Autocomplete`                                            | `@repo/ui/autocomplete`                              | 輸入即搜尋、多選、分組、主 / 次文字            |
| `SegmentedControl`                                        | `@repo/ui/segmented-control`                         | 幾個互斥選項的分段按鈕(頭像選單的外觀、語言)   |
| `Badge`                                                   | `@repo/ui/badge`                                     | 數字 / 小圓點提示(側欄待辦數)                  |
| `DatePicker` / `DateTimePicker`                           | `@repo/ui/date-picker` / `@repo/ui/date-time-picker` | 日期、日期時間欄位                             |
| `Table` / `DataTable`                                     | `@repo/ui/table` / `@repo/ui/data-table`             | 小表 / 大量資料列表(REACT-13、STYLE-11)        |
| `Tag`                                                     | `@repo/ui/tag`                                       | 狀態標籤(tone)                                 |
| `Snackbar`                                                | `@repo/ui/snackbar`                                  | 只由 `SnackbarProvider` 渲染(DATA-06)          |
| `useColorMode` / `AppThemeProvider`                       | `@repo/ui/app-theme-provider`                        | 外觀切換(STYLE-04)                             |
| `useBreakpointDown`                                       | `@repo/ui/media-query`                               | JS 端需要知道斷點時(版面仍用 STYLE-03)         |
| `EditIcon` / `DeleteIcon` / `ChevronDoubleLeftIcon` / `…` | `@repo/ui/icons`                                     | 介面圖示(見上方圖示規則)                       |

**「停用的選項」不能靠 Tooltip 說明原因**:MUI 對 `aria-disabled` 的
Autocomplete 選項下 `pointer-events: none`,hover 根本不會觸發;把它改回 `auto` 又會讓停用的
選項點得下去(`useAutocomplete` 的 `handleOptionClick` 不重驗 `getOptionDisabled`)。
原因一律**就地寫在選項的次文字**(`getOptionDisabledReason`),設計稿(`Draft/Autocomplete`
253:38)畫的也是這樣。同理適用於任何「整列 pointer-events 被關掉」的清單項。

**選單裡要搜尋就用 `Autocomplete`,不要在選單外掛一個搜尋框**:
MUI 的 `Select` 會把選單裡的子元素一律 clone 成 `role="option"`,搜尋框塞進去會變成一個
假選項(a11y 與測試都亂掉);放在選單外面又讓使用者要在兩個控制項之間來回。
`Autocomplete` 的輸入框就是選單的觸發器,兩個問題都沒有。
關鍵字要丟回 api 查的情境(候選有分頁上限)走 `onInputChange`,那會關掉內建的前端過濾。

## STYLE-06 設計稿的值不在 token 裡時:一次性直寫並註記,重複兩處以上補 token

STYLE-01 禁裸值,但 Figma 常給 theme 沒有的值(Tag 字級 11px、Checkbox 圓角 5px、樹縮排 18px、上傳框虛線 1.5px)。規則:

- 只有一個元件用到 → 元件內直寫字面值,**旁邊註記來源**(`// Figma Draft/Tag 76:722:11px,theme 最小 caption 12px`);
- 第二個元件也要同一個值 → 提升為 token(`src/theme/`),兩處都改用 token;
- 能用既有 token 近似而視覺差異可接受的(13px → `body2` 14px、18px 縮排 → MUI 預設)優先用 token,在 PR 記下差異。

## STYLE-07 ui 元件的預設樣式:`styled()` 或 theme `components` 覆寫,呼叫端 `sx` 只能疊加

包 MUI 的元件如果用 `<MuiX sx={defaultSx} {...props} />`,呼叫端傳一個 `sx` 就把預設整包蓋掉。規則:

- 元件的**幾何與 tone 這類必要預設**寫進 `styled()`(元件旁)或 `src/theme/create-theme.ts` 的 `components` 覆寫(全站一致的預設,如 MuiDialog / MuiPopover / MuiChip);
- 呼叫端的 `sx` 一律經 `mergeSx(defaultSx, props.sx)`(`src/theme/sx.ts`)疊在預設之上;
- **MUI 9 的 `sx` 不接受陣列**(`sx={[a, b]}` 型別錯),所以 `mergeSx` 是唯一的合併方式;`Stack` / `Box` 也不再收 `alignItems`、`minWidth`、`flex` 這類 system props,版面值一律進 `sx`。

**多個 sx 槽的命名慣例**:一個元件有兩處以上可讓呼叫端調樣式時(`Table` 的表格本體與捲動容器),`sx` 留給**最外層 / 主體**,其餘槽命名為 **`<槽名>Sx`**(`containerSx`、`headerSx`…),槽名取自它實際套到的那個內部元素;每個槽一樣走 `mergeSx(預設, props.<槽名>Sx)` 疊加,不整包蓋掉。不要每個元件各取一個名字(`tableWrapperSx`、`scrollSx`),呼叫端才不必每次翻原始碼。

## STYLE-08 admin 頁面的高度由殼給:滿版版面用 `flex: 1` + `minHeight: 0`,捲動容器自己標 `overflow: auto`

`ShellLayout` 外框 `height: 100vh` + `overflow: hidden`,`<main>` 是 column flex 且 `flex: 1; minHeight: 0; overflow: auto`,所以頁面拿到的是**確定的高度**。要做「左樹 / 右表格撐滿、各自捲動」的頁面:頁面根容器 `flex: 1; minHeight: 0`(不要 `alignItems: flex-start`),左右兩塊各自 column flex + 內層 `overflow: auto`。Figma 的 Screen frame 把等高與各自捲動畫得很清楚,但那個資訊在 frame 的 width / height 裡,不在截圖裡,實作前用 `get_metadata` 量(只看截圖的實作,組織管理與使用者管理兩頁都曾只撐到內容高度)。

**怎麼守:用 `apps/admin/src/test/height-chain.ts` 驗高度鏈**(撐不滿是反覆被回報的一類):
jsdom 不算版面,驗不到「有沒有真的撐滿」,但撐不滿的**原因**只有兩種,而且兩種都讀得到宣告值 ——
鏈上某層漏了 `min-height: 0`(該層被內容撐高,`flex: 1` 等於沒作用),或鏈上多開了一層捲動。
`heightChainOf(anchor)` 從 `anchor` 往上找到最近的捲動容器,再一路收集到 `<main>`(含),
由內而外回傳每一層的 `minHeight` / `scrolls` / `flexGrow`。**滿版版面的頁面測試一律加一案**,
斷言三件事(先例 `OrgManagerPage.test.tsx`、`UserManagerPage.test.tsx`):

```ts
const chain = heightChainOf(screen.getByRole("tree", { name: "組織樹" }));
expect(chain.at(-1)?.label).toBe("MAIN.MuiBox-root"); // 最外層是 <main>:高度確實是殼給的
expect(chain.map((l) => l.minHeight)).toEqual(chain.map(() => "0")); // 每一層都 min-height: 0
expect(chain.slice(1, -1).filter((l) => l.scrolls)).toEqual([]); // 只有最內層那一層捲
```

實際的視覺滿版仍以 dev(或 mock 模式,TEST-08)目視為準;這個測試守的是「不再退回去」。

**釘高(`flex: 1` + `minHeight: 0`)只給「子樹有一層 `overflow: auto` 能吃掉全部超出量」的版面**:主從版面
(左樹 / 右表各自捲)、整頁只有一張 DataTable(STYLE-11)。其餘 —— 一般內容頁、頁內分頁殼(`PageTabs` 外面那張卡片)、
卡片包表單 / 清單、表格下面還有別的區塊 —— 一律 `flexGrow: 1; flexShrink: 0`:內容少時撐滿、多時跟著長,交給 `<main>` 捲。
**MUI `Card` / `Paper` 預設 `overflow: hidden`**:釘了高的卡片,內容超出的部分直接被裁掉,`<main>` 也沒東西可捲
(通知設定等頁都這樣被回報過)。連帶:

- 主從版面在手機寬(xs)不釘高(`flex: { xs: "1 0 auto", sm: 1 }`):兩塊依內容長高、交給 `<main>` 捲;sm 起才各自捲。
- 直排(xs `column`)時不給 `flex: 2` 之類的比例:flex-basis 0 會把 `overflow: hidden` 的卡片壓矮;比例只在並排的斷點給(`flex: { md: 2 }`)。
- 不釘高的卡片裡放 `@repo/ui/table`,傳 `containerSx={{ height: "auto" }}`:預設的 `height: 100%` 在 flex 欄裡會解析成卡片高度,少掉標題那段。
  傳不了 `containerSx` 的清單(帳戶管理的 `AccountsList` 手機卡片也是 `height: 100%`)改成外面包一層 `flex: 1; minHeight: 0`、只放清單,
  說明文字放在那一層外面(先例 `PeriodCloseTab`)。
- 頁面根是 `Card` / `Paper`(會裁切)時一定要宣告 `flexShrink: 0`(或依上面的條件釘高):沒寫就是預設的 `flex-shrink: 1`,
  裁切元素的 `min-height: auto` 又算成 0,內容一長卡片就被壓到殼高、下半直接消失(個人設定、補打卡新增頁都這樣)。
- 內層捲動區塊(要 sticky 表頭、看得到橫向捲軸的寬表格 / 時間軸)不寫 `calc(100vh - 320px)` 這種依工具列高度的魔術數字:
  量 `<main>` 剩下的空間給上限,空間不足時不設上限(只由 `<main>` 捲),任何尺寸都只有一層垂直捲動
  (`hooks/base/useFitMainHeight.ts`;量測邊界傳**只含內容、不含並排側欄**的那一欄,含了比內容高的側欄,上限會來回跳)。
- 測試:頁殼卡片斷言 `flex-shrink: 0`;殼本身斷言 `<main>` 可捲、`shell-content` 不裁切(先例 `app/AdminShell/ShellLayout.test.tsx`);量測 hook 見 `hooks/base/useFitMainHeight.test.tsx`
  (它觀察 `<main>`、邊界與邊界往上到 `<main>` 的每一層:上方工具列在資料載入後換行長高時,只有外層會變尺寸)。
  **通用守門** `app/PageRootHeight.test.tsx`:用 mock 假世界(TEST-08)渲染每個有模組的列表頁、新增頁與個人設定,
  以 `test/height-chain.ts` 的 `squeezedPageRootProblem` 驗頁面根 —— 會裁切的根要 `flex-shrink: 0`,或釘高且子樹有一層
  經 `min-height: 0` 接上來的捲動容器;頁內分頁殼(根裡有 `tabpanel`)不得釘高。新頁只要在假世界有模組就自動納入。

**同一條鏈只標一次 `overflow: auto`**:父子兩層各標一次時,平常看不出來 ——
兩層都是「高度跟著內容長」就不會有人捲;等到內層拿到確定高度(或內容給了 `minWidth`),
就會冒出兩條捲軸,而且橫向那條貼在最後一列下方、卡在版面中間。決定**哪一層負責捲**,
其餘只留 `flex: 1; minHeight: 0` 把高度傳下去。連帶:`overflow-x: auto` 的元素,它的
`overflow-y: visible` 依 CSS 規範計算為 `auto`,**一個元素同時管好兩軸**,外層不需要再開一層
(列表頁的 `TableContainer` 就是那一層,見 STYLE-11)。

## STYLE-09 `Stack` 一律用 gap 排間距(主題預設),不用 margin

`@repo/ui` 的主題把 `MuiStack` 的 `useFlexGap` 預設成 `true`(`packages/ui/src/theme/create-theme.ts`),所有 `Stack`(會不會換行都一樣)的 `spacing` 都由 `gap` 給,呼叫端不必、也不要再寫 `useFlexGap`;`rowGap` 與 `spacing` 相同時不必另寫。

- **為什麼不用 MUI 預設的 margin 模式**:它對每個直接子元素下 `& > :not(style):not(style) { margin: 0 }`,再用第二個起的子元素的 `margin-top` / `margin-left` 排間距。子元素自己寫的 `ml` / `mt` 因此被歸零(寫了縮排、lint 綠、測試綠、畫面沒縮排);`flexWrap: "wrap"` 換行後,新一行的首欄仍帶著 `margin-left`,和上一行對不齊。
- **gap 模式下子元素的 margin 會生效**:`ml: "auto"` 真的把按鈕組推到右邊、`mt` 真的位移,元件自帶的 margin(`ListItemText` 的上下 6px、瀏覽器給 `p` / `ul` / `h*` 的上下 margin)也照樣算進版面。`FormControlLabel` 的左 margin 由主題歸零(MUI 預設 -11px 會讓開關凸出同一欄輸入框的左緣),右邊 16px 照舊,呼叫端不必再補。子元素不要用 margin 排「兄弟之間」的間距,那是 `spacing` 的事;縮排用 padding,或多包一層 `Box`。
- **不要寫 `useFlexGap={false}`**:回到 margin 模式等於把上面兩個坑帶回來。

## STYLE-10 從呼叫端看 `sx`:只疊加、不覆蓋幾何

app 端給 `@repo/ui` 元件傳 `sx` 時,只放與版面位置有關的值(`cursor`、`mt`、`flex`…);元件自己的幾何(高度、圓角、tone 色)由元件內的 `styled()` / theme `components` 決定(STYLE-07),呼叫端不要重設。需要不同尺寸或 tone 用元件的 props(`size`、`tone`),沒有就到 ui 加,不在呼叫端用 `sx` 硬改。

**表單欄位的 `size`**:`TextField`、`SelectField`、`Autocomplete`、`DatePicker`、`DateTimePicker`、`ModuleIconPicker`、`OrgTreeSelect`、`ShareOrgsField` 不給 `size` 一律是 medium(`packages/ui/src/test/field-size.test.tsx` 鎖著),要 small 就明寫。同一張表單 / 同一列的欄位給同一個 `size`;隔壁寫了 `size="small"`、自己沒寫的那格會高一截。admin 的 ESLint(`no-restricted-syntax`)擋同一層直接並排的欄位 `size` 不一致(明寫 `medium` 與沒寫同算 medium;spread 的值是單純識別字(`{...SMALL}`、`{...fieldProps}`)又沒寫 size 的看不出來,不判;函式呼叫等其他 spread(如 `{...fieldErrorProps(...)}`)照判)。包在條件式或 helper 裡的、每格各包一層 `Grid` / `Box` 的版面,規則都抓不到,review 時對照。

**目前記錄在案的例外:沒有。**(`IconButton` 的外框與 32 / 40 / 48 正方形由 `variant="outlined"` 提供,
`SideNavToggle` 這類外框圖示鈕照用即可,不要再用 `sx` 給幾何。)

這個流程本身是規則:呼叫端非得用 `sx` 改幾何時 —— 開一張 ui 的票、在本節記一行
(寫明「暫記的技術債,不是可以照抄的先例」),票完成時刪掉那一行(STRUCT-11),不要默默留著。

## STYLE-11 列表頁的 `Table` 一律給 `minWidth`

`@repo/ui/table` 的容器本來就 `overflow-x: auto`,但不給 `minWidth` 時表格會跟著容器縮 ——
窄視窗下每一格折行、Tag 與按鈕擠成兩三層。
規則:**頁面上的資料列表一律傳 `minWidth`**,值取「每欄不折行時的合理寬度」
(欄少 720 上下、七欄的使用者清單 960),窄過它就橫向捲動。
彈窗裡的小表與只有兩三個短欄位的表不在此限。

**`minWidth` 高過設計稿的欄寬時,要在票上註明**:使用者清單取 960,
而 Figma 的 Screen frame 把那張表畫成 832 —— 意思是**照設計稿的視窗寬度看,這張表本來就會橫向捲**。
這不是實作做錯(不給 `minWidth` 只會換成每格折行),但驗收的人對著設計稿看到捲軸會當成 bug。
規則:取的值大於設計稿欄寬時,票上(或 PR 內文)寫一句「設計稿 <寬> vs 實作 `minWidth` <寬>,
該寬度下橫向捲是預期行為」,並回報主流程決定要不要改稿(FIGMA-10)。

**列表頁 Table 的容器撐滿父層高度,捲軸落在面板底部**:`Table` 的 `TableContainer`
預設 `height: 100%; minHeight: 0`,所以父層鏈要是 STYLE-08 的 `flex: 1; minHeight: 0` 欄,
且**捲動責任只給 TableContainer 一層**(見 STYLE-08 的「同一條鏈只標一次 `overflow: auto`」)。
要限制高度或在彈窗裡用,傳 `containerSx` 覆寫(如 `{ height: "auto", maxHeight: 320 }`,
命名慣例見 STYLE-07);父層高度不確定時 `height: 100%` 自然退回 auto,詳情面板那種
整塊捲動的版面不受影響。

## STYLE-12 Typography 的 `color` 用 MUI 正式值;指定色階用 `sx`

`Typography` 的 `color` 只寫 MUI 認得的值:色票名 `primary` / `secondary` / `success` / `error` / `info` / `warning`,
文字色 `textPrimary` / `textSecondary` / `textDisabled`。要指定色階(`warning.dark`、`primary.darker`)才改用
`sx={{ color: "warning.dark" }}`,`sx` 裡照常寫 theme 路徑。

```tsx
<Typography color="textSecondary">說明文字</Typography>
<Typography color={row.balance < 0 ? "warning" : "textPrimary"}>{amount}</Typography>
<Typography sx={{ color: "warning.dark" }}>尚未排班</Typography>
```

- **為什麼**:MUI 的 Typography 依 `color` 值比對 variants 上色,`text.secondary`、`warning.main` 這類帶點的寫法比對不到,
  會被忽略、畫成一般字色;MUI 的型別放寬成 `string & {}`,寫錯也不會報錯。
- **怎麼擋**:`@repo/ui/typography` 的 `color` 型別只收上列正式值(`TypographyColor`),寫錯就 check-types 失敗;
  算顏色的 helper 回傳型別寫 `TypographyColor`。`@repo/eslint-config/react` 的 `no-restricted-syntax` 另擋
  `Typography` / `MuiTypography` 的 `color` 裡出現帶點字串(含三元式的兩支),`packages/ui` 內部直接用 MUI 的地方也照樣檢查。
