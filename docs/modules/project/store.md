# 店面管理(技術)

## 用途

店裡每天收錢、賣刮刮樂的地方(專案規格第 6 章):**看板**(每個收銀點的標題列與檯面上的本)、**本機收銀點**(每台裝置設定、存在瀏覽器)、**收銀班次**(開班、班次資訊、改對應排班)、**投庫 / 出庫**、**抽屜應有現金**與看板的**即時同步**;**銷售**(刷條碼、相機、快速銷售、手動標記)、**當下撤銷**、**卡片原地展開**、**拆本**、**移櫃 / 收回**。**撤銷售出申請**、**現金更正單**(兩張表單、撤銷售出 / 現金更正分頁)。兌獎、盤點、交班結帳、日結、存銀行與盤點確認申請、結帳確認申請由之後的功能各自加上。

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
- 分頁登記在 `apps/admin/src/pages/project/lottery/store/store-tabs.ts`,各功能依規格 6.1 的順序追加自己那一列;目前有 看板(`store.view`)、撤銷售出、現金更正(`store.view`)、兌獎紀錄(`store.view`,兌獎的功能)與 其他申請(表單引擎的預設列表 `FormListPage`)。
- 新增頁 `store.create-page` 換成 `StoreCreatePage`:撤銷售出申請(`/store/create-page/sale_reversal`)用替換新增頁,其他表單(現金更正單、租戶自己綁的表單)沿用表單引擎的新增頁。
- 網址狀態:`?tab=`、看板 / 撤銷售出 / 現金更正 / 兌獎紀錄的分店 `?org=`(切分頁不換店)、其他申請的篩選 `?list=`、兌獎紀錄的篩選與頁碼 `?redemptions=`;撤銷售出申請新增頁的帶入值 `?org=`、`?ticket=`(`app/project/url-state-inventory.ts`)。
- 共用元件(`apps/admin/src/components/project/lottery/`):`CashPointHeader`(收銀點標題列;按鈕用 `actions` 陣列,各功能追加自己的按鈕)、`BoardBookCard`(看板卡片;`expanded` = 展開中的主色框)、`TicketGrid`(`flash` 讓刷到的那一格閃一下)。

正本:`apps/db-migrator/seeds/project/store.ts`、`apps/admin/src/app/project/module-pages.ts`

## 權限表

規格 3.2:表單模組固定四條 + 頁內權限;開啟 B9b 的 `store.create-<formKey>` 由表單發布時建立。

| 權限 key                       | moduleId 指向 | 它是哪一頁的什麼                                                                                                        |
| ------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `<每個節點>.*`                 | 各節點        | wildcard;seed 自動產生                                                                                                  |
| `store.view`                   | `store`       | 看板分頁 + `lotteryStoreBoard`、`lotteryShiftInfo`;換發 `board:<分店>` 憑證的資格(`project/realtime-boards.ts`)         |
| `store.create`                 | `store`       | 表單引擎的新增(開啟 B9b 後,有表單時改看 `store.create-<formKey>`)                                                       |
| `store.edit`                   | `store`       | 表單引擎的編輯;**也代表「店長」**(見下方)                                                                               |
| `store.delete`                 | `store`       | 表單引擎的刪除                                                                                                          |
| `store.create-sale_reversal`   | `store`       | 撤銷售出申請的新增(B9b,表單發布時建立):撤銷售出分頁的 [+ 新增]、撤銷確認視窗的 [送撤銷售出申請]                         |
| `store.create-cash_correction` | `store`       | 現金更正單的新增(B9b):現金更正分頁的 [+ 新增]                                                                           |
| `store.sell`                   | `store`       | 銷售:`sellLotteryTickets`(刷條碼 / 相機 / 快速銷售 / 移櫃並售出 / 展開卡片的 [標記售出])                                |
| `store.undo-sale`              | `store`       | 當下撤銷:`undoLotteryTicketSale`;售出提示的 [撤銷]、[最近售出] 每列的 [撤銷]、展開卡片的 [撤銷售出]                     |
| `store.split`                  | `store`       | 本機收銀點開班中 [拆本] + `splitLotteryBook`(含分放到多個收銀點、標跳號)                                                |
| `store.move`                   | `store`       | `moveLotteryTickets`、`recallLotteryTickets`;展開卡片的 [移櫃] [收回] [移櫃並售出];刷到別人的班的檯面要它才能移櫃並售出 |
| `store.redeem`                 | `store`       | 兌獎(兌獎的功能)                                                                                                        |
| `store.undo-redeem`            | `store`       | 撤銷已結帳的班或別人登記的兌獎(兌獎的功能)                                                                              |
| `store.open-shift`             | `store`       | 未開班的收銀點 [開班] + `lotteryStoreOpenShiftForm`、`openLotteryShift`、開班視窗的 [打卡] `punchLotteryShiftStart`     |
| `store.deposit`                | `store`       | 本機收銀點開班中 [投庫] + `depositLotteryShiftCash`                                                                     |
| `store.withdraw`               | `store`       | 本機收銀點開班中 [出庫] + `withdrawLotteryShiftCash`;開班視窗的「從小金庫領零用金」(第一班)                             |
| `store.bank-deposit`           | `store`       | 存銀行(存銀行的功能)                                                                                                    |
| `store.stocktake`              | `store`       | 盤點(盤點的功能)                                                                                                        |
| `store.checkout`               | `store`       | 交班結帳與日結(結帳的功能)                                                                                              |
| `store.skip-stocktake`         | `store`       | 交班結帳、日結的「跳過盤點」(結帳的功能)                                                                                |
| `store.confirm-lost`           | `store`       | 盤點待查清單的 [確認遺失](盤點的功能)                                                                                   |

- **店長 = 持有 `store.edit`**:規格「只有這一班的負責人或店長」沒有對應的權限,角色又是租戶資料、不能用名稱判斷,所以「店長類操作」(改別人的班的對應排班;之後的 [交班結帳] 也一樣)一律看 `store.edit`。租戶把店面管理的「編輯」開給別的角色,那個角色也會被當成店長。判斷集中在 `apps/api/src/project/lottery/store/store-access.ts` 的 `isStoreManager(grant)`,之後的票沿用同一支,不另寫。
- **沒有權限時**(按鈕直接不顯示):沒有 `store.open-shift` 看不到 [開班];沒有 `store.deposit` 看不到 [投庫];沒有 `store.withdraw` 看不到 [出庫](開班視窗沒有「從小金庫領零用金」);沒有 `store.split` 看不到 [拆本](刷到未拆的本只顯示資訊);沒有 `store.move` 看不到 [移櫃] [收回] [移櫃並售出];沒有 `store.sell` 看不到 [標記售出];沒有 `store.undo-sale` 看不到 [撤銷售出] 與售出提示的 [撤銷];沒有 `inventory.recover` 刷到待查的張只提示、看不到 [尋回]。
- 開通時建立的角色(規格 3.3,`apps/db-migrator/seeds/project/onboarding/role-grants/store.ts`):總部管理、店長 店面管理全部(各節點 `*`,含 `bank-deposit`);店員 `view`、`sell`、`undo-sale`、`split`、`move`、`redeem`、`open-shift`、`deposit`、`withdraw`、`stocktake`、`checkout`(不含 `bank-deposit`、`undo-redeem`、`skip-stocktake`、`confirm-lost`;撤銷售出申請與現金更正單的新增 `store.create-sale_reversal` / `store.create-cash_correction`)。

## 頁面規則

### 看板(ST-01 / 02 / 34)

- 頂部:分店選擇器 `OrgTreeSelect scope="visible"`(預設目前組織,`?org=`)、本機收銀點下拉、「你開著的班:店內櫃台 · 店外攤位」(自己在這家店開著兩個以上的班時)、連線狀態小圓點(`useRealtimeStatus`:綠 = 即時、黃 = 重新連線中);沒有重新整理按鈕。上次日結、[盤點] [存銀行] [日結]、距上次盤點超過 24 小時的提醒由各自的功能加上。
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

兩張都是**受管表單**(`seeds/project/revisions/sale_reversal.r1.seed.ts`、`cash_correction.r1.seed.ts`):綁 `store`、**沒有草稿**(`allowDraft: false`)、單號 `R-0001` / `X-0001`、作廢原因用共用「作廢原因」(`void-reason`)。流程不 seed,由開通腳本建(`onboarding/form-workflows/store-forms.ts`)。

| 表單         | formKey           | 欄位                                                                                                                                                                                                                                                                                                  | 新增頁           |
| ------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 撤銷售出申請 | `sale_reversal`   | 分店 `branch`、張數 `lines[{ book, ticket_nos, tickets, amount }]`(每本一列)、原因 `reason`(欄位管理「撤銷售出原因」`lottery-sale-reversal-reason`)、退款給客人 `refund`(是 / 否)、退款班次 `refund_shift`(`lottery_shift`,退款 = 是才顯示)、說明 `note`、退款金額 `refund_amount`(明細金額合計,計算) | 替換(ST-31b)     |
| 現金更正單   | `cash_correction` | 分店、方向 `direction`(現金增加 / 減少)、金額 `amount`(正整數)、位置 `place`(某一班的抽屜 / 小金庫)、班次 `shift`(位置 = 抽屜才顯示)、歸屬班次 `attributed_shift`(選填)、原因類別 `reason`(欄位管理「現金更正原因」`lottery-cash-correction-reason`)、說明 `note`(必填)                               | 表單引擎(不替換) |

**建議流程設定**(開通腳本建的那一份,規格 2.1):兩張都是一關「店長審核」,人員條件「角色 店長 且 所屬組織屬於表單欄位『分店』(本身)」,**B5 申請人是審核者時自動通過**(`autoApprove.applicant`;店長自己送的單直接完成)。租戶要改審核者,自己改流程。

- **撤銷售出分頁**(ST-31a):`lotteryStoreSaleReversals(orgId)`,列 單號、張數(每本一段「5164 #031–032」+ 張數)、原因、退款(退款 = 否顯示「—」)、退款班次、狀態;點列開表單引擎的詳情。分頁頂部分店 `OrgTreeSelect scope="visible"`;[+ 新增] 只在 `moduleForms` 的這張表單 `canCreate`(= 持有 `store.create-sale_reversal`)時顯示。電腦 / 平板表格、手機卡片。
- **撤銷售出申請新增頁**(ST-31b,`SaleReversalCreatePage`):分店、原因;刷條碼(宣告掃描用途 `store-sale-reversal`,不會跳快速銷售)或輸入編號 → `lotteryStoreScan` 找到張,本店已售的加進那一本的一組格子(格子資料 `lotteryStoreBookCard`;本店已售且沒被鎖定的張可選,其他「不能選」);選原因時依預設代碼帶入退款(`REFUND_DEFAULT_REASON_KEYS`:客人退貨 = 是,其他含租戶新增的 = 否),可改;退款班次 `lotteryStoreShiftOptions(orgId)`(本店開著的 + 最近 14 天開過的班,預設操作者自己開著的班 `mine`);退款金額 = 面額合計(唯讀)。送出走表單引擎 `createAndSubmitFormSubmission`(`useFormDraft`)。從看板撤銷確認視窗進來帶 `?ticket=<張 id>&org=<分店>`:讀那次售出的顯示鍵換成正面編號去刷、以張 id 對到那一張。按鈕目前是 [送出];「退貨退款收據」與 [送出並列印收據] 由列印的功能加上。
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
- **小金庫的現金更正「減少」不檢查小金庫應有**:現金更正單登記的是實際短少的錢(例:假鈔、存款短少),短少已經發生,擋下只會讓帳記不進去;出庫、存銀行這類「從小金庫拿錢」的動作才檢查應有(`StoreVaultGuard.assertCovers`)。現金更正只碰同一個守門文件(`StoreVaultGuard.serialize`,帶掛接點交易的 session)和它們序列化。
- 完成時讀不到退款班次 / 位置那一班或單據(送出後被刪)→ `CONFLICT`;值不完整 → `VALIDATION_FAILED`;整個核准回復。

流水的 `refType = "store"`、`refId` = 提交 id、`refRevision` = 修訂號。完成時對 `board:<分店>` 送 `board` 信號。「不能選已關帳月份」(退款班次、現金更正位置)由關帳的功能加在 `beforeSubmit`。

**給交班結帳的查詢**:`StoreFormsQueryService.pendingCashImpacts(reader, shiftId)`(`LotteryStoreModule` 匯出)回審核中的現金更正單(位置 = 這一班,±金額)與撤銷售出申請(退款 = 是、退款班次 = 這一班,−退款金額),依送出時間排;交班精靈第 ③ 步列出並自動帶入差額原因(規格 6.9)。

**事後更正**(規格 6.12):現金流水的 `postCloseOf` 指向被更正的那一班。抽屜應有的現金流水來源(`CashLedgerService.sumShiftMovements`)不含事後更正,所以那一班結帳時的應有不變;事後更正淨額用 `CashLedgerService.postCloseNet(reader, shiftId)`(退貨退款 −、現金更正 ±)。

### 開班(ST-04a / b / c)

- 期初零用金:**第一班**(這個收銀點沒有上一班,或上一班已被日結涵蓋)有 `store.withdraw` 時多一欄「從小金庫領零用金」(選填);**其他班** = 上一班「留給下一班」(唯讀,顯示來源)。
- 對應排班必選:預選 `findEntryForShift` 的結果;可改選這個人這天在這家店的其他排班,或「沒有排班(臨時代班)」。
- 選的排班沒有填進收銀點崗位的人力需求 → 提醒「你今天排的是「補貨」,確定要在店內櫃台開班嗎?」,按鈕改 [仍要開班](只提醒,照樣開班並記錄)。
- 選的排班還沒打上班卡、有 `schedule.my.punch` → 提示卡「你還沒打上班卡 [打卡]」。**已知限制**:選「沒有排班(臨時代班)」時不顯示(規格 14.9 是「今天還沒打上班卡」);排班模組目前給刮刮樂的只有「打這一班的上班卡」,沒有「今天有沒有打過上班卡」與「打沒有排班的上班卡」,要先在 `entry-lookup.ts` 加這兩個入口。

### 班次資訊與改對應排班(ST-42a / b)

- 班次資訊:負責人與開班時間、期初零用金、對應排班、任務快照;開班時崗位不一致時另外標示。
- [改對應排班]:api 回 `canReassign`(負責人或店長、交班結帳送出前)才顯示;選負責人那天在這家店的另一筆排班或「沒有排班」,原因必填(欄位管理「改對應排班原因」`schedule-entry-reassign-reason`,選「其他」說明必填)。

### 兌獎(ST-11a / b、ST-38a / b、ST-39a / b / c、ST-40、ST-41)

- 標題列:開班中的本機收銀點、有 `store.redeem` → [兌獎](按鈕列最前面);本機收銀點、自己開的那一班 → [最近兌獎](文字按鈕,最後)。按鈕由 `redemption/redemption-board-actions.ts` 組,看板只追加。
- **兌獎視窗**(`RedeemDialog`):刷背面編號(輸入後 Enter / 離開欄位)→ `lotteryRedemptionPreview` 顯示遊戲、面額、本號、張號、本店的刮刮樂與否、已兌過的提示「這張已兌過獎(10/13 18:02 店外攤位)」;常見金額 200 / 500 / 1,000 / 2,000 + 自由輸入。單張超過 5,000、超過抽屜應有在畫面先擋,api 再擋一次。
- 兌獎成功 → 提示「已兌獎 5164-056527-031 · 500 元 · 店內櫃台 [撤銷]」(能自己撤銷時才有 [撤銷],直接開那一筆的確認視窗);**不**自動打開 [最近兌獎]。
- **[最近兌獎]**(`RecentRedemptionsDrawer`,`lotteryRecentRedemptions`):自己在這一班登記的(含已撤銷,標「已撤銷」);電腦 / 平板右側抽屜、手機底部面板;每列 [撤銷] 開確認視窗,撤銷後清單不關;點列的其他地方開兌獎紀錄詳情。
- **撤銷兩層**(都不用審核;按鈕看 api 回的 `revokeMode`,沒有權限不顯示,`@repo/domain/project/lottery` 的 `redemptionRevokeStateOf` 前後端共用):
  - `self`:自己登記、那一班還開著、有 `store.redeem` → 確認視窗(ST-41),不限時間、不用原因(原因代碼固定 `immediate`「當下撤銷」)。交易內鎖班時那一班剛好已送出交班結帳 → 擋下(`SHIFT_CLOSED`),不讓交班那一刻變成事後更正,改由 `store.undo-redeem` 撤銷。
  - `manager`:那一班已結帳、或不是自己登記的,有 `store.undo-redeem` → 撤銷原因(必填,欄位管理「撤銷兌獎原因」`lottery-redemption-revoke-reason`)+ 說明(ST-39b);班開著 → 應有增加,已結帳 → 記成那一班的事後更正。另有 [撤銷並重新登記]:原因填好後開兌獎視窗(標題「重新登記 · 收銀點」),撤銷與新增在同一個請求(`replaceLotteryRedemption`),新的那筆算原班、`replacesId` 指向原紀錄。
  - 已送兌:[撤銷兌獎] 停用並提示「已送兌,不能撤銷;要先撤回或退回進貨單 P-xxxx」(ST-39c),api 也拒絕(`REDEMPTION_SENT`)。
- **兌獎紀錄分頁**(`RedemptionsTab`,ST-40):分店沿用看板的 `?org=`;篩選與頁碼存網址 `?redemptions=`(REACT-14):期間(空 = 這個月 1 日到今天,租戶時區)、收銀點、狀態、登記人(選項取同一段期間出現過的人)、頁碼(一頁 20 筆);欄位 時間、收銀點、班次、刮刮樂、金額、狀態、登記人、進貨單;平板 / 手機改卡片、篩選收進抽屜;點一列開兌獎紀錄詳情。
- **兌獎紀錄詳情**(`RedemptionDetailDialog`,ST-39a):刮刮樂、獎金、收銀點 / 班(已交班)、登記、狀態(已送兌帶進貨單單號;事後更正另標);已撤銷另列撤銷人與原因。入口:兌獎紀錄分頁、[最近兌獎]、進貨單的新增頁兌獎區與檢視頁(讀取依據是讀得到那張進貨單,`lotteryPurchaseRedemptionRecords`;這兩個入口不能撤銷)。視窗串接在 `redemption/useRedemptionFlow.tsx`(看板與分頁共用)。

### 投庫 / 出庫(ST-12a / b)

- 投庫:顯示這個收銀點的應有現金;金額超過 → api 擋下(`AMOUNT_EXCEEDS_DRAWER`)。出庫:顯示小金庫應有;原因必填(欄位管理「出庫原因」`lottery-withdraw-reason`);金額超過小金庫應有 → api 擋下(`AMOUNT_EXCEEDS_VAULT`,提示先用現金更正單登記小金庫實際的錢;使用者 10/21 定案)。開班時「從小金庫領零用金」同一條規則。不用審核,做完就生效;「自動列印」由列印的功能加上。

## api 介面

### GraphQL

| 端點                                               | 權限                         | 說明                                                                                                                                      |
| -------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `lotteryStoreBoard(orgId)`                         | `store.view`                 | 看板:啟用中的收銀點(排序)、各自開著的班(負責人、`isMine`、期初、應有、本班已售、未對應排班)、檯面上的本;`myOpenShifts`;小金庫應有         |
| `lotteryStoreOpenShiftForm(cashPointId)`           | `store.open-shift`           | 開班視窗:`plan`(`first` / `handover`)、上一班留給下一班與來源、`canTakeFloat`、`suggestedEntryId`、這天的排班(任務、快照、是否已打上班卡) |
| `openLotteryShift(input)`                          | `store.open-shift`           | `{ cashPointId, scheduleEntryId?, temporaryCover, floatFromVault? }`                                                                      |
| `punchLotteryShiftStart(entryId)`                  | `store.open-shift`           | 打這一班的上班卡(排班模組再查 `schedule.my.punch`)                                                                                        |
| `lotteryShiftInfo(id)`                             | `store.view`                 | 班次資訊 + `canReassign` + 可以改選的排班                                                                                                 |
| `reassignLotteryShiftEntry(input)`                 | 負責人或店長(service 判斷)   | `{ shiftId, scheduleEntryId?, temporaryCover, reasonKey, reasonNote? }`                                                                   |
| `depositLotteryShiftCash(input)`                   | `store.deposit`              | `{ shiftId, amount, note? }`                                                                                                              |
| `withdrawLotteryShiftCash(input)`                  | `store.withdraw`             | `{ shiftId, amount, reasonKey, reasonNote?, note? }`                                                                                      |
| `lotteryStoreScan(input)`                          | `store.view`                 | `{ orgId, localCashPointId?, code }` → 刷到的張與處理方式 `outcome` / `blockReason`(本號對到多款遊戲時多筆)                               |
| `sellLotteryTickets(input)`                        | `store.sell`                 | `{ orgId, localCashPointId, tickets[{ ticketId, version }], source: scan \| manual, confirmMove?, reasonKey?, reasonNote? }`              |
| `lotteryStoreSale(ticketId)`                       | `store.view`                 | 那張最近一次售出 + `undoBlock`(撤銷確認視窗)                                                                                              |
| `lotteryStoreRecentSales(shiftId)`                 | `store.view`                 | [最近售出]:自己在這一班 30 分鐘內的售出(`undone`、`undoBlock`)                                                                            |
| `undoLotteryTicketSale(input)`                     | `store.undo-sale`            | `{ ticketId, version }`;不符條件 → `UNDO_NOT_ALLOWED`                                                                                     |
| `lotteryStoreBookCard(orgId, bookId)`              | `store.view`                 | 展開卡片 / 拆本精靈:這本在這家店的張(不含跳號;`soldShiftId`、`locked`)、待標註、是否未拆                                                  |
| `lotteryStoreUnopenedBooks(orgId)`                 | `store.view`                 | 拆本選本:本店還沒拆的本                                                                                                                   |
| `splitLotteryBook(input)`                          | `store.split`                | `{ orgId, bookId, skippedTicketNos, assignments[{ cashPointId, ticketNos }] }`                                                            |
| `moveLotteryTickets(input)`                        | `store.move`                 | `{ orgId, tickets, toCashPointId }`(檯面上未售的張)                                                                                       |
| `recallLotteryTickets(input)`                      | `store.move`                 | `{ orgId, tickets }`(檯面 → 庫存)                                                                                                         |
| `lotteryRedemptionPreview(input)`                  | `store.redeem`               | `{ orgId, code }` → 遊戲、面額、本號、張號、`isOwnStore`、`existing`(未撤銷的那一筆的時間與收銀點;整個租戶)                               |
| `redeemLotteryTicket(input)`                       | `store.redeem`               | `{ shiftId, code, prizeAmount, note? }`;班要開著、金額 ≤ 5,000、≤ 抽屜應有                                                                |
| `revokeLotteryRedemption(input)`                   | 兩層(service 判斷)           | `{ id, reasonKey?, reasonNote? }`:自己登記且班開著(`store.redeem`)不用原因;其他要 `store.undo-redeem` 與原因                              |
| `replaceLotteryRedemption(input)`                  | `store.undo-redeem`          | `{ id, reasonKey, reasonNote?, code, prizeAmount, note? }` → `{ revoked, item }`(撤銷並重新登記,同一個交易)                               |
| `lotteryRedemptions(input)`                        | `store.view`                 | `{ orgId, from?, to?, cashPointId?, status?, redeemedBy?, offset?, limit? }`(最多 100)→ `{ items, total }`,登記時間新到舊                 |
| `lotteryRecentRedemptions(shiftId)`                | `store.view`                 | 自己在這一班登記的(含已撤銷),新到舊                                                                                                       |
| `lotteryRedemption(id)`                            | `store.view`                 | 兌獎紀錄詳情;每筆都帶操作者的 `revokeMode`(`self` / `manager` / null)與 `revokeBlockedBySent`                                             |
| `lotteryPurchaseRedemptions(orgId, submissionId?)` | `purchasing.purchase.create` | 進貨單新增頁的兌獎區:進貨分店「店內持有」的(+ 這張單已勾的)                                                                               |
| `lotteryStoreShiftOptions(orgId)`                  | `store.view`                 | 撤銷售出申請的退款班次:本店開著的 + 最近 14 天開過的班(新的在前;`label`、`open`、`mine` = 操作者自己開著的)                               |
| `lotteryStoreSaleReversals(orgId)`                 | `store.view`                 | 撤銷售出分頁:這家店的撤銷售出申請(草稿以外,新的在前,最多 200 筆)                                                                          |
| `lotteryStoreCashCorrections(orgId)`               | `store.view`                 | 現金更正分頁:這家店的現金更正單                                                                                                           |

- 撤銷售出申請、現金更正單的寫入一律經表單引擎(送出 / 審核 / 掛接點,見上方「撤銷售出申請與現金更正單」);lookup 來源 `lottery_shift`(`project/lookup-providers.ts`,顯示欄 `label`,讀取要 `store.view`;可攜、沒有固定條件)。
- 排班只經 `ScheduleModule` 匯出的 `ScheduleEntryLookup` 讀(`findEntryForShift` / `listEntriesOfDay` / `taskSnapshotFor` / `punchStart` / `hasStartPunch`;依賴方向刮刮樂 → 排班)。
- 現金流水經 `CashLedgerService.recordCashMovement`(交易內)。出庫原因的欄位管理選項對到流水的原因代碼:「開班零用金」→ `opening_float`、「補零錢」→ `change`、其他(含租戶自己加的選項)→ `other`,選項名稱與說明寫進流水備註(`store-cash.service.ts` 的 `withdrawReasonOf`)。
- 讀取照操作者的可見範圍;負責人名稱以租戶邊界讀(`shift-views.ts`,反查)。刷到時的張以租戶邊界反查(`store-sales.service.ts`:待查 / 遺失的張可能在別家店、不是本店的也要說得出來);寫入一律照操作者的範圍經帳本。

正本:`apps/api/src/project/lottery/store/`、`apps/api/src/project/lottery/redemption/`、`packages/graphql/src/documents/project/lottery/store.graphql`、`redemption.graphql`

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
| `closedAt`、`checkoutId`                                | 送出交班結帳時填(結帳的功能)                                                                                                         |
| `drawerVersion`                                         | 動到這一班抽屜的動作在交易內先 +1,同一班同時的投庫互相衝突、重試時依序檢查                                                           |
| `label`                                                 | 顯示名稱 `店內櫃台 · 李小華 10/21 13:00`(開班時存,`shiftLabelOf`,租戶時區);lookup 來源 `lottery_shift` 的顯示欄。之前開的班 = 空字串 |

- 部分唯一索引 `(cashPointId)`(`closedAt`、`deletedAt` 為 null):同一個收銀點同時只能有一班;兩人同時開班由索引擋下後到的(`SHIFT_ALREADY_OPEN`)。
- 一個人只能同時開同一家店的班:開班的交易一開始對這個人的守門文件 `lottery_shift_person_locks`(一個租戶一人一筆,歸屬租戶頂層)`$inc`,再以租戶邊界查他在別家店開著的班(`SHIFT_IN_OTHER_STORE`);同一人在兩家店同時開班,兩個交易在守門文件上衝突、重跑的一方被擋下(`store-person-locks.ts`)。
- 從小金庫拿錢(出庫、開班領零用金)不能超過小金庫應有(`CashLedgerService.vaultExpected`):交易外先建好這家店的小金庫守門文件 `lottery_vault_locks`(一家店一筆),交易內先 `$inc` 再算應有;同一家店同時兩筆在守門文件上衝突、重跑的一方讀得到對方的流水(`store-vault-guard.ts`;比照抽屜的 `drawerVersion`)。存銀行、調貨付現等其他從小金庫拿錢的動作由各自的功能決定要不要接同一支。
- 資料共用 `private`;模組 key `store`;清空示範機構依 `tenantId` 刪(`project/database/tenant-purge.ts`)。
- 第一班的判斷用兩個登記(`lottery/store/previous-shift.ts`):`registerHandoverAmount`(交班結帳登記「留給下一班」)、`registerDailyCloseCoverage`(日結登記「已被日結涵蓋」);沒有登記 = 留給下一班 0、沒被涵蓋。上一班的交班結帳被退回、修改留給下一班時,下一班的期初由結帳的功能更新。

### 兌獎 `lottery_redemptions`

| 欄位                                                                      | 說明                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `orgId`、`shiftId`、`cashPointId`                                         | 錢從那一班的抽屜付出                                                                 |
| `redeemedAt`、`redeemedBy`                                                | 登記時間、登記人                                                                     |
| `gameCode`、`bookNo`、`ticketNo`、`ticketLabel`、`rawInput`               | 遊戲代號、本號 7 位、張號、顯示用張編號 `5164-056527-031`(lookup 的標籤)、刷到的原文 |
| `ticketId`、`gameId`                                                      | 本店持有的那一張(不是本店的刮刮樂 = null)、遊戲(找不到代號 = null)                   |
| `prizeAmount`                                                             | 中獎金額(正整數,≤ 5,000)                                                             |
| `status`                                                                  | `in_store` 店內持有 / `sent` 已送兌 / `revoked` 已撤銷                               |
| `purchaseSubmissionId`、`sentAt`                                          | 勾進哪一張進貨單、送兌時間                                                           |
| `revokedAt`、`revokedBy`、`revokeReasonKey`、`revokeReason`、`revokeNote` | 撤銷時間、撤銷人、原因代碼(自己當下撤銷 = `immediate`)、原因名稱快照、說明           |
| `replacesId`                                                              | [撤銷並重新登記] 的新紀錄指向被撤銷的那筆                                            |
| `postCloseOf`、`revokePostCloseOf`                                        | **事後更正**:新增時 / 撤銷時那一班已結帳 → 指向那一班(見下方)                        |
| `version`                                                                 | 狀態改變的條件更新(撤銷、送兌、回到店內持有各 +1)                                    |

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

### 抽屜應有

`expectedDrawerCash(reader, shift)`(`lottery/store/drawer-cash.ts`)= 期初零用金 + 每個登記來源的淨額(流入抽屜 +、流出 −)。來源以 `registerDrawerCashSource(name, source)` 登記(名稱全域唯一):

| 來源             | 登記處                                   | 算什麼                                                                                                              |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ticket-events`  | `store-registrations.ts`                 | 這一班的張數事件:`cashEffect` 增加(售出、盤點補登)+、減少(當下撤銷)−;銷售與當下撤銷都寫在這裡                       |
| `cash-movements` | `store-registrations.ts`                 | 這一班的現金流水(投庫、出庫、調貨、退貨退款、現金更正);扣掉開班領零用金那一筆(已是期初);不含事後更正(`postCloseOf`) |
| `redemptions`    | `redemption/redemption-registrations.ts` | 這一班開著時登記、沒有在班開著時撤銷的兌獎:每筆 − 金額(交班後的撤銷 / 新增是事後更正,不算)                          |

之後的項目由那些功能在自己的 provider `onModuleInit` 登記自己的來源。

### 對其他功能的登記(`store-registrations.ts`)

| 登記                                              | 給誰                     | 內容                                                                          |
| ------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `registerOpenShiftResolver`(`cash/open-shift.ts`) | 收付(現金來源選抽屜)     | 收銀點開著的班                                                                |
| `registerOpenDrawersLister`(`cash/open-shift.ts`) | 即時現金帳、收付付款視窗 | 分店開著班的收銀點抽屜與應有(即時現金帳列出;付款視窗的現金來源 `cashDrawers`) |
| `registerCashPointDeactivationGuard`              | 檔案管理的收銀點停用     | 有開著的班、或檯面上還有未售的張 → 不能停用                                   |
| `registerPositionAnnotationProvider`              | 排班表(崗位旁的註記)     | 這家店各收銀點:崗位 → 收銀點名稱                                              |
| `registerEntryDeletionGuard`                      | 排班作業刪除排班         | 已被收銀班次綁定的排班不能刪                                                  |

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
| `SALE_REVERSAL_TICKET_NOT_REVERSIBLE` | 有張不是本店已售,或在其他未結束的撤銷售出申請上                                                           |
| `SALE_REVERSAL_AMOUNT_MISMATCH`       | 列的金額或退款金額 ≠ 面額合計                                                                             |
| `STORE_FORM_VOID_NOT_ALLOWED`         | 作廢(兩張表單完成後都不能作廢)                                                                            |

### 測試

`apps/api/src/project/lottery/redemption/redemption.test.ts`(兌獎:預覽、第 17 章第 4 / 5 / 7 題、重複與同時兌同一張、5,000 / 抽屜上限、[最近兌獎] 與分頁篩選、兩層撤銷與權限、自己撤銷遇到交班、事後更正淨額、稽核)、`apps/api/src/project/lottery/store/store-sales.test.ts`(端點 + 真 MongoDB:錢算在哪一班、刷到時各情況、當下撤銷四種不符與符合、同時兩次售出、拆本、移櫃情境表、手動標記)、`packages/domain/src/project/lottery/store-sales.test.ts`、`apps/api/src/project/lottery/store/store.test.ts`(端點 + 真 MongoDB:開班、同店兩個收銀點 / 跨店、同時開班、對應排班與快照、崗位不一致、改對應排班、投庫 / 出庫、同時投庫、排班刪除守門、收銀點停用守門、收付與即時現金帳的登記、看板卡片)、`store-board-ticket.test.ts`(`board:<分店>` 換發,RT-04)、`apps/db-migrator/seeds/project/store.test.ts`(模組宣告與角色配方)、`packages/domain/src/project/lottery/store.test.ts`、`apps/api/src/project/lottery/store/store-forms.test.ts`(撤銷售出申請 / 現金更正單:真的表單引擎 + 流程 + 掛接點;第 17 章第 6 題撤銷一側、不能選的張、駁回不記、作廢擋下、事後更正、B5、B9b、小金庫、歸屬班次、分頁列表、`pendingCashImpacts`)、`apps/db-migrator/seeds/project/store.forms.test.ts`(兩張受管表單、開通流程、店員的新增權限)。

## 使用者說明(help.md)

`apps/admin/src/md/module-help/project/additions/store.help.md`(租戶使用者看的說明;守詞彙表)。admin 元件測試:`StorePage.test.tsx`、`StoreSales.test.tsx`、`redemption/Redemption.test.tsx`(兌獎)(刷條碼 / 相機 / 快速銷售、撤銷、選遊戲、拆本精靈、展開卡片、沒有權限);假 api `apps/admin/src/test/msw/project/lottery/store-handlers.ts`、`store-sales-handlers.ts`(銷售共用同一份看板狀態);撤銷售出申請 / 現金更正單:`forms/StoreForms.test.tsx`(兩個分頁、[+ 新增] 與 B9b、沒有 [存草稿]、撤銷售出申請新增頁、掃描用途、[送撤銷售出申請] 帶入),假 api `store-forms-fixtures.ts`。
