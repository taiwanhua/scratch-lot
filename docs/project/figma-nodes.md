# scratch-lot 設計稿節點

本專案 Screens 的頁、Section 與專案元件節點。底座模組的參考畫面(通知設定、印表機管理、流程設計器、申請中心批次核准、表單設計器等 BS 畫面)與底座元件都在 wowgo-base Design System,節點見 [FIGMA-09](../standards/general/figma.md#figma-09-給-ai-的指路節點-id-要給元件-frame不是頁);設計檔身分見[品牌值](branding.md#設計資源)。

## scratch-lot Screens

設計檔:[scratch-lot Screens](https://www.figma.com/design/sXOJkIX53eBMUyDE8yYUJm)(`sXOJkIX53eBMUyDE8yYUJm`)。

### 頁與尺寸 Section

`Screen / Admin …` 15 頁(`0:1`、`7:2` ~ `7:15`)取自 Screens Starter,沒有尺寸 Section。專案模組頁由上到下三個尺寸 Section(FIGMA-11):

| 頁                                        | 電腦 1440   | 平板 1024   | 手機 390    | 其他                    |
| ----------------------------------------- | ----------- | ----------- | ----------- | ----------------------- |
| Screen / 店面管理(`65:14`)                | `118:7036`  | `124:5756`  | `124:6090`  | 58mm 單據 `118:7037`    |
| Screen / 叫貨與進貨(`69:14`)              | `119:2224`  | `127:26489` | `127:26787` |                         |
| Screen / 班表管理(`70:14`)                | `119:5735`  | `130:28515` | `130:28945` |                         |
| Screen / 庫存管理(`91:14`)                | `119:7134`  | `126:25997` | `126:26415` |                         |
| Screen / 帳戶管理(`93:14`)                | `119:8149`  | `162:32023` | `162:32024` |                         |
| Screen / 輸出報表(`94:14`)                | `119:8665`  | `143:36147` | `143:36148` |                         |
| Screen / 經銷商管理(`95:14`)              | `119:10138` | `131:1602`  | `131:1901`  |                         |
| Screen / 檔案管理(`97:14`)                | `119:11180` | `162:32037` | `119:11181` |                         |
| Screen / 班表時間軸 · 各種情況(`401:805`) | —           | —           | —           | 規則示範頁,不是產品畫面 |

每頁的 Section 內依操作流程分列:入口畫面後面接它打開的畫面,列左側是框外列標題「列標題 / <名稱>」,三個 Section 的列相同(沒有該尺寸畫面的列只留標題並註明照共用規則)。框名以畫面編號開頭(例:`ST-01`、`SC-03`),要找某張畫面時在 Figma 依編號搜尋;節點 id 會隨重畫改變,所以不在這裡逐張登記。

「班表時間軸 · 各種情況」頁示範週 / 日時間軸的排版規則(並排、+N、缺額、延伸、互動狀態等),對應 `apps/admin/src/lib/project/schedule-roster-views-test-support.ts` 的測試案例 T-01 ~ T-18。這頁跑 `audit-layout.js` 與 `audit-legend.js`,不列進 `audit-sync.js`。

### 專案元件

在頁 `Project Draft / 刮刮樂元件`(`64:14`)。元件說明開頭固定寫「【專案・scratch-lot 專屬,不回收底座】」,稽核不把它們算成底座草稿。

| 元件                     | 節點        | 變體 / 用途                                                                              |
| ------------------------ | ----------- | ---------------------------------------------------------------------------------------- |
| Draft/ScratchLotSideNav  | `64:15`     | 電腦側欄(專案的頂層模組)                                                                 |
| Draft/ScratchLotNavRail  | `196:7592`  | 平板收合側欄                                                                             |
| Draft/ScratchLotAppBar   | `209:407`   | `Size=Tablet / Mobile` × `Kind=Page / Back / Dialog`;手機排法用底座 AdminAppBar 的精簡版 |
| Draft/StoreTopBar        | `196:328`   | 店面管理看板頂部列,`Size=Desktop / Tablet / Mobile`                                      |
| Draft/CashPointHeader    | `64:512`    | 看板收銀點標題列,`Size` × `State=Open / Closed / Other`                                  |
| Draft/BoardBookCard      | `64:558`    | 看板卡片,`State=Normal / LowStock`                                                       |
| Draft/TicketCell         | `64:132`    | 張數格子的一格,11 種 `State`                                                             |
| Draft/TicketGrid         | `64:133`    | 張數格子                                                                                 |
| Draft/TicketGridLegend   | `174:264`   | 張數格子的共用圖例                                                                       |
| Draft/DenominationCount  | `64:366`    | 依面額清點表(交班結帳、日結)                                                             |
| Draft/LegendItem         | `289:88348` | 班表圖例項目,`Kind` × `Tone`                                                             |
| Draft/LeadTag            | `319:510`   | 負責人標籤,`Size=Small / Medium`                                                         |
| Draft/HatchBg            | `319:553`   | 畫休的斜線底                                                                             |
| Draft/UnmatchedPunchMark | `290:97643` | 未對應排班的打卡記號                                                                     |

### 稽核

`scripts/figma-audit/project/config.js` 是本專案的稽核設定,做法見 [figma-audit README](../../scripts/figma-audit/README.md)。班表另有 `scripts/figma-audit/project/audit-roster.js`:以 SC-03 電腦的班表(`290:83686`)為基準,逐格比對同月同店的所有班表(含背景複本、三種尺寸),`total` 要是 0;它和其他稽核腳本一樣整份貼進 use_figma 執行,不需要先貼設定檔。
