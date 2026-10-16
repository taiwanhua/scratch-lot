# Figma 設計稿規範

適用:底座與引用專案的 Figma 設計稿(人與 AI 同守)。檔案、品牌 Library 與採用狀態以 [設計資源登記](../../branding.md#設計資源登記) 為入口;共用元件放底座檔,品牌及客製畫面放專案檔。

## FIGMA-01 元件的家

- **通用原子**(Button、TextField、Checkbox、Select、Tabs、Dialog…)一元件一頁,放 Components 區
- **殼與情境元件**(SideNav、AppBar、RouteTabs、StatCard / RecipeCard、AdSlot…)放對應 Shell 頁
- 尚未 code 化的元件一律 `Draft/` 前綴;code 化並重新投影後移除前綴
- 元件必填 description(用途 + 特殊規則),重要操作屬性化(TEXT/BOOLEAN 屬性)
- **變體軸與屬性名對應 `@repo/ui` 包裝層的 props**;包裝層能透傳 MUI 原生值就透傳、不發明新名(如 Select 的 Variant=Outlined/Standard 即 MUI variant),真有 MUI 沒有的才自定義(STYLE-05)

## FIGMA-02 零寫死

顏色綁變數(`setBoundVariableForPaint`)、字型套 text styles、陰影套 effect styles、圓角綁 radius 變數。文件頁的裝飾文字除外。

共用導覽列、頁籤與 SelectField 的中文及下拉符號使用 Noto Sans TC，字重沿原值；這是程式字型堆疊已有的中文備援。Library 實例的文字內容存在不代表字形可見，發布後以引用專案的代表畫面核對中文、符號及排版，避免只核對字串而漏掉缺字。

## FIGMA-03 畫面 = 實例組合

畫面由殼實例 + 元件實例組成;每頁差異用**實例覆寫**(改字、換色、visible、swap 變體),禁止 detach。結構性增減用「備用槽 + visible」模式(側欄備用列、RouteTabs 8 槽)。

## FIGMA-04 文案守詞彙表

UI 文字嚴格遵守 `CONTEXT.md` 與 `CONTEXT-PROJECT.md`(使用者/會員/組織…,禁用詞不出現);**對人的提示文字禁用內部術語**(「子樹」→「或其下層組織」)。中文為主,識別符(key、email)除外。**受眾分層**:租戶使用者可見的畫面與 help 文案不得出現平台視角詞彙(根組織/租戶/開通/跨租戶);聯絡窗口統一「系統管理員」;平台詞彙僅限根組織專屬畫面(模組與權限)與根組織視角示範圖。

## FIGMA-05 陰影容器不裁切

放置帶陰影元素(卡片、按鈕、彈窗)的 auto-layout 容器一律 `clipsContent: false` — 預設裁切會把柔影切成直角(本專案已踩三次)。

## FIGMA-06 畫面完整性

動筆前先盤流程:CRUD 齊全、關聯操作入口、確認彈窗、空/錯誤狀態 — 缺口先列給使用者拍板。表格必有表頭與分頁;彈窗以 Overlay frame(半透黑底)示範放畫面頁旁;多狀態並列示範。

## FIGMA-07 RWD

front 畫面三檔 artboard(1440 / 768 / 375,斷點對應 MUI lg/md/xs);admin 單檔 1440 + 表格橫向捲動。殼元件用 `Device=Desktop/Mobile` 變體。

## FIGMA-08 Plugin API 慣例(AI 產稿)

批次綁定時 placeholder 色放解析後的值(佔位灰會黏著);遍歷實例隱藏子節點先 `figma.skipInvisibleInstanceChildren = false`;`resize` 會把 HUG 變 FIXED,事後補回;變數/元件 id 記錄於 session 狀態檔。

## FIGMA-09 給 AI 的指路:節點 id 要給元件 frame,不是頁

Figma MCP 的 `get_design_context(nodeId)` 對「頁(canvas)」的 id 會直接報錯,要先 `get_metadata(pageId)` 找到元件 frame 的 id 再讀。票或文件引用設計稿時,寫元件 frame 的 id(如 Draft/Tag 76:722),頁的 id(如 Tag 頁 76:711)只當索引。

**`get_metadata` 不帶 nodeId 只列得出 Cover 頁**(這個檔如此):各元件頁 / 畫面頁的 frame id 進不去就找不到,一律記在下表。一列一個節點;新畫一個元件或畫面,就在該頁最後一列後面追加一列。

### 底座共用元件與樣式

下表使用 [wowgo-base Design System](https://www.figma.com/design/XKQ18kf6SkfAQYk7GmBkk5) 的節點。Library 採用狀態與品牌檔位置見 [設計資源登記](../../branding.md#設計資源登記)。

| 頁(頁 id)                  | 節點                                   | 節點 id                                    | 內容                                                                                                                                                                                                                                                                                             |
| -------------------------- | -------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Foundations                | text style Badge                       | S:2ff780ac04604ae7a990dd8dad49f97275ebd7b7 | Public Sans Medium 12 / 行高 20(Badge 數字)                                                                                                                                                                                                                                                      |
| Foundations                | text style Caption/SemiBold            | S:7cfa2be1b685e1bf7c2d32270742cbf2e41d61d2 | 12 / 600(SegmentedControl 選中)                                                                                                                                                                                                                                                                  |
| Button(8:2)                | Button                                 | 2001:111                                   | 變體軸 Color=Primary / Error / Success × Variant × Size × State;Error 變體 2001:148–2001:182(contained 底 error/main、字 error/contrastText、Shadow/Error;outlined 框與字 error/main;text 字 error/main);Success 變體 2001:184–2001:218(同上換 success/*、Shadow/Success,對應 `color="success"`) |
| Icons(244:2)               | Draft/ModuleIcon                       | 2001:4                                     | 29 個 `key=<name>` 變體                                                                                                                                                                                                                                                                          |
| Icons(244:2)               | Draft/ActionIcon                       | 2001:68                                    | 八個變體:edit / delete / chevron-double-left / chevron-double-right / view / add 2001:81 / arrow-up 2001:83 / arrow-down 2001:85(MUI Outlined),向量綁 `grey/700`                                                                                                                                 |
| TextField(11:2)            | Draft/DatePicker                       | 2001:302                                   | Size=Small / Medium,TextField + 日曆圖示;說明卡 2001:311                                                                                                                                                                                                                                         |
| TextField(11:2)            | Draft/DateTimePicker                   | 2001:314                                   | Size=Small / Medium,值 `YYYY-MM-DD HH:mm`                                                                                                                                                                                                                                                        |
| Select(70:219)             | Draft/Autocomplete                     | 2001:391                                   | State=Closed / Open,含 chip、分組 listbox、灰掉的不合格選項;說明卡 2001:429                                                                                                                                                                                                                      |
| Tabs(70:220)               | Draft/Tab                              | 2001:599                                   | 內距 10 / 8;BOOLEAN Badge(文字右側的 Draft/Badge 實例)                                                                                                                                                                                                                                           |
| Tabs(70:220)               | Draft/Tabs                             | 2001:610                                   | 由 Draft/Tab 組成 + 底線;說明卡 2001:615                                                                                                                                                                                                                                                         |
| Popover(73:2)              | Draft/Tooltip                          | 2001:980                                   | Placement=Top / Bottom;說明卡 2001:989                                                                                                                                                                                                                                                           |
| Pagination(76:723)         | Draft/PaginationItem                   | 2001:506                                   | 32×32,字套 Subtitle/2                                                                                                                                                                                                                                                                            |
| Tag(76:711)                | Draft/Tag                              | 2001:463                                   | 標籤                                                                                                                                                                                                                                                                                             |
| Switch(88:211)             | Draft/Switch                           | 2001:369                                   | State=On / Off × Enabled=True / False(停用 2001:374 / 2001:376:軌道 `action/disabledBackground`、把手 `action/disabled`,對應 `@repo/ui` Switch 的 `.Mui-disabled`;與 Draft/Checkbox 的 Enabled 軸同一做法)                                                                                       |
| Upload(121:2)              | Draft/UploadField                      | 2001:565                                   | State=Empty / Preview;Empty 提示 2001:571 =「PNG / JPG / WebP,建議正方形,2MB 以內」;Preview 既有檔顯示「目前的商標」、不顯示大小                                                                                                                                                                 |
| Dialog                     | Draft/HelpDialog                       | 2001:926                                   | 模組說明彈窗;畫面頁上的實例 2022:2757                                                                                                                                                                                                                                                            |
| Table(101:2)               | Draft/Table                            | 2001:737                                   | `@repo/ui` Table:Size=Medium / Small × State=Data / Empty                                                                                                                                                                                                                                        |
| Table(101:2)               | Draft/TableHeaderCell、Draft/TableCell | 2001:630 / 2001:632                        | 字套 Subtitle/2、Body/2(14),高度 hug                                                                                                                                                                                                                                                             |
| Badge(285:2)               | Draft/Badge                            | 2001:478                                   | Color=Primary / Default × Variant=Standard / Dot,TEXT Content;Default 底 `grey/300`、字 `grey/800`(2001:482 / 2001:483 / 2001:484);說明卡 2001:485(0 不顯示、超過 99 顯示 99+、Dot 用於收合側欄)                                                                                                 |
| SegmentedControl(285:3)    | Draft/SegmentedOption                  | 2001:516                                   | 單一選項,State=Selected / Default,TEXT Label                                                                                                                                                                                                                                                     |
| SegmentedControl(285:3)    | Draft/SegmentedControl                 | 2001:521                                   | 整組(示範三選項:淺色 / 深色 / 跟隨系統)                                                                                                                                                                                                                                                          |
| Menu(285:4)                | Draft/MenuItem                         | 2001:1004                                  | Variant=Menu / List × State=Default / Hover;BOOLEAN Icon + INSTANCE_SWAP Icon glyph                                                                                                                                                                                                              |
| Menu(285:4)                | Draft/Menu                             | 2001:1021                                  | 彈出層(radius/md、Shadow/Dropdown),內含三個 MenuItem                                                                                                                                                                                                                                             |
| Alert(289:2)               | Draft/Alert                            | 2001:942                                   | 頁內提示 Severity=Info / Warning / Error / Success,TEXT Message;BOOLEAN Action(預設關,右側 Button text/small 2001:949 / 2001:956 / 2001:963 / 2001:970,對應 MUI Alert 的 action)                                                                                                                 |
| List(290:2)                | Draft/ListItem                         | 2001:1100                                  | 左側清單列:Primary / Secondary / Caption + 四個 tag 槽,State=Selected / Default                                                                                                                                                                                                                  |
| Flow(302:2)                | Draft/FlowStepNode                     | 2001:1129                                  | 流程設計器的審核關卡節點 240×104,State=Default / Selected / Error                                                                                                                                                                                                                                |
| Flow(302:2)                | Draft/FlowJoinNode                     | 2001:1151                                  | 匯合節點 56×56 菱形,State=Default / Selected / Error                                                                                                                                                                                                                                             |
| IconButton(311:5813)       | Draft/IconButton                       | 2001:538                                   | Variant=Plain(圓形 30 / 40 / 52)/ Outlined(方形 32 / 40 / 48、divider 框、radius/sm)× Size=Small / Medium / Large;INSTANCE_SWAP Icon(Draft/ActionIcon);說明卡 2001:551                                                                                                                           |
| Avatar(311:5814)           | Draft/Avatar                           | 2001:497                                   | Size=32 / 40,`primary/lighter` 底 + `primary/dark` 字,TEXT Initial;說明卡 2001:502                                                                                                                                                                                                               |
| CircularProgress(311:5815) | Draft/CircularProgress                 | 2001:529                                   | 40×40、`primary/main` 3/4 圈;說明卡 2001:531                                                                                                                                                                                                                                                     |
| Admin Shell(32:2)          | Draft/NavItem                          | 2001:1187                                  | 側欄項目;BOOLEAN Badge(右側的 Draft/Badge)                                                                                                                                                                                                                                                       |
| Admin Shell(32:2)          | Draft/AdminSideNav                     | 2001:1214                                  | 展開側欄;系統管理群組備用槽 spare-1~~4(2001:1227、2001:1228、2001:1229、2001:1230)、頂層備用槽 spare-top-1~~2(2001:1242、2001:1243)                                                                                                                                                              |
| Admin Shell(32:2)          | Draft/AdminAppBar                      | 2001:1248                                  | orgSwitcher = SelectField 實例 2001:1254                                                                                                                                                                                                                                                         |
| Admin Shell(32:2)          | Draft/AdminUserMenu                    | 2001:1312                                  | 頭像選單:使用者卡 2001:1313、外觀分段按鈕 2001:1323、語言分段按鈕 2001:1338、登出項 2001:1344 / 2001:1348                                                                                                                                                                                        |
| Admin Shell(32:2)          | Draft/NavRailItem                      | 2001:1282                                  | 收合側欄項目:圖示槽 2001:1290、群組小點 2001:1291;BOOLEAN Badge 只在 Default / Selected(badge-dot 2001:1285 / 2001:1288,8×8 圓心落在圖示右上角);Group 不畫待審點                                                                                                                                 |
| Admin Shell(32:2)          | Draft/AdminSideNavCollapsed            | 2001:1295                                  | 收合側欄:logoImg 2001:1296、collapse-toggle 2001:1304、頂層備用槽 spare-top-1 2001:1301(description)/ spare-top-2 2001:1302(mail)(預設隱藏);group-flyout 2001:1306                                                                                                                               |
| Admin Shell(32:2)          | RouteTabs / 子頁籤說明                 | 2001:1352                                  | 詳情子頁籤命名(所屬模組名 — 檢視・/ 編輯・/ 新增・項目名)、刪除後關閉同一筆的子頁籤;Draft/AdminRouteTabs 的 tab-9(2001:1270)為子頁籤示範                                                                                                                                                         |

### 底座後台參考畫面

下表使用同一個 [wowgo-base Design System](https://www.figma.com/design/XKQ18kf6SkfAQYk7GmBkk5)。畫面由共用元件實例組成,作為治理、表單、流程與示範模組的設計參考;專案客製畫面另放自己的檔案。

| 頁(頁 id)                           | 畫面或說明                                                                                                                                               | 節點 id   | 用途     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------- |
| Screen / Admin 登入(17:3)           | Admin 登入                                                                                                                                               | 2022:370  | 參考畫面 |
| Screen / Admin 忘記密碼(120:1532)   | Admin 忘記密碼(已寄出)                                                                                                                                   | 2022:406  | 參考畫面 |
| Screen / Admin 忘記密碼(120:1532)   | Admin 忘記密碼                                                                                                                                           | 2022:394  | 參考畫面 |
| Screen / Admin 設定新密碼(120:1581) | Admin 設定新密碼(連結失效)                                                                                                                               | 2022:445  | 參考畫面 |
| Screen / Admin 設定新密碼(120:1581) | Admin 設定新密碼                                                                                                                                         | 2022:433  | 參考畫面 |
| Screen / Admin 總覽(20:2)           | Admin 總覽                                                                                                                                               | 2022:496  | 參考畫面 |
| Screen / Admin 組織管理(87:2)       | Overlay / 編輯組織(根組織)                                                                                                                               | 2022:910  | 參考畫面 |
| Screen / Admin 組織管理(87:2)       | Overlay / 編輯組織(已選時區)                                                                                                                             | 2022:882  | 參考畫面 |
| Screen / Admin 組織管理(87:2)       | Overlay / 加入成員                                                                                                                                       | 2022:874  | 參考畫面 |
| Screen / Admin 組織管理(87:2)       | 撤銷開通(#374):根組織視角、選到租戶頂層時,動作列多一顆「撤銷開通」(編輯 / 停用 / 刪除 / 撤銷開通);其他節點與租戶視角都不出現。彈窗要照打租戶名稱才可送出 | 2022:873  | 頁面說明 |
| Screen / Admin 組織管理(87:2)       | Overlay / 撤銷開通確認                                                                                                                                   | 2022:865  | 參考畫面 |
| Screen / Admin 組織管理(87:2)       | Overlay / 新增子組織                                                                                                                                     | 2022:856  | 參考畫面 |
| Screen / Admin 組織管理(87:2)       | 視角:租戶 A 管理員 — 無「開通租戶」、無「模組與權限」、樹以租戶為根                                                                                      | 2022:855  | 頁面說明 |
| Screen / Admin 組織管理(87:2)       | 視角:根組織(超級管理員)                                                                                                                                  | 2022:854  | 頁面說明 |
| Screen / Admin 組織管理(87:2)       | Admin 組織管理(視角:租戶 A 管理員)                                                                                                                       | 2022:820  | 參考畫面 |
| Screen / Admin 組織管理(87:2)       | Overlay / 停用組織確認                                                                                                                                   | 2022:818  | 參考畫面 |
| Screen / Admin 組織管理(87:2)       | Overlay / 編輯組織                                                                                                                                       | 2022:790  | 參考畫面 |
| Screen / Admin 組織管理(87:2)       | Overlay / 開通租戶                                                                                                                                       | 2022:746  | 參考畫面 |
| Screen / Admin 組織管理(87:2)       | Admin 組織管理(視角:根組織)                                                                                                                              | 2022:707  | 參考畫面 |
| Screen / Admin 使用者管理(30:104)   | Overlay / 複製組織與角色                                                                                                                                 | 2022:1673 | 參考畫面 |
| Screen / Admin 使用者管理(30:104)   | Overlay / 新增使用者                                                                                                                                     | 2022:1635 | 參考畫面 |
| Screen / Admin 使用者管理(30:104)   | Overlay / 確認所屬組織變更                                                                                                                               | 2022:1613 | 參考畫面 |
| Screen / Admin 使用者管理(30:104)   | _視角註記                                                                                                                                                | 2022:1607 | 參考畫面 |
| Screen / Admin 使用者管理(30:104)   | Overlay / 選擇所屬組織                                                                                                                                   | 2022:1592 | 參考畫面 |
| Screen / Admin 使用者管理(30:104)   | Overlay / 指派角色                                                                                                                                       | 2022:1566 | 參考畫面 |
| Screen / Admin 使用者管理(30:104)   | Overlay / 編輯使用者                                                                                                                                     | 2022:1536 | 參考畫面 |
| Screen / Admin 使用者管理(30:104)   | Admin 使用者管理                                                                                                                                         | 2022:1411 | 參考畫面 |
| Screen / Admin 模組與權限(89:2)     | Overlay / 列表欄位配置                                                                                                                                   | 2022:2204 | 參考畫面 |
| Screen / Admin 模組與權限(89:2)     | Overlay / 停用模組確認                                                                                                                                   | 2022:2202 | 參考畫面 |
| Screen / Admin 模組與權限(89:2)     | _視角註記                                                                                                                                                | 2022:2197 | 參考畫面 |
| Screen / Admin 模組與權限(89:2)     | Admin 模組與權限                                                                                                                                         | 2022:2109 | 參考畫面 |
| Screen / Admin 角色管理(44:44)      | _視角註記                                                                                                                                                | 2022:2759 | 參考畫面 |
| Screen / Admin 角色管理(44:44)      | Overlay / 模組說明                                                                                                                                       | 2022:2757 | 參考畫面 |
| Screen / Admin 角色管理(44:44)      | Draft/Popover                                                                                                                                            | 2022:2756 | 頁面說明 |
| Screen / Admin 角色管理(44:44)      | Overlay / 放棄未儲存變更                                                                                                                                 | 2022:2754 | 參考畫面 |
| Screen / Admin 角色管理(44:44)      | Overlay / 加入使用者                                                                                                                                     | 2022:2715 | 參考畫面 |
| Screen / Admin 角色管理(44:44)      | Demo / 組織下拉(展開)                                                                                                                                    | 2022:2700 | 參考畫面 |
| Screen / Admin 角色管理(44:44)      | Demo / 角色分配使用者檢視                                                                                                                                | 2022:2655 | 參考畫面 |
| Screen / Admin 角色管理(44:44)      | Overlay / 編輯角色                                                                                                                                       | 2022:2643 | 參考畫面 |
| Screen / Admin 角色管理(44:44)      | Overlay / 刪除角色確認                                                                                                                                   | 2022:2641 | 參考畫面 |
| Screen / Admin 角色管理(44:44)      | Admin 角色管理                                                                                                                                           | 2022:2464 | 參考畫面 |
| Screen / Admin 欄位管理(90:2)       | Overlay / 新增欄位類別                                                                                                                                   | 2022:3224 | 參考畫面 |
| Screen / Admin 欄位管理(90:2)       | Admin 欄位管理 — 自訂類別(可編輯 / 停用)                                                                                                                 | 2022:3136 | 參考畫面 |
| Screen / Admin 欄位管理(90:2)       | Overlay / 新增選項                                                                                                                                       | 2022:3126 | 參考畫面 |
| Screen / Admin 欄位管理(90:2)       | _視角註記                                                                                                                                                | 2022:3121 | 參考畫面 |
| Screen / Admin 欄位管理(90:2)       | Admin 欄位管理                                                                                                                                           | 2022:3035 | 參考畫面 |
| Screen / Admin 資料範圍(166:318)    | _註記:合成規則與資料影響                                                                                                                                 | 2022:3641 | 參考畫面 |
| Screen / Admin 資料範圍(166:318)    | Admin 資料範圍                                                                                                                                           | 2022:3559 | 參考畫面 |
| Screen / Admin 示範模組1(175:2)     | Overlay / 刪除示範項目確認                                                                                                                               | 2022:4022 | 參考畫面 |
| Screen / Admin 示範模組1(175:2)     | Admin 新增/編輯示範項目(共版型)                                                                                                                          | 2022:3990 | 參考畫面 |
| Screen / Admin 示範模組1(175:2)     | Admin 示範項目詳情(view-page)                                                                                                                            | 2022:3953 | 參考畫面 |
| Screen / Admin 示範模組1(175:2)     | Admin 示範模組1 列表                                                                                                                                     | 2022:3901 | 參考畫面 |
| Screen / Admin 表單管理(292:2)      | Overlay / 解除流程綁定                                                                                                                                   | 2022:4871 | 參考畫面 |
| Screen / Admin 表單管理(292:2)      | Overlay / 刪除分區「基本資料」?                                                                                                                          | 2022:4853 | 參考畫面 |
| Screen / Admin 表單管理(292:2)      | Overlay / 刪除欄位「開始日期」?                                                                                                                          | 2022:4842 | 參考畫面 |
| Screen / Admin 表單管理(292:2)      | Overlay / 刪除草稿?                                                                                                                                      | 2022:4835 | 參考畫面 |
| Screen / Admin 表單管理(292:2)      | Overlay / 退役目前版本?                                                                                                                                  | 2022:4828 | 參考畫面 |
| Screen / Admin 表單管理(292:2)      | Overlay / 發布新版本                                                                                                                                     | 2022:4819 | 參考畫面 |
| Screen / Admin 表單管理(292:2)      | Overlay / 分派「請假申請單」                                                                                                                             | 2022:4802 | 參考畫面 |
| Screen / Admin 表單管理(292:2)      | Overlay / 以「請假申請單」為基底建新表單                                                                                                                 | 2022:4791 | 參考畫面 |
| Screen / Admin 表單管理(292:2)      | Overlay / 建立表單                                                                                                                                       | 2022:4780 | 參考畫面 |
| Screen / Admin 表單管理(292:2)      | Admin 表單管理 — 表單設計:預覽(畫稿隱藏側欄)                                                                                                             | 2022:4716 | 參考畫面 |
| Screen / Admin 表單管理(292:2)      | _畫稿註記 — 表單設計器                                                                                                                                   | 2022:4713 | 參考畫面 |
| Screen / Admin 表單管理(292:2)      | Overlay / 將舊版資料升級到此版 — 步驟 3                                                                                                                  | 2022:4702 | 參考畫面 |
| Screen / Admin 表單管理(292:2)      | Overlay / 將舊版資料升級到此版 — 步驟 2                                                                                                                  | 2022:4690 | 參考畫面 |
| Screen / Admin 表單管理(292:2)      | Overlay / 將舊版資料升級到此版 — 步驟 1                                                                                                                  | 2022:4676 | 參考畫面 |
| Screen / Admin 表單管理(292:2)      | Admin 表單管理 — 表單版本                                                                                                                                | 2022:4575 | 參考畫面 |
| Screen / Admin 表單管理(292:2)      | Admin 表單管理 — 表單設計(畫稿隱藏側欄)                                                                                                                  | 2022:4461 | 參考畫面 |
| Screen / Admin 流程管理(292:3)      | Overlay / 從「部門主管」分流                                                                                                                             | 2022:5919 | 參考畫面 |
| Screen / Admin 流程管理(292:3)      | Overlay / 刪除草稿(流程)                                                                                                                                 | 2022:5911 | 參考畫面 |
| Screen / Admin 流程管理(292:3)      | Overlay / 退役目前版本(流程)                                                                                                                             | 2022:5904 | 參考畫面 |
| Screen / Admin 流程管理(292:3)      | Overlay / 發布草稿(流程)                                                                                                                                 | 2022:5895 | 參考畫面 |
| Screen / Admin 流程管理(292:3)      | Overlay / 分派「標準請假審核」                                                                                                                           | 2022:5878 | 參考畫面 |
| Screen / Admin 流程管理(292:3)      | Overlay / 以「標準請假審核」為基底建流程                                                                                                                 | 2022:5866 | 參考畫面 |
| Screen / Admin 流程管理(292:3)      | Overlay / 建立流程                                                                                                                                       | 2022:5856 | 參考畫面 |
| Screen / Admin 流程管理(292:3)      | Admin 流程管理 — 流程版本(發布中斷)                                                                                                                      | 2022:5789 | 參考畫面 |
| Screen / Admin 流程管理(292:3)      | Admin 流程管理 — 流程版本                                                                                                                                | 2022:5703 | 參考畫面 |
| Screen / Admin 流程管理(292:3)      | Overlay / 改派「部門主管」                                                                                                                               | 2022:5695 | 參考畫面 |
| Screen / Admin 流程管理(292:3)      | Admin 流程管理 — 阻擋清單                                                                                                                                | 2022:5614 | 參考畫面 |
| Screen / Admin 流程管理(292:3)      | Admin 流程管理 — 流程設計(側欄收合)                                                                                                                      | 2022:5531 | 參考畫面 |
| Screen / Admin 申請中心(292:4)      | Admin 申請中心 — 申請詳情(待處理)                                                                                                                        | 2022:7062 | 參考畫面 |
| Screen / Admin 申請中心(292:4)      | Admin 申請中心 — 我的申請(空狀態)                                                                                                                        | 2022:7022 | 參考畫面 |
| Screen / Admin 申請中心(292:4)      | Admin 申請中心 — 我的申請(側欄收合)                                                                                                                      | 2022:6907 | 參考畫面 |
| Screen / Admin 申請中心(292:4)      | Overlay / 作廢這張單                                                                                                                                     | 2022:6899 | 參考畫面 |
| Screen / Admin 申請中心(292:4)      | Overlay / 撤回申請                                                                                                                                       | 2022:6892 | 參考畫面 |
| Screen / Admin 申請中心(292:4)      | Overlay / 退回修改「主管審核」                                                                                                                           | 2022:6883 | 參考畫面 |
| Screen / Admin 申請中心(292:4)      | Overlay / 新申請                                                                                                                                         | 2022:6875 | 參考畫面 |
| Screen / Admin 申請中心(292:4)      | Admin 申請中心 — 申請詳情                                                                                                                                | 2022:6818 | 參考畫面 |
| Screen / Admin 申請中心(292:4)      | Admin 申請中心 — 待我審核                                                                                                                                | 2022:6727 | 參考畫面 |
| Screen / Admin 申請中心(292:4)      | Admin 申請中心 — 我的申請                                                                                                                                | 2022:6612 | 參考畫面 |
| Screen / Admin 示範表單(292:5)      | Overlay / 刪除這筆資料?                                                                                                                                  | 2022:8560 | 參考畫面 |
| Screen / Admin 示範表單(292:5)      | Overlay / 選擇要填寫的表單                                                                                                                               | 2022:8551 | 參考畫面 |
| Screen / Admin 示範表單(292:5)      | Overlay / 帶入資料 — 勾選欄位                                                                                                                            | 2022:8527 | 參考畫面 |
| Screen / Admin 示範表單(292:5)      | Overlay / 帶入資料 — 選資料                                                                                                                              | 2022:8515 | 參考畫面 |
| Screen / Admin 示範表單(292:5)      | Admin 示範表單 — 列表(空狀態)                                                                                                                            | 2022:8477 | 參考畫面 |
| Screen / Admin 示範表單(292:5)      | Admin 示範表單 — 新增                                                                                                                                    | 2022:8406 | 參考畫面 |
| Screen / Admin 示範表單(292:5)      | Overlay / 修訂紀錄                                                                                                                                       | 2022:8363 | 參考畫面 |
| Screen / Admin 示範表單(292:5)      | Admin 示範表單 — 檢視                                                                                                                                    | 2022:8305 | 參考畫面 |
| Screen / Admin 示範表單(292:5)      | Admin 示範表單 — 編輯(退回後)                                                                                                                            | 2022:8233 | 參考畫面 |
| Screen / Admin 示範表單(292:5)      | Admin 示範表單 — 列表                                                                                                                                    | 2022:8112 | 參考畫面 |

頁欄沒有 id 的,由同列的節點 id 直接進入。表裡沒有的頁,先問使用者要 frame id,不要靠猜的 id 去讀。畫面頁若與實作 / 模組文件不一致,照 FIGMA-10 處理:照文件做、在 PR 記差異。

Components 區凡是先有實作、後補稿的元件(Tooltip、DatePicker、DateTimePicker、Autocomplete、Tabs、ActionIcon、Badge、SegmentedControl、Menu、Table、Alert、ListItem、IconButton、Avatar、CircularProgress),設計稿以實作為準。

**待補稿與待決定清單**(動設計檔前要先提案取得使用者同意,不要順手畫;補稿時以實作現況為準):

| 項目               | 實作現況 / 待決定                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| 表單設計器畫布寬度 | 清單 320 + 元件庫 180 + 屬性 360 固定寬,1440 寬時畫布約 412px;設計模式要不要收起左側清單待決定 |

## FIGMA-10 設計稿有標的幾何一律落到 theme;設計稿與模組文件衝突時以模組文件為準

- 元件的固定幾何(高度、圓角、內距、字級)只要 Figma 有標,就要寫進 `packages/ui` 的 theme 或元件,不要「MUI 預設看起來差不多」就跳過 — Button 的 32 / 36 / 48 高度少寫兩個,結果中文按鈕文字垂直偏上 1.25px。
- 設計稿與 `docs/modules/<key>.md` 說法不同時(欄位有無、動作放在按鈕還是彈窗內、核取方塊還是開關),**以模組文件為正本**,實作照文件做並在 PR 記差異,設計稿由主流程之後補齊。
- **設計稿與票上的文字不同時,以「較新者」為準,並在 PR 回報**:上一條處理的是「稿 vs 模組文件」,這一條處理「稿 vs 票」—— 票是照當時的稿寫的,稿之後被改過(或反之),兩邊就會各說一種文案 / 欄位名。判斷順序:①票或稿哪一份明確標了較新的日期 / 票號,取較新的;②看不出新舊時以**模組文件**裁決(上一條);③兩邊都沒寫就照票做。無論取哪一邊,PR 內文都要寫一行「稿寫 A、票寫 B,取 X 因為 Y」,讓主流程知道有一邊要補。**不要自己去改設計檔**(動 Figma 前要先提案取得同意)。
