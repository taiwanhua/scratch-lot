# scratch-lot

## 專案文件主入口

**`CLAUDE.md` 是本專案最主要的文件入口,適用所有接手 agent,不只 Claude。** 開始任務及每次上下文恢復時,先讀它,再依其中指引讀 `docs/README.md` 與相關正本。本檔補充 Codex 的恢復與交接要求;下方共通規則若與 `CLAUDE.md` 重複或不同步,以 `CLAUDE.md` 及其指向的正本為準,並回報差異。

跨工具分工、工作樹與共同接手規則見 [`docs/agents/collaboration.md`](docs/agents/collaboration.md)。必要決策與驗收存於版控文件及 issue/PR;下列 Codex 本機恢復紀錄只作輔助,不能成為 Claude 或其他接手者的必要依賴。

## 上下文壓縮後的恢復流程

每次上下文壓縮、從摘要恢復或接續中斷任務後,在繼續分析、修改或派工前,**必須重新讀取檔案**,即使摘要說之前已讀過:

1. **先讀 `CLAUDE.md`**,再讀本檔、`docs/README.md`、`docs/agents/toolbox.md`、`CONTEXT.md`、`docs/architecture.md`、`docs/standards/README.md`、`docs/tmp/dis.md`。
2. `.codex/handoffs/` 中與目前任務對應的交接紀錄,以及紀錄指向的最新規格。沒有交接紀錄時,先依可見對話建立,無法確認的事項標成待確認。
3. 當前任務相關的模組技術文件、使用者 help、規範檔與 ADR;涉及資料或部署時再讀對應資料模型或部署文件。

讀完後核對目前分支、工作目錄變更與實際產物,確認「目標、使用者已定案事項、未定案建議、完成項目、待辦及授權範圍」再接續。摘要只作為查找線索,不能代替重新讀檔;文件與最新使用者要求有差異時,依最新要求處理並指出差異。只為無法從對話、文件或程式確認且會影響工作的事項詢問使用者。

重要決定或進度改變時,即時更新對應交接紀錄,不等壓縮前才保存。紀錄保留使用者明確要求、決策理由、規格路徑、驗證結果及下一步;清楚區分「已定案」「建議待確認」「已完成」「尚未執行」。正式領域規則仍以現有正本為準,交接紀錄負責指路與保存任務狀態。派工時一併提供相關紀錄與規格,完成後核對實際結果再更新狀態。

## Git 工作流程(分支 ↔ 環境)

`main`=production、`staging`=預發布、`dev`=開發測試。規則:

- feat 分支**一律從 `main` 切出**;完成後 PR 合併到 `dev` 做整合測試(CI 綠才 merge)
- 通過測試、要上線的 feat 分支,**逐一** PR 合併到 `staging` 做預發布驗證
- 發布 = `staging` PR 合併回 `main`;release 後進行中的 feat 分支 rebase 到最新 `main`
- **release 是一批一次**(各票各自合 `dev` / `staging`,累積後一次 release PR + 一次部署);**release 後把 `dev` 與 `staging` reset 對齊 `main`**:`git push --force origin origin/main:refs/heads/dev`(`staging` 同),絕不把 `main` 合併回 `dev` / `staging`。前置檢查與例外見 `docs/deployment.md` 二、Release 步驟第 4 點
- `dev` 汙染時整支重置:同上一條的 reset 指令(或 `git checkout dev && git fetch && git reset --hard origin/main && git push --force origin dev`)
- **部署一律手動觸發 deploy.yml**(merge 不自動部署):Actions UI 或 `gh workflow run Deploy --ref <分支> -f environment=<dev|staging|production>`
- **不直接 commit/push `main`** — 一律走 feat 分支 → PR → dev → staging → main,**連文件/設定修正也不例外**(2026-09-14 收緊:直接 commit main 會使進行中的 feat 分支被迫一直 rebase;發現要補的東西就開新分支)。此為紀律約定(免費方案無 branch protection),AI 與人同守

## Coding standards

寫或改程式碼前,先讀 `docs/standards/README.md` 的索引,只載入與改動範圍相關的規範檔;review 時引用規則編號(如 `REACT-02`)。review 中被採納的新決定要回寫進對應規範檔。

凡新增或異動品牌文字、圖案、色彩、網域(程式碼或 Figma),必須同步更新 `docs/branding.md` 品牌註冊表。

凡新增或異動環境變數,必須同步更新 `docs/env-registry.md`(並依判準決定放 Secret Manager 或普通 env)。

## Agent skills

### 新專案初始化

使用 `project-bootstrap` skill,操作正本是 [docs/agents/project-bootstrap.md](docs/agents/project-bootstrap.md)。只有全新空 repo 的初始分支可指向已審查底座 commit;之後含初始化在內的變更一律走現有 PR 流程。底座升級分支的 ancestry 特例見 [deployment](docs/deployment.md#底座首次接軌與版本升級),一般功能分支仍 rebase。

### Issue tracker

Issues 追蹤在目前 repo 的 GitHub Issues,透過 `gh` CLI 操作;repo 身分以 `deploy/project/github.json` 的 `expectedRepository` 為準。見 `docs/agents/issue-tracker.md`。

### Triage labels

使用預設標籤詞彙:`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。見 `docs/agents/triage-labels.md`。

### Domain docs

單一 context:repo 根目錄的 `CONTEXT.md` + `docs/adr/`(由 `/domain-modeling` 惰性建立)。見 `docs/agents/domain.md`。

- **新增**一個後台 CRUD 模組 → `docs/agents/module-scaffold.md`(檔案清單 + 步驟 + 每步的正本;藍本是示範模組 1 / 2)
- 開發/修改後台模組 → 先讀 `docs/modules/<key>.md`(內部技術文件)+ `apps/admin/src/md/module-help/{base,project/additions,project/replacements}/<key>.help.md`(租戶使用者說明:守詞彙表、不得出現平台視角詞彙;build 時打包進說明彈窗)
- 設計稿與 Library → `docs/branding.md` 的設計資源登記;規範見 `docs/standards/general/figma.md`
- 進行中討論與待辦 → `docs/tmp/dis.md`
- 資料模型地圖 → `docs/data-model.md`;欄位/索引細節見 `apps/api/src/database/schemas/*.schema.ts`(逐欄有註解)
- 環境變數 → `docs/env-registry.md`(用途/是否機密/放哪)
