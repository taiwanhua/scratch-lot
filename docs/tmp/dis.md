# 底座待討論與待辦

只放**底座**的討論與待辦,隨底座版本同步到各引用專案;專案自己的討論與待辦放 `docs/tmp/project-dis.md`。只留**還開著**的,每項附現況;做完就從本檔刪掉(歷史查 git)。已定案的規則不寫在這裡:架構事實見 `docs/architecture.md`,程式規範見 `docs/standards/`,領域規則見 ADR 與 `CONTEXT.md`,部署見 `docs/deployment.md`,常用指令與 skill 見 `docs/agents/toolbox.md`。

引用本檔時用**條目標題的關鍵字**(例:「dis.md 搜『populate』」),不用編號。

## 需要討論決策

### 自訂 `/to-figma` skill

設計系統收尾的唯一剩項:由 spec 產出 Figma 設計稿,之後實作照稿產出程式碼。Figma 端的做法(殼元件實例覆寫、備用槽、RWD 三檔)已寫在 `docs/standards/general/figma.md`。

現況:未開票;與下一項「module-scaffold 入口與設計流程整合」合併設計。

### module-scaffold 入口與設計流程整合

新增後台模組的步驟以 `docs/agents/module-scaffold.md` 為正本(藍本 = 示範模組 1 / 2),skill 入口須沿用其專案登記路徑。需求引導仍須取得:①模組中文命名 ②掛哪個側欄群組、共幾層(1~3)③生成哪些頁(列表 / 詳情 / 新增 / 編輯)④頁籤顯示名稱 ⑤有無檔案 / 圖片欄位 → 引導選公開或私有 bucket(準則見 ADR-0010:預設私有;需 CDN / SEO / 未登入展示 / 社群分享才公開)⑥要不要宣告資料範圍目標(`dataScopeTarget`,ADR-0008)。

現況:已有 `.claude/skills/module-scaffold/` 入口,build 流程與驗收指向共同文件,沿用專案登記路徑。不同工具的本機副本一致性與 `/to-figma` 整合仍待整理,依 toolbox/issue tracker 的共同流程,不另訂授權或測試 SOP。

### AI 自動 PR review 的時機

GitHub Actions 上的 AI review 與本地 `/code-review` 怎麼分工。

現況:未開票,待使用者裁決。

### Turbo remote cache

現況:未開票;等 CI 時間變長再評估。

### 抽 `@repo/db-schemas` 共用型別

seed(`apps/db-migrator/seeds/`)與 api(底座 `apps/api/src/database/schemas/`、專案 `src/project/database/`,見資料模型地圖)的欄位形狀各有來源(ADR-0002 種子段);漂移開始造成問題時,評估抽成 packages 套件供兩邊 import 型別。

現況:未開票;尚未出現漂移。

### BaseRepository 支援 populate

populate 的子查詢不帶操作者上下文,對租戶資料會拋錯(ADR-0005 已知限制);需要時加 `populate` 選項,由 repository 轉傳上下文(`apps/api/src/database/base.repository.ts`)。

現況:未開票;目前沒有模組需要 populate。

## 以後可能做

決定要做時才開 issue。

### 退回到指定的關卡

讓審核者退回到前面指定的某一關;退回修改目前只回到申請人。

現況:未開票;再評估時機:推進判斷表要大改;有實際需求時。

### 審核者臨時加簽

審核者在審核當下加一位審核者或插入一關。

現況:未開票;再評估時機:派任計畫固定,動態插入關卡牽動大。

### 收回已做的核准

審核者撤銷自己已被接受的核准。

現況:未開票;再評估時機:少用,且與後續關卡衝突。

### 電子簽章

核准或單據附上具法律效力的電子簽章。

現況:未開票;再評估時機:需要憑證與法規研究。

### Cloudflare 付費方案

即時通道使用 Cloudflare 免費方案;超出免費額度時改付費方案。

現況:未開票;再評估時機:用量接近免費額度時。

### 收據機透過 WebUSB 列印

瀏覽器直接透過 WebUSB 送指令給收據機,不經代理程式。

現況:未開票;再評估時機:之後再評估。

### 列印代理程式自動更新

代理程式自行下載並安裝新版。

現況:未開票;再評估時機:第一版手動更新,改版少。

### 代理程式 macOS 簽章(Apple 開發者帳號)

macOS 版代理程式加上 Apple 簽章,安裝時不必手動解除隔離標記。

現況:未開票;再評估時機:每年 99 美元;先用解除隔離標記。

### 代理程式支援 Intel Mac

代理程式加建 Intel Mac 版本。

現況:未開票;再評估時機:需要時再加建置目標。

### 一週起始日由租戶設定

一週目前固定從星期日開始;改成租戶可設定。

現況:未開票;再評估時機:有租戶需要時。

### 依另一欄位篩選以外的動態 lookup

lookup 的動態條件目前只有「依另一欄位篩選」;加其他動態條件(例如依目前時間)。

現況:未開票;再評估時機:無需求。

### 通知管道:手機推播、LINE

通知送到手機推播、LINE 等管道;通知已可登記管道,每個管道需要自己的轉接器。

現況:未開票;再評估時機:有需求時加轉接器。

### 聯絡對象 API

用人員條件查出可處理的人名:模組在後端登記條件,前端只能指定名稱;只回顯示名稱、最多 5 人;權限限能使用該功能的人。

現況:未開票;再評估時機:有模組要在提示裡顯示「找誰處理」時。

### 現有 Overlay 參考畫面的背景改成打開它的頁面

依畫圖檢查清單 14(對話框背景是打開它的頁面),把底座現有 `Screen / Admin …` 各頁的 `Overlay / …` 背景改成打開它的頁面;在 wowgo-base 改,release 後同步回各專案。

現況:未開票;再評估時機:本輪共用改良回收到 wowgo-base 後。

### `ScheduleTimeline` 拖拉長條改時間 / 換人

時間軸目前用點選 + 對話框改排班;改成可直接拖拉長條改時間或換人。

現況:未開票;再評估時機:點選 + 對話框不夠用、有實際需求時。

## 小任務

### Claude hook 在 git worktree 誤報

`scripts/claude-hooks/post-edit-check.mjs` 以 `process.cwd()` 當 repo 根跑檢查:session 在 worktree 內啟動時正常;若 session 在主 checkout、卻編輯 worktree 裡新增的 workspace,turbo / 套件查找會落在主 repo,可能誤報「No package found」。修法:以「被編輯檔案向上找到的 repo 根」為工作目錄。

現況:未開票;worktree 內啟動的 agent 未再回報,主 checkout 編輯 worktree 檔的情形未驗證。

## 外部條件觸發(追蹤中)

### unicorn 升級

`eslint-plugin-unicorn` 釘在 65(`packages/config-eslint/package.json`),等 ESLint 10 生態穩定,連 ESLint 一起升。

現況:等外部條件。

### api 錯誤處理總策略 / module 邊界細則 / schema 演進規範

schema 演進指向後相容 + 破壞性變更配遷移腳本,落點 `docs/standards/api/`。

現況:底座/專案登記與 import 方向見 STRUCT-12;跨業務 module 的一般依賴細則、錯誤處理與 schema 演進仍待更多 feature 經驗再歸納,未開票。

## 下一步

跨 repo 升級與回收依共同計畫接續;引用專案的業務需求與外部資源待辦寫在各專案的 `docs/tmp/project-dis.md`。
