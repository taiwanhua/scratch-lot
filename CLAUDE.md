# scratch-lot

## Git 工作流程(分支 ↔ 環境)

`main`=production、`staging`=預發布、`dev`=開發測試。規則:

- feat 分支**一律從 `main` 切出**;完成後 PR 合併到 `dev` 做整合測試(CI 綠才 merge)
- 通過測試、要上線的 feat 分支,**逐一** PR 合併到 `staging` 做預發布驗證
- 發布 = `staging` PR 合併回 `main`;release 後進行中的 feat 分支 rebase 到最新 `main`
- **release 是一批一次**(各票各自合 `dev` / `staging`,累積後一次 release PR + 一次部署);**release 後把 `dev` 與 `staging` reset 對齊 `main`**:`git push --force origin origin/main:refs/heads/dev`(`staging` 同),絕不把 `main` 合併回 `dev` / `staging`。前置檢查與例外見 `docs/deployment.md` 二、Release 步驟第 4 點
- `dev` 汙染時整支重置:同上一條的 reset 指令(或 `git checkout dev && git fetch && git reset --hard origin/main && git push --force origin dev`)
- **部署一律手動觸發 deploy.yml**(merge 不自動部署):Actions UI 或 `gh workflow run Deploy --ref <分支> -f environment=<dev|staging|production>`
- **不直接 commit/push `main`** — 一律走 feat 分支 → PR → dev → staging → main,**連文件/設定修正也不例外**(理由:直接 commit main 會使進行中的 feat 分支被迫一直 rebase;發現要補的東西就開新分支)。此為紀律約定(免費方案無 branch protection),AI 與人同守

## Coding standards

方案討論與規格設計前,先依 [STRUCT-13](docs/standards/general/structure.md#struct-13-方案設計先核對現況優先延伸既有機制)核對現有實作、格式與使用方式,優先沿用或擴充既有機制。

寫或改程式碼前,先讀 `docs/standards/README.md` 的索引,只載入與改動範圍相關的規範檔;review 時引用規則編號(如 `REACT-02`)。review 中被採納的新決定要回寫進對應規範檔。

凡新增或異動品牌文字、圖案、色彩、網域(程式碼或 Figma),必須同步更新 `docs/branding.md` 品牌註冊表。

凡新增或異動環境變數,必須同步更新 `docs/env-registry.md`(並依判準決定放 Secret Manager 或普通 env)。

## Agent skills

### 新專案初始化

使用 `project-bootstrap` skill,操作正本是 [docs/agents/project-bootstrap.md](docs/agents/project-bootstrap.md)。只有全新空 repo 的初始分支可指向已審查底座 commit;之後含初始化在內的變更一律走現有 PR 流程。底座升級分支的 ancestry 特例見 [deployment](docs/deployment.md#底座首次接軌與版本升級),一般功能分支仍 rebase。

### 底座升級與共用改良回收

共用 CLI、升級整合、回收與發布前環境/資料核對見 [deployment](docs/deployment.md#底座首次接軌與版本升級);指令速查見 [toolbox](docs/agents/toolbox.md#底座升級與回收)。Claude、Codex 與人員使用同一入口,各自可獨立接手;工具準備分支與報告,接受回收及發布沿既有審查流程。

### Issue tracker

Issues 追蹤在目前 repo 的 GitHub Issues,透過 `gh` CLI 操作;repo 身分以 `deploy/project/github.json` 的 `expectedRepository` 為準。見 `docs/agents/issue-tracker.md`。

### Triage labels

使用預設標籤詞彙:`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。見 `docs/agents/triage-labels.md`。

### Domain docs

單一 context:repo 根目錄的 `CONTEXT.md` + `docs/adr/`(由 `/domain-modeling` 惰性建立)。見 `docs/agents/domain.md`。

- 文件入口 → `docs/README.md`(系統地圖、七個核心概念、閱讀路線、文件目錄)
- 底座現況(是什麼 / 怎麼運作)→ `docs/concepts/`(七份,順序見 `docs/agents/domain.md`「概念導讀」);決策理由 → `docs/adr/`
- agent 的工具與環境須知 → `docs/agents/toolbox.md`
- 跨工具分工、工作樹與接手 → `docs/agents/collaboration.md`(Claude、Codex 與人員共用)
- **新增**一個後台 CRUD 模組 → `docs/agents/module-scaffold.md`(檔案清單 + 步驟 + 每步的正本;藍本是示範模組 1 / 2)
- 開發/修改後台模組 → 先讀 `docs/modules/<key>.md`(內部技術文件)+ `apps/admin/src/md/module-help/{base,project/additions,project/replacements}/<key>.help.md`(租戶使用者說明:守詞彙表、不得出現平台視角詞彙;build 時打包進說明彈窗)
- 設計稿與 Library → `docs/branding.md` 的設計資源登記;規範見 `docs/standards/general/figma.md`
- 進行中討論與待辦 → `docs/tmp/dis.md`
- 資料模型地圖 → `docs/data-model.md`;欄位/索引細節見 `apps/api/src/database/schemas/*.schema.ts`(逐欄有註解)
- 環境變數 → `docs/env-registry.md`(用途/是否機密/放哪)
