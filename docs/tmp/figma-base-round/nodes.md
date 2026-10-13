# 本輪底座草稿節點(scratch-lot Screens)

檔案:[scratch-lot Screens](https://www.figma.com/design/sXOJkIX53eBMUyDE8yYUJm)(`sXOJkIX53eBMUyDE8yYUJm`)。格式照 FIGMA-09;搬回 wowgo-base Design System 重建後,改登記底座檔的新節點 id,再搬進 `docs/standards/general/figma.md`。

### 底座共用元件(本輪草稿)

| 頁(頁 id)                          | 節點                     | 節點 id | 內容                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base Draft / 本輪底座元件(41:5914) | Draft/ActionIcon+        | 43:66   | 17 個 `key=<name>` 變體(expand-more 43:17、expand-less 43:20、chevron-left 43:23、chevron-right 43:26、arrow-drop-down 43:29、search 43:32、notifications 43:35、print 43:38、download 43:41、copy 43:44、link 43:47、close 43:50、check 43:53、check-circle 43:56、error-outline 43:59、account-tree 43:62、more-vert 43:65);搬回時併入 Draft/ActionIcon(2001:68) |
| Base Draft / 本輪底座元件(41:5914) | Draft/Section            | 41:5932 | State=Expanded 41:5916 / Collapsed 41:5925;TEXT Title、Summary;SLOT Content(Expanded 的內容區,78:1307);收合鈕 = Draft/IconButton + ActionIcon+ expand-less / expand-more                                                                                                                                                                                           |
| Base Draft / 本輪底座元件(41:5914) | Draft/AudiencePicker     | 45:248  | AllowEveryone=True, Value=Everyone 45:18 / AllowEveryone=True, Value=Conditions 45:29 / AllowEveryone=False, Value=Conditions 45:142;條件樹(根群組 bg/default、巢狀群組 bg/paper + divider)                                                                                                                                                                        |
| Base Draft / 本輪底座元件(41:5914) | Draft/DataScopeRuleCard  | 46:156  | 上半「套用對象」(AudiencePicker 實例)、下半「條件組合」;TEXT Title                                                                                                                                                                                                                                                                                                 |
| Base Draft / 本輪底座元件(41:5914) | Draft/OrgTreeSelect      | 47:409  | State=Closed / Open × Mode=Single / Multiple(47:315 / 47:323 / 47:334 / 47:365)                                                                                                                                                                                                                                                                                    |
| Base Draft / 本輪底座元件(41:5914) | Draft/MonthCalendarCell  | 48:359  | State=Default / Today / Selected / Outside;TEXT Day、BOOLEAN Show tag、Show slot                                                                                                                                                                                                                                                                                   |
| Base Draft / 本輪底座元件(41:5914) | Draft/MonthCalendar      | 48:360  | 2026 年 10 月示範,週日開頭;工具列 上月 / 下月 / 今天                                                                                                                                                                                                                                                                                                               |
| Base Draft / 本輪底座元件(41:5914) | Draft/RosterCell         | 49:493  | State=Empty / Filled / Selected                                                                                                                                                                                                                                                                                                                                    |
| Base Draft / 本輪底座元件(41:5914) | Draft/RosterGrid         | 49:494  | 人 × 日期矩陣,凍結第一欄;表頭彙總列 summary-row 80:1325(BOOLEAN Summary)                                                                                                                                                                                                                                                                                           |
| Base Draft / 本輪底座元件(41:5914) | Draft/NotificationBell   | 50:567  | Unread=True / False                                                                                                                                                                                                                                                                                                                                                |
| Base Draft / 本輪底座元件(41:5914) | Draft/NotificationItem   | 50:582  | Read=False / True;TEXT Title、Body、Time                                                                                                                                                                                                                                                                                                                           |
| Base Draft / 本輪底座元件(41:5914) | Draft/NotificationPanel  | 50:620  | State=List / Empty                                                                                                                                                                                                                                                                                                                                                 |
| Base Draft / 本輪底座元件(41:5914) | Draft/NotificationToast  | 50:621  | TEXT Title、Body                                                                                                                                                                                                                                                                                                                                                   |
| Base Draft / 本輪底座元件(41:5914) | Draft/PrintButton        | 51:625  | State=Default / Sending / Printed / Failed / Reprint / Disabled                                                                                                                                                                                                                                                                                                    |
| Base Draft / 本輪底座元件(41:5914) | Draft/Receipt58Row       | 51:626  | TEXT Label、Value                                                                                                                                                                                                                                                                                                                                                  |
| Base Draft / 本輪底座元件(41:5914) | Draft/Receipt58Signature | 51:630  | TEXT Role                                                                                                                                                                                                                                                                                                                                                          |
| Base Draft / 本輪底座元件(41:5914) | Draft/Receipt58          | 51:633  | 58mm 示範:改由版面零件組成(第二輪),不是固定版面;沒有屬性                                                                                                                                                                                                                                                                                                           |
| Base Draft / 本輪底座元件(41:5914) | Draft/Receipt58Header    | 80:1491 | 58mm 表頭:Org、Title、No、Time、ReprintText(TEXT)、Reprint(BOOLEAN)                                                                                                                                                                                                                                                                                                |
| Base Draft / 本輪底座元件(41:5914) | Draft/Receipt58TableRow  | 80:1508 | Kind=Head / Body;Col1~Col3(TEXT),最多 3 欄                                                                                                                                                                                                                                                                                                                         |
| Base Draft / 本輪底座元件(41:5914) | Draft/Receipt58Range     | 80:1509 | 號碼區段;Text(TEXT)                                                                                                                                                                                                                                                                                                                                                |
| Base Draft / 本輪底座元件(41:5914) | Draft/Receipt58Total     | 80:1511 | 合計列;Label、Value(TEXT)                                                                                                                                                                                                                                                                                                                                          |
| Base Draft / 本輪底座元件(41:5914) | Draft/Receipt58Divider   | 80:1515 | 虛線分隔                                                                                                                                                                                                                                                                                                                                                           |
| Base Draft / 本輪底座元件(41:5914) | Draft/Receipt58QR        | 80:1517 | QR(單據在後台的連結);Caption(TEXT)                                                                                                                                                                                                                                                                                                                                 |
| Base Draft / 本輪底座元件(41:5914) | Draft/StepperStep        | 79:1325 | State=Done 79:1307 / Current 79:1313 / Todo 79:1317 / Error 79:1321;Index、Label(TEXT)。由專案 WizardStep 升格                                                                                                                                                                                                                                                     |
| Base Draft / 本輪底座元件(41:5914) | Draft/Stepper            | 79:1361 | Width=Wide 79:1326 / Narrow 79:1353                                                                                                                                                                                                                                                                                                                                |

### 底座參考畫面(本輪草稿)

| 頁(頁 id)                          | 畫面或說明                                             | 節點 id | 用途                       |
| ---------------------------------- | ------------------------------------------------------ | ------- | -------------------------- |
| Base Draft / 本輪底座元件(41:5914) | 通知設定(system.notification-settings)                 | 54:610  | 參考畫面                   |
| Base Draft / 本輪底座元件(41:5914) | Overlay / 編輯收件人                                   | 54:1002 | 參考畫面                   |
| Base Draft / 本輪底座元件(41:5914) | 印表機管理(system.printers,代理程式分頁)               | 55:1116 | 參考畫面                   |
| Base Draft / 本輪底座元件(41:5914) | Overlay / 新增代理程式(配對碼)                         | 55:1424 | 參考畫面                   |
| Base Draft / 本輪底座元件(41:5914) | 流程設計器 審核者來源(客製流程)                        | 56:1089 | 參考畫面                   |
| Base Draft / 本輪底座元件(41:5914) | 流程設計器 審核者來源(共用流程,AUDIENCE_IN_SHARED)     | 56:1496 | 參考畫面                   |
| Base Draft / 本輪底座元件(41:5914) | 說明 / 通知鈴暫時疊加(通知設定旁)                      | 59:1524 | 頁面說明;AppBar 加槽後刪除 |
| Base Draft / 本輪底座元件(41:5914) | 說明 / 通知鈴暫時疊加(印表機管理旁)                    | 59:1528 | 頁面說明;AppBar 加槽後刪除 |
| Base Draft / 本輪底座元件(41:5914) | BS-03 流程設計器 每一關:跳過、自動通過、逾時提醒、知會 | 82:1338 | 參考畫面(第二輪)           |
| Base Draft / 本輪底座元件(41:5914) | BS-04 表單模組 [+ 新增] 選單                           | 82:1829 | 參考畫面(第二輪)           |
| Base Draft / 本輪底座元件(41:5914) | BS-04 Overlay / 表單發布成功                           | 82:2077 | 參考畫面(第二輪)           |
| Base Draft / 本輪底座元件(41:5914) | BS-05 個人設定 偏好                                    | 83:1609 | 參考畫面(第二輪)           |
| Base Draft / 本輪底座元件(41:5914) | BS-06 個人設定 代理人                                  | 83:1959 | 參考畫面(第二輪)           |
| Base Draft / 本輪底座元件(41:5914) | BS-06 Overlay / 新增代理                               | 83:2226 | 參考畫面(第二輪)           |
| Base Draft / 本輪底座元件(41:5914) | BS-07 申請中心 批次核准                                | 83:2264 | 參考畫面(第二輪)           |
| Base Draft / 本輪底座元件(41:5914) | BS-07 Overlay / 批次核准結果                           | 83:2559 | 參考畫面(第二輪)           |
| Base Draft / 本輪底座元件(41:5914) | BS-11 列印按鈕各狀態、58mm 版面零件示範                | 85:2052 | 參考畫面(第二輪)           |
| Base Draft / 本輪底座元件(41:5914) | BS-12 表單設計器 版面區塊收合設定                      | 85:2158 | 參考畫面(第二輪)           |
| Base Draft / 本輪底座元件(41:5914) | BS-13 欄位管理 選項顏色                                | 85:2497 | 參考畫面(第二輪)           |
| Base Draft / 本輪底座元件(41:5914) | BS-14 側欄計數                                         | 85:2784 | 參考畫面(第二輪)           |
| Base Draft / 本輪底座元件(41:5914) | BS-15 PageTabs + 網址參數                              | 85:2921 | 參考畫面(第二輪)           |
| Base Draft / 本輪底座元件(41:5914) | BS-16 Stepper 各狀態                                   | 85:3187 | 參考畫面(第二輪)           |

### 既有參考畫面的替換(scratch-lot)

| 頁(頁 id)                     | 節點                                 | 節點 id | 內容                 |
| ----------------------------- | ------------------------------------ | ------- | -------------------- |
| Screen / Admin 資料範圍(7:10) | 規則 1(Draft/DataScopeRuleCard 實例) | 59:1847 | 取代舊規則卡 14:4064 |
| Screen / Admin 資料範圍(7:10) | 規則 2(Draft/DataScopeRuleCard 實例) | 59:2033 | 取代舊規則卡 14:4082 |

## scratch-lot 專案畫面

專案專屬,**不回收底座**;畫面上的底座草稿實例(OrgTreeSelect、PrintButton、NotificationBell、RosterGrid、MonthCalendar、Receipt58Row / Signature)在底座重建、發布後要一起換成 Library 元件(底座規格 0.3a)。腳本在 `figma/project/`。

### 專案元件

| 頁(頁 id)                         | 節點                    | 節點 id | 內容                                                                                                        |
| --------------------------------- | ----------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| Project Draft / 刮刮樂元件(64:14) | Draft/ScratchLotSideNav | 64:15   | 專案側欄(專案規格 3.1),由底座 NavItem / NavGroup 實例組成;底座 AdminSideNav 的頂層備用槽不夠放 8 個頂層模組 |
| Project Draft / 刮刮樂元件(64:14) | Draft/TicketCell        | 64:132  | 張數格子的一格:State=Available / Selected / Unavailable;TEXT No                                             |
| Project Draft / 刮刮樂元件(64:14) | Draft/TicketGrid        | 64:133  | 張數格子(7.5):每列 10 格、連號快選、區段顯示                                                                |
| Project Draft / 刮刮樂元件(64:14) | Draft/DenominationCount | 64:366  | 依面額清點表(交班 ③、日結 ③)                                                                                |
| Project Draft / 刮刮樂元件(64:14) | Draft/CashPointHeader   | 64:512  | 看板的收銀點列 State=Open / Closed                                                                          |
| Project Draft / 刮刮樂元件(64:14) | Draft/BoardBookCard     | 64:558  | 看板卡片 State=Normal / LowStock / Attention                                                                |

### 專案畫面

| 頁(頁 id)                  | 畫面                                                 | 節點 id | 規格        |
| -------------------------- | ---------------------------------------------------- | ------- | ----------- |
| Screen / 店面管理(65:14)   | 店面管理 / 看板                                      | 65:15   | 6.1、6.2    |
| Screen / 店面管理(65:14)   | [日結] 停用時的提示                                  | 65:741  | 6.10        |
| Screen / 店面管理(65:14)   | 交班結帳 ① 盤點 · ② 兌獎                             | 67:1212 | 6.9         |
| Screen / 店面管理(65:14)   | 交班結帳 ③ 抽屜                                      | 67:420  | 6.9         |
| Screen / 店面管理(65:14)   | 日結 ③ 小金庫                                        | 68:1334 | 6.10        |
| Screen / 店面管理(65:14)   | 日結 ④ 存入銀行 · ⑤ 確認                             | 68:1686 | 6.10        |
| Screen / 店面管理(65:14)   | Overlay / 存銀行                                     | 68:1736 | 6.11        |
| Screen / 店面管理(65:14)   | Overlay / 存銀行(錯誤:超過小金庫應有;本店沒有印表機) | 68:1766 | 6.11、12    |
| Screen / 店面管理(65:14)   | 58mm / 交班結帳單                                    | 68:1809 | 12          |
| Screen / 店面管理(65:14)   | 58mm / 存款單                                        | 68:1858 | 12          |
| Screen / 叫貨與進貨(69:14) | 叫貨單 新增(替換新增頁)                              | 69:15   | 8.1         |
| Screen / 叫貨與進貨(69:14) | 進貨單 點收(替換檢視頁)                              | 69:651  | 8.2、8.3、9 |
| Screen / 叫貨與進貨(69:14) | 調貨單 新增(選張)                                    | 69:1099 | 8.4、7.5    |
| Screen / 班表管理(70:14)   | 排班作業(排班表)                                     | 70:15   | 14.5        |
| Screen / 班表管理(70:14)   | 排班作業(行事曆)                                     | 70:817  | 14.5、14.1  |

## 畫面清單節點(第二輪起依畫面編號登記)

編號對應專案規格第 16 章、底座規格第 13 章。同一編號有多張時用「/」分隔。

| 編號  | 頁(頁 id)                  | 節點 id           |
| ----- | -------------------------- | ----------------- |
| ST-01 | Screen / 店面管理(65:14)   | 65:15             |
| ST-02 | Screen / 店面管理(65:14)   | 87:1444           |
| ST-03 | Screen / 店面管理(65:14)   | 87:1756           |
| ST-04 | Screen / 店面管理(65:14)   | 87:1777           |
| ST-05 | Screen / 店面管理(65:14)   | 87:1850           |
| ST-06 | Screen / 店面管理(65:14)   | 87:1960           |
| ST-07 | Screen / 店面管理(65:14)   | 87:1986           |
| ST-08 | Screen / 店面管理(65:14)   | 87:2346           |
| ST-09 | Screen / 店面管理(65:14)   | 87:2404           |
| ST-10 | Screen / 店面管理(65:14)   | 87:2466           |
| ST-11 | Screen / 店面管理(65:14)   | 87:2521           |
| ST-12 | Screen / 店面管理(65:14)   | 87:2592           |
| ST-13 | Screen / 店面管理(65:14)   | 88:2189           |
| ST-14 | Screen / 店面管理(65:14)   | 88:2589           |
| ST-15 | Screen / 店面管理(65:14)   | 88:2880           |
| ST-16 | Screen / 店面管理(65:14)   | 88:2163           |
| ST-17 | Screen / 店面管理(65:14)   | 67:1212           |
| ST-18 | Screen / 店面管理(65:14)   | 67:420            |
| ST-19 | Screen / 店面管理(65:14)   | 89:2506 / 89:2802 |
| ST-20 | Screen / 店面管理(65:14)   | 65:741            |
| ST-21 | Screen / 店面管理(65:14)   | 89:3070           |
| ST-22 | Screen / 店面管理(65:14)   | 89:3378           |
| ST-23 | Screen / 店面管理(65:14)   | 89:3737           |
| ST-24 | Screen / 店面管理(65:14)   | 68:1334           |
| ST-25 | Screen / 店面管理(65:14)   | 68:1686           |
| ST-26 | Screen / 店面管理(65:14)   | 68:1736 / 68:1766 |
| ST-27 | Screen / 店面管理(65:14)   | 90:2966           |
| ST-28 | Screen / 店面管理(65:14)   | 90:3362           |
| ST-29 | Screen / 店面管理(65:14)   | 90:3710           |
| ST-30 | Screen / 店面管理(65:14)   | 90:4034           |
| ST-31 | Screen / 店面管理(65:14)   | 90:4318 / 90:4601 |
| ST-32 | Screen / 店面管理(65:14)   | 90:5066 / 90:5355 |
| ST-33 | Screen / 店面管理(65:14)   | 90:5588           |
| IN-01 | Screen / 庫存管理(91:14)   | 91:17             |
| IN-02 | Screen / 庫存管理(91:14)   | 91:455            |
| IN-03 | Screen / 庫存管理(91:14)   | 91:475            |
| IN-04 | Screen / 庫存管理(91:14)   | 91:1047           |
| IN-05 | Screen / 庫存管理(91:14)   | 91:1109           |
| IN-06 | Screen / 庫存管理(91:14)   | 91:1375           |
| PU-01 | Screen / 叫貨與進貨(69:14) | 92:1017           |
| PU-02 | Screen / 叫貨與進貨(69:14) | 69:15             |
| PU-03 | Screen / 叫貨與進貨(69:14) | 92:1340           |
| PU-04 | Screen / 叫貨與進貨(69:14) | 92:1625           |
| PU-05 | Screen / 叫貨與進貨(69:14) | 92:1876           |
| PU-06 | Screen / 叫貨與進貨(69:14) | 69:651            |
| PU-07 | Screen / 叫貨與進貨(69:14) | 92:2265 / 92:2519 |
| PU-08 | Screen / 叫貨與進貨(69:14) | 92:2540           |
| PU-09 | Screen / 叫貨與進貨(69:14) | 69:1099           |
| PU-10 | Screen / 叫貨與進貨(69:14) | 92:2768 / 92:3020 |
| AC-01 | Screen / 帳戶管理(93:14)   | 93:17             |
| AC-02 | Screen / 帳戶管理(93:14)   | 93:400            |
| AC-03 | Screen / 帳戶管理(93:14)   | 93:693            |
| AC-04 | Screen / 帳戶管理(93:14)   | 93:834            |
| AC-05 | Screen / 帳戶管理(93:14)   | 93:1143           |
| AC-06 | Screen / 帳戶管理(93:14)   | 93:1417           |
| AC-07 | Screen / 帳戶管理(93:14)   | 93:1664           |
| RE-01 | Screen / 輸出報表(94:14)   | 94:17             |
| RE-02 | Screen / 輸出報表(94:14)   | 94:411            |
| DE-01 | Screen / 經銷商管理        | 95:17             |
| DE-02 | Screen / 經銷商管理        | 95:418            |
| DE-03 | Screen / 經銷商管理        | 95:653            |
| DE-04 | Screen / 經銷商管理        | 95:1064           |
| DE-05 | Screen / 經銷商管理        | 96:948            |
| DE-06 | Screen / 經銷商管理        | 96:1240           |
| DE-07 | Screen / 經銷商管理        | 96:1315           |
| DE-08 | Screen / 經銷商管理        | 96:1586           |
| MD-01 | Screen / 檔案管理          | 97:17             |
| MD-02 | Screen / 檔案管理          | 97:456            |
| MD-03 | Screen / 檔案管理          | 97:822            |
| MD-04 | Screen / 檔案管理          | 97:1054           |
| MD-05 | Screen / 檔案管理          | 97:1120 / 97:1367 |
| SC-01 | Screen / 班表管理(70:14)   | 99:1016           |
| SC-02 | Screen / 班表管理(70:14)   | 99:1070           |
| SC-03 | Screen / 班表管理(70:14)   | 70:15             |
| SC-04 | Screen / 班表管理(70:14)   | 99:1600           |
| SC-05 | Screen / 班表管理(70:14)   | 99:1697           |
| SC-06 | Screen / 班表管理(70:14)   | 99:1762           |
| SC-07 | Screen / 班表管理(70:14)   | 70:817            |
| SC-08 | Screen / 班表管理(70:14)   | 102:1621          |
| SC-09 | Screen / 班表管理(70:14)   | 102:1948          |
| SC-10 | Screen / 班表管理(70:14)   | 102:2258          |
| SC-11 | Screen / 班表管理(70:14)   | 102:2552          |
| SC-12 | Screen / 班表管理(70:14)   | 102:2852          |
| SC-13 | Screen / 班表管理(70:14)   | 102:3124          |
| SC-14 | Screen / 班表管理(70:14)   | 102:3343          |
| RC-01 | Screen / 店面管理(65:14)   | 102:23305         |
| RC-02 | Screen / 店面管理(65:14)   | 102:23345         |
| RC-03 | Screen / 店面管理(65:14)   | 68:1858           |
| RC-04 | Screen / 店面管理(65:14)   | 68:1809           |
| RC-05 | Screen / 店面管理(65:14)   | 102:23385         |
| RC-06 | Screen / 店面管理(65:14)   | 102:23446         |
| RC-07 | Screen / 店面管理(65:14)   | 102:23493         |
| RC-08 | Screen / 店面管理(65:14)   | 102:23526         |
| RC-09 | Screen / 店面管理(65:14)   | 102:23571         |

## 第三輪:三種尺寸(2026-10-14 起)

每個模組頁由上到下三個 Section「電腦 1440」「平板 1024」「手機 390」(店面管理另有「58mm 單據」)。下表只列第三輪新增或重畫的節點;其餘電腦版沿用上表。

| 編號  | 電腦      | 平板      | 手機      |
| ----- | --------- | --------- | --------- |
| ST-01 | 65:15(改) | 124:5578  | 124:5927  |
| ST-02 |           | 124:5757  | 124:6091  |
| ST-03 |           | 124:23621 | 124:23979 |
| ST-04 |           | 124:23642 | 124:23998 |
| ST-05 | 123:5106  | 124:23673 | 124:24027 |
| ST-06 |           | 124:23701 | 124:24052 |
| ST-07 |           | 124:23723 | 124:24072 |
| ST-08 |           | 124:23951 | 124:24300 |
| ST-09 | 123:5225  | 124:24322 | 124:24739 |
| ST-10 |           | 124:24565 | 124:24983 |
| ST-11 |           | 124:24593 | 124:25009 |
| ST-12 |           | 124:24639 | 124:25053 |
| ST-13 | 122:5022  | 124:25145 | 124:25604 |
| ST-14 | 122:23010 | 124:25476 | 124:25905 |
| ST-15 | 122:23358 | 124:25575 | 124:25991 |
| ST-16 |           | 124:24670 | 124:25082 |
| ST-17 |           | 124:26018 | 124:26423 |
| ST-18 |           | 124:26096 | 124:26467 |
| ST-19 |           | 124:26281 | 124:26614 |
| ST-20 |           | 124:26374 | 124:26667 |
| ST-21 |           | 124:26702 | 124:27249 |
| ST-22 |           | 124:26816 | 124:27324 |
| ST-23 |           | 124:26900 | 124:27369 |
| ST-24 |           | 124:26973 | 124:27401 |
| ST-25 |           | 124:27162 | 124:27547 |
| ST-26 |           | 124:24695 | 124:25105 |
| ST-34 | 123:23114 | 124:5824  | 124:6146  |
| ST-35 | 123:23204 | 124:5862  | 124:6180  |

元件異動:`Draft/OrgTreeSelect`(47:409)改浮動標籤、高 56;`Draft/CashPointHeader`(64:512)Open 加 [最近售出],新增 `State=Other`(121:249,其他收銀點只顯示狀態)與 BOOLEAN `Mine`(自己開的班顯示 [切換到這個收銀點]);`Draft/BoardBookCard`(64:558)拿掉「號碼不明」;`Draft/TicketGrid`(64:133)張號改 001~100。
| IN-01 | 91:17(加分店選擇器) | | |
| IN-02 | | 126:25973 | 126:26395 |
| IN-03 | 125:1159 / 125:1699 | 126:25998 | 126:26416 |
| IN-04 | 125:2089 | 126:26287 | 126:26692 |
| IN-06 | | 126:26315 | 126:26716 |
