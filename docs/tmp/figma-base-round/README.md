# 本輪底座元件:Figma 草稿與搬回底座的方法

## 現況

- 本輪底座新元件與參考畫面先畫在 [scratch-lot Screens](https://www.figma.com/design/sXOJkIX53eBMUyDE8yYUJm) 的頁「Base Draft / 本輪底座元件」(`41:5914`)。節點清單見 `nodes.md`。
- 所有元件**只綁 wowgo-base Design System** 的變數(Color `9d2d67…`、Radius `84c5f3…`、Primitives `1eea29…`)、文字樣式與 effect 樣式;已用腳本稽核,沒有任何 scratch-lot Brand Library 綁定。
- 能用既有底座元件就用遠端實例(Button、IconButton、Tag、Badge、Select、SelectField、TextField、Radio、Checkbox、Switch、Alert、Tooltip、Tab、TableCell、Link、AdminSideNav / AppBar / RouteTabs)。
- PageTabs 不畫新元件:既有 Draft/Tabs 就是 @repo/ui/tabs,PageTabs 是它加網址同步與權限;印表機管理頁用 Draft/Tab × 3 示範。

## 搬回底座的方法(重建,不跨檔搬移)

1. 在 wowgo-base Design System 開一頁(例:「Draft / 本輪」),把 `_resolve.js` 的 `MODE` 改成 `'base'`,依序貼上「檔頭 + 元件腳本」執行:
   `ActionIcon+.js` → `Section.js` → `AudiencePicker.js` → `DataScopeRuleCard.js` → `OrgTreeSelect.js` → `MonthCalendar.js` → `RosterGrid.js` → `Notification.js` → `Print.js` → `Screens.js`。
   - 有依賴的要照順序(後面的會在目前頁找前面的草稿元件)。
   - `base` 模式:變數 / 樣式依同一個 key 找本檔 local;底座既有元件依 `K.comp[*].baseNode`(FIGMA-09 節點 id)。`K.comp` 裡還沒填 `baseNode` 的元件(Draft/Select、Draft/SelectField、TextField、Draft/Checkbox、Link、Draft/Radio、Draft/Snackbar、Draft/Popover、Draft/AdminRouteTabs、Draft/ConfirmDialog),重建前要先在底座檔查到節點 id 補上。
2. **ActionIcon+ 併入 Draft/ActionIcon**:在底座檔把 `Draft/ActionIcon+` 的 17 個變體移進既有 set `Draft/ActionIcon`(2001:68)成為新的 `key=` 變體,刪除空的 ActionIcon+ set;重建其他元件前把腳本裡的 `draft('Draft/ActionIcon+')` 改為 `comp('Draft/ActionIcon')`(兩者變體名相同)。
3. 底座 Library 依 `docs/deployment.md` 的 Release 步驟發布(Library 版本與 Git tag 互相指向)。
4. **底座既有元件與畫面的修改**(scratch-lot 不能改底座元件,所以留到這一步在底座檔直接改):
   - `Draft/AdminAppBar`(2001:1248)加 BOOLEAN `Notifications`,右側放 `Draft/NotificationBell` 實例(使用者已同意)。重建後,參考畫面上以絕對定位疊加的鈴(圖層名 `notification-bell(待 AppBar 加槽)`)改用這個屬性並刪除疊加層;旁邊的說明卡「說明 / 通知鈴暫時疊加」(scratch-lot 59:1524、59:1528)一併刪除。
   - `Draft/AdminSideNav`(2001:1214)系統管理群組加「通知設定」「印表機管理」兩列(先用備用槽 spare-1~4;不夠再新增)。
   - `Draft/AdminSideNav` 的**頂層備用槽加到 8 個**(現在只有 2 個,放不下專案的 8 個頂層模組);加完後 scratch-lot 的 `Draft/ScratchLotSideNav` 改用底座側欄實例。
   - 底座參考畫面「Screen / Admin 資料範圍」的兩張舊規則卡換成 `Draft/DataScopeRuleCard` 實例(scratch-lot 7:10 已先換,實例 59:1847 / 59:2033),旁邊的註記卡「合成規則與資料影響」依新卡內容改寫。
5. 在 scratch-lot Screens 接受 Library 更新,把畫面上本地草稿元件的實例用 `swapComponent` 換成 Library 同名元件(屬性名相同,覆寫會保留),最後刪除「Base Draft / 本輪底座元件」頁的本地草稿。

## 驗收稽核 `audit.js`

在 scratch-lot Screens 逐頁執行(一次一頁,把 `PAGE_ID` 換成要查的頁,所有頁平行各跑一次再加總)。

| 指標                          | 意義                                                                        | 回收完成時     |
| ----------------------------- | --------------------------------------------------------------------------- | -------------- |
| `baseDraftComponents`         | 本地的底座草稿元件(description 含「本輪草稿」)                              | 0              |
| `instancesOfBaseDrafts`       | 指向本地底座草稿的實例                                                      | 0              |
| `nodesWithDraftMarker`        | description 含「本輪草稿」的元件節點                                        | 0              |
| `nonBaseBindingsInBaseDrafts` | 底座草稿裡綁到非 wowgo-base 變數的節點                                      | 任何時候都是 0 |
| `basePrimaryBindings`         | Base Draft 以外的頁綁到 wowgo-base primary/* 的 fill / stroke(要補綁專案色) | 任何時候都是 0 |

基準值(2026-10-13):Base Draft 頁 17 / 108 / 17 / 0;Screen / Admin 資料範圍頁 0 / 4 / 0 / —。專案元件(description 開頭「【專案・scratch-lot 專屬】」)不計入,也不回收。

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

## 專案畫面(scratch-lot 專屬)

- 放在 scratch-lot Screens 的 `Project Draft / 刮刮樂元件`(64:14)與 `Screen / 店面管理`、`Screen / 叫貨與進貨`、`Screen / 班表管理`。節點見 `nodes.md`「scratch-lot 專案畫面」。
- 腳本在 `project/`:執行時依序貼上 `project/_header.js`、`project/_screen-helpers.js`,再貼 `components.js` / `store.js` / `store-wizards.js` / `purchasing.js` / `schedule.js`。專案腳本只有 scratch 模式,不會在底座執行。
- 專案元件 description 開頭固定「【專案・scratch-lot 專屬,不回收底座】」,`audit.js` 不把它們算進底座草稿。
- 專案畫面使用的底座草稿實例:基準值(2026-10-13)Screen / 店面管理 32、Screen / 叫貨與進貨 9、Screen / 班表管理 75、Project Draft 0。底座 Library 發布後,這些都要跟著用 `swapComponent` 換成 Library 元件。
