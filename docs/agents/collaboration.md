# 跨工具協作與接手

此規則適用人員、Claude、Codex 與其他 agent。目標是任何接手者只靠 repo + issue/PR 就能繼續,不需要前一位的聊天、個人記憶或本機交接目錄。

## 共同正本與角色

`CLAUDE.md` 是所有 agent 的文件入口;目前行為、決策與操作留在版控正本,任務範圍、進度與驗收紀錄留在 issue/PR。看板 Status 是任務生命週期正本,流程見 [issue tracker](issue-tracker.md);分支、批次 release、部署及對齊規則見 [deployment](../deployment.md)。本文件不另訂第二套 SOP。

repo 擁有者的協作偏好(溝通、動手前的同意、進行中的停點)正本是 [working preferences](working-preferences.md);本機 `~/.claude/CLAUDE.md` 與 Claude 專案的 Project instructions 只放它的副本。

常用分工是 Codex 規劃、審查與協調主流程,Claude 負責程式與測試。這是角色分配,不是工具限制:Claude 可以單獨承接規劃、實作、審查與主流程,也能換其他人員或 agent;依當前使用者授權與 issue 分工執行,不需要先喚醒 Codex。

任務計畫只保存未完成範圍與待決事項;完成後依 [STRUCT-11](../standards/general/structure.md#struct-11-正式文件寫現況完成的計畫歸回正本) 精簡歸入既有正本並移除暫存文件。共同文件不可把必要規格只指向 `.codex/`、聊天連結或個人絕對路徑。工具本地紀錄可以協助恢復,但不能代替共同正本。

方案討論與規格設計遵守 [STRUCT-13](../standards/general/structure.md#struct-13-方案設計先核對現況優先延伸既有機制):先核對專案實際用法,優先延伸既有機制。規則本文只在結構規範維護,各工具的記憶與指引指向同一正本。

## 一票一位寫入 owner、一個工作樹

- 每張票明訂一位負責寫入與交付的 owner,在獨立 worktree/分支實作。主流程記錄 issue、owner、分支及 worktree;跨電腦交接以分支/commit/PR 為準,本機路徑只供當下協調。
- 同票可分派唯讀調查或審查。若需平行修改,owner 必須先切出互不重疊的檔案範圍;不得讓兩位 agent 同時改同一檔。不同票會碰同檔時,先定分工或依賴,由 owner 整合,不靠最後覆蓋。
- 主流程不直接在實作者正在寫入的工作樹改檔。派會 checkout / commit 的 agent 一律給獨立 worktree;它還在跑時,主流程也不在共用目錄 commit、checkout 或 reset:同一個工作目錄只有一個 HEAD,一方切分支,另一方的 commit 就落到別的分支(撞了照 [pitfalls](pitfalls.md)「worktree 的 Bash 守衛」只動 ref 修)。交接需先停止原 owner 寫入,保存目前工作並更新 issue/PR,再把 owner 轉交。
- 不將其他票、個人 hooks、機密、未核定的 skills 副本混入 commit。已有未提交修改先核對用途,保留與本票無關的工作。

## 開工與恢復時要取得的資料

先讀 `CLAUDE.md`、`docs/README.md`、issue 全文/留言及 Parent spec,再按指路讀本票正本、規範與工具文件。上下文壓縮或恢復後,先重讀 `CLAUDE.md` 與 [issue tracker](issue-tracker.md) 再接手,並重新核對分支、工作目錄差異與實際產物;摘要只是查找線索。每次 git 操作(切分支、merge、rebase、push、release)前,先對照 [deployment](../deployment.md)「分支模型」與「Release 步驟」。工具特有要求如 `AGENTS.md` 另照其規則執行,不要求其他工具具備相同本機目錄。

下列資訊須能從共同文件與 issue/PR 找到:

| 內容       | 必須清楚的事                                                         |
| ---------- | -------------------------------------------------------------------- |
| 目標與範圍 | 問題、期望行為、可改/不可改檔案、依賴與驗收                          |
| 決策與待決 | 哪些已確認,哪些只是提案;未決介面不可當成 Ready 的程式票              |
| 工作基線   | 分支/commit、相關 PR、已完成與剩餘修改;未提交候選 patch 的可取得位置 |
| 驗證與限制 | 實際命令、環境與結果;局部測試不足之處、尚未操作的外部資源            |
| 執行責任   | 當前 owner、下一步負責人與主流程;合併、部署仍依既有授權及 SOP        |

找得到的已定案要求不要重新問使用者。只在缺少資訊且會影響結果時提出具體問題;不將實作者的猜測寫成既定規格。

## 交付與換手

實作者依 issue tracker 的交件格式回報,附 PR、測試結果與規則回饋。主流程核對實際 diff、驗收及 CI,再依現有看板/部署流程處理;本地測試通過、PR 合 dev、production 已發布是不同狀態。

換手時更新 issue/PR:指出可取得的分支與 commit、尚未提交的候選改動、下一步與未驗證項,確保下一位在新 clone 可重現。重要新決策須依文件歸屬規則回寫正本,不能只留一句「見對話」。

### 換帳號

額度用完等原因改用另一個 Claude 帳號時,哪些東西跟著帳號走:

| 換帳號後看不到(跟著帳號走)                                                                  | 不受影響                                                                     |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Claude 專案本身、Project instructions、專案記憶、thread 紀錄(專案只屬於一位使用者,不能分享) | repo(GitHub)、本機記憶與對話紀錄、`~/.claude/CLAUDE.md`、已 push 的分支 / PR |

步驟:

1. 新帳號開新的 Claude 專案,把 [working preferences](working-preferences.md) 全文貼進 Project instructions。
2. 要用雲端 thread 時,讓新帳號能存取 GitHub repo(安裝 Claude GitHub App)。
3. 開工照上方「開工與恢復時要取得的資料」,再讀該 repo 的 `docs/tmp/handoff-*.md`。
4. 接續未完成的分支。

前提是平常就做到兩件事:重要決定寫進 repo,不依賴專案記憶;thread 常 commit、常 push。

### 換電腦

跨電腦交接以分支 / commit / PR 為準(見上方「一票一位寫入 owner、一個工作樹」),新電腦只需要把工具與登入準備好:

| 項目                    | 怎麼做                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| repo                    | 各 repo 用 `gh repo clone <owner/repo> <路徑>` 取得                                              |
| Node / pnpm             | 版本照根 `package.json` 的 `engines` / `packageManager`                                          |
| Claude Code、外掛與 MCP | 安裝 Claude Code 與外掛;MCP 接 Figma、瀏覽器                                                     |
| 登入                    | `gh`、`gcloud`、Vercel、Figma                                                                    |
| `~/.claude/CLAUDE.md`   | 從 [working preferences](working-preferences.md) 複製全文                                        |
| 本機環境變數            | 依 [env registry](../env-registry.md);機密值從 Secret Manager / GitHub Secrets 取,不從舊電腦複製 |
| 本機記憶                | 只手動帶「不能進 repo 的機密指路」;規則與做法已在 repo 文件                                      |
| 暫存腳本                | 不搬;常用做法以 [toolbox](toolbox.md) 為準                                                       |

開工後在各 repo 跑一次本機檢查:`pnpm install`,再照 [toolbox](toolbox.md)「pnpm / turbo:建置、測試、格式」的建置前置步驟建置共用套件,最後跑 `pnpm exec turbo run check-types` 與 `pnpm run format:check`。接續進行中的分支時,照「開工與恢復時要取得的資料」重新核對。

skills 只提供問答順序、觸發及正本指路;共用步驟應有唯一版控來源。平台入口內容不一致時,先核對正本並回報差異,不要讓不同工具各維護一套業務規則。CLI 與一般工具路徑見 [toolbox](toolbox.md),指令問題見 [pitfalls](pitfalls.md);不把某個工具是否安裝當成共同規格的前提。
