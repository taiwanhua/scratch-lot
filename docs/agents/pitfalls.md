# 陷阱清單(症狀 → 做法)

實作時撞過的坑,每條一行:左邊是你會看到的症狀,右邊是做法。流程本身見 [issue-tracker.md](./issue-tracker.md),指令大全見 [toolbox.md](./toolbox.md)。

## worktree 的 Bash 守衛

- **含 `$(...)`、管線接變數、`for` 迴圈的指令被守衛拒絕** → 拆成平鋪的單行指令,一次一件事。
- **`VAR=… 指令` 這種環境變數前綴被擋** → 改用 PowerShell:`$env:E2E_GREP="劇本 7"; pnpm e2e`。
- **heredoc 餵多行內容給指令被擋**(`gh pr create --body-file -`、`git commit -F -`、`gh issue comment --body-file -`) → 先用 Write 工具把內容寫成 scratchpad 裡的檔(檔名帶票號),再 `--body-file <檔>` / `git commit -F <檔>`;單行 commit 訊息用 `-m` 即可。
- **一支 python 腳本用 `pathlib` 批次寫多個檔被判定太複雜而擋掉** → 一次只改一個檔,或直接用 Write / Edit。
- **建 `.claude/hook-typecheck-off` 的指令被整條擋掉** → 單獨一行做、做完 `ls .claude/` 確認;還是被擋就略過(只是每次寫檔多等一次 typecheck,不影響交件),不要繞路關 hook。
- **`cd <路徑> && git …`、`git -C <路徑> …` 被擋** → 直接下 git(工作目錄已在該 repo / worktree)。
- **子殼層 `( cd <pkg> && … )` 被擋** → 改 `pnpm -C <pkg> …`。
- **把輸出導到 `.claude/` 底下被擋** → 導到 scratchpad。
- **`git checkout -- <檔>` 丟棄變更被擋** → 用 Edit 把內容改回。
- **同一種寫法被擋一次** → 換上面的寫法;不改權限設定去繞。
- **commit 落到別人的分支**(共用目錄的 HEAD 被另一個 agent 切走) → 只動 ref 修:`git branch -f <分支> <正確 sha>` 再 push;不在共用目錄 checkout / reset,以免再動到對方的工作目錄(預防見 collaboration「一票一位寫入 owner、一個工作樹」)。
- **scratchpad 裡的暫存檔被別的 agent 覆蓋** → scratchpad 是共用的,檔名一律帶票號。
- **`git stash pop` 撈到別的 session 的東西** → stash 堆疊與主 checkout、其他 worktree 共用;改用 WIP commit,非用不可就 `git stash push -u -m "<票號>-<標記>"`,再以 `git stash list` 找到自己那筆當下的 `stash@{n}` 去 apply。

正本:`.claude/settings.json`(PostToolUse hook)、`scripts/claude-hooks/post-edit-check.mjs`

## Windows / PowerShell

- **PowerShell 把繁中印成亂碼、`sed -i` 對含 CJK 的行靜默不生效** → 用 Write / Edit 工具,或 `python - <<'PY'` 寫單檔精準取代腳本。
- **`gh issue view --comments` 的純文字輸出被截斷** → 改用 `gh issue view <n> --json body,comments`。
- **`--add-assignee @me` 報 splat 錯誤** → 加引號:`--add-assignee "@me"`。
- **多行指令用 `\` 續行後壞掉** → PowerShell 沒有 `\` 續行,整條寫成一行(看板移卡指令尤其)。
- **PowerShell 5.1 不認 `&&`** → 用 `A; if ($?) { B }`,或改用 Bash 工具。
- **`>` / `*>` 導出的檔案 `iconv -f UTF-16` 之後變亂碼** → 這台機器導出的就是 UTF-8,直接讀,不要再轉。
- **含 `jq` 的指令輸出空白、沒有報錯** → 這台機器沒有外部 `jq`,一律用 `gh … --jq '<filter>'`。

正本:`apps/e2e/README.md`(`$env:` 寫法)

## python 寫檔

- **python 寫出的 `.md` 讓 `format:check` 紅(CRLF)** → `open(path, "w", encoding="utf-8", newline="\n")`。
- **heredoc 裡的 `\n` / `\.` 寫進檔後多一層或被吃掉,且不報錯** → 內容含反斜線時用 Edit / Write;非用腳本不可就把腳本用 Write 寫成 scratchpad 的 `.py` 檔再 `python <檔>`,少掉 shell 那一層跳脫。

## CJK 與標點

- **`Edit` 對含 CJK 的 markdown 表格列報「String to replace not found」** → prettier 用半形空白補齊 CJK 欄寬,還原不回原樣;改用 python 以 `line.startswith("| \`KEY\`")` 定位整列替換或插列(`newline="\n"`),寫完 `pnpm exec prettier --write <檔>` 重排。不要手動調空白。
- **全形 / 半形標點混進文案,只在斷言比對時才發現** → 從既有條目複製標點,或 `python -c "print([hex(ord(c)) for c in s])"` dump 碼位比對;慣例是半形 `,` `:` `?` `(` `)` `;`、全形 `「」` `。` `—`。
- **腳本全檔替換 `packages/i18n` 的 JSON 掃到別的 namespace** → 字典一律用 Edit / Write 只改那幾個字面字元。

正本:`packages/i18n/messages/zh-TW/`

## 新 worktree 與依賴

- **lint / typecheck 對 `@repo/*` 報「cannot be resolved」**(`apps/db-migrator` 也會,它依賴 `@repo/domain/module-icon`) → `pnpm install` 後跑 `pnpm exec turbo run build --filter=@repo/graphql --filter=@repo/ui --filter=@repo/domain`。
- **PostToolUse hook 與 `format:check` 一路報「Command "prettier" not found」** → 新 worktree 沒有 `node_modules`,純文件票也要先 `pnpm install`。
- **`--filter=admin` 找不到套件** → filter 一律寫全名 `@repo/admin`。
- **`schema:generate` 解不開 workspace 套件型別** → 先依 [toolbox 建置前置步驟](toolbox.md#pnpm--turbo建置測試格式)準備產物,包含 domain 與 project-config。
- **改檔名為 PascalCase 時 `unicorn/filename-case` 連目錄名一起紅** → 先在該包啟用 `frontend-style` 設定再搬檔。

正本:根 `package.json`、`packages/config-eslint/`

## jest / turbo 快取

- **`turbo run test` 回 `cache hit, replaying logs`,取到的 `origin/main` 測試數是別人先前跑的結果** → turbo 快取跨 worktree 共用;取基準要進 package 目錄直接跑 jest(`docs/standards/testing/testing.md` TEST-08「測試數的基準」)。
- **本機 turbo 的 lint / check-types 綠、CI 卻被 type-aware warning 擋下** → 也是快取命中;交件前進 package 目錄跑 `pnpm run lint` 與 `pnpm run check-types`。
- **改了根 `package.json` 的 script(`format` 這類)但 `turbo run …` 仍 `cache hit`** → turbo 的 global hash 不含根 scripts;直接跑那個 script 本人(`pnpm run format:check`)。
- **只跑一個測試檔卻跑了整包 / 旗標沒作用 / `pnpm exec jest` 直接炸** → 單檔測試一律照 `docs/agents/toolbox.md`「pnpm / turbo」的 `pnpm --filter <pkg> exec …` 寫法,三種常見錯法也列在那裡。`--testPathPatterns` 比對完整路徑,包含 worktree 目錄名;用完整測試檔名(如 `workflow-seed-export.test.ts`),避免只寫 `seed-export` 而意外命中整包。
- **PostToolUse 的 ESLint 在「先加 import、下一次編輯才用到」的中間態報紅** → 把 import 與用到它的程式合成一次 Edit,或接受那一次紅、下一次編輯完自然轉綠;不要關 hook 或改 lint 設定。

正本:`turbo.json`、`apps/admin/package.json`、`docs/standards/testing/testing.md`(TEST-08)

## mock 模式與截圖

- **`dev:mock` 靜默跳到別的埠,連到別的 worktree 沒關掉的 server** → `pnpm --filter @repo/admin dev:mock --port <自選埠> --strictPort`(**不要加 `--`**,加了 vite 會忽略後面的旗標),網址以終端印出的 `Local:` 為準。
- **截圖「完全正常」但其實是別人的畫面** → 截圖前在畫面上找到自己這次的改動(改文案就找那句文案)。

正本:`apps/admin/vite.mock.config.ts`、`docs/standards/testing/testing.md`(TEST-08「mock 開發模式」)

## PR、CI 與看板

- **`gh pr checks --watch` 永遠等、看板也沒動** → PR 對 `dev` 是 `CONFLICTING` 時 GitHub 不建 merge ref,CI 與 `project-status.yml` 都不跑;先 `gh pr view <n> --json mergeable`,衝突就 rebase 到最新 `origin/main`。
- **force-push 之後 `mergeable` 回 `UNKNOWN`** → 等幾秒重查,不代表有衝突。
- **剛開 PR 一個 check 都沒有** → Actions 可能在排隊,沒有 check 不等於失敗。
- **`gh pr checks --required` 永遠非零退出、輪詢轉到逾時** → 免費方案沒有 required checks,不要加 `--required`;輪詢寫成單行 `until gh pr checks <n>; do sleep 30; done`。
- **rebase 到 `origin/main` 解不掉衝突,衝突對象是「已合 `dev`、還沒 release」的 feat** → 改成疊票:本票接到那張 feat 分支的尾端(已開工就用 `git rebase --onto <那張的分支> origin/main` 把本票 commit 搬過去),PR 仍目標 `dev`、內文寫明疊在哪張之上,前票先合。不從 `dev` 切、不 rebase 到 `dev`、不把 `dev` / `main` merge 進來(規則正本 deployment.md「分支模型」)。
- **疊票鏈缺一個已單獨 release 的共通修正(CI、測試工具),CI 在鏈上紅** → 把那個 commit `cherry-pick` 到鏈的底部分支,其上的票 rebase 跟上;不 merge `dev` / `main`。
- **rebase 後仍 `CONFLICTING`,但本地 `git merge-tree --write-tree origin/dev HEAD` 乾淨** → 交叉 merge base,實作者解不了;回報主流程 reset 該 base,base 更新後 `gh pr close <n>` → `gh pr reopen <n>` 才會重跑 CI(deployment.md「交叉 merge base」)。不要自己改 `dev` / `staging`。
- **開了 PR,票卡卻還在 In Progress** → 自動化靠 PR 內文的 `Closes #<n>` / `Refs #<n>` 找票:內文沒寫、PR 是 draft(轉 ready 時才移)、或 PR 不是目標 `dev` 時都不會移;補上內文或照 issue-tracker「看板」的指令手動移。
- **PR 合進 `dev` 後票沒有自動關** → `Closes #<n>` 只在合進預設分支 `main` 時生效;Released 時才關票。
- **新開的「只手動觸發」workflow `gh workflow run` 叫不動** → `workflow_dispatch` 要求檔案已在 `main`;暫加 `push: branches: [<你的分支>]` 驗一次、綠了移除再開 PR(issue-tracker「新增一個只手動觸發的 workflow」)。

正本:`.github/workflows/project-status.yml`、`.github/workflows/ci.yml`、`docs/deployment.md`(二、「分支模型」「交叉 merge base」)

## 部署與產物

- **部署成功,但 help.md / 字典這類跟著 build 烘進產物的檔案不在 bundle 裡** → 部署後開該環境 admin,DevTools 抓 `assets/index-*.js` 搜一個一定會出現的字串;新增這類資產時同步補 `.dockerignore` 例外與 Dockerfile 的產物檢查。
- **改了 `.dockerignore` / Dockerfile,部署卻整個 build 被跳過** → 這兩個檔不屬於任何 package,`turbo ls --affected` 看不到;部署加 `-f force=true`。
- **換了 `VITE_*` / `NEXT_PUBLIC_*` 的值重 build,產物裡還是前一個值** → 變數沒登記進該 package `turbo.json` 的 `tasks.build.env`,build 直接 cache hit(STRUCT-08)。
- **front 部署出現 `Deployment rate limited`** → Vercel 帳號層級的額度,等回復再推,不要改 workflow。

正本:`docs/deployment.md`、`apps/admin/Dockerfile`、`apps/admin/scripts/check-help-bundle.mjs`、`.dockerignore`
