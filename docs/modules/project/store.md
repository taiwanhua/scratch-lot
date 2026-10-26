# 店面管理(技術)

## 用途

店裡每天收錢、賣刮刮樂的地方(專案規格第 6 章):**看板**(每個收銀點的標題列與檯面上的本)、**本機收銀點**(每台裝置設定、存在瀏覽器)、**收銀班次**(開班、班次資訊、改對應排班)、**投庫 / 出庫**、**抽屜應有現金**與看板的**即時同步**;**銷售**(刷條碼、相機、快速銷售、手動標記)、**當下撤銷**、**卡片原地展開**、**拆本**、**移櫃 / 收回**。**撤銷售出申請**、**現金更正單**(兩張表單、撤銷售出 / 現金更正分頁);**盤點**與**盤點確認申請**(盤點頁、差異核對、盤點紀錄分頁);**交班結帳**與**結帳確認申請**(交班精靈、班次結帳歷史紀錄分頁、檢視頁);**日結**(日結精靈、日結逾期提醒與側欄數字)與**存銀行**。

正本:`apps/db-migrator/seeds/project/store.ts`、`packages/domain/src/project/lottery/store.ts`

## 模組 key 與畫面

| key                 | 名稱     | sidebarType  | 路由                 | 說明                                                                                              |
| ------------------- | -------- | ------------ | -------------------- | ------------------------------------------------------------------------------------------------- |
| `store`             | 店面管理 | link(列表頁) | `/store`             | 表單模組(開啟 B9b);列表頁換成分頁頁殼 `StorePage`(分頁 看板 \| 班次結帳歷史紀錄 \| … \| 其他申請) |
| `store.view-page`   | 詳情     | hidden       | `/store/view-page`   | 表單引擎的詳情(綁定的表單)                                                                        |
| `store.create-page` | 新增     | hidden       | `/store/create-page` | 表單引擎的新增                                                                                    |
| `store.edit-page`   | 編輯     | hidden       | `/store/edit-page`   | 表單引擎的編輯                                                                                    |

- 側欄順序 `order: 10`、圖示 `store`;沒有側欄數字。
- **開啟 B9b**(`perFormCreate`):每張表單發布時自動建 `store.create-<formKey>`(新增資格看它,不看模組 `create`)。
- 分頁登記在 `apps/admin/src/pages/project/lottery/store/store-tabs.ts`,各功能依規格 6.1 的順序追加自己那一列;目前有 看板(`store.view`)、班次結帳歷史紀錄(`store.view`,交班結帳的功能)、盤點紀錄(`store.view`,盤點的功能)、撤銷售出、現金更正(`store.view`)、兌獎紀錄(`store.view`,兌獎的功能)與 其他申請(表單引擎的預設列表 `FormListPage`)。
- 新增頁 `store.create-page` 換成 `StoreCreatePage`:撤銷售出申請(`/store/create-page/sale_reversal`)用替換新增頁、盤點確認申請(`/store/create-page/stocktake_confirm`)是盤點頁、結帳確認申請(`/store/create-page/checkout_confirm?shift=`)是交班精靈,其他表單(現金更正單、租戶自己綁的表單)沿用表單引擎的新增頁。
- 檢視頁 `store.view-page`、編輯頁 `store.edit-page` 換成 `StoreViewPage` / `StoreEditPage`(`forms/StoreSubmissionPages/`):讀到那一筆的表單代號後分派 —— 盤點確認申請 → 盤點單明細 + 審核 / 退回後打開盤點頁(帶入原內容);結帳確認申請 → 結帳單明細 + 審核 / 退回後打開交班精靈(帶入原內容);其他表單沿用表單引擎。之後的表單在同一處追加。
- 網址狀態:`?tab=`、看板 / 撤銷售出 / 現金更正 / 兌獎紀錄的分店 `?org=`(切分頁不換店)、其他申請的篩選 `?list=`、兌獎紀錄的篩選與頁碼 `?redemptions=`、盤點紀錄的篩選與頁碼 `?stocktakes=`、班次結帳歷史紀錄的篩選與頁碼 `?checkouts=`;撤銷售出申請新增頁的帶入值 `?org=`、`?ticket=`;臨時盤點的分店 `?org=` 與範圍 `?scope=`(收銀點 id,空 = 全店);交班結帳帶入的那一班 `?shift=`(`app/project/url-state-inventory.ts`)。
- 共用元件(`apps/admin/src/components/project/lottery/`):`CashPointHeader`(收銀點標題列;按鈕用 `actions` 陣列,各功能追加自己的按鈕)、`BoardBookCard`(看板卡片;`expanded` = 展開中的主色框)、`TicketGrid`(`flash` 讓刷到的那一格閃一下)、`DenominationCount`(依面額清點;交班精靈、結帳確認申請檢視頁、日結共用)。

正本:`apps/db-migrator/seeds/project/store.ts`、`apps/admin/src/app/project/module-pages.ts`

## 權限表

規格 3.2:表單模組固定四條 + 頁內權限;開啟 B9b 的 `store.create-<formKey>` 由表單發布時建立。

| 權限 key                         | moduleId 指向 | 它是哪一頁的什麼                                                                                                                 |
| -------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `<每個節點>.*`                   | 各節點        | wildcard;seed 自動產生                                                                                                           |
| `store.view`                     | `store`       | 看板分頁 + `lotteryStoreBoard`、`lotteryShiftInfo`;換發 `board:<分店>` 憑證的資格(`project/realtime-boards.ts`)                  |
| `store.create`                   | `store`       | 表單引擎的新增(開啟 B9b 後,有表單時改看 `store.create-<formKey>`)                                                                |
| `store.edit`                     | `store`       | 表單引擎的編輯;**也代表「店長」**(見下方)                                                                                        |
| `store.delete`                   | `store`       | 表單引擎的刪除                                                                                                                   |
| `store.create-sale_reversal`     | `store`       | 撤銷售出申請的新增(B9b,表單發布時建立):撤銷售出分頁的 [+ 新增撤銷售出申請]、撤銷確認視窗的 [送撤銷售出申請]                      |
| `store.create-cash_correction`   | `store`       | 現金更正單的新增(B9b):現金更正分頁的 [+ 新增現金更正單]                                                                          |
| `store.create-stocktake_confirm` | `store`       | 盤點確認申請的新增(B9b):臨時盤點的 [送出盤點確認申請](盤點頁另要 `store.stocktake`)                                              |
| `store.create-checkout_confirm`  | `store`       | 結帳確認申請的新增(B9b):交班精靈的 [送出](精靈另要 `store.checkout`)                                                             |
| `store.sell`                     | `store`       | 銷售:`sellLotteryTickets`(刷條碼 / 相機 / 快速銷售 / 移櫃並售出 / 展開卡片的 [標記售出])                                         |
| `store.undo-sale`                | `store`       | 當下撤銷:`undoLotteryTicketSale`;售出提示的 [撤銷]、[最近售出] 每列的 [撤銷]、展開卡片的 [撤銷售出]                              |
| `store.split`                    | `store`       | 本機收銀點開班中 [拆本] + `splitLotteryBook`(含分放到多個收銀點、標跳號)                                                         |
| `store.move`                     | `store`       | `moveLotteryTickets`、`recallLotteryTickets`;展開卡片的 [移櫃] [收回] [移櫃並售出];刷到別人的班的檯面要它才能移櫃並售出          |
| `store.redeem`                   | `store`       | 兌獎(兌獎的功能)                                                                                                                 |
| `store.undo-redeem`              | `store`       | 撤銷已結帳的班或別人登記的兌獎(兌獎的功能)                                                                                       |
| `store.open-shift`               | `store`       | 未開班的收銀點 [開班] + `lotteryStoreOpenShiftForm`、`openLotteryShift`、開班視窗的 [打卡] `punchLotteryShiftStart`              |
| `store.deposit`                  | `store`       | 本機收銀點開班中 [投庫] + `depositLotteryShiftCash`                                                                              |
| `store.withdraw`                 | `store`       | 本機收銀點開班中 [出庫] + `withdrawLotteryShiftCash`;開班視窗的「從小金庫領零用金」(第一班)                                      |
| `store.bank-deposit`             | `store`       | 頂部 [存銀行] + `lotteryBankDepositForm` / `depositLotteryVaultToBank`                                                           |
| `store.stocktake`                | `store`       | 看板頂部 [盤點] + `lotteryStocktakeSheet`、`lotteryStocktakeReview`;[補登售出] 另要 `store.sell`、[補登兌獎] 另要 `store.redeem` |
| `store.checkout`                 | `store`       | 標題列 [交班結帳] + `lotteryCheckoutWizard`(負責人或店長才能送出);頂部 [日結] + `lotteryDailyCloseWizard`                        |
| `store.skip-stocktake`           | `store`       | 交班精靈第 ① 步、日結精靈第 ② 步的「跳過盤點」                                                                                   |
| `store.confirm-lost`             | `store`       | 盤點待查清單的「確認遺失」(送出時掛接點再檢查)                                                                                   |

- **店長 = 持有 `store.edit`**:規格「只有這一班的負責人或店長」沒有對應的權限,角色又是租戶資料、不能用名稱判斷,所以「店長類操作」(改別人的班的對應排班;之後的 [交班結帳] 也一樣)一律看 `store.edit`。租戶把店面管理的「編輯」開給別的角色,那個角色也會被當成店長。判斷集中在 `apps/api/src/project/lottery/store/store-access.ts` 的 `isStoreManager(grant)`,之後的票沿用同一支,不另寫。
- **沒有權限時**(按鈕直接不顯示):沒有 `store.open-shift` 看不到 [開班];沒有 `store.deposit` 看不到 [投庫];沒有 `store.withdraw` 看不到 [出庫](開班視窗沒有「從小金庫領零用金」);沒有 `store.split` 看不到 [拆本](刷到未拆的本只顯示資訊);沒有 `store.move` 看不到 [移櫃] [收回] [移櫃並售出];沒有 `store.sell` 看不到 [標記售出];沒有 `store.undo-sale` 看不到 [撤銷售出] 與售出提示的 [撤銷];沒有 `inventory.recover` 刷到待查的張只提示、看不到 [尋回];沒有 `store.stocktake` 看不到 [盤點];沒有 `store.confirm-lost` 待查清單沒有「確認遺失」;沒有 `store.sell` 差異核對沒有 [補登售出];沒有 `store.redeem` 盤點頁沒有 [補登兌獎]。
- 開通時建立的角色(規格 3.3,`apps/db-migrator/seeds/project/onboarding/role-grants/store.ts`):總部管理、店長 店面管理全部(各節點 `*`,含 `bank-deposit`);店員 `view`、`sell`、`undo-sale`、`split`、`move`、`redeem`、`open-shift`、`deposit`、`withdraw`、`stocktake`、`checkout`(不含 `bank-deposit`、`undo-redeem`、`skip-stocktake`、`confirm-lost`;撤銷售出申請、現金更正單、盤點確認申請、結帳確認申請的新增 `store.create-sale_reversal` / `store.create-cash_correction` / `store.create-stocktake_confirm` / `store.create-checkout_confirm`)。

## 頁面規則

**總部替分店建的單,分店看得到、但不能改**:四張表單(結帳確認申請、盤點確認申請、撤銷售出申請、現金更正單)都設依欄位共用 `sharedByFieldKeys: ["branch"]`(底座 `docs/modules/forms.md`「依欄位共用」):送出後,看得到單上「分店」的人(分店的人、可見範圍含那家店的上層主管)在列表、單筆(含申請中心的詳情頁)都看得到,只能看、不能修改 / 刪除 / 作廢;草稿不共用。

### 看板(ST-01 / 02 / 34)

- 頂部:分店選擇器 `OrgTreeSelect scope="visible"`(預設目前組織,`?org=`)、本機收銀點下拉、「你開著的班:店內櫃台 · 店外攤位」(自己在這家店開著兩個以上的班時)、連線狀態小圓點(`useRealtimeStatus`:綠 = 即時、黃 = 重新連線中);沒有重新整理按鈕。右側:上次日結、[盤點] [存銀行] [日結](見「日結與存銀行」)與距上次盤點超過 24 小時的提醒(見「盤點」)。
- 每個啟用中的收銀點一條 `CashPointHeader`(依收銀點排序、名稱 `zh-Hant`),下面是檯面上的本(`BoardBookCard`)。
- 標題列按鈕(依狀態與權限):未開班 → [開班];開班中的本機收銀點 → [最近售出](只在自己開的班)[投庫] [出庫] [拆本];開班中的其他收銀點、負責人是自己 → [切換到這個收銀點];其他只顯示狀態。
- 開班中的標題列:「負責人 王小明 · 08:02 開班」(臨時代班加「未對應排班」;點這一行開班次資訊)、本班已售(張 / 金額,售出 − 撤銷)、應有現金。
- 卡片:遊戲代號 + 名稱、面額、本號(6 位)· 今日售出、剩餘進度條、「剩 N / 總數」、剩很少(剩餘 ≤ 總張數 10%,`isLowStock`)。左側色條 = 遊戲顏色(標籤色票;沒設 = 灰)。
- **本機收銀點**:存在瀏覽器 `localStorage`(`lottery-store.local-cash-point.<分店>`,`lib/project/lottery/local-cash-point.ts`),依分店分開記;讀不到當作沒設定。沒設定 → 提示「這台裝置還沒設定本機收銀點…」+ [設定本機收銀點](ST-03);本機收銀點沒開班 → 提示只能查看。
- 切換本機收銀點時,目前的本機收銀點是自己開著的班 → 先確認(ST-34b)。

### 銷售與拆本(ST-05–10、ST-35–37)

正本:`packages/domain/src/project/lottery/store-sales.ts`(刷到時怎麼處理、當下撤銷的條件、拆本的檢查;api 與 admin 共用)。

- **刷到時**:看板宣告掃描用途 `store-sale`(條碼槍與相機同一條路);其他沒有宣告用途的頁面刷到刮刮樂 → **快速銷售**小視窗(ST-06,Enter 確認、Esc 取消;殼上的 `QuickSaleHost`,店 = 目前組織、收銀點 = 這台裝置在那家店的本機收銀點)。api `lotteryStoreScan` 解析碼、找本店的張,回每一筆的處理方式 `outcome`:

| outcome           | 情況                                                                         | 畫面                                              |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| `sell`            | 在本機收銀點檯面                                                             | 看板直接售出;快速銷售先開小視窗                   |
| `sell_other_mine` | 在別的收銀點檯面、那一班是自己開的                                           | ST-05a 確認後算那一班,不移櫃                      |
| `move_and_sell`   | 在別的收銀點檯面(別人的班)、有 `store.move`                                  | ST-05b 確認後寫「移櫃」+「售出」,算本機收銀點的班 |
| `move_forbidden`  | 同上、沒有 `store.move`                                                      | ST-05e「這張在店外攤位,你沒有移櫃權限…」,不寫事件 |
| `unopened`        | 這本在這家店還沒拆                                                           | ST-05d 拆本並售出(有待標註先在精靈標跳號)         |
| `recover`         | 待查 / 遺失(別家店的也是)                                                    | ST-05f 尋回(`RecoverTicketDialog`,回到這家店)     |
| `blocked`         | 不是本店、已售(帶售出時間)、跳號、報廢、鎖定、在途、在庫存(已拆的本收回的張) | ST-05e 不能銷售                                   |
| `info_only`       | 沒設本機收銀點、本機收銀點沒開班、沒有 `store.sell`                          | 只顯示資訊                                        |

本號在本店對到兩款以上遊戲 → 每款一筆,畫面先選遊戲(ST-05c)。

- **錢算在哪一班**:`sellLotteryTickets` 依上表決定;售出寫「售出」事件(金額 = 遊戲面額,讀不到遊戲 → `GAME_NOT_FOUND`、`cashEffect` 增加、`shiftId` = 那一班),移櫃並售出另先寫「移櫃」。張的狀態與事件經帳本(條件更新,`TicketLedgerService`);要動的那一班在交易內先 `drawerVersion` +1(和投庫 / 出庫互相序列化),班已結帳 → `LOCAL_SHIFT_NOT_OPEN`。
- **同時兩次售出**(第 17 章第 3 題看板一側):帳本的條件更新只讓一個成功;失敗方收到 `ALREADY_SOLD`(`extensions.soldAt`),畫面顯示「這張刮刮樂已於 hh:mm 售出」。
- **售出提示**:底座 Snackbar「已售出 5164-056527-012 200 元 · 店內櫃台 [撤銷]」(ST-35a);標題列 [最近售出](ST-35b,`lotteryStoreRecentSales`):自己在這一班 30 分鐘內賣的張,撤銷後那一筆顯示「已撤銷」。電腦 / 平板右側抽屜、手機底部面板。
- **當下撤銷**(ST-08a / b):條件 = 自己賣的、30 分鐘內、那一班還開著、售出之後那張沒有其他事件(`saleUndoBlockOf`)。確認視窗先讀 `lotteryStoreSale`(`undoBlock`),符合 → `undoLotteryTicketSale` 寫「撤銷」(`cashEffect` 減少、同一班;條件更新的版本由伺服器從售出事件推,不用畫面傳來的版本,檢查之後有人動過這張 → `CONFLICT`);不符 → 「請改送撤銷售出申請」+ [送撤銷售出申請](持有 `store.create-sale_reversal` 才顯示;開撤銷售出申請新增頁並帶入那一張,見下方「撤銷售出申請與現金更正單」)。
- **手動標記售出**(ST-07):展開卡片選本機收銀點檯面上未售的張 → 確認視窗(張號區段、單張金額、合計、原因);原因必選(欄位管理「手動標記原因」`lottery-manual-sale-reason`,預設「刷不到條碼」)。`source = manual`,只收本機收銀點檯面上的張。
- **卡片原地展開**(ST-36a/b/c;`lotteryStoreBookCard`):電腦 / 平板在那張卡片後面占滿整列(CSS grid `dense`)、主色框;手機底部面板。一次只展開一張;再點同一張、[收合] 收起。格子:這個收銀點的未售 / 已售 / 本班售出(售出算進這個收銀點目前這一班)/ 在別的收銀點(含收回到庫存的張,tooltip 寫在哪)/ 已選。操作列依選到的狀態與收銀點(共同可用的按鈕):本機 · 未售 → [標記售出] [移櫃] [收回];本機 · 本班售出(一張)→ [撤銷售出];本機 · 待查 / 遺失 → [尋回];其他收銀點 · 未售 → [移櫃] [移櫃並售出]。[本的詳情] 連到庫存管理的本的詳情頁(沒綁就不顯示)。刷到展開中的這本時,那一格閃一下。
- **拆本**(ST-37 → ST-09):[拆本] 先列本店還沒拆的本(`lotteryStoreUnopenedBooks`,未售的張全在庫存;可刷條碼或輸入本號選中,開著時宣告掃描用途 `store-split`)→ 精靈:① 標跳號(只有待標註 > 0 才出現,點滿才能 [下一步])② 全部放到一個收銀點(預設本機)或分放到多個收銀點(每一張都分配完才能 [確認拆本])。`splitLotteryBook` 寫「跳號」與「拆本」事件(檢查 `splitPlanProblemOf`);跳號的張不算庫存(看板總張數不含)。拆本分放到多個收銀點算拆本,不需要 `store.move`。
- **移櫃 / 收回**(ST-10b / 10a):全部(這個收銀點檯面上這本未售的張)或部分(格子選的);`moveLotteryTickets` / `recallLotteryTickets` 寫「移櫃」/「收回」事件(誰、時間、從哪到哪),不需審核。
- **相機掃描**(規格 6.3、18.3):頂部 [📷 掃描] 只在有相機的手機 / 平板顯示(`pointer: coarse` + `videoinput`);全螢幕相機框,連續掃描(同一個碼 2 秒內只算一次),讀到的碼注入 B10(`injectScan`),和條碼槍同一條路。讀碼用 `@zxing/browser` 的一維碼讀取器;實票掃不出來就調整碼制(`docs/tmp/project-dis.md`「條碼實機測試清單」)。測試以 `setCameraReaderFactory` 注入模擬的讀碼結果。

### 撤銷售出申請與現金更正單(ST-31a/b、ST-32a/b)

正本:`packages/domain/src/project/lottery/store-forms.ts`(表單代號、欄位 key、存值解析、送出前的值檢查);掛接點規則 `apps/api/src/project/lottery/store/store-forms-rules.service.ts`。

兩張都是**受管表單**(`seeds/project/revisions/sale_reversal.r3.seed.ts`、`cash_correction.r2.seed.ts`):綁 `store`、**沒有草稿**(`allowDraft: false`)、單號 `SR-0001` / `X-0001`、作廢原因用共用「作廢原因」(`void-reason`)。流程不 seed,由開通腳本建(`onboarding/form-workflows/store-forms.ts`)。

| 表單         | formKey           | 欄位                                                                                                                                                                                                                                                                                                  | 新增頁           |
| ------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 撤銷售出申請 | `sale_reversal`   | 分店 `branch`、張數 `lines[{ book, ticket_nos, tickets, amount }]`(每本一列)、原因 `reason`(欄位管理「撤銷售出原因」`lottery-sale-reversal-reason`)、退款給客人 `refund`(是 / 否)、退款班次 `refund_shift`(`lottery_shift`,退款 = 是才顯示)、說明 `note`、退款金額 `refund_amount`(明細金額合計,計算) | 替換(ST-31b)     |
| 現金更正單   | `cash_correction` | 分店、方向 `direction`(現金增加 / 減少)、金額 `amount`(正整數)、位置 `place`(某一班的抽屜 / 小金庫)、班次 `shift`(位置 = 抽屜才顯示)、歸屬班次 `attributed_shift`(選填)、原因類別 `reason`(欄位管理「現金更正原因」`lottery-cash-correction-reason`)、說明 `note`(必填)                               | 表單引擎(不替換) |

**建議流程設定**(開通腳本建的那一份,規格 2.1):兩張都是一關「店長審核」,人員條件「角色 店長 且 所屬組織屬於表單欄位『分店』(本身)」,**B5 申請人是審核者時自動通過**(`autoApprove.applicant`;店長自己送的單直接完成)。租戶要改審核者,自己改流程。

- **撤銷售出分頁**(ST-31a):`lotteryStoreSaleReversals(orgId)`,列 單號、張數(每本一段「5164 #031–032」+ 張數)、原因、退款(退款 = 否顯示「—」)、退款班次、狀態;點列開表單引擎的詳情。分頁頂部分店 `OrgTreeSelect scope="visible"`;[+ 新增撤銷售出申請] 只在 `moduleForms` 的這張表單 `canCreate`(= 持有 `store.create-sale_reversal`)時顯示。電腦 / 平板表格、手機卡片。
- **撤銷售出申請新增頁**(ST-31b,`SaleReversalCreatePage`):分店、原因;刷條碼(宣告掃描用途 `store-sale-reversal`,不會跳快速銷售)或輸入編號 → `lotteryStoreScan` 找到張,本店已售的加進那一本的一組格子(格子資料 `lotteryStoreBookCard`;本店已售且沒被鎖定的張可選,其他「不能選」);選原因時依預設代碼帶入退款(`REFUND_DEFAULT_REASON_KEYS`:客人退貨 = 是,其他含租戶新增的 = 否),可改;退款班次 `lotteryStoreShiftOptions(orgId)`(本店開著的 + 最近 14 天開過的班,預設操作者自己開著的班 `mine`);退款金額 = 面額合計(唯讀)。送出走表單引擎 `createAndSubmitFormSubmission`(`useFormDraft`)。從看板撤銷確認視窗進來帶 `?ticket=<張 id>&org=<分店>`:讀那次售出的顯示鍵換成正面編號去刷、以張 id 對到那一張。退款給客人 = 是且有收據機時按鈕是 [送出並列印收據](否則 [送出]):送出成功後印退貨退款收據再離開(見「列印」)。
- **現金更正分頁**(ST-32a):`lotteryStoreCashCorrections(orgId)`,列 單號、方向、金額、位置(小金庫 / 那一班)、歸屬班次、原因、狀態。新增用表單引擎的預設新增頁(ST-32b;位置選抽屜時才出現「班次」)。

**掛接點**(`store-forms-lifecycle.ts`;單據可能是總部建的,讀寫以租戶邊界上下文,張經帳本的系統寫入):

| 表單         | 時機                                  | 做什麼                                                                                                                                                                                                                                                                                              |
| ------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 撤銷售出申請 | `beforeSubmit`                        | 分店在申請人的可見範圍;每張是本店已售(`orgId` = 分店、狀態 = 已售)、沒被別的單鎖定(不在其他未結束的撤銷單上);每列金額 = 遊戲面額 × 張數、退款金額 = 合計;退款 = 是 → 退款班次是本店的班                                                                                                             |
|              | `submitted`                           | 張鎖定 `lockedBy = { refType: "sale_reversal", refId }`(盤點標示「撤銷審核中」、不能賣、不能當下撤銷);同時兩張撤銷單鎖同一張 → 後到的帳本 `CONFLICT`、整個送出回復                                                                                                                                  |
|              | `returned` / `withdrawn` / `rejected` | 解除鎖定(駁回什麼都不記;退回 / 撤回後重送再檢查、再鎖)                                                                                                                                                                                                                                              |
|              | `completed`                           | 每張寫「撤銷」事件 `sale_undo`(`refType = sale_reversal`、`cashEffect = none`):改回未售、回到最近一次售出記的收銀點(檯面);解除鎖定;退款 = 是 → 現金流水「退貨退款」`refund`(抽屜 → 外部)記在退款班次:班開著 → 先鎖住那一班(`drawerVersion` +1)、計入應有;已結帳 → 事後更正(`postCloseOf` = 那一班)  |
|              | `beforeVoid`                          | 一律擋下(`STORE_FORM_VOID_NOT_ALLOWED`)                                                                                                                                                                                                                                                             |
| 現金更正單   | `beforeSubmit`                        | 分店在可見範圍;位置 = 抽屜 → 那一班是本店的班;歸屬班次(有填)是本店的班(可以是已結帳的班,只做歸屬)                                                                                                                                                                                                   |
|              | `completed`                           | 現金流水「現金更正」`correction_increase` / `correction_decrease`,另記 `attributedShiftId`:位置 = 某一班 → 那一班的抽屜(開著:`drawerVersion` +1、計入應有;已結帳:事後更正);位置 = 小金庫 → 小金庫(和出庫同一個守門文件序列化 `StoreVaultGuard.serialize`;減少不檢查小金庫應有,登記的是實際短少的錢) |
|              | `beforeVoid`                          | 一律擋下                                                                                                                                                                                                                                                                                            |

- **完成時不檢查應有夠不夠**:撤銷售出申請完成時退款班次開著、抽屜應有不夠退款 → 照記(應有可以變負),由那一班交班結帳的差額呈現;不在審核後擋下(錢已經當面退給客人,擋下只會讓帳和現實不符)。
- **小金庫的現金更正「減少」不檢查小金庫應有**:現金更正單登記的是實際短少的錢(例:假鈔、存款短少),短少已經發生,擋下只會讓帳記不進去;出庫、存銀行、調貨從小金庫付現這類「從小金庫拿錢」的動作才檢查應有(`StoreVaultGuard.assertCovers`)。現金更正只碰同一個守門文件(`StoreVaultGuard.serialize`,帶掛接點交易的 session)和它們序列化。
- 完成時讀不到退款班次 / 位置那一班或單據(送出後被刪)→ `CONFLICT`;值不完整 → `VALIDATION_FAILED`;整個核准回復。

流水的 `refType = "store"`、`refId` = 提交 id、`refRevision` = 修訂號。完成時對 `board:<分店>` 送 `board` 信號。**不能選已關帳月份**:`beforeSubmit` 以退款班次、現金更正位置(某一班)的開班時間問帳戶管理的 `PeriodLock.closedPeriodOf`(規格 10.4;歸屬班次可以選已關帳月份,報表歸「前期更正」);開班、改對應排班選的排班以開始時間 `PeriodLock.assertPeriodOpen`。

**給交班結帳的查詢**:`StoreFormsQueryService.pendingCashImpacts(reader, shiftId)`(`LotteryStoreModule` 匯出)回審核中的現金更正單(位置 = 這一班,±金額)與撤銷售出申請(退款 = 是、退款班次 = 這一班,−退款金額),依送出時間排;交班精靈第 ③ 步列出並自動帶入差額原因(規格 6.9)。

**事後更正**(規格 6.12):現金流水的 `postCloseOf` 指向被更正的那一班。抽屜應有的現金流水來源(`CashLedgerService.sumShiftMovements`)不含事後更正,所以那一班結帳時的應有不變;事後更正淨額用 `CashLedgerService.postCloseNet(reader, shiftId)`(退貨退款 −、現金更正 ±)。

### 盤點與盤點確認申請(ST-13 / 14 / 15 / 16、ST-29、ST-30)

正本:`packages/domain/src/project/lottery/stocktake.ts`(盤點內容的形狀、與盤點那一刻比對的差異、送出前檢查;api 與 admin 共用)、`apps/api/src/project/lottery/stocktake/`、`apps/admin/src/pages/project/lottery/store/stocktake/`。

- **入口**:看板頂部 [盤點](`store.stocktake`)→ 盤點範圍(ST-16:全店 / 單一收銀點)→ 盤點頁 = 盤點確認申請的新增頁 `/store/create-page/stocktake_confirm?org=&scope=`。距離上次送出的盤點(不算已駁回)超過 24 小時,看板頂部提醒「建議盤點一次」(`lotteryStocktakeStatus`)。交班精靈第 ① 步嵌入同一組元件(`StocktakeCountStep` + `StocktakeReviewStep`,只盤那個收銀點;見「交班結帳」);日結精靈第 ② 步同樣做法(盤全店,`scopeCashPointId = null`)。
- **沒有「盤點中」**:盤點過程只在畫面上(規格 6.0),重新整理或離開就從頭盤;[送出] 時才建立盤點單。[補登售出]、[補登兌獎] 例外,按下就立即生效,畫面註明「立即生效」。
- **盤點頁**(ST-13;`StocktakeWorkspace` + `useStocktakeFlow`):左欄本清單依收銀點分組(每本 已盤 / 未盤 / 差異 N / 目前這本;手機改成上方的下拉),每個收銀點旁 [補登兌獎](`store.redeem`,沿用兌獎視窗;沒有開著的班停用並說明)與應有現金;右欄選中的本:點格子 / 掃描(不用數量;已選 = 在)、系統數字(開始盤這本那一刻)、實盤、差異;全店盤點另有「未拆的本(在 / 不在)」與「待查清單」(找到了要刷條碼:整本都待查的一組刷到任一張就算整本找到,零碎待查的一組只有刷到的張算找到、其他維持待查 / 確認遺失要原因 / 繼續待查)。
- **掃描用途** `store-stocktake`(`STOCKTAKE_SCAN_PURPOSE`):盤點頁開著時刷到的碼記為「在」(或待查清單的「找到了」),不會被當成售出;掃描欄標 `data-scanner-field`。
- **開始盤每本的時間 `countedAt`** = 盤點資料讀到的伺服器時間(`lotteryStocktakeSheet.serverNow`;重新盤點這本時重記),不受裝置時鐘影響。
- **比對**(`stocktakeTicketFactsOf` / `stocktakeDiffsOf`):那一刻的狀態由張數事件倒推(`countedAt` 之後第一筆事件的 `from`);那一刻未售、實際不在 → 差異「未售不在」;那一刻已售、實際還在 → 「已售還在」。之後被別人處理過(售出、移櫃、待查…)的張不再是差異(第 17 章第 1、2 題);自己這次補登的售出照列。撤銷售出申請鎖定的張標「撤銷審核中」,不算差異(第 6 題);調貨鎖定的張不比對。
- **差異核對**(ST-14;`lotteryStocktakeReview`):依本分組列出每一張,可多選後一次套用 —— 未售不在 → [補登售出] / [待查];已售還在 → [標記異常];整本 [重新盤點這本](已補登的售出不退)。畫面上的處理對不到目前的差異(已被其他盤點或操作處理掉、補登沒成功)→「這幾張已被處理,請重新核對」,[重新核對] 拿掉那幾張的處理。
- **[補登售出]**(`backfillLotteryStocktakeSales`,要 `store.sell` + `store.stocktake`):寫「售出(盤點補登)」事件(`sale_stocktake`、`soldSource = stocktake`、金額 = 面額、`refType = stocktake`)。那個收銀點有開著的班 → 鎖住抽屜(`drawerVersion`)算那一班;沒有 → 那個收銀點最近一班、記 `postCloseOf`(事後更正,不算那一班結帳時的應有);從來沒開過班 → 擋下(`STOCKTAKE_NO_SHIFT`)。帳本條件更新(版本 = 盤點時讀到的):兩人同時補登、補登與看板補刷同時 → 只有一個成功,失敗方 `CONFLICT` + `STOCKTAKE_ALREADY_PROCESSED`(第 17 章第 1、3 題)。回傳事件 id,盤點內容記下,送出時核對「是自己補登的」。
- **送出**(ST-15):各收銀點的補登售出與應有現金(已結帳 → 事後更正)、新增待查、標記異常、未拆的本不在、確認遺失(張 / 批購成本,有 `inventory.show-cost` 才給成本)、說明 → [送出盤點確認申請] 經表單引擎 `createAndSubmitFormSubmission`(退回後再送出走 `submitFormSubmission`)。
- **沒盤完可以送出**(使用者 2026-10-21 定案):還有本沒盤時送出視窗提示「還有 N 本沒有盤;沒盤的本不比對,盤點單會記下未盤的本」。送出時 api 算出範圍內(單一收銀點 / 全店啟用中的收銀點)檯面上還有未售的張、卻不在盤點內容裡的本 × 收銀點,記進盤點單 `uncountedBooks[]`(遊戲、本號、收銀點)與 `summary.uncountedCount`;不比對、不記差異,張維持系統狀態;退回後再送出時重算。盤點紀錄分頁在狀態旁標「N 本未盤」,檢視頁列出那幾本;之後可另開一次盤點補盤。報表讀 `summary.uncountedCount`。
- **盤點確認申請**(受管表單 `stocktake_confirm`,`seeds/project/revisions/stocktake_confirm.r3.seed.ts`):分店、盤點範圍、彙總(盤點頁組好帶入)、說明、盤點內容(系統,`serializeStocktakeDraft` 的 JSON;唯讀時不顯示);沒有草稿、單號 `ST-0001`、作廢原因類別 `void-reason`(作廢一律擋下)。掛接點(`stocktake-lifecycle.ts`):
  - `beforeSubmit`:盤點內容讀得懂、分店一致;有 `store.stocktake`(確認遺失另要 `store.confirm-lost` 與原因);每筆差異都已處理且還對得到(`STOCKTAKE_DIFF_STALE` / `STOCKTAKE_DIFF_UNHANDLED`)
  - `submitted`:同一個交易建立盤點單(待核准;退回後再送出改寫同一筆)、再比對一次(不合 → 整個送出回復)
  - `returned` / `withdrawn` → 已退回;`rejected` → 已駁回(補登的售出不退,錯了用撤銷售出申請「盤點錯誤」)
  - `completed`:依時間順序套用 —— 差異 [待查]、未拆的本不在(本店庫存裡未售的張)→ 待查(責任分店 = 本店);待查清單 確認遺失 → 遺失、找到了 → 尋回(回到本店庫存);各張以目前的版本條件更新;盤點之後被動過的張(差異看那本的 `countedAt`,未拆的本與待查清單看開始盤的時間,之後有任何張數事件)或已不是要的狀態就略過 —— 舊盤點晚完成不覆蓋新盤點的結果;標記異常只做記號。盤點單 → 已確認,`confirmedBy` = 這張申請目前流程實例裡最後核准的審核者(依決定時間;沒有已核准任務 = 申請人)
  - `beforeVoid`:一律擋下(`STOCKTAKE_VOID_FORBIDDEN`;待查錯誤刷到時尋回)
- **交班 / 日結的盤點介面**(結帳的功能用):`StocktakeService`(token `STOCKTAKE_SERVICE`,`LotteryStocktakeModule` 匯出)的 `checkDraft(operator, draft)`(送出前守門)、`submitStocktakeDraft(session, draft, { type, submissionId, tenantId, submittedBy })`(在結帳確認申請的同一個交易建立盤點單)、`markStatus(session, tenantId, submissionId, "returned" | "rejected")`、`apply(session, tenantId, submissionId)`(核准完成時套用)。
- **盤點紀錄分頁**(ST-29,`StocktakesTab`):篩選 類型、狀態(`?stocktakes=`);欄位 單號、類型、盤點時間、補登售出、新增待查、確認遺失、狀態(沒盤完送出的在狀態旁標「N 本未盤」);平板 / 手機改卡片;點一列開那張申請的檢視頁。
- **檢視頁**(ST-30,`StocktakeViewPage`):申請人、送出時間、類型、範圍;盤點單明細(本 / 收銀點 / 方式 / 系統 / 實盤 / 差異張號 / 處理,事後更正另標)、未盤的本(遊戲、本號、收銀點;沒盤完送出的才有)、未拆的本、待查清單、彙總(含未盤本數)+ 審核區塊;申請人在退回後 [修改後再送出] → 盤點頁帶入原內容。讀取依據:看得到那家店,或讀得到那張申請(審核者從申請中心進來)。
- **建議流程設定**(規格 2.1;開通腳本 `onboarding/form-workflows/stocktake-confirm.ts` 依租戶角色建立):一關「店長審核」,人員條件「角色 店長 且 所屬組織屬於表單欄位『分店』(本身)」,B5 申請人是審核者時自動通過(`autoApprove.applicant`)。

### 交班結帳與結帳確認申請(ST-17a / 17b / 18 / 19a / 19b、ST-27、ST-28a)

正本:`packages/domain/src/project/lottery/checkout.ts`(表單代號、欄位 key、結帳內容的形狀、面額表、應有 / 實點 / 差額與交接的檢查;api 與 admin 共用)、`apps/api/src/project/lottery/checkout/`、`apps/admin/src/pages/project/lottery/store/checkout/`。

- **入口**:收銀點標題列 [交班結帳](本機收銀點開班中、有 `store.checkout`;只有這一班的負責人或店長(`store.edit`)看得到)→ 交班精靈 = 結帳確認申請的新增頁 `/store/create-page/checkout_confirm?org=&shift=`。
- **精靈一次做完**(規格 6.0):步驟間的資料只在畫面上(`useCheckoutWizard`),[取消] 或重新整理不留任何資料;**補登兌獎例外**(立即生效,取消精靈也不會退回)。[送出] 以表單引擎 `createAndSubmitFormSubmission` 送出結帳確認申請,結帳單、盤點單在掛接點的同一個交易建立。
  - **① 盤點**(ST-17a):沿用 30 分鐘內的盤點(`lotteryCheckoutWizard.reusableStocktake`:這家店最近一張、範圍是這個收銀點或全店、待核准或已確認(已退回 / 已駁回不行)、開始盤的時間在 30 分鐘內)/ 現在盤點(嵌入盤點頁 `StocktakeCountStep` + `StocktakeReviewStep`,只盤這個收銀點;差異核對乾淨才能到下一步,刷到的碼記為「在」不會被當成售出)/ 跳過(`store.skip-stocktake`,原因必填,欄位管理「跳過盤點原因」;結帳單記 `skipReason`,報表永久標示「未盤點」)。
  - **② 兌獎**(ST-17b):這一班有效的兌獎逐筆(登記時間舊到新)、合計;[補登兌獎](`store.redeem`)沿用兌獎視窗,立即生效;點一列開兌獎紀錄詳情。
  - **③ 抽屜**(ST-18):左欄應有現金逐項(`ExpectedCashList`:每一項可點開明細,兌獎 → 兌獎紀錄詳情、現金流水 → 即時現金帳 `?movementId=`);右欄依面額清點(`DenominationCount`,面額 1,000 / 500 / 100 / 50 / 10 / 5 / 1)、實點合計、差額 = 實點 − 應有、差額原因(不為 0 時必填,欄位管理「結帳差額原因」);審核中的現金更正單 / 撤銷售出申請(`pendingCashImpacts`)列出並自動帶入差額原因「審核中的單據」(`pending-documents`)與說明「審核中:現金更正 #X-012 + 500、…」(都可改)。
  - **④ 確認**(ST-19a / b):應有各項、應有 / 實點 / 差額、盤點方式;交接:留給下一班(不能超過實點 —— 留給下一班的零用金是實點裡的錢)、接班人(選填,這家店啟用中的成員,不含申請人與這一班的負責人 —— 接班人 = 下一班的人)。留給下一班 > 0 時接班人必填;沒有接班人 → 留給下一班必須是 0(錢先投庫)、提示改由店長審核。有收據機時按鈕是 [送出並列印結帳單](沒有 = [送出]);送出成功後自動印交班結帳單(見「列印」)。
- **應有現金**(規格 6.9 公式):`ExpectedCashItems.of(reader, shift)`(`lottery/checkout/expected-cash.ts`;涵蓋的抽屜應有來源列在 `EXPECTED_CASH_SOURCE_NAMES`,`checkout.test.ts` 守門它必須等於 `drawerCashSourceNames()`,之後新登記的來源沒同步分項就紅)逐項 = 期初 + 銷售(售出 + 盤點補登 − 當下撤銷,只給張數與金額)− 兌獎(班開著時登記、沒有在班開著時撤銷的)− 投庫 + 出庫(扣掉開班領零用金那一筆)− 調貨支出 + 調貨收入 − 退貨退款 ± 現金更正;只算已完成的單據、不含事後更正(`postCloseOf`),與抽屜應有 `expectedDrawerCash` 同一套來源、合計相等(`checkout.test.ts` 逐項驗)。送出那一刻的各項快照進結帳單 `expectedItems`。
- **結帳確認申請**(受管表單 `checkout_confirm`,`seeds/project/revisions/checkout_confirm.r1.seed.ts`;交班與日結同一張,`type` 欄位分):分店、類型、收銀點、接班人(`reference(user)`,流程第 1 關的審核者)、應有 / 實點 / 差額 / 留給下一班(顯示用)、說明、結帳內容(系統,`serializeCheckoutDraft` 的 JSON;唯讀時不顯示);沒有草稿、單號 `C-0001`、作廢原因類別 `void-reason`(作廢一律擋下)。列表沒有 [+ 新增](只從精靈送出;`moduleForms` 仍回 `canCreate`,新增頁只接受 `?shift=`)。掛接點(`checkout-lifecycle.ts`,規則在 `CheckoutService`):
  - `beforeSubmit`:結帳內容讀得懂、與這一班對得上;有 `store.checkout`、是負責人或店長;班開著(退回後再送出 = 自己那張結帳的班);這一班沒有其他審核中的結帳(`CHECKOUT_PENDING_EXISTS`);盤點方式合法(沿用 → 待核准或已確認、還在 30 分鐘內、範圍對;現在盤點 → `StocktakeService.checkDraft`;跳過 → `store.skip-stocktake` + 原因);差額不為 0 要原因;交接(留給下一班非負整數、不超過實點 `CHECKOUT_LEFT_EXCEEDS_COUNTED`、> 0 要接班人 `CHECKOUT_LEFT_MUST_BE_ZERO`、接班人不是申請人也不是負責人 `CHECKOUT_SUCCESSOR_SELF`、是這家店的人 `CHECKOUT_SUCCESSOR_INVALID`)
  - `submitted`:同一個交易鎖住抽屜(`drawerVersion` +1,和售出 / 投庫序列化)、算應有各項並快照、建立(退回後再送出改寫)結帳單、現在盤點 → `StocktakeService.submitStocktakeDraft(type: "shift")` 建立盤點單(退回後再送出改成沿用 / 跳過 → 自己上一次建立的盤點單軟刪除,P24 沒有「已放棄」狀態)、**這一班結束**(`closedAt`、`checkoutId`;下一班可以先開)、下一班已先開(`previousShiftId` = 這一班、期初來自交接)→ 期初改成留給下一班(規格 8.7「退回修正跟著更新」)。**已知的低機率競態**:退回後再送出與下一班同時開班 —— 開班讀「留給下一班」(`registerHandoverAmount`)不在再送出的交易內,兩者交錯時下一班可能先以舊金額開班、再送出的 `updateMany` 沒更新到它(開班的寫入晚於 `updateMany`);發生時由店長用現金更正單調整下一班的期初,不另加鎖(機率極低、兩邊都是人工操作)
  - `returned` / `withdrawn`:結帳單 → 已退回(記 `returnedAt`,那一次送出的快照也記退回時間;自己建立的盤點單一起退回、記 `closedAt`(盤點單同樣另存 `firstSubmittedAt` 與每一次送出的快照 `attempts`:送出時間、退回 / 駁回時間、未盤本數));班不重開。結帳單另存第一次送出的時間 `firstSubmittedAt`(重送不改寫)與每一次送出的快照 `attempts`(送出時間、退回時間、差額、盤點方式、日結涵蓋的班),營運報表依期末那一刻有效的那一次算
  - `completed`:現在盤點 → `StocktakeService.apply`;結帳單 → 已確認,`confirmedBy` = 最後核准的審核者(兩關都跳過 = 申請人)。零用金成為下一班期初由 `registerHandoverAmount` 的登記讀結帳單(送出就算,核准前下一班先開也先用它)
  - `beforeReject` / `beforeVoid`:**一律擋下**(`CHECKOUT_REJECT_FORBIDDEN` / `CHECKOUT_VOID_FORBIDDEN`,只能退回)
- **建議流程設定**(規格 2.1、8.7;開通腳本 `onboarding/form-workflows/checkout-confirm.ts`):兩關 —— 第 1 關「接班人確認」審核者 = 表單欄位「接班人」,跳過條件 `{ or: [type == "daily", !successor] }`;第 2 關「店長審核」人員條件「角色 店長 且 所屬組織屬於表單欄位『分店』(本身)」,跳過條件 `{ and: [type == "shift", !!successor] }`。結果:交班有接班人 → 接班人審;交班沒有接班人 → 店長審;日結 → 店長審。第 2 關「申請人也是審核者時」= **照常審核**(`autoApprove.applicant = "review"`):店長自己交班(沒有接班人)或自己送日結時,任務派給他自己再檢查一次,不自動通過。第 1 關維持預設(接班人不能是自己)。租戶要改審核者,自己改流程。
- **班次結帳歷史紀錄分頁**(ST-27,`CheckoutsTab`):篩選 期間(送出時間)、收銀點、類型、狀態(申請的狀態:待審核 = `reviewing` / 已退回 / 已撤回 / 已完成;`?checkouts=`);欄位 單號、收銀點、類型、交班人、應有、實點、差額、狀態;平板 / 手機改卡片;點一列開結帳確認申請的檢視頁。
- **檢視頁**(ST-28a,`CheckoutViewPage`):類型、單號、狀態、申請人、送出時間;結帳單(收銀點、盤點方式、應有逐項可點回單據、應有 / 實點 / 差額與原因、留給下一班 / 接班人、送出時審核中的單據)、依面額清點(唯讀)+ 審核區塊;申請人在退回後 [修改後再送出] → 精靈帶入原內容(`lotteryCheckout.draft`)。讀取依據:看得到那家店,或讀得到那張申請(接班人 / 店長從申請中心進來)。
- **沒有權限時**:沒有 `store.checkout` 看不到 [交班結帳];別人的班、不是店長 → 看不到(api `canSubmit = false`、送出 `CHECKOUT_FORBIDDEN`);沒有 `store.skip-stocktake` 第 ① 步沒有「跳過盤點」。

### 日結與存銀行(ST-20–26b、ST-28b)

正本:`packages/domain/src/project/lottery/daily-close.ts`(結帳內容、精靈步驟、小金庫應有的各項、存入銀行的檢查、涵蓋計算期間沒有日結的日子、日結逾期的時點;api 與 admin 共用)、`apps/api/src/project/lottery/daily-close/`、`apps/admin/src/pages/project/lottery/store/daily-close/`。

- **頂部**(`useDailyCloseEntry`;ST-01、ST-20):「上次日結:10/13(已 3 天)」(`lotteryDailyCloseStatus`:上一張日結的 `coveredTo` 與距今的日曆日,租戶時區;沒有 =「還沒有日結」)、[存銀行](`store.bank-deposit`)、[日結](`store.checkout`)。**這家店所有收銀點的班都已送出交班結帳**才能按 [日結](看板資料:有收銀點開著班 → 停用,滑過列出「店內櫃台還沒交班」);已有審核中 / 已退回的日結也停用(「日結 C-0043 審核中」)。按下 → 日結精靈 = 結帳確認申請的新增頁 `/store/create-page/checkout_confirm?org=&type=daily`(`CheckoutConfirmCreatePage` 依 `type` 分派交班 / 日結;退回後的編輯頁 `CheckoutConfirmEditPage` 依結帳單的類型分派)。
- **涵蓋計算期間** = 上一次日結送出(上一張日結的 `coveredTo`)至這次日結**第一次**送出;退回後再送出不變(規格 6.10「送出:涵蓋計算期間定下」)。涵蓋的班 = 期間內**送出交班結帳**的班(以班的 `closedAt` 判斷,退回後再送出不會改它);每一班只會被一張日結涵蓋計算,送出後才送出交班結帳的班算下一次。**不能補日結**:畫面標示「涵蓋計算期間 10/14 09:02 ~ 現在(10/14、10/15 沒有日結)」—— 沒有日結的日子 = 上次日結那天起到今天的前一天(`dailyCloseGapDates`)。
- **精靈一次做完**(規格 6.0,`useDailyCloseWizard`;補登兌獎 / 補登售出例外,立即生效);訂閱 `board:<分店>`,各班的審核狀態即時更新。
  - **① 各班結帳**(ST-21):涵蓋的每一班的交班結帳(收銀點、交班人、送出、應有、實點、差額、審核者、狀態 已核准 / 待審核 / 已退回)。審核者是自己的列有 [審核] → 側邊打開結帳單(ST-22,`ShiftReviewDrawer`:結帳單摘要 + 審核區塊 `ApprovalSection`,核准 / 退回不離開精靈);別人審的顯示「等某某核准」(目前的待審任務);退回的顯示「待某某更正」(申請人)。**全部核准**才能 [下一步](「還有 N 班沒核准」)。
  - **② 全店盤點**(ST-23):同交班精靈第 ① 步(`CheckoutStocktakeStep`,範圍全店):沿用 30 分鐘內的**全店**盤點 / 現在盤點全店 / 跳過(`store.skip-stocktake` + 原因)。
  - **③ 小金庫**(ST-24):小金庫應有逐項(期初 = 上次**已完成**日結的清點金額 + 投庫 − 出庫 ± 調貨 ± 現金更正 − 存銀行;每筆可點回即時現金帳)、依面額清點(`DenominationCount`)、差額 = 實點 − 應有,不為 0 時原因必填(欄位管理「結帳差額原因」)。
  - **④ 存入銀行**(ST-25a):金額(0 = 不存;不能超過小金庫實點)、帳戶(`lotteryDailyCloseWizard.bankAccounts`:使用中、使用組織包含這家店;只有一個時自動帶入)、存入後小金庫應有。
  - **⑤ 確認**(ST-25b):涵蓋計算期間、全店盤點方式、各班結帳差額、小金庫差額、存入銀行 → [送出結帳確認申請](類型 = 日結);送出成功後自動印日結單(見「列印」)。
- **結帳確認申請(類型 = 日結)**:同一張受管表單 `checkout_confirm`,值 `type = daily`、`branch`、應有 / 實點 / 差額(小金庫)、`draft` = `serializeDailyCloseDraft`。掛接點 `checkout-lifecycle.ts` **依類型分派**(守門看值;事後動作讀申請的值):日結 → `DailyCloseService`(token `DAILY_CLOSE_SERVICE`),交班 → `CheckoutService`。
  - `beforeSubmit`:有 `store.checkout`;看得到這家店;沒有其他審核中 / 已退回的日結(`DAILY_CLOSE_PENDING_EXISTS`);第一次送出時這家店沒有開著的班(`DAILY_CLOSE_SHIFTS_OPEN`);涵蓋的交班結帳全部已確認(`DAILY_CLOSE_UNAPPROVED`);全店盤點方式合法(同交班,範圍 = 全店);小金庫差額不為 0 要原因(`CHECKOUT_REASON_REQUIRED`);存入銀行(`DAILY_CLOSE_DEPOSIT_INVALID` 金額不是非負整數或超過實點、`DAILY_CLOSE_ACCOUNT_NOT_USABLE` > 0 沒選帳戶或帳戶不能用)
  - `submitted`:同一個交易碰小金庫守門文件(`StoreVaultGuard.serialize`)、**再查一次**開著的班與涵蓋的交班全部已核准(送出時後端再檢查,`CONFLICT` + 同上的 reason)、算小金庫應有各項並快照(`expectedItems` / `expected`)、建立(退回後再送出改寫)結帳單、現在盤點 → `StocktakeService.submitStocktakeDraft(type: "daily")`(沿用 / 跳過照交班的做法)
  - `returned` / `withdrawn`:同交班(結帳單 → 已退回,自己建立的盤點單一起)
  - `completed`:套用全店盤點;存入銀行 > 0 → 同一個交易寫銀行「存入」(`BankTransactionsService.write`,歸屬分店 = 這家店,單據 = 這張申請;**已送出單據的系統寫入** `allowInactiveAccount`:送出時已驗過帳戶,核准前帳戶被停用照樣存入、也不再檢查使用組織 —— 比照進貨單 10/10 定案「停用只是不能再被選用,不影響已送出的單」)+ 現金流水「存銀行」(`bank_deposit`,小金庫 → 銀行,`bankTransactionId` 連到那筆存入;寫在結帳單 `bankTransactionId` / `bankMovementId`);結帳單 → 已確認(**小金庫從清點金額重新起算**)
  - `beforeReject` / `beforeVoid`:一律擋下(同交班)
- **小金庫起算點**(`daily-close-registrations.ts` → `registerVaultBaselineProvider`):最近一張**已確認**的日結 → `{ amount: counted, since: submittedAt }`(最後一次送出的時間 = 清點的那一刻)。之後的流水照常加總,含完成時寫的「存銀行」;例:清點 8,900(22:00 送出)、22:10 投庫 1,000、隔天核准時存銀行 5,000 → 小金庫應有 4,900。
- **第一班的判斷**(`registerDailyCloseCoverage`):上一班已送出交班結帳、而且這家店有一張日結的 `coveredTo` ≥ 那一班的 `closedAt`(那張日結已送出,不論狀態)→ 已被日結涵蓋 → 下一班是第一班。
- **審核中日結的存入金額保留**:日結送出到核准之間,存入銀行的金額已清點、等著存,`StoreVaultGuard` 的「能拿的錢」= 小金庫應有 − 審核中 / 已退回日結的 `bankDepositAmount`(`reservedForDailyClose`)。出庫、開班領零用金、[存銀行] 都照這個上限擋(例:應有 9,000、日結要存 5,000 審核中 → 最多再拿 4,000),核准後小金庫不會變負。存銀行視窗另回 `reserved` 顯示「其中 5,000 是審核中的日結要存入銀行的」。
- **存銀行**(ST-26a / b,`BankDepositDialog`,`depositLotteryVaultToBank`):金額、存入帳戶(只有一個時自動帶入)、備註;不用審核、做完就生效(同投庫、出庫)。同一個交易:碰小金庫守門文件並檢查**金額 ≤ 小金庫應有 − 審核中日結的存入**(`StoreVaultGuard.assertCovers`,`AMOUNT_EXCEEDS_VAULT`;和出庫序列化)→ 銀行「存入」(歸屬分店 = 這家店)+ 現金流水「存銀行」(`bankTransactionId` 相連)+ 稽核 `lottery-bank-transaction.create`。帳戶要使用中、使用組織包含這家店(`SettlementService.isAccountUsable`,也要操作者看得到);這家店**沒有任何可用帳戶** → `BANK_DEPOSIT_NO_ACCOUNT`(ST-26b),有但選的不能用 → `BANK_ACCOUNT_NOT_USABLE`。記錯:到帳戶管理沖正那筆「存入」,連結的「存銀行」流水自動反向(帳戶管理既有的連動)。寫入成功後自動印存款單(見「列印」)。
- **日結逾期**(B14;規格 3.4、3.5,`daily-close-reminders.service.ts`,排程工作 `lottery.daily-close-overdue` 每 15 分鐘):每家店**最早一張還沒被日結涵蓋計算的交班結帳**(以班的 `closedAt`),送出日的**隔天起每天**寄送時間(類型 `lottery.daily-close-overdue` 宣告可調時間「逾期後每天」,預設 09:00,租戶時區;`scheduleHitAt` 判斷)→ 負責人提醒(組織範圍 = 這家店本身,預設人員條件 = 持有 `store.bank-deposit`,即店長;`dedupeKey` 帶分店與當天的時點 → 同一家店一天一則;漏跑時 6 小時內補寄,例:09:00 漏跑 → 14:00 補寄、15:30 不寄)。被日結涵蓋後不再寄。連結到那家店的看板(`/store?tab=board&org=<分店>`,`lottery-notifications.md`「連結」)。逾期時點(`dailyCloseOverdueAt`:送出日隔天的寄送時間,日期換算一律用底座 `form/temporal.ts`)經 `daily-close-overdue.ts` 的 `isDailyCloseOverdue` 判斷,**提醒與側欄數字共用同一支**。
- **側欄數字**(`store-badge.ts`,模組 `store`,說明 `admin.lotteryStore.badgeDescription`):操作者看得到的店裡**日結逾期的店數**(同上的時點已過:`isDailyCloseOverdue`);時間會讓數字變,沒有信號,前端進站取一次、斷線時每 60 秒重抓(底座 10.4)。
- **檢視頁**(ST-28b,`CheckoutViewPage` → `DailyCloseSheet`):類型、涵蓋計算期間、涵蓋計算的班(「3 班(C-0040、C-0041、C-0042)」)、全店盤點、小金庫應有逐項、實點、差額與原因、存入銀行、存入後小金庫;依面額清點(唯讀)+ 審核區塊。班次結帳歷史紀錄分頁照樣列出日結(收銀點欄空白)。
- **建議流程設定**:同交班(第 1 關 `type == "daily"` 跳過、第 2 關店長審核,照常審核)。
- **沒有權限時**:沒有 `store.checkout` 看不到 [日結](api `lotteryDailyCloseWizard` → `FORBIDDEN`);沒有 `store.bank-deposit` 看不到 [存銀行](api → `FORBIDDEN`);沒有 `store.skip-stocktake` 第 ② 步沒有「跳過盤點」。

### 開班(ST-04a / b / c)

- 期初零用金:**第一班**(這個收銀點沒有上一班,或上一班已被日結涵蓋)有 `store.withdraw` 時多一欄「從小金庫領零用金」(選填);**其他班** = 上一班「留給下一班」(唯讀,顯示來源)。
- 對應排班必選:預選 `findEntryForShift` 的結果;可改選這個人這天在這家店的其他排班,或「沒有排班(臨時代班)」。
- 選的排班沒有填進收銀點崗位的人力需求 → 提醒「你今天排的是「店外櫃台B」,確定要在店內櫃台A開班嗎?」,按鈕改 [仍要開班](只提醒,照樣開班並記錄)。
- 選的排班還沒打上班卡、有 `schedule.my.punch` → 提示卡「你還沒打上班卡 [打卡]」。**已知限制**:選「沒有排班(臨時代班)」時不顯示(規格 14.9 是「今天還沒打上班卡」);排班模組目前給刮刮樂的只有「打這一班的上班卡」,沒有「今天有沒有打過上班卡」與「打沒有排班的上班卡」,要先在 `entry-lookup.ts` 加這兩個入口。

### 班次資訊與改對應排班(ST-42a / b)

- 班次資訊:負責人與開班時間、期初零用金、對應排班、任務快照;開班時崗位不一致時另外標示。
- [改對應排班]:api 回 `canReassign`(負責人或店長、交班結帳送出前)才顯示;選負責人那天在這家店的另一筆排班或「沒有排班」,原因必填(欄位管理「改對應排班原因」`schedule-entry-reassign-reason`,選「其他」說明必填)。

### 兌獎(ST-11a / b、ST-38a / b、ST-39a / b / c、ST-40、ST-41)

- 標題列:開班中的本機收銀點、有 `store.redeem` → [兌獎](按鈕列最前面);本機收銀點、自己開的那一班 → [最近兌獎](文字按鈕,最後)。按鈕由 `redemption/redemption-board-actions.ts` 組,看板只追加。
- **兌獎視窗**(`RedeemDialog`):刷背面編號(輸入後 Enter / 離開欄位)→ `lotteryRedemptionPreview` 顯示遊戲、面額、本號、張號、本店的刮刮樂與否、已兌過的提示「這張已兌過獎(10/13 18:02 店外攤位)」;常見金額 200 / 500 / 1,000 / 2,000 + 自由輸入。單張超過 5,000、超過抽屜應有在畫面先擋,api 再擋一次。
- 兌獎成功 → 提示「已兌獎 RD-0219 · 5164-056527-031 · 500 元 · 店內櫃台 [撤銷]」(能自己撤銷時才有 [撤銷],直接開那一筆的確認視窗);**不**自動打開 [最近兌獎]。
- **[最近兌獎]**(`RecentRedemptionsDrawer`,`lotteryRecentRedemptions`):自己在這一班登記的(含已撤銷,標「已撤銷」);電腦 / 平板右側抽屜、手機底部面板;刮刮樂下方一行小字是單號;每列 [撤銷] 開確認視窗,撤銷後清單不關;點列的其他地方開兌獎紀錄詳情。
- **撤銷兩層**(都不用審核;按鈕看 api 回的 `revokeMode`,沒有權限不顯示,`@repo/domain/project/lottery` 的 `redemptionRevokeStateOf` 前後端共用):
  - `self`:自己登記、那一班還開著、有 `store.redeem` → 確認視窗(ST-41),不限時間、不用原因(原因代碼固定 `immediate`「當下撤銷」)。交易內鎖班時那一班剛好已送出交班結帳 → 擋下(`SHIFT_CLOSED`),不讓交班那一刻變成事後更正,改由 `store.undo-redeem` 撤銷。
  - `manager`:那一班已結帳、或不是自己登記的,有 `store.undo-redeem` → 撤銷原因(必填,欄位管理「撤銷兌獎原因」`lottery-redemption-revoke-reason`)+ 說明(ST-39b);班開著 → 應有增加,已結帳 → 記成那一班的事後更正。另有 [撤銷並重新登記]:原因填好後開兌獎視窗(標題「重新登記 · 收銀點」),撤銷與新增在同一個請求(`replaceLotteryRedemption`),新的那筆算原班、`replacesId` 指向原紀錄。
  - 已送兌:[撤銷兌獎] 停用並提示「已送兌,不能撤銷;要先撤回或退回進貨單 P-xxxx」(ST-39c),api 也拒絕(`REDEMPTION_SENT`)。
- **兌獎紀錄分頁**(`RedemptionsTab`,ST-40):分店沿用看板的 `?org=`;篩選與頁碼存網址 `?redemptions=`(REACT-14):期間(空 = 這個月 1 日到今天,租戶時區)、收銀點、狀態、登記人(選項取同一段期間出現過的人)、單號(使用者 10/22 定案:`RD-0218` 或 `218` 都可,`@repo/domain/project/lottery` 的 `redemptionSerialQueryOf` 正規化後完全比對,索引 `(tenantId, serialNo)`;有單號時不看期間 —— 畫面不送 `from` / `to`、api 也忽略,畫面提示「輸入單號時不限期間」;收銀點 / 狀態 / 登記人仍同時成立)、頁碼(一頁 20 筆);欄位 單號、時間、收銀點、班次、刮刮樂、金額、狀態、登記人、進貨單;平板 / 手機改卡片(標題列 單號 · 刮刮樂 · 金額)、篩選收進抽屜;點一列開兌獎紀錄詳情。
- **兌獎紀錄詳情**(`RedemptionDetailDialog`,ST-39a):標題列右側是單號(`RD-0218`;舊資料「—」),刮刮樂、獎金、收銀點 / 班(已交班)、登記、狀態(已送兌帶進貨單單號;事後更正另標);已撤銷另列撤銷人與原因。入口:兌獎紀錄分頁、[最近兌獎]、進貨單的新增頁兌獎區與檢視頁(讀取依據是讀得到那張進貨單,`lotteryPurchaseRedemptionRecords`;這兩個入口不能撤銷)。視窗串接在 `redemption/useRedemptionFlow.tsx`(看板與分頁共用)。

### 投庫 / 出庫(ST-12a / b)

- 投庫:顯示這個收銀點的應有現金;金額超過 → api 擋下(`AMOUNT_EXCEEDS_DRAWER`)。出庫:顯示小金庫應有;原因必填(欄位管理「出庫原因」`lottery-withdraw-reason`);金額超過小金庫應有 → api 擋下(`AMOUNT_EXCEEDS_VAULT`,提示先用現金更正單登記小金庫實際的錢;使用者 10/21 定案)。開班時「從小金庫領零用金」同一條規則。不用審核,做完就生效;寫入成功後自動印投庫單 / 出庫單(開班領零用金也印出庫單;見「列印」)。

### 列印(58mm 單據,規格第 12 章)

六張店面單據都用底座 B8 的列印流程(`docs/modules/printers.md`;專案共用的版面、種類登記與 `printReceiptAfterCommit` 見 `docs/modules/project/purchasing.md`「列印」):瀏覽器把單據排版、轉成 384 點黑白 PNG,送 `createPrintJob`。沒有 `api.printing.print` 的租戶(沒有收據機)不印、不出現 [列印],按鈕也不寫「並列印」;分店沒有可用的印表機時自動列印不送。印表機順序:收銀點的印表機(投庫單、出庫單、交班結帳單;退貨退款收據 = 退款班次所屬收銀點,規格 5.5)→ 分店預設 → 第一台。

| 單據(Figma)                     | 何時印                                                                                           | 內容                                                                                                                                           | 簽名欄         | QR code                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------- |
| 投庫單(RC-01 `102:23305`)       | 看板 [投庫] 寫入成功後自動印(1 聯)                                                               | 分店、收銀點、方向(抽屜 → 小金庫)、備註、金額                                                                                                  | 投庫人、見證人 | 即時現金帳 `?movementId=` 那一筆 |
| 出庫單(RC-02 `102:23345`)       | 看板 [出庫]、開班從小金庫領零用金寫入成功後自動印(1 聯;沒領不印)                                 | 分店、方向(小金庫 → 收銀點抽屜)、原因(開班 =「開班零用金」;選「其他」時接說明)、備註、金額                                                     | 領取人、見證人 | 即時現金帳那一筆                 |
| 存款單(RC-03 `68:1858`)         | 看板 [存銀行] 寫入成功後自動印(1 聯)                                                             | 分店、經手人(操作者)、存入帳戶、備註、金額                                                                                                     | 經手人         | 即時現金帳那一筆「存銀行」       |
| 交班結帳單(RC-04 `68:1809`)     | 結帳確認申請(交班)送出成功後自動印(1 聯;交班精靈新增頁、退回後再送出);檢視頁標頭 [列印] / [補印] | 單號、收銀點、班次(開班 ~ 結束)、交班人(送出的人)、接班人(沒有 =「無」)、盤點方式、應有現金、實點、差額(與原因)、留給下一班;時間 = 送出時間    | 交班人、接班人 | 結帳確認申請檢視頁               |
| 日結單(RC-05 `102:23385`)       | 結帳確認申請(日結)送出成功後自動印(1 聯);檢視頁標頭 [列印] / [補印]                              | 單號、涵蓋計算期間、全店盤點、各收銀點的班數與差額合計、小金庫應有 / 實點(差額不為 0 才印差額)、存入銀行(或「不存」)、小金庫留存 = 實點 − 存入 | 店長           | 結帳確認申請檢視頁               |
| 退貨退款收據(RC-09 `102:23571`) | 撤銷售出申請(退款給客人 = 是)送出成功後印(1 聯),印完才離開新增頁;退款 = 否不印                   | 單號、還在審核時名稱下標「待核准」(店長自己送、自動通過 → 不標)、退款班次、原因、每款遊戲的張數與金額與號碼區段、退款金額                      | 經手人         | 撤銷售出申請檢視頁               |

- **單號**:交班結帳單、日結單、退貨退款收據 = 那張申請的單號。投庫單、出庫單、存款單是現金流水,沒有單號也沒有詳情頁,表頭只印時間(印的當下),QR 連到即時現金帳 `?movementId=<流水 id>`(打開時標亮那一筆,規格 10.2)。
- **已印次數與補印**:`refType` 每種單據各一個(`lottery-store-vault-deposit` / `-vault-withdraw` / `-bank-deposit` 的 `refId` = 現金流水 id;`lottery-store-shift-checkout` / `-daily-close` / `-sale-refund` 的 `refId` = 申請的提交 id)。補印只有結帳確認申請檢視頁的 [列印](與自動印同一份版面:`checkout/useCheckoutReceipt.ts`)。
- **自動列印只在寫入成功之後**:投庫 / 出庫 / 開班 / 存銀行由對話框的成功回呼交給看板(`BoardDialogs`、`useDailyCloseEntry`;轉圖節點放在看板,對話框一成功就關);結帳確認申請登記成店面管理的送出後動作 `checkout/CheckoutReceiptEffect.tsx`(`app/project/workflow-extensions.ts`;讀到的提交不是結帳確認申請就不印);撤銷售出申請在新增頁送出成功後印。寫入失敗都不印;列印本身失敗只記 log。
- **QR 連結不依印單的人的權限**:頁面路由由 api 依模組樹組(`lotteryReceiptLinks`:即時現金帳、店面檢視頁、調貨單檢視頁;`ReceiptLinksService`,與 `me.modules[].route` 同一個組法但不經權限過濾),畫面用 `components/project/lottery/ReceiptPrint/useReceiptLinks.ts`。店員沒有帳戶管理,印的投庫單 QR 仍是 `<網址>/accounts?tab=cash&movementId=…`;調貨付款收據、調貨出貨單同樣改用它。
- **撤銷售出申請新增頁**:送出成功到列印完成之間按鈕維持停用,印完才離開。
- **api 提供的列印資料**:`openLotteryShift` / `depositLotteryShiftCash` / `withdrawLotteryShiftCash` 的回傳多 `movementId`(這次寫的流水;開班沒領零用金 = null)與 `cashPointPrinterId`;`lotteryCheckout` 多 `cashPointPrinterId`、`shiftOpenedAt` / `shiftClosedAt`(交班的班次)與 `coveredShifts[].difference`(日結單依收銀點彙總);`lotteryStoreShiftOptions` 多 `cashPointPrinterId`(退貨退款收據的印表機)。
- 版面純函式在 `apps/admin/src/lib/project/lottery/receipts/`(`vault-deposit-receipt.ts`、`vault-withdraw-receipt.ts`、`bank-deposit-receipt.ts`、`shift-checkout-receipt.ts`、`daily-close-receipt.ts`、`sale-refund-receipt.ts`,文案 `admin.lotteryStore.receipts`),種類登記 `receipt-kinds.ts`;QR 連結 `components/project/lottery/ReceiptPrint/useReceiptLinks.ts`(模組 key 正本 `@repo/domain/project/lottery` 的 `RECEIPT_LINK_MODULE_KEYS`)。

- **欄位錯誤**(REACT-18):投庫 / 出庫、開班、改對應排班、存銀行、日結第 ④ 步、交班「留給下一班」、撤銷售出申請的原因欄,錯了在欄位下寫原因(`store-field-errors.ts`);兌獎視窗 api 指到編號(`code`)/ 獎金(`prizeAmount`)時原因寫在那一欄下,下方提示只放通用句(`redemption-shared.ts` 的 `redemptionFieldErrorsOf`)。

## api 介面

### GraphQL

| 端點                                               | 權限                              | 說明                                                                                                                                                                                                      |
| -------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lotteryStoreBoard(orgId)`                         | `store.view`                      | 看板:啟用中的收銀點(排序)、各自開著的班(負責人、`isMine`、期初、應有、本班已售、未對應排班)、檯面上的本;`myOpenShifts`;小金庫應有                                                                         |
| `lotteryStoreOpenShiftForm(cashPointId)`           | `store.open-shift`                | 開班視窗:`plan`(`first` / `handover`)、上一班留給下一班與來源、`canTakeFloat`、`suggestedEntryId`、這天的排班(任務、快照、是否已打上班卡)                                                                 |
| `openLotteryShift(input)`                          | `store.open-shift`                | `{ cashPointId, scheduleEntryId?, temporaryCover, floatFromVault? }`                                                                                                                                      |
| `punchLotteryShiftStart(entryId)`                  | `store.open-shift`                | 打這一班的上班卡(排班模組再查 `schedule.my.punch`)                                                                                                                                                        |
| `lotteryShiftInfo(id)`                             | `store.view`                      | 班次資訊 + `canReassign` + 可以改選的排班                                                                                                                                                                 |
| `reassignLotteryShiftEntry(input)`                 | 負責人或店長(service 判斷)        | `{ shiftId, scheduleEntryId?, temporaryCover, reasonKey, reasonNote? }`                                                                                                                                   |
| `depositLotteryShiftCash(input)`                   | `store.deposit`                   | `{ shiftId, amount, note? }`                                                                                                                                                                              |
| `withdrawLotteryShiftCash(input)`                  | `store.withdraw`                  | `{ shiftId, amount, reasonKey, reasonNote?, note? }`                                                                                                                                                      |
| `lotteryStoreScan(input)`                          | `store.view`                      | `{ orgId, localCashPointId?, code }` → 刷到的張與處理方式 `outcome` / `blockReason`(本號對到多款遊戲時多筆)                                                                                               |
| `sellLotteryTickets(input)`                        | `store.sell`                      | `{ orgId, localCashPointId, tickets[{ ticketId, version }], source: scan \| manual, confirmMove?, reasonKey?, reasonNote? }`                                                                              |
| `lotteryStoreSale(ticketId)`                       | `store.view`                      | 那張最近一次售出 + `undoBlock`(撤銷確認視窗)                                                                                                                                                              |
| `lotteryStoreRecentSales(shiftId)`                 | `store.view`                      | [最近售出]:自己在這一班 30 分鐘內的售出(`undone`、`undoBlock`)                                                                                                                                            |
| `undoLotteryTicketSale(input)`                     | `store.undo-sale`                 | `{ ticketId, version }`;不符條件 → `UNDO_NOT_ALLOWED`                                                                                                                                                     |
| `lotteryStoreBookCard(orgId, bookId)`              | `store.view`                      | 展開卡片 / 拆本精靈:這本在這家店的張(不含跳號;`soldShiftId`、`locked`)、待標註、是否未拆                                                                                                                  |
| `lotteryStoreUnopenedBooks(orgId)`                 | `store.view`                      | 拆本選本:本店還沒拆的本                                                                                                                                                                                   |
| `splitLotteryBook(input)`                          | `store.split`                     | `{ orgId, bookId, skippedTicketNos, assignments[{ cashPointId, ticketNos }] }`                                                                                                                            |
| `moveLotteryTickets(input)`                        | `store.move`                      | `{ orgId, tickets, toCashPointId }`(檯面上未售的張)                                                                                                                                                       |
| `recallLotteryTickets(input)`                      | `store.move`                      | `{ orgId, tickets }`(檯面 → 庫存)                                                                                                                                                                         |
| `lotteryRedemptionPreview(input)`                  | `store.redeem`                    | `{ orgId, code }` → 遊戲、面額、本號、張號、`isOwnStore`、`existing`(未撤銷的那一筆的時間與收銀點;整個租戶)                                                                                               |
| `redeemLotteryTicket(input)`                       | `store.redeem`                    | `{ shiftId, code, prizeAmount, note? }`;班要開著、金額 ≤ 5,000、≤ 抽屜應有                                                                                                                                |
| `revokeLotteryRedemption(input)`                   | 兩層(service 判斷)                | `{ id, reasonKey?, reasonNote? }`:自己登記且班開著(`store.redeem`)不用原因;其他要 `store.undo-redeem` 與原因                                                                                              |
| `replaceLotteryRedemption(input)`                  | `store.undo-redeem`               | `{ id, reasonKey, reasonNote?, code, prizeAmount, note? }` → `{ revoked, item }`(撤銷並重新登記,同一個交易)                                                                                               |
| `lotteryRedemptions(input)`                        | `store.view`                      | `{ orgId, from?, to?, cashPointId?, status?, redeemedBy?, serialNo?, offset?, limit? }`(最多 100)→ `{ items, total }`,登記時間新到舊                                                                      |
| `lotteryRecentRedemptions(shiftId)`                | `store.view`                      | 自己在這一班登記的(含已撤銷),新到舊                                                                                                                                                                       |
| `lotteryRedemption(id)`                            | `store.view`                      | 兌獎紀錄詳情;每筆都帶操作者的 `revokeMode`(`self` / `manager` / null)與 `revokeBlockedBySent`                                                                                                             |
| `lotteryPurchaseRedemptions(orgId, submissionId?)` | `purchasing.purchase.create`      | 進貨單新增頁的兌獎區:進貨分店「店內持有」的(+ 這張單已勾的)                                                                                                                                               |
| `lotteryStoreShiftOptions(orgId)`                  | `store.view`                      | 撤銷售出申請的退款班次:本店開著的 + 最近 14 天開過的班(新的在前;`label`、`open`、`mine` = 操作者自己開著的)                                                                                               |
| `lotteryStoreSaleReversals(orgId)`                 | `store.view`                      | 撤銷售出分頁:這家店的撤銷售出申請(草稿以外,新的在前,最多 200 筆)                                                                                                                                          |
| `lotteryStoreCashCorrections(orgId)`               | `store.view`                      | 現金更正分頁:這家店的現金更正單                                                                                                                                                                           |
| `lotteryStocktakeSheet(input)`                     | `store.stocktake`                 | `{ orgId, cashPointId? }` → 盤點頁:收銀點(開著的班與應有、最近一班)、檯面上的本與張(版本、撤銷審核中)、未拆的本、待查清單、`serverNow`                                                                    |
| `lotteryStocktakeReview(input)`                    | `store.stocktake`                 | `{ draft }` → 差異核對:每本的差異(版本、是否已補登)、撤銷審核中、已被處理的張、`staleCount` / `unhandledCount`、彙總                                                                                      |
| `backfillLotteryStocktakeSales(input)`             | `store.sell`(+ `store.stocktake`) | `{ orgId, tickets[{ ticketId, version }] }` → 每張的事件 id、金額、算到的班、`postClose`;立即生效                                                                                                         |
| `lotteryStocktakeStatus(orgId)`                    | `store.view`                      | 上次送出的盤點時間、`remind`(超過 24 小時)                                                                                                                                                                |
| `lotteryStocktakes(input)`                         | `store.view`                      | `{ orgId, from?, to?, type?, status?, offset?, limit? }`(最多 100)→ `{ items, total }`,送出時間新到舊                                                                                                     |
| `lotteryStocktake(submissionId)`                   | `store.view`                      | 盤點確認申請檢視頁:盤點單明細、彙總、盤點內容(`draft`,退回後帶入)                                                                                                                                         |
| `lotteryCheckoutWizard(shiftId)`                   | `store.checkout`                  | 交班精靈:這一班(收銀點、負責人、開班時間、是否已結束)、`canSubmit`(負責人或店長)、`canSkipStocktake`、可沿用的盤點、這一班的兌獎與合計、應有現金逐項(含明細)與合計、審核中的單據、接班人候選、`serverNow` |
| `lotteryCheckouts(input)`                          | `store.view`                      | `{ orgId, from?, to?, cashPointId?, type?, status?, offset?, limit? }`(最多 100;`status` = 申請的狀態)→ `{ items, total }`,送出時間新到舊                                                                 |
| `lotteryCheckout(submissionId)`                    | `store.view`                      | 結帳確認申請檢視頁:結帳單(應有逐項、面額、差額與原因、審核中的單據快照、留給下一班 / 接班人)、盤點方式與盤點單、結帳內容(`draft`,退回後帶入)                                                              |
| `lotteryReceiptLinks`                              | `api.printing.print`              | 58mm 單據 QR code 的頁面路由(即時現金帳、店面檢視頁、調貨單檢視頁):依模組樹組,不依操作者權限;模組或祖先停用 = null                                                                                        |

| `lotteryDailyCloseStatus(orgId)` | `store.view` | 看板頂部:上次日結的時間(`lastClosedAt`)與距今天數(`daysSince`)、審核中 / 已退回的日結(`pending`) |
| `lotteryDailyCloseWizard(orgId, submissionId?)` | `store.checkout` | 日結精靈:涵蓋計算期間、沒有日結的日子、開著的班、另一張審核中的日結、各班結帳列(狀態、等誰、`isMine`、`instanceId`)、各班結帳差額、可沿用的全店盤點、小金庫應有逐項、可用的帳戶;`submissionId` = 退回後再送出 |
| `lotteryBankDepositForm(orgId)` | `store.bank-deposit` | 存銀行視窗:小金庫目前應有、這家店可用的帳戶 |
| `depositLotteryVaultToBank(input)` | `store.bank-deposit` | `{ orgId, amount, accountId, note? }` → `{ vaultExpected, movementId, transactionId }` |

- 撤銷售出申請、現金更正單的寫入一律經表單引擎(送出 / 審核 / 掛接點,見上方「撤銷售出申請與現金更正單」);lookup 來源 `lottery_shift`(`project/lookup-providers.ts`,顯示欄 `label`,讀取要 `store.view`;可攜、沒有固定條件)。
- 排班只經 `ScheduleModule` 匯出的 `ScheduleEntryLookup` 讀(`findEntryForShift` / `listEntriesOfDay` / `taskSnapshotFor` / `punchStart` / `hasStartPunch`;依賴方向刮刮樂 → 排班)。
- 現金流水經 `CashLedgerService.recordCashMovement`(交易內)。出庫原因的欄位管理選項對到流水的原因代碼:「開班零用金」→ `opening_float`、「補零錢」→ `change`、其他(含租戶自己加的選項)→ `other`,選項名稱與說明寫進流水備註(`store-cash.service.ts` 的 `withdrawReasonOf`)。
- 讀取照操作者的可見範圍;負責人名稱以租戶邊界讀(`shift-views.ts`,反查)。刷到時的張以租戶邊界反查(`store-sales.service.ts`:待查 / 遺失的張可能在別家店、不是本店的也要說得出來);寫入一律照操作者的範圍經帳本。

正本:`apps/api/src/project/lottery/store/`、`apps/api/src/project/lottery/redemption/`、`apps/api/src/project/lottery/stocktake/`、`apps/api/src/project/lottery/checkout/`、`apps/api/src/project/lottery/daily-close/`、`packages/graphql/src/documents/project/lottery/store.graphql`、`redemption.graphql`、`stocktake.graphql`、`checkout.graphql`、`daily-close.graphql`

## 資料

### 收銀班次 `lottery_shifts`

| 欄位                                                    | 說明                                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `orgId`、`cashPointId`                                  | 分店、收銀點                                                                                                                         |
| `openedBy`、`openedAt`                                  | 開班的人就是負責人                                                                                                                   |
| `openingFloat`、`openingFloatSource`、`previousShiftId` | 期初零用金與來源(`vault` 第一班從小金庫領 / `none` 第一班沒領 / `handover` 上一班留給下一班)                                         |
| `openingMovementId`                                     | 第一班領零用金寫的出庫流水(期初已算進 `openingFloat`,抽屜應有的現金流水來源扣掉這一筆)                                               |
| `scheduleEntryId`、`scheduleTaskSnapshot`               | 對應排班(臨時代班 = null)、任務快照(職責 + 任務內容 + 崗位;改對應排班時重寫)                                                         |
| `positionMismatch`                                      | 崗位不一致的提醒紀錄 `{ cashPointPositionKey, entryPositionKeys }`;一致或臨時代班 = null                                             |
| `closedAt`、`checkoutId`                                | 送出交班結帳時填(結帳單 `lottery_checkouts` 的 id);退回不重開                                                                        |
| `drawerVersion`                                         | 動到這一班抽屜的動作在交易內先 +1,同一班同時的投庫互相衝突、重試時依序檢查                                                           |
| `label`                                                 | 顯示名稱 `店內櫃台 · 李小華 10/21 13:00`(開班時存,`shiftLabelOf`,租戶時區);lookup 來源 `lottery_shift` 的顯示欄。之前開的班 = 空字串 |

- 部分唯一索引 `(cashPointId)`(`closedAt`、`deletedAt` 為 null):同一個收銀點同時只能有一班;兩人同時開班由索引擋下後到的(`SHIFT_ALREADY_OPEN`)。
- 一個人只能同時開同一家店的班:開班的交易一開始對這個人的守門文件 `lottery_shift_person_locks`(一個租戶一人一筆,歸屬租戶頂層)`$inc`,再以租戶邊界查他在別家店開著的班(`SHIFT_IN_OTHER_STORE`);同一人在兩家店同時開班,兩個交易在守門文件上衝突、重跑的一方被擋下(`store-person-locks.ts`)。
- 從小金庫拿錢(出庫、開班領零用金)不能超過小金庫應有(`CashLedgerService.vaultExpected`)扣掉審核中日結要存入銀行的金額(見「日結與存銀行」):交易外先建好這家店的小金庫守門文件 `lottery_vault_locks`(一家店一筆),交易內先 `$inc` 再算應有;同一家店同時兩筆在守門文件上衝突、重跑的一方讀得到對方的流水(`store-vault-guard.ts`;比照抽屜的 `drawerVersion`)。存銀行(`daily-close/bank-deposit.service.ts`)接同一支;日結送出 / 完成時碰同一個守門文件(`serialize`)。調貨付現等其他從小金庫拿錢的動作由各自的功能決定要不要接。
- 資料共用 `private`;模組 key `store`;清空示範機構依 `tenantId` 刪(`project/database/tenant-purge.ts`)。
- 第一班的判斷用兩個登記(`lottery/store/previous-shift.ts`):`registerHandoverAmount`(交班結帳登記「留給下一班」)、`registerDailyCloseCoverage`(日結登記「已被日結涵蓋」);沒有登記 = 留給下一班 0、沒被涵蓋。上一班的交班結帳被退回、修改留給下一班時,下一班的期初由結帳的掛接點在再送出時更新(`previousShiftId` = 上一班、`openingFloatSource = handover` 的班)。

### 兌獎 `lottery_redemptions`

| 欄位                                                                      | 說明                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serialNo`                                                                | 單號 `RD-0001`:底座 `SerialService`(ADR-0015),key `lottery_redemption`、格式 `@repo/domain/project/lottery` 的 `REDEMPTION_SERIAL_FORMAT`(前綴 RD、4 位數、不分期),各租戶各自連號;新增時在同一個交易內取號(交易回復號碼一起回復),撤銷不收回,[撤銷並重新登記] 的新紀錄取新號;加單號之前的舊資料 = null(畫面「—」),正式環境無資料、不做 migration |
| `orgId`、`shiftId`、`cashPointId`                                         | 錢從那一班的抽屜付出                                                                                                                                                                                                                                                                                                                            |
| `redeemedAt`、`redeemedBy`                                                | 登記時間、登記人                                                                                                                                                                                                                                                                                                                                |
| `gameCode`、`bookNo`、`ticketNo`、`ticketLabel`、`rawInput`               | 遊戲代號、本號 7 位、張號、顯示用張編號 `5164-056527-031`(lookup 的標籤)、刷到的原文                                                                                                                                                                                                                                                            |
| `ticketId`、`gameId`                                                      | 本店持有的那一張(不是本店的刮刮樂 = null)、遊戲(找不到代號 = null)                                                                                                                                                                                                                                                                              |
| `prizeAmount`                                                             | 中獎金額(正整數,≤ 5,000)                                                                                                                                                                                                                                                                                                                        |
| `status`                                                                  | `in_store` 店內持有 / `sent` 已送兌 / `revoked` 已撤銷                                                                                                                                                                                                                                                                                          |
| `purchaseSubmissionId`、`sentAt`                                          | 勾進哪一張進貨單、送兌時間                                                                                                                                                                                                                                                                                                                      |
| `sentHistory[]`                                                           | 送兌歷程(每次勾進進貨單一筆 `sentAt`;退回 / 駁回 / 作廢 / 沒勾回到店內持有時記 `releasedAt`;重送同一張單不另記)。營運報表判斷期末那一刻是否已送兌                                                                                                                                                                                               |
| `revokedAt`、`revokedBy`、`revokeReasonKey`、`revokeReason`、`revokeNote` | 撤銷時間、撤銷人、原因代碼(自己當下撤銷 = `immediate`)、原因名稱快照、說明                                                                                                                                                                                                                                                                      |
| `replacesId`                                                              | [撤銷並重新登記] 的新紀錄指向被撤銷的那筆                                                                                                                                                                                                                                                                                                       |
| `postCloseOf`、`revokePostCloseOf`                                        | **事後更正**:新增時 / 撤銷時那一班已結帳 → 指向那一班(見下方)                                                                                                                                                                                                                                                                                   |
| `version`                                                                 | 狀態改變的條件更新(撤銷、送兌、回到店內持有各 +1)                                                                                                                                                                                                                                                                                               |

- **同一張不能兌兩次**:部分唯一索引 `(tenantId, gameCode, bookNo, ticketNo)`(`revokedAt`、`deletedAt` 為 null);撤銷後可以重新登記同一張。別家店兌過也算(整個租戶)。同時兩個請求兌同一張 → 索引擋下後到的,回 `REDEMPTION_DUPLICATE`(`extensions` 帶第一筆的 `redeemedAt`、`cashPointName`)。
- 兌獎、撤銷(班開著時)、[撤銷並重新登記] 在同一個交易先把班的 `drawerVersion` +1(同投庫 / 出庫),再檢查抽屜應有;撤銷以「店內持有 + 版本」條件更新,兩人同時撤銷只有一個成功(`REDEMPTION_ALREADY_REVOKED`)。
- 資料共用 `private`;模組 key `store`;清空示範機構依 `tenantId` 刪(`project/database/tenant-purge.ts`)。lookup 來源 `lottery_redemption`(`project/lookup-providers.ts`;標籤 `ticketLabel`、帶入 `prizeAmount`;可攜的固定條件只收 `status: in_store`)給進貨單的兌獎欄用。
- 讀「已兌過」、登記人 / 班次負責人名稱、進貨單單號以租戶邊界讀(`project/database/tenant-boundary-callers.ts`,反查)。

#### 事後更正(規格 6.12;本票先實作兌獎這一側,P24 / P25 / P26 / P29 照用同一個形狀)

「那一班已經結帳(已送出交班結帳,`lottery_shifts.closedAt` 有值)之後,才記到那一班的錢」。

- **不改已送出的結帳單**,下一班的期初也不變;事後更正只把「當時差額為什麼不是 0」補上解釋。
- **資料形狀**:那一筆照常寫入,另記指向被更正那一班的欄位。兌獎紀錄有兩個時間點,所以分兩欄:`postCloseOf`(新增時那一班已結帳 —— [撤銷並重新登記] 的新紀錄)、`revokePostCloseOf`(撤銷時那一班已結帳)。張數事件與現金流水只有「寫入」一個時間點,用同一個欄位名 `postCloseOf`。
- **算法**(`@repo/domain/project/lottery` 的 `redemptionDrawerNetOf` / `redemptionPostCloseNetOf`):
  - 結帳時的應有只算「班開著時登記、而且沒有在班開著時撤銷」的兌獎(抽屜應有的來源 `redemptions`);交班後的撤銷 / 新增不改它。
  - 那一班兌獎的事後更正淨額 = Σ(`revokePostCloseOf` = 那一班的金額)− Σ(`postCloseOf` = 那一班的金額)。api 給其他功能的入口:`redemption/redemption-registrations.ts` 的 `redemptionPostCloseNet(repository, reader, shiftId)`。
  - 那一班的應有(含事後更正)= 結帳時的應有 + 各來源的事後更正淨額;差額(含事後更正)= 實點 − 應有(含事後更正)。交班結帳、報表由那些功能加總。
- **例**(第 17 章第 5 題):週一晚班期初 5,000,登記 2,000(應有 3,000),實點 4,800、交班。週二店長 [撤銷並重新登記] 200:原紀錄 `status = revoked`、`revokePostCloseOf = 週一晚班`;新紀錄 `replacesId = 原紀錄`、`postCloseOf = 週一晚班`、`shiftId = 週一晚班`;事後更正 +2,000 − 200 = +1,800,週一差額(含事後更正)= 0。

### 盤點單 `lottery_stocktakes`

| 欄位                                                                    | 說明                                                                                                                               |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `orgId`、`type`、`status`                                               | 分店;交班 `shift` / 日結 `daily` / 臨時 `adhoc`;待核准 `pending` → 已確認 `confirmed` / 已駁回 `rejected`;退回 → 已退回 `returned` |
| `scopeCashPointId`                                                      | 只盤一個收銀點(單一收銀點的臨時盤點、交班);全店 = null                                                                             |
| `startedAt`、`submittedBy`、`submittedAt`、`confirmedAt`、`confirmedBy` | 開始盤(畫面上記下)、送出、核准完成與核准的人                                                                                       |
| `submissionId`                                                          | 帶盤點的申請(盤點確認申請 / 結帳確認申請);唯一                                                                                     |
| `lines[]`                                                               | 每本 × 收銀點:`countedAt`、方式、系統數字、實盤的張號、差異的張與各自的處理(補登售出記事件 id 與是否事後更正、金額)                |
| `unopenedLines[]`                                                       | 未拆的本:在 / 不在(張數;待標註的跳號不算 = 標準張數)                                                                               |
| `lostReviewLines[]`                                                     | 待查清單的處理:找到了 / 確認遺失(原因代碼、名稱快照、說明)/ 繼續待查不記;單張成本                                                  |
| `uncountedBooks[]`                                                      | 送出時範圍內還沒盤的本 × 收銀點(遊戲代碼、遊戲名稱、本號、收銀點);不比對、不記差異;退回後再送出時重算                              |
| `summary`                                                               | 本數、補登售出(張 / 金額)、新增待查、標記異常、確認遺失(張 / 批購成本;未拆整本扣待標註的跳號)、未盤本數 `uncountedCount`           |
| `version`                                                               | 送出 / 退回 / 駁回 / 完成各 +1(條件更新)                                                                                           |

- 送出時才建立(沒有「盤點中」);盤點送出不影響現金帳與庫存,核准完成時才套用。資料共用 `private`;模組 key `store`;清空示範機構依 `tenantId` 刪(`project/database/tenant-purge.ts`)。
- 掛接點的寫入與審核者的讀取以租戶邊界上下文(`project/database/tenant-boundary-callers.ts`:`stocktake.service.ts` 反查 + 例外寫入、`stocktake-query.service.ts` 反查)。
- 張數事件多一個欄位 `postCloseOf`(事後更正;盤點補登售出時那個收銀點沒有開著的班):抽屜應有的來源 `ticket-events` 不算它,事後更正淨額由 `store-registrations.ts` 的 `ticketEventsPostCloseNet(events, reader, shiftId)` 加總(交班結帳、報表用)。

### 結帳單 `lottery_checkouts`

| 欄位                                                       | 說明                                                                                                                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orgId`、`type`、`status`                                  | 分店;交班 `shift` / 日結 `daily`(日結:應有 / 實點 / 差額 / 面額 / 差額原因 / 應有各項記**小金庫**);待核准 `pending` → 已確認 `confirmed`;退回 → 已退回 `returned` |
| `cashPointId`、`shiftId`                                   | 交班才有                                                                                                                                                          |
| `stocktakeMode`、`stocktakeId`                             | 盤點方式 `reuse` / `new` / `skip`;盤點單(沿用的那一筆,或這張申請自己建立的);跳過 = null                                                                           |
| `skipReasonKey`、`skipReason`、`skipReasonNote`            | 跳過盤點的原因(代碼、名稱快照、說明);報表永久標示「未盤點」的資料欄位                                                                                             |
| `expectedItems[]`、`expected`                              | 應有現金逐項快照 `{ kind, count, amount(帶正負號), entries[{ refType(redemption / movement), refId, label, occurredAt, amount }] }` 與合計                        |
| `denominations[]`、`counted`、`difference`                 | 實點(面額 × 張數)、合計、差額 = 實點 − 應有                                                                                                                       |
| `diffReasonKey`、`diffReason`、`diffReasonNote`            | 差額原因(代碼、名稱快照、說明);差額 0 = null                                                                                                                      |
| `pendingImpacts[]`                                         | 送出時審核中、會影響這一班現金的單據快照 `{ submissionId, formKey, serialNo, amount }`                                                                            |
| `leftForNext`、`successorId`                               | 留給下一班(下一班的期初)、接班人(沒有 = null)                                                                                                                     |
| `submittedBy`、`submittedAt`、`confirmedAt`、`confirmedBy` | 送出的人與時間、核准完成與核准的人                                                                                                                                |
| `coveredFrom`、`coveredTo`、`coveredShiftIds[]`            | 日結:涵蓋計算期間(第一次日結 `coveredFrom = null`;第一次送出時定下)與涵蓋的班;交班 = null / 空                                                                    |
| `bankDepositAmount`、`bankAccountId`                       | 日結:存入銀行的金額(0 = 不存)與帳戶                                                                                                                               |
| `bankTransactionId`、`bankMovementId`                      | 日結完成時寫的銀行「存入」與現金流水「存銀行」;沒存 = null                                                                                                        |
| `submissionId`                                             | 結帳確認申請的提交 id;唯一                                                                                                                                        |
| `version`                                                  | 送出 / 退回 / 完成各 +1(條件更新)                                                                                                                                 |

- 送出時才建立(精靈過程只在畫面上);退回後再送出改寫同一筆。資料共用 `private`;模組 key `store`;清空示範機構依 `tenantId` 刪(`project/database/tenant-purge.ts`)。
- 掛接點的寫入與審核者的讀取以租戶邊界上下文(`project/database/tenant-boundary-callers.ts`:`checkout.service.ts` 反查 + 例外寫入、`checkout-query.service.ts` 反查)。
- 「留給下一班」向店面登記(`checkout-registrations.ts` → `registerHandoverAmount`):最近一張結帳單的 `leftForNext`;沒有 = 0。

### 抽屜應有

`expectedDrawerCash(reader, shift)`(`lottery/store/drawer-cash.ts`)= 期初零用金 + 每個登記來源的淨額(流入抽屜 +、流出 −)。來源以 `registerDrawerCashSource(name, source)` 登記(名稱全域唯一):

| 來源             | 登記處                                   | 算什麼                                                                                                              |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ticket-events`  | `store-registrations.ts`                 | 這一班的張數事件:`cashEffect` 增加(售出、盤點補登)+、減少(當下撤銷)−;銷售與當下撤銷都寫在這裡                       |
| `cash-movements` | `store-registrations.ts`                 | 這一班的現金流水(投庫、出庫、調貨、退貨退款、現金更正);扣掉開班領零用金那一筆(已是期初);不含事後更正(`postCloseOf`) |
| `redemptions`    | `redemption/redemption-registrations.ts` | 這一班開著時登記、沒有在班開著時撤銷的兌獎:每筆 − 金額(交班後的撤銷 / 新增是事後更正,不算)                          |

之後的項目由那些功能在自己的 provider `onModuleInit` 登記自己的來源。

### 對其他功能的登記(`store-registrations.ts`)

| 登記                                                                     | 給誰                     | 內容                                                                             |
| ------------------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------- |
| `registerOpenShiftResolver`(`cash/open-shift.ts`)                        | 收付(現金來源選抽屜)     | 收銀點開著的班                                                                   |
| `registerOpenDrawersLister`(`cash/open-shift.ts`)                        | 即時現金帳、收付付款視窗 | 分店開著班的收銀點抽屜與應有(即時現金帳列出;付款視窗的現金來源 `cashDrawers`)    |
| `registerCashPointDeactivationGuard`                                     | 檔案管理的收銀點停用     | 有開著的班、或檯面上還有未售的張 → 不能停用                                      |
| `registerPositionAnnotationProvider`                                     | 排班表(崗位旁的註記)     | 這家店各收銀點:崗位 → 收銀點名稱                                                 |
| `registerEntryDeletionGuard`                                             | 排班作業刪除排班         | 已被收銀班次綁定的排班不能刪                                                     |
| `registerHandoverAmount`(`checkout/checkout-registrations.ts`)           | 開班(期初零用金)         | 這一班最近一張結帳單的「留給下一班」;沒有 = 0                                    |
| `registerDailyCloseCoverage`(`daily-close/daily-close-registrations.ts`) | 開班(第一班的判斷)       | 這一班已被送出的日結涵蓋計算(那家店某張日結的 `coveredTo` ≥ 這一班的 `closedAt`) |
| `registerVaultBaselineProvider`(同上)                                    | 帳戶管理(小金庫應有)     | 最近一張已確認日結的清點金額與送出時間                                           |

這些查詢沒有操作者(或問的是整個租戶),以租戶邊界的系統身分讀(`project/database/tenant-boundary-callers.ts`,系統重算)。

### 即時同步

- 看板頻道登記 `{ key: "store-board", moduleKey: "store", permission: "store.view" }`(`apps/api/src/project/realtime-boards.ts`):換發含 `board:<分店>` 的憑證時,只在持有 `store.view` 且那家店在可見範圍內時放進去(RT-04)。
- 開班、投庫、出庫、改對應排班後對 `board:<分店>` 送 `board` 信號(交易提交後;每 2 秒合併,RT-05;`store-board-signal.ts`)。之後的功能(銷售、兌獎…)呼叫同一支。
- 前端:看板頁 `useRealtimeBoard("store-board", orgId)`;`board` 信號 invalidate 看板資料(`apps/admin/src/app/project/realtime-signals.ts`)。

### 稽核

| action                         | targetType           | 什麼時候                                                                   |
| ------------------------------ | -------------------- | -------------------------------------------------------------------------- |
| `lottery-shift.reassign-entry` | `lottery_shift`      | 改對應排班(before / after:對應排班、任務快照;after 含原因)                 |
| `lottery-redemption.revoke`    | `lottery_redemption` | 撤銷兌獎(兩層與 [撤銷並重新登記] 的撤銷;after 含原因、說明、`postCloseOf`) |

### 錯誤碼

| code                | reason                                                   | 什麼時候                                                                          |
| ------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `VALIDATION_FAILED` | `SHIFT_ALREADY_OPEN`                                     | 這個收銀點已經有開著的班(含兩人同時開班的後到者)                                  |
| `VALIDATION_FAILED` | `SHIFT_IN_OTHER_STORE`                                   | 操作者在別家店還有開著的班                                                        |
| `VALIDATION_FAILED` | `SHIFT_CLOSED`                                           | 這一班已送出交班結帳(改對應排班、投庫、出庫)                                      |
| `VALIDATION_FAILED` | `CASH_POINT_DISABLED`                                    | 收銀點已停用                                                                      |
| `VALIDATION_FAILED` | `ENTRY_NOT_AVAILABLE`                                    | 選的排班不是這個人那天在這家店的排班                                              |
| `VALIDATION_FAILED` | `PERIOD_CLOSED`                                          | 開班 / 改對應排班選的排班在已關帳的月份(`fields: scheduleEntryId`;規格 10.4)      |
| `VALIDATION_FAILED` | `OPENING_FLOAT_NOT_ALLOWED`                              | 不是第一班、或沒有 `store.withdraw`,卻要從小金庫領零用金                          |
| `VALIDATION_FAILED` | `AMOUNT_EXCEEDS_DRAWER`                                  | 投庫金額超過抽屜目前的應有                                                        |
| `VALIDATION_FAILED` | `AMOUNT_EXCEEDS_VAULT`                                   | 出庫或開班從小金庫領零用金超過小金庫目前的應有(`fields: amount / floatFromVault`) |
| `VALIDATION_FAILED` | —(`fields: scheduleEntryId` 等)                          | 沒選對應排班、金額不是正整數、原因沒選或選「其他」沒寫說明                        |
| `VALIDATION_FAILED` | `LOCAL_SHIFT_NOT_OPEN`                                   | 售出時本機收銀點(或那一班)沒有開著的班                                            |
| `VALIDATION_FAILED` | `TICKET_NOT_SELLABLE`                                    | 這張不能賣(`extensions.blockReason`);手動標記只收本機收銀點檯面上的張             |
| `VALIDATION_FAILED` | `ALREADY_SOLD`                                           | 這張已經賣掉(`extensions.soldAt`;同時兩次售出的失敗方)                            |
| `VALIDATION_FAILED` | `GAME_NOT_FOUND`                                         | 售出:讀不到這張的遊戲(面額不明),不以 0 元賣                                       |
| `VALIDATION_FAILED` | `MOVE_CONFIRM_REQUIRED`                                  | 刮刮樂在別人的班的檯面,沒有 `confirmMove`                                         |
| `FORBIDDEN`         | `MOVE_NOT_ALLOWED`                                       | 同上、沒有 `store.move`                                                           |
| `VALIDATION_FAILED` | `UNDO_NOT_ALLOWED`                                       | 不符合當下撤銷的條件(`extensions.undoBlock`)                                      |
| `VALIDATION_FAILED` | `BOOK_ALREADY_OPENED`                                    | 拆本:這本在這家店已經拆過                                                         |
| `VALIDATION_FAILED` | `SPLIT_PLAN_INVALID`                                     | 拆本:跳號沒點滿或沒分配完(`extensions.problem`)                                   |
| `VALIDATION_FAILED` | `TICKET_NOT_ON_COUNTER`                                  | 移櫃 / 收回:不是檯面上未售的張                                                    |
| `VALIDATION_FAILED` | `REDEMPTION_CODE_INVALID` / `REDEMPTION_CODE_NEEDS_BACK` | 兌獎:看不懂的編號 / 正面編號對不到本店唯一的遊戲(請刷背面編號)                    |
| `VALIDATION_FAILED` | `REDEMPTION_OVER_LIMIT`                                  | 兌獎:單張超過 5,000(請客人到銀行兌獎)                                             |
| `VALIDATION_FAILED` | `REDEMPTION_DUPLICATE`                                   | 兌獎:這張已有未撤銷的兌獎(`extensions` 帶 `redeemedAt`、`cashPointName`)          |
| `VALIDATION_FAILED` | `REDEMPTION_SENT` / `REDEMPTION_ALREADY_REVOKED`         | 撤銷兌獎:已送兌(先撤回或退回進貨單)/ 已撤銷                                       |
| `VALIDATION_FAILED` | `AMOUNT_EXCEEDS_DRAWER`(兌獎)                            | 兌獎金額超過抽屜目前的應有(`extensions.expected`)                                 |
| `CONFLICT`          | `TICKET_ALREADY_PROCESSED`                               | 帳本的條件更新失敗(版本或狀態已變)                                                |
| `FORBIDDEN`         | —                                                        | 沒有那條權限;改對應排班不是負責人也不是店長                                       |
| `NOT_FOUND`         | —                                                        | 分店、收銀點或班次不存在 / 看不到                                                 |

撤銷售出申請、現金更正單的掛接點擋下時是 `FORBIDDEN` + `reason`(文案在 `admin.lifecycle.<碼>`):

| reason                                | 什麼時候                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `STORE_FORM_INVALID`                  | 欄位不合(`message` = 欄位 key):沒選張、張數和張號不一致、退款 = 是沒有退款班次、金額不是正整數、說明沒填… |
| `STORE_FORM_BRANCH_NOT_VISIBLE`       | 分店不在申請人的可見範圍                                                                                  |
| `STORE_FORM_SHIFT_NOT_IN_BRANCH`      | 退款班次 / 位置 / 歸屬班次不是這家分店的班(看不到的班先被表單引擎的引用檢查擋下 `SOURCE_UNAVAILABLE`)     |
| `PERIOD_CLOSED`                       | 退款班次 / 位置(某一班)是已關帳月份的班(`message` = 欄位 key;歸屬班次不檢查)                              |
| `SALE_REVERSAL_TICKET_NOT_REVERSIBLE` | 有張不是本店已售,或在其他未結束的撤銷售出申請上                                                           |
| `SALE_REVERSAL_AMOUNT_MISMATCH`       | 列的金額或退款金額 ≠ 面額合計                                                                             |
| `STORE_FORM_VOID_NOT_ALLOWED`         | 作廢(兩張表單完成後都不能作廢)                                                                            |

盤點(`STOCKTAKE_REASONS`):

| code / reason                                                     | 什麼時候                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `CONFLICT` · `STOCKTAKE_ALREADY_PROCESSED`                        | [補登售出]:這幾張已被處理(`extensions.tickets`;同時補登、看板補刷、盤點之後被動過) |
| `VALIDATION_FAILED` · `STOCKTAKE_NO_SHIFT`                        | [補登售出]:那個收銀點從來沒有開過班                                                |
| `VALIDATION_FAILED` · `STOCKTAKE_DRAFT_INVALID`                   | 差異核對:盤點內容看不懂                                                            |
| `FORBIDDEN` · `STOCKTAKE_DIFF_STALE` / `STOCKTAKE_DIFF_UNHANDLED` | 送出(掛接點):有已被處理的張 / 還有差異沒處理                                       |
| `FORBIDDEN` · `STOCKTAKE_DRAFT_INVALID` / `STOCKTAKE_FORBIDDEN`   | 送出:盤點內容不完整、分店不一致、確認遺失沒有原因 / 沒有盤點或確認遺失的權限       |
| `FORBIDDEN` · `STOCKTAKE_VOID_FORBIDDEN`                          | 作廢盤點確認申請(一律擋下)                                                         |

交班結帳(`CHECKOUT_REASONS`;掛接點擋下時是 `FORBIDDEN` + `reason`,文案在 `admin.lifecycle.<碼>`):

| reason                            | 什麼時候                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `CHECKOUT_DRAFT_INVALID`          | 結帳內容看不懂、與這一班對不上(分店 / 收銀點)、留給下一班不是非負整數            |
| `CHECKOUT_FORBIDDEN`              | 沒有 `store.checkout`、不是負責人也不是店長、跳過盤點沒有 `store.skip-stocktake` |
| `CHECKOUT_SHIFT_CLOSED`           | 這一班已送出交班結帳(送出時也可能是 `CONFLICT`:交易內發現班已結束)               |
| `CHECKOUT_PENDING_EXISTS`         | 這一班已有審核中的結帳確認申請                                                   |
| `CHECKOUT_STOCKTAKE_NOT_REUSABLE` | 沿用的盤點不存在、已駁回、不是這個收銀點(或全店)的、或超過 30 分鐘               |
| `CHECKOUT_REASON_REQUIRED`        | 差額不為 0 沒有原因 / 跳過盤點沒有原因(含選「其他」沒寫說明)                     |
| `CHECKOUT_LEFT_MUST_BE_ZERO`      | 沒有接班人時留給下一班 > 0                                                       |
| `CHECKOUT_LEFT_EXCEEDS_COUNTED`   | 留給下一班超過實點(送出時 `VALIDATION_FAILED`)                                   |
| `CHECKOUT_SUCCESSOR_SELF`         | 接班人是申請人或這一班的負責人                                                   |
| `CHECKOUT_SUCCESSOR_INVALID`      | 接班人不是這家店的成員                                                           |
| `CHECKOUT_REJECT_FORBIDDEN`       | 駁回結帳確認申請(一律擋下,只能退回)                                              |
| `CHECKOUT_VOID_FORBIDDEN`         | 作廢結帳確認申請(一律擋下)                                                       |

日結與存銀行(`DAILY_CLOSE_REASONS`;掛接點擋下時是 `FORBIDDEN` + `reason`,送出交易內再檢查時是 `CONFLICT` + `reason`,文案在 `admin.lifecycle.<碼>`;存銀行是 `VALIDATION_FAILED`,文案在 `admin.lotteryStore.errors.<碼>`):

| reason                           | 什麼時候                                              |
| -------------------------------- | ----------------------------------------------------- |
| `DAILY_CLOSE_SHIFTS_OPEN`        | 這家店還有收銀點的班沒送出交班結帳                    |
| `DAILY_CLOSE_UNAPPROVED`         | 涵蓋計算的交班結帳還有沒核准的                        |
| `DAILY_CLOSE_PENDING_EXISTS`     | 這家店已有審核中 / 已退回的日結                       |
| `DAILY_CLOSE_DEPOSIT_INVALID`    | 存入銀行的金額不是非負整數或超過小金庫實點            |
| `DAILY_CLOSE_ACCOUNT_NOT_USABLE` | 存入銀行 > 0 沒選帳戶,或帳戶停用 / 使用組織不含這家店 |
| `AMOUNT_EXCEEDS_VAULT`(存銀行)   | 存銀行金額超過小金庫目前的應有                        |
| `BANK_DEPOSIT_NO_ACCOUNT`        | 存銀行:這家店沒有任何可用的銀行帳戶(ST-26b)           |
| `BANK_ACCOUNT_NOT_USABLE`        | 存銀行:選的帳戶不能用                                 |

### 測試

`apps/api/src/project/lottery/redemption/redemption.test.ts`(兌獎:預覽、第 17 章第 4 / 5 / 7 題、重複與同時兌同一張、5,000 / 抽屜上限、[最近兌獎] 與分頁篩選、兩層撤銷與權限、自己撤銷遇到交班、事後更正淨額、稽核)、`apps/api/src/project/lottery/store/store-sales.test.ts`(端點 + 真 MongoDB:錢算在哪一班、刷到時各情況、當下撤銷四種不符與符合、同時兩次售出、拆本、移櫃情境表、手動標記)、`packages/domain/src/project/lottery/store-sales.test.ts`、`apps/api/src/project/lottery/store/store.test.ts`(端點 + 真 MongoDB:開班、同店兩個收銀點 / 跨店、同時開班、對應排班與快照、崗位不一致、改對應排班、投庫 / 出庫、同時投庫、排班刪除守門、收銀點停用守門、收付與即時現金帳的登記、看板卡片)、`store-board-ticket.test.ts`(`board:<分店>` 換發,RT-04)、`apps/db-migrator/seeds/project/store.test.ts`(模組宣告與角色配方)、`packages/domain/src/project/lottery/store.test.ts`、`apps/api/src/project/lottery/store/store-forms.test.ts`(撤銷售出申請 / 現金更正單:真的表單引擎 + 流程 + 掛接點;第 17 章第 6 題撤銷一側、不能選的張、駁回不記、作廢擋下、事後更正、B5、B9b、小金庫、歸屬班次、分頁列表、`pendingCashImpacts`)、`apps/db-migrator/seeds/project/store.forms.test.ts`(兩張受管表單、開通流程、店員的新增權限)、`apps/api/src/project/lottery/stocktake/stocktake.test.ts`(盤點:真的表單引擎 + 流程 + 掛接點;第 17 章第 1、2、3 題與第 6 題盤點一側、送出前每筆差異都要處理、核准完成才套用、駁回不退補登、退回、作廢擋下、事後更正、看板提醒)、`packages/domain/src/project/lottery/stocktake.test.ts`(比對與送出前檢查)、`apps/db-migrator/seeds/project/store.stocktake-confirm.test.ts`(受管表單、開通流程、店員的新增權限)、`apps/api/src/project/lottery/checkout/checkout.test.ts`(交班結帳:真的表單引擎 + 兩關流程 + 掛接點;應有現金公式每一項各一筆並與看板相等、精靈只讀、權限與負責人 / 店長、留給下一班 > 0 沒接班人擋下、差額原因、沒有接班人 → 店長審核、駁回與作廢擋下、這一班結束與盤點單建立、有接班人 → 接班人審核、送出後再開班期初 = 留給下一班、退回改金額 → 下一班期初跟著更新、沿用 30 分鐘、跳過盤點、列表與檢視頁)、`packages/domain/src/project/lottery/checkout.test.ts`(結帳內容、面額、交接的檢查)、`apps/db-migrator/seeds/project/store.checkout-confirm.test.ts`(受管表單、兩關流程、店員的新增權限)、`apps/api/src/project/lottery/daily-close/daily-close.test.ts`(日結與存銀行:真的表單引擎 + 兩關流程 + 掛接點;還有班沒交班 / 涵蓋的交班沒核准擋下、日結 → 店長審核、審核中不能再送、涵蓋計算期間與沒有日結的日子、送出後再交班的班算下一次、已被涵蓋的上一班 → 第一班、小金庫應有逐項與差額原因、存入超過實點擋下、完成時寫存入 + 存銀行流水、完成後小金庫應有 = 清點 + 之後流水、[存銀行] 超過應有 / 成功 / 沒有可用帳戶 / 沒有權限、日結逾期提醒(注入排程時點)與側欄數字)、`packages/domain/src/project/lottery/daily-close.test.ts`(結帳內容、存入銀行的檢查、沒有日結的日子、日結逾期的時點)。

## 使用者說明(help.md)

`apps/admin/src/md/module-help/project/additions/store.help.md`(租戶使用者看的說明;守詞彙表)。admin 元件測試:`StorePage.test.tsx`、`StoreReceiptsPrint.test.tsx`(58mm 單據:投庫 / 出庫 / 開班領零用金 / 存銀行,寫入成功 → 一個列印工作、失敗 → 沒有、沒有收據機不印)、`StoreFormReceiptsPrint.test.tsx`(交班結帳 / 日結 / 撤銷售出申請,送出成功 → 一個列印工作、失敗 → 沒有、退回後編輯頁再送出會印、審核決定不印、退款收據印退款班次收銀點的印表機且印的期間按鈕停用、檢視頁 [列印])與版面快照 `lib/project/lottery/receipts/store-receipts.test.ts`、`checkout-receipts.test.ts`、`StoreSales.test.tsx`、`redemption/Redemption.test.tsx`(兌獎)(刷條碼 / 相機 / 快速銷售、撤銷、選遊戲、拆本精靈、展開卡片、沒有權限);假 api `apps/admin/src/test/msw/project/lottery/store-handlers.ts`、`store-sales-handlers.ts`(銷售共用同一份看板狀態);撤銷售出申請 / 現金更正單:`forms/StoreForms.test.tsx`(兩個分頁、[+ 新增] 與 B9b、沒有 [存草稿]、撤銷售出申請新增頁、掃描用途、[送撤銷售出申請] 帶入),假 api `store-forms-fixtures.ts`;盤點:`stocktake/Stocktake.test.tsx`(看板 [盤點] 與提醒、選範圍、盤點中刷碼不會被當成售出、差異核對與補登售出、已被處理的提示、送出的盤點內容、沒有權限、盤點紀錄 → 檢視頁),假 api `stocktake-handlers.ts`、`stocktake-fixtures.ts`、`stocktake-form-fixtures.ts`;日結與存銀行:`daily-close/DailyClose.test.tsx`(頂部上次日結、[日結] 停用與提示、權限、存銀行視窗、五步精靈與送出的結帳內容、檢視頁),假 api `daily-close-handlers.ts`、`daily-close-fixtures.ts`;交班結帳:`checkout/Checkout.test.tsx`(看板 [交班結帳] 與權限、四步精靈、補登兌獎、面額清點與差額原因自動帶入、交接檢查、送出的結帳內容、取消不留資料、現在盤點刷碼不會被當成售出、班次結帳歷史紀錄 → 檢視頁),假 api `checkout-handlers.ts`、`checkout-fixtures.ts`、`checkout-form-fixtures.ts`。
