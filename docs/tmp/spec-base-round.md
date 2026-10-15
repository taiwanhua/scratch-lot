# 底座規格(這一輪的底座更新)

> 狀態:已定稿,依 Figma 畫面回頭修訂中。專案規格見 `docs/tmp/spec-project-lottery.md`,Figma 工作檔見 `docs/tmp/figma-base-round/`。
> 適用:wowgo-base 底座。**實作在刮刮樂專案 repo `C:\project\scratch-lot`**(底座 v0.3.3;現況核對以同版底座為準),完成後回收到 wowgo-base。專案的用法(刮刮樂、排班與出勤)只在例子裡帶過,完整內容見《專案規格》。
> 原則:設計前已依 STRUCT-13 核對現況;優先延伸既有機制;一個東西只有一個名詞。

---

## 0. 範圍與交付

### 0.1 這一輪要做的底座項目

| 編號                  | 項目                                                                                                                                                    | 章節  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| B13                   | 引入 Mongo 交易(B1 的前置)                                                                                                                              | 2     |
| 人員條件              | 資料範圍「套用對象」升級為條件樹;資料範圍、審核者、知會、逾時通知、通知設定共用                                                                         | 3.0   |
| B1                    | 表單生命週期掛接點(守門 + 事後動作)                                                                                                                     | 3.1   |
| B2a / B2b / B2c / B2d | 專案登記 lookup 來源、明細子欄引用、列內帶入、連動篩選                                                                                                  | 3.2   |
| B3                    | 審核者來源改用人員條件                                                                                                                                  | 3.3   |
| B4                    | 每一關指定組織跳過                                                                                                                                      | 3.4   |
| B5(含擴充)            | 申請人是審核者時自動通過、重複的審核者自動通過                                                                                                          | 3.5   |
| B9a / B9b + B12       | 表單模組宣告頁內權限、依表單分開新增權限、過濾其他租戶的動態權限                                                                                        | 3.6   |
| B15                   | 代理人                                                                                                                                                  | 3.7   |
| B16                   | 逾時提醒                                                                                                                                                | 3.8   |
| B17                   | 知會                                                                                                                                                    | 3.9   |
| B18                   | 批次核准                                                                                                                                                | 3.10  |
| B6                    | 即時通道                                                                                                                                                | 4     |
| B7                    | 通知                                                                                                                                                    | 5     |
| B8                    | 列印                                                                                                                                                    | 6     |
| B10                   | 全域掃描監聽                                                                                                                                            | 7     |
| B11                   | 報表登記                                                                                                                                                | 8     |
| B14                   | 排程任務                                                                                                                                                | 9     |
| 第 19~29 項           | UI 元件與設定(PageTabs、OrgTreeSelect、Section、側欄計數、MonthCalendar、RosterGrid、個人偏好、標籤色票、Stepper、表單「允許存草稿」、ScheduleTimeline) | 10    |
| 第 31 項              | Figma 規範與稽核腳本(三尺寸、版面、顏色、圖例、元件、資料一致)                                                                                          | 10.13 |

### 0.2 交付方式

- **底座與專案都在 scratch-lot 實作**:底座的改動放共用路徑、專案的放 project 路徑(STRUCT-12),不混在同一個 commit。
- 這一輪**所有**底座更新(含既有程式碼改用交易)一次完成 → 依 `docs/deployment.md`「底座首次接軌與版本升級」用 `base-sync contribute` 把共用改良回收到 wowgo-base → 底座審查、發布新版本 → 其他引用專案(如 CookHome)依同一份文件升級。
- scratch-lot 目前沒有任何正式環境有真實資料:**這一輪 dev / staging / production 全部清空重建**,不寫資料 migration。
- Git 流程照 CLAUDE.md:feat 分支從 `main` 切 → PR → `dev` → `staging` → `main`;不直接 commit `main`。

### 0.3a 三個階段與「底座是否已包含」的檢查

> **準則(本輪驗收標準)**:子專案要能修復底座問題並同步回底座;底座發布新版本後,子專案更新版本時要能去除與底座重複的功能,並成功同步。整套流程要能用同步工具跑完,不靠人工補。

**哪些改底座、哪些改專案**(依 `scripts/base-sync/classify.mjs` 的路徑分類):

| 分類                   | 本輪內容                                                                                                                                                                                                                       | 誰改                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| 底座路徑(common)       | admin 分層調整、B13(含既有程式碼)、B1~~B5、B9、B12、B15~~B18、人員條件與資料範圍、B6、B7、B8、B14、第 19~27 項、第 29 項、`user_preferences`、`@repo/ui` 新元件、同步工具改良                                                  | 底座階段                               |
| 專案路徑(project)      | 專案規格全部;S2 三案例先放這裡                                                                                                                                                                                                 | 專案階段                               |
| 混合路徑(mixed)        | `package.json` / lockfile(新依賴)、i18n 語系檔、`docs/`、`.github` workflow(CI replica set、print-agent 發布、realtime 部署)、組裝入口(`module-pages.tsx`、`app.module.ts`、`database.module.ts`、seed registry)、`CONTEXT.md` | 底座段落在底座階段、專案段落在專案階段 |
| 專案值                 | `deploy/env/*`、Cloudflare 帳號、bucket 名、`rt.<網域>` 品牌登記、Figma 品牌、租戶開通資料                                                                                                                                     | 專案                                   |
| 未知(unknown,要補規則) | `apps/realtime`、`apps/print-agent`、`CONTEXT-PROJECT.md`、`docs/tmp/project-dis.md`                                                                                                                                           | 見缺口 2                               |

**同步工具的三個缺口(底座階段前段完成,排在 admin 分層調整之後)**:

1. **回收遇到混合路徑一律拒絕**:現況 `contribute` 只要含 mixed / unknown 就停。改為:agent 準備的回收 commit 中,混合檔**只含底座段落**,執行時以參數明列這些檔案,工具接受並把它們的差異列進報告供審查;未列出的 mixed 仍拒絕。另把 `docs/` 裡的專案值盡量移到專案自己的檔案(同 dis.md、CONTEXT.md 的拆法),讓多數文件成為純底座。升級(向下)沿用三方 merge,不變。
2. **新 app 沒有分類**:`apps/realtime`、`apps/print-agent` 加入 common;`CONTEXT-PROJECT.md`、`docs/tmp/project-dis.md` 加入 project;補 `classify` 測試。
3. **去除重複靠人工**:新增 `base-sync verify --project <路徑> --tag <新版本>`,升級後自動產出報告:共用路徑與新底座仍不同的檔案、所有客製替換登記(頁面、help、表單 options)、**同一個 key 同時出現在底座 seed 與專案 seed**、專案路徑內與底座同名或同出口的檔案。報告乾淨才算「已去除重複」;下表的人工檢查改由它產生,人只判讀例外。

4. **底座階段**:從最新 `main` 開一條整合分支,依相依順序開多張票、多個 agent 各在自己的 worktree 做,完成後 rebase 併回整合分支 → PR → dev → staging → main,release scratch-lot、測試。
5. **專案階段**:測試通過後,從最新 `main` 再開一條分支做專案規格,同樣方式 → release、測試。
6. **回收與升級**:`base-sync contribute` 回收到 `C:\project\wowgo-base` → 底座審查、發布新版本(Figma Library 同時發布)→ scratch-lot、CookHome 依 `docs/deployment.md` 升級。整個同步與回饋流程在這一輪實測一次。

**規格與 Figma 工作檔一律放 repo(同步流程的一部分)**:

- 規格定稿後就搬進實作的 repo,不留在 repo 外面:規格放 `docs/tmp/spec-<主題>.md`,Figma 重建腳本、稽核腳本與節點表放 `docs/tmp/figma-<主題>/`。
- 做法:從最新 `origin/main` 開 `feat/<主題>-spec` 分支 → commit → **push 分支備份**(換電腦也拿得到)→ 依畫面修規格都在這條分支更新 → 定稿後 PR 走 dev → staging → main;實作的整合分支從合併後的 main 開出。
- 本輪:底座規格 = `docs/tmp/spec-base-round.md`、專案規格 = `docs/tmp/spec-project-lottery.md`、Figma 工作檔 = `docs/tmp/figma-base-round/`(分支 `feat/round-spec`)。
- 退場:規格與工作檔隨 0.4 一起從 `docs/tmp/` 移除;節點表搬進 FIGMA-09、做法寫進正式文件。
- 實作時把這段寫進同步流程的正本(`docs/deployment.md`「底座首次接軌與版本升級」的回收段落與 `docs/agents/toolbox.md` 速查),之後每一輪都照做。

**兩種情境都要實測**:

| 情境                                   | 流程                                                                                                                                                                        | 這一輪的項目                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **S1 一開始就知道是底座功能**          | 底座階段直接寫在底座位置(`apps/*/src` 非 `project/`、`packages/`、`scripts/`)→ 回收 → 升級                                                                                  | 除下列 S2 三項外的所有底座項目 |
| **S2 先做成專案客製,後來才升格成底座** | 專案階段寫在 `project/` 路徑或用客製替換 → 回收前在 scratch-lot 開「升格」分支:搬到底座位置、拆掉專案登記 / 客製替換 → 與其他底座功能一起回收 → 升級 → 確認專案那份已刪乾淨 | 見下表                         |

S2 測試案例(這三項從底座階段移到**專案階段**實作):

| 案例                                              | 專案階段的做法                                                                                    | 升格時要處理                                                                                                                                                                                                                                              | 測的是什麼                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| B10 全域掃描監聽 `useScanner`                     | `hooks/project/` + 專案登記預設處理(快速銷售)                                                     | 搬到 `hooks/base/`、預設處理改成底座登記機制、刮刮樂改用登記                                                                                                                                                                                              | 「專案新增」升格(搬檔、改 import)                                         |
| 欄位選項顏色(`tagPalettes`,第 26 項)              | 客製替換底座的欄位管理頁(`page-replacements`)+ 專案端的色票                                       | 底座欄位管理頁改版、`tagPalettes` 進 `@repo/ui`、拆掉替換登記、help 的 `project/replacements/` 一併移除                                                                                                                                                   | 「客製替換」升格(兩份頁面不可並存)                                        |
| B11 報表登記(含「輸出報表」頁、期間選擇器、Excel) | api `src/project/`、admin `pages/project/`、專案 seed 模組與權限、專案 i18n 與 help、Figma 專案頁 | 程式搬到底座位置;**模組 / 權限 seed 從專案移到底座**(已發布的 seed 快照只能新增,不能改寫或刪除:要用新增的底座 seed 接手同一組 key,專案 seed 以新增版本退場,並驗證已部署環境的資料不重複、不遺失);i18n 與 help 從專案區搬到底座區;Figma 頁面依底座流程重建 | 跨 api / admin / seed / i18n / help / Figma 的完整升格,含 seed 所有權轉移 |

**Storybook 與元件歸屬**:

- `@repo/ui` 只放底座的底層元件,每個都要有 stories;Storybook 只收 `@repo/ui` 與工具頁。
- 專案元件放 admin 的 `components/project/`,用元件測試驗證,不進 Storybook;日後發現可共用 → 搬進 `@repo/ui`、補 stories、走回收。
- 加檢查:專案程式不能放進 `packages/ui`(同步工具會把它當共用改良)。
- 本輪歸屬:Section、MonthCalendar、RosterGrid、Stepper、58mm 單據版面零件 → `@repo/ui`(有 stories);AudiencePicker、OrgTreeSelect、列印按鈕、通知鈴 / 清單 → admin `components/base/`;張數格子、面額清點、看板卡片 → admin `components/project/`。
- 實作時寫進 `docs/standards/general/structure.md` 與 `docs/concepts/frontend-architecture.md`。

**admin 各層改成 `base/` + `project/`(底座階段第一張票)**:現況只有 `pages/` 分了 `base/` 與 `project/`;`components/` 只有 `base/crud/`,其餘底座元件散在根目錄,`hooks/`、`stores/`、`lib/` 都沒分。改成 components、hooks、stores、lib 都是 `base/` + `project/`(約 220 個檔案搬移、約 290 個檔案改 import,用工具機械式處理),同步改 lint 的所有權規則(STRUCT-03)、`frontend-architecture.md`「admin 的分層」與 module-scaffold。這張票最先做、單獨先併回整合分支,其他票才不會撞路徑。

**怎麼確認專案的改動已被新底座包含**(升級後執行,結果寫進升級 PR):

| 對象                                                          | 檢查                                                                                                                             | 通過條件                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 程式(共用路徑)                                                | 升級完成後 `node scripts/base-sync/run.mjs inspect --project <scratch-lot> --from <新底座 tag 的 commit> --to HEAD`              | 只剩 `project`(與經審查的 `mixed` 專案段落)差異;任何 `common` 差異 = 沒回收到或漂移,逐一說明 |
| 混合路徑(`docs/`、`package.json`、語系檔、組裝入口、workflow) | 同上報告的 `mixed` 清單逐段核對                                                                                                  | 底座段落與新底座一致;剩下的只有專案段落                                                      |
| 專案客製替換                                                  | 列出 `app/project/page-replacements.ts`、help `project/replacements/`、表單 options 等登記                                       | 每一筆都是真正的專案客製;本輪不應新增任何「暫代底座功能」的替換                              |
| S2 升格項目                                                   | 搜尋 `project/` 路徑、`page-replacements`、help `project/replacements/`、專案 seed 是否還有 useScanner / 欄位選項顏色 / 報表登記 | 全部只剩底座那一份;專案 seed 的退場版本已發布;已部署環境的模組與權限資料不重複、不遺失       |
| Figma                                                         | 在 scratch-lot Screens 跑稽核腳本:本地 `Draft/` 草稿元件數、指向本地草稿的實例數、description 含「本輪草稿」的節點數             | 三者皆為 0;所有實例指向 wowgo-base Library 已發布的元件                                      |
| 測試                                                          | scratch-lot 全套 CI + 底座 CI                                                                                                    | 皆綠                                                                                         |

1. **dis.md 拆成兩份**:`docs/` 在底座同步工具裡屬於「混合」路徑,底座與專案的待辦混在同一檔,升級和回收時都要逐段拆。
   - `docs/tmp/dis.md`:只放**底座**的討論與待辦,隨底座版本同步到各專案。
   - `docs/tmp/project-dis.md`:只放**專案自己**的討論與待辦;底座不帶內容,新專案初始化時建立空檔。
   - `scripts/base-sync/classify.mjs` 把 `docs/tmp/project-dis.md` 歸為 `project`(加測試),回收時不會被當成共用候選。
   - 同步改所有指向 dis.md 的地方:`CLAUDE.md`、`docs/agents/domain.md`、`docs/agents/issue-tracker.md`(「指路要能 grep 到」)、`docs/agents/project-bootstrap.md`、`docs/deployment.md`(「Atlas」那句改指專案檔)。
2. **整理既有 dis.md**:逐條核對現況,已解決的刪掉;剩下的依底座 / 專案分到兩份檔。
3. **搬第 11 章**:A 類進底座 dis.md,B 類寫進對應正本。專案規格的「未來考慮」進專案的 `project-dis.md`(見專案規格第 15 章)。
4. **CONTEXT.md 拆成兩份**(同 dis.md 的理由):
   - `CONTEXT.md`:底座名詞,開頭改成底座的通用說明(不再寫專案介紹,例如 scratch-lot 現在的「ScratchLot 刮刮樂智慧管理系統」),隨底座版本同步。
   - `CONTEXT-PROJECT.md`:專案自己的名詞;**只能新增,不能重新定義底座名詞**;底座不帶內容,新專案初始化時建立空檔。
   - `classify.mjs` 把 `CONTEXT-PROJECT.md` 歸為 `project`(加測試);同步改 `docs/agents/domain.md`(兩份詞彙表、`/domain-modeling` 把專案名詞寫進專案檔)、`CLAUDE.md`、`docs/agents/project-bootstrap.md`。
5. **更新所有引用 dis.md / CONTEXT.md 的地方**:實作時以 `grep -rn "CONTEXT\.md\|dis\.md"`(排除 `node_modules`、`dist`)重新盤點,逐處分三類:
   - **說明「詞彙表 / 待辦在哪裡」的** → 改成兩份並寫清楚分工。依 scratch-lot 現況盤點:`CLAUDE.md`、`AGENTS.md`、`README.md`、`docs/README.md`、`docs/agents/domain.md`、`docs/agents/issue-tracker.md`、`docs/agents/project-bootstrap.md`、`docs/agents/module-scaffold.md`、`docs/agents/toolbox.md`、`.claude/skills/module-scaffold/SKILL.md` 與 `references/pointers.md`、`docs/standards/general/figma.md`(FIGMA-04「文案守詞彙表」要守兩份)、`docs/standards/general/structure.md`、`docs/branding.md`。
   - **指向某個底座名詞或底座待辦的**(程式註解、ADR-0002 / ADR-0005 指向 dis.md 的條目、概念文件、權限劇本等)→ 路徑不變,確認該名詞 / 條目仍在底座檔。
   - **指向專案名詞或專案待辦的** → 改指 `CONTEXT-PROJECT.md` / `docs/tmp/project-dis.md`。
6. **規格退場**:本文件與專案規格完成後從 `docs/tmp/` 移除(歷史查 git);現況寫在各正本(見 0.3)。

**回收到 wowgo-base 之後的待辦(本輪產生的)**

- **現有 Overlay 畫面的背景**:本輪回收到 wowgo-base 後,在 wowgo-base 依新規則(畫圖檢查清單 14:對話框背景是打開它的頁面)把現有所有 Overlay 畫面(`Screen / Admin …` 各頁的 `Overlay / …`)的背景改成打開它的頁面,release 新版後再同步回各專案。本輪 scratch-lot 的 15 頁參考畫面不改。
- **側欄第 5 個備用槽**:Draft/AdminSideNav 的系統管理群組加 spare-5(放「印表機管理」),scratch-lot 的過渡草稿 Draft/AdminSideNav+ 換回 Draft/AdminSideNav(README 步驟 4)。

### 0.3 要同步更新的文件

| 文件                                                            | 改什麼                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新 ADR「引入 Mongo 交易」                                       | 決策、範圍、例外(樂觀鎖、db-migrator 大批次)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ADR-0001                                                        | 關聯類型命名規則補「專案關聯表也適用;同一對多種關係時意思寫在 meta」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ADR-0007、ADR-0009、ADR-0002                                    | 拿掉「Mongo 單節點沒有 transaction」的前提;補償刪除改交易                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/concepts/data-layer-and-isolation.md`                     | 交易、session 傳遞、交易內不得有外部動作                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `docs/concepts/workflow-engine.md`、`docs/modules/workflows.md` | B1、B3、B4、B5、B15~B18;送出的分步接續改交易                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `docs/concepts/form-engine.md`、`docs/modules/forms.md`         | B1、B2、B9;lookup 登錄表開放;明細子欄引用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/concepts/authorization.md`                                | B9a、B9b、B12、表單動態權限                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ADR-0008、`docs/modules/data-scope.md`                          | 套用對象改為人員條件(格式、錯誤碼、畫面)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Figma「Screen / 資料範圍」                                      | 規則卡片改為「套用對象 + 條件組合」上下兩塊                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/standards/general/figma.md`                               | 新增畫圖檢查清單規則(對齊、不裁切、撐滿、多尺寸、示範資料、顏色綁定、三尺寸共用區塊用同一個元件實例、只有一兩句話的確認視窗在手機也是置中小視窗),**畫之前先找現有畫面 / 元件並截圖對照,以現有為底只畫差異(底座參考畫面先複製現有 `Screen / Admin …` 畫面再套改動;專案頁的外殼、列表、表單也要和底座現有樣式一致)**,正本取自 `docs/tmp/figma-base-round/README.md`;連同「每次改圖的固定流程」(改之前列影響範圍;改之後全部頁面重跑自動檢查、人工核對、逐張截圖、回報原始數字)與自動檢查(audit 的對齊與裁切、外溢、底座主色、畫面內開發文字、重疊,`audit-sync.js` 的三尺寸按鈕一致與共用區塊非元件數)一起搬進 figma.md;**完整條文與稽核腳本見 10.13** |
| `docs/concepts/frontend-architecture.md`                        | PageTabs、useUrlState(含既有頁面改用的盤點)、側欄計數登記制、全域掃描監聽                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/branding.md`                                              | 網域 `rt.*` / `rt-dev.*` / `rt-staging.*`、新的 storage key、`tagPalettes` 色票                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `docs/env-registry.md`                                          | 發布密鑰、訂閱憑證簽章密鑰、Cloudflare 部署 token、Cloud Scheduler 呼叫身分                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/deployment.md`                                            | wrangler 部署步驟、Cloud Scheduler;print-agent 發布流程(`print-agent-release.yml` 手動觸發、上傳 bucket 路徑、`manifest.json`、發布順序、runner 費用)、deploy SA 對 `print-agent/` 的寫入權限                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/data-model.md`                                            | 新資料表                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/print-agent/README.md`(新)                                | 開發(模擬模式、假 9100 伺服器)、四平台打包、安裝說明(含共用收銀電腦、關閉睡眠、macOS 隔離標記)、固定 IP 設定步驟(收據機到貨後)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `docs/modules/printers.md`(新)                                  | 印表機管理頁、配對、下載區、權限                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `docs/agents/toolbox.md`                                        | print-agent 發布指令速查                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 規範 I18N-05                                                    | 語言改成跟著帳號走(見 10.7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/standards/`                                               | 交易用法、Durable Object 休眠 API 必用、即時信號不帶資料                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

---

## 1. 名詞表

本表**全部是底座名詞**(這一輪新增或改義的),實作時寫進底座的 `CONTEXT.md`(「套用對象」改寫既有定義);既有名詞以 `CONTEXT.md` 為準,不重複列。專案名詞在專案規格第 1 章,寫進 `CONTEXT-PROJECT.md`,兩邊不互相重複。

| 名詞              | 意思                                                             | 不要用的別稱         |
| ----------------- | ---------------------------------------------------------------- | -------------------- |
| 守門              | 動作執行前呼叫、只能讀、可以擋下                                 | 前置 hook            |
| 事後動作          | 狀態改變後,在同一個交易內執行的寫入                              | 後置 hook            |
| 關卡通過          | 某一關依 any / all 規則整關完成(含被跳過)                        | 每人核准             |
| 頁籤              | 殼層上方「開過的頁面」分頁,既有 `RouteTabs`                      | —                    |
| 頁內分頁          | 頁面裡面的分頁,新元件 `PageTabs`                                 | RouteTabs            |
| 即時通道          | 整個 Cloudflare Durable Objects 服務,程式在 `apps/realtime`      | WebSocket 伺服器     |
| Cloudflare Worker | 即時通道的入口,驗證訂閱憑證、轉送                                | 閘道、大門           |
| Durable Object    | 每個租戶一個,名稱 `hub:<租戶 id>`,保存連線並推送                 | 集線器、房間         |
| 連線              | 一個瀏覽器分頁或一個代理程式與 Durable Object 之間的 WebSocket   | —                    |
| 頻道              | Durable Object 內的分類標籤,例如 `user:<id>`                     | 主題(專指外觀 theme) |
| 訂閱憑證          | API 簽發的短期通行證(預設 10 分鐘)                               | token                |
| 信號              | 即時通道上傳的訊息,只有類型與編號,不帶資料、不保存               | 推播、通知           |
| 發布              | API 把信號送進即時通道                                           | —                    |
| 通知              | 存在 `notifications` 的一封信,有標題、內容、已讀狀態             | 信號                 |
| 代理程式          | 店內電腦上執行的列印程式 `apps/print-agent`                      | agent、列印站        |
| 列印工作          | `print_jobs` 的一筆                                              | —                    |
| 動態權限          | `permissions.source = "dynamic"`,發布表單時建立                  | —                    |
| 人員條件          | 選出一群人的條件樹(使用者、角色、所屬組織、權限),格式 `Audience` | 對象條件、收件規則   |
| 套用對象          | 資料範圍規則裡「這條規則套用到誰」的欄位,值是人員條件            | —                    |
| 條件組合          | 資料範圍規則裡「看得到哪些資料」的條件樹(既有)                   | 過濾條件             |
| 當事人通知        | 收件人由事件本身決定的通知(審核者、申請人、建立者等)             | —                    |
| 負責人提醒        | 收件人由人員條件決定、租戶可在「通知設定」調整的通知             | —                    |

---

## 2. B13 引入 Mongo 交易

### 目的

目前因為「單節點沒有交易」,底座到處用「條件更新 + 冪等 + 補償 / 分步接續」來保證一致性,每個新功能都要重新設計補救方式。改成**一個使用者動作 = 一個交易**,失敗就全部回復。

### 現況核對

- 正式環境 MongoDB Atlas 本來就是 replica set,可以用交易。
- 本機測試:`mongodb-memory-server` 起單節點。
- CI:`.github/workflows/ci.yml` 的 `mongo:7` service container,單節點;GitHub service container 不能自訂啟動參數。
- 文件裡「沒有 transaction」的前提:ADR-0002、ADR-0007、ADR-0009、`docs/concepts/workflow-engine.md`、`docs/modules/workflows.md`、`docs/modules/forms.md`。

### 設計

| 項目             | 做法                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 本機             | 改用 `MongoMemoryReplSet`(單一成員 replica set 就能用交易)                                                                                             |
| CI               | 拿掉 `mongo:7` service container,改用 `MongoMemoryReplSet`,與本機同一套                                                                                |
| `BaseRepository` | 所有讀寫方法接受選填的 `session`;租戶保底、資料範圍規則照舊套用                                                                                        |
| 交易入口         | 單一 helper `withTransaction(fn)`,內部用 driver 的 `session.withTransaction`(寫入衝突自動重試)                                                         |
| 動作範圍         | 送出、存草稿、核准、駁回、退回、撤回、作廢、刪除、複製為新單、改派、新增審核者、批次核准的**每一筆**、推進(含連續推進、B5 自動通過、B4 跳過)= 一個交易 |
| 交易後           | 寄信、通知以外的外部動作(即時信號發布、列印信號、GCS 檔案複製)放在交易成功之後;失敗只記 log                                                            |

### 規則

- **交易內不得有外部副作用**(寄信、HTTP 呼叫、GCS、Cloudflare),因為自動重試會重複執行。
- `notifications` 的寫入是資料庫寫入,**放在交易內**;信號發布在交易後。
- 單一交易預設上限 60 秒;動作都應在毫秒級。
- **保留的例外**:
  - 樂觀鎖 `editVersion` / `version` 保留(防止兩人同時編輯時後存蓋掉先存,和交易是兩回事)。
  - `apps/db-migrator` 的大批次遷移:每批一個交易 + 檢查點續跑(ADR-0002)。這一輪清空重建,不需要寫 migration;機制保留給上線後。

### 既有補救機制盤點(這一輪全部改成交易)

實作前以 grep 盤點並列成票的清單,至少包括:

| 機制                                                  | 位置                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 租戶開通失敗的補償刪除                                | ADR-0009、tenant provisioning 服務                                                                       |
| 流程送出的分步接續(`linking` → `running`、三個檢查點) | `apps/api/src/workflows/workflow-engine/workflow-submit.service.ts`                                      |
| 推進的「條件不成立就中止本輪、重讀」                  | `workflow-engine.service.ts`、`instance-writes.ts`                                                       |
| 表單四步發布的中斷重試                                | `apps/api/src/forms/form-design/form-publish.service.ts`、`apps/api/src/versioning/version-lifecycle.ts` |
| 複製為新單                                            | `copySubmissionToDraft`                                                                                  |
| 舊版資料升級的逐筆條件更新                            | `form-runtime/form-upgrade.service.ts`(每批一個交易)                                                     |
| 審核者失效 hook                                       | `assignee-invalidation.service.ts`                                                                       |

> 「重試推進」「阻擋清單」仍保留:阻擋是業務狀態(找不到審核者),不是一致性補救。

### 驗收重點

- 任一步驟注入錯誤 → 整個動作的所有寫入都不存在。
- 兩人同時核准同一關 → 一個成功、一個得到明確錯誤或被接受為晚到決定(沿用既有語意)。
- CI 與本機測試都在 replica set 上跑。

---

## 3. 表單與流程引擎

### 3.0 人員條件

#### 目的

「選出一群人」在底座有五個地方:資料範圍的套用對象、流程審核者、知會對象、逾時通知對象、負責人提醒的收件人。統一成**一種格式、一個元件、一份判斷程式**。

#### 現況核對

- 資料範圍的套用對象:`audience { type: ALL | ROLE | ORG | USER, ids }`,一次只能選一種,不能組合(例:「店長且屬於 A 店」做不到;規則合成作用在「看得到哪些資料」,不是作用在「套用到誰」)(`docs/modules/data-scope.md`)。
- 資料範圍的條件組合已有條件樹:群組 `op` + `children`、條件列 `field` + `cond` + `value`,每層 AND / OR,UI 上限 3 層,空群組 `EMPTY_GROUP`(`apps/admin/src/pages/base/system/DataScopePage/RuleEditorPanel/`)。
- 流程審核者四種來源:指定使用者、角色、表單欄位、主管;共用流程不能用指定使用者與角色(`USERS_IN_SHARED`、`ROLE_IN_SHARED`)。

#### 格式

```jsonc
// 所有人(只在資料範圍出現)
{ "mode": "all" }
```

```jsonc
// 符合條件
{
  "mode": "match",
  "filter": {
    // 與條件組合同一種條件樹形狀
    "op": "AND",
    "children": [
      {
        "field": "role",
        "cond": "in",
        "value": { "kind": "static", "values": ["<角色 id>"] },
      },
      {
        "op": "OR",
        "children": [
          {
            "field": "org",
            "cond": "in",
            "value": { "kind": "static", "values": ["<組織 id>"] },
            "range": "descendants",
          },
          {
            "field": "permission",
            "cond": "in",
            "value": { "kind": "static", "values": ["accounts.close-period"] },
          },
        ],
      },
    ],
  },
}
```

- 頂層**明確二選一**:「所有人」(`all`)/「符合條件」(`match`,至少一個條件列)。不用「空白 = 所有人」。
- 「所有人」**只在資料範圍出現**;審核者、知會、逾時通知、通知設定一定要設條件。
- 群組 AND / OR 每層可切,UI 上限 3 層,空群組不允許(沿用條件組合的規則)。

| 欄位     | 值                                 | 比較方式 |
| -------- | ---------------------------------- | -------- |
| 使用者   | 使用者 id                          | 屬於     |
| 角色     | 角色 id(多選,符合任一)             | 屬於     |
| 所屬組織 | 組織 + 範圍:本身 / 含下層 / 含上層 | 屬於     |
| 權限     | 權限 key(多選,符合任一)            | 持有     |

- 非指定的組織來源用 `value.kind = "dynamic"` 表示(例 `ref: "submission-org"`、`"tenant"`、`"form-field:<欄位 key>"`、`"event-org"`),在解析當下代入。
- **只有「屬於 / 持有」,不提供「不屬於」**:列出符合的人時要能從條件反推名單,不掃全部使用者。

**組織來源依使用處**(元件只顯示該處可用的選項):

| 用在哪                     | 所屬組織可以選                                        |
| -------------------------- | ----------------------------------------------------- |
| 資料範圍的套用對象         | 指定組織                                              |
| 流程審核者、知會、逾時通知 | 指定組織 / 表單的組織欄位 / 單據所屬組織 / 租戶       |
| 通知設定(負責人提醒)       | 由通知類型宣告(例:事件的分店),租戶不能改,畫面唯讀顯示 |

- 表單的組織欄位必須是組織引用欄,否則 `FIELD_NOT_ORG_REFERENCE`(送出時、綁定時同一套檢查)。

#### 兩種用法,一份定義

| 用法             | 用在哪                       | 怎麼算                                                                                                    |
| ---------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| 判斷這個人符合嗎 | 資料範圍(查詢時判斷操作者)   | 用這次請求已算好的啟用中角色、所屬組織、有效權限,逐層 AND / OR                                            |
| 列出符合的人     | 審核者、知會、逾時通知、通知 | 每個條件列各自查出一群人,AND 取交集、OR 取聯集;權限從 `role_permission` 反推角色(含 `<模組>.*`)再找持有者 |

- 停用的權限、模組(含祖先停用)、角色都不算;只列啟用中、在本租戶的使用者。
- **權限條件只算實際授予的權限,不套用超級管理員的略過**;超級管理員要符合,就選他的角色或指定他本人。
- 權限選項依 B12 過濾,看不到其他租戶的客製表單權限;資料範圍由 root 設定,只列底座與專案的權限。
- 測試:同一組條件與使用者,「列出的人」=「逐人判斷符合的人」。

#### 共用流程

- 共用流程的人員條件**只能用權限與非指定的組織來源**(表單的組織欄位、單據所屬組織、租戶);使用者、角色、指定組織不能用。
- `USERS_IN_SHARED`、`ROLE_IN_SHARED` 合併為 `AUDIENCE_IN_SHARED`。

#### 元件 `AudiencePicker`

- 與資料範圍的條件樹共用 `ConditionGroup` / `ConditionRow`,只換欄位清單;角色選項沿用依擁有組織分組的 Autocomplete,組織沿用 `OrgTreePicker`。
- 權限條件用可搜尋的模組 / 權限樹,沿用權限矩陣的顯示樹。
- 畫面上的標題依用途命名:套用對象、審核者、知會對象、通知對象、收件人。

#### 資料範圍的變更

每一條規則卡片分上下兩塊:

```
┌ 規則 1 ─────────────────────────────────────── [刪除規則] ┐
│ 套用對象  ○ 所有人  ◉ 符合條件                             │
│  組合 [AND — 全部成立 ▼]                                   │
│   角色      屬於  [店長 ×]                          [刪除] │
│   所屬組織  屬於  [A 店 ×]  範圍 [本身 ▼]           [刪除] │
│   [+ 條件] [+ 群組]                                        │
│ ────────────────────────────────────────────────────────── │
│ 條件組合                                                   │
│  組合 [AND — 全部成立 ▼]                                   │
│   建立者    屬於  [【操作者本人】]                   [刪除] │
│   [+ 條件] [+ 群組]                                        │
└────────────────────────────────────────────────────────────┘
```

| 項目     | 套用對象(人員條件)           | 條件組合(既有,不變)                          |
| -------- | ---------------------------- | -------------------------------------------- |
| 回答     | 這條規則套用到誰             | 套用到的人看得到哪些資料                     |
| 欄位     | 使用者、角色、所屬組織、權限 | 資料目標宣告的欄位(組織、使用者、日期、選項) |
| 比較方式 | 屬於 / 持有                  | 屬於 / 不屬於 / 之間 / 之前 / 之後           |
| 動態值   | 沒有                         | 【操作者本人】【操作者的所屬組織】           |
| 層數     | 最多 3 層                    | 最多 3 層                                    |

- 選「所有人」時,套用對象的條件樹收起。
- 兩棵樹根層的下拉都叫「**組合**」;巢狀群組的下拉仍叫「群組組合」。
- 頁面其他部分不變:資料目標清單、預設提示、**規則合成**(作用在命中同一個人的多條規則之間)、新增規則、儲存。
- `AUDIENCE_INVALID` 改為檢查新格式(`mode` 不認得、`match` 沒有條件列、欄位或值不合法),`path` 指到出錯的條件列。
- 權限 key 全站一致,root 可以寫出跨租戶通用的規則(例:「有 `xxx.view-all` 的人看全部」)。
- 環境清空重建,不需要遷移;Figma「Screen / 資料範圍」同步更新。

#### 不改用人員條件的地方

- B4「指定組織發起時跳過」維持原樣:比對的是送出當下的快照,快照只有組織。

#### 驗收重點

- 「店長且屬於 A 店」只命中 A 店的店長。
- 列出與逐人判斷結果一致(含 `模組.*`、停用角色、停用權限)。
- 超級管理員不因權限條件而被列入。
- 共用流程使用角色條件 → `AUDIENCE_IN_SHARED`。

---

### 3.1 B1 生命週期掛接點

#### 目的

讓專案在表單 / 流程的各個時間點檢查與寫入自己的資料(例:進貨單點收、張數鎖定、銀行記帳)。

#### 現況核對

- 流程引擎沒有給專案用的掛接點。`WorkflowEngineHooks` 只是測試注入中斷的檢查點;`AssigneeInvalidationService` 方向相反(使用者管理呼叫引擎)。

#### 設計:兩種掛接點,都在動作的同一個交易內

**守門(8 個)**:只能讀;回傳「通過」或「擋下 + 錯誤碼 + 訊息」。

| 守門                  | 時機                                              | 帶入           |
| --------------------- | ------------------------------------------------- | -------------- |
| `beforeSubmit`        | 驗證之後、寫入之前(含退回 / 撤回後再送出)         | 這一版的欄位值 |
| `beforeApprove`       | 某人按核准、批次核准的每一筆、B5 自動通過         | 關卡 key       |
| `beforeReject`        | 按駁回                                            | 關卡 key       |
| `beforeReturn`        | 按退回                                            | 關卡 key       |
| `beforeWithdraw`      | 申請人撤回                                        | —              |
| `beforeVoid`          | 作廢                                              | —              |
| `beforeDelete`        | 刪除草稿 / 退回 / 撤回中的單,或沒走流程的已完成單 | —              |
| `beforeEditCompleted` | 修改沒走流程的已完成單                            | 新的欄位值     |

**事後動作(7 個)**:狀態改變後在同一個交易內執行;任何一個失敗 → 整個動作回復,使用者看到錯誤訊息。

| 事件         | 時機                                                                   |
| ------------ | ---------------------------------------------------------------------- |
| `submitted`  | 進入審核中,或沒走流程的單直接完成時(先觸發 `submitted` 再 `completed`) |
| `stepPassed` | 某一關**整關通過**;被跳過的關卡也觸發,帶 `skipped: true`               |
| `returned`   | 被退回                                                                 |
| `withdrawn`  | 被撤回                                                                 |
| `completed`  | 單據完成                                                               |
| `rejected`   | 被駁回                                                                 |
| `voided`     | 被作廢                                                                 |

#### 登記方式

```ts
registerFormLifecycle({
  moduleKey: "purchasing.purchase",
  formKey: "purchase", // 省略 = 這個模組的所有表單
  guards: {
    beforeSubmit,
    beforeApprove,
    beforeReject,
    beforeReturn,
    beforeWithdraw,
    beforeVoid,
    beforeDelete,
    beforeEditCompleted,
  },
  effects: {
    submitted,
    stepPassed,
    returned,
    withdrawn,
    completed,
    rejected,
    voided,
  },
});
```

- 守門收到:操作者、提交、這一版的值、關卡、動作、`session`(唯讀用)。
- 事後動作收到:事件、提交 id、修訂號、關卡、`skipped`、`session`,以及**系統身分**的操作者:可見範圍依單據的組織設定,不使用按下按鈕那個人的權限。
- 同一個 (moduleKey, formKey) 只能登記一次;重複 → 啟動時報錯。

#### 規則

- 守門擋下 → 回 `FORBIDDEN` + reason = 專案的錯誤碼(例 `PURCHASE_UNRECEIVED_ROWS`),訊息走 i18n。
- 事後動作內可以呼叫 `notify()`(寫入 notifications 在交易內);信號發布排在交易成功之後(由底座統一處理,專案只呼叫 `realtime.publishAfterCommit()`)。
- 撤回、退回雖有守門,專案不需要時不登記即可。

#### 驗收重點

- 守門擋下時沒有任何寫入。
- 事後動作拋錯時,狀態、任務、實例、專案寫入全部回復。
- 第一關被 B4 / 跳過條件跳過 → `stepPassed(skipped: true)` 觸發。
- 沒綁流程的表單送出 → `submitted`、`completed` 依序觸發。

---

### 3.2 B2 lookup 與明細子欄

#### 現況核對

- `apps/api/src/forms/lookup-providers.ts`:登錄表寫死 `user`、`org`、`form_submission`;新增來源要改 `LookupProvidersService.providerFor`。
- 明細子欄白名單:文字、數字、日期、日期時間、單選、是否(`docs/modules/forms.md`「明細列」);沒有引用。
- 篩選 `filter` 是定義裡的靜態條件。

#### B2a 專案登記 lookup 來源

| 項目            | 設計                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 機制            | NestJS multi-provider token(例 `LOOKUP_PROVIDER`);專案模組提供 `{ declaration, runtime }`,`LookupProvidersService` 啟動時收集 |
| key             | 底座來源不加前綴;**專案來源一律加專案前綴**(例 `lottery_game`);重複 → 啟動時報錯                                              |
| 範圍            | runtime 一律經 `BaseRepository` 查詢,租戶隔離與可見範圍自動套用;專案不能自行放寬                                              |
| declaration     | 可回欄位、各欄位需要的讀取權限、可當篩選的欄位、顯示欄、值欄                                                                  |
| 設計器 / 檢查器 | 自動列出專案登記的來源;檢查器的登錄表(`LookupProviderRegistry`)含專案來源                                                     |

#### B2b 明細子欄支援「引用」

| 項目        | 規則                                                                |
| ----------- | ------------------------------------------------------------------- |
| 存值        | `{ id, label }` 快照,同表單層引用欄                                 |
| 元件        | 表格格子為自動完成;手機寬為卡片                                     |
| 權限        | 繼承整個明細欄                                                      |
| 送出        | 重驗每一列引用是否仍讀得到並更新快照;**同一子欄的 id 合併一次查詢** |
| 現名 / 差異 | `displayValues` 支援 `<明細 key>.<子欄 key>`;修訂差異比 id          |
| 上限        | 每明細 ≤ 20 子欄、≤ 200 列(不變)                                    |

#### B2c 列內帶入

- 引用子欄可以設定帶入規則:選定 / 改選時把來源欄位帶入**同一列**其他子欄(例 `game.bookAmount → bookAmount`)。
- 改選會覆蓋同列目標;之後可手動修改;伺服器不強制。
- 沿用表單層「帶入規則」的設定格式、檢查器、前端執行;檢查器驗型別相符。
- 複製列、複製為新單保留值,不重新帶入。

#### B2d 連動篩選

- 篩選條件的值可以引用表單上其他欄位:`{ field: "orgId", op: "==", value: { var: "shipOrg" } }`。
- 前端查詢時一併送目前填的值;**伺服器只把它當成縮小範圍的條件**,仍在操作者可見範圍內。
- 送出時伺服器用最後的值再驗一次:引用資料不符篩選 → `VALIDATION_FAILED` + `fieldErrors[].code = "LOOKUP_FILTER_MISMATCH"`。
- 被引用欄位改值時,前端清空依賴它的引用欄(提示使用者)。

#### 驗收重點

- 專案來源 key 撞名 → 啟動失敗。
- 明細 200 列引用送出只產生每子欄一次查詢。
- 連動篩選被竄改(送不屬於篩選的 id)→ 送出被擋。

---

### 3.3 B3 審核者來源改用人員條件

#### 現況核對

審核者來源四種:指定使用者、角色、表單欄位(使用者引用欄)、主管(`docs/modules/workflows.md`)。角色不分組織、不剔除申請人;共用流程不能用指定使用者與角色(`USERS_IN_SHARED`、`ROLE_IN_SHARED`)。

#### 設計

審核者來源改為三種:

| 來源     | 說明                                                                      |
| -------- | ------------------------------------------------------------------------- |
| 人員條件 | 取代原本的「指定使用者」與「角色」;角色限定組織用所屬組織條件表達(見 3.0) |
| 表單欄位 | 不變(使用者引用欄);依這張單據算出的人                                     |
| 主管     | 不變;依這張單據算出的人                                                   |

```
審核者來源:人員條件
  組合 [AND ▼]
   角色      屬於  [店長 ×]
   所屬組織  屬於  [單據所屬組織]  範圍 [本身 ▼]
```

- 「單據所屬組織」= 提交的 `orgId`;「租戶」是特殊選項(不是 ID)。
- 找不到人 → 既有「阻擋」,可由流程管理者「新增審核者」。
- 共用流程:人員條件只能用權限與非指定的組織來源,否則 `AUDIENCE_IN_SHARED`。
- **畫面沿用現有流程設計器**(畫布 + 右側關卡面板):關卡面板的「審核者來源」下拉多一個「人員條件」,選了之後下方顯示條件摘要與 [編輯條件];條件在對話框裡用 `AudiencePicker` 編輯(面板寬度放不下條件列)。畫布上的關卡卡片與問題清單把「角色」改成「審核者」。Figma BS-02a~d。

---

### 3.4 B4 每一關指定組織跳過

#### 現況核對

跳過條件用表單運算式;上下文只有 `ctx.now`、`ctx.timezone`、`ctx.user.id`、`ctx.user.orgId`(`packages/domain/src/form/expression-shape.ts` 的 `CONTEXT_VAR_PATHS`);運算子含 `in`。

#### 設計

既有的「跳過條件」(表單運算式)**不取代**,和新的「指定組織跳過」並存,畫面合成同一個區塊:

```
跳過這一關(符合任一項就跳過)
  ☑ 申請人屬於這些組織   [ 最上層組織 ✕ ] [+ 選擇組織]   ☐ 包含下層
  ☑ 符合條件             當「請假天數」< 3   [編輯公式]
```

- 兩項各自勾選;**任一項成立就跳過**(或)。都不勾 = 不跳過。
- 「符合條件」就是既有的跳過條件公式,格式、上下文與驗證都不變;設計器把原本單獨的「跳過條件」欄位搬進這個區塊。
- 「申請人屬於這些組織」判斷的是申請人**所屬組織(全部)**,不是目前組織。
- 「租戶」是特殊選項(不是 ID;畫面顯示「最上層組織」),共用流程可用;指定特定組織只能用在租戶客製流程。
- 不改用人員條件(見 3.0「不改用人員條件的地方」)。
- 跳過的關卡狀態 `skipped`、觸發 `stepPassed(skipped: true)`,**不執行** `beforeApprove`;時間軸記是哪一項成立(「申請人屬於最上層組織」/「符合條件」)。
- 修訂的 `ctx` 快照新增 `ctx.tenant.id`、`ctx.user.orgIds`,加入 `CONTEXT_VAR_PATHS`,也可用於公式和條件。設計器顯示白話:「租戶」「申請人所屬的組織(全部)」「申請人的目前組織」。
- Figma:BS-02a / c、BS-03 的關卡面板。

---

### 3.5 B5 自動通過(含擴充)

```
這一關
  申請人是這一關的審核者時:      ● 照常審核(預設) ○ 自動通過
  審核者已在前面的關卡核准過時:  ● 照常審核(預設) ○ 自動通過
```

- 預設照常審核,既有流程行為不變。
- 自動通過 = 記成那個人的核准;多人會簽時只算他那一票。
- **照樣執行 `beforeApprove`**;被擋下就停在這一關等人處理。
- 時間軸記「申請人是審核者,自動通過」/「已在前關核准,自動通過」。

| B4 跳過                     | B5 自動通過                   |
| --------------------------- | ----------------------------- |
| 看申請人的組織              | 看申請人 / 審核者是否在名單裡 |
| 關卡記「已跳過」,沒有人核准 | 記成那個人核准                |
| 不執行 `beforeApprove`      | 執行 `beforeApprove`          |

---

### 3.6 B9a / B9b / B12 表單模組權限

#### 現況核對

- `apps/db-migrator/seeds/base/form-module-declaration.ts`:表單模組 `sidebarType` 寫死 `link`,只產生 `view` / `create` / `edit` / `delete` 四條權限。
- 一個表單模組可綁多張表單;列表 API `formSubmissions(input: { moduleKey, formKey?, status?, keyword? })` 支援依表單篩選。
- 動態權限(欄位級權限 `show-` / `edit-<formKey>-<fieldKey>`)在四步發布的第 3 步建立。
- `apps/api/src/roles/role-matrix.service.ts` 的 `foreignFieldPermissionKeys`:權限矩陣過濾其他租戶客製表單的動態權限(fail-closed),依 `parseFieldPermissionKey` 拆 formKey。
- `PermissionResolver` 展開 `<模組>.*` 時**包含**其他租戶客製表單的動態權限,`me.modules` 會把這些 key 傳到瀏覽器(洩漏 formKey、欄位 key)。

#### B9a 表單模組宣告可以加頁內權限

- `formModuleDeclaration` 新增選填 `permissions: [{ action, name }]`,和固定四條一起產生(例 `store.sell`)。
- 不提供「隱藏的表單模組」:「從畫面發起」的表單用「一個表單模組綁多張表單 + 替換列表頁」實現(見專案規格)。

#### B9b 依表單分開新增權限

| 項目                         | 設計                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 開關                         | 模組宣告 `perFormCreate: true`,**只能在 seed 宣告**,不提供執行期開關                                                                                 |
| 權限                         | 每綁定並發布一張表單,在發布第 3 步自動建立動態權限 `<模組>.create-<formKey>`,名稱「<表單名> 新增」,隨表單改名更新;表單不能刪除,所以不退役            |
| 判斷                         | 單一函式 `canCreateWithForm(操作者, 模組, formKey)`:模組開啟 B9b → 看 `create-<formKey>`;否則看模組 `create`                                         |
| 入口清單(全部改呼叫判斷函式) | 新增 API、`moduleForms`、abilities `canDelete`、複製為新單、`formLookup` 版本存取、admin 的 [+ 新增] 按鈕;實作前 grep 全部引用 `create` 的地方列入票 |
| 租戶複製的客製表單           | 產生新權限、**不自動授予**;發布成功畫面提示「請到角色管理授予『<表單名> 新增』」並附連結                                                             |
| 萬用                         | `<模組>.*` 自然包含;模板以 `*` 授予整層時,租戶可自由分配                                                                                             |
| 改既有模組為開啟             | 需要 migration:補建權限、把原持有模組 `create` 的角色授予對應權限                                                                                    |
| 底座示範表單模組             | **不開啟**,維持原樣;只給新專案模組使用                                                                                                               |

#### B12 過濾其他租戶的動態權限

- 把 `foreignFieldPermissionKeys` 的過濾**移到 `PermissionResolver.resolve`**,`me.modules`、`@RequirePermission`、權限矩陣三處一致。
- 解析函式擴充為「表單動態權限」:認得 `show-` / `edit-` / `create-`;檢查所有使用 `parseFieldPermissionKey` 的地方(權限矩陣、`form-field-permissions.service.ts`、退役權限清理),確保 `create-` 不被誤當欄位級權限(例如被退役清理刪除)。
- 只在操作者持有表單模組 `*` 或動態權限時才查 forms(效能)。

#### 驗收重點

- 開啟 B9b 的模組:只有模組 `create`、沒有表單權限的人,每個入口都被擋。
- 租戶 A 的 `me.modules` 不含租戶 B 客製表單的任何動態權限 key。
- 退役權限清理不會列出 / 刪除 `create-` 權限。

---

### 3.7 B15 代理人

| 項目           | 設計                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| 資料表         | `user_delegations { userId, delegateUserId, startAt, endAt, note, createdAt }`;索引 `(userId, startAt)` |
| 畫面           | 個人選單 → 個人設定 → 「代理人」分頁(和個人偏好同一頁的不同分頁)                                        |
| 生效           | 進關解析審核者時,若某人在代理期間內 → 改派給代理人;派任計畫記原審核者與代理人                           |
| 時間軸         | 「由王小明代理李店長」                                                                                  |
| 限制           | 代理人要啟用、在本租戶;否則照原審核者派任並記 log                                                       |
| 代理人是申請人 | 這張單據的任務**留在原審核者名下**,不交給代理人(避免自己審自己);要自動通過另開那一關的 B5               |
| 已派出的任務   | 代理開始前已派出的任務**不自動轉**給代理人(計畫固定);需要時由流程管理者用既有「改派」                   |
| 讀取           | 代理人以「任務持有者」規則讀得到他審的修訂                                                              |

### 3.8 B16 逾時提醒

- 每一關可設定:超過 N 小時未處理 → 通知審核者;超過 M 小時 → 同時通知「通知對象」(人員條件,預設為流程管理者)。
- 由 B14 排程每 15 分鐘檢查,B7 發通知;同一任務同一級別只通知一次(冪等鍵 `(taskId, level)`)。
- **只提醒,不自動核准或駁回**。

### 3.9 B17 知會

- 每一關或整個流程可設定:「通過時 / 完成時」通知某些人(不需要審核)。
- 知會對象來源同審核者三種(人員條件 / 表單欄位 / 主管)。
- 用 B7 通知;知會對象以「任務持有者」同等規則讀得到該修訂的快照(唯讀)。

### 3.10 B18 批次核准

- 申請中心「待我處理」可勾選多筆 → [核准](可填共同意見)。
- **每一筆一個交易**,照樣執行 `beforeApprove`;被擋下的逐筆列出原因,不影響其他筆。
- **只支援核准**;駁回、退回需要填理由,仍逐筆處理。

---

## 4. B6 即時通道

### 目的

伺服器主動推送,支援通知、列印、側欄計數、看板即時更新;連線閒置不計費,Cloud Run 仍可休眠到 0。

### 為什麼不用 Cloud Run WebSocket

- 有連線開著的 Cloud Run 實例持續計費(官方文件),失去 min=0 的 $0 待機。
- 最多 2 台實例,連線與發布可能在不同實例,要另加 Redis 中繼。
- 連線最長 60 分鐘會被切斷。

### 架構

```
瀏覽器(admin)─ wss ─┐
代理程式     ─ wss ─┤→ Cloudflare Worker(rt.<網域>)── 驗證訂閱憑證 → Durable Object hub:<租戶 id>
                     │                                         └ 保存連線、各連線訂閱的頻道
API(Cloud Run)── HTTPS POST /publish(發布密鑰簽章)──┘          收到發布 → 推給有訂閱的連線
瀏覽器 / 代理程式 收到信號 ─ 向 API 拿資料(用自己的身分)
```

- **只傳信號、資料一律向 API 拿**;權限與可見範圍仍由 API 判斷;Cloudflare 不留業務資料。

### 訂閱憑證

```
{ tenantId, userId | agentId, exp(10 分鐘), topics: ["user:123", "board:<分店 id>", ...] } + HMAC 簽章
```

- 由 API `realtimeTicket` 簽發;可訂閱的頻道由 API 依權限與可見範圍計算。
- 不存資料庫。Worker 只驗簽章與到期,不查資料庫。

### 四個流程

1. **建立連線**:取得訂閱憑證 → `wss://rt.<網域>/connect?ticket=` → Worker 驗證訂閱憑證 → `idFromName("hub:" + tenantId)` → Durable Object 接下連線,在連線上記使用者、可訂閱頻道、到期時間;初始訂閱 `user:<自己>`。
2. **換發憑證**:到期前 1 分鐘,前端在**原連線上**送新的訂閱憑證;Durable Object 驗證後更新到期時間(不重新連線)。
3. **訂閱 / 取消訂閱**:頁面在連線上送 `subscribe board:<分店 id>`;Durable Object 檢查是否在訂閱憑證的可訂閱頻道內才加入;離開頁面送 `unsubscribe`。
4. **發布**:API → Worker `/publish { tenantId, topic, signal }` → Durable Object 找出目前訂閱該頻道的連線推送。推送前若發現連線的訂閱憑證已過期 → 關閉該連線、不推送(停用的人最多 10 分鐘後收不到任何信號)。

### 頻道

| 頻道               | 訂閱者         | 信號類型                                                               |
| ------------------ | -------------- | ---------------------------------------------------------------------- |
| `user:<id>`        | 使用者的瀏覽器 | `notification`、`task`(審核任務數)、`badge:<模組 key>`、`print-result` |
| `print-agent:<id>` | 代理程式       | `print-job`                                                            |
| `board:<分店 id>`  | 開著看板的頁面 | `board`(專案用,見專案規格)                                             |

- 信號類型採登記制(前端信號類型登記表):每種信號對應要 invalidate 的 TanStack Query key;頁面用 `useRealtimeSignal(type, handler)`。
- 高頻信號(看板)由發布端合併:同一頻道同一類型**每 2 秒最多發一次**。

### 降級

- 即時通道斷線 → 前端與代理程式自動改成每 60 秒向 API 詢問一次;重新連線後先補抓一次資料。
- 個人選單顯示連線狀態小圓點:綠 = 即時;黃 = 重新連線中(慢速模式)。

### Durable Object 規範

- **必須使用 WebSocket Hibernation API**(`ctx.acceptWebSocket`、`serializeAttachment`),不得用 `ws.accept()`(連線期間持續計費)。寫進規範並以測試把關。
- 連線資訊放 attachment:`{ userId | agentId, allowedTopics, subscribedTopics, exp }`。

### 費用與極限(免費方案)

| 項目     | Cloudflare Worker                                                    | Durable Object                |
| -------- | -------------------------------------------------------------------- | ----------------------------- |
| 免費額度 | 每天 10 萬次請求;每次 10ms CPU                                       | 每天 10 萬次請求;13,000 GB-秒 |
| 超過     | 那一種操作失敗,到 UTC 00:00(台灣 08:00)恢復 → 系統降級為 60 秒輪詢   | 同左                          |
| 付費方案 | 整個帳號 US$5/月:Worker 每月 1,000 萬次;Durable Object 每月 100 萬次 | —                             |

| 動作                   | Worker | Durable Object      |
| ---------------------- | ------ | ------------------- |
| 建立連線               | 1      | 1                   |
| 發布一個信號           | 1      | 1                   |
| 訂閱 / 取消 / 換發憑證 | —      | 每 20 則訊息算 1 次 |
| 推送給連線、閒置連線   | 不計   | 不計                |

| 官方限制                     | 數字           | 影響              |
| ---------------------------- | -------------- | ----------------- |
| 單一 Durable Object 每秒請求 | 軟上限約 1,000 | 每租戶一個,遠低於 |
| 每個 Durable Object 的連線數 | 官方未寫上限   | —                 |
| 收到的訊息大小               | 32 MiB         | 信號只有幾十 byte |
| 每次處理 CPU                 | 30 秒          | 毫秒級            |

- **全部環境先用免費方案**。用量不在系統內記錄,直接看 Cloudflare 後台;不讓租戶看到。

### 工程與部署

| 項目            | 內容                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/realtime` | TypeScript;Worker + Durable Object 類別 `TenantHub`;加入 pnpm workspace;共用 `packages/` 裡不依賴 Node 的程式(訂閱憑證型別與簽章)            |
| 開發依賴        | `wrangler`、Cloudflare 型別與測試套件(實作時查 registry 版本)                                                                                |
| turbo           | `dev` = `wrangler dev`(本機模擬)、`test`、`lint`                                                                                             |
| 執行環境        | V8(不是 Node):只用 fetch、WebSocket、WebCrypto                                                                                               |
| 部署            | `deploy.yml` 加 `wrangler deploy` 步驟;三個環境各一個 Worker                                                                                 |
| 網域            | `rt.<網域>`、`rt-dev.<網域>`、`rt-staging.<網域>`(Cloudflare DNS 既有帳號);實作時登記 `docs/branding.md`                                     |
| 密鑰            | 發布密鑰(API → Worker)、訂閱憑證簽章密鑰(API 簽、Worker 驗);API 放 Secret Manager、Worker 放 Wrangler secret;GitHub 加 Cloudflare 部署 token |
| API             | `RealtimePublisher.publish(tenantId, topic, signal)`(交易後執行、盡力而為)、`realtimeTicket`                                                 |
| admin           | `RealtimeProvider`(殼層):登入後連線、換發憑證、重連退避、降級輪詢                                                                            |

### 驗收重點

- 租戶 A 的訂閱憑證無法訂閱租戶 B 或別人的 `user:` 頻道。
- 斷線期間的變動在重連後補抓到。
- 關掉 Worker → 系統以 60 秒輪詢正常運作。

---

## 5. B7 通知

### 現況核對

底座只有流程的通知信(`workflow-engine/workflow-notifier.service.ts`、`MailService`),沒有站內通知。

### 資料表 `notifications`

| 欄位                  | 說明                       |
| --------------------- | -------------------------- |
| `tenantId`、`orgId`   |                            |
| `recipientId`         | 收件人                     |
| `type`                | 通知類型 key               |
| `title`、`body`       | 依類型範本產生             |
| `refType`、`refId`    | 連結目標                   |
| `dedupeKey`           | 唯一(防止同一事件重複通知) |
| `readAt`、`createdAt` |                            |

- TTL 索引:`createdAt` 90 天後自動刪除。

### 通知類型登記表

| 欄位              | 說明                                                      |
| ----------------- | --------------------------------------------------------- |
| `key`             | 例 `workflow.task-created`、`lottery.stocktake-reminder`  |
| `name`            | 顯示名稱                                                  |
| `defaultChannels` | **多選、至少一個**:`in-app`、`email`(管道可登記)          |
| `canDisable`      | 每個管道可否由使用者關閉(例:「待你審核」的站內通知不可關) |
| `template`        | 標題 / 內容範本(i18n)                                     |
| `category`        | 當事人通知 / 負責人提醒                                   |
| `orgScope`        | 負責人提醒才有:組織範圍(由事件帶入的組織 + 本身 / 含上層) |
| `defaultAudience` | 負責人提醒才有:預設人員條件                               |

### 分層

```
業務程式碼(流程引擎、專案)
  └ notify({ type, recipients, params, ref, dedupeKey })
      NotificationService
        1 查類型登記表 → 2 查收件人偏好 → 3 寫 notifications(交易內)
        4 交易後:RealtimePublisher.publish("user:<id>", { type: "notification" })
        5 需要 email → MailService(交易後)
```

### 收件人:兩類

| 類別       | 收件人怎麼決定                                                                                       | 有沒有設定                       |
| ---------- | ---------------------------------------------------------------------------------------------------- | -------------------------------- |
| 當事人通知 | 程式依事件決定:審核者、申請人、單據建立者、排班當事人;以及流程設定的知會對象、逾時通知對象(B16、B17) | 沒有;流程那兩種在流程設計器設定  |
| 負責人提醒 | 通知類型宣告的**組織範圍** 且 符合**人員條件**                                                       | 租戶在「通知設定」頁調整人員條件 |

- **收件人解析工具只有兩種**:指定使用者、人員條件(3.0 的「列出符合的人」)。不提供「組織內擁有某權限的人」,改用人員條件的權限欄位。
- 負責人提醒的組織範圍由通知類型宣告(例:事件的分店本身、事件的分店含上層、租戶),租戶不能改;人員條件裡不再選組織。
- 租戶沒有調整時,用類型宣告的預設人員條件。

### 通知設定頁(`system.notification-settings`)

- 放在系統管理底下,給租戶管理員;權限 `view`、`edit`。**側欄位置**:「系統管理」群組現有 8 項(組織管理、使用者管理、角色管理、模組與權限、欄位管理、資料範圍、表單管理、流程管理)順序不動,最後依序加「通知設定」「印表機管理」;模組 seed 的初始圖示 `notifications`(白名單已有)。
- 版面沿用現有列表頁(示範模組列表的卡片:搜尋 + 表格 + 頁碼),Figma BS-09a / b。
- 列出所有負責人提醒類型:名稱、組織範圍(唯讀)、目前的人員條件(`AudiencePicker`)、[還原預設]。
- 租戶的調整存在 `notification_settings { tenantId, type, audience, updatedBy, updatedAt }`,唯一 `(tenantId, type)`;沒有資料 = 用預設。
- **管道可登記**:新增管道(例:手機推播)= 新增轉接器,所有類型都能勾選;`notify()` 呼叫方式不變。
- **連結登記表**:`refType` → 頁面路由,登記方式同 lookup 登錄表。
- **流程引擎**:`workflow-notifier` 改呼叫 `notify()`,站內與 email 由同一入口產生;沿用「寄信失敗不影響推進」。

### UI

- 頂端列 🔔 + 未讀數;點開為通知清單(標已讀、全部標已讀、點擊開連結)。
- 新通知時右下角提示(數秒消失):用統一的 Snackbar(10.12),Severity=Info、有標題、沒有動作;不另做元件。
- 個人偏好:每種類型的管道開關(依 `canDisable`)。

### 驗收重點

- 同一 `dedupeKey` 只產生一筆。
- 通知寫入與觸發它的動作同交易;動作回復則沒有通知。
- 負責人提醒:租戶調整人員條件後,下一次觸發就依新條件;還原預設後回到類型宣告的條件。

---

## 6. B8 列印

### 背景

- 收據機:XP-Q90EC **LAN 或 WiFi 版**(查到的資料:沒有藍牙版本;支援 ESC/POS;紙寬 57~57.5mm 即 58mm 規格;自動切紙;有錢箱介面)。建議網路線連接。
- 雲端連不進店內網路,所以由**店內代理程式**主動接收工作。

### 架構

```
任何裝置 [列印] → 瀏覽器把 58mm 單據轉成寬 384 點的黑白 PNG → API 建立 print_job
→ 交易後發布 print-agent:<id> 的 print-job 信號
→ 代理程式向 API 拿圖片 → 轉 ESC/POS 點陣指令 → TCP 9100 → 收據機 → 自動切紙
→ 代理程式回報 已印 / 失敗 → API 發布 user:<要求人> 的 print-result
```

- 即時通道故障時,代理程式降級為每 60 秒詢問。

### 資料表

| 資料表         | 欄位                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `print_agents` | `orgId`(分店)、`name`、`keyHash`、`lastSeenAt`、`version`、`enabled`                                                                                                                                   |
| `printers`     | `orgId`、`agentId`、`name`、`host`、`port`(預設 9100)、`paperWidth`(58)、`isDefault`(分店預設)、`enabled`、`status`(正常 / 缺紙 / 離線)、`statusAt`                                                    |
| `print_jobs`   | `orgId`、`printerId`、`documentType`、`refType`、`refId`、`image`(內容快照)、`status`(等待中 / 已送出 / 已印 / 失敗)、`error`、`isReprint`、`printNo`(第幾次)、`requestedBy`、`createdAt`、`printedAt` |

- **印表機只記到分店層**;專案如需「收銀點的印表機」由專案自己加欄位(見專案規格)。

### 配對

1. 印表機管理 → [新增代理程式]:選分店、名稱 → 顯示**伺服器網址**(各有 [複製])與 **8 碼配對碼**(10 分鐘有效)。
2. 店內電腦安裝代理程式(見「下載與安裝」)→ 貼上伺服器網址與配對碼 → 換到長期**代理程式金鑰**存在本機;註冊成服務,開機自動執行。
   - 執行檔不寫死環境,同一份檔案在 dev / staging / production 都能用,連哪個由伺服器網址決定。
3. 金鑰只能領自己分店印表機的工作;可撤銷;資料庫只存雜湊。

### 代理程式 `apps/print-agent`

monorepo 的新 app;TypeScript + Node.js,與 api 同一套工具鏈。

| 模組         | 做什麼                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| `pairing`    | 伺服器網址 + 配對碼 → 換長期金鑰 → 寫入本機設定檔                                                          |
| `api-client` | 用金鑰呼叫 API:拿工作、認領、回報結果、換即時通道訂閱憑證                                                  |
| `realtime`   | WebSocket 連即時通道,收 `print-agent:<id>` 信號;斷線退避重連;故障降級每 60 秒輪詢;啟動時先拿一次未完成工作 |
| `job-runner` | 佇列;同一台印表機一次一張、依序印                                                                          |
| `escpos`     | PNG 解碼 → `GS v 0` 點陣指令分段送出 → 切紙;`DLE EOT` 讀狀態(缺紙等);TCP 9100 連線與逾時                   |
| `simulator`  | **模擬印表機**:不送出,把內容存成圖片檔(開發、測試用)                                                       |

- **認領**:收到信號或輪詢到工作,先以條件更新把工作從「等待中」改成「已送出」,成功才印;避免信號與輪詢重複而印兩次。
- **黑白轉換在瀏覽器做**(與預覽同一個元件產出 384 點寬黑白 PNG);代理程式只用純 JavaScript 的 PNG 解碼,不用含原生模組的圖片處理套件,打包單一執行檔才簡單。
- **測試**:單元測試比對產生的 ESC/POS 位元組;整合測試在測試內起一個**假的 9100 伺服器**驗收到的位元組;實機依「實機測試清單」。
- **設定檔**:Windows `C:\ProgramData\print-agent\`;Linux `/etc/print-agent/`;macOS `/Library/Application Support/print-agent/`;只有服務身分能讀(內含金鑰)。
- **紀錄**:每天一個 log 檔,保留 14 天。
- **更新**:第一版手動更新;代理程式回報 `version`,印表機管理頁把舊版標示「請更新」。自動更新列入未來考慮。
- 實作時查 registry / Node 發布資訊確認版本:Node(取當時 LTS,確認 SEA 支援)、WinSW、純 JS PNG 解碼套件;WebSocket 客戶端優先用 Node 內建。

### 執行環境

- **可以和收銀共用同一台電腦**:瀏覽器開後台、代理程式在背景以服務執行,互不影響;資源用量很小。
- 一家店只需要**一個**代理程式,建議裝在每天都會開著的收銀電腦。
- 條件:電腦與收據機在**同一個區域網路**;收據機設**固定 IP**(見實機測試清單);電腦**關閉睡眠**(關機或睡眠時列印失敗,顯示「失敗:代理程式離線」)。
- 同一台電腦按 [列印] 也經過雲端(瀏覽器 → API → 即時通道 → 代理程式),約一秒內;不做瀏覽器直連本機代理程式(HTTPS 與本地網路存取限制容易出問題)。好處是平板、手機走同一條路一樣能印。

### 打包(四個平台)

用 Node 內建的單一執行檔(SEA)打包,店家不需要安裝 Node。

| 平台        | 檔案                             | 背景執行                  | 安裝                                   |
| ----------- | -------------------------------- | ------------------------- | -------------------------------------- |
| Windows x64 | `print-agent-windows-x64.zip`    | WinSW 註冊成 Windows 服務 | 右鍵「以系統管理員身分執行」`安裝.bat` |
| Linux x64   | `print-agent-linux-x64.tar.gz`   | systemd(`.service`)       | `sudo ./install.sh`                    |
| Linux arm64 | `print-agent-linux-arm64.tar.gz` | systemd                   | `sudo ./install.sh`                    |
| macOS arm64 | `print-agent-macos-arm64.tar.gz` | launchd(`.plist`)         | `sudo ./install.sh`                    |

- 服務都設定開機自動執行、當掉自動重啟。
- **macOS 不簽章**(Apple 開發者帳號每年 99 美元,先不申請):`install.sh` 解除隔離標記;安裝說明寫明第一次被擋時的處理。
- 不支援 Intel Mac(x64);需要時再加一個建置目標。

### 發布(手動觸發)

新增 `.github/workflows/print-agent-release.yml`,只能 `workflow_dispatch`,輸入 `version`、`environment`(dev / staging / production):

```
gh workflow run "Print Agent Release" --ref main -f version=1.0.0 -f environment=dev
```

1. 四個平台的 runner 同時建置 → 打包壓縮 → 計算 SHA-256。
2. 上傳到該環境的私有 bucket(`GCS_BUCKET_PRIVATE` 指向的那個;身分沿用部署的 WIF,不建金鑰)→ 更新 `manifest.json`。
3. 順序同 Deploy:先 dev 測試,再 staging、production。
4. 不放進每次 PR 的 CI:repo 為 private 時 macOS runner 費用是 Linux 的 10 倍、Windows 2 倍;代理程式很少改版,只在發布時跑。

**存放位置**(不用 GitHub Release:repo private 時店家下載不到):

```
<私有 bucket>/print-agent/
 ├ manifest.json          最新版本、各版本、各檔案的 SHA-256
 └ <版本>/                四個平台的壓縮檔
```

- 保留最近 3 個版本;每版約 150~200MB,費用每月不到 1 元台幣。

### 下載與安裝

1. 印表機管理 → 代理程式分頁上方:「最新版本 x.y.z」+ 四個下載按鈕(依瀏覽器偵測的系統,反白建議的那個)。按下時 API 讀 `manifest.json`、用既有檔案服務產生**簽名網址**(1 小時);需要 `system.printers.create`。
2. 解壓縮 → 執行安裝(見打包表)。
3. 安裝程式詢問伺服器網址與配對碼(從 [新增代理程式] 複製)→ 註冊服務並啟動 → 代理程式列顯示「已連線」。
4. 更新:下載新版再執行一次安裝;偵測到舊設定時保留金鑰,不必重新配對。

### 版面零件(58mm)

- 可列印寬度約 48mm,一行約 16 個中文字;一欄;「標籤:值」;表格最多 3 欄;號碼用區段;底部 QR code(單據不用一維條碼;測試頁會印一維條碼,確認機器支援);簽名欄。
- 每份單據上方印**租戶名稱**,不印平台名稱。
- 螢幕預覽與列印用**同一個元件**(先預覽、再轉圖片)。
- 底座提供**零件**,各單據由使用的模組自己組:表頭(租戶名稱、單據名稱、單號、時間)、標籤值列、最多 3 欄的表格、號碼區段、分隔線、合計列、簽名欄、QR code、補印標示,以及文字列(大 / 一般 / 小 / 粗體 × 靠左 / 置中 / 靠右,自動換行)、一維條碼、切紙位置。Figma 的 `Receipt58` 只是用零件組成的示範,不是固定版面。

### 列印按鈕元件

- 選印表機(預設:專案提供的預設 → 分店預設);送出後顯示「已送到印表機 → ✓ 已印出 / ✗ 失敗:缺紙」。
- 印過的單據按鈕變 [補印];補印標示「補印」與第幾次。
- 沒有登記任何印表機的分店:按鈕灰色,提示「本店未設定印表機」。

### 權限

| key                               | 用途       |
| --------------------------------- | ---------- |
| `system.printers.create` / `edit` | 印表機管理 |
| `api.printing.print`              | 列印       |
| `api.printing.reprint`            | 補印       |

- 沒有收據機的租戶:不授予 `api.printing.*` → 所有列印按鈕不顯示。

### 印表機管理頁(`system.printers`)

側欄位置見通知設定頁(系統管理群組最後一項);模組 seed 的初始圖示 `print`,**新增進 `@repo/domain/module-icon` 的 `MODULE_ICON_KEYS` 白名單與 `@repo/ui` 圖示登錄**,Figma 圖示用 `Draft/ActionIcon` 的 `key=print`。版面沿用現有申請中心的卡片(頁內分頁 + 右上按鈕 + 篩選 + 表格 + 頁碼),Figma BS-10a / b、BS-17~20。

分頁:印表機 | 代理程式 | 列印紀錄。印表機列有 [測試列印](印出測試頁,見下);代理程式分頁上方是下載區(見「下載與安裝」);代理程式列顯示狀態(已連線 / 離線)、最後連線時間、版本(舊版標示「請更新」)、[重新配對]、[停用]。

#### 測試頁(`[測試列印]` 印這一張)

用版面零件組成,涵蓋所有列印格式,一次確認機器、字型與切刀(Figma BS-18d):

| 區塊     | 內容                                                  |
| -------- | ----------------------------------------------------- |
| 表頭     | 最上層組織名稱、「測試頁」、印表機名稱與 IP、時間     |
| 字體大小 | 大字、一般字、小字、粗體字(都印「ABC 123」)           |
| 對齊     | 靠左、置中、靠右各一行                                |
| 欄位     | 左右兩欄(標籤:值)、三欄表格(表頭 + 一列)              |
| 換行     | 一段超過一行的長文字,確認自動換行不截斷               |
| 分隔線   | 各區塊之間的虛線                                      |
| 條碼     | 一維條碼(Code128)+ QR code(內容 = 印表機管理頁的連結) |
| 切紙     | 印完自動切紙                                          |

- 結果顯示在對話框:成功「已印出測試頁:請核對字體大小、對齊、條碼、QR code 與切紙。」;失敗顯示原因與 [重試](BS-18a / b / c)。

### 實機測試清單(收據機到貨後)

1. 網路連線與固定 IP(**到貨後撰寫設定步驟**:建議路由器保留 IP,把收據機 MAC 綁定固定 IP;路由器不能設時才用收據機網頁或芯燁設定工具設固定 IP,注意不可與其他設備撞號)。2. 58mm 寬度與邊界。3. 每張自動切紙。4. 中文清晰度。5. QR code 可刷。6. 缺紙狀態回報。

---

## 7. B10 全域掃描監聽

| 項目 | 設計                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 判斷 | 條碼槍是鍵盤輸入:字元間隔小於門檻、長度符合、以 Enter 結尾 → 視為掃描;門檻做成設定值,預設 30ms,收到條碼槍後實測調整                            |
| 攔截 | 游標在一般輸入框時也攔截;只有標記為「條碼欄位」的輸入框交給輸入框處理                                                                          |
| 用途 | 頁面用 `useScanner(purpose, handler)` 宣告;**目前打開的頁面優先**;沒有頁面宣告時,交給**專案登記的預設處理**(刮刮樂登記「快速銷售」,見專案規格) |
| 相機 | 手機 / 平板可開相機掃描(碼制以實物確認)                                                                                                        |
| 測試 | 可注入模擬掃描事件                                                                                                                             |

---

## 8. B11 報表登記

### 底座提供

| 元件         | 內容                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------- |
| 報表模組外框 | 「輸出報表」模組:選報表 → 填條件 → [預覽] [匯出 Excel]                                       |
| 期間選擇器   | 日 / 週 / 月 + 快捷(今天、昨天 / 本週、上週 / 本月、上月)                                    |
| 分店多選     | `OrgTreeSelect`,有數量上限                                                                   |
| 其他條件     | 下拉、勾選                                                                                   |
| 範圍檢查     | API 共用函式:期間類型、分店數量;超過 → `RANGE_TOO_LARGE`                                     |
| Excel 產生器 | 在瀏覽器以 exceljs 產生;每家分店一個工作表 + 全部合計工作表;A4、縮放成一頁寬、每頁重複標題列 |
| 預覽         | 「工作表 → 表格」通用元件,預設顯示合計工作表,可切換分店工作表                                |

### 期間換算(依租戶時區,沿用表單引擎的時點做法)

| 期間 | 起               | 迄(不包含)         | 選擇器                                                     |
| ---- | ---------------- | ------------------ | ---------------------------------------------------------- |
| 日   | 當日 00:00       | 隔日 00:00         | 一個日期                                                   |
| 週   | **星期日** 00:00 | 下一個星期日 00:00 | 月曆點任一天選整週;顯示「10/11(日)~ 10/17(六)」,不顯示週次 |
| 月   | 1 日 00:00       | 下個月 1 日 00:00  | 12 個月格子                                                |

- 日期一律由 admin 用表單引擎的工具函式(`startOfLocalDay`、`addLocalCalendar`)換成時點;API 只收時點。
- 不提供自訂起迄。
- 「對齊日結」等專案特有條件由報表登記的 `extra` 條件提供(見專案規格)。

### 登記格式

```ts
registerReport({
  key: "operations", // 權限:reports.operations
  name: "營運報表",
  conditions: {
    period: ["day", "week", "month"],
    orgs: { max: 50 },
    extra: [
      {
        key: "alignDailyClose",
        type: "boolean",
        label: "對齊日結",
        only: "day",
      },
    ],
  },
  query: OperationsReportQuery, // 專案的 GraphQL 查詢
  sheets: buildOperationsSheets, // 查詢結果 → 工作表(Excel 與預覽共用)
});
```

- 權限:每張報表一條頁內權限 `<報表模組>.<報表 key>`;沒有權限的報表不出現在選單。
- `registerReport` 是暫定名稱,實作時可依程式慣例調整。

---

## 9. B14 排程任務

| 項目       | 設計                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 觸發       | Cloud Scheduler 一個工作,每 15 分鐘呼叫 API 內部端點(OIDC 驗證,只接受 Scheduler 的服務帳戶)                                                                              |
| 登記       | `registerScheduledJob({ key, every: "15m"                                                                                                                                | "1h" | "daily@08:00", handler })`,底座與專案各自登記 |
| 執行       | 每次呼叫依登記判斷哪些工作到期;每個工作一筆執行紀錄 `scheduled_job_runs { key, scheduledFor, status, startedAt, finishedAt, error }`,唯一 `(key, scheduledFor)` 保證冪等 |
| 時區       | 「每天 08:00」依各租戶時區                                                                                                                                               |
| 底座使用者 | B16 逾時提醒、通知 TTL 以外的清理、B7 通知相關提醒                                                                                                                       |
| 費用       | 一個 Scheduler 工作在免費額度內;每 15 分鐘喚醒 Cloud Run 一次                                                                                                            |
| 命名       | `scheduled_job_runs`、`registerScheduledJob` 是暫定名稱,實作時可依程式慣例調整                                                                                           |

---

## 10. UI 元件與設定

### 10.1 useUrlState 與 PageTabs(第 19 項)

#### useUrlState:頁面狀態存在網址

- **任何頁面都能用**,不限有頁內分頁的頁面。
- `useUrlState(key, schema)`:一個 key 存一包 JSON;同一頁元件多、或對應不同 API 時用多個 key;zod 驗證,網址被改壞時退回預設值。
- 套件:`nuqs`,先用 **2.10.1**(2026-08-25 發布,peer `react-router ^8`,adapter `nuqs/adapters/react-router/v8`);實作時再查 registry。

| 放進網址                                | 不放進網址                       |
| --------------------------------------- | -------------------------------- |
| 列表的篩選、關鍵字、排序、頁碼          | 表單還沒存的輸入內容             |
| 報表的期間、分店、報表種類              | 敏感資料(身分證字號、金額明細等) |
| 頁內分頁(PageTabs 內部也用 useUrlState) | 大量資料(例如勾選的大量 id)      |
| 目前打開的詳情或彈窗(例 `?view=<id>`)   | 暫時性介面狀態(展開、hover 等)   |

- **既有頁面這一輪一起改**:現況只有登入、設定密碼、變更密碼三頁讀網址參數,所有列表的篩選重新整理後就消失。這一輪把底座所有列表與有篩選的頁面改用 useUrlState(示範模組、使用者、角色、組織、模組與權限、欄位管理、表單列表與提交列表、申請中心、流程、稽核等;實作時以盤點清單為準,建入口清單測試),全系統只有一種做法。
- 寫進 `docs/concepts/frontend-architecture.md` 與規範:新頁面一律用 useUrlState,不自行讀寫 `useSearchParams`。

#### PageTabs:頁內分頁

- 目前分頁以 useUrlState 記在網址;每個分頁可設定需要的權限,沒有權限就不顯示;只有一個分頁時不顯示分頁籤。
- **建立在既有 `@repo/ui/tabs` 上**(Figma 既有 Draft/Tabs 就是它,不另畫新元件);PageTabs 只多了網址同步與分頁權限。
- 與既有頁籤 `RouteTabs`(`apps/admin/src/stores/useRouteTabsStore.ts`)無關。
- **放不下時橫向捲動**:分頁籤維持單列、可左右捲動;還有分頁的那一側固定顯示漸層淡出 + ‹ / › 按鈕(點了捲一段),捲到底那一側的漸層與按鈕消失;選到的分頁(含從網址打開)自動捲進可視範圍。Figma 在 BS-15 補這個狀態。

### 10.2 OrgTreeSelect(第 20 項)

- 輸入框顯示已選組織;點開為搜尋 + 樹;單選 / 多選;可設上限;只列可見範圍內的組織。
- 內部沿用 `apps/admin/src/components/OrgTreePicker/` 與 `apps/admin/src/lib/org-tree.ts`。
- Figma:欄位外觀同現有 SelectField;下拉的搜尋框用現有 TextField、每一列用現有 `Draft/OrgTreeItem`(與「選擇所屬組織」對話框同一個元件,單選反白、多選打勾);現有組織樹不收合,所以不畫展開箭頭。

### 10.3 Section 可收合區塊(第 21 項)

| 用法    | 一般頁面                                                        | 表單引擎                                                                                                        |
| ------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 寫法    | `<Section id="dealers.contact" title summary defaultCollapsed>` | 表單版面區塊(`LayoutSection { key, title, rows }`)在設計器加三個設定:可以收合、預設收合、收合時標題列顯示的欄位 |
| 區塊 id | `<模組 key>.<區塊 key>`                                         | `form:<formKey>.<區塊 key>`                                                                                     |

- 內容區可以放任何內容(程式是 children;Figma 用 slot,畫面上直接放入欄位或表格)。
- 表單有錯 → 自動展開並捲到第一個錯誤(暫時性,不寫入儲存)。
- **收合狀態儲存**:localStorage key `<slug>-admin-sections:<userId>`(新增到 `createAdminStorageKeys`、登記 `docs/branding.md`);內容依頁面分組 `{ "<頁面 id>": { "<區塊 key>": boolean } }`;**只記與預設值不同的**;改回預設就刪除,頁面空了就刪頁面;**不設上限**;打開某頁時清除該頁已不存在的區塊 key;讀不到儲存時用預設值。

### 10.4 側欄計數登記制(第 22 項)

- 現況:只有申請中心,寫死在 `apps/admin/src/hooks/useApplyCenterCounts.ts`。
- 改為登記:`registerBadge({ moduleKey, count(operator) })`;API 一次回傳使用者看得到的所有模組的數字。
- 透過 `badge:<模組 key>` 信號即時更新(不輪詢)。

### 10.5 MonthCalendar、RosterGrid(第 24 項)

- 放 `@repo/ui`,不使用第三方行事曆套件(資源排班表在常見套件屬付費功能)。
- `MonthCalendar`:月曆版面、日期格可放自訂內容、選取、行事曆標示。
- `RosterGrid`:人 × 日期矩陣,建立在既有 `DataTable`(`@tanstack/react-table` + `react-virtual`)上;元件負責版面、選取、捲動、凍結欄;格子內容由使用的模組決定。
- `RosterGrid` 另有**頂部固定群組**(選用):日期表頭下方、人員列上方的一組列(例班表的「人力需求」區:一列一種班別,每格一個狀態標籤),和表頭、左右固定欄一起固定,不隨人員列捲動;群組標題可收合(▾ / ▸),收合時顯示一列**彙總**(每天一格,主行 + 副行,例「需 5 · 已排 4 / 缺 1 · 可排 2」,顏色由使用的模組決定);群組內容、列數與收合預設值由使用的模組決定,收合狀態由使用的模組保存。
- `RosterGrid` 支援**左右固定欄**(現有 `DataTable` 已有左右 pinning:左邊固定人員欄、右邊固定統計欄,中間日期區左右捲動)與**欄位顯示 / 隱藏**(TanStack column visibility;現有 DataTable 沒有開,本輪打開,讓使用的模組提供 [⚙ 顯示欄位]);另可把一組欄位**收合成一個窄欄**(例 [統計 ▸],點了展開)。
- `MonthCalendar` 另支援**多選日期**(選用):點一下選取 / 取消;每週左側有整週勾選框;外部可設定不能選的日子(例:店休,停用色)與日期註記(例:特殊日名稱);格子大小依容器寬度調整(電腦大格、手機約 48px)。專案的「套用範本」用它選日期。
- `MonthCalendar` 的日期格可放**角標**(選用):右上角小圓點(例:有異動、缺卡;顏色由模組決定)或 error badge(內容由模組決定)。
- 週 / 日的時間軸是另一個元件 `ScheduleTimeline`(第 10.11 節)。

### 10.6 個人偏好 `user_preferences`(第 25 項)

| 項目         | 設計                                                  |
| ------------ | ----------------------------------------------------- |
| 資料表       | 每使用者一筆 `{ userId, settings: { <key>: value } }` |
| 登記制       | 底座與專案登記 key、型別、預設值                      |
| 這一輪的項目 | 語言;每種通知類型的管道開關                           |
| 不做         | 顯示密度                                              |
| 畫面         | 個人選單 → 個人設定(分頁:偏好                         | 代理人) |

**裝置 vs 帳號**

| 跟著帳號(`user_preferences`) | 跟著裝置(瀏覽器儲存)                                                |
| ---------------------------- | ------------------------------------------------------------------- |
| 語言、通知管道               | 外觀(`<slug>-admin-color-mode`)、側欄收合、區塊收合、專案的裝置設定 |

- 語言:登入後用帳號設定;本機保留一份快取(既有 `<slug>-admin-locale`)供登入前與第一個畫面使用,避免閃爍。需修改規範 I18N-05 與 `docs/branding.md` 說明。

### 10.7 標籤色票(第 26 項)

- `packages/ui/src/theme/tokens.ts` 新增 `tagPalettes`:10 組(藍、青、綠、萊姆、黃、橘、紅、粉、紫、灰),每組有淺色 / 深色模式的底色與文字色,文字達 WCAG AA。
- 與 `statusPalettes`(info / success / warning / error)分開:色票只用於分類標籤。
- **只能從色票選,不能輸入色碼**。
- 欄位管理的選項新增選填「顏色」(色票代號)。
- 同步更新 `docs/branding.md`。

### 10.8 Stepper 精靈步驟(第 27 項)

- 放 `@repo/ui`(有 stories),給多步驟的精靈用(例:交班結帳 4 步、日結 5 步)。
- 每一步:編號、名稱、狀態(已完成 / 進行中 / 未開始 / 有錯);已完成的步驟可以點回去;窄螢幕只顯示「第 2 / 5 步 · 名稱」。
- 步驟內容與 [上一步] [下一步] 的條件由使用的頁面決定。
- Figma:專案草稿 `Draft/WizardStep` 升格為底座 `Draft/Stepper`(放 Base Draft 頁)。

### 10.10 表單設定:允許存草稿(第 28 項)

- 表單設定新增「允許存草稿」,預設開。
- 關掉時:新增 / 編輯頁不顯示 [存草稿],API 也拒絕建立草稿(只能直接送出)。
- 草稿只有建立者看得到,不觸發任何掛接點的「送出後」動作;送出時才跑守門檢查。
- 刮刮樂專案:叫貨單、進貨單、調貨單開;撤銷售出申請、現金更正單、補打卡申請、支援需求單關。
- Figma:沿用表單設計器畫面,設定區多一個開關(畫面清單 BS-21)。

### 10.11 ScheduleTimeline 時間軸(第 29 項)

- 放 `@repo/ui`,不用第三方行事曆套件(和 `MonthCalendar` / `RosterGrid` 同一個理由)。
- 版面:**日模式**一天,時間由左往右;**週模式**7 天各一欄,每欄內時間由上往下;時間軸固定 00:00~24:00,每小時一格,在時間方向捲動(表頭固定)。**進入畫面(或切換日期 / 週)時自動捲到顯示範圍內最早的長條或容器的前 1 小時**(沒有資料時捲到 08:00)。跨午夜的長條在當天畫到 24:00 並標「→ 次日」,次日從 00:00 接續並標「前日 →」。表頭用現有 `TableHeaderCell`。
- **容器模式**:每個「群組」(例:一筆人力需求)畫成一個容器(底層),容器標題由模組提供;容器裡放屬於它的長條(例:排班),容器比裡面所有長條高一點。日模式容器往下排、往下長,不收起任何東西。
- **週模式排版(收起單位是整個容器,長條不單獨收起)**:
  - 容器佔的條數 = max(需求人數, 已排人數)(由模組提供;缺額佔條數裡的空位);容器寬 = 20(直排標題)+ 28 × 條數(px,整數)。
  - 當天可用寬度 = 一天欄寬;只要有容器被收起,先保留最右邊 24px 給「+N」長條再重排。
  - 依排序逐一放:從最左邊找第一個「在這個容器整段時間內都空得下它的寬度」的位置;找不到就整個收起。已放好的不移動;時間不重疊的容器可共用同一位置(例:早班結束後晚班接在同一欄)。
  - 有收起時,當天欄最右邊固定一條「+N」長條(`ScheduleTimelineMore`,高度佔滿 00:00~24:00),框線顏色由模組依被收起內容決定(Tone:Neutral / Warning / Error);點了回呼模組(例:清單浮層)。留白落在容器與「+N」長條之間,滑過留白照一般空白處處理。
  - 容器內的長條左右並排,每條寬 28(標題直排),排列順序由模組提供。
  - **決定性(同樣輸入一定同樣輸出)**:排版是純函式 `layoutTimeline(groups, dayWidth) → 每個容器的位置或「收起」`,不讀時鐘、不用亂數、不依賴輸入陣列順序;函式內先依完整排序排序:開始時間 → 模組提供的排序鍵(例:崗位排序 → 範本排序)→ 建立時間 → id(唯一,保證不平手)。欄寬先換算成條數再排,只有跨過整數條時排法才改變。
  - **測試**:規則頁(Figma「班表時間軸 · 各種情況」)每一格對應一個固定輸入 / 預期輸出的測試(電腦 157、平板 125 兩種寬度(設計稿實際欄寬));同一批輸入隨機打亂順序結果必須相同;隨機資料檢查容器不重疊、不超出寬度、收起數 = 「+N」數字。
- 長條:開始 / 結束、標題、副標、狀態(正常 / 較短 / 停用);長條可帶前段 / 後段延伸(超出所屬容器的時間):淡色底 + 虛線框,和實線段相接(相接側不畫框、不圓角),長度依時間;容器大小不變,長條可以超出容器邊界,延伸段不得蓋到相鄰容器的文字或長條;缺額用虛線空位表示(兩種強度:錯誤色、警告色)。右上角可放小圖示(例:自動排入),內容由模組決定。
- 背景:可設定不能操作的時間範圍(灰色,例:店休、已排於其他分店)與日期背景色(例:特殊日)。
- 互動:點容器、點長條、點空白處都回呼給模組(帶出點到的日期與時間);hover 提示由模組提供內容。不做拖拉(之後再評估)。
- **互動狀態**(容器、長條、收起窄條;`RosterGrid` 格子與頂部群組標籤、`MonthCalendar` 標籤同一套):滑過 = 原底色上疊一層**同色系 `main` × 主題 `action.hoverOpacity`(8%)**,邊框換成同色系 `main`;**已選取** = 疊同色系 `main` × `action.selectedOpacity`(16%)+ 1px 同色系 `main` 邊框;白底元件(bg/default、bg/paper)用 `grey/500` 疊(即 MUI 預設 `action.hover` / `action.selected`)。做法同 MUI outlined / text 按鈕(Figma 元件用一層 state layer 圖層,填色綁 main、圖層不透明度 8% / 16%;檢核按鈕這類開關用 `ToggleButton`),顏色一律綁既有色票變數,透明度用主題的 opacity,不另做顏色;游標手指;鍵盤焦點 = `action/focus` 外框;停用(不能操作的時間)不變色、游標維持箭頭。空白處可點時,滑過的那一格顯示淡色「+ 新增」提示(文字由模組提供)。觸控裝置沒有滑過,按下時底色加深。
- 寬度不足時:日模式橫向捲動、列標題凍結;手機不用這個元件(模組改用清單或卡片)。

### 10.9 關聯類型命名(專案關聯表也適用)

- `type = <第一方單數>_<第二方單數>`,實體名稱用資料表名稱的單數(含前綴,例 `org_lottery_bank_account`)。
- 同一對資料表有多種關係時**不在 type 加意思**,意思寫在 `meta`(例 `meta.role`);專案關聯表的唯一鍵可以包含 `meta` 的欄位。
- 順序依底座 Org > User > Role > Module > Permission,專案實體排在其後;組織一律在前。

---

### 10.12 Snackbar 統一提示(第 30 項)

全站的短提示(操作成功 / 失敗、可撤銷的動作、新通知)用同一個元件 `Snackbar`(`@repo/ui`),取代現有各自的提示寫法。

| 項目 | 規則                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 位置 | 電腦 / 平板:右下角,距邊 24;手機:底部置中、左右 16 滿寬(有底部導覽時放在它上面)                                                            |
| 堆疊 | 新的在下面,往上疊;最多 3 則,超過時最舊的先收掉;和新通知提示同一個堆疊                                                                     |
| 樣式 | 卡片:底 `background.paper`、文字 `text.primary`、左側 4px 色條 `success` / `error` / `warning` / `info` 的 main;陰影與圓角同現有 Snackbar |
| 顏色 | 全部用主題 token,暗色模式自動套用暗色那組,不寫死色碼                                                                                      |
| 內容 | 標題(選填)+ 訊息;右側 ✕;有動作時(例 [撤銷])按鈕放在 ✕ 左邊                                                                                |
| 時間 | 一般 4 秒自動消失;有動作的 8 秒;滑鼠移上去暫停計時                                                                                        |
| 可調 | 位置、時間等可用 props 調整,但系統預設一致;各模組不另寫提示元件                                                                           |

- 專案的即時銷售 / 兌獎可撤銷提示(「已售出 … [撤銷]」)也用它(Success + [撤銷])。
- Figma:`Draft/Snackbar+`(搬回底座時取代現有 `Draft/Snackbar`);BS-08 通知提示、專案 ST-35a / ST-38a / ST-08 背景。

### 10.13 Figma 規範與稽核腳本(第 31 項)

這一輪畫圖時整理出的規則與自動檢查,搬進底座,讓底座與每個專案共用。正本:規則寫進 `docs/standards/general/figma.md`(給 FIGMA-xx 編號);腳本放底座 repo `scripts/figma-audit/`;來源是 scratch-lot `docs/tmp/figma-base-round/README.md` 的畫圖檢查清單與 audit 腳本。之後專案發現的新規則用 `base-sync contribute` 回收。

**規則**

| 類別     | 規則                                                                                                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 三種尺寸 | 專案畫面一律畫電腦 1440 / 平板 1024 / 手機 390;修一個尺寸時其他尺寸與背景複本的同類問題一起修;三尺寸的共用區塊(標題列、卡片)用同一個元件實例;手機逐張對電腦,資訊與排序不能少                                                  |
| 版面     | 文字不被裁切、元件內文字不溢出;同列欄位對齊;子節點不超出父框;元件不蓋到文字(浮層例外,名稱含「浮層」);兩欄頁面撐滿高度;遮罩、全螢幕對話框、底部面板、抽屜蓋滿整個畫面                                                          |
| 顏色     | 只綁共用色票變數,不自創顏色;同一顏色在一個模組只有一個意思;分類色用 `tagPalettes`,狀態色(info / success / warning / error)只表狀態;專案頁綁專案品牌色                                                                         |
| 圖例     | 畫面上每個顏色 / 圖示 / 符號 / 線型都在同畫面圖例找得到外觀一樣的項目;圖例每項在該畫面會出現;圖例樣本用真實元件實例;同一狀態可依使用處改寫文字,顏色與狀態一對一                                                               |
| 元件     | 小標籤用標籤元件,不拿大元件改字湊;共用元件設計 props 前先盤點所有使用處(狀態集合、各處文字、可否點選);互動狀態照 10.11(MUI 做法:同色系 main × hoverOpacity / selectedOpacity)                                                 |
| 資料     | 同一份示範資料在各檢視與背景複本一致;示範資料算得起來(張號從 001、數字可加總)                                                                                                                                                 |
| 流程     | 畫之前列畫面清單與入口 → 畫面對照;入口旁放它打開的畫面;設計稿編號、規格章節、權限 key 放框外註解;改圖前列影響範圍,改後全部頁面重跑稽核並逐張截圖;子代理回報的稽核要自己用**完整腳本**重跑;畫圖腳本與文件和 Figma 現況一起更新 |

**稽核腳本(`scripts/figma-audit/`,每項要是 0)**

| 腳本           | 檢查                                                                            | 歸屬                |
| -------------- | ------------------------------------------------------------------------------- | ------------------- |
| `audit-layout` | 裁切、欄位對齊、外溢、蓋字、元件內文字溢出、遮罩蓋滿、殘留底座主色(專案頁)      | 底座                |
| `audit-sync`   | 三尺寸按鈕 / 區塊一致、遮罩有背景頁、共用區塊非元件、Section 寬度、篩選抽屜     | 底座                |
| `audit-legend` | 沒綁色票、圖例和畫面標示對不上(以實際色值比對)                                  | 底座                |
| `audit`        | 草稿元件與標記、草稿色票綁定(回收後要 0)、畫面內開發文字                        | 底座                |
| 跨畫面資料比對 | 底座提供框架(指定參考畫面與比對欄位);比對規則由專案提供(例:班表 `audit-roster`) | 底座框架 + 專案規則 |

- 腳本裡寫死的頁面 id、元件名稱、例外清單抽成設定檔(每個專案自己填),腳本本身不含專案名詞。
- README 寫清楚怎麼在 Figma MCP 執行(整份貼上,不貼精簡版)與每項數字的意思。
- 驗收:wowgo-base 的 `figma.md` 有上述條文;cookhome 與 scratch-lot 用同一份腳本跑出 0;之後 scratch-lot 新增的規則能用 `base-sync contribute` 回收到底座。

## 11. 未來考慮(這一輪不做)

規格在實作完成後退場,所以這一章在收尾時要**依類別搬走**(見 0.4)。

**A. 以後可能做 → 搬到底座的 `docs/tmp/dis.md`**(格式照現有條目:標題 + 說明 + 「現況:未開票;何時再評估」;決定要做時才開 issue)

| 項目                                                                                                                        | 何時再評估                         |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 退回到指定的關卡                                                                                                            | 推進判斷表要大改;有實際需求時      |
| 審核者臨時加簽                                                                                                              | 派任計畫固定,動態插入關卡牽動大    |
| 收回已做的核准                                                                                                              | 少用,且與後續關卡衝突              |
| 電子簽章                                                                                                                    | 需要憑證與法規研究                 |
| Cloudflare 付費方案                                                                                                         | 用量接近免費額度時                 |
| 收據機透過 WebUSB 列印                                                                                                      | 之後再評估                         |
| 列印代理程式自動更新                                                                                                        | 第一版手動更新,改版少              |
| 代理程式 macOS 簽章(Apple 開發者帳號)                                                                                       | 每年 99 美元;先用解除隔離標記      |
| 代理程式支援 Intel Mac                                                                                                      | 需要時再加建置目標                 |
| 一週起始日由租戶設定                                                                                                        | 有租戶需要時                       |
| 依另一欄位篩選以外的動態 lookup(例如依目前時間)                                                                             | 無需求                             |
| 通知管道:手機推播、LINE                                                                                                     | B7 已可登記管道;有需求時加轉接器   |
| 聯絡對象 API:用人員條件查出可處理的人名(模組在後端登記條件,前端只能指定名稱;只回顯示名稱、最多 5 人;權限限能使用該功能的人) | 有模組要在提示裡顯示「找誰處理」時 |
| 現有 Overlay 參考畫面的背景改成打開它的頁面(畫圖檢查清單 14;本輪回收到 wowgo-base 後改,release 後同步回各專案)              | 本輪回收完成後                     |

**B. 已決定不做 → 寫進對應正本,成為規則**(不進 dis.md,避免看起來像沒做完)

| 決定                              | 寫進哪裡                                  |
| --------------------------------- | ----------------------------------------- |
| 列印只走代理程式,不讓網站當接收端 | `docs/modules/printers.md`(規則 + 理由)   |
| 一週固定從星期日開始              | B11 報表登記的概念文件                    |
| 不做顯示密度                      | 個人偏好(`user_preferences`)的說明,一句話 |

## 12. 待確認事項

無。

---

## 13. 畫面清單

Figma 驗收以本表為準:每一列都要有節點才算畫完;**每張畫面都以「以哪個現有畫面為底」那一欄的現有底座畫面為底,只畫本輪改動**(第十九輪起);節點登記在 `docs/tmp/figma-base-round/nodes.md`。狀態:✅ 已畫、🔁 要重畫、⬜ 待畫。畫面用中性示範資料(不出現刮刮樂內容),搬回底座時進參考畫面與 Screens Starter。

| 編號           | 畫面                                                                                                                                       | 章節     | 以哪個現有畫面為底                                              | 狀態 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------- | ---- |
| BS-01          | 資料範圍:新規則卡(套用對象 + 條件組合)                                                                                                     | 3.0      | Admin 資料範圍                                                  | ✅   |
| BS-02a / c     | 流程設計器:審核者來源改人員條件(客製 / 共用流程)                                                                                           | 3.3      | Admin 流程管理 — 流程設計(側欄收合)                             | ✅   |
| BS-02b / d     | 審核者條件對話框(客製 / 共用流程)                                                                                                          | 3.0、3.3 | 同上 + 現有對話框樣式                                           | ✅   |
| BS-03          | 流程設計器:每一關跳過、自動通過、逾時提醒、知會                                                                                            | 3.4~3.9  | Admin 流程管理 — 流程設計(側欄收合)                             | ✅   |
| BS-04a         | 表單模組 [+ 新增]:只列有新增權限的表單                                                                                                     | 3.6      | Admin 示範表單 — 列表 + 選擇要填寫的表單                        | ✅   |
| BS-04b         | 表單發布成功:提示授予新增權限                                                                                                              | 3.6      | Admin 表單管理 — 表單版本 + 發布新版本                          | ✅   |
| BS-05          | 個人設定:偏好分頁                                                                                                                          | 10.6     | Admin 申請中心 — 我的申請(卡片 + 分頁版型)                      | ✅   |
| BS-06a / b     | 個人設定:代理人分頁、新增代理                                                                                                              | 3.7      | 同上                                                            | ✅   |
| BS-07a / b     | 申請中心「待我審核」批次核准、核准結果                                                                                                     | 3.10     | Admin 申請中心 — 待我審核                                       | ✅   |
| BS-08          | 通知鈴、通知清單、通知提示                                                                                                                 | 5        | Admin 總覽                                                      | ✅   |
| BS-09a / b     | 通知設定頁、編輯收件人                                                                                                                     | 5        | Admin 示範模組1 列表                                            | ✅   |
| BS-10a / b     | 印表機管理:印表機分頁、新增代理程式(配對碼)                                                                                                | 6        | Admin 申請中心 — 我的申請(卡片 + 分頁版型)                      | ✅   |
| BS-11          | 列印按鈕各狀態、58mm 版面零件示範(元件示範卡)                                                                                              | 6        | Button                                                          | ✅   |
| BS-12          | 表單設計器:分區的收合設定                                                                                                                  | 10.3     | Admin 表單管理 — 表單設計                                       | ✅   |
| BS-13          | 欄位管理:選項顏色(色票)                                                                                                                    | 10.7     | Admin 欄位管理 — 自訂類別                                       | ✅   |
| BS-14          | 側欄計數(展開 / 收合,元件示範卡)                                                                                                           | 10.4     | 現有側欄(展開 / 收合)                                           | ✅   |
| BS-15a         | 頁內分頁 PageTabs + 網址參數                                                                                                               | 10.1     | Admin 申請中心 — 我的申請                                       | ✅   |
| BS-15b         | PageTabs 放不下時:橫向捲動 + 漸層與箭頭(元件示範卡)                                                                                        | 10.1     | Draft/Tab                                                       | ✅   |
| BS-16          | Stepper 各狀態(寬 / 窄,元件示範卡)                                                                                                         | 10.8     | —(新元件)                                                       | ✅   |
| BS-17          | 印表機管理:新增 / 編輯印表機                                                                                                               | 6        | BS-10a + 現有對話框樣式                                         | ✅   |
| BS-18a / b / c | 印表機管理:測試列印結果(成功 / 缺紙 / 離線)                                                                                                | 6        | 同上                                                            | ✅   |
| BS-18d         | 印表機管理:測試頁(58mm 單據圖)                                                                                                             | 6        | Receipt58 零件                                                  | ✅   |
| BS-19          | 印表機管理:代理程式分頁(下載區 + 清單)                                                                                                     | 6        | Admin 申請中心 — 我的申請(卡片 + 分頁版型)                      | ✅   |
| BS-20          | 印表機管理:列印紀錄分頁                                                                                                                    | 6        | 同上                                                            | ✅   |
| BS-21          | 表單設計器:表單設定「允許存草稿」開關                                                                                                      | 10.10    | Admin 表單管理 — 表單設計                                       | ✅   |
| BS-22          | ScheduleTimeline 時間軸(容器模式):日模式容器往下排、週模式最多並排 2 個 + 「+N」、長條各狀態、缺額虛線空位、跨容器淡色延伸、不能操作的時間 | 10.11    | —(新元件;表頭用 Draft/TableHeaderCell,以 RosterGrid 草稿為參考) | ✅   |
| BS-23          | MonthCalendar 多選日期(整週勾選、停用日、日期註記)與日期格角標                                                                             | 10.5     | Draft/MonthCalendar 草稿                                        | ✅   |
