# 本輪底座元件:Figma 草稿與搬回底座的方法

## 現況

- 本輪底座新元件與參考畫面先畫在 [scratch-lot Screens](https://www.figma.com/design/sXOJkIX53eBMUyDE8yYUJm) 的頁「Base Draft / 本輪底座元件」(`41:5914`)。節點清單見 `nodes.md`。
- 所有元件**只綁 wowgo-base Design System** 的變數(Color `9d2d67…`、Radius `84c5f3…`、Primitives `1eea29…`)、文字樣式與 effect 樣式;已用腳本稽核,沒有任何 scratch-lot Brand Library 綁定。
- 能用既有底座元件就用遠端實例(Button、IconButton、Tag、Badge、Select、SelectField、TextField、Radio、Checkbox、Switch、Alert、Tooltip、Tab、TableCell、Link、AdminSideNav / AppBar / RouteTabs)。
- PageTabs 不畫新元件:既有 Draft/Tabs 就是 @repo/ui/tabs,PageTabs 是它加網址同步與權限;印表機管理頁用 Draft/Tab × 3 示範。

## 搬回底座的方法(重建,不跨檔搬移)

1. 在 wowgo-base Design System 開一頁(例:「Draft / 本輪」),把 `_resolve.js` 的 `MODE` 改成 `'base'`,依序貼上「檔頭 + 元件腳本」執行:
   `ActionIcon+.js` → `Section.js` → `AudiencePicker.js` → `DataScopeRuleCard.js` → `OrgTreeSelect.js` → `MonthCalendar.js` → `RosterGrid.js` → `Notification.js` → `Print.js` → `Screens.js`。
   第二輪起追加:`Stepper.js` → `Round2-base.js`(前置 `_compact.js`;RosterGrid 表頭彙總列、58mm 版面零件、Receipt58 改成零件組成)→ `Screens2-base.js` 的 PART 1、2、3、4(前置 `const PROJECT = false;` + `_kit.js`;BS-03~~07、BS-11~~16,PART 4 = 第三輪的 BS-17~~20 印表機管理)。`Section.js` 的內容區是 SLOT;`OrgTreeSelect.js` 是浮動標籤(高 56)。
   - **三份檔頭都要設 `MODE = 'base'`**:`_resolve.js`(元件腳本)、`_compact.js`(Round2-base)、`_kit.js`(Screens2-base)。base 模式下變數 / 樣式依 key 找本檔 local,底座既有元件依節點 id(`_resolve.js` 的 `K.comp[*].baseNode`、`_kit.js` 的 `BASE_NODE`),本輪草稿元件依名稱在草稿頁「Draft / 本輪」找(`_compact.js` / `_kit.js` 的 `DRAFT_PAGE`、`draft()`、`node()`)。腳本裡沒有寫死 scratch-lot 的節點 id。
   - 三份檔頭的 `al()` 都預設不裁切內容(浮動標籤、陰影);表格、殼、Overlay 另外設定裁切。
   - `_kit.js` 的 `BASE_NODE` 還沒填的(Checkbox、Radio、TextField、Link、StatCard、AdminRouteTabs)和 `_resolve.js` 一樣,重建前要先在底座檔查到節點 id 補上;未填時腳本會直接報錯,不會靜默改用 Library。
   - 有依賴的要照順序(後面的會在目前頁找前面的草稿元件)。
   - 全部跑完後跑 `project/r4-layout.js`(`PAGE_ID` 設成草稿頁):頁名含「本輪」時用 `ROWS.base` 依名稱分列。兩張「說明 / 通知鈴暫時疊加」是 scratch-lot 專用的註解卡(步驟 4 AppBar 加槽後刪除),不在腳本裡。
   - 第七、八輪核對過:Base Draft 上的文字(數字除外)都能在底座腳本裡找到(上面的註解卡除外),示範文字是中性內容。
   - `base` 模式:變數 / 樣式依同一個 key 找本檔 local;底座既有元件依 `K.comp[*].baseNode`(FIGMA-09 節點 id)。`K.comp` 裡還沒填 `baseNode` 的元件(Draft/Select、Draft/SelectField、TextField、Draft/Checkbox、Link、Draft/Radio、Draft/Snackbar、Draft/Popover、Draft/AdminRouteTabs、Draft/ConfirmDialog),重建前要先在底座檔查到節點 id 補上。
2. **ActionIcon+ 併入 Draft/ActionIcon**:在底座檔把 `Draft/ActionIcon+` 的 17 個變體移進既有 set `Draft/ActionIcon`(2001:68)成為新的 `key=` 變體,刪除空的 ActionIcon+ set;重建其他元件前把腳本裡的 `draft('Draft/ActionIcon+')` 改為 `comp('Draft/ActionIcon')`(兩者變體名相同)。
3. 底座 Library 依 `docs/deployment.md` 的 Release 步驟發布(Library 版本與 Git tag 互相指向)。
4. **底座既有元件與畫面的修改**(scratch-lot 不能改底座元件,所以留到這一步在底座檔直接改):
   - `Draft/AdminAppBar`(2001:1248)加 BOOLEAN `Notifications`,右側放 `Draft/NotificationBell` 實例(使用者已同意)。重建後,參考畫面上以絕對定位疊加的鈴(圖層名 `notification-bell(待 AppBar 加槽)`)改用這個屬性並刪除疊加層;旁邊的說明卡「說明 / 通知鈴暫時疊加」(scratch-lot 59:1524、59:1528)一併刪除。
   - `Draft/AdminSideNav`(2001:1214)系統管理群組加「通知設定」「印表機管理」兩列(先用備用槽 spare-1~4;不夠再新增)。
   - `Draft/AdminSideNav` 的**頂層備用槽加到 8 個**(現在只有 2 個,放不下專案的 8 個頂層模組);加完後 scratch-lot 的 `Draft/ScratchLotSideNav` 改用底座側欄實例。
   - 底座參考畫面「Screen / Admin 資料範圍」的兩張舊規則卡換成 `Draft/DataScopeRuleCard` 實例(scratch-lot 7:10 已先換,實例 59:1847 / 59:2033),旁邊的註記卡「合成規則與資料影響」依新卡內容改寫。
5. 在 scratch-lot Screens 接受 Library 更新,把畫面上本地草稿元件的實例用 `swapComponent` 換成 Library 同名元件(屬性名相同,覆寫會保留),最後刪除「Base Draft / 本輪底座元件」頁的本地草稿。

## 畫圖檢查清單(每次派工都附上)

畫之前讀一次,畫完逐張對照;audit 的 `clippedText`、`misalignedRows`、`devTextInScreens` 要是 0 才算畫完。

1. **對齊**:同一列的欄位上緣、高度一致(例:叫貨分店與期望到貨日);同一欄的標籤寬度一致;區塊之間的間距用同一組 token。
2. **不裁切**:標籤、按鈕、表頭、Chip 的文字不能被外框裁掉或遮住;文字層用 auto width 或 fill,不要固定寬度又關掉換行;外框不要靠 clip content 藏住超出的內容。
3. **撐滿**:欄位與表格用 fill container 撐滿父層,不要手動寫寬度;改完重新檢查父層是 auto layout。
4. **三種尺寸**:電腦 1440 / 平板 1024 / 手機 390 各自截圖檢查;手機上不能出現水平捲動(表格與排班表例外,要有明確的捲動區)。
5. **示範資料**:數字要合理且彼此算得起來(合計、差額、批購金額率);張號從 001 起;名詞照規格名詞表。
6. **顏色**:專案頁只綁 scratch-lot Brand Library 的品牌色與底座語意色,不留底座主色;Base Draft 頁只綁底座。
7. **元件**:用底座 Library / 草稿元件的實例,不 detach;新元件先確認底座沒有。
8. **規格對照**:每張畫面列出它對應的規格章節,畫完逐項核對欄位、按鈕、權限、錯誤狀態。
9. **畫面內只放使用者看得到的內容**:畫面框內不能出現設計稿編號(ST- / IN- / PU- / AC- / RE- / DE- / MD- / SC- / RC- / RW- / BS-)、規格章節號、權限 key、錯誤碼或開發用說明(例「→ ST-07」「需要 show-cost」「RANGE_TOO_LARGE」);這些寫在畫面框外的註解文字(名稱「<畫面名> · 註解」)。權限提示要寫成使用者看得懂的話。`audit.js` 的 `devTextInScreens` 要是 0。 說明型小字也一樣:**留在畫面裡**的是使用者操作時需要的提示(例「錢從這一班的抽屜付出;同一張不能兌兩次」「超過 30 分鐘或這一班已交班 → 改送撤銷售出申請」「Enter 確認、Esc 取消」);**搬到框外**的是系統規則與實作說明(例「篩選條件存在網址」「從精靈送出,列表沒有 [+ 新增]」「駁回、作廢一律擋下,只能退回」「同一家店同時只能有一張盤點中」「平板:表格欄位依寬度保留重要欄」「找不到排班時報表標示未對應排班」)。一句裡兩種都有時,畫面留使用者那一半、整句原文放框外。

## 驗收稽核 `audit.js`

在 scratch-lot Screens 逐頁執行(一次一頁,把 `PAGE_ID` 換成要查的頁,所有頁平行各跑一次再加總)。

| 指標                          | 意義                                                                        | 回收完成時     |
| ----------------------------- | --------------------------------------------------------------------------- | -------------- |
| `baseDraftComponents`         | 本地的底座草稿元件(description 含「本輪草稿」)                              | 0              |
| `instancesOfBaseDrafts`       | 指向本地底座草稿的實例                                                      | 0              |
| `nodesWithDraftMarker`        | description 含「本輪草稿」的元件節點                                        | 0              |
| `nonBaseBindingsInBaseDrafts` | 底座草稿裡綁到非 wowgo-base 變數的節點                                      | 任何時候都是 0 |
| `basePrimaryBindings`         | Base Draft 以外的頁綁到 wowgo-base primary/* 的 fill / stroke(要補綁專案色) | 任何時候都是 0 |

基準值(2026-10-14,第二輪畫完):Base Draft 頁 25 / 175 / 25 / 0;各專案頁 `basePrimaryBindings` 皆為 0,底座草稿實例數:Project Draft 0、店面管理 186、叫貨與進貨 25、班表管理 133、庫存管理 8、帳戶管理 12、輸出報表 6、經銷商管理 42、檔案管理 14。

舊基準值(2026-10-13):Base Draft 頁 17 / 108 / 17 / 0;Screen / Admin 資料範圍頁 0 / 4 / 0 / —。專案元件(description 開頭「【專案・scratch-lot 專屬】」)不計入,也不回收。

## 屬性名(換實例時要對得上)

| 元件                     | 變體 / 屬性                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Draft/ActionIcon+        | `key=<name>`(17 個)                                                                |
| Draft/Section            | State=Expanded / Collapsed;Title、Summary(TEXT)                                    |
| Draft/AudiencePicker     | AllowEveryone=True / False × Value=Everyone / Conditions                           |
| Draft/DataScopeRuleCard  | Title(TEXT)                                                                        |
| Draft/OrgTreeSelect      | State=Closed / Open × Mode=Single / Multiple                                       |
| Draft/MonthCalendarCell  | State=Default / Today / Selected / Outside;Day(TEXT)、Show tag、Show slot(BOOLEAN) |
| Draft/RosterCell         | State=Empty / Filled / Selected                                                    |
| Draft/NotificationBell   | Unread=True / False                                                                |
| Draft/NotificationItem   | Read=False / True;Title、Body、Time(TEXT)                                          |
| Draft/NotificationPanel  | State=List / Empty                                                                 |
| Draft/NotificationToast  | Title、Body(TEXT)                                                                  |
| Draft/PrintButton        | State=Default / Sending / Printed / Failed / Reprint / Disabled                    |
| Draft/Receipt58Row       | Label、Value(TEXT)                                                                 |
| Draft/Receipt58Signature | Role(TEXT)                                                                         |
| Draft/Receipt58          | Org、Title(TEXT)、Reprint(BOOLEAN)                                                 |

## 解析函式兩種模式(`_resolve.js`)

| 函式          | `MODE = 'scratch'`                                           | `MODE = 'base'`                                |
| ------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| `tok(name)`   | `importVariableByKeyAsync(key)`                              | 本檔 local 變數中 `key` 相同者                 |
| `style(name)` | `importStyleByKeyAsync(key)`                                 | 本檔 local text / effect style 中 `key` 相同者 |
| `comp(name)`  | `importComponentSetByKeyAsync` / `importComponentByKeyAsync` | `getNodeByIdAsync(baseNode)`                   |
| `draft(name)` | 目前頁依名稱找本輪草稿元件                                   | 同左                                           |

執行時把 `_resolve.js` 全文貼在元件腳本前面;腳本預設在「目前頁」建立節點,執行前先切到目標頁。

## 已知風險

1. **ActionIcon+ 併入既有 set**:變體移入後,scratch-lot 內 ActionIcon+ 的實例要 swap 到 Draft/ActionIcon 的同名變體;Section、OrgTreeSelect、MonthCalendar、Notification、Print 內部的實例在底座重建時已直接用 Draft/ActionIcon,不受影響。
2. **中文字型**:沿用底座文字樣式(Public Sans);中文靠字型備援顯示,要在發布後於 scratch-lot 代表畫面核對中文、符號與排版(FIGMA-02)。
3. **通知鈴的位置**:底座 Draft/AdminAppBar 目前沒有通知鈴的槽;參考畫面暫以絕對定位疊在 AppBar 右側(旁邊有說明卡)。搬回底座時在 AppBar 加 BOOLEAN `Notifications`(見步驟 4)。
4. **側欄內容**:參考畫面的 Draft/AdminSideNav 沿用底座預設選單(含食譜示範),沒有「通知設定」「印表機管理」;搬回底座時補上(見步驟 4)。
5. **資料範圍參考畫面**:舊規則卡已換成新卡,但兩張卡內容相同(元件預設內容),旁邊舊的註記卡仍描述舊範例(規則 1 = 客服、規則 2 = 租戶 A),底座重建時一併改寫。
6. **通知設定頁示範資料**:已改為中性的底座情境(示範表單到期提醒、印表機離線、Email 寄送失敗);刮刮樂的提醒類型只出現在專案畫面。
7. **Overlay 遮罩**:半透黑遮罩依 FIGMA-06 慣例用固定色(黑 50%),不是變數綁定;與底座既有 Overlay 畫面一致。
8. **Brand 補綁**:草稿元件在 scratch-lot 顯示底座橘色(只綁底座變數);scratch-lot 品牌色由 Brand Sync 外掛在畫面層補綁,草稿元件本身不補。
9. **Receipt58 字色**:收據只用 grey/900 與 common/white(熱感紙只有黑),不跟深色模式。

## 專案畫面(scratch-lot 專屬):正本是 Figma

- **正本**:scratch-lot Screens 的 `Screen / *` 各頁與 `Project Draft / 刮刮樂元件`(64:14)。節點見 `nodes.md`。專案畫面不回收底座,以 Figma 為準;不維護「重跑就能畫出全部畫面」的腳本。
- **仍有效的腳本**(`project/`,都在 scratch 模式執行):

  | 腳本                           | 做什麼                                                                                                                                                                                 | 前置                                                                                                       |
  | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
  | `_header.js` + `components.js` | 專案元件:ScratchLotSideNav、TicketCell(主色、張號 001 起)、TicketGrid、DenominationCount、CashPointHeader(Open / Closed / Other + Mine)、BoardBookCard(Normal / LowStock),最後直向排列 | 底座草稿元件已在 Base Draft 頁                                                                             |
  | `r4-lib.js` + `r4-store.js`    | 店面管理:ST-36 卡片展開(PART 36、36m)、ST-37 拆本選本、ST-07 手動標記確認、ST-28b 日結版結帳確認申請、ST-09 拆本精靈、ST-18 示範金額修正                                               | 從現有畫面複製再改,需要 Figma 上的樣板畫面(ST-01、ST-37、ST-28a、IN-04 等,節點 id 寫在 `r4-lib.js` 與各段) |
  | `r4-lib.js` + `r4-reports.js`  | 營運報表 RE-04 平板 / 手機                                                                                                                                                             | 同上                                                                                                       |
  | `brand-rebind.js`              | 專案頁殘留的底座主色改綁 scratch-lot 品牌色(複製的 Button 換變體後要跑)                                                                                                                | —                                                                                                          |
  | `r4-layout.js`                 | 每頁依操作流程分列 + 畫面高度貼合內容(也用於 Base Draft)                                                                                                                               | —                                                                                                          |

- **已刪除的腳本**(git 歷史可查,最後一版在 commit `aa44333`):`_screen-helpers.js`、`_r3.js`、`r3-store.js`、`store.js`、`store-wizards.js`、`purchasing.js`、`schedule.js`、`store2.js`、`store2-bc.js`、`store2-d.js`、`seg4.js`、`seg5.js`、`seg6.js`。原因:這些畫面之後多次直接在 Figma 修改或重畫(平板 / 手機全部在暫存工具頁畫、第三輪重畫、第四~八輪就地修改),重跑只會得到舊畫面。
- **版面**:每個模組頁由上到下三個 Section「電腦 1440」「平板 1024」「手機 390」(店面管理另有「58mm 單據」接在最後)。Section 內依操作流程分列(`r4-layout.js` 的 `ROWS`),入口畫面後面接它打開的畫面;列左邊是框外列標題「列標題 / <名稱>」;三個 Section 的列相同,沒有該尺寸畫面的列只留標題並註明照共用規則。框名以畫面編號開頭,平板 / 手機加「 · 平板」「 · 手機」;框外註解「<畫面名> · 註解」跟在畫面右邊。
- **畫面高度**:有殼的畫面(main > content)高度 = 內容高度,至少一個視窗高(電腦 900、平板 768、手機 844);遮罩彈窗與手機底部面板不動。
- 專案元件 description 開頭固定「【專案・scratch-lot 專屬,不回收底座】」,`audit.js` 不把它們算進底座草稿。專案畫面上的底座草稿實例在底座 Library 發布後,要用 `swapComponent` 換成 Library 元件。
- **稽核**:`audit.js`(含 `devTextInScreens`)、`audit-layout.js` 每頁都要是 0。第三輪曾因 `al()` 預設裁切、OrgTreeSelect 標籤在框外、畫面沒撐高而有裁切與對齊問題,已修正並改成預設不裁切。
- **截圖注意**:伺服器端截圖(get_screenshot)對 Section 的 SLOT 內容有時顯示舊寬度;以外掛端 `node.screenshot()` 或 Figma 畫面為準。
- 執行時為了不重送工具組,可把腳本原文暫存在檔內一頁「_tooling(AI 暫存腳本,完工後刪除)」的文字節點再讀出來執行;完工後刪除該頁。正本仍是本資料夾的檔案。
