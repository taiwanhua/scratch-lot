# 輸出報表(技術)

## 用途

「輸出報表」模組:選報表 → 填條件(期間、分店、其他條件)→ [預覽] [匯出 Excel]。本模組是**報表登記的外框**(專案規格 18.4 B11):外框只認得一份報表宣告的形狀,每張報表自己提供查詢與「查詢結果 → 工作表」;Excel 與預覽共用同一份工作表,畫面看到的就是匯出的內容。

登記了兩張報表:營運報表、班次結帳歷史報表(專案規格 11.2、11.3;見下方「營運報表」「班次結帳歷史報表」兩節)。Excel 產生器也給沒有期間 / 分店的單純表格用(出勤紀錄、採購清單)。

這是 S2 的專案客製(專案規格 18.2):先放專案路徑,回收前升格成底座,見文末「S2 升格待辦」。

正本:`apps/db-migrator/seeds/project/reports.ts`、`apps/admin/src/lib/project/reports/`

## 模組 key 與畫面

| key       | 名稱     | sidebarType | 路由       | 自有權限 |
| --------- | -------- | ----------- | ---------- | -------- |
| `reports` | 輸出報表 | link        | `/reports` | 見權限表 |

一頁,沒有隱藏頁。側欄排序 `order: 50`(專案模組依規格 3.1 的順序每隔 10 一號:店面 10、庫存 20、叫貨與進貨 30、帳戶 40、報表 50、經銷商 60、檔案管理 70、班表 80)。

**畫面**(Figma 報表頁 94:14;平板 / 手機照 RW-01–04 共用規則,不另畫):

| 編號  | 畫面                 | 電腦 1440                                      |
| ----- | -------------------- | ---------------------------------------------- |
| RE-01 | 選報表 → 條件:日     | `94:17`                                        |
| RE-02 | 預覽                 | `94:411`                                       |
| RE-03 | 選報表 → 條件:週、月 | `129:421`                                      |
| RE-04 | 營運報表 預覽        | `129:1186`(平板 `143:36149`、手機 `143:36385`) |
| RE-05 | 班次結帳歷史報表     | `129:1512`                                     |

外框只做選報表、期間、分店、其他條件、預覽、匯出按鈕;報表內容(RE-02 的八個區塊卡片、RE-04、RE-05)與月份格子的「已關帳 / 尚未關帳」屬於各報表(經報表登記的 `ConditionsAddon` / `MonthCaption` / `SheetBody` 接進外框)。

正本:`apps/db-migrator/seeds/project/reports.ts`、`apps/admin/src/app/project/module-pages.ts`

## 權限表

| 權限 key                  | moduleId 指向 | 它是哪一頁的什麼                                                        |
| ------------------------- | ------------- | ----------------------------------------------------------------------- |
| `reports.*`               | 輸出報表      | wildcard(同層語意,ADR-0004);seed 自動產生                               |
| `reports.operations`      | 輸出報表      | 報表選單出現「營運報表」                                                |
| `reports.shift-checkouts` | 輸出報表      | 報表選單出現「班次結帳歷史報表」                                        |
| `reports.export`          | 輸出報表      | [匯出 Excel](條件區與預覽都是);沒有就看不到按鈕,[預覽] 照常             |
| `reports.show-cost`       | 輸出報表      | 報表的成本與毛利欄;外框把它交給報表的 `sheets`(`canShowCost`)決定放不放 |

- 每張報表一條頁內權限 `reports.<報表 key>`,沒有的報表不出現在選單;一張都沒有時選單是空的並顯示說明。
- 進不進得去整頁看 `me.modules` 有沒有 `reports`;報表的查詢端點由各報表以 `reports.<報表 key>` 守門(api)。

**開通時建立的角色**(專案規格 3.3;配方 `apps/db-migrator/seeds/project/onboarding/role-grants/reports.ts`):

| 角色     | 授予                    |
| -------- | ----------------------- |
| 總部管理 | `reports` + `reports.*` |
| 店長     | `reports` + `reports.*` |
| 店員     | 不給                    |

正本:`apps/db-migrator/seeds/project/reports.ts`(`permissions`)、`apps/db-migrator/seeds/project/onboarding/role-grants/reports.ts`

## 資料

沒有自己的資料表(`docs/project/data-model.md` 無新表);各報表讀自己功能的資料。

## 規則

### 期間

選擇器給的是**租戶時區**的當地日期,admin 用表單引擎的 `startOfLocalDay`、`addLocalCalendar` 換成起訖時點(迄不含)再送 api;api 只收時點。沒有自訂區間。

| 類型 | 選擇器                                                         | 起               | 迄(不含)           |
| ---- | -------------------------------------------------------------- | ---------------- | ------------------ |
| 日   | 日期 + [今天] [昨天]                                           | 當日 00:00       | 隔日 00:00         |
| 週   | 月曆點任一天選整週,顯示「10/11(日)~ 10/17(六)」+ [本週] [上週] | **星期日** 00:00 | 下一個星期日 00:00 |
| 月   | 年份切換 + 12 個月格子 + [本月] [上月]                         | 1 日 00:00       | 下個月 1 日 00:00  |

- 一週固定從星期日開始(與 `MonthCalendar` 同一規則);週次不顯示。
- 「今天」是租戶時區的今天(頁面開啟時取一次),不用瀏覽器時區。
- 換期間類型時保留日期、整理成新類型的起點(日 10/14 → 週 10/11 → 月 10/1)。

### 條件放網址

`report`(報表 key)、`conditions`(期間、分店、其他條件)、`preview`(預覽開著沒、第幾個工作表)都經 `useUrlState`(REACT-14)。網址的條件可能來自別張報表或被手改,畫面先整理成這張報表合法的值:期間類型不在清單 → 第一種;分店去重、超過上限只留前面的;其他條件留這張報表宣告的全部(只在別種期間類型出現的也留著,例:日勾了「對齊日結」,切到週再切回日仍勾著),值不合用預設(勾選 = 不勾、下拉 = 第一個選項),送查詢時才依期間類型過濾。改條件會關掉預覽,上一次匯出失敗的提示也一併清掉(關掉預覽時同樣清掉)。

### 分店上限與範圍檢查

- admin:`OrgTreeSelect` 多選、`scope="visible"`(列整棵租戶樹 `tenantOrgTree`,只有可見範圍內的能選;預覽的分店名稱也取同一份)、`maxCount` = 報表的 `conditions.orgs.max`;沒選分店時 [匯出 Excel] [預覽] 都不能按。按鈕順序照 Figma RE-03:[匯出 Excel](主要)在左、[預覽](外框)在右。
- api:每張報表的查詢在讀資料前呼叫 `assertReportRange`,不合格丟 `GraphQLError`:

| 情況                                                                                     | 結果                                                      |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 期間類型不在 `allowed`(含不認得的字)                                                     | `VALIDATION_FAILED` + `reason: "RANGE_TOO_LARGE"`         |
| 分店數超過 `maxOrgs`                                                                     | `VALIDATION_FAILED` + `reason: "RANGE_TOO_LARGE"`         |
| 起訖長度超過該類型上限(日 25 小時、週 7 天 1 小時、月 31 天 1 小時;多的一小時給夏令時間) | `VALIDATION_FAILED` + `reason: "RANGE_TOO_LARGE"`         |
| 沒選分店                                                                                 | `VALIDATION_FAILED`(沒有 reason),`fields: ["orgIds"]`     |
| 起訖不是時點、或迄不晚於起                                                               | `VALIDATION_FAILED`(沒有 reason),`fields: ["from", "to"]` |

分店是否在操作者的可見範圍內由各報表的查詢自己處理。

### 工作表與 Excel

- 報表的 `sheets` 回「全部分店合計」一張 + 每家分店一張;外框排成合計在前、分店照選擇器順序,工作表名稱用分店名(合計固定「全部分店合計」)。
- Excel:每個工作表 A4、縮放成一頁寬(`fitToWidth: 1`、`fitToHeight: 0`)、每頁重複標題列(`printTitlesRow` = 第 1 列到表頭那一列;有表頭說明 `notes` 時說明列一起重複)。
- 工作表名稱依 Excel 限制整理:去掉 `\ / ? * : [ ]`、最多 31 字、重名加「 (2)」。
- exceljs 只在匯出時才載入(動態 import,獨立 chunk)。
- 匯出的資料:從預覽按 [匯出 Excel] 直接用預覽那一份(`fetchQuery` 帶 `staleTime: Infinity`,不重打 api,Excel 就是畫面上那一份);從條件區按(預覽沒開)時每次重查(`staleTime: 0`)。
- 檔名「報表名稱\_期間.xlsx」(例 `營運報表_2026-10-16.xlsx`)。

### 預覽

`SheetPreview`:工作表 → 表格,上方頁籤切工作表,預設顯示第一個(合計);表頭說明排在表格上方。預覽頁的標題是「報表 · 期間」,旁邊列出選的分店,右上 [返回條件] [匯出 Excel]。

正本:`apps/admin/src/lib/project/reports/report-period.ts`、`apps/admin/src/lib/project/reports/report-conditions.ts`、`apps/admin/src/lib/project/reports/excel.ts`、`apps/api/src/project/reports/report-range.ts`

## 報表登記介面

admin 登記一張報表:在 `apps/admin/src/pages/project/lottery/reports/report-registrations.ts` 的清單加一筆 `registerReport({...})`(`apps/admin/src/lib/project/reports/report-registry.ts`)。清單順序 = 選單順序;宣告式清單,載入時不寫共享狀態。

```ts
registerReport({
  key: "operations", // 權限 reports.operations(seed 要有同名一筆)
  name: "lotteryReports.reports.operations", // 訊息 key(admin namespace)
  conditions: {
    period: ["day", "week", "month"],
    orgs: { max: 50 },
    extra: [
      {
        key: "alignDailyClose", // 也是查詢 input 的欄位名
        type: "boolean", // 或 "select"(帶 options)
        label: "lotteryReports.extra.alignDailyClose", // 訊息 key
        only: "day",
      },
    ],
  },
  query: useOperationsReportQuery, // codegen 的 query hook(取它的 getKey / fetcher)
  sheets: buildOperationsSheets, // (data, context) => { total, branches }
});
```

| 欄位                                    | 說明                                                                                                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`                                   | kebab-case;權限 `reports.<key>`                                                                                                                                                                                                                                                  |
| `name`、`extra[].label`、選項的 `label` | **訊息 key**(`admin` namespace,I18N-01),不是文字;報表名稱放 `lotteryReports.reports.<key>`                                                                                                                                                                                       |
| `conditions.period`                     | 可選的期間類型,至少一種、不重複;頁籤順序照它,只有一種時不顯示頁籤                                                                                                                                                                                                                |
| `conditions.orgs.max`                   | 分店上限(正整數);選單上註明「分店最多 N 家」                                                                                                                                                                                                                                     |
| `conditions.extra`                      | 其他條件:`boolean`(勾選)、`select`(下拉,至少一個選項)、`custom`(報表自己給欄位元件 `Field`,值是字串、預設 `defaultValue`;選項要查 api 的下拉用它,網址裡的值不檢查選項、交給 api);`only` 限定某種期間類型;key 不可重複,也不可用 `periodKind` / `from` / `to` / `orgIds`           |
| `query`                                 | `{ getKey, fetcher }`,直接給 codegen 的 query hook;變數一律 `{ input }`(GQL-02)                                                                                                                                                                                                  |
| `sheets`                                | 查詢結果 → `{ total, branches: [{ orgId, ... }] }`;每張是 `{ columns, rows, notes? }`;context 有 `t`、`timezone`、`input`、`orgs`、`canShowCost`。`t` 是 `admin` namespace;工作表裡的訊息 key 寫完整路徑(`admin.` 開頭,死鍵掃描才認得),用 `fullPathTranslator(context.t)` 包一層 |
| `ConditionsAddon`(選填)                 | 條件卡片裡、其他條件下方的報表專屬區塊(拿到 `input`、期間類型與起點、其他條件的值)                                                                                                                                                                                               |
| `MonthCaption`(選填)                    | 月份格子下方的註記(拿到 `month`、`input`)                                                                                                                                                                                                                                        |
| `SheetBody`(選填)                       | 預覽換成報表自己的畫法(拿到同一份 `SheetData`;頁籤、表頭說明照外框);Excel 一律是表格                                                                                                                                                                                             |

宣告寫錯在載入時就丟錯(`registerReport("<key>"): …`),不等到使用者點到。

**查詢 input**(admin 組好交給 `fetcher`):`{ periodKind, from, to, orgIds, ...其他條件 }`,其他條件依 key 攤平(例 `alignDailyClose: true`);只在該期間類型出現的條件,其他類型不送。`periodKind` 是字串 `day` / `week` / `month`,api 端照收字串、交給 `assertReportRange` 驗(不另宣告 GraphQL enum,避免 enum 名稱與值不同)。

**api 端**:報表的 resolver 用 `@RequirePermission("reports.<key>")` 守門,service 讀資料前 `assertReportRange({ periodKind, from, to, orgIds }, { allowed, maxOrgs })`,`allowed` / `maxOrgs` 與 admin 的 `conditions` 同一組值。

**Excel 的其他用途**:`buildWorkbook({ sheets: [{ name, columns, rows }] })` 回 exceljs 的 `Workbook`;`downloadWorkbook({ sheets, fileName })` 直接下載。沒有期間 / 分店的單純表格(出勤紀錄、採購清單)直接給一個工作表即可。

正本:`apps/admin/src/lib/project/reports/report-registry.ts`、`apps/admin/src/lib/project/reports/excel.ts`、`apps/api/src/project/reports/report-range.ts`

## api 介面

外框本身沒有 GraphQL 端點;只提供共用函式 `assertReportRange`(`apps/api/src/project/reports/report-range.ts`)給各報表的 service 呼叫。

| 端點(Query)                                    | 權限                      | 說明                                                                    |
| ---------------------------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `lotteryOperationsReport(input)`               | `reports.operations`      | 營運報表:`{ closedThrough, canShowCost, stores[] }`,一家店一份 8 個區塊 |
| `lotteryOperationsReportPeriods(input)`        | `reports.operations`      | 條件畫面:各店實際期間(對齊日結)與已關帳到哪(`closedThrough`)            |
| `lotteryShiftCheckoutsReport(input)`           | `reports.shift-checkouts` | 班次結帳歷史報表:`{ rows[] }`,一班一列                                  |
| `lotteryShiftCheckoutsReportCashPoints(input)` | `reports.shift-checkouts` | 條件的收銀點下拉(選的分店的收銀點,含停用的)                             |

input:`{ periodKind, from, to, orgIds }`,營運報表另有 `alignDailyClose`,班次結帳歷史另有 `cashPointId`(空 = 全部)、`onlyWithDifference`。分店要在操作者的可見範圍內、同一個租戶(看不到 → `NOT_FOUND`);確認後以租戶邊界讀這些分店的資料(`report-scope.ts`,登記在 `project/database/tenant-boundary-callers.ts`,用途「反查」)。唯讀,不寫稽核。

正本:`apps/api/src/project/reports/report-range.ts`、`apps/api/src/project/lottery/reports/`

## admin 頁面

| 檔案                                                            | 內容                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pages/project/lottery/reports/ReportsPage/ReportsPage.tsx`     | 依權限過濾報表、選報表(網址 `report`)                                                                                                                                                                               |
| `pages/project/lottery/reports/ReportsPage/ReportWorkspace.tsx` | 條件 ↔ 預覽、網址狀態 `conditions` / `preview`                                                                                                                                                                      |
| `pages/project/lottery/reports/ReportsPage/useReportRun.ts`     | 預覽查詢、匯出(同一個 query key;從預覽按匯出用預覽那份快取、不重查,從條件區按匯出每次重查)                                                                                                                          |
| `components/project/ReportPeriodPicker/`                        | 期間選擇器(日 / 週 / 月 + 快捷;`monthCaption` 給月份格子加註記)                                                                                                                                                     |
| `components/project/SheetPreview/`                              | 工作表 → 表格的預覽(報表給了 `SheetBody` 就換成它的畫法)                                                                                                                                                            |
| `pages/project/lottery/reports/report-registrations.ts`         | 營運報表、班次結帳歷史報表的登記                                                                                                                                                                                    |
| `pages/project/lottery/reports/operations/`                     | 營運報表:工作表(`operations-sheets.ts`、列 `operations-rows*.ts`、合計 `operations-total.ts`)、逐店期間與提醒(`OperationsConditionsAddon`)、月份註記(`OperationsMonthCaption`)、區塊卡片預覽(`OperationsSheetBody`) |
| `pages/project/lottery/reports/shift-checkouts/`                | 班次結帳歷史報表:工作表(`shift-checkouts-sheets.ts`)、收銀點條件(`CashPointConditionField`)                                                                                                                         |

錯誤顯示在頁面上方(`Alert`),文案 `admin.lotteryReports.errors.<code>`。

正本:`apps/admin/src/pages/project/lottery/reports/`、`apps/admin/src/components/project/ReportPeriodPicker/`、`apps/admin/src/components/project/SheetPreview/`

## 營運報表

規格 11.2;一家店一份、8 個區塊 + 依遊戲展開,資料一律從紀錄讀(張數事件、現金流水、銀行交易、兌獎、盤點、結帳單、調貨點收、關帳),不另存彙總。「全部分店合計」由 admin 把各店加總(`operations-total.ts`;同一個銀行帳戶的期末餘額只算一次)。

| 區塊       | 算法                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 銷售     | 期間內這家店的張數事件:「售出」沒有原因 = 刷條碼(含快速銷售)、有原因 = 手動標記(依原因分列,名稱照欄位管理「手動標記原因」,停用的顯示代碼)、「售出(盤點補登)」、「撤銷」(當下撤銷 + 撤銷售出申請完成);淨銷售 = 售出 − 撤銷;依遊戲展開                                                                                                                                                                                                                                                                   |
| 2 毛利     | 已售成本 = 售出的張的單張成本合計 − 撤銷的張的單張成本合計;毛利 = 淨銷售 − 已售成本(要 `reports.show-cost`)                                                                                                                                                                                                                                                                                                                                                                                            |
| 3 兌獎     | 期間內登記的兌獎(依登記時間):有效的(扣掉已撤銷)、店內持有 / 已送兌;已撤銷另列                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 4 庫存異動 | 進貨 − 進貨作廢(本數、張數、本的成本);調入 / 調出 = 調貨點收(張數、調貨金額,依點收時間;調貨單被作廢的,在作廢時間那份報表反向算回);調貨損益 = 調出的調貨金額 − 原成本(點收紀錄記的調入前單張成本);報廢(報廢事件上的成本快照)、遺失、尋回(張的單張成本);跳號 − 取消跳號(不計成本);期末庫存 / 待查 = 期末(迄)那一刻在這家店的張(庫存 + 檯面;在途不算),期末成本是期末當時的單張成本(見下方「期末庫存」)                                                                                                    |
| 5 現金     | 期間內送出交班結帳的班:差額合計;期間內這家店**記的**事後更正(算在記錄當期,依原因類別:兌獎更正、盤點補登、退貨退款、現金更正;指向已關帳月份的照算,另在區塊 8「前期更正」標出);現金流水(不含事後更正):退貨退款、調貨支出 / 收入(現金)、投庫、存銀行(沖正的那一筆算負的);日結的小金庫差異                                                                                                                                                                                                                 |
| 6 銀行     | 這家店使用的帳戶(使用組織包含它,或期間內有歸屬這家店的交易):只算歸屬這家店的交易、依類型合計;期末餘額是整個帳戶的(註明共用)                                                                                                                                                                                                                                                                                                                                                                            |
| 7 未結清   | 期末時的待結清(待付 / 待退批貨款、待收 / 待付調貨款),依歸屬分店(`SettlementLedger.outstandingAt`):單據在期末以前第一次送出(`submittedAt`,退回後重送不改寫)、期末時還有效(之後才作廢 —— `voidedAt`、之後才駁回 —— 流程實例的 `finishedAt` —— 的照算);收付只算期末以前發生的銀行交易與現金流水;調貨單的已點收金額只算期末以前的點收;應付照期末當時的內容(取 `ctx.at` 早於期末的最後一筆修訂的完整值快照;沒有更早的修訂 = 當時還沒送出,不算)。各店期末不同時(對齊日結)每個期末各查一次,同一個期末只查一次 |
| 8 註記     | 跳過盤點次數與原因(交班 + 日結);盤點單沒盤完的本(「N 本未盤」,與「未盤點(跳過)」並列);沒有被日結涵蓋計算的班;前期更正;期間涵蓋、尚未關帳的月份                                                                                                                                                                                                                                                                                                                                                         |

- **成本與毛利**:沒有 `reports.show-cost` 時 api 回 null(已售成本、各遊戲成本、進貨成本、調貨損益、報廢 / 遺失 / 尋回成本、期末庫存成本),工作表不放毛利與調貨損益、其他成本欄留空。
- **對齊日結**(只有日):每家店用當天送出的日結的涵蓋計算期間(當天有多張:起點取最早那張的起點、終點取最後一張的終點;第一次日結沒有起點 → 當天 00:00);當天沒有日結的店改用整天,工作表與合計表頭標示「本店 10/16 未日結,期間改用整天,小金庫和盤點未核對」。選「日」時條件卡片一律提醒「不要把多天的日報加總當成週報或月報」(勾不勾都顯示);勾了對齊日結、選了分店再逐店列出實際期間。
- **期末庫存**:從張的現況往回推,只讀期末之後的事件(`at ≥ 迄`;索引 `{ "from.orgId": 1, at: 1 }` 與 `{ orgId: 1, at: 1 }`),不掃有史以來的事件 —— 在資料庫端彙總成「每張期末之後第一筆碰到這家店的事件」(一張一列),期末狀態 = 那一筆的「變動前」;沒碰過的張,期末狀態 = 現況(動過的在記憶體裡排除,不送大 `$nin`)。期末之後才調入別家店的張,單張成本用期末之後最早那筆點收記的調入前成本還原。分店一次最多 5 家平行計算。
- **已關帳 / 尚未關帳**:月份格子依最後一個已關帳月份標示;選到已關帳的月份說明「數字固定;之後的更正列在報表的「前期更正」」;月報表頭寫已關帳 / 尚未關帳。
- **前期更正**(規格 10.4「更正」;使用者 10/12 定案):紀錄指向已關帳的月份、而且記在那個月關帳之後 —— 事後更正指向的班(開班時間)、現金更正的歸屬班次、銀行沖正的原交易、撤銷的原售出。這些都照常算在記錄當期(事後更正在區塊 5、撤銷售出在銷售、沖正在銀行),「前期更正」只是在區塊 8 另外標出筆數與淨額;已關帳月份的報表數字不變。區塊 8 只有筆數與淨額(不逐筆列);逐筆的「前期更正,屬於 X 班」標在即時現金帳的流水上(`docs/modules/project/accounts.md`「即時現金帳」),班次結帳歷史則在原班那一列的「之後的更正」列出。

正本:`apps/api/src/project/lottery/reports/operations-report.service.ts`、`report-stock.ts`、`post-close-corrections.ts`、`report-periods.ts`;`apps/admin/src/pages/project/lottery/reports/operations/`

## 班次結帳歷史報表

規格 11.3、14.9;期間內送出交班結帳的班,一班一列(條件:分店、收銀點、只看有差額)。

| 欄位                   | 來源                                                                                                                                                                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 日期                   | 開班日期                                                                                                                                                                                                                                                                               |
| 負責人                 | 開班的人                                                                                                                                                                                                                                                                               |
| 協同                   | 開班時任務快照那筆人力需求裡,協同任務填的人(從排班取得:`ScheduleEntryLookup.helpersOfDemands`)                                                                                                                                                                                         |
| 任務內容               | 任務快照:崗位 · 職責 · 執行任務(欄位管理的名稱);未對應排班顯示「未對應排班」                                                                                                                                                                                                           |
| 開班 / 結帳            | 開班時間 / 送出交班結帳時間                                                                                                                                                                                                                                                            |
| 應有、實點、差額、原因 | 結帳單(送出那一刻的快照)                                                                                                                                                                                                                                                               |
| 之後的更正             | 原班之後才記的更正(兌獎、盤點補登、退貨退款、現金更正),**不加進原班的應有 / 差額**(結帳快照不變):同一天同類別合併一筆,例「+1,800(10/13 兌獎更正)」;記在那一班所在月份關帳之後的加註「前期更正」。api 回合計 `postClose` 與逐筆 `postCloseEntries`(類別、金額、記錄時間、`priorPeriod`) |
| 盤點                   | 跳過 →「未盤點(跳過):原因」(永久標示);盤點單沒盤完 →「N 本未盤」;兩者並列                                                                                                                                                                                                              |
| 審核                   | 結帳單狀態:待審核 / 已核准 / 已退回                                                                                                                                                                                                                                                    |

「全部分店合計」多一欄分店;每家店一張只列自己的班。

口徑與營運報表一致(使用者 10/12 定案):更正記在發生當時的期間;營運報表把它算進記錄當期(指向已關帳月份的歸「前期更正」),班次結帳歷史只在原班那一列加註說明,不改原班的數字。

正本:`apps/api/src/project/lottery/reports/shift-checkouts-report.service.ts`;`apps/admin/src/pages/project/lottery/reports/shift-checkouts/`

## 錯誤碼

| code / reason                           | 什麼時候                       | 畫面                                                      |
| --------------------------------------- | ------------------------------ | --------------------------------------------------------- |
| `VALIDATION_FAILED` + `RANGE_TOO_LARGE` | 期間類型、分店數或起訖超過上限 | 「期間或分店數超過這張報表的上限,請縮小範圍後再試一次。」 |
| `VALIDATION_FAILED`                     | 條件不完整                     | 「條件不完整,請檢查期間與分店。」                         |
| `FORBIDDEN`                             | 沒有該報表的權限               | 「你沒有這張報表的權限。」                                |
| `NOT_FOUND`                             | 選的分店不在可見範圍內         | 「報表產生失敗,請稍後再試。」                             |
| 其他                                    | —                              | 「報表產生失敗,請稍後再試。」                             |

正本:`apps/admin/src/pages/project/lottery/reports/ReportsPage/reports-error.ts`

## 稽核

外框不寫稽核(唯讀)。

## 測試

- api:`apps/api/src/project/reports/report-range.test.ts`(期間類型、分店數、起訖長度);`apps/api/src/project/lottery/reports/reports.test.ts`(權限、`RANGE_TOO_LARGE`、第 17 章第 5 題的事後更正 +1,800、對齊日結、8 個區塊各一組固定資料、班次結帳歷史的負責人 / 協同 / 條件、關帳後的前期更正)。
- seed:`apps/db-migrator/seeds/project/reports.test.ts`(模組、權限、開通角色配方)。
- admin:`lib/project/reports/report-period.test.ts`(台北與 UTC+0 的日 / 週 / 月起訖、跨月週、跨年週、閏年 2 月)、`report-conditions.test.ts`、`report-registry.test.ts`、`excel.test.ts`(寫出再讀回:工作表數、A4、fitToWidth、printTitlesRow);`components/project/ReportPeriodPicker/ReportPeriodPicker.test.tsx`;`pages/project/lottery/reports/ReportsPage/ReportsPage.test.tsx`(以測試報表 `reports-fixtures.ts` 換掉登記清單:選單依權限、空選單說明、[匯出 Excel] 依 `reports.export`、預覽、匯出、`RANGE_TOO_LARGE`);`pages/project/lottery/reports/LotteryReports.test.tsx`(正式登記:對齊日結的提醒與逐店期間、區塊卡片預覽、沒有 show-cost 沒有毛利、月份已關帳、班次結帳歷史的條件與盤點標示);`operations/operations-sheets.test.ts`、`shift-checkouts/shift-checkouts-sheets.test.ts`(工作表)。

正本:上列測試檔

## 使用者說明(help.md)

[reports.help.md](../../../apps/admin/src/md/module-help/project/additions/reports.help.md)

正本:`apps/admin/src/md/module-help/project/additions/reports.help.md`

## S2 升格待辦

回收前在 scratch-lot 開「升格」分支搬到底座(專案規格 18.2;同步流程 `docs/deployment.md`「底座首次接軌與版本升級」):

| 項目                  | 專案階段的位置                                                           | 升格時                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 模組 / 權限 seed      | `apps/db-migrator/seeds/project/reports.ts`                              | **seed 所有權轉移**:底座新增 seed 接手同一組 key(已發布的 seed 快照只能新增,不能改寫或刪除),專案 seed 以新增版本退場;驗證已部署環境的模組與權限不重複、不遺失 |
| 登記介面、期間、Excel | `apps/admin/src/lib/project/reports/`                                    | 搬到 `lib/base/reports/`;報表登記清單改成底座來源 + 專案來源(同 `module-pages` 的合成方式)                                                                    |
| 選擇器、預覽元件      | `apps/admin/src/components/project/ReportPeriodPicker/`、`SheetPreview/` | 搬到 `components/base/`                                                                                                                                       |
| 頁面                  | `apps/admin/src/pages/project/lottery/reports/`                          | 外框搬到 `pages/base/`;刮刮樂的報表登記留在專案                                                                                                               |
| 範圍檢查              | `apps/api/src/project/reports/report-range.ts`                           | 搬到底座 api;期間類型常數考慮放 `@repo/domain`(admin 與 api 現在各有一份 `REPORT_PERIOD_KINDS`)                                                               |
| 文案                  | `packages/i18n/messages/<語系>/project/admin.json` 的 `lotteryReports`   | 外框的字串搬到底座 `admin.json`(不帶 lottery 的新 namespace);報表名稱留專案;`packages/i18n/src/dead-keys.test.ts` 的動態 key 前綴跟著改                       |
| 說明                  | `apps/admin/src/md/module-help/project/additions/reports.help.md`        | 搬到 `base/`                                                                                                                                                  |
| 開通角色配方          | `apps/db-migrator/seeds/project/onboarding/role-grants/reports.ts`       | 留專案(開通腳本是專案的)                                                                                                                                      |
| 依賴                  | `apps/admin/package.json` 的 `exceljs`                                   | 隨程式進底座                                                                                                                                                  |
| Figma                 | 專案報表頁 94:14                                                         | 依底座流程重建外框畫面                                                                                                                                        |

升格後確認:`project/` 路徑不再有報表外框,只剩底座那一份;已部署環境的 `reports` 模組與權限資料不重複、不遺失。

## 平台視角備註

- 沒有任何一張報表的權限時,有 `reports` 模組的人看到的是「報表」選單的空狀態說明。
- 側欄順序:專案模組每隔 10 一號(見「模組 key 與畫面」),底座的總覽 0 在最前,申請中心 90、系統管理 95 排在業務模組之後(`docs/modules/module-manager.md`「側欄順序」)。

正本:`apps/db-migrator/seeds/project/reports.ts`
