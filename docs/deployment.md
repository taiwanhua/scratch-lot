# 部署架構與操作手冊

三環境分支為 `dev` / `staging` / `main`;api 與 admin 只由手動 Deploy 發布。本檔是設定、部署、release、分支對齊與資料更新的操作正本。

## 一、架構總覽

底座預設停用 cloud 與 GitHub 看板,沒有已配置的 Cloud Run、Atlas、Vercel、DNS、寄信或儲存資源。啟用的引用專案可以採用以下架構:

```text
front (Next.js / Vercel) ─┐
admin (nginx / Cloud Run) ├─> api (NestJS / Cloud Run) ─> MongoDB
                         └─> GCS 簽名上傳 / Resend 信件
```

### 環境對照(分支 ↔ 環境)

| 環境       | 分支      | 設定來源                                                   |
| ---------- | --------- | ---------------------------------------------------------- |
| dev        | `dev`     | `cloud.json` 的 `environments.dev` + `deploy/env/dev.yaml` |
| staging    | `staging` | `environments.staging` + `deploy/env/staging.yaml`         |
| production | `main`    | `environments.production` + `deploy/env/production.yaml`   |

`cloud.json` 停用時沒有 environments;啟用時三環境須完整提供。資料庫、Secret、bucket、網址各自設定,不得沿用來源專案資源。

### 資源清單

| 項目                                                     | 識別正本 / 建立位置                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| repo、看板                                               | `deploy/project/github.json`;看板由專案另建或明確停用                                                 |
| GCP、region、registry、WIF、部署 service account         | `deploy/project/cloud.json` 啟用後的 `gcp`                                                            |
| Cloud Run 服務、API URL、Secret 名稱、seed 帳號          | `cloud.json` 的各環境設定                                                                             |
| API 明文變數、bucket、cookie 與後台網址                  | `deploy/env/<環境>.yaml`                                                                              |
| 真正密碼、連線字串與金鑰                                 | Secret Manager;不進 repo 或文件                                                                       |
| 排程呼叫(Cloud Scheduler 工作、呼叫身分 SA)              | 專案自己的 GCP 設定;步驟見[Cloud Scheduler](#cloud-scheduler排程任務)                                 |
| 即時通道 Worker、Cloudflare 帳號、兩把密鑰名稱           | `cloud.json` 各環境的 `realtime`(可省略 = 停用);步驟見[即時通道](#即時通道cloudflare-worker)          |
| 列印代理程式安裝檔(部署 SA 對 `print-agent/` 的寫入權限) | 各環境私有 bucket 的 `print-agent/`;步驟見[列印代理程式發布](#列印代理程式發布print-agent-releaseyml) |
| front / Storybook                                        | 專案自己的 Vercel 設定與網域                                                                          |
| DNS、寄件網域、資料庫與預算                              | 專案自己的外部服務設定                                                                                |

值的用途與未設行為見 `docs/env-registry.md`,建立與驗證狀態依[初始化索引](project-initialization.md)記在 issue/PR。下文的 `project`、`example.invalid`、`<...>` 是操作示例,須換成該專案實際輸入。

### 新專案的 GCP 基礎資源

啟用雲端時先用**新專案自己的** GCP project、帳單帳戶、region、GitHub repo 和 service account 建立資源;識別填入 `deploy/project/cloud.json`。以下是目前 `deploy.yml` 的建立順序與 Bash 指令範例,已存在的資源先查現值,不要重建或沿用 CookHome 的身分。建立 GCP project、綁帳單帳戶及選擇預算金額由專案輸入決定。

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com secretmanager.googleapis.com storage.googleapis.com cloudresourcemanager.googleapis.com compute.googleapis.com billingbudgets.googleapis.com --project=<gcp-project>
gcloud artifacts repositories create <registry-repo> --repository-format=docker --location=<region> --project=<gcp-project>
gcloud iam service-accounts create github-deployer --project=<gcp-project>
gcloud projects add-iam-policy-binding <gcp-project> --member="serviceAccount:<deployer-sa>" --role=roles/run.admin
gcloud projects add-iam-policy-binding <gcp-project> --member="serviceAccount:<deployer-sa>" --role=roles/artifactregistry.writer
```

`<deployer-sa>` 是剛建立的完整 email。`deploy.yml` 未指定 Cloud Run 的 `--service-account`:**新服務**初建使用該 GCP project 的預設 Compute Engine service account(`<project-number>-compute@developer.gserviceaccount.com`);既有服務以 `gcloud run services describe` 查實際執行身分,不可假設仍是預設值。部署 SA 要能代用執行身分;執行身分另需依下文取得 Secret、GCS 與 `signBlob` 權限。

```bash
gcloud projects describe <gcp-project> --format="value(projectNumber)"
gcloud iam service-accounts add-iam-policy-binding <runtime-sa> --member="serviceAccount:<deployer-sa>" --role=roles/iam.serviceAccountUser --project=<gcp-project>
gcloud iam workload-identity-pools create github --location=global --project=<gcp-project>
gcloud iam workload-identity-pools providers create-oidc github-oidc --location=global --workload-identity-pool=github --issuer-uri="https://token.actions.githubusercontent.com" --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" --attribute-condition="assertion.repository=='<owner/repo>'" --project=<gcp-project>
gcloud iam service-accounts add-iam-policy-binding <deployer-sa> --member="principalSet://iam.googleapis.com/projects/<project-number>/locations/global/workloadIdentityPools/github/attribute.repository/<owner/repo>" --role=roles/iam.workloadIdentityUser --project=<gcp-project>
```

`cloud.json.gcp.artifactRegistry` 填 `<region>-docker.pkg.dev/<gcp-project>/<registry-repo>`、`workloadIdentityProvider` 填 `projects/<project-number>/locations/global/workloadIdentityPools/github/providers/github-oidc`、`deployServiceAccount` 填 `<deployer-sa>`。WIF 僅信任該 repo,`deploy.yml` 的 `id-token: write` 取得短效 OIDC token;不建立服務帳戶金鑰。Secret 的讀取者與每環境授權見[下方步驟](#新增一個-secret-manager-機密的標準步驟),GCS 權限見 [GCS 段](#gcs-bucket-與-iam重建或加新環境時照此)。Cloud Run api/admin 服務由**首次手動 Deploy** 建立,不是此處預先建立。

預算在選定帳單帳戶、金額與通知門檻後建立,例如 `gcloud billing budgets create --billing-account=<billing-account-id> --display-name="<project> budget" --budget-amount=<amount><currency> --filter-projects=projects/<gcp-project> --threshold-rule=percent=0.5 --threshold-rule=percent=0.9`。預算只通知、不會自動停止服務;建立後在 Billing 核對通知收件者與範圍。

## 二、分支模型與 CI/CD 流程

### 分支模型

```
main(= production)
  │  feat 分支一律從 main 切出
  ├─▶ feat/xxx ──PR──▶ dev(整合測試環境;可被汙染,可隨時 reset 回 main)
  │        │  測試通過、確定要上線的 feat,「逐一」PR 合併 ──▶ staging(預發布驗證)
  │        ▼
  ◀────── staging ──PR 合回 main = 正式發布
release 後:dev / staging reset 對齊 main;進行中的 feat 分支 rebase 到最新 main
```

- **feat 分支從 `origin/main` 切**。依賴的票還沒進 `main` 時,從前一張票的 feat 分支尾端切(疊票);**不從 `dev` / `staging` 切**,那兩條線上有別批未 release 的東西。
- **feat 對齊只用 rebase**:release 後 rebase 到最新 `origin/main`;疊票的前一張被改寫(review 修改、或已 release 進 `main`)時,用 `git rebase --onto <新基底> <前票原本的尾端>` 把本票的 commit 搬過去。**絕不把 `main` / `dev` / `staging` merge 進 feat**:merge commit 會把別票的內容帶進本票的 PR,之後每一條線的 diff 都對不準。
- **共通修正先單獨 release**:CI、測試工具這類每張票都受益的修正,開自己的分支、單獨走一次 release 進 `main`,不等功能批。已經開工的疊票鏈缺這個修正時,把那個 commit `cherry-pick` 到鏈的底部分支,不 merge `dev`。
- `dev` / `staging` 只由 PR 合入,與 `main` 對齊只用 reset(見下面 Release 步驟第 4 點)。

### 底座首次接軌與版本升級

底座同步分支須保留上游版本的共同祖先,適用以下特例;一般功能分支仍依上節 rebase。

日常升級由人員或 agent 呼叫 `node scripts/base-sync/run.mjs upgrade --project <專案路徑> --tag <正式版本> --worktree-root <工作樹父目錄>`;多個專案重複 `--project`。工具核對 repo 身分、正式 annotated tag/Release 與採用記錄,從各專案 `origin/main` 準備隔離分支,留下未提交的三方 merge 供審查。它不 push、開 PR、合併環境分支或部署。專案清單就是本次參數,不另外維護版本帳或中央名冊。

重跑先核對來源、main 基線與既有工作樹;相符才回報目前狀態,不覆蓋整合中的內容。main 前進或同名 tag 改指其他內容時停止。所有 gh 指令明示 `--repo <owner/repo>`,避免同時存在 origin/upstream 時操作錯 repo。採用版本仍只記在 `package.json.wowgoBase`。

1. 從引用專案已發布的 `origin/main` 建立升級分支。核對 `upstream` 指向底座 repo,以 `git fetch upstream --no-tags refs/tags/<版本>:refs/base/releases/<版本>` 取得指定版本,核對 tag 解析出的完整 commit。
2. 一般三方合併該版本並保留 merge commit。依[維護歸屬](architecture.md#底座與專案的維護歸屬)審查**全部差異**,包含 Git 沒有報衝突的專案值;底座改了專案未修改過的預設值,也可能被自動套入。專案來源、品牌、前台、部署、seed 值及 Figma Brand Library / Screens 身分保留,契約新增必填值則明確補齊;Figma 資源或檔案身分不符時依 [toolbox](agents/toolbox.md#figma-品牌同步)核對,不以 Git 合併覆蓋專案設計稿,也不整份選 ours/theirs。
3. workflow、值行檔與其他混合檔逐段整合;固定組裝入口與底座文件是 common,照新底座版本(專案客製寫在 `project/` 來源與專案文件,不改它們)。不能整個排除治理頁或檔案。引用專案若有經審查的資料層相容差異,須保留精確範圍,不能擴成任意跳過租戶隔離。schema/hooks 與 lockfile 在人工來源整合後重產,已發布 migration/seed 快照維持原檔。
4. 依既有 PR 與環境流程驗收。各次合併使用 merge commit,以 `git merge-base --is-ancestor <底座commit> <結果commit>` 核對 ancestry;不得用 `merge -s ours`、squash 或 cherry-pick 代替向下同步。
5. 等待期間若 `main` 前進,從新 `main` **重建升級分支**,重新合併同一底座版本並驗證專案保留;不對含底座 merge 的分支跑一般 rebase,也不把 main 合入舊升級分支。

**資料預檢**:升級後的 `update`(與 `data` reset)在執行任何 migration / seed 之前,會擋下發布與退役交易化之前的舊版留下的三種中斷狀態(停在 `publishing`、`published` 卻不是目前版本、目前版本指到非 `published` 的版本),處理見下節。

#### 舊版留下的發布 / 退役中斷

底座的表單 / 流程發布與退役已是交易(ADR-0013),api 不再有「重試發布」;不清庫升級的引用專案,庫裡可能還留著舊版的中斷資料。預檢(`apps/db-migrator/src/update/interrupted-lifecycles.ts`)逐筆列出並附 `_id`,不自動修。以 mongosh 連上該環境的資料庫,依種類處理後重跑 `update`(表單:`forms` / `form_versions` / `formKey`;流程:`workflows` / `workflow_versions` / `workflowKey`;以下以表單為例):

1. **停在 `publishing`**:改回草稿,之後在畫面重新發布(同一張表單此時不會另有草稿)。
   `db.form_versions.updateOne({ _id: ObjectId("<版本 _id>"), status: "publishing" }, { $set: { status: "draft", version: null, changelog: null } })`
2. **`published` 卻不是目前版本**(切換到一半):其餘已發布的版本改退役,目前版本指向它。
   `db.form_versions.updateMany({ formKey: "<key>", status: "published", version: { $ne: <版號> } }, { $set: { status: "retired" } })`
   `db.forms.updateOne({ _id: ObjectId("<身分 _id>") }, { $set: { currentVersion: <版號> } })`
3. **目前版本指到非 `published` 的版本**(退役做到一半):清掉目前版本。
   `db.forms.updateOne({ _id: ObjectId("<身分 _id>") }, { $set: { currentVersion: null } })`

處理完以同一指令重跑,預檢通過才會往下執行;處理記錄寫進升級 PR。

**升級後檢查**:整合提交、更新採用記錄後,在升級工作樹執行 `node scripts/base-sync/run.mjs verify --project <升級工作樹> --tag <版本> [--out <檔案>]`,把報告貼進升級 PR。工具唯讀,以 upgrade 存的 `refs/base/releases/<版本>` 為底座、已提交的 HEAD 為專案(HEAD 須已包含該版本),報告分七節,任一節有項目即 exit 1,人只判讀例外:逐項說明是真正的專案客製,或是該回收、刪除的重複(例如升格後專案那份沒刪)。七節皆為 0 才 exit 0,即「已去除重複」。報告頂端另列全樹的未歸類(unknown)路徑數與本次的專案字樣詞表;unknown 應為 0,新增路徑時補分類規則(見[共用改良回收](#共用改良回收))。第 2–7 節是靜態掃描,不執行專案程式;各節涵蓋與漏報 / 誤報範圍如下(報告頁尾也附「限制」):

1. **非專案、非混合路徑與新底座仍不同**:`common`、`published-data`、`unknown` 三類的差異逐檔列出並標類別(沒回收到、漂移或改寫已發布資料)。固定組裝入口與底座文件都是 `common`:專案只改 `project/` 來源與專案文件,入口或底座文件與底座不同就是漂移。已知例外:CookHome 的 `apps/api/src/database/database.module.ts` 保留審查過的 Recipe 舊資料例外(`LEGACY_UNSCOPED_MODELS`),會固定列在本節,升級 PR 逐次說明。混合路徑不列,另依下段核對。
2. **客製替換登記**:`page-replacements.ts` 的 target、help `project/replacements/` 的檔、專案 `forms` 帶 options / pageOverrides 的那幾筆。其他登記方式不在範圍;spread、變數等讀不懂的寫法照列為「無法靜態解析」。
3. **底座與專案 seed 同 collection + key**:key 只解析字串、常數(含 seed 執行器定義的常數)、`${常數}` 樣板、`permissionKey()`,以及 `formModuleDeclaration()` 依 helper 本身宣告推導的頁面與權限 key。其他寫法在專案端列為「無法解析的 key」,底座端只計數。collection 讀不出時只比 key,可能誤報。每模組自動產生的 wildcard 與 data_scope_targets 不另比,由模組 key 涵蓋。未被 import 的 revisions 快照不算目前宣告,其中的 key 不比。正式組裝 `seeds/registry.ts` 在載入時就拒絕底座與專案撞 key,這部分由 CI 把關。
4. **專案路徑與底座同名或同匯出名稱**:只比 `project/` 路徑的程式檔(不含 STRUCT-12 的成對固定來源、專案值與 seed / migration)與底座 common 程式檔的檔名(不含 `index`)及具名匯出(不含 default)。常見名稱可能誤報;改了名的重複抓不到。
5. **共用與混合路徑新增了專案字樣**:相對新底座新增的行(`common` 與 `mixed`,值行檔除外)逐行比對專案字樣詞表,不分大小寫。詞表取自既有來源、不另維護:`projectPublic.slug` 與 `brand.name` 一定列入;Figma 稽核設定的 `projectTerms`、專案 seed 宣告的模組 key 第一段、專案 API 程式的 collection 名稱第一段,在底座 tag 已出現的不列(那是底座自己的詞彙)。命中的行改回底座的中性寫法,或把內容搬到專案路徑;`contribute` 用同一份詞表,命中即停止。詞表沒有的業務用語抓不到。
6. **值行檔在值行以外與底座不同**:根 `package.json` 只容許 `name`、`wowgoBase`;`.env.example` 只容許 `KEY=` 後面的值(key、註解與行數照底座);`CLAUDE.md`、`AGENTS.md` 只容許標題行;`README.md` 只容許第一個與底座共同的 `## ` 標題之前的專案介紹;`docker-compose.yml` 應與底座相同(專案值由根 `.env.example` 提供)。
7. **專案 skill 的命名與成對**:判為 project 的 `.claude/skills/<名稱>/`、`.agents/skills/<名稱>/` 名稱須以 `<slug>-` 開頭,且兩邊成對;專案 `skills-lock.json` 登記的外部 skill 不檢查。

verify 不涵蓋的仍由人執行並記在 PR:混合路徑以 `inspect --from <新底座 commit> --to HEAD` 的 `mixed` 清單逐段核對,底座段落與新底座一致、只剩專案段落;seed 所有權轉移時,已部署環境的模組與權限資料不重複、不遺失(見[發布前環境與資料核對](#發布前環境與資料核對));Figma 在專案 Screens 跑稽核腳本,本地草稿元件、指向本地草稿的實例與標示本輪草稿的節點皆為 0;專案與底座 CI 全綠。

升級 PR 記錄底座來源、tag、完整 commit、專案保留項與驗收結果。首次接軌須確認中性化沒有帶走引用專案的品牌、業務與設定;相對原 main 的程式差異只包含明列的共用修正。資料轉換依既有 migration/update,不以 reset 代替升級。底座 tag 以獨立 upstream ref 保存,不覆蓋引用專案自己的同名 tag。

PR 另列新增能力、客製治理頁與 API/權限的相容性,以及 wildcard 對種子模板、既有租戶副本、個別角色的不同影響。Figma Library 接受與品牌補套屬同次驗收;沒有來源/scope 變更時沿用有效證據,不重跑首次全量搬遷。agent 完成整合、更新採用記錄並檢查 Base ancestry 後,使用既有 gh 開 draft PR;同 head 已有 PR 就更新它,由使用者審查接受與發布。

### 共用改良回收

先用 `node scripts/base-sync/run.mjs inspect --project <專案路徑> --from <基準commit> --to <目標commit>` 看完整差異與維護歸屬。共用路徑只是候選,仍須檢查是否含品牌、業務耦合、資料假設或客製行為,不等於已同意回收。

選定後整理成只有共用改良的單一 commit,再執行 `node scripts/base-sync/run.mjs contribute --project <專案路徑> --commit <完整SHA> --base <底座路徑> --worktree-root <工作樹父目錄>`。工具以該 commit 的唯一 parent 為差異基準,從底座最新 `origin/main` 建 contribution 分支;含專案、未知路徑、已發布 migration/seed 快照或 merge commit 時先停止。不能把整個專案歷史 merge 回底座,也不能改寫已發布 migration/seed 快照。

路徑分類的正本是 `scripts/base-sync/classify.mjs`(project / mixed / common / published-data / unknown)。專案內容一律放所在目錄的 `project/` 子目錄,分類規則因此只看路徑:程式 `apps/<app>/src/**/project/`、共用純邏輯 `packages/domain/src/project/`、後台文案 `packages/i18n/messages/<locale>/project/`、E2E 資產 `apps/e2e/fixtures/project/`、文件 `docs/<目錄>/project/` 與 `docs/project/`(入口 [docs/project/README.md](project/README.md))、`docs/tmp/`(除底座的 `dis.md`)、`CONTEXT-PROJECT.md`;skill 以名單區分(底座的 `module-scaffold`、`project-bootstrap` 與底座 `skills-lock.json` 的外部 skill 是 common,其餘是專案的,名稱以 slug 開頭)。底座文件(`docs/**` 其餘、`CONTEXT.md`)與固定組裝入口是 common;值行檔、依賴宣告、生成產物、admin / common 語系、workflow 與根目錄設定(`turbo.json`、`.gitignore`、`.prettierignore`、`.dockerignore`、`skills-lock.json`、`.claude/settings.json`)是 mixed。新增 app、頂層目錄或根目錄檔時,同一個 PR 補分類規則與 `classify` 測試(測試另守全 repo 沒有 unknown);沒分類的路徑是 `unknown`,回收一律停止。

混合檔(workflow、語系檔、根目錄設定等)要回收時,agent 先在 commit 裡把它整理成**只含底座段落**,再以 `--accept-mixed <路徑>` 逐檔明列(可重複)。工具只接受明列的混合檔,並把它們的差異列進報告的 `mixedReview`(「混合檔:只含底座段落,請審查」);未明列的混合檔仍拒絕,明列的檔不在差異內、實際不是混合檔或是二進位檔也報錯(二進位無法逐段審查,須拆出人工處理)。審查時逐段確認這些差異沒有專案值。

規格與 Figma 工作檔一律放進實作的 repo,不留在 repo 外:規格放 `docs/tmp/spec-<主題>.md`,Figma 重建腳本、稽核腳本與節點表放 `docs/tmp/figma-<主題>/`。從最新 `origin/main` 開 `feat/<主題>-spec` 分支 → commit → push 分支備份 → 依畫面修規格都在這條分支更新 → 定稿後 PR 走 dev → staging → main;實作的整合分支從合併後的 main 開出。`docs/tmp/` 除底座的 `dis.md` 外都判 project,不隨 contribute 回到底座;底座要的內容在回收前寫進正式文件。該輪完工後規格與工作檔從 `docs/tmp/` 移除:底座元件與畫面的節點表搬進 [FIGMA-09](standards/general/figma.md),專案 Screens 的節點搬進[專案節點表](project/figma-nodes.md),做法寫進正式文件。

agent 核對 exact diff、處理相容性並測試後,沿現有 PR 流程交底座審查。PR 記錄來源 repo/commit、通用性與驗證,以及 `--accept-mixed` 明列的混合檔;接受回收不等於立即同步,須等納入底座正式 tag/Release,再向下升級。

### 發布前環境與資料核對

在乾淨、等於欲發布完整 SHA 的 checkout 執行:

```bash
node scripts/project-settings/preflight.mjs --environment <dev|staging|production> --target <完整SHA>
```

初次雲端部署也要執行,每個環境各核對一次。新建空環境還沒有 Cloud Run 服務及資料更新基準時,`CLOUD_STATUS_UNAVAILABLE`、`DATA_BASELINE_MISSING` 可是預期結果;先確認服務與資料庫確實尚未初始化、記錄原因,並處理其他 issues,不能把所有 preflight 錯誤一概略過。首次 Deploy 完成後再核對 revision、資料更新與 smoke。

preflight 要求工作目錄乾淨且 HEAD 等於 `--target`。若日常 checkout 有未追蹤工具檔,另用短路徑的 detached worktree 檢查完整 commit,不清掉原目錄的檔案。資料狀態讀取器會從同一 checkout 的 `apps/db-migrator` 解析 `tsx`,所以檢查工作樹須 `pnpm install --frozen-lockfile`；不需執行整個 repo build。Windows 建立工作樹前可在本 repo 設 `git config core.longpaths true`,工作樹路徑也要短,避免 `node_modules` 長路徑;移除時若檔案仍被程序使用,先關閉持有檔案的程序再處理,不要強制清掉原工作樹。跨工具本機狀態 `.codex/` 已排除追蹤,外部 skill 的 Claude 連結由還原指令建立;仍須檢查 `git status --short` 的實際結果。

讀取器沿既有 `deploy/project` 設定、gcloud 登入與 DB 存取,分別讀 API/admin 真正承接流量的 revisions。Cloud Run 的 digest 由 Artifact Registry 相同 image/digest 的 tag 對回 Git。新 tag 含完整 commit、環境與執行識別;舊版短 SHA 仍須在此 repo 唯一解析。混合流量保留每個基準,無法解析或多個不同 commit 明列未核對。

報告包含各基準到目標的全部累積差異,以及同 checkout 的 migrator JSON 狀態。API image 版本不是 DB 設定版本;資料更新可能在沒有部署 API 時執行,也可能部分失敗。agent 必須連同最後成功更新、後續嘗試、changelog、pending/open migration、未完成定義安裝與鎖閱讀,再列資料修改/刪除範圍、恢復限制與待人員判斷事項,不能只看本次 PR。

exit 0 只表示報告已生成,**不是部署核准**。報告的 issues 仍可能包含存取不足、無成功資料基準、來源不符、未完成資料更新或未知版本。先解讀這些結果,再按 release SOP 與實際授權部署;不以空資料或歷史成功代替目前狀態,不以 reset 取代升級。Secret 值不寫入報告或版控。

### CI(ci.yml)

所有 PR 與 push 到 `main` / `dev` / `staging` 自動跑。`paths-ignore` 是 `docs/**`、根目錄 `*.md`、`.claude/**`、`.agents/**`:只改這些路徑時 ci.yml 不跑。`docs.yml` 的 `paths` 只有 `docs/**`、`*.md`、`**/*.md`,改到任何 md 就跑同一個 `format:check`。兩者合起來:

- 只改 `docs/**` 或 md → 只跑 `docs.yml`。
- 只改 `.claude/**`、`.agents/**` 裡的非 md 檔(settings、hook 腳本、skill 附檔)→ **兩支都不跑**,prettier 要自己在本機跑。
- `apps/admin/src/md/**` 的 help.md 會被 build 進 admin,不在忽略清單內 → 兩支都跑。

**job 圖**:拆成多個 job,各佔一台 runner 並行,牆鐘最短優先。

```
project-settings               專案設定、發布前核對與底座同步 CLI 測試 + 三環境解析(每次都跑)
figma-sync                     建置 UI / project-config + Figma 同步離線測試(每次都跑,不碰 Figma)
prepare ─┬─ format-codegen     prettier --check(每次都跑)+ codegen 產物與 schema 一致(GQL-05)
         ├─ lint-typecheck     turbo run lint check-types
         ├─ test-api-1 / 2 / 3 api 的 jest 以 --shard=1/3、2/3、3/3 分三片,各自由 jest globalSetup 起單一成員 replica set
         ├─ test-admin-1 / 2   admin 的 jest 分兩片(先 turbo build admin 的依賴)
         ├─ test-others        api / admin 以外的 turbo run test(domain / ui / i18n / logger / db-migrator …)
         └─ build              turbo run build(front 受影響時先 build 並啟動 api,給 ISR 預渲染打;Mongo 以 docker run 起單一成員 replica set)
以上全部 ─→ verify             總結:任一 job failure / cancelled 就紅,skipped 算過
```

- **PR 的必要檢查只看 `verify`**;紅的時候看是哪一個 job 紅,job 名稱就是壞的類別。
- **受影響過濾**:`prepare` 用 `turbo ls --affected` 算出「改到的 package + 依賴它們的 package」,轉成 `--filter=<pkg>` 清單交給下游 job。api / admin 不在清單就跳過各自的 shard(api 三片、admin 兩片);清單空就跳過 lint / test / build。改到 `.github/**` 或拿不到 base(首推、force push)時退回全跑。codegen 一致性檢查只在 api 或 `@repo/graphql` 受影響時跑;prettier 不看清單,每次都跑。
- **turbo 快取**:`.turbo/cache` 用 `actions/cache` 在 run 之間保存,每個跑 turbo 的 job 各一把 key(lockfile hash + job 名 + commit),找不到時退回同 lockfile 的最近一份;沒改到的 package 的 lint / typecheck / build 直接 `cache hit`。存回前刪掉 7 天前的項目,快取才不會無限長大;lockfile 一變就從頭累積。api 的 shard 不走 turbo(jest 直接吃 `@repo/domain` 原始碼),沒有快取。
- **本機重現某一片**:api 是 `pnpm --filter @repo/api exec jest --shard=1/3`;admin 是 `pnpm --filter @repo/admin exec node --experimental-vm-modules node_modules/jest/bin/jest.js --shard=1/2`(要先有依賴的 dist)。不能寫成 `pnpm run test -- --shard=1/2`,參數會被 jest 當成路徑 pattern。
- **跨程序建置依賴**:api 有變時也驗 db-migrator;它的測試透過 Turbo 先建置同一 checkout 的 API CLI 與依賴。migration 與種子快照的不可變檢查在 `prepare` 對照 Git 基線執行。
- **Figma 同步**:`figma-sync` 獨立於 `prepare`,先建置 `@repo/ui` 與 `@repo/project-config`,再跑本機外掛與舊工具的離線測試(`scripts/figma-local/*.test.mjs`、`scripts/figma-sync/*.test.mjs`);結果納入 `verify`。CI 不讀 Figma token、不操作設計檔;離線通過不代表 Library 已發布或專案已接受更新。實際操作見 [toolbox](agents/toolbox.md#figma-品牌同步)。
- **逾時**:`prepare` 10 分、`project-settings` / `verify` 5 分、`figma-sync` 15 分、`test-others` 30 分,其餘 20 分。
- `build` job 起 api 時給假的 `JWT_SECRET`(api 缺它就啟動失敗)。
- **MongoDB 一律是 replica set**(交易需要,ADR-0013):api / db-migrator 的測試由 jest globalSetup 起單一成員 `MongoMemoryReplSet`;`build` job 以 `docker run mongo:<版本> --replSet` 起並等到選出 PRIMARY。GitHub 的 service container 不能帶啟動參數,所以不用它。mongod 二進位以 `actions/cache` 快取 `~/.cache/mongodb-binaries`(key 跟 lockfile)。
- **`build` job 的 MongoDB 容器**:容器沒起來(一啟動就退出,或 90 秒內沒選出 PRIMARY)時,該步驟印出 `docker inspect` 的狀態與退出碼(`status` / `exitCode` / `oomKilled` / `error`)和 `docker logs mongo`(收在「mongo 容器狀態與 logs」群組),先 `docker rm -f mongo` 再重起,最多 3 次;3 次都失敗才紅。查原因時展開各次的群組。
- **MongoDB 版本**:CI 的 `build` job(`ci.yml` 的 `MONGO_IMAGE`)與本機 `docker-compose.yml` 用同一個固定 patch 版本的 `mongo` image(目前 `mongo:8.3.13`),升級時兩處一起改。jest 測試的 `MongoMemoryReplSet` 用 mongodb-memory-server 內建的預設 mongod 版本(`mongodb-memory-server@11.2.0` 為 8.2.6),跟著 lockfile 升級,與上述 image 不同步;兩者同屬 8.x,但小版本可能不同(8.3 對 8.2)。
- **Linux 核心 6.19 與 MongoDB 8.x 不相容**(SERVER-121912,mongod 啟動即退出):`ci.yml`、`e2e.yml` 在 workflow 層設 `GLIBC_TUNABLES=glibc.pthread.rseq=1`(docker 的 mongo 以 `-e` 傳入;`turbo.json` 的 `globalPassThroughEnv` 讓 turbo 跑的測試拿得到)。這是緊急繞過,不是修正;runner 核心 ≥ 7.0.14 或 MongoDB 出修正版後拿掉。

### CD(deploy.yml)

**只能手動觸發,merge 不會自動部署。**

- UI:Actions → Deploy → Run workflow →「Use workflow from」選分支 + environment 選環境。
- CLI:`gh workflow run Deploy --ref dev -f environment=dev`(staging 同理;production 的 ref 是 `main`)。
- **防呆**:分支與環境不對應直接失敗(dev ← `dev`、staging ← `staging`、production ← `main`)。
- **部署目標讀專案設定**:checkout 之後、雲端認證之前,先以讀取器解析 `deploy/project/*.json` 並核對 repo 身分;不符或缺值就停在這一步(見下方「專案部署設定」)。
- **只部署改到的 app**:讀 Cloud Run 上目前跑的 image tag 前段 Git SHA 當 base,`turbo ls --affected` 判斷 api / admin / db-migrator 有沒有受影響,沒受影響的步驟整個跳過。turbo 看不到的部署設定另外判斷(`scripts/project-settings/deploy-affected.mjs`):`deploy/project/` 或 `scripts/project-settings/` 有改時 api 與 admin 都重建(API 網址烘在 admin image,只改網址也要重建);`deploy/env/` 或 `deploy.yml` 本身有改時只有 api 視為受影響。判斷結果印在 run 的 notice。要全部重部署加 `-f force=true`;讀不到 tag(第一次部署)或 base 不在歷史裡(force push 過)時自動全部部署。
- **image**:tag = `<完整 Git SHA>-<環境>-<Actions run ID>-<attempt>`,每次 build 使用新 tag,不會移走其他環境或先前重跑所用 digest 的 tag。admin 的 `VITE_GRAPHQL_ENDPOINT` 由設定的 `apiUrl` 加 `/graphql`,以 `--build-arg` 烘入。舊版短 SHA tag 可由 preflight 解析,但已因重建失去 tag 的舊 digest 仍須人工查證,不可視為已核對。
- **api 的環境變數**:非機密整包來自 `deploy/env/<環境>.yaml`(`--env-vars-file`),機密來自 Secret Manager(`--set-secrets`);見[四、環境變數管理](#四環境變數管理)。
- **部署成功後執行一次 `update`**:api 或 db-migrator 任一受影響就執行,只改專案 seed、快照或 migration 也會更新資料。runner 安裝 db-migrator、API 與其依賴,建置同一 checkout 的 API CLI 並確認可啟動,再讀該環境的資料庫與 root 初始密碼 Secret,執行 `pnpm --filter @repo/db-migrator run update`。完整順序、結果與失敗處理見下方「設定與資料更新」。
- **即時通道(Cloudflare Worker)**:`cloud.json` 該環境寫了 `realtime` 才部署,而且每次都部署(Worker 沒有可比對的 image tag;`wrangler deploy` 冪等、免費方案不計次)。從 Secret Manager 讀兩把密鑰,以 `wrangler deploy --name <Worker> --secrets-file` 隨這一版上傳成 Wrangler secret;api 同時掛同兩把。見四、「即時通道」。
- **front 不走 deploy.yml**:Vercel 在分支 push 時自動建置(`main` → production、`staging` / `dev` → 各自的分支網域);要不靠 commit 重建用 Deploy Hook(見四、「Vercel 補充設定」)。

### 專案部署設定(deploy/project)

deploy / reset 的雲端目標與看板識別不寫在 workflow 裡,正本是兩份 JSON;workflow 只負責讀取、驗證與接線。換成另一個專案時改這兩份檔,不改 workflow。

| 檔案                         | 內容                                                                                                                                                                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/project/github.json` | `expectedRepository`(owner/repo 的唯一正本)、`projectStatus`(看板是否啟用、project 與 Status 欄位的 ID、十個狀態選項的 ID)                                                                                                                                            |
| `deploy/project/cloud.json`  | `gcp`(專案、區域、Artifact Registry、WIF provider、部署用 service account)、`environments.dev / staging / production`(api / admin 服務名、API 網址、seed 帳號與信箱、Secret 名稱;可省略的 `realtime`:Worker 名稱、Cloudflare 帳號 id、兩把即時通道密鑰的 Secret 名稱) |

- **只放非機密設定與 Secret「名稱」**;Secret 的值仍在 Secret Manager / GitHub Secrets。api 的非機密執行期變數仍只在 `deploy/env/<環境>.yaml`,不複製到這裡。
- **讀取器**:`scripts/project-settings/config.mjs` 是唯一的讀取 / 驗證模組,CLI 是 `read-config.mjs`,只用 Node 內建模組(不需先 `pnpm install`)。兩個入口:

  ```bash
  node scripts/project-settings/read-config.mjs --scope cloud --environment <dev|staging|production> --repository <owner/repo>
  node scripts/project-settings/read-config.mjs --scope github --repository <owner/repo>
  ```

  cloud scope 讀兩份 JSON;github scope 只讀 `github.json`,不需要 cloud 設定或部署環境。看板停用時不要求看板 IDs/options,仍須通過 repo 身分檢查。

  成功時 stdout 是一行 JSON(啟用時為固定的設定鍵,停用時為 `{"enabled":false}`),失敗時 stdout 無輸出、stderr 一行說明、退出碼非零。在 repo 根執行;本機想看某環境會解析出什麼就直接跑。

- **雲端尚未啟用**:`cloud.json` 使用 `{"schemaVersion":1,"enabled":false}`,只能有這兩個欄位,不能留下來源專案的 gcp/environments。讀取器仍驗 repository 與環境,CI dry-run 可成功;Deploy/Reset 的 output writer 會以「雲端尚未啟用」在認證前停止,不寫任何 step output。啟用時填完整三環境設定,`enabled` 省略或設為 `true` 都走同一套嚴格驗證。此開關不改變已配置專案的 production reset 確認規則。

- **驗證**:`schemaVersion` 不認得、`--repository` 與 `expectedRepository` 不同、環境不是三個之一、缺欄位或多出未知欄位、值的格式不對或含控制字元,一律失敗,不回退任何預設值。workflow 傳入的 repository 取自 GitHub 的 context,所以把 repo 複製成另一個專案後,沒改設定就跑不到原專案的資源:deploy / reset 在雲端認證前停止,看板在任何寫入前停止。
- **傳值方式**:workflow 把讀取器的輸出映射成固定的 step 輸出(`write-github-output.mjs`),再經各 step 的 `env:` 以 `"$VAR"` 傳給命令;設定值不內插進 `run` 的程式文本。
- **改這些檔的後果**:部署時 api 與 admin 都會重建(見上方「只部署改到的 app」)。CI 的 `project-settings` job 每次都跑讀取器測試與三環境的解析,不看受影響清單。
- **看板(`project-status.yml`)只讀預設分支上的設定與腳本**:PR 事件也不讀 PR 分支的內容,所以看板設定或腳本的改動要 release 到 `main` 之後才生效。設定無效或 fork PR 拿不到 token 時明確失敗、不移卡,由主流程依 `docs/agents/issue-tracker.md`「手動移卡」處理。`projectStatus.enabled` 設為 `false` 就完全不呼叫看板 API,也不需要 token。
- **設定檔寫好不等於外部資源存在**:WIF、IAM、網域、Secret、看板都要另外建立並驗證(`docs/project-initialization.md`)。

正本:`deploy/project/cloud.json`、`deploy/project/github.json`、`scripts/project-settings/`(讀取器與測試)

### 其他 workflow

| workflow                                           | 觸發                                             | 做什麼                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reset DB**(`reset-db.yml`)                       | 只能手動;三環境皆須明確確認                      | 資料庫還原(`data` / `full`);操作見三、「資料庫還原」,規則正本是 ADR-0002「還原(reset)」                                                                             |
| **Demo**(`demo.yml`)                               | 只能手動;三環境皆須明確確認                      | 建立 / 補齊示範機構(`create`;`purge` / `rebuild` 尚未提供);操作見三、「示範資料(demo)」                                                                             |
| **E2E**(`e2e.yml`)                                 | 只能手動,不在 ci.yml 內                          | 權限劇本 E2E(`gh workflow run e2e.yml --ref <分支>`,可加 `-f grep="劇本 7"`);資料庫由 harness 自起單一成員 replica set(拋棄式),不碰任何環境與 Secret;時機見 TEST-05 |
| **Docs**(`docs.yml`)                               | PR 與三分支 push,只在改到 `docs/**` 或任何 md 時 | `pnpm run format:check`                                                                                                                                             |
| **Project Status**(`project-status.yml`)           | issue / PR 事件                                  | 自動移看板卡,規則見 `docs/agents/issue-tracker.md`「看板」                                                                                                          |
| **Print Agent Release**(`print-agent-release.yml`) | 只能手動;production 只能從 `main`                | 列印代理程式四平台建置 → 上傳該環境私有 bucket `print-agent/<版本>/` → 更新 `manifest.json`、保留 3 版;見四、「列印代理程式發布」                                   |

### Release 步驟

雲端啟用的引用專案依下列步驟部署及驗收。底座或明確停用雲端的專案,仍走逐票 dev / staging PR 與同批 main release,但以 CI、本機應用與資料驗收代替未啟用的部署,在 PR 清楚記錄。停用的 Deploy 不算部署成功。底座程式發布另建立不可移動的 annotated tag 與 GitHub Release,記錄完整 commit;引用專案從該版本初始化或升級。

涉及 Figma 的正式版本,Git Release 與 Library 發布描述互相指向,記錄完整 commit、fileKey、可核對的 Figma 版本連結、變更資產與實際接受範圍。資產身分見[品牌註冊表](branding.md),實際操作結果記在初始化或升級 PR,新流程不產生 receipt 或另建發布帳本。component key 是來源身分,不是版本鎖;發布內容再變時須重核實際狀態,不能以 Git tag 單獨證明已接受或可回退任意歷史 Library。

**release 一批一次**:同一批票各自 PR 合進 `dev`、各自 PR 合進 `staging`,累積成一批之後才走一次 release(一個 `staging → main` 的 PR + 一次 production 部署)。`dev` 的部署也等該批最後一張合完才觸發,不要一張一部署。例外只有**產物依賴**:後面的票要拿前面的票已上線的產物才做得下去時,前面那張單獨先 release。

每個環境部署前先依[發布前核對](#發布前環境與資料核對)讀取該環境到欲部署 commit 的累積差異與資料風險。每次照這五步(票的看板狀態見 `docs/agents/issue-tracker.md`):

1. dev 的 CI 綠 → 要上線的 feat 分支**逐一** PR 合進 `staging`(PR 內文帶 `Refs #<票號>`,看板自動化才找得到票)。這批就是 `dev` 上的全部時,合完 `git diff --stat origin/dev origin/staging` 應為空。
2. `gh workflow run Deploy --ref staging -f environment=staging` → 對 `api-staging` 打一個 smoke(例:登入 mutation 帶錯帳密,回 `INVALID_CREDENTIALS`)。
3. PR `staging → main`、合併 → `gh workflow run Deploy --ref main -f environment=production` → 同樣 smoke。
4. **release PR 一合進 `main`,立刻把 `dev` 與 `staging` reset 到 `main`(force push)**。本點是全 repo 的正本:其他文件提到分支對齊時一律指回這裡,CLAUDE.md 只留一行摘要,不一致時以本點為準。由主流程做;它也是 `dev` 被汙染時的救援手段。**對齊只有 reset 這一種做法**:不把 `main` merge 回 `dev` / `staging`,也不用空合併,那只會讓兩條線各自長出 merge commit、歷史繼續分岔。先做前置檢查再推:

   ```
   git fetch origin
   git diff --stat origin/main origin/dev
   git diff --stat origin/main origin/staging
   gh pr list --base dev --state open
   git push --force origin origin/main:refs/heads/dev
   git push --force origin origin/main:refs/heads/staging
   ```

   兩個 `git diff --stat` 為**空**,代表該批已全部進 `main`、reset 不會丟東西。`dev` 的 diff 不空時,對照 `gh pr list` 與 diff 內容,確認多出來的只是「已合進 `dev` 但不在這批 release 裡」的 feat:是的話**照樣 reset**,reset 後替那些 feat 重新開 PR 合進 `dev`(原 PR 已是 merged,不能再 merge);有說不出來源的差異就先停下來查,不要推。reset 之後,從 `main` 切出來的分支對 `dev` / `staging` 都只剩一個 merge base。它不需要切分支,也不動本地工作目錄。

5. 關票(`gh issue close <n> --comment "<release PR>"`)→ 自動化移到 Released;刪已合併的遠端分支;進行中的 feat 分支 rebase 到最新 `main`。

### 交叉 merge base

feat 一律從 `main` 切,而 `dev` / `staging` 各自往前走一條線;同一批票在兩條線上各合一次之後,新的 PR 就可能有兩個 merge base(`dev` 與 `staging` 都會發生)。

- **徵兆**:GitHub 顯示 `CONFLICTING`,但本地 `git merge-tree --write-tree origin/<base> <feat>` 乾淨。
- **後果**:GitHub 不建 merge ref ⇒ 這張 PR 一個 Actions run 都不會跑,CI 沒結果、`project-status.yml` 也不會移卡(看板停在原格不是自動化壞了)。
- **處理**:主流程照 Release 步驟第 4 點把該 base reset 到 `main`(reset 後 base 與 `main` 是同一個 commit,交叉 merge base 直接消失;base 上有未 release 的 feat 就 reset 後再合回去),**接著把 PR close → reopen** 才會重跑 CI(base 更新本身不觸發 `pull_request` 事件)。實作者不自己改 `dev` / `staging`。

### 建置產物的規則

- **Docker build context 排除 `.md`,但 admin 的 help.md 是程式資產**:根目錄 `.dockerignore` 有 `**/*.md`(文件不進 image),而 `apps/admin/src/md/module-help/**/*.help.md` 是 Vite 在 build 時以 `import.meta.glob` 內嵌進 bundle 的程式資產。被排除時本機 `pnpm build` 照樣正常,CI 建出來的 image 卻讓每頁的「?」全部 disabled,而且沒有任何一步會失敗。例外寫在 `.dockerignore`(`!apps/admin/src/md/**/*.md`,必須排在 `**/*.md` 之後才生效);防回歸檢查在 `apps/admin/Dockerfile` 的 builder stage:build 之後 `RUN pnpm --filter @repo/admin check:help-bundle`(腳本 `apps/admin/scripts/check-help-bundle.mjs`,比對每份說明的內容是否出現在 `dist/assets/*.js`;掃不到說明檔也算失敗)。**再有這類「跟著 build 烘進產物的非程式檔」**(i18n 字典、範本、憑證…),一律同時做兩件事:在 `.dockerignore` 補例外 + 在 Dockerfile 加一條驗產物的檢查。
- **admin 的靜態檔快取:`index.html` = `no-cache`、`/assets/` = `immutable` 一年**(`apps/admin/nginx.conf`)。`index.html` 是唯一指向「這次部署的 bundle 檔名」的入口,一旦被快取,部署後重新整理仍會載入上一版 HTML 與它指向的 `assets/index-<hash>.js`;`/assets/` 底下的檔名帶 content hash,內容一變檔名就變,可以永久快取。`no-cache` 是「每次都先向伺服器驗證」(ETag 命中回 304,只花一個 round trip),所以**部署後使用者正常重新整理就拿到新版**,不需要 Ctrl+F5。沒有這個標頭時瀏覽器會依 `Last-Modified` 自行推算效期,就會出現「部署成功但畫面沒變」。nginx 的 `add_header` 不會繼承到自己也有 `add_header` 的子 block,所以 `location /`(SPA fallback)與 `location = /index.html`(`try_files` 的內部轉址會重新比對 location)各寫一份。改了 `nginx.conf` 之後,驗收方式是 `curl -I https://erp-<環境>.project.example.invalid/` 看 `Cache-Control`。
- **已開著的舊分頁:偵測到新版本就提示重新整理**(`apps/admin/scripts/app-version-plugin.mjs`、`src/hooks/base/useAppUpdateNotice.ts`)。`no-cache` 只管「重新整理後拿到新版」,沒重新整理的分頁(含安裝成 app 的視窗)仍跑舊 bundle,打到新 api 會 `GRAPHQL_VALIDATION_FAILED`。build 時把版本(deploy.yml 以 `--build-arg APP_VERSION=$GITHUB_SHA` 傳入;本機 build 沒傳就用 build 時間)烘進 bundle,並輸出同值的 `/version.json`;nginx 對它 `no-cache`(同 `index.html`,不可搬進 `/assets/`)。分頁回到前景、或換路由且距上次檢查滿 1 分鐘時抓它,不同就跳資訊色「系統已更新」+ [重新整理](不自動消失);lazy chunk 載入失敗(`vite:preloadError`)與 api 回 `GRAPHQL_VALIDATION_FAILED` 不比版本、直接提示。不定時輪詢、沒有 service worker;`vite dev` 與 mock 模式不提示。Dockerfile 在 build 後 `test -s apps/admin/dist/version.json` 防外掛被拔掉。驗收:`curl -I https://<admin 網址>/version.json` 看 `Cache-Control: no-cache`,內容的 `version` 等於部署的 SHA。
- **admin 可安裝成 app,但不做離線**(`apps/admin/src/lib/base/web-app-manifest.ts`,值在專案設定 `admin.webApp`;null = 不提供):build 輸出 `manifest.webmanifest` 並在 `index.html` 加 manifest / `theme-color` / `apple-touch-icon`;起始頁是登入頁(已登入會被導回首頁),`id` 固定為 `/`、與起始頁脫鉤,之後改起始頁不會變成另一個 app。**沒有 service worker**:依 [Chrome 的安裝條件公告](https://developer.chrome.com/blog/update-install-criteria),Chrome 桌面 112 / Android 108 起從選單安裝不再要求 service worker;[Edge 文件](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/)也寫 service worker 是選配(本專案以 Chromium 153 / Edge 155 實測可安裝、無安裝錯誤)。所以頁面一律走網路,部署後重新整理就是新版,沒有「卡在舊版」這回事;代價是 Chrome 的自動安裝提示可能不出現(同一篇公告:提示仍以 fetch handler 為條件之一),使用者從選單或網址列安裝。manifest 與 `public/` 的圖示檔名固定、不帶 hash,nginx 對它們與 `index.html` 一樣給 `no-cache`(manifest 另指定 `application/manifest+json`,nginx 內建對照表沒有),不可搬進 `/assets/`。**已安裝的 app 換名稱 / 圖示**(以下依官方文件,未實測,版本行為以瀏覽器實際為準):Chrome / Edge 桌面在 app 開啟時檢查 manifest(24 小時最多一次),其餘欄位關掉所有視窗後自動套用([web.dev](https://web.dev/articles/manifest-updates));Chrome 144 起名稱與圖示要使用者從選單「Review app update」確認,圖示差異小於 10% 自動套用([Chrome 部落格](https://developer.chrome.com/blog/improvements-to-web-app-updates));Android 在關閉 app、充電且連 Wi-Fi 時重產 WebAPK,一般一兩天內([web.dev](https://web.dev/articles/manifest-updates))。iOS 找不到 Apple / WebKit 的官方說明、也未實機測試;一般經驗是主畫面的名稱與圖示在加入時就固定,要刪掉重新加入。manifest 網址與 `id` 不可改,否則已安裝的 app 收不到更新。驗收:`curl -I https://<admin 網址>/manifest.webmanifest` 看 `Content-Type` 與 `Cache-Control`,Chrome DevTools「Application → Manifest」無錯誤。
- **改了 `.dockerignore` / Dockerfile 之後要用 `-f force=true` 部署**:這兩個檔不屬於任何 package,`turbo ls --affected` 看不到,不加 force 會整個 build 步驟被跳過。
- **新增「會被烘進前端產物」的環境變數時,同步登記進該 package `turbo.json` 的 `tasks.build.env`**(規則正本 STRUCT-08):`VITE_*` / `NEXT_PUBLIC_*` 是 build 的輸入,沒登記就不在 build 的快取鍵裡,換一個值重 build 會直接 `cache hit`,部署出去的 image 裡烘的還是前一個值,而且沒有任何一步會失敗。admin 每環境各建一顆 image,正是最容易吃到這個坑的形狀。三處一起動:`turbo.json` 的 `env`、`docs/env-registry.md`、該環境的 build 參數(deploy.yml 的 `--build-arg` 或 Vercel dashboard)。
- **Vercel 的 `Deployment rate limited` 是帳號層級的額度**:front 在免費方案上短時間內推太多次就會碰到,等額度回復再推即可,不要為此改 workflow 或重試設定;它不影響 api / admin 的 Cloud Run 部署。

### 認證與回滾

- **認證**:Workload Identity Federation,OIDC 短期憑證換 `cloud.json` 登記的部署 service account 身分,repo 裡零 GCP 金鑰,provider 限定本 repo。
- **回滾**:`gcloud run services update-traffic <api-service> --project=<gcp-project> --region=<region> --to-revisions=<先前的 revision>=100`,或從先前的 commit 觸發部署。

正本:`.github/workflows/ci.yml`、`.github/workflows/deploy.yml`、`.github/workflows/reset-db.yml`、`.github/workflows/e2e.yml`、`.github/workflows/docs.yml`、`.github/workflows/project-status.yml`、`.dockerignore`、`apps/admin/Dockerfile`、`apps/admin/scripts/check-help-bundle.mjs`、`apps/admin/nginx.conf`

## 三、手動操作(維運速查)

### 本地容器

```bash
docker compose up -d                  # 日常開發:只起 MongoDB
docker compose --profile full up -d   # 部署前驗證:mongo + api + admin 整套容器
```

本機 mongo 是單一成員 replica set(api 的交易需要,ADR-0013),名稱 = Compose 專案名(`COMPOSE_PROJECT_NAME`,不設 = 資料夾名稱)。第一次起來由 healthcheck 初始化,選出 PRIMARY 才算健康(`docker compose ps` 顯示 `healthy`)。連線字串固定帶 `?directConnection=true&replicaSet=<專案名>`:成員位址登記為容器內的 `localhost:27017`,直接連才不受主機埠影響;`replicaSet` 讓連錯專案的 mongo 直接失敗。

**從單節點升級**(之前起過舊版 compose 的本機環境):

1. `docker compose up -d`:設定變了,Compose 會重建 `mongo` 容器;`mongo-data` volume 保留,資料都在。
2. 等 `docker compose ps` 顯示 `healthy`(第一次會執行 `rs.initiate`)。
3. `apps/api/.env` 的 `MONGODB_URI` 補上 `?directConnection=true&replicaSet=<專案名>`(範本見 `apps/api/.env.example`),重啟 api。沒補時交易會失敗,主機埠不是 27017 時還會連到別的容器。

正本:`docker-compose.yml`

### 手動部署(CD 掛掉時的備援;平常交給 deploy.yml)

**照 `.github/workflows/deploy.yml` 的「deploy api」步驟打,不要憑記憶**:`gcloud run deploy` 必須同時帶 `--env-vars-file=deploy/env/<環境>.yaml`(非機密變數,整包取代)與完整的 `--set-secrets=MONGODB_URI=…,FIELD_ENCRYPTION_KEY=…,JWT_SECRET=…,RESEND_API_KEY=…`(服務名、registry 與 secret 名稱以 `node scripts/project-settings/read-config.mjs --scope cloud --environment <環境> --repository <owner/repo>` 的輸出為準)。`--set-secrets` 是整組取代,少列一個就等於把那個 secret 從服務拿掉。build / push 的部分:

```bash
ENVIRONMENT=<dev|staging|production> # 換成此次手動部署的環境
IMAGE_TAG="$(git rev-parse HEAD)-$ENVIRONMENT-$(date +%s)-1"
REG="<讀取器輸出的registry>"
docker build -f apps/api/Dockerfile -t "$REG/api:$IMAGE_TAG" . && docker push "$REG/api:$IMAGE_TAG"
# 接著複製 deploy.yml「deploy api」步驟裡的 gcloud run deploy 指令,把 $VAR 換成讀取器輸出的該環境值
```

正本:`.github/workflows/deploy.yml`(deploy api / deploy admin 步驟)、`deploy/project/cloud.json`、`apps/api/Dockerfile`、`apps/admin/Dockerfile`

### 設定與資料更新

`update` 是完整更新入口:`migration` → 普通種子 → 受管表單/流程 → 目標核對。`seed` 與 `migrate` 是同一入口的相容別名,一次操作只選一個,不再依序各跑一次。來源與資料轉換契約見[種子資料與遷移](concepts/data-layer-and-isolation.md#種子資料與遷移)。

本機操作時先 checkout 要交付的 commit,安裝依賴並建置同一份 checkout 的 API CLI。依[環境變數登記](env-registry.md)設定目標 `MONGODB_URI` 與 `ROOT_ADMIN_*`,再執行:

```bash
pnpm exec turbo run build --filter=@repo/api
pnpm --filter @repo/db-migrator run update --check-cli
pnpm --filter @repo/db-migrator run update
```

`run` 不可省略,否則 `pnpm update` 會變成套件管理器的依賴升級命令。設定版本記在 `seed_update_runs.releaseCommit`,執行摘要另列 migration 結果、種子計數、定義 revision 對應的本地版號與核對結果;API image 的 SHA 不能代替設定版本。

執行失敗時先讀錯誤、鎖與未完成階段:

```bash
pnpm --filter @repo/db-migrator run migrate:status
```

機器讀取用 `pnpm --silent --filter @repo/db-migrator run migrate:status --json`,或 `pnpm --silent --filter @repo/db-migrator run update --status --json`;`--silent` 避免 pnpm 的腳本說明混入 JSON。此模式只讀,不能與 down/unlock/reset 等寫入動作混用。輸出區分最近嘗試、最近成功的 update/reset、該基準後或與它重疊的其他執行,以及目前 applied/pending/orphaned/open migration、未完成定義安裝與鎖。沒有成功基準是未知,不是尚無待更新內容;有效完整 SHA 以外的 commit 記為 null。失敗查詢用非零 exit,不以空成功陣列代替。

`sourceCommit` 只在執行來源與 registry 可證明屬於同一乾淨 checkout 時提供完整 HEAD;外部來源、未追蹤檔或未提交修改會使它為 null,不以環境變數猜測。失敗只輸出固定錯誤碼,不回顯原始例外。機器欄位正本是 [UpdateStatusJson](../apps/db-migrator/src/update/status-json.ts)。

JSON 是現有資料的投影,不新增設定格式或版本帳。即使查詢成功,歷史 successful 仍不能證明目前資料完整;須連同後續 failed/down/reset 與現行 plan 解讀。發布前的完整流程見[環境與資料核對](#發布前環境與資料核對)。

正常失敗會釋放鎖,修正原因後以相同來源重跑 `update`,接續原本的 migration context 及定義安裝紀錄。不要改寫已發布快照或以 reset 取代一般升級。若是現場草稿或內容漂移,先確認並處理差異,重跑不會強制覆蓋。

硬中止留下的鎖只在確認原程序與 API 子程序都已停止後,以 status 顯示的 owner 指名解除,再續跑:

```bash
pnpm --filter @repo/db-migrator run update --unlock-owner=<owner>
```

`migrate:down` 經相同互斥與紀錄執行最後一支 migration 的 `down`;有未完成更新或沒有 down 實作時拒絕。它只還原該 migration 的資料變更,不回滾 seed、定義或安裝紀錄。需要下修時先核對該檔的資料前提及相容性,不能把 down 或切回舊 API image 當成整批復原。

若狀態停在 `rollback-in-progress`,以原來源重跑 `pnpm --filter @repo/db-migrator run migrate:down`,先完成該次回滾再執行 update。回滾接續也會核對來源 hash,不可改寫原檔後重跑。

定義發布立即生效,工具互斥不阻擋線上業務寫入。破壞性變更須在發布前備妥相容窗口、必要停寫方式與恢復步驟;API 已部署而 update 失敗時,依該變更的恢復方式處理。

正本:`apps/db-migrator/src/update/`、`apps/api/src/seed/`、`.github/workflows/deploy.yml`。

### 資料庫還原(reset)

reset 依所選程式版本重建資料庫設定。dev、staging、production 都可執行,操作者須確認目標與刪除範圍。兩種模式的刪留規則見[資料層](concepts/data-layer-and-isolation.md#還原),決策理由見 ADR-0002。

| mode   | 結果                                                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| `data` | 保留當前 registry 的種子、受管定義及已發布/已退役歷史,清除未受管設定與業務資料,再執行 update。根組織及模組的初始值保留現值 |
| `full` | 清除全部應用 collection 與索引,保留操作鎖,再執行 update 重建。目前未登記的定義不重建,初始值回到專案宣告                    |

在 Actions → **Reset DB** 選擇執行版本、`environment`、`mode`,並手動填入 `confirmation`:

```text
reset:<environment>:<實際資料庫名>:<data|full>
```

CLI 範例:

```bash
gh workflow run "Reset DB" --ref dev -f environment=dev -f mode=data -f confirmation="reset:dev:project-dev:data"
```

確認字串的環境、資料庫名與模式必須全部符合實際目標。資料庫名從連線目標解析,環境由輸入指定;不靠名稱尾碼猜環境。`RESET_ALLOW_ENV` 必須包含所選環境,未設即拒絕。workflow 原樣傳入人工確認,不從 URI 自動產生;記錄不輸出 URI、帳密或 Secret 值。

本機先依[設定與資料更新](#設定與資料更新)完成 CLI 建置並準備 `ROOT_ADMIN_*`,再執行:

```bash
RESET_ALLOW_ENV=dev MONGODB_URI="mongodb://127.0.0.1:27017/project-dev?directConnection=true&replicaSet=<專案名>" \
  pnpm --filter @repo/db-migrator run reset --environment=dev --mode=data --confirm=reset:dev:project-dev:data
```

- 預檢、清除與 update 共用同一把鎖。data 若遇未完成遷移、回滾或中斷發布,在刪除前停止;先完成原 update、down 或 UI 發布後再重置。
- full 在刪除前確認 API CLI 已建置,重建時透過該 CLI 初始化全部登記 schema 的索引。沒有受管表單或流程也會執行,不需重啟常駐 API。
- data 清除中途失敗後,再次執行 data 會被未完成紀錄擋下。先用同一版來源執行 update 補齊設定,再明確執行 data 完成清除;若改採整庫重建,則重新確認 full。一般 update 不會補做尚未完成的清除。
- full 清除後重建當次執行紀錄;清除或重建失敗會回報階段。檢查 Actions log 與執行狀態後,再次明確確認 full 才重新清庫。硬中止或失敗紀錄也無法寫入時,鎖會保留;確認原程序已停止後,依[設定與資料更新](#設定與資料更新)指名解鎖。
- 只處理資料庫,不部署 Cloud Run、不清除 GCS 物件。流程引擎每次依資料庫讀取版本,重建同 key/版號後不會沿用程序中的舊定義。
- `data` 保留根初始帳號與密碼;`full` 重建帳號,密碼使用該環境 Secret 的當前值。
- job 掛在所選 GitHub environment 下,沿用該環境的審核設定。
- **重建後灌示範資料**(勾選項 `seed_demo`,預設不勾):勾了就在 reset 成功後接著跑 `demo --mode=create`(見下一節)。確認字串不另外輸入:由這次 reset 的確認字串換頭尾得出 `demo:<environment>:<資料庫名>:create`(reset 已核對過資料庫名,workflow 仍不解析 URI),指令端再以 api 回報的資料庫名比對一次。不勾時和以前一樣,只有底座基本資料(最上層組織、租戶管理員、欄位類別)。CLI:再加 `-f seed_demo=true`。`data` 模式保留 root 的現有密碼:與該環境 `root-admin-password*` 的值不同時,灌示範資料會停在 root 登入那一步(reset 本身已完成);先把 root 密碼與 Secret 對齊,再跑 Demo workflow 補上示範資料。

正本:`.github/workflows/reset-db.yml`、`deploy/project/cloud.json`、`apps/db-migrator/src/reset/`、ADR-0002「還原(reset)」。

### 示範資料(demo)

demo 指令在指定環境建立一個標「示範」的機構(租戶頂層)與整套示範資料,給測試與展示用。示範資料是業務資料,不進一般 seed(ADR-0002);內容由專案登記(專案來源 `seeds/project/registry.ts` 匯出 `projectDemoSource`,經固定入口 `seeds/registry.ts` 交給指令;沒有登記的專案執行時直接停下)。dev、staging、production 都可執行,安全規則同 reset。

| mode      | 結果                                                                           |
| --------- | ------------------------------------------------------------------------------ |
| `create`  | 建立 / 補齊示範機構;冪等,重跑只補缺的帳號與資料,不會把已改過的密碼或資料改回去 |
| `purge`   | 清空示範機構(見下方「示範機構清空 / 重建」)                                    |
| `rebuild` | `purge` + `create`                                                             |

**全程走 api**:指令不連資料庫,只呼叫 `--api-url` 那個 api 的 GraphQL,權限照常檢查、操作紀錄照常寫:

1. 以平台管理員(`ROOT_ADMIN_ACCOUNT`,密碼見下)登入,讀 api **自己回報**的資料庫名(`provisionTarget`,根組織專屬、只回資料庫名)並比對確認字串。到這裡還沒有任何寫入
2. 以 `provisionTenant`(`demo: true`)建立示範機構與首任租戶管理員 `<基底信箱>+<別名>@…`(密碼 = 示範密碼,只存雜湊;不寄啟用信、首登不強改)。以**租戶短碼 + 「示範」標記**找回:同短碼且標「示範」的機構就沿用;同短碼卻沒有「示範」標記 → 拒絕,一筆都不寫
3. 以那位首任租戶管理員登入,交給專案的 `populate` 建出其餘內容(內容與步驟見專案的開通文件)

`purge` 只做第 1 步與清空;`rebuild` 在第 1 步之後先讀齊示範密碼與基底信箱(缺值就停在一筆都沒刪的時候),再清空、再做第 2、3 步。

「示範」標記(`orgs.isDemo`)只在開通時設定,之後沒有端點改得了它,真實租戶不會被當成示範機構。

在 Actions → **Demo** 選擇執行版本、`environment`、`mode`,並手動填入 `confirmation`:

```text
demo:<environment>:<實際資料庫名>:<create|purge|rebuild>
```

CLI 範例:

```bash
gh workflow run Demo --ref dev -f environment=dev -f mode=create -f confirmation="demo:dev:project-dev:create"
```

- **確認字串綁實際寫入的資料庫**:環境與模式兩段先比對(還沒呼叫 api);資料庫名段比對的是 api 回報的名稱,所以確認字串正確、`--api-url` 卻指到別的環境時,資料庫名段不符,不執行。打錯一個字就不執行。`DEMO_ALLOW_ENV` 必須包含所選環境,未設即拒絕(workflow 只放這次選的環境)。示範機構名稱固定,不放進確認字串。不需要 `MONGODB_URI`
- **機密**:示範密碼與基底信箱在 Secret Manager `demo-password*`、`demo-email-base*`(與 `root-admin-password*` 同一處,三環境各一把),名稱登記在 `deploy/project/cloud.json` 各環境的 `secrets.demoPassword` / `secrets.demoEmailBase`(可省略;省略的環境跑 Demo 會在認證前停下,Reset DB 勾選灌示範資料時也是)。Secret 由使用者照[新增一個 Secret Manager 機密的標準步驟](#新增一個-secret-manager-機密的標準步驟)在自己的終端機建立,授權讀取者是部署 SA(`gcp.deployServiceAccount`)。workflow 讀出後 `::add-mask::`,經標準輸入以管線交給指令,不放進環境變數
- **root 密碼**:`ROOT_ADMIN_PASSWORD` 有設就用(workflow 由 Secret 帶入);沒設就從標準輸入讀(本機在終端機輸入,不回顯)
- **信箱**:示範帳號的信箱一律由基底信箱加 `+` 別名產生,帳號同信箱;repo 不寫任何真實信箱或密碼。輸出不印信箱(只印別名)
- `--api-url` 必填:該環境的 api origin(workflow 帶 `cloud.json` 的 `apiUrl`)

本機執行:機密都在終端機輸入(依序:平台管理員密碼、示範帳號密碼、基底信箱;不回顯),不放進指令列或環境變數:

```bash
DEMO_ALLOW_ENV=dev ROOT_ADMIN_ACCOUNT=<root 帳號> \
  pnpm --filter @repo/db-migrator demo --environment=dev --mode=create --confirm=demo:dev:project-dev:create --api-url=https://api-dev.example.com
```

- 一般部署與 `update` 不跑示範資料。
- 示範機構的首任租戶管理員密碼若已被改過,`create` 在以他登入那一步停下;由平台管理員重設成示範密碼後重跑。
- 新建的示範帳號照一般使用者規則:首登要改密碼。改過的密碼重跑不會改回去。

#### 示範機構清空 / 重建

`--mode=purge` 以平台管理員呼叫 api 的 `purgeDemoTenant`(根組織專屬,權限 `system.org-manager.tenant-ops.purge-demo`),把示範機構整個抹掉,讓 `rebuild` 從頭建一份乾淨的:

- **只接受標「示範」的機構**:以專案示範資料固定的租戶短碼找根組織底下的租戶頂層。找不到 → 什麼都不做;找到卻沒有「示範」標記 → `FORBIDDEN`,一筆都不刪。確認字串與 `create` 同一套規則(`demo:<environment>:<資料庫名>:purge`,資料庫名段比對 api 回報的名稱)
- **刪除範圍**:所有帶這個租戶 id 的資料,**包括只能新增的帳本**(稽核紀錄、流水、事件;清空 = 當作沒發生過);依組織或使用者歸屬的資料(欄位、客製表單與它的版本、會員、token、個人偏好);租戶頂層與它所有下層組織;它擁有的角色;**只屬於這個機構的使用者**硬刪(同一組帳號之後能重新建立),**也屬於其他組織的使用者只移除**在這個機構的所屬與角色;資料裡引用的檔案(商標、附件等本 API 簽出的物件路徑)在交易提交後刪掉,個別失敗只記 log
- **一個交易**:刪除與稽核 `org.purge-demo`(記在根組織,不在刪除範圍)同一個交易,中途失敗全部回復
- 不刪全平台共用的定義與紀錄(模組、權限、欄位類別、資料範圍設定、受管定義的安裝紀錄、排程紀錄);根組織做的開通紀錄也留著

**刪除範圍用登記制**:資料層登記的每一張 collection 都要宣告刪法 —— 底座的在 `apps/api/src/database/base/tenant-purge.ts`,專案的在 `apps/api/src/project/database/tenant-purge.ts`,規則與驗證在 `apps/api/src/database/tenant-purge.ts`:

| 刪法        | 用在                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------- |
| `tenantId`  | 帶 `tenantId` 欄的表(**一律用這種**,不能改用別的)                                           |
| `match`     | 依欄位歸屬:值是這個租戶的組織、會被刪的使用者,或另一張表這次刪掉的文件(例:表單版本跟著表單) |
| `dedicated` | 只給組織、使用者、角色、核心關聯,由清空服務自己算範圍                                       |
| `keep`      | 不是租戶資料,不刪;要寫理由                                                                  |

會存上傳物件路徑的欄位(寫入端用 `UploadPurpose` / `isOwnedUploadPath` 驗的欄位,例:表單提交的 `values` / `revisions`)在登記加 `files`:刪除前只讀這些欄位(與後面步驟要對的值)找檔案,沒宣告的表不讀;組織的商標由清空服務自己處理。

新增資料表時同 PR 加一筆登記;沒登記、或帶 `tenantId` 卻不是依 `tenantId` 刪,`apps/api/src/database/tenant-purge.test.ts` 的完整性測試就失敗,執行時也會在刪任何東西之前停下。

正本:`.github/workflows/demo.yml`、`.github/workflows/reset-db.yml`(勾選項)、`apps/db-migrator/src/demo/`、`apps/api/src/orgs/demo-tenant-purge.service.ts`、`apps/api/src/database/tenant-purge.ts`;示範資料放專案的 `apps/db-migrator/seeds/project/demo/`(STRUCT-12)。

### 觀測與維運

先核對 cloud.json 的 GCP project、region 與服務名,再查狀態;不依賴本機 gcloud 的預設 project。

```bash
gcloud run services list --project=<gcp-project> --region=<region>
gcloud run revisions list --service=<api-service> --project=<gcp-project> --region=<region>
gcloud secrets versions list <secret-name> --project=<gcp-project>
gcloud beta run domain-mappings describe --domain=<api-domain> --project=<gcp-project> --region=<region>
```

部署後核對新 revision ready、流量分配、實際 image SHA 與設定更新紀錄。資料庫、防火牆、DNS/憑證及寄件網域分別在該專案的服務後台維護。

## 四、環境變數管理

環境變數只有三個家,依「性質」決定放哪。要改某個變數,先問它是哪一種,就知道去哪改:

| 性質                                  | 放哪(真實來源)                                                                                                                      | 進版控?                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **非機密、雲端用**(網址、開關、效期…) | **`deploy/env/<環境>.yaml`**(dev / staging / production 各一檔),deploy.yml 以 `--env-vars-file` 整包餵給 Cloud Run                  | ✅(走 PR,可審)                |
| **機密**(連線字串、金鑰、API key)     | Secret Manager,名稱 `<名稱>-dev` / `-staging` / `<名稱>`(名稱登記在 `deploy/project/cloud.json`);deploy.yml 以 `--set-secrets` 引用 | ❌ 值永不進版控               |
| **本地開發**                          | 各 app 的 `.env`(範本 `.env.example`)                                                                                               | `.env` ❌ / `.env.example` ✅ |

各服務的來源:

| 層               | 真實來源                                                                                                                                                                                          | 進版控?                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Cloud Run(api)   | 上表前兩列(`deploy/env/<環境>.yaml` + Secret Manager)。YAML 是該環境**全部明文變數**的唯一來源:`--env-vars-file` 整包取代,檔內沒寫的變數部署後即不存在;`--set-secrets` 掛入的 secret 變數不受影響 | ✅ / ❌                     |
| Cloud Run(admin) | `deploy.yml` 的 `--build-arg`(Vite 值烘進 image;API 網址取自 `deploy/project/cloud.json` 的 `apiUrl`)                                                                                             | ✅                          |
| Vercel(front)    | Vercel dashboard(Settings → Environment Variables)                                                                                                                                                | ❌(平台保存;清單記載於下表) |

Vercel front 需設定 `NEXT_PUBLIC_GRAPHQL_ENDPOINT`(非機密 Config 型);下表是網域配置示例:

| 範圍                                | 值                                                    |
| ----------------------------------- | ----------------------------------------------------- |
| Production                          | `https://api.project.example.invalid/graphql`         |
| Preview → branch `staging`          | `https://api-staging.project.example.invalid/graphql` |
| Preview → branch `dev`              | `https://api-dev.project.example.invalid/graphql`     |
| Preview(其他分支 = feat 的 preview) | `https://api-dev.project.example.invalid/graphql`     |

**新增一個環境變數**(依用到它的地方,最多三處):

1. 本地:加進該 app 的 `.env` + 同步 `.env.example`(讓別人 / AI 知道有這個變數)。
2. api / admin 雲端:機密 → `gcloud secrets create`(步驟見下節)+ deploy.yml `--set-secrets`;非機密 → 加進 `deploy/env/<環境>.yaml`(三個環境各給值,走 PR)。必填與可省略的行為以 `docs/env-registry.md` 及讀取程式為準,例如 `MONGODB_URI` 沒有預設值。
3. front 雲端:Vercel dashboard 加(Type 選 **Config**,除非真是機密;`NEXT_PUBLIC_` 前綴 = 會進瀏覽器,機密絕不可加此前綴)。

**機密判斷準則**:「這個值出現在瀏覽器 / 版控裡會不會出事?」會 → Secret Manager(Cloud Run)或 Secret 型(Vercel);不會 → 明文設定即可。

變數清單(用途 / 是否機密 / 放哪 / 狀態)的正本是 `docs/env-registry.md`,新增或異動變數時必須更新它。

正本:`deploy/env/<環境>.yaml`、`deploy/project/cloud.json`(Secret 名稱、API 網址)、`.github/workflows/deploy.yml`(`--env-vars-file` / `--set-secrets` / `--build-arg`)、`docs/env-registry.md`

### 新增一個 Secret Manager 機密的標準步驟

指令都在 Claude Code 的 `!` 提示或 Git Bash 執行(**是 bash,不是 PowerShell**;`$env:TEMP` 這種 PowerShell 語法在這裡不會動)。

**1. 命名慣例**:每個環境各一份、值互不相同:`<名稱>-dev`、`<名稱>-staging`、`<名稱>`(production 無後綴)。例:`mongodb-uri-dev`、`field-encryption-key`。

**2. 建立**,依值的來源選一種:

- **程式產生的金鑰**(沒有人需要看到它):node 把值寫進 Windows 暫存資料夾 → gcloud 從檔案讀 → 刪檔。值不會印在螢幕、不進 shell 歷史。

  ```
  node -e "require('fs').writeFileSync(process.env.TEMP+'/k.txt', require('crypto').randomBytes(32).toString('base64'))" && gcloud secrets create <名稱>-dev --data-file="$TEMP/k.txt" --replication-policy=automatic --project=<gcp-project>; rm -f "$TEMP/k.txt"
  ```

  路徑要用 `$TEMP`(node 是 Windows 程式,`/tmp` 會被當成不存在的 `C:\tmp`)。

- **人打的密碼、連線字串**:走 GCP Console(Secret Manager → Create secret → 貼值 → Create),或**另開自己的終端機**跑 `printf '%s' '<值>' | gcloud secrets create <名稱>-dev --data-file=- --replication-policy=automatic --project=<gcp-project>`。**不要在 AI 對話裡貼密碼**(對話紀錄會留存,等於外洩)。

**3. 授權讀取者**(漏這步,部署或 CI 會報讀不到 secret):

| 誰會讀這個 secret                              | 授權對象(`--member`)                                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloud Run 執行中的 api(`--set-secrets` 掛進去) | Cloud Run 執行身分;查法:`gcloud run services describe <api-service> --project=<gcp-project> --region=<region> --format="value(spec.template.spec.serviceAccountName)"`,依查得的實際執行身分填入,不沿用來源專案帳號 |
| CI 步驟(如 deploy.yml 跑 update)               | `cloud.json` 的 `gcp.deployServiceAccount`                                                                                                                                                                         |

```
gcloud secrets add-iam-policy-binding <名稱>-dev --member="serviceAccount:<上表身分>" --role="roles/secretmanager.secretAccessor" --project=<gcp-project>
```

三個環境各跑一次。

首次部署前,每個環境的 `mongodbUri`、`fieldEncryptionKey`、`rootAdminPassword`、`jwtSecret` 指向的 Secret **都要有可讀取的版本**,只有建立 Secret 名稱不夠。`resendApiKey` 有寄信服務時填 Secret 名稱並建立版本;未啟用時在 `cloud.json` 的該欄填 `null`,部署不掛 `RESEND_API_KEY`,API 沿用記錄用 mail adapter。啟用後改回 Secret 名稱、授權執行身分並部署;不能填不存在版本的名稱。Cloud Run 執行身分讀前三項中的 `mongodbUri`、`fieldEncryptionKey`、`jwtSecret` 與啟用時的 `resendApiKey`;部署 SA 讀 `mongodbUri`、`rootAdminPassword` 以執行資料更新。

**4. 接線**(走 PR):secret 名稱登記在 `deploy/project/cloud.json` 各環境的 `secrets`,讀取器(`scripts/project-settings/config.mjs`)的欄位與固定輸出鍵同步加一個,並補測試。Cloud Run 用的 → deploy.yml「deploy api」步驟的 `env:` 接該輸出、`--set-secrets` 追加 `<環境變數名>=$<變數>:latest`;CI 步驟用的 → 該步驟 `gcloud secrets versions access latest --secret="$<變數>"`。

**5. 登記**:更新 `docs/env-registry.md`(狀態、secret 名稱、讀取身分)與本檔「資源清單」。

**陷阱**:

- 貼值時尾端多一個換行或空白,會變成值的一部分(密碼登入失敗最常見的原因)。
- 欄位加密金鑰(`field-encryption-key*`)**建立後不可輪替或刪除**,換鑰匙 = 既有密文全部解不開。
- seed 只在帳號**不存在**時建立、存在就不動:帳號建立後再改 `root-admin-password*` 的值,**不會**改到資料庫裡的密碼;要改密碼在系統內改。

小工具:裝了 vercel CLI 並登入後,`vercel env pull` 可把 Vercel 的變數拉成本地 `.env.local`(本地 front 想直連雲端 dev api 時方便)。

正本:`deploy/project/cloud.json`(secret 名稱)、`.github/workflows/deploy.yml`(`--set-secrets` 與 update 步驟讀 secret)、`docs/env-registry.md`

### GCS bucket 與 IAM(重建或加新環境時照此)

檔案儲存走 GCS 簽名網址直傳(ADR-0010):瀏覽器拿 api 簽的 V4 網址直接上傳 / 讀取,檔案不經過 api。**簽名不下載金鑰檔**:Cloud Run 執行身分沒有私鑰,`@google-cloud/storage` 會改呼叫 IAM Credentials 的 `signBlob`,所以那個 SA 必須能簽自己的名(第 3 步)。指令在 Git Bash 執行,`<env>` 取 `dev` / `staging` / `prod`。

**1. 建 bucket**(私有;region 與 Cloud Run 同 asia-east1,跨區會付流量費):

```
gcloud storage buckets create gs://project-assets-<env> --project=<gcp-project> --location=asia-east1 --uniform-bucket-level-access --public-access-prevention
```

公開 bucket 同一條指令,名稱改 `gs://project-public-<env>`、**拿掉 `--public-access-prevention`**,再加一行開公開讀:

```
gcloud storage buckets add-iam-policy-binding gs://project-public-<env> --member=allUsers --role=roles/storage.objectViewer
```

**2. 授權 Cloud Run 執行身分讀寫物件**(六個 bucket 各跑一次;身分同 Secret Manager 那張表的查法):

```
gcloud storage buckets add-iam-policy-binding gs://project-assets-<env> --member=serviceAccount:<api-runtime-service-account> --role=roles/storage.objectAdmin
```

**3. 讓執行身分能簽自己的名**(V4 簽名走 signBlob;漏這步 api 會在簽名時報 `iam.serviceAccounts.signBlob` 權限不足):

```
gcloud services enable iamcredentials.googleapis.com --project=<gcp-project>
gcloud iam service-accounts add-iam-policy-binding <api-runtime-service-account> --member=serviceAccount:<api-runtime-service-account> --role=roles/iam.serviceAccountTokenCreator --project=<gcp-project>
```

**4. 設 CORS**(瀏覽器對簽名網址 `PUT` 直傳受 CORS 限制;沒設時商標、封面上傳會在瀏覽器端失敗):

```bash
# cors.json:origin = erp-dev / erp-staging / erp 三個網域 + http://localhost:3001,method GET / PUT / HEAD,responseHeader Content-Type,maxAge 3600
gcloud storage buckets update gs://project-assets-dev --cors-file=cors.json   # 六個 bucket 各一次
gcloud storage buckets describe gs://project-assets-dev --format="value(cors_config)"
```

新增前端網域(例如自訂網域)時要把 origin 加進去再更新。

**5. 接線**(走 PR):`deploy/env/<環境>.yaml` 的 `GCS_BUCKET_PRIVATE` / `GCS_BUCKET_PUBLIC` 填 bucket 名稱(非機密,不進 Secret Manager);登記於 `docs/env-registry.md`。`GCS_BUCKET_PRIVATE` 沒設時 api 照常啟動,但改用記錄用 adapter(簽出來的網址是假的、檔案不會真的上傳),本地開發與測試即此模式。

**驗證**(需要 Cloud Run 的執行身分,本地做不到):部署後以 GraphQL 要一張上傳票 → 用該網址 PUT 一張圖 → 讀回簽名網址能開。

正本:`apps/api/src/storage/`、`deploy/env/<環境>.yaml`、ADR-0010

### Cloud Scheduler(排程任務)

api 的排程任務由**每個環境一個** Cloud Scheduler 工作驅動:每 15 分鐘以 OIDC token `POST <api-url>/internal/scheduled-jobs/run`,api 依程式裡的登記判斷哪些工作到期並執行。deploy.yml 不建立或更新這個工作;建一次即可,之後部署不必動它。底座三環境都沒有建立,`SCHEDULER_*` 未設時端點拒絕所有呼叫(403),排程等於關閉。

- **登記工作**:功能模組(底座或專案)匯入 `ScheduledJobsModule`,在 `onModuleInit` 以 `ScheduledJobRegistry.registerScheduledJob({ key, every, handler })` 登記;`every` 是 `"15m"`、`"1h"` 或 `"daily@HH:mm"`。key 全域唯一,重複或頻率寫錯 api 啟動即失敗。
- **到期判斷**:`15m` / `1h` 以 UTC 對齊區間(:00 / :15 / :30 / :45、整點),同一區間只跑一次,錯過的區間不補。`daily@HH:mm` 依各租戶時區(`orgs.settings.timezone`,未設用預設時區)換算當地 HH:mm;當地時刻過後 6 小時內的呼叫都算到期(錯過幾次呼叫仍補跑一次),超過就等下一天。handler 收到這次要處理的租戶(含根組織 `tenantId = null`,不含停用的租戶),時點相同的租戶併成一次。
- **冪等**:每個 `(key, scheduledFor)` 在 `scheduled_job_runs` 只能插入一筆,插入成功的那次呼叫才執行(`docs/data-model.md`「排程任務執行紀錄」)。Scheduler 重送或多個 instance 同時收到都不會重複執行;失敗的時點不重跑。個別工作失敗、或某個工作讀寫執行紀錄時資料庫出錯,端點仍回 200,同一輪其他工作照跑,結果看回應 body、執行紀錄與 Cloud Run log。
- **執行時間**:一次呼叫依序跑完所有到期工作,受 Cloud Run 300 秒請求逾時與 Scheduler 的 `--attempt-deadline=300s` 限制,**所有到期 handler 合計須遠小於 300 秒**;量大的工作分批處理,下一次呼叫再接續。被逾時中止或 instance 當掉時紀錄停在 `running`,`startedAt` 超過 15 分鐘後由之後的呼叫重新取得(原子更新,同時只有一個呼叫取得)。
- **費用**:Cloud Scheduler 的免費額度以帳單帳戶計(目前每個帳單帳戶每月 3 個工作),同一帳單帳戶下所有專案共用,不同專案若在不同帳單帳戶則各自計算;超出照價計費。每個環境一個工作,不需要排程的環境可以不建。每 15 分鐘喚醒 api 一次(`min-instances=0` 時每次可能冷啟動)。

**建立步驟**(每個環境各一次;`<api-url>` 是 `deploy/project/cloud.json` 該環境的 `apiUrl`,`<api-service>` 是該環境的 api 服務名):

```bash
gcloud services enable cloudscheduler.googleapis.com --project=<gcp-project>
# 呼叫身分:只用來簽 OIDC token,不需要任何專案層級角色;三環境可共用一個或各建一個
gcloud iam service-accounts create scheduler-invoker --display-name="Cloud Scheduler invoker" --project=<gcp-project>
# 建立工作的人(或部署 SA)要能代用這個身分
gcloud iam service-accounts add-iam-policy-binding <scheduler-sa> --member="user:<operator-email>" --role=roles/iam.serviceAccountUser --project=<gcp-project>
gcloud scheduler jobs create http <api-service>-scheduled-jobs \
  --project=<gcp-project> --location=<region> \
  --schedule="*/15 * * * *" --time-zone="Etc/UTC" \
  --http-method=POST --uri="<api-url>/internal/scheduled-jobs/run" \
  --oidc-service-account-email=<scheduler-sa> --oidc-token-audience="<api-url>" \
  --attempt-deadline=300s
```

`<scheduler-sa>` 是建立的完整 email。api 服務以 `--allow-unauthenticated` 部署,Cloud Run 不驗呼叫者,身分由 api 自己驗 OIDC token(Google 簽章、issuer、audience、email)。

**接線**(走 PR):`deploy/env/<環境>.yaml` 加 `SCHEDULER_INVOKER_EMAIL: "<scheduler-sa>"` 與 `SCHEDULER_AUDIENCE: "<api-url>"`(與 `--oidc-token-audience` 完全相同,含結尾斜線與否),再手動 Deploy 該環境(改 `deploy/env/` 會讓 api 重新部署)。變數說明見 `docs/env-registry.md`。

**驗證與維運**:

```bash
gcloud scheduler jobs run <api-service>-scheduled-jobs --project=<gcp-project> --location=<region>
gcloud scheduler jobs describe <api-service>-scheduled-jobs --project=<gcp-project> --location=<region> --format="value(state,lastAttemptTime,status)"
gcloud scheduler jobs pause <api-service>-scheduled-jobs --project=<gcp-project> --location=<region>    # 暫停;恢復用 resume
```

手動執行後在 Cloud Run log 看到該請求回 200 才算接通:401 是 token 無效(audience 與 `SCHEDULER_AUDIENCE` 不同最常見),403 是呼叫身分與 `SCHEDULER_INVOKER_EMAIL` 不同或該環境 YAML 沒填,503 是 api 取不到 Google 公鑰(5 秒逾時,Scheduler 下一次呼叫再試)。

查卡住或失敗的執行紀錄(以該環境資料庫的 `mongosh` 連線執行):

```js
db.scheduled_job_runs
  .find({
    status: "running",
    startedAt: { $lt: new Date(Date.now() - 15 * 60 * 1000) },
  })
  .sort({ startedAt: -1 });
db.scheduled_job_runs
  .find({ status: "failed" })
  .sort({ scheduledFor: -1 })
  .limit(20);
```

卡住的紀錄會在下一次呼叫被重新取得,通常不必手動處理;反覆卡住表示 handler 太慢,先看 Cloud Run log 的逾時紀錄。

正本:`apps/api/src/scheduled-jobs/`、`deploy/env/<環境>.yaml`

### 即時通道(Cloudflare Worker)

即時通道 = `apps/realtime`(Worker + Durable Object `TenantHub`);**每個環境一個 Worker**,網域 `rt-dev.<網域>` / `rt-staging.<網域>` / `rt.<網域>`(登記 `docs/branding.md`)。全部用 Cloudflare 免費方案;用量看 Cloudflare 後台。未啟用的環境不部署 Worker,api 不簽發訂閱憑證,admin 以 60 秒輪詢運作(頭像選單黃點)。

**免費方案的額度**:Worker 與 Durable Object 每天各 10 萬次請求;建立連線、送出一次信號(不論帶幾個頻道)各算 1 次,連線上的訊息(換發、訂閱、代理程式的 ping)每 20 則算 1 次,推送與閒置連線不計。超過時該操作失敗到 UTC 00:00(台灣 08:00),期間 admin 與代理程式照斷線處理,改 60 秒輪詢。用量只在 Cloudflare 後台看,不給租戶看。需要時改付費方案(整個帳號 US$5/月)。

`cloud.json` 各環境的 `realtime`(省略或 `null` = 停用;寫了就要完整):

```json
"realtime": {
  "worker": "<project>-realtime-dev",
  "cloudflareAccountId": "<32 位 hex 帳號 id>",
  "secrets": { "ticketSecret": "realtime-ticket-secret-dev", "publishSecret": "realtime-publish-secret-dev" }
}
```

**啟用步驟**(每個環境各一次;deploy.yml 只負責部署,不建立任何資源):

1. Secret Manager 建兩把密鑰(值各自隨機產生,三環境不同):`realtime-ticket-secret-<環境>`、`realtime-publish-secret-<環境>`,依「新增一個 Secret Manager 機密的標準步驟」授權 **api 執行身分**與**部署 SA**(部署時讀出上傳給 Worker)讀取。
2. GitHub repo Secrets 加 `CLOUDFLARE_API_TOKEN`(權限見 `docs/env-registry.md`;三環境共用一把)。
3. `cloud.json` 該環境寫 `realtime`;`deploy/env/<環境>.yaml` 加 `REALTIME_URL: "https://rt-<環境>.<網域>"`。兩者走 PR 一起改。
4. 跑 Deploy:最後的「deploy realtime」步驟以 `pnpm --filter @repo/realtime exec wrangler deploy --name <worker> --secrets-file <暫存檔>` 部署(Durable Object 的 migration 隨 `wrangler.jsonc` 套用),api 部署時掛上兩把密鑰。
5. Cloudflare 後台 → Workers → 該 Worker → Settings → Domains & Routes 加自訂網域 `rt-<環境>.<網域>`(一次即可;網域須在同一個 Cloudflare 帳號的 DNS)。
6. 驗證:登入 admin,頭像選單的小圓點是綠色;Worker 的 log(`wrangler tail --name <worker>`)看得到連線。把 Worker 停掉(或 `REALTIME_URL` 拿掉再部署)時圓點變黃、資料每 60 秒更新。

- **換密鑰**:在 Secret Manager 加新版本後重跑 Deploy(api 與 Worker 一起換);換的瞬間已連線的瀏覽器在下一次換發被拒,會自動重新連線。
- **本機**:`apps/realtime/.dev.vars.example` 複製成 `.dev.vars`,`pnpm --filter @repo/realtime dev`(`wrangler dev`,`http://localhost:8787`);api 的 `.env` 設 `REALTIME_URL=http://localhost:8787` 與同樣的兩把密鑰。

正本:`apps/realtime/wrangler.jsonc`、`.github/workflows/deploy.yml`「deploy realtime」、`apps/api/src/realtime/realtime.config.ts`

### 列印代理程式發布(print-agent-release.yml)

列印代理程式(`apps/print-agent`)的安裝檔放在**各環境自己的私有 bucket**(`deploy/env/<環境>.yaml` 的 `GCS_BUCKET_PRIVATE`,與 api 讀檔的是同一個),不用 GitHub Release(repo private 時店家下載不到):

```
<私有 bucket>/print-agent/
 ├ manifest.json          最新版本、各版本、各檔案的 SHA-256(格式正本:@repo/domain/printing)
 └ <版本>/                四個平台的壓縮檔
```

api 讀 `manifest.json`、以既有檔案服務簽 1 小時的下載網址(印表機管理頁的下載區);bucket 的讀取與簽名權限沿用上面「GCS bucket 與 IAM」的第 2、3 步,不必另設。

**發布**(只能手動觸發,不進 PR CI):`gh workflow run "Print Agent Release" --ref main -f version=<x.y.z> -f environment=<dev|staging|production>`。順序同 Deploy:先 dev 試裝,再 staging、production;**production 只能從 `main` 發**,dev / staging 可指定其他分支。

1. `build`:四種 runner(`windows-latest`、`ubuntu-latest`、`ubuntu-24.04-arm`、`macos-15`)各自打包單一執行檔與安裝檔(`apps/print-agent/scripts/package-sea.ts`;Windows 另下載 WinSW 並核對 SHA-256)。
2. `publish`:以 Deploy 同一套 WIF + 部署 SA 認證 → 重算 SHA-256 → 先上傳四個檔到 `print-agent/<版本>/` → 換 `manifest.json`(`no-store`)→ 刪掉第 4 版以前的檔。版本必須是 `x.y.z`、大於目前的最新版本、不能重複發布;`manifest.json` 讀不懂時停下來不覆蓋。
3. 驗證:run 的 Summary 印出新的 `manifest.json`(四個檔與 SHA-256);印表機管理 → 代理程式分頁的下載區顯示新版本,四個按鈕都能下載。

**第一次發布前要準備的**(每個環境各一次;workflow 只上傳,不建立任何資源):

| 項目                      | 內容                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 私有 bucket               | 已建立(uniform bucket-level access)且 `deploy/env/<環境>.yaml` 寫了 `GCS_BUCKET_PRIVATE`;步驟見「GCS bucket 與 IAM」       |
| WIF 與部署 SA             | 沿用 `deploy/project/cloud.json` 的 `gcp`(Deploy 用的同一組),不建新身分、不建金鑰                                          |
| 部署 SA 對 `print-agent/` | 物件讀寫刪(只限這個前綴),見下方指令                                                                                        |
| GitHub                    | 不需要新的 Secret 或變數;repo 為 private 時 macOS runner 以 10 倍、Windows 以 2 倍計費,`ubuntu-24.04-arm` 要該帳號方案可用 |

部署 SA 對 `print-agent/` 的寫入權限(IAM 條件只放行這個前綴;讀 `manifest.json`、上傳、覆蓋、刪舊版都靠它,不需要列出 bucket)。因為沒有 bucket 的 `storage.objects.list`,workflow 不能用 `gcloud storage cp` / `rm`(它們會先列出 bucket,一律被拒),讀、寫、刪都打 GCS JSON API 的單一物件端點:

```bash
gcloud storage buckets add-iam-policy-binding gs://<私有 bucket> \
  --member=serviceAccount:<deployer-sa> --role=roles/storage.objectUser \
  --condition='expression=resource.name.startsWith("projects/_/buckets/<私有 bucket>/objects/print-agent/"),title=print-agent-release'
```

**workflow 還沒進 `main` 時想先驗一次**:照 `docs/agents/issue-tracker.md`「新增一個只手動觸發的 workflow 時怎麼驗」暫加 `push` trigger;`push` 事件沒有 inputs,驗證時要把兩個 job 讀 `inputs.version` / `inputs.environment` 的地方暫時寫死(例 `0.0.1` / `dev`),驗完一起改回。

正本:`.github/workflows/print-agent-release.yml`、`apps/print-agent/README.md`、`apps/api/src/printing/print-agent-release.service.ts`

### Vercel 補充設定

- **兩個 Vercel 專案**:front 連此 repo 並選 Root Directory `apps/front`,依既有 workspace 建置 Next.js;Storybook 另建專案,Root Directory `apps/storybook`,build 後 Output Directory `storybook-static`。兩者都需要 repo 根的 workspace 套件,若 Vercel 沒自動讀到 Root Directory 外的來源,啟用「Include source files outside of the Root Directory in the Build Step」。首次部署實際核對 monorepo 依賴可安裝、各自 build 成功,不要把 Storybook 當 front 的子路由。
- **前台環境值**:`NEXT_PUBLIC_GRAPHQL_ENDPOINT` 的 Production 指向正式 API;Preview 可對 `staging` 分支指定預發布 API,其他 Preview 分支指向 dev API。三種目標分別預覽並檢查請求位置,避免把 Preview 指到 production。
- **分支網域**:`dev.project.example.invalid` → branch `dev`、`staging.project.example.invalid` → branch `staging`(示例)(Settings → Domains,各綁 Git Branch);api / admin 的 dev / staging 子網域走 Cloud Run domain mapping(`api-dev`、`erp-dev`、`api-staging`、`erp-staging`,Cloudflare 灰雲 CNAME → ghs.googlehosted.com)。
- **Storybook 網域**:Storybook 專案同樣在 Settings → Domains 綁三個:正式網域(Production)與 dev / staging 兩個分支網域(Environment 選 Preview、Git Branch 填分支名);DNS 都是 Cloudflare 灰雲 CNAME,值照 Vercel 畫面給的填。分支網域屬於 Preview,受 Deployment Protection 管,要公開時在該專案關掉 Vercel Authentication(只影響該專案)。實際網域登記在[品牌註冊表](branding.md)。
- **Deploy Hooks**(Settings → Git 最下方):`dev-front`、`staging-front`。對 hook URL 發 POST 即可**不靠 commit** 重 build 該分支的 front(Vercel 會跳過無檔案變更的 commit,分支剛建立或只想重烘時用這個)。
- **Deployment Protection**:由專案按測試環境需求設定,與 API/admin 的存取方式一起驗證。
- 三環境 admin image 烘入各自 `cloud.json` 的 `apiUrl`,可使用專案的自訂子網域。

Cloud Run 自訂網域映射前,用執行映射的**同一 Google 帳號**於 Search Console 驗證網域擁有權,並確認 `gcloud domains list-user-verified --project=<gcp-project>` 能列出該網域;再建立 mapping、設定 DNS、等待憑證可用。若 root 管理員信箱使用新專案網域,須先在該網域配置收信或轉寄(例如 Cloudflare Email Routing),再寄送邀請或重設密碼信。

MongoDB Atlas 每環境建立獨立 DB 使用者,只給該環境資料庫的 `readWrite` 權限;URI 指向對應資料庫,資料庫於首次寫入建立。Cloud Run 預設對外 IP 可能變動,Atlas Network Access 必須允許實際出口:有固定出口時用該 IP 的狹窄 allowlist;未配置固定出口而選擇 `0.0.0.0/0` 時,要由專案明確接受公開網路入口,並維持強密碼、TLS、每環境獨立帳號與最小權限。不要把來源專案的 Atlas 帳號或網路規則複製過來。

## 五、安全與費用備忘

- 憑證與連線字串只放專案自己的 Secret 或未追蹤本機設定,不寫進版控、issue 或執行輸出。
- Cloud Run 的 min/max instances 由 deploy.yml 設定;初始化時核對預期流量與資料庫連線額度,另在專案的 GCP 設費用預算。
- 三環境資料庫與連線池各自規劃,以實際方案額度核對總連線數,不把來源專案的成本或限制當成新專案設定。
- Sandbox、寄信開關、allowlist 與儲存設定以各環境 YAML 及 env-registry 為準。
