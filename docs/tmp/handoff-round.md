# 本輪(底座 + 刮刮樂)交接文件

給接手的人 / session / agent:先讀這份,再依需要讀規格。進行中的分工與進度以 GitHub issue 與本檔「目前進度」為準。

## 1. 文件與資源在哪裡

| 東西                        | 位置                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 專案規格(刮刮樂 + 排班出勤) | `docs/tmp/spec-project-lottery.md`(第 16 章畫面清單、16.10 入口 → 畫面)                                                     |
| 底座機制(已完成)            | 正式文件:`docs/concepts/`、`docs/modules/`、`docs/standards/`;Figma 規範 FIGMA-11~17;尚未實作的 S2 三項見專案規格第 18 章   |
| Figma 畫圖紀錄              | `docs/tmp/figma-base-round/README.md`(畫圖檢查清單、每次改圖的固定流程、搬回底座的方法)、`nodes.md`(各輪節點 id 與修改紀錄) |
| 班表流程走查                | `docs/tmp/figma-base-round/schedule-walkthrough.md`                                                                         |
| 畫圖腳本                    | `docs/tmp/figma-base-round/*.js`(底座)、`docs/tmp/figma-base-round/project/*.js`(專案)                                      |
| 稽核腳本                    | `audit-layout.js`、`audit-sync.js`、`audit-legend.js`、`audit.js`、`audit-roster.js`(同一資料夾)                            |
| Figma 檔                    | scratch-lot Screens `sXOJkIX53eBMUyDE8yYUJm`;品牌 Library `vR4pASiPSzHnxC1y778zAx`;底座 wowgo-base Design System(Library)   |

Figma 頁面:Base Draft 41:5914、刮刮樂元件 64:14、店面管理 65:14、叫貨與進貨 69:14、班表管理 70:14、庫存 91:14、帳戶 93:14、報表 94:14、經銷商 95:14、檔案 97:14、班表時間軸 · 各種情況(規則頁 T-01~T-18)401:805。

## 2. 實作怎麼進行(使用者 2026-10-13 定)

1. **底座先做**(已完成):底座的票都做在整合分支 `feat/base-round`,已 release 並回收成 wowgo-base v0.4.0;規則已寫進正式文件。
2. **專案後做**(已完成):整合分支 `feat/lottery-round` 做完專案規格的票(P01–P39),已 release。
3. **同步回底座**(已跑過多輪,底座到 v0.4.5;還沒回收的見本檔第 6 節):`base-sync contribute` 回收到 `C:\project\wowgo-base` → release 新底座版本 → scratch-lot、cookhome 升級(去掉重複功能)。驗收準則:子專案修的底座問題能回到底座;底座新版升級能去掉重複功能並同步成功;整套用同步工具跑完。

**一條整合分支的做法**

- 一張票一個 agent,各自 worktree,從整合分支最新的一筆往下做;完成、reviewer 審過、CI 綠後 rebase 到整合分支最新再快轉併回。**不個別開 PR、不個別進 dev。**
- **趕工時省 CI**(使用者 2026-10-29):各票在本機跑相關測試、review 後併進整合分支,整批要一起上的票都併好再 push,只跑一次 GitHub CI;不每張票各推一次。
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
- **時間軸(ScheduleTimeline)週模式排版**是純函式 `layoutTimeline`(`packages/ui/src/ScheduleTimeline/layout-timeline.ts`),規則頁每格是測試案例;同樣輸入一定同樣輸出。
- **稽核要自己用完整腳本重跑**,不貼精簡版;一次跑一個,不要同時送多個 audit;大頁面按尺寸分段跑。
- 提出問題前先查討論紀錄與規格,標明「已定 / 延伸 / 新問題」。

## 4. 稽核腳本怎麼跑

在 Figma MCP `use_figma`(先載入 figma-use skill)貼上整份腳本、改檔頭的 `PAGE_ID`;每項要是 0,例外寫在各腳本檔頭。順序:`audit-layout` → `audit-legend` → `audit-sync` → `audit-roster`(班表頁)→ `audit.js`。如果 `use_figma` 連最簡單的 `return "ok"` 都回 `truncated to 20kb`,是 Figma 外掛卡住,請使用者重新載入檔案。

## 5. 目前進度(2026-10-29)

- **scratch-lot 在底座 v0.4.5**(wowgo-base `2971cf9a`):scratch-lot main `43f3dd95`,dev / staging 已 reset 對齊 main。v0.4.5 只帶文件(協作偏好、交付與換手、deployment 等)與 `package.json` 版本,程式和 v0.4.4 相同;v0.4.4 時 production 已部署。cookhome 是否已升到 v0.4.5 要在 cookhome repo 確認。
- 專案階段的票(P01–P39)全部完成並 release;使用者已在 production 驗收最後一批(待標註調整列、庫存概況、單張金額下拉、手機帳戶篩選抽屜)。
- 本輪的共用改良已分五次回收成 wowgo-base v0.4.0–v0.4.4(base-sync contribute → 底座 release → 各專案 base-sync upgrade);v0.4.5 是文件版。
- 沒有進行中的分支、PR 或工作樹;刮刮樂本輪最後五張 issue(#139、#143–#146,P35–P39)已實作但當時沒關,2026-10-29 補關,scratch-lot 沒有開著的 issue。
- 開通租戶照 skill `scratch-lot-onboarding`(正本 `docs/modules/project/lottery-onboarding.md`);示範機構用 `demo` 指令(見同一份正本)。

## 6. 接下來可以做的

每一項的細節與現況放在待辦正本,這裡只列入口;做完就從正本刪掉。

| 類別                 | 在哪                                                                | 摘要                                                                                                                          |
| -------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 還沒回收到底座的改良 | `docs/tmp/project-dis.md`「本輪要回收到底座的項目」                 | 只在本專案的元件與機制 9 項;兩邊都沒做的底座功能與修正約 20 項(含使用者點名的列表組合欄、lookup 動態預設值)                   |
| Figma 回收與待修     | `docs/tmp/project-dis.md`「Figma 待修清單」                         | 本專案底座參考畫面 A1–A8、底座檔 B1–B11,全部未做;做法見 `docs/tmp/figma-base-round/README.md`「搬回底座的方法」               |
| 實機測試             | `docs/tmp/project-dis.md`「收據機實機測試清單」「條碼實機測試清單」 | 等收據機、條碼槍到貨                                                                                                          |
| 上線前提醒           | `docs/tmp/project-dis.md`「上線前提醒」                             | 每月最少畫休預設 4 天,上線前請使用者查法規再決定                                                                              |
| 開著的 issue         | wowgo-base 的 GitHub Issues                                         | 「structure.md 一句被中性化切斷」「Figma 品牌同步改用本機外掛」是 wowgo-base 的 issue(scratch-lot 的 #83、#66 是別的、已關閉) |
| 底座待討論(含 skill) | `docs/tmp/dis.md`                                                   | 例:自訂 `/to-figma` skill、module-scaffold 入口與設計流程整合、AI 自動 PR review 的時機                                       |
| GitHub 上的舊分支    | `git branch -r`                                                     | 約 187 條已合併的舊分支,要不要清由使用者決定                                                                                  |

換帳號、換電腦時的接手方式見 `docs/agents/collaboration.md`「交付與換手」;使用者的協作偏好正本見 `docs/agents/working-preferences.md`(兩者隨底座 v0.4.5 同步進來)。
