# Issue tracker:流程 SOP

本 repo 的 issues 與 PRD 都放在 GitHub Issues,repo 身分取自 `deploy/project/github.json` 的 `expectedRepository`,所有操作一律用 `gh` CLI 並核對目標 repo。本檔只寫**流程**;撞到怪現象先查 [pitfalls.md](./pitfalls.md),找指令查 [toolbox.md](./toolbox.md)。

## gh 慣例

- **建立 issue**:`gh issue create --title "..." --body-file <檔>`(多行內容先寫成檔)。
- **讀取 issue**:`gh issue view <n> --json body,comments,labels`;篩欄位用 gh 內建的 `--jq`。
- **列出 issues**:`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`,視情況加 `--label` / `--state`。
- **留言 / 標籤 / 關閉**:`gh issue comment <n> --body "..."`、`gh issue edit <n> --add-label "..."` / `--remove-label "..."`、`gh issue close <n> --comment "..."`。
- 上列 repo 範圍指令一律追加 `--repo <owner/repo>`,並與 `deploy/project/github.json.expectedRepository` 及 origin 核對。引用專案可同時有 origin/upstream,不依 gh 的自動 remote 選擇決定目標。
- GitHub 的 issue 與 PR 共用同一組編號:先 `gh pr view <n>`,失敗再 `gh issue view <n>`。

正本:`gh help issue`、[toolbox.md](./toolbox.md)「gh」

## skill 對接點

- **PRs as a request surface: no.** _(若此 repo 把外部 PR 視為 feature request,改為 `yes`;`/triage` 會讀取這個旗標。)_ 設為 `yes` 時,PR 走與 issue 相同的標籤與狀態流程:讀取 `gh pr view <n> --comments` / `gh pr diff <n>`;列出待 triage 的外部 PR 用 `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`,只保留 `authorAssociation` 為 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR`、`NONE` 的項目;留言 / 標籤 / 關閉用 `gh pr comment`、`gh pr edit --add-label` / `--remove-label`、`gh pr close`。
- **skill 說「publish to the issue tracker」** → 建立一個 GitHub issue。
- **skill 說「fetch the relevant ticket」** → `gh issue view <n> --json body,comments`。
- 標籤字串對照見 [triage-labels.md](./triage-labels.md)。

正本:本檔(skill 讀取的旗標就在上面)

## 分辨一張 issue 的種類

| 這張 issue 是什麼           | 判斷方式                                                                     | 下一步                                                    |
| --------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Spec(規格,不可直接開發)** | 標題 `Spec:` 開頭、內文為 spec 模板、**沒有** `## Parent` 段                 | 對它跑 /to-tickets 拆票                                   |
| **Ticket(開發票)**          | 內文**有** `## Parent` 指回 spec + 驗收條件                                  | 依看板 Status 行動(見下);掛 `needs-info` 者先解開內列問題 |
| 「可 code-review 的」       | **不存在這種 issue** — review 的對象是 PR:票完成 → PR → /code-review → merge |                                                           |

文件整理、流程調整這類獨立的票可以沒有 `## Parent`,以票面的範圍與驗收條件為準。

正本:本檔

## 看板:票的生命週期(唯一真相)

看板啟用時,狀態以該專案 **GitHub Project 的 Status 欄位**為準;標籤只當資格註記(`needs-info`、`wontfix` 等),**不用標籤表示狀態**。看板停用時,進度與驗收記在 issue/PR,不操作來源專案的看板。底座預設停用看板,啟用與 IDs 以 `deploy/project/github.json` 為準。

| Status         | 意義(對應 3 分支流程)                                                                     | 誰在何時移卡   |
| -------------- | ----------------------------------------------------------------------------------------- | -------------- |
| Backlog        | 票已開但 Blocked by 尚有 open                                                             | 拆票時放入     |
| Ready          | blockers 全關,可認領                                                                      | blocker 關閉時 |
| In Progress    | 已認領開工(assign 給自己)                                                                 | 實作者開工時   |
| In Review      | PR 已開啟(內文必含 `Closes #<票號>` 建立連結)                                             | 實作者開 PR 時 |
| Dev 驗證中     | PR 已合 `dev` → 等手動部署 dev(`gh workflow run Deploy --ref dev -f environment=dev`)+ QA | merge 時       |
| Dev 通過       | dev QA 通過,等合 `staging`                                                                | QA 者          |
| Staging 驗證中 | 已合 `staging` → 等手動部署 staging + QA                                                  | merge 時       |
| Staging 通過   | staging QA 通過,等 release                                                                | QA 者          |
| Released       | `staging` 已合回 `main` 並部署 production;**此時關閉 issue**                              | release 時     |
| Won't Do       | 決定不做(issue 以 not planned 關閉)                                                       | 決策時         |

- Spec issue 不上板(看板只放票);合 `staging` 的 PR 內文也要含 `Closes #<票號>` 或 `Refs #<票號>`,自動化才找得到票。
- **自動化**(`project-status.yml`,用 secret `GH_PROJECT_TOKEN`;看板 ID 讀預設分支上的 `deploy/project/github.json`,workflow 失敗時不會移卡,要手動移):issue opened → 入板 Backlog;issue closed → Released(not planned → Won't Do)。PR 事件移的是**票卡**:依 PR 內文的 `Closes` / `Fixes` / `Resolves` / `Refs #<n>` 找票,PR 開啟 / reopen / 轉 ready(目標 `dev`)→ In Review;合進 `dev` → Dev 驗證中;合進 `staging` → Staging 驗證中。draft PR 不觸發;內文沒有票號就什麼都不動。
- **一定要手動的四格**:Ready(blocker 關閉時)、In Progress(認領時)、Dev 通過、Staging 通過(QA 者)。
- `Closes #n` 只在合進預設分支 `main` 時自動關票;PR 合 `dev` **不會關**,關票時機是 Released(`gh issue close <n> --comment "<PR 連結>"`)。
- 部署一律手動觸發(deploy.yml 只有 `workflow_dispatch`),merge 不會部署任何環境。

雲端停用時,上表的部署驗收依 [deployment 的 Release 步驟](../deployment.md#release-步驟)改用 CI、本機應用與資料驗收;Released 表示程式版本已發布,不代表雲端已部署。

**手動移卡**(只適用已啟用看板;整行單行,PowerShell 沒有 `\` 續行):

```
gh project item-edit --id <ITEM_ID> --project-id <PROJECT_ID> --field-id <STATUS_FIELD_ID> --single-select-option-id <OPTION_ID>
```

- **看板 ID 的正本是 `deploy/project/github.json` 的 `projectStatus`**,這裡不另抄一份:PROJECT_ID = `projectId`、STATUS_FIELD_ID = `statusFieldId`、OPTION_ID = `options` 裡對應狀態的值。一次列出:`node scripts/project-settings/read-config.mjs --scope github --repository <owner/repo>`。
- `options` 的鍵對應看板狀態:`backlog`=Backlog、`ready`=Ready、`inProgress`=In Progress、`review`=In Review、`devVerify`=Dev 驗證中、`devPassed`=Dev 通過、`stagingVerify`=Staging 驗證中、`stagingPassed`=Staging 通過、`released`=Released、`wontDo`=Won't Do。自動化只寫其中六個(`backlog`、`review`、`devVerify`、`stagingVerify`、`released`、`wontDo`),另外四個只由人移。
- ITEM_ID:`gh project item-list <project-number> --owner <owner> --format json --limit 300 --jq '.items[] | select(.content.number==<票號>) | {id, status}'`(預設只回 30 筆,新票不在裡面;連 `status` 一起取,才知道現在在哪一格)。
- 看板欄位在 UI 的位置(重建看板時對得起來):自己的 GitHub Project → 右上 … → Settings → Fields → `Status` 的選項清單,順序即上面的鍵順序;重建後把新的 ID 填回 `deploy/project/github.json`。
- **自動化什麼時候不會動**:workflow 只讀預設分支(`main`)上的 `deploy/project/github.json` 與 `scripts/project-settings/`。`main` 上還沒有這些檔案、設定與 repo 不符、看板啟用但拿不到 `GH_PROJECT_TOKEN`(含 fork 來的 PR)時,該次 run 明確失敗且不移卡,照本節手動移;`projectStatus.enabled` 為 `false` 時 run 成功但不移卡。

正本:`deploy/project/github.json`(看板 ID)、`.github/workflows/project-status.yml`、`scripts/project-settings/project-status.mjs`(事件 → 狀態的對應)

## 實作一張票(接手 SOP,無對話 session 亦適用)

1. **讀**:票全文與留言 → Parent spec(含接手指南)→ `CLAUDE.md` → 相關規範(`docs/standards/README.md` 索引)與概念文件 / ADR → 模組文件 `docs/modules/<key>.md`。
2. **認領**:`gh issue edit <n> --add-assignee "@me"`,看板票卡移 In Progress。
3. **開工環境**(新 worktree 必做,細節見 pitfalls「新 worktree 與依賴」):
   - `pnpm install`(純文件票也要,否則連 prettier 都沒有)。
   - 程式票依 [toolbox 的建置前置步驟](./toolbox.md#pnpm--turbo建置測試格式)建置共用套件(`apps/db-migrator` 的票同樣必要)。
   - 重構型的票(先搬檔再修 import,中途型別必紅)與只改文件的票,在 repo 根建空檔 `.claude/hook-typecheck-off`(已 gitignore),PostToolUse hook 就只跑 ESLint;單獨一行指令做、`ls .claude/` 確認,建不起來就略過;**交件前刪掉**。
4. **分支**:從 `origin/main` 切,命名含票號:`feat/<票號>-<kebab 描述>`(文件票用 `docs/<票號>-…`)。
   - **票有依賴、依賴票還沒進 `main`**:從依賴票的 feat 分支尾端切(疊票);PR 一樣目標 `dev`,依賴票的 PR 先合、自己後合。從哪裡切、怎麼對齊(只 rebase、不 merge `dev` / `main`)的規則正本是 `docs/deployment.md`「分支模型」。
   - 線性依賴鏈是健康的;**兩票誰先上都無法獨立變綠 = 切票錯誤,併票**。
5. **開發**:TDD(先寫紅燈測試,測試只呼叫 spec 指定的接縫)。
   - **動到 api 的 GraphQL schema**(resolver / model / input / `*.graphql` document):交件前依序跑 `pnpm --filter @repo/api schema:generate` 與 `pnpm --filter @repo/graphql generate`,`apps/api/schema.gql` 與 `packages/graphql/src/generated` 兩份產物一起進 commit(GQL-05);api-only 的票也一樣,CI 的「codegen 產物與 schema 一致」會擋。
   - 改檔名為 PascalCase 的重構,先在該包啟用 `frontend-style` 再搬檔。
   - 新套件版本一律 `npm view <pkg> version` 查 registry,並對齊既有同家族套件的主 / 次版本(例:`@mui/x-date-pickers` 對齊已裝的 `@mui/x-tree-view`)。
6. **交件前自檢**:
   - 程式票:進各 package 目錄跑 `pnpm run lint` 與 `pnpm run check-types`(不要只看 turbo 的綠燈,快取會命中)、`pnpm exec turbo run test --filter=<全名>`。
   - 所有票:`pnpm format`,再 `pnpm run format:check`(涵蓋 md / ts / tsx / js / json / yaml)。
   - 刪掉 `.claude/hook-typecheck-off`。
7. **開 PR**:目標 `dev`,內文含 `Closes #<票號>`;測試 / lint / typecheck 全綠才開;看板票卡由自動化移到 In Review,沒動就手動移。內文先用 Write 寫成 scratchpad 檔,`gh pr create --base dev --body-file <檔>`。開完先 `gh pr view <n> --json mergeable`,`CONFLICTING` 時 CI 根本不會跑(處理見 pitfalls「PR、CI 與看板」)。
8. **不做**:不 merge、不動 `main` / `dev` / `staging` 本體。docs 只改本票必然連動的兩種:①本票新增 / 異動的模組 → 同 PR 維護 `docs/modules/<key>.md` 的「api 介面」節與 help.md;②本票新增的環境變數 / 品牌元素 → 同 PR 更新 `docs/env-registry.md` / `docs/branding.md`(CLAUDE.md 規定)。其他規則本文(ADR、CONTEXT、`docs/standards/`、模組文件的行為說明與「admin 頁面」節、`docs/agents/module-scaffold.md`)**不改**,寫進回報的「規則回饋」;票面明寫例外者除外。
9. **回報**:照下方「交件報告格式」。

正本:本檔;分支規則 `CLAUDE.md`「Git 工作流程」

### 交件報告格式

實作者結束時回報(PR 內文也放同樣幾節):

- **PR 連結**與 CI 狀態(綠 / 紅 / 排隊中)。
- **改了什麼**:新增 / 改動的檔案清單。
- **測試結果**:跑了哪些指令、通過數(與 `origin/main` 基準相比多幾筆)。
- **截圖 / E2E 建議**(admin 票附截圖;權限票寫是否建議跑 E2E,見下兩節)。
- **文件與程式不合處**、**規則回饋**:發現規則本文寫錯或缺漏,列在這裡由文件票收。
- **確認不動的項目**:票面要求「逐一檢查同型」時,檢查過但沒改的逐項寫一句為什麼。
- **接手體驗報告**:找不到 / 矛盾 / 用猜的資訊 —— 這是文件品質的回饋來源。

正本:本檔

### admin 票的交付要求:mock 模式截圖

凡是動到 `apps/admin` 畫面的票,PR 內文一律附 mock 模式截圖。起 mock 模式是開發期間就該做的事,交件只是把截圖貼上。

```
pnpm --filter @repo/admin dev:mock --port <自選埠> --strictPort
```

- 埠自己選、加 `--strictPort`(占用就直接失敗),**不要在 `--port` 前加 `--`**;網址以終端印出的 `Local:` 為準。
- 截圖前開自己的分頁,並確認畫面裡看得到自己這次的改動。
- 自動登入 root、各頁都有假資料;`?view=tenant` 換租戶管理員視角、`?auth=off` 看登入頁。
- **改動到的每一頁各截一張**,逐張寫明「哪一頁、什麼狀態」;彈窗類的改動各截開啟前後。
- 不必有 dev 帳號、不必等部署 —— 版面問題在 PR 階段就要看到。
- 跑法與實作細節(入口、共用端點的 handler、`msw/node` 的 alias stub、自動關閉的提示怎麼截、MUI Dialog 按鈕點不到時怎麼辦)見 TEST-08「mock 開發模式」。

正本:`apps/admin/vite.mock.config.ts`、`docs/standards/testing/testing.md`(TEST-08)

### 權限 / 示範模組的票:在 PR 註明是否建議跑劇本 E2E

改到**權限解析、模組樹 / 路由防守、示範模組、角色矩陣**的票,交件時在 PR 內文寫一段「E2E 建議」:建議跑或不必跑、理由、建議跑哪幾條劇本。**跑不跑由使用者決定並觸發;agent 不自己觸發 `e2e.yml`,票面的驗收條件也不寫「跑 E2E」**。`e2e.yml` 只有 `workflow_dispatch`、不在 `ci.yml` 內,PR 的 CI 不會跑它,每跑一次都花 Actions 額度。

- 使用者決定要跑時的指令:`gh workflow run e2e.yml --ref <分支>`,跑的是**該分支上那一版**的 spec 與 harness;`-f grep="劇本 7"` 只跑其中一條。
- 覆蓋到哪幾條見 `docs/testing/permission-scenarios.md` 的「E2E」欄;寫法規範見 TEST-05 / TEST-11。

正本:`.github/workflows/e2e.yml`、`apps/e2e/README.md`

### 新增一個「只手動觸發」的 workflow 時怎麼驗

`workflow_dispatch` 的硬限制:**workflow 檔必須已經在預設分支(`main`)上,`gh workflow run` 才叫得動**。限制只在「叫不叫得動」:檔案一旦進了 `main`,之後 `--ref <feat 分支>` 跑的就是該分支上的那一版。

- 交件前想驗:**暫時加一段 `push: branches: [<你的 feat 分支>]`** → push 一次讓它跑 → 綠了之後**把那段移除**再開 PR。PR 內文附那次 run 的連結並註明「驗證用的 push trigger 已移除」。
- 不要把 `push` trigger 留著合進去 —— 手動 workflow 通常很貴,留著等於每次 push 都燒 Actions 額度。

正本:`.github/workflows/`

## release 與分支對齊(指路)

- **release 一批一次**:各票各自合 `dev`、各自合 `staging`,累積成一批才走一次 release PR + 一次部署(`dev` 的部署也等該批最後一張合完)。所以「合進 `dev` 了但還沒部署」是正常的。
- release 完由主流程把 `dev` / `staging` reset 對齊 `main`;實作者**不要自己改 `dev` / `staging`**。
- 步驟、前置檢查、交叉 merge base 的處理,指令都以 deployment.md 為準,這裡不重寫。

正本:`docs/deployment.md`(二、Release 步驟;對齊分支在第 4 點)

## 拆票與寫票的規則

目標:**沒有本地對話 session 的人,拿 repo + issue 就能接手**。拆票時逐條對過;違反的代價寫在每條後面。

正本:本檔

### 接手性

- **細節不重複進 issue**:權限表、種子清單、schema 這類細節的正本在 repo 文件(`docs/modules/`、`docs/concepts/`、schema 檔),issue 只做精確指路;提到數量或清單時,同句附上正本檔案。
- **spec 引用的內容若 repo 沒有正本,先補文件再發 spec** —— 只存在於對話或設計圖裡的細節,對接手者等於不存在。
- 每份 spec issue 附「**接手指南**」節:無 session 的閱讀順序(`CLAUDE.md` 文件地圖 → `docs/README.md` → `docs/agents/domain.md` 概念導讀 → 本 spec 的資料來源表)。
- **指路要能 grep 到**:引用 `docs/tmp/dis.md`(底座)或 `docs/tmp/project-dis.md`(專案)這類長備忘時,寫明哪一份並給一個關鍵字(如「dis.md 搜『populate』」「project-dis.md 搜『<條目關鍵字>』」),編號不是標題、用 heading 搜不到。
- **指路要先開檔確認,不要憑記憶指先例**:指錯先例比不指更糟,實作者會照著一個不存在的東西做。寫到**檔案路徑**(例:列表 Switch 的先例是 `apps/admin/src/components/base/FieldManager/FieldOptionsPanel/FieldOptionsTable.tsx`,含無權限時退回 `Tag`;使用者管理的停用是 `Button`、啟用欄是 `Tag`,不是先例)。
- **名字相近的元件 / 函式點名完整檔名**:例 `OrgPickerDialog`(勾選所屬組織)與 `OrgChangeDialog`(移除確認)只差一個詞,寫「組織彈窗」兩邊都對得上。
- **引用慣例照實際寫法寫**:admin 的錯誤解讀是 `<ns>ErrorOf(error)` 取 code、再 `tErrors(code)` 取文案(DATA-06),沒有 `messageOf` 這種東西;訊息形狀與要顯示的文案一起對(例:`login` 的訊息要帶 `name` 才顯示得出「歡迎,某某」)。
- **引用 Figma 時節點 id 給到列層級**,給到整張畫布等於沒給。

### 裁決寫死,不留給實作者

- **二選一、「建議①」「可考慮」不出現在票上**:兩張並行的票會各選一邊,主流程還要回頭對齊。拆票時選定並寫一句理由;還沒想清楚就不要放進這一批。常見的幾類:
  - `apps/` 還是 `packages/`、共用元件放 `components/` 還是直接進 `@repo/ui` —— 選錯的代價是之後整包搬。
  - 過渡做法的**退場時機**與 owner 票(否則兩套判準長期並存)。
  - 寫入端點**套不套自鎖**:`SELF_LOCK` 守「關掉就再也開不回來」;換圖示、改顯示名這類隨時改得回來的不套,會讓操作者失去繼續操作能力的才套。
  - input 欄位**缺席與 `null` 的語意**(同義,或缺席 = 不動、`null` = 清空),並指明落庫是 `$set: null` 還是 `$unset`(GQL-06;ADR-0002:初始 seed 值欄位一律寫 `null`)。
  - 清單類端點的三件事:①候選清單的端點直接寫進票面;②「直接成員」還是「子樹成員」;③mutation 的 payload 回不回清單(不回就寫「加完失效哪幾把 query」)。
  - 測試用的金鑰 / 憑證**由 harness 現產、不入 repo**(假的私鑰也會被 secret scanning 當真的報;做法見 TEST-11「需要外部服務的劇本」)。
- **同一個行為只歸一張票**:導向、守衛這種橫跨畫面的行為(例:`mustChangePassword` → 導向改密碼頁),指定唯一的 owner 票,另一張只寫「沿用 owner 票」。
- **共用函式不指定「誰定義」,直接給簽章與所屬檔案**:例 `orgs/owner-protection.service.ts` 的 `assertTenantTopOperableBy(operator, org, action)`,誰先到誰寫、後到的 rebase 改用。
- **要 root-only 就指定權限 key 掛在 `system.org-manager.tenant-ops` 容器底下**:`isRootOnly` 是模組的旗標、不是權限的旗標(模板複製時整個模組被扣除),寫「這個動作要 root-only」等於沒寫。先例:`tenant-ops.provision` / `revoke-provision` / `transfer-owner`。
- **已知會超過 `max-lines` 400 的檔案,拆票時直接指定兩個檔名**。
- **討論定案的行為,逐條寫進 spec,寫到實作者不用回來問**:寫 spec(含改寫、拆節、改名)時,對照討論紀錄把每一條已定的決定落到正文,不能只剩一句大概。行為類的規格寫成「操作 → 結果」情境表,邊界(重複開啟、錯誤參數、沒權限、空資料)各一列,並寫明保存在哪、沿用哪個既有機制;驗收寫「表的每一列一個測試」。「與 X 無關」「依現況」「實作時再定」這類句子不能代替行為描述。代價:實作者照字面做,漏掉的行為要到審查才發現,回頭補規格、補票、重做(例:頁籤記住網址參數早已定案,改名拆節時只剩「與 RouteTabs 無關」,實作完才被審查抓到)。

### 分工與依賴

- **同一批會碰到同一個檔案的票,兩張票上都列分工表**:哪張建檔、哪張只能追加、共用的 harness / handler(`*-handlers.ts`、`*-test-support.ts`)歸誰。規則共用反而不是問題,沒人認領的共用檔才是衝突點。
- **同一批會疊到同一組檔的 E2E 票,票面寫「從前一張票的分支切」**:劇本 E2E 共用 `apps/e2e/src/fixtures/` 與 `permission-scenarios.md` 的「E2E」欄,並行各自從 `main` 切,後合的那張一定衝突。
- **對照組模組的 i18n 與測試夾具「各自一份」要明寫**:共用看起來省事,一有分歧就得拆回去,而且拆的時候兩張票都已經合了。
- **「某功能還沒實作、被別的測試借去當反例」的耦合要標出**:票上寫「本票會讓 X 的測試失去反例,連帶修 X 屬於本票」;更好的做法是反例改用永不實作的夾具(`apps/admin/src/test/msw/module-fixtures.ts` 的 `placeholderModules`)。
- **「等某票合併後再派」寫 `Blocked by: #<n>`,不用 `needs-info`**:那個標籤的語意是「票面本身有問題要先解開」。

### 欄位、seed 與規格邊界

- **票面提到的欄位逐一對過 schema**(`apps/api/src/database/schemas/*.schema.ts`),推導出來的欄位尤其要:例 `roles.kind` 不是資料庫欄位,而是 api 依操作者算出來的回傳欄位;判準類的欄位要寫「正本在哪」(例:角色種類的判準正本是 `apps/db-migrator/seeds/registry.ts` 的宣告清單)。
- **spec 與設計稿「各說一半」的欄位點名**:`status` 還是 `enabled`、`name` 還是 `title`,實作者只會看到其中一邊。
- **規格寫明邊界條件**:例「停用的角色不可選」要補「已持有 + 已停用時仍可取消」,否則照字面實作會讓人永遠拔不掉那個角色。
- **seed 類的票**:①明寫「連帶修 api 既有測試寫死的數字屬於本票」(例 `apps/api/src/permission/permission.test.ts`);②加業務資料會讓 root 視角的既有測試「多出資料」(清單筆數、分頁、樹的節點數都會變);③拆票前先查 `apps/db-migrator/seeds/` 能沿用什麼,能沿用就不新增。

### 驗收條件

- **驗收項寫成「現況 / 期望」兩行**,連帶讓「其實已經是對的」那幾項當場消掉。
- **「僅確認、不改」的項目分開寫**:票上分「要改的」與「確認後不動的(附為什麼)」兩節,否則實作者會把後者也動一遍。
- **「逐一檢查同型」類的驗收項,要求 PR 列出「確認不動」的結論**,否則「檢查過沒問題」與「漏了」在 PR 上分不出來。
- **驗收條件要在該環境驗得到**:先核對資料與 `deploy/env/<環境>.yaml` 的現值(例:未啟用通知信或未設收件白名單時,該環境無法驗對應行為),缺少條件就改成單元測試覆蓋或註明需要的前置資料。
- **驗收回報附當時的 dev 部署版本**(release PR 或 commit),否則「當下看到、事後重現不出來」的項目無從判斷。
- **「驗收缺口」類的票附原始 payload、操作順序、當時的環境與版本**,否則實作者只能重現、猜條件。
- **部署後抓一次 bundle 驗「打包資產」**:跟著 build 烘進產物的非程式檔(help.md、i18n 字典、範本),部署完直接抓該環境 bundle 確認(做法見 pitfalls「部署與產物」);新增這類資產時同步補 Dockerfile 的檢查(`docs/deployment.md`「建置產物的規則」)。
- **重整「驗收遺留票」的範圍前,先逐項對 `git log` 確認哪些已經修掉**(`git log --oneline --grep=<關鍵字>`),已修的在票上劃掉並註明是哪個 commit / PR 修的。

### 文件的歸屬

- **規則本文只由文件票寫**:ADR、`docs/concepts/`、`docs/standards/`、模組文件的行為說明與「admin 頁面」節、`docs/agents/module-scaffold.md`。實作票只碰必然連動的兩處:`docs/modules/<key>.md` 的「api 介面」節與 `apps/admin/src/md/module-help/{base,project/additions,project/replacements}/<key>.help.md`。
- **要讓程式票順手改規則本文,票面寫明例外**:「本票例外可改 `<檔>` 的『<段名>』,只改這一段」;沒寫就留給文件票,實作票寫進 PR 的「規則回饋」。
- **同段的文件票與實作票會寫到同一份模組文件時,拆票就分好誰寫哪一節**。
- **`CLAUDE.md` 在每張票上都明確歸進「可改」或「不可改」**:預設不可改(入口文件,改動影響每一個 agent);要改就開獨立的文件票。

## Wayfinding 操作

供 `/wayfinder` 使用。**map(地圖)** 是一個 issue,**child(子票)** 是掛在它底下的 tickets。

- **Map**:一個貼上 `wayfinder:map` 標籤的 issue,內文放 Notes / Decisions-so-far / Fog。`gh issue create --label wayfinder:map`。
- **Child ticket**:以 GitHub sub-issue 連到 map 的 issue(透過 `gh api` 呼叫 sub-issues endpoint)。若 sub-issues 未啟用,退而求其次:把子票加進 map 內文的 task list,並在子票內文開頭寫 `Part of #<map>`。標籤:`wayfinder:<type>`(`research` / `prototype` / `grilling` / `task`)。被認領後,子票 assign 給負責的開發者。
- **Blocking(阻擋關係)**:用 GitHub 原生 issue dependencies。新增阻擋邊:`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`,其中 `<blocker-db-id>` 是阻擋者的 **database id**(`gh api repos/<owner>/<repo>/issues/<n> --jq .id`,不是 `#number` 或 `node_id`)。GitHub 回報的 `issue_dependencies_summary.blocked_by` 只計 open 的阻擋者。dependencies 不可用時,在子票內文開頭寫 `Blocked by: #<n>, #<n>`。所有阻擋者都關閉後,子票即解除阻擋。
- **Frontier query(找下一張可做的票)**:列出 map 底下 open 的子票(`gh issue list --state open`,範圍限定在 map 的 sub-issues / task list),排除仍有 open 阻擋者或已有 assignee 的票;依 map 順序取第一張。
- **Claim(認領)**:`gh issue edit <n> --add-assignee "@me"` —— session 的第一個寫入動作。
- **Resolve(解決)**:`gh issue comment <n> --body "<answer>"`,接著 `gh issue close <n>`,最後把 context 指標(gist + 連結)補到 map 的 Decisions-so-far。

正本:GitHub REST API「Issue dependencies」、「Sub-issues」
