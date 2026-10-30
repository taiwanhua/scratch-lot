# 本輪底座元件:Figma 草稿與搬回底座的方法

> **底座規格已退場**:腳本、Figma 元件說明與 `nodes.md` 裡的「底座規格 N」指的是已刪除的 `docs/tmp/spec-base-round.md`(歷史查 git)。現況對照:3.0 人員條件 → `docs/modules/data-scope.md`、`docs/concepts/workflow-engine.md`;3.x 流程 / 表單 → `docs/concepts/workflow-engine.md`、`docs/modules/workflows.md`、`docs/modules/forms.md`;B7 / 第 5 章通知 → `docs/modules/notification-settings.md`;B8 / 第 6 章列印 → `docs/modules/printers.md`;10.1 → REACT-14;10.2–10.12 → `@repo/ui` 與 `apps/admin/src/components/base/` 的元件說明、`docs/concepts/frontend-architecture.md`;10.7 標籤色票(尚未實作)→ 專案規格第 18.5 節;10.13 → FIGMA-11~17。BS 編號的畫面名稱見下表,節點 id 見 `nodes.md`;設計稿與現況的差異見 `docs/tmp/project-dis.md`「Figma 待修清單」。

| 編號               | 畫面                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| BS-01              | 資料範圍:新規則卡(套用對象 + 條件組合)                                |
| BS-02a / c         | 流程設計器:審核者來源改人員條件(客製 / 共用流程)                      |
| BS-02b / d         | 審核者條件對話框(客製 / 共用流程)                                     |
| BS-03              | 流程設計器:每一關跳過、自動通過、逾時提醒、知會                       |
| BS-04a / b         | 表單模組 [+ 新增] 只列有新增權限的表單 / 表單發布成功提示授予新增權限 |
| BS-05              | 個人設定:偏好分頁(只有通知管道開關)                                   |
| BS-06a / b         | 個人設定:代理人分頁、新增代理                                         |
| BS-07a / b         | 申請中心「待我審核」批次核准、核准結果                                |
| BS-08              | 通知鈴、通知清單、通知提示                                            |
| BS-09a / b         | 通知設定頁、編輯收件人                                                |
| BS-10a / b         | 印表機管理:印表機分頁、新增代理程式(配對碼)                           |
| BS-11              | 列印按鈕各狀態、58mm 版面零件示範                                     |
| BS-12              | 表單設計器:分區的收合設定                                             |
| BS-13              | 欄位管理:選項顏色(色票)                                               |
| BS-14              | 側欄計數(展開 / 收合)                                                 |
| BS-15a / b         | 頁內分頁 PageTabs + 網址參數 / 放不下時橫向捲動                       |
| BS-16              | Stepper 各狀態                                                        |
| BS-17              | 印表機管理:新增 / 編輯印表機                                          |
| BS-18a / b / c / d | 印表機管理:測試列印結果(成功 / 缺紙 / 離線)/ 測試頁                   |
| BS-19 / BS-20      | 印表機管理:代理程式分頁 / 列印紀錄分頁                                |
| BS-21              | 表單設計器:「允許存草稿」開關                                         |
| BS-22              | ScheduleTimeline 時間軸(容器模式)                                     |
| BS-23              | MonthCalendar 多選日期與日期格角標                                    |

## 現況

- 本輪底座新元件與參考畫面先畫在 [scratch-lot Screens](https://www.figma.com/design/sXOJkIX53eBMUyDE8yYUJm) 的頁「Base Draft / 本輪底座元件」(`41:5914`)。節點清單見 `nodes.md`。
- 所有元件**只綁 wowgo-base Design System** 的變數(Color `9d2d67…`、Radius `84c5f3…`、Primitives `1eea29…`)、文字樣式與 effect 樣式;已用腳本稽核,沒有任何 scratch-lot Brand Library 綁定。
- 能用既有底座元件就用遠端實例(Button、IconButton、Tag、Badge、Select、SelectField、TextField、Radio、Checkbox、Switch、Alert、Tooltip、Tab、TableCell、Link、AdminSideNav / AppBar / RouteTabs)。
- PageTabs 不畫新元件:既有 Draft/Tabs 就是 @repo/ui/tabs,PageTabs 是它加網址同步與權限;印表機管理頁用 Draft/Tab × 3 示範。

## 搬回底座的方法(重建,不跨檔搬移)

1. 在 wowgo-base Design System 開一頁(例:「Draft / 本輪」),把 `_resolve.js` 的 `MODE` 改成 `'base'`,依序貼上「檔頭 + 元件腳本」執行:
   `ActionIcon+.js` →(只在 scratch 模式:`AdminSideNav+.js`)→ `Section.js` → `AudiencePicker.js` → `DataScopeRuleCard.js` → `OrgTreeSelect.js` → `MonthCalendar.js` → `RosterGrid.js` → `Notification.js` → `Snackbar.js` → `Print.js`。(`Screens.js` 第十九輪刪除:它自己組了一套殼與版面,畫面改由 `Screens2-base.js` 以現有畫面為底重畫。)
   第二輪起追加:`Stepper.js` → `Round2-base.js`(前置 `_compact.js`;RosterGrid 表頭彙總列、58mm 版面零件、Receipt58 改成零件組成)→ `Receipt58Test.js`(前置 `_compact.js`;58mm 文字列 / 一維條碼 / 切紙零件與 BS-18d 測試頁)→ `Screens2-base.js` 的 PART 1~~5(前置 `const PROJECT = false;` + `_kit.js` + `Base-ref.js`)。**第十九輪起參考畫面一律以現有畫面為底**:`Base-ref.js` 依名稱在本檔 `Screen / Admin …` 各頁找現有畫面複製(`refShell`),把非底座變數換回底座同名變數(`rebase`),再套本輪改動;對話框沿用現有對話框樣式、背景是打開它的畫面(`refOverlay`);框外註解寫「對應現有畫面 + 本輪改動」(`refNote`)。在 wowgo-base 重建前,先確認本檔參考畫面頁的名稱前綴(`REF_PAGE_PREFIX`)與框名和 scratch-lot 相同。PART 1 = BS-01~~03、2 = BS-04~~07、3 = BS-08、09、12、13、21、4 = BS-10、17~~20、5 = BS-11、14、15、16。第二十四輪追加:`RosterGrid-group.js`(前置 `_resolve.js`;Draft/RosterGrid 改成 Group=None / Expanded / Collapsed,頂部固定群組 + 收合彙總、停用欄整欄 grey/200,取代 Round2-base.js 的表頭彙總列)、`Interaction-states.js`(ScheduleTimelineBlock / Demand / RosterCell 的 Hover / Selected / Focus 互動狀態)、`TimelineMore-StatusChip.js`(Draft/ScheduleTimelineMore「+N」長條、Draft/StatusChip 狀態標籤,Tone × State)。`Section.js` 的內容區是 SLOT;`OrgTreeSelect.js` 是浮動標籤(高 56),下拉的列用現有 `Draft/OrgTreeItem`。
   - **三份檔頭都要設 `MODE = 'base'`**:`_resolve.js`(元件腳本)、`_compact.js`(Round2-base)、`_kit.js`(Screens2-base)。base 模式下變數 / 樣式依 key 找本檔 local,底座既有元件依節點 id(`_resolve.js` 的 `K.comp[*].baseNode`、`_kit.js` 的 `BASE_NODE`),本輪草稿元件依名稱在草稿頁「Draft / 本輪」找(`_compact.js` / `_kit.js` 的 `DRAFT_PAGE`、`draft()`、`node()`)。腳本裡沒有寫死 scratch-lot 的節點 id。
   - 三份檔頭的 `al()` 都預設不裁切內容(浮動標籤、陰影);表格、殼、Overlay 另外設定裁切。
   - `_kit.js` 的 `BASE_NODE` 還沒填的(Checkbox、Radio、TextField、Link、StatCard、AdminRouteTabs)和 `_resolve.js` 一樣,重建前要先在底座檔查到節點 id 補上;未填時腳本會直接報錯,不會靜默改用 Library。
   - 有依賴的要照順序(後面的會在目前頁找前面的草稿元件)。
   - 全部跑完後跑 `Base-layout.js`(`PAGE_ID` 設成草稿頁):元件區在上、畫面區在下,同類一列、固定間距、彼此不重疊;新元件或新畫面要加進它的 `ROWS`(沒列進的會排到最後的「其他」列)。`audit.js` 的 `canvasOverlap` 要是 0。
   - 第七、八輪核對過:Base Draft 上的文字(數字除外)都能在底座腳本裡找到(上面的註解卡除外),示範文字是中性內容。
   - `base` 模式:變數 / 樣式依同一個 key 找本檔 local;底座既有元件依 `K.comp[*].baseNode`(FIGMA-09 節點 id)。`K.comp` 裡只剩 `Draft/Snackbar` 沒填 `baseNode`(等 Snackbar 取代方式定案);其餘已在 2026-10-30 依 key 查到補上。
   - **元件腳本完整順序**(上面那段散落的順序整理成一張表;Base Draft 每個元件都要有建立它的腳本):

     | #   | 腳本                         | 建立(修改)的元件                                                                                                            | 前置檔     | 草稿頁要先有                          | base 模式           |
     | --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------- | ------------------- |
     | 1   | `ActionIcon+.js`             | ActionIcon+                                                                                                                 | `_resolve` | —                                     | 可                  |
     | 2   | `Section.js`                 | Section                                                                                                                     | `_resolve` | ActionIcon+                           | 可                  |
     | 3   | `AudiencePicker.js`          | AudiencePicker                                                                                                              | `_resolve` | ActionIcon+                           | 可                  |
     | 4   | `DataScopeRuleCard.js`       | DataScopeRuleCard                                                                                                           | `_resolve` | AudiencePicker                        | 可                  |
     | 5   | `OrgTreeSelect.js`           | OrgTreeSelect                                                                                                               | `_resolve` | ActionIcon+                           | 可                  |
     | 6   | `MonthCalendar.js`           | MonthCalendarCell、MonthCalendar                                                                                            | `_resolve` | ActionIcon+                           | 可                  |
     | 7   | `RosterGrid.js`              | RosterCell、RosterGrid                                                                                                      | `_resolve` | —                                     | 可                  |
     | 8   | `Notification.js`            | NotificationBell、NotificationItem、NotificationPanel                                                                       | `_resolve` | ActionIcon+                           | 可                  |
     | 9   | `Snackbar.js`                | Snackbar+                                                                                                                   | `_resolve` | ActionIcon+                           | 可                  |
     | 10  | `Print.js`                   | PrintButton、Receipt58Row、Receipt58Signature、Receipt58                                                                    | `_resolve` | ActionIcon+                           | 可                  |
     | 11  | `Stepper.js`                 | StepperStep、Stepper                                                                                                        | `_resolve` | ActionIcon+                           | 可                  |
     | 12  | `Round2-base.js`             | Receipt58Header、Receipt58TableRow、Receipt58Range、Receipt58Total、Receipt58Divider、Receipt58QR(改 RosterGrid、Receipt58) | `_compact` | RosterGrid、Receipt58、Row、Signature | 可                  |
     | 13  | `Receipt58Test.js`           | Receipt58Text、Receipt58Barcode、Receipt58Cut、BS-18d 測試頁                                                                | `_compact` | Receipt58 與 12 的零件                | 可                  |
     | 14  | `TimelineMore-StatusChip.js` | ScheduleTimelineMore、StatusChip                                                                                            | `_resolve` | —                                     | 可(2026-10-30 改寫) |
     | 15  | `ScheduleTimeline-parts.js`  | ScheduleAutoMark、BreakMark、ScheduleTimelineDemand、ScheduleTimelineBlock(含互動狀態)                                      | `_resolve` | —                                     | 可(2026-10-30 新增) |
     | 16  | `ScheduleTimeline.js`        | ScheduleTimeline                                                                                                            | `_resolve` | 14、15;底座 TableHeaderCell           | 可(2026-10-30 新增) |
     | 17  | `RosterGrid-group.js`        | (RosterGrid 改成 Group 變體)                                                                                                | `_resolve` | RosterGrid、StatusChip                | 可                  |
     | 18  | `Interaction-states.js`      | (RosterCell 加 Hover / Focus;Block / Demand 已有互動狀態就跳過)                                                             | `_resolve` | 7、15                                 | 可(2026-10-30 改寫) |
     | 19  | `StateLayer.js`              | (舊的第二層疊色轉成 state-layer 圖層;沒有舊疊色就不動)                                                                      | —          | 7、14、15                             | 可(2026-10-30 改寫) |
     | 20  | `ToggleButton.js`            | ToggleButton                                                                                                                | `_resolve` | —                                     | 可(2026-10-30 改寫) |
     | 21  | `Base-layout.js`             | (排版)                                                                                                                      | `PAGE_ID`  | 全部                                  | 可                  |

     原本標「不可」與「沒有腳本」的 6 支已照 `_resolve.js` 檔頭的規則(元件本體只透過 `tok()` / `style()` / `comp()` / `draft()` 取資源)與上一段「腳本裡沒有寫死 scratch-lot 的節點 id」改寫或新增(2026-10-30),和現況的核對結果記在 nodes.md。

     第 2 步(ActionIcon+ 併入 Draft/ActionIcon)完成後,表中「草稿頁要先有 ActionIcon+」改為底座 `Draft/ActionIcon`(2001:68,已含本輪 19 個 key);2、5、6、8~11 列的腳本已改用 `await comp("Draft/ActionIcon")`(2026-10-30)。
2. **ActionIcon+ 併入 Draft/ActionIcon**:在底座檔把 `Draft/ActionIcon+` 的 19 個變體移進既有 set `Draft/ActionIcon`(2001:68)成為新的 `key=` 變體,刪除空的 ActionIcon+ set;重建其他元件前把腳本裡的 `draft('Draft/ActionIcon+')` 改為 `comp('Draft/ActionIcon')`(兩者變體名相同)。
3. 底座 Library 依 `docs/deployment.md` 的 Release 步驟發布(Library 版本與 Git tag 互相指向)。
4. **底座既有元件與畫面的修改**(scratch-lot 不能改底座元件,所以留到這一步在底座檔直接改):
   - `Draft/AdminAppBar`(2001:1248)加 BOOLEAN `Notifications`,右側放 `Draft/NotificationBell` 實例(使用者已同意)。重建後,參考畫面上以絕對定位疊加的鈴(圖層名 `notification-bell(待 AppBar 加槽)`)改用這個屬性並刪除疊加層;(鈴只疊在 BS-08,說明寫在它的框外註解。)
   - `Draft/AdminSideNav`(2001:1214)系統管理群組的**備用槽從 4 個加到 5 個**:group-children 複製 spare-4 成 spare-5。順序:現有 8 項(組織管理、使用者管理、角色管理、模組與權限、欄位管理、資料範圍 = spare-1、表單管理 = spare-2、流程管理 = spare-3)→ 通知設定 = spare-4 → 印表機管理 = spare-5;圖示 `notifications`、`print`。scratch-lot 先用過渡草稿 `Draft/AdminSideNav+`(`AdminSideNav+.js`,只在 scratch 模式建)放第 5 個槽,參考畫面的側欄都換成它;底座加槽並發布後,把這些實例換回 `Draft/AdminSideNav`、刪掉草稿。wowgo-base 重建時不跑 `AdminSideNav+.js`,`Base-ref.js` 的 `sysNav()` 直接填現有側欄的 spare-1~5。
   - `Draft/AdminSideNav` 的**頂層備用槽加到 8 個**(現在只有 2 個,放不下專案的 8 個頂層模組);加完後 scratch-lot 的 `Draft/ScratchLotSideNav` 改用底座側欄實例。
   - 底座參考畫面「Screen / Admin 資料範圍」的兩張舊規則卡換成 `Draft/DataScopeRuleCard` 實例(scratch-lot 7:10 已先換,實例 59:1847 / 59:2033),旁邊的註記卡「合成規則與資料影響」依新卡內容改寫。
5. 在 scratch-lot Screens 接受 Library 更新,把畫面上本地草稿元件的實例用 `swapComponent` 換成 Library 同名元件(屬性名相同,覆寫會保留),最後刪除「Base Draft / 本輪底座元件」頁的本地草稿。
6. **標籤色票變數 tagPalettes**(底座規格 10.7):在 wowgo-base Design System Library 新增變數集合 `tagPalettes`,和 scratch-lot 本機的 `Draft/tagPalettes` **同名同結構**(10 組 `blue / cyan / green / lime / yellow / orange / red / pink / purple / grey` × `bg / text`;mode `Light` / `Dark`;bg scopes `FRAME_FILL` + `SHAPE_FILL`、text scopes `TEXT_FILL`;色值見 `Base-ref.js` 的 `TAG_PALETTES`,深色組文字對底色都達 WCAG AA)。base 模式重建時 `tagPalettes()` 直接建在本檔。發布後,在 scratch-lot 把 Base Draft 與專案頁**所有綁 `Draft/tagPalettes` 的節點改綁 Library 的 `tagPalettes` 同名變數**,再刪掉本機的 `Draft/tagPalettes`。
   - **回收驗收**:`audit.js` 每一頁的 `draftTokenBindings` 都是 0(沒有節點還綁著 `Draft/` 開頭的本機集合),且本機已沒有 `Draft/tagPalettes`。

## 每次改圖的固定流程(每次派工都附上)

**改之前**:**先找現有畫面 / 元件並截圖對照**——底座畫面在本檔 `Screen / Admin …` 各頁、元件在 wowgo-base Library;設計以現有為底,只畫差異(底座參考畫面用 `Base-ref.js` 複製現有畫面再改;專案頁的外殼、列表、表單也要和底座現有樣式一致,不另組一套)。再列出影響範圍——規格章節、三種尺寸的畫面、元件、入口對照、畫面清單、腳本;共用區塊先改元件,不在單張畫面手改(標題列、頂部列、側欄、app-bar、看板卡片、張數格子、Stepper)。

**改之後**(全部通過才能回報):

1. **全部頁面重跑自動檢查**,不能只跑有改的頁:`audit.js` / `audit-layout.js`(裁切、對齊、外溢、底座主色、畫面內開發文字)、頁上與 Section 內的頂層重疊、`audit-sync.js`(三尺寸按鈕一致、共用區塊非元件數、畫面寬度等於 Section 寬度、篩選抽屜)。
2. **人工核對**:入口與它打開的畫面都有;三種尺寸同步;名詞符合名詞表;示範數字算得起來;用不到的節點已刪;規格 / 畫面清單 / 入口對照 / 腳本已同步。
3. **有改到的畫面逐張截圖**。
4. **回報**附每頁自動檢查的原始數字與人工核對結果,做不到的明說。
5. 協調者收到後自己重跑抽查,再轉給使用者。

## 畫圖檢查清單(每次派工都附上)

畫之前讀一次,畫完逐張對照;audit 的 `clippedText`、`misalignedRows`、`devTextInScreens`,以及 `audit-sync.js` 的 `syncDiffs`、`sharedHandDrawn` 要是 0 才算畫完。

1. **對齊**:同一列的欄位上緣、高度一致(例:叫貨分店與期望到貨日);同一欄的標籤寬度一致;區塊之間的間距用同一組 token。
2. **不裁切**:標籤、按鈕、表頭、Chip 的文字不能被外框裁掉或遮住;文字層用 auto width 或 fill,不要固定寬度又關掉換行;外框不要靠 clip content 藏住超出的內容。
3. **撐滿**:欄位與表格用 fill container 撐滿父層,不要手動寫寬度;改完重新檢查父層是 auto layout。
4. **三種尺寸**:電腦 1440 / 平板 1024 / 手機 390 各自截圖檢查;手機上不能出現水平捲動(表格與排班表例外,要有明確的捲動區)。
5. **示範資料**:數字要合理且彼此算得起來(合計、差額、批購金額率);張號從 001 起;名詞照規格名詞表。
6. **顏色**:專案頁只綁 scratch-lot Brand Library 的品牌色與底座語意色,不留底座主色;Base Draft 頁只綁底座。
7. **元件**:用底座 Library / 草稿元件的實例,不 detach;新元件先確認底座沒有。
8. **規格對照**:每張畫面列出它對應的規格章節,畫完逐項核對欄位、按鈕、權限、錯誤狀態。
9. **畫面內只放使用者看得到的內容**:畫面框內不能出現設計稿編號(ST- / IN- / PU- / AC- / RE- / DE- / MD- / SC- / RC- / RW- / BS-)、規格章節號、權限 key、錯誤碼或開發用說明(例「→ ST-07」「需要 show-cost」「RANGE_TOO_LARGE」);這些寫在畫面框外的註解文字(名稱「<畫面名> · 註解」)。權限提示要寫成使用者看得懂的話。`audit.js` 的 `devTextInScreens` 要是 0。 說明型小字也一樣:**留在畫面裡**的是使用者操作時需要的提示(例「錢從這一班的抽屜付出;同一張不能兌兩次」「超過 30 分鐘或這一班已交班 → 改送撤銷售出申請」「Enter 確認、Esc 取消」);**搬到框外**的是系統規則與實作說明(例「篩選條件存在網址」「從精靈送出,列表沒有 [+ 新增]」「駁回、作廢一律擋下,只能退回」「同一家店同時只能有一張盤點中」「平板:表格欄位依寬度保留重要欄」「找不到排班時報表標示未對應排班」)。一句裡兩種都有時,畫面留使用者那一半、整句原文放框外。
10. **三尺寸共用區塊要用同一個元件實例,改元件不改手畫框**:收銀點標題列(CashPointHeader)、看板頂部列(StoreTopBar)、看板卡片(BoardBookCard)、張數格子與圖例(TicketCell / TicketGridLegend)、Stepper(StepperStep)、側欄(電腦 ScratchLotSideNav、平板 ScratchLotNavRail)在三種尺寸都用元件實例,尺寸差異做成元件的 Size 變體;平板 / 手機放不下的按鈕可以收進「更多」,但入口要看得到。同一個畫面編號在三種尺寸的標題列 / 頂部列按鈕要一樣(`audit-sync.js` 的 `syncDiffs` 為 0),版面本來就不同的寫進 `EXEMPT` 並附理由。
11. **確認視窗的大小**:只有一兩句話、沒有表單欄位的確認視窗(例:撤銷這張售出?、撤銷兌獎?、發布確認),手機也畫成置中的小視窗(寬 342,按鈕在視窗底部);有表單欄位、或內容是長清單 / 明細的才畫成全螢幕(app-bar 用 `Kind=Dialog`)。正本是專案規格 16.0。
12. **每張畫面 = 一個視窗尺寸**:電腦 Section 的畫面寬 1440、平板 1024、手機 390(58mm 單據 Section 不在此限);同一個編號有多個對話框時拆成各自的畫面(遮罩 + 對話框,編號加 a / b / c),精靈的每一步畫成完整畫面,不要並排在同一張框裡。`audit-sync.js` 的 `sectionMismatch` 要是 0。
13. **篩選**:有 [篩選] 按鈕的平板 / 手機畫面,要嘛有自己的篩選抽屜畫面(名稱含「篩選」),要嘛框外註解寫明照 RW-01;`filterDrawerMissing` 要是 0。
14. **對話框背景是打開它的頁面**:遮罩 + 對話框 / 抽屜 / 底部面板的畫面,背景放入口畫面(依入口對照,同分店、同班、同示範資料)的副本(圖層名「背景:<入口畫面>」,鎖定)再蓋 scrim(黑、不透明度 50%),不能只有灰底。`audit-sync.js` 的 `overlayNoPage` 要是 0;背景頁裡的標題列不算進三尺寸按鈕比對。
15. **權限差異**:只有畫面差很多的才另外畫「權限不足」版本;其他畫面在框外註解寫「- 權限:沒有 `<權限>` 權限時看不到 [按鈕]」,和規格對應章節同一句。
16. **放不下的分頁列**:單列橫向捲動,有更多分頁的那一側放漸層 + ‹ / ›(圖層名 `scroll-edge:start` / `scroll-edge:end`),選到的分頁捲進可視範圍;外框命名「PageTabs(可捲動)」,裡面超出的分頁不算裁切(`audit-layout.js`)。
17. **以現有為底**:每張底座參考畫面先複製現有的 `Screen / Admin …` 畫面(側欄、頁首、分頁、卡片、表格、欄位、按鈕、對話框樣式都沿用),只畫本輪改動;框外註解第一行寫「對應現有畫面:<框名>」。新元件先對照 Library 有沒有同功能的元件(例:組織樹列用現有 `Draft/OrgTreeItem`、搜尋框用現有 TextField),有就沿用;用詞也沿用現有畫面(例:表單設計器叫「分區」)。`audit.js` 的 `baseScreensNotFromRef`(沒有對應註解或頁首不是 Library AppBar)與 `nonBaseInBaseScreens`(Base Draft 畫面綁到非底座變數)要是 0。
18. **左右兩欄填滿畫面高度**:列表 + 詳情、類別 + 選項、目標 + 規則這類兩欄的頁面,兩欄都撐到畫面底部(等高);面板裡的工作區(畫布 + 屬性面板)撐到面板底部,右側屬性面板 / 關卡面板滿版;表單設計器的檢查結果放在左側版面那一欄的底部(同流程設計器)。腳本用 `Base-ref.js` 的 `fillColumns()`;`audit.js` 的 `baseScreensNotFromRef` 會列出「左右兩欄沒有填滿畫面高度」。
19. **提示一律用 Snackbar**:操作結果、可撤銷的動作、新通知提示都用 `Draft/Snackbar+`(底座規格 10.12):電腦 / 平板右下角、手機底部滿寬,不畫頂部黑底提示。
20. **浮層**:彈出選單、通知清單這類本來就蓋在頁面上的浮層,節點名稱要含「浮層」(例「通知清單(浮層)」);`audit-layout.js` 的 `overlapText` 不算浮層本身蓋到下層文字,但浮層裡面的元件蓋到浮層內的文字照樣算。不要用改父層的方式躲過檢查。
21. **圖例和標示一一對應、顏色只用共用色票**:(1)畫面上每個顏色、圖示、符號、線型(實線 / 虛線)都要在同一張畫面的圖例找到外觀一樣的項目;(2)圖例的每一項在這個檢視都會出現;(3)同一個顏色或符號在整個模組只有一個意思;(4)顏色一律綁共用色票變數(wowgo-base Design System、專案 Brand Library),不自創顏色。圖例用 `Draft/LegendItem`,樣本和畫面上的標示同一外觀(實心就實心、虛線就虛線)。`audit-legend.js` 的 `unboundColors`、`legendMismatch` 要是 0;(1)(3)要看意思,每次截圖逐張對。例外:同一個元件狀態用在不同畫面時,圖例文字可以依那個畫面的意思改寫(例:TicketGridLegend 在盤點把「已選」寫成「在(已點)」),顏色和狀態仍一對一;設計這類元件時先盤點所有使用處再定 props。

22. **元件裡的文字不能溢出**:元件實例(含主元件本身)裡的文字要在它所在、最近一層有填色或框線的父框裡;直屬父框是 auto layout 時,也要在內距範圍內(容許 1px)。固定尺寸的小框(圖例樣本、窄長條、狀態標籤、表頭格)放不下時,改內距 / 尺寸或讓文字換行(文字 fill + 固定寬換行,父框 hug 高度),不要靠擠出內距。`audit-layout.js` 的 `overflowTextInInstance` 要是 0(`clippedText` / `overflowNodes` 不看實例內部,這項補上)。

23. **遮罩與全螢幕對話框蓋滿畫面**:有「背景:…」或 scrim 的畫面,scrim、全螢幕對話框(full-dialog)、背景要從頂到底、左到右蓋滿畫面框;抽屜(drawer)從頂到底;底部面板(bottom-sheet)貼齊畫面底部。背景頁之後變高(例:班表加人)時要跟著撐滿(`r5-kit.js` 的 `coverOverlay()`),不能露出背景內容。`audit-sync.js` 的 `overlayNotCovering` 要是 0。
24. **互動狀態照 MUI**:滑過 = 原底色上疊同色系 main × 8%(同一節點第二層填色、綁變數 + paint opacity),框換同色系 main;已選取 = 疊 main × 16% + 1px main 框(框不佔版面)。長條 primary、白底與 grey 底 grey/500、Warning warning/main、Error error/main;不新增變數、不寫死色碼。`brand-rebind.js` 換綁時保留 paint 不透明度。

25. **時間軸容器內列距一致**:日模式容器(人力需求)裡上下堆疊的長條、缺額空位、停用條間距一律 4px,長條高度改變(例:隱藏空白副標)後要重排、容器跟著縮。`audit-layout.js` 的 `rowGapInContainer` 要是 0。

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

| 元件                     | 變體 / 屬性                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------ |
| Draft/ActionIcon+        | `key=<name>`(19 個,含 menu、more-horiz)                                              |
| Draft/Section            | State=Expanded / Collapsed;Title、Summary(TEXT)                                      |
| Draft/AudiencePicker     | AllowEveryone=True / False × Value=Everyone / Conditions                             |
| Draft/DataScopeRuleCard  | Title(TEXT)                                                                          |
| Draft/OrgTreeSelect      | State=Closed / Open × Mode=Single / Multiple                                         |
| Draft/MonthCalendarCell  | State=Default / Today / Selected / Outside;Day(TEXT)、Show tag、Show slot(BOOLEAN)   |
| Draft/RosterCell         | State=Empty / Filled / Selected;`Corner#719:0`(BOOLEAN)、`CornerContent#719:6`(SLOT) |
| Draft/NotificationBell   | Unread=True / False                                                                  |
| Draft/NotificationItem   | Read=False / True;Title、Body、Time(TEXT)                                            |
| Draft/NotificationPanel  | State=List / Empty                                                                   |
| Draft/NotificationToast  | Title、Body(TEXT)                                                                    |
| Draft/PrintButton        | State=Default / Sending / Printed / Failed / Reprint / Disabled                      |
| Draft/Receipt58Row       | Label、Value(TEXT)                                                                   |
| Draft/Receipt58Signature | Role(TEXT)                                                                           |
| Draft/Receipt58          | Org、Title(TEXT)、Reprint(BOOLEAN)                                                   |

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
3. **通知鈴的位置**:底座 Draft/AdminAppBar 目前沒有通知鈴的槽;BS-08 暫以絕對定位疊在 AppBar 右側(說明在框外註解)。搬回底座時在 AppBar 加 BOOLEAN `Notifications`(見步驟 4)。
4. **側欄內容**:參考畫面的側欄是現有畫面的副本(現有選單,不是元件預設的食譜示範),換成過渡草稿 `Draft/AdminSideNav+`,系統管理群組一律是 8 項 → 通知設定 → 印表機管理(見步驟 4)。
5. **資料範圍參考畫面**:舊規則卡已換成新卡,但兩張卡內容相同(元件預設內容),旁邊舊的註記卡仍描述舊範例(規則 1 = 客服、規則 2 = 租戶 A),底座重建時一併改寫。
6. **通知設定頁示範資料**:已改為中性的底座情境(示範表單到期提醒、印表機離線、Email 寄送失敗);刮刮樂的提醒類型只出現在專案畫面。
7. **Overlay 遮罩**:半透黑遮罩依 FIGMA-06 慣例用固定色(黑 50%),不是變數綁定。現有底座 Overlay 畫面是灰底、沒有背後的頁面;本輪參考畫面依檢查清單 14 改成「背景是打開它的畫面」,現有的 Overlay 畫面要不要一起改,待使用者決定。
8. **Brand 補綁**:草稿元件在 scratch-lot 顯示底座橘色(只綁底座變數);scratch-lot 品牌色由 Brand Sync 外掛在畫面層補綁,草稿元件本身不補。
9. **Receipt58 字色**:收據只用 grey/900 與 common/white(熱感紙只有黑),不跟深色模式。

10. **PageTabs 捲動邊緣的漸層**:BS-15b 的漸層暫用白色(漸層停點不能綁變數),搬回底座時改用 bg/paper 的色值。
11. **ScheduleTimeline**:示範文字已改成中性內容(櫃台 A、早班),表頭改用現有 Draft/TableHeaderCell,區塊文字不截斷(第二十二輪)。
12. **標籤色票先用本機變數**:Library 還沒有 tagPalettes,BS-13 的色票先綁 scratch-lot 本機集合 `Draft/tagPalettes`(過渡用,`audit.js` 的 `draftTokenBindings` 會列出這些節點,現階段只回報、不算錯)。回收時照「搬回底座的方法」第 6 步在 Library 新增同名集合、改綁、刪本機集合;回收後 `draftTokenBindings` 必須是 0。

## 專案畫面(scratch-lot 專屬):正本是 Figma

- **正本**:scratch-lot Screens 的 `Screen / *` 各頁與 `Project Draft / 刮刮樂元件`(64:14)。另有規則示範頁 `Screen / 班表時間軸 · 各種情況`(401:805,排在班表管理頁後面):週 / 日時間軸的 15 種情況(並排、+N 人、+N 需求與清單浮層、缺額、延伸、互動狀態…),不是產品畫面,`audit-sync.js` 不比對,`audit-layout.js` / `audit-legend.js` 照跑。節點見 `nodes.md`(三尺寸節點總表:班表頁「依編號整理的節點表(10/16 總核對)」、其他專案頁「依編號整理的節點表:其他專案頁(10/19 唯讀掃描)」)。專案畫面不回收底座,以 Figma 為準;不維護「重跑就能畫出全部畫面」的腳本。
- **仍有效的腳本**(`project/`,都在 scratch 模式執行):

  | 腳本                                                                                                  | 做什麼                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 前置                                                                                                       |
  | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
  | `_header.js` + `components.js`                                                                        | 專案元件:ScratchLotSideNav、TicketCell(主色、張號 001 起、9 種狀態變體)、TicketGrid(含圖例)、TicketGridLegend、DenominationCount、CashPointHeader(Size 電腦 / 平板 / 手機 × Open / Closed / Other + Mine)、BoardBookCard(Normal / LowStock)、StoreTopBar(Size 三種 + MyShifts)、ScratchLotNavRail、ScratchLotAppBar(Size 平板 / 手機 × Kind Page / Back / Dialog + Title / Org / Action),最後直向排列                                                                                                                                                                                                  | 底座草稿元件已在 Base Draft 頁                                                                             |
  | `r4-lib.js` + `r4-store.js`                                                                           | 店面管理:ST-36 卡片展開(PART 36、36m)、ST-37 拆本選本、ST-07 手動標記確認、ST-28b 日結版結帳確認申請、ST-09 拆本精靈、ST-18 示範金額修正;庫存管理 IN-04 更正跳號平板 / 手機(PART "IN04");兌獎撤銷 ST-38 / ST-39(PART "38"、"39");盤點不鎖與補登兌獎 ST-13 / 14 / 15(PART "13")、兌獎紀錄分頁 ST-40(PART "40")                                                                                                                                                                                                                                                                                          | 從現有畫面複製再改,需要 Figma 上的樣板畫面(ST-01、ST-37、ST-28a、IN-04 等,節點 id 寫在 `r4-lib.js` 與各段) |
  | `r4-lib.js` + `r4-sync.js`                                                                            | 第十四輪三尺寸同步:手畫的頂部列 / 平板側欄換元件實例(PART "swap");ST-34 平板 / 手機切換後的看板("34");ST-35 補標題列("35");ST-38 拆成 38a / 38b("38");撤銷兌獎確認 ST-41("41");ST-20 [日結] 停用畫面("20");精靈 / 盤點頁平板 / 手機補 [取消]("wiz");audit-sync 列出的其他不一致:ST-34 電腦頂部列、IN-03 頁首命名、PU-06 / 07 / 10b 平板 / 手機頁首、SC-07 平板 / 手機動作列("fix");第十五輪:app-bar 換元件實例("appbar")、確認視窗手機置中小視窗("mdlg")、ST-08 撤銷售出確認("08")                                                                                                                     | 同上;`components.js` 第 5、9、10 節的元件已建好                                                            |
  | `r4-lib.js` + `r4-purchasing.js`                                                                      | 叫貨與進貨:新增頁 [存草稿]、三張列表的「草稿」示範列與篩選                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 同上                                                                                                       |
  | `r4-lib.js` + `r4-reports.js`                                                                         | 營運報表 RE-04 平板 / 手機                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 同上                                                                                                       |
  | `r5-kit.js` + `r5-roster.js` + `r5-schedule.js`(PART my)+ `r5-schedule-parts.js`(PART dayoff、roster) | 班表管理頁依討論決定重做(第二十二輪;第二十三輪重跑 PART roster:固定欄、統計欄、自動排入 / 未對應打卡圖示、LegendItem 圖例。kit 的 `inst()` 改吃主元件 id,SHELL 指向第二十三輪新畫面;腳本組合後用 esbuild 壓縮貼進 use_figma):我的班表(班表與打卡、我的畫休)、排班表頁(班表檢視、檢核面板、只能檢視、沒有人力需求、已發布、自動排班完成)。其餘班表畫面(四種檢視、對話框、套用範本、自動排班、發布、畫休總覽、行事曆、支援需求單、排班設定、出勤紀錄、補打卡)與店面管理 ST-04 / ST-42 以 Figma 為準(本輪直接在 Figma 組出、修過多次,沒有整理成可重跑的腳本)。畫完跑 `brand-rebind.js`(PAGE_ID = "70:14") |
  | `r6-week.js`                                                                                          | 班表週檢視 SC-44 電腦 / 平板的每一天:照週模式排版(容器寬 20 + 28 × 條數,依排序放最左邊空得下的位置,放不下整筆收起,有收起時當天欄最右邊一條佔滿時間軸的「+N」長條)、缺額佔一條、長條延伸                                                                                                                                                                                                                                                                                                                                                                                                                | 先貼 `_timeline-layout.js`;SC-44 上已有容器 / 長條 / 延伸段範本                                            |
  | `r6-timeline-cases.js`                                                                                | 規則示範頁「Screen / 班表時間軸 · 各種情況」整頁重畫:測試案例 T-01~~T-17 × 週電腦 157 / 週平板 125 / 日檢視 + 輸入與預期輸出(腳本比對 layoutTimeline 實際結果,回傳 mismatch)                                                                                                                                                                                                                                                                                                                                                                                                                           | 先貼 `_timeline-layout.js`;SC-44、SC-45 電腦當範本;畫完跑 `brand-rebind.js`(PAGE_ID = 該頁)                |
  | `_timeline-layout.js`                                                                                 | 週模式排版純函式 `layoutTimeline(groups, dayWidth)`(r6-week.js 與 r6-timeline-cases.js 共用,位置不手填)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 貼在上述兩支腳本前面                                                                                       |
  | `r6-sc60b.js`                                                                                         | SC-60 拆兩張:SC-60 只示範滑過長條;SC-60b 時間軸捲到 07:00 起示範空白格「+ 人力需求」;SC-44 / 45 註解補「0–24 可捲動」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 跑完接 `r4-layout.js`、`brand-rebind.js`                                                                   |
  | `audit-roster.js`(資料夾根目錄)                                                                       | 同月同店的所有班表檢視(含背景複本)逐格比對 SC-03:格子、徽章、人力需求區、統計欄,`total` 要是 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | —                                                                                                          |
  | `r4-legend.js`                                                                                        | 既有畫面的張數格子:狀態改用 TicketCell 變體、每列 10 格、格子上方放 TicketGridLegend、拿掉文字圖例(每頁跑一次)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `components.js` 已建好圖例與變體                                                                           |
  | `brand-rebind.js`                                                                                     | 專案頁殘留的底座主色改綁 scratch-lot 品牌色(複製的 Button 換變體後要跑)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | —                                                                                                          |
  | `r4-layout.js`                                                                                        | 每頁依操作流程分列 + 畫面高度貼合內容(Base Draft 改用 `Base-layout.js`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | —                                                                                                          |

- **已刪除的腳本**(git 歷史可查,最後一版在 commit `aa44333`):`_screen-helpers.js`、`_r3.js`、`r3-store.js`、`store.js`、`store-wizards.js`、`purchasing.js`、`schedule.js`、`store2.js`、`store2-bc.js`、`store2-d.js`、`seg4.js`、`seg5.js`、`seg6.js`。原因:這些畫面之後多次直接在 Figma 修改或重畫(平板 / 手機全部在暫存工具頁畫、第三輪重畫、第四~八輪就地修改),重跑只會得到舊畫面。 第二十二輪另刪除 `r4-schedule.js`(對象是已刪除的舊班表節點,重跑只會報錯;最後一版在 commit `41d02a6`)。
- **版面**:每個模組頁由上到下三個 Section「電腦 1440」「平板 1024」「手機 390」(店面管理另有「58mm 單據」接在最後)。Section 內依操作流程分列(`r4-layout.js` 的 `ROWS`),入口畫面後面接它打開的畫面;列左邊是框外列標題「列標題 / <名稱>」;三個 Section 的列相同,沒有該尺寸畫面的列只留標題並註明照共用規則。框名以畫面編號開頭,平板 / 手機加「 · 平板」「 · 手機」;框外註解「<畫面名> · 註解」跟在畫面右邊。
- **畫面高度**:有殼的畫面(main > content)高度 = 內容高度,至少一個視窗高(電腦 900、平板 768、手機 844);遮罩彈窗與手機底部面板不動。
- 專案元件 description 開頭固定「【專案・scratch-lot 專屬,不回收底座】」,`audit.js` 不把它們算進底座草稿。專案畫面上的底座草稿實例在底座 Library 發布後,要用 `swapComponent` 換成 Library 元件。
- **稽核**:`audit.js`(含 `devTextInScreens`)、`audit-layout.js` 每頁都要是 0;`audit-sync.js`(一次跑全部專案頁)的 `syncDiffs`(三尺寸標題列按鈕不一致)、`sharedHandDrawn`(共用區塊非元件數)、`sectionMismatch`(畫面寬度不等於所在 Section 的寬度,或「· 平板 / · 手機」放錯 Section)、`filterDrawerMissing`(平板 / 手機有 [篩選] 卻沒有篩選抽屜畫面、註解也沒寫照 RW-01)都要是 0,`exempted` 照列理由回報。第三輪曾因 `al()` 預設裁切、OrgTreeSelect 標籤在框外、畫面沒撐高而有裁切與對齊問題,已修正並改成預設不裁切。
- **截圖注意**:伺服器端截圖(get_screenshot)對 Section 的 SLOT 內容有時顯示舊寬度;以外掛端 `node.screenshot()` 或 Figma 畫面為準。
- 執行時為了不重送工具組,可把腳本原文暫存在檔內一頁「_tooling(AI 暫存腳本,完工後刪除)」的文字節點再讀出來執行;完工後刪除該頁。正本仍是本資料夾的檔案。
