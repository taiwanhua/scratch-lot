# 本輪(底座 + 刮刮樂)交接文件

給接手的人 / session / agent:先讀這份,再依需要讀規格。進行中的分工與進度以 GitHub issue 與本檔「目前進度」為準。

## 1. 文件與資源在哪裡

| 東西                        | 位置                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 專案規格(刮刮樂 + 排班出勤) | `docs/tmp/spec-project-lottery.md`(第 16 章畫面清單、16.10 入口 → 畫面)                                                     |
| 底座規格(本輪底座更新)      | `docs/tmp/spec-base-round.md`(第 13 章畫面清單;10.13 Figma 規範與稽核腳本)                                                  |
| Figma 畫圖紀錄              | `docs/tmp/figma-base-round/README.md`(畫圖檢查清單、每次改圖的固定流程、搬回底座的方法)、`nodes.md`(各輪節點 id 與修改紀錄) |
| 班表流程走查                | `docs/tmp/figma-base-round/schedule-walkthrough.md`                                                                         |
| 畫圖腳本                    | `docs/tmp/figma-base-round/*.js`(底座)、`docs/tmp/figma-base-round/project/*.js`(專案)                                      |
| 稽核腳本                    | `audit-layout.js`、`audit-sync.js`、`audit-legend.js`、`audit.js`、`audit-roster.js`(同一資料夾)                            |
| Figma 檔                    | scratch-lot Screens `sXOJkIX53eBMUyDE8yYUJm`;品牌 Library `vR4pASiPSzHnxC1y778zAx`;底座 wowgo-base Design System(Library)   |

Figma 頁面:Base Draft 41:5914、刮刮樂元件 64:14、店面管理 65:14、叫貨與進貨 69:14、班表管理 70:14、庫存 91:14、帳戶 93:14、報表 94:14、經銷商 95:14、檔案 97:14、班表時間軸 · 各種情況(規則頁 T-01~T-18)401:805。

## 2. 實作怎麼進行(使用者 2026-10-13 定)

1. **底座先做**:從最新 `origin/main` 開 `feat/base-round`,底座規格的所有票都做在這條分支。
2. **專案後做**:底座 release、在 scratch-lot 測完後,從新的 main 開 `feat/lottery-round` 做專案規格的票。
3. **同步回底座**:`base-sync contribute` 回收到 `C:\project\wowgo-base` → release 新底座版本 → scratch-lot、cookhome 升級(去掉重複功能)。驗收準則:子專案修的底座問題能回到底座;底座新版升級能去掉重複功能並同步成功;整套用同步工具跑完。

**一條整合分支的做法**

- 一張票一個 agent,各自 worktree,從整合分支最新的一筆往下做;完成、reviewer 審過、CI 綠後 rebase 到整合分支最新再快轉併回。**不個別開 PR、不個別進 dev。**
- **只有彼此沒有相依、或依賴的票已併回整合分支,才能同時派多個 agent**;每批派工前列出「這批的票 + 依賴是否已併回」。
- 整合分支的票全部完成 → 一個 PR 進 dev(內文列所有 `Closes #n`)→ 手動部署 dev 給使用者測 → staging → main,一次 release。
- 其餘照 repo 規則:不直接 commit / push main;dev / staging 只用 reset 對齊 main;不把 main / dev merge 進 feat;E2E 要先問;部署手動觸發。
- 開票前先給使用者看相依關係圖;票面 = Parent / Blocked by / What to build(對照規格節)/ Acceptance criteria / 對應 Figma 節點(前端票要對照三種尺寸)。

## 3. 這幾輪定下的原則(實作與畫圖都適用)

- **一個東西一個名詞**;名詞表在專案規格第 1 章。班表:「職責」只指負責人 / 協同;人力需求是一組「執行任務」;排班「填進」執行任務。
- **三種尺寸**:每張畫面都有電腦 1440 / 平板 1024 / 手機 390;修一個尺寸,其他尺寸和背景複本同類問題一起修。
- **顏色只用共用色票**,不自創;一個顏色在一個模組只有一個意思;分類色用 `tagPalettes`(目前在 Figma 是本機 `Draft/tagPalettes`,回收時改綁 Library 並刪除本機集合)。
- **圖例和畫面標示一一對應**;圖例樣本用真實元件。
- **互動狀態照 MUI**:滑過 = 同色系 main × 8%、已選取 = × 16% + 1px main 框;Figma 用 state layer 圖層。
- **元件**:小標籤用標籤元件;共用元件設計 props 前先盤點所有使用處。
- **時間軸(ScheduleTimeline)週模式排版**是純函式 `layoutTimeline`(規格 10.11),規則頁每格是測試案例;同樣輸入一定同樣輸出。
- **稽核要自己用完整腳本重跑**,不貼精簡版;一次跑一個,不要同時送多個 audit;大頁面按尺寸分段跑。
- 提出問題前先查討論紀錄與規格,標明「已定 / 延伸 / 新問題」。

## 4. 稽核腳本怎麼跑

在 Figma MCP `use_figma`(先載入 figma-use skill)貼上整份腳本、改檔頭的 `PAGE_ID`;每項要是 0,例外寫在各腳本檔頭。順序:`audit-layout` → `audit-legend` → `audit-sync` → `audit-roster`(班表頁)→ `audit.js`。如果 `use_figma` 連最簡單的 `return "ok"` 都回 `truncated to 20kb`,是 Figma 外掛卡住,請使用者重新載入檔案。

## 5. 目前進度(2026-10-16)

- 兩份規格已定稿(總核對必修 22 / 建議 22 條全部處理);下一步規格開 PR(`feat/round-spec` → dev → staging → main)。
- 下一步:底座票相依關係圖 → 使用者確認 → 開票 → 開 `feat/base-round` 派工。
- 回收階段待辦:Draft 元件搬進 Library、`Draft/tagPalettes` 改綁 Library、Snackbar+ 取代 Snackbar、15 頁 Overlay 背景、spare-5;底座規格 10.13 的規則與腳本搬進 wowgo-base。
