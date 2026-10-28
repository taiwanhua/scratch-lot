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

- 報表的 `sheets` 回「全部分店合計」一張 + 每家分店一張(+ `extras` 其他工作表,排在最後);外框排成合計在前、分店照選擇器順序,工作表名稱用分店名(合計固定「全部分店合計」)。工作表建構拿得到產出時間 `generatedAt` 與產出人 `generatedBy`(登入者名稱)。
- Excel:每個工作表 A4、縮放成一頁寬(`fitToWidth: 1`、`fitToHeight: 0`)、每頁重複標題列(`printTitlesRow` = 第 1 列到表頭那一列;有表頭說明 `notes` 時說明列一起重複)。
- **分段表格**(`SheetData.sections`;營運報表用):一個工作表排好幾段小表,每段 = 標題列(深色底、合併到最寬那段的欄數)、表頭(淺色底、框線)、資料列(框線;列上 `_emphasis: "total"` = 合計列粗體、`_format: "percent"` = 比率列 `0.0%`)、補充說明(斜體);段與段之間空一列。表頭說明 `notes` 第一列粗體、凍結(`views` frozen)並每頁重複;一段放不進這一頁剩下的空間、但放得進一整頁 → 那一段前面換頁(估一頁 48 列,`sectionPageBreaksOf`);欄寬取各段同一欄最寬的。負數紅字由欄位的 `numFmt`(例 `#,##0;[Red]-#,##0`)決定。
- 工作表名稱依 Excel 限制整理:去掉 `\ / ? * : [ ]`、最多 31 字、重名加「 (2)」。
- exceljs 只在匯出時才載入(動態 import,獨立 chunk)。
- 匯出的資料:從預覽按 [匯出 Excel] 直接用預覽那一份(`fetchQuery` 帶 `staleTime: Infinity`,不重打 api,Excel 就是畫面上那一份);從條件區按(預覽沒開)時每次重查(`staleTime: 0`)。
- 檔名「報表名稱\_期間.xlsx」(例 `營運報表_2026-10-16.xlsx`)。

### 預覽

`SheetPreview`:工作表 → 表格,上方頁籤切工作表,預設顯示第一個(合計);表頭說明排在表格上方。分段表格逐段一張表(段標題 + 一句說明 + 表格 + 補充說明);手機(< sm)每列一張卡片(第一欄當標題、其他有值的欄「表頭 值」);負數紅字、合計列粗體、比率列「8.0%」,與 Excel 相同。預覽頁的標題是「報表 · 期間」,旁邊列出選的分店,右上 [返回條件] [匯出 Excel]。

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

| 檔案                                                            | 內容                                                                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pages/project/lottery/reports/ReportsPage/ReportsPage.tsx`     | 依權限過濾報表、選報表(網址 `report`)                                                                                                                                          |
| `pages/project/lottery/reports/ReportsPage/ReportWorkspace.tsx` | 條件 ↔ 預覽、網址狀態 `conditions` / `preview`                                                                                                                                 |
| `pages/project/lottery/reports/ReportsPage/useReportRun.ts`     | 預覽查詢、匯出(同一個 query key;從預覽按匯出用預覽那份快取、不重查,從條件區按匯出每次重查)                                                                                     |
| `components/project/ReportPeriodPicker/`                        | 期間選擇器(日 / 週 / 月 + 快捷;`monthCaption` 給月份格子加註記)                                                                                                                |
| `components/project/SheetPreview/`                              | 工作表 → 表格的預覽(分段表格逐段一張表、手機每列一張卡片;報表給了 `SheetBody` 就換成它的畫法)                                                                                  |
| `pages/project/lottery/reports/report-registrations.ts`         | 營運報表、班次結帳歷史報表的登記                                                                                                                                               |
| `pages/project/lottery/reports/operations/`                     | 營運報表:工作表(`operations-sheets.ts`、列 `operations-rows*.ts`、合計 `operations-total.ts`)、逐店期間與提醒(`OperationsConditionsAddon`)、月份註記(`OperationsMonthCaption`) |
| `pages/project/lottery/reports/shift-checkouts/`                | 班次結帳歷史報表:工作表(`shift-checkouts-sheets.ts`)、收銀點條件(`CashPointConditionField`)                                                                                    |

錯誤顯示在頁面上方(`Alert`),文案 `admin.lotteryReports.errors.<code>`。

正本:`apps/admin/src/pages/project/lottery/reports/`、`apps/admin/src/components/project/ReportPeriodPicker/`、`apps/admin/src/components/project/SheetPreview/`

## 營運報表

規格 11.2;一家店一份,資料一律從紀錄讀(張數事件、現金流水、銀行交易、兌獎、盤點、結帳單、調貨點收、關帳),不另存彙總。「全部分店合計」由 admin 把各店加總(`operations-total.ts`)。

**原則:每個數字以「期間結束那一刻」的事實為準,重跑舊報表數字不變**(使用者 10/26 定案)。之後的變化算在發生那天;指向已關帳月份的照下方「前期更正」。對齊日結只決定期間邊界,與此原則獨立。

| 區塊          | 算法                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 銷售        | 期間內這家店的張數事件:「售出」沒有原因 = 刷條碼(含快速銷售)、有原因 = 手動標記(依原因分列,名稱照欄位管理「手動標記原因」,停用的顯示代碼)、「售出(盤點補登)」= 補登售出、「撤銷」(當下撤銷 + 撤銷售出申請完成,負數);淨銷售 = 售出 − 撤銷。依遊戲:售出、撤銷、淨張、淨金額(+ 已售成本、毛利、毛利率),合計列                                                                                                                                                                  |
| 2 毛利        | 已售成本 = 售出事件的成本快照合計 − 撤銷事件的成本快照合計(賣出 / 撤銷當下的單張成本);毛利 = 淨銷售 − 已售成本;毛利率 = 毛利 ÷ 淨銷售金額(要 `reports.show-cost`)                                                                                                                                                                                                                                                                                                           |
| 3 兌獎        | 期間內登記的兌獎(依登記時間),狀態看期末那一刻:`status = revoked` 且 `revokedAt` < 迄 = 已撤銷(另列);其他 = 有效,其中期末那一刻已送兌(送兌歷程 `sentHistory` 有一段在迄以前送出、迄那一刻還沒回到店內持有;舊資料沒有歷程時看 `sentAt` < 迄)、其餘 = 店內持有。單位「張」(含非本店售出的中獎券)                                                                                                                                                                               |
| 4 庫存異動    | 由上往下加減,最後一列核對(見下方「庫存的核對」)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4 · 另外列的  | 期末在途(已出貨、期末前還沒點收,列在出貨店;金額 = 那張出貨時「調出」事件記的金額快照)、期末待查(張、成本、本;合計依本去重複)、確認遺失(待查 → 遺失;新增待查時已扣過庫存)、跳號 − 取消跳號(不計成本)、調貨損益 = 調出的調貨金額 − 原成本(跟著出貨時間)                                                                                                                                                                                                                       |
| 5a 差額與更正 | + 錢比帳多、− 錢比帳少:**第一次送出**在期間內(`firstSubmittedAt`)、**期末那一刻有效的那一次送出**(`attempts`:迄以前最後一次送出、迄那一刻還沒被退回的;沒有 = 不算;舊資料沒有快照時看現在的狀態與 `returnedAt`)的交班結帳差額,說明「其中 N 班待審核」(期末時還沒核准);期間內這家店**記的**事後更正(算在記錄當期,依原因類別:兌獎更正、補登售出、退貨退款(已結帳的班)、現金更正;指向已關帳月份的照算,另在區塊 8「前期更正」標出);日結的小金庫差額(同一個規則,差額照那一次送出) |
| 5b 現金移動   | + 錢進來、− 錢出去,依類型一列、分**抽屜 / 小金庫**兩欄(現金流水的「從 → 到」:從抽屜 = 抽屜 −、到小金庫 = 小金庫 +;沖正那一筆兩端對調,自然算反向):投庫、出庫、存銀行、退貨退款(班開著時)、調貨支出 / 收入(現金)、現金更正(增加 + 減少);不含事後更正那幾筆(在 5a)。最後一列合計;不含銷售 / 兌獎的現金(完整應有看即時現金帳)                                                                                                                                                   |
| 6 銀行        | 這家店使用的帳戶(使用組織包含它,或期間內有歸屬這家店的交易):只算歸屬這家店的交易,**同一類型合一列**(收、支分開加,淨額 = 收 − 支;沖正算在同一列,說明「含沖正 N 筆」);期末餘額是整個帳戶的(註明共用)                                                                                                                                                                                                                                                                          |
| 7 未結清      | 期末時的待結清,依歸屬分店(`SettlementLedger.outstandingAt`):待付 / 待退進貨款、待收 / 待付調貨款、調貨待退(收貨店多付)、調貨該退(出貨店多收);每種單數、金額,說明列單號(最多 5 張,超過「等 N 張」)。單據在期末以前第一次送出(`submittedAt`,退回後重送不改寫)、期末時還有效(之後才作廢 —— `voidedAt`、之後才駁回 —— 流程實例的 `finishedAt` —— 的照算);收付只算期末以前的;調貨單的已點收金額只算期末以前的點收;應付照期末當時的修訂                                           |
| 8 註記        | 跳過盤點次數與原因(交班 + 日結);盤點未盤(「N 本未盤,共 N 次盤點」;盤點單依第一次送出的時間 `firstSubmittedAt` 歸期間,未盤本數照期末那一刻有效的那一次送出(`attempts`:迄以前最後一次送出、那一刻還沒被退回 / 駁回的;舊資料沒有快照時看現在的狀態與駁回時間));沒有被日結涵蓋計算的班(期間內送出、期末時有效的交班結帳,**期末以前送出、期末時有效的那一次**日結還沒涵蓋到的;說明列班名,最多 5 個);前期更正;期間涵蓋、尚未關帳的月份                                            |

### 庫存的核對

`期初 + 進貨 + 調入 − 調出 − 淨銷售 − 報廢 − 新增待查 + 待查轉回 + 遺失尋回 = 期末`;核對 = 左邊 − 期末(0 = 對得上,不是 0 表示有資料需要查;成本差小於 0.005 元當 0)。每一列只算「進出這家店庫存(未售、在庫存或檯面)」的那一步(`report-stock.ts` 的 `isOnHandAt`):

| 列                  | 事件                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 期初 / 期末         | 期間起點 / 終點那一刻這家店未售、在庫存或檯面的張(見下方「某一刻的張」)                                                                                                                                                                                                                                                                                                 |
| 進貨                | 「進貨」事件 − 「進貨作廢」事件(作廢時還在這家店庫存的張;作廢那一刻起不算庫存),成本 = 成本快照合計;說明 N 本、含作廢 N 本                                                                                                                                                                                                                                               |
| 調入                | 以這家店為收貨店的調貨點收(依點收時間),成本 = 調貨金額;調貨單被作廢的,在作廢時間那份報表反向算回                                                                                                                                                                                                                                                                        |
| 調出                | 以這家店為**出貨店**的「調出」事件(第一關通過或跳過、庫存 / 檯面 → 在途那一刻);駁回 / 作廢回到出貨店的「調入」、在途中被刪掉的「待查」在發生那天反向。原成本 = 成本快照(作廢回來的用點收紀錄記的調入前成本);調貨金額 = 出貨時記在「調出」事件上的快照(`amount`;反向的那一筆用那張出貨那一筆的金額;之後改單、刪列不影響舊報表)。收貨店作廢時寫的「調出」不算(調入會反向) |
| 淨銷售              | 同區塊 1、成本同區塊 2                                                                                                                                                                                                                                                                                                                                                  |
| 報廢                | 「報廢」事件,成本快照                                                                                                                                                                                                                                                                                                                                                   |
| 新增待查            | 「待查」事件,事件前在這家店的庫存;加上在途中被刪掉變待查的(那幾張的調出同一天反向)                                                                                                                                                                                                                                                                                      |
| 待查轉回 / 遺失尋回 | 「尋回」事件,事件後在這家店的庫存;事件前是待查 / 遺失(別家店替它尋回 → 回到刷到的那家店,算那家店)                                                                                                                                                                                                                                                                       |

- **成本快照**:帳本每筆張數事件記**事件前的單張成本**(`lottery_ticket_events.cost`;進貨 = 點收時的單張成本;報廢照舊記報廢當下的)。舊資料沒有快照 = null,報表改用張現在的單張成本(prod 無資料、dev 重建,不做遷移)。
- **某一刻的張**(期初 = 起點、期末 = 終點):從張的現況往回推,只讀那一刻之後的事件(`at ≥ 那一刻`;索引 `{ "from.orgId": 1, at: 1 }` 與 `{ orgId: 1, at: 1 }`),在資料庫端彙總成「每張那一刻之後第一筆碰到這家店的事件」(一張一列):那一刻的狀態 = 那一筆的「變動前」、成本 = 那一筆的成本快照;沒碰過的張 = 現況(動過的在記憶體裡排除,不送大 `$nin`)。期末之後才調入別家店的張,沒有成本快照時用點收記的調入前成本還原。
- **待標註的跳號**(使用者 10/27 定案甲):拆本前還沒標的跳號實體不存在,不算張數與成本。某一刻的待標註 = 迄號 − 標準張數 − 那一刻已標的跳號(= 現在已標的 − 那一刻之後的跳號淨數;`report-pending.ts`)。整本一起動的一組張(某一刻同一本在這家店的庫存 / 在途 / 待查;進貨、作廢、整本調貨、未拆整本待查 / 遺失 / 尋回,同一本 + 同一張來源單據 + 同一種事件)張數 = 標準張數 + 待標註時,扣掉待標註張數、成本扣同樣張數 × 這組的平均單張成本。拆本標跳號(待標註 → 已標)不影響庫存;未拆的本只能整本調貨,所以不會有一本分在兩家店還有待標註
- **全部讀取批次**(TX-06 延伸到交易外 N+1):事件、張、本、跳號事件、作廢時間、調貨單、點收紀錄各一次查詢,不逐張查(`reports.test.ts` 的指令數上限:1 本與 6 本相同、約 53 次)。期初 / 期末往回推的彙總(排序 + 分組)選的時間點越早資料越多,開 `allowDiskUse`。
- **待決(等 t13)**:未拆的本整本待查之後只處理了一部分,剩下的那組張數不再是「標準張數 + 待標註」,待標註那張會被算回期末待查(核對列不受影響;盤點的確認遺失、待查·遺失分頁同一個判斷)。等 t13 在本上存第一次拆本時間,改成以「本還沒拆過」判斷。
- **已知限制**(規格第 20 章,10/28 實測,`reports.test.ts`「已知限制 a / b / c」):待標註扣在哪家店 / 哪一組會隨別家店的點收、售出或跳號改變,換扣的那一下沒有對應的列 → 兩家店的核對各差 1 張(a、a2、b,待決定修法)。調貨點收的成本零頭(c)不會發生:單張金額一定是 100 的倍數、批購金額率是整數,單張成本一定是整數元。
- **成本與毛利**:沒有 `reports.show-cost` 時 api 回 null(已售成本、各遊戲成本、區塊 4 的所有成本、調入 / 調出 / 在途的調貨金額、調貨損益;調入的調貨金額就是收貨店的成本,使用者 10/26 定案);工作表不放毛利區塊、依遊戲的成本欄、區塊 4 的成本欄與調貨損益列。
- **對齊日結**(只有日):每家店用當天送出的日結的涵蓋計算期間(當天有多張:起點取最早那張的起點、終點取最後一張的終點;第一次日結沒有起點 → 當天 00:00);當天沒有日結的店改用整天,工作表第二列與合計第二列標示「本店 10/16 未日結,期間改用整天,小金庫和盤點未核對」。選「日」時條件卡片一律提醒「不要把多天的日報加總當成週報或月報」(勾不勾都顯示);勾了對齊日結、選了分店再逐店列出實際期間。分店一次最多 5 家平行計算。
- **全部分店合計**:各店相加;銀行同一個帳戶只列一次,各店歸屬的交易依類型加總,期末餘額取**各店期末裡最晚那一刻**那家店算的(對齊日結時各店期末不同);期末待查的本依本去重複(`investigatingBookIds`),張數、成本照加;未結清的單號合併後最多 5 張。
- **已關帳 / 尚未關帳**:月份格子依最後一個已關帳月份標示;選到已關帳的月份說明「數字固定;之後才記的更正列在報表的「前期更正」」;工作表第二列寫已關帳 / 尚未關帳(依那家店期間涵蓋的月份)。
- **前期更正**(規格 10.4「更正」;使用者 10/12 定案):紀錄指向已關帳的月份、而且記在那個月關帳之後 —— 事後更正指向的班(開班時間)、現金更正的歸屬班次、銀行沖正的原交易、撤銷的原售出。這些都照常算在記錄當期(事後更正在區塊 5a、撤銷售出在銷售、沖正在銀行),「前期更正」只是在區塊 8 另外標出筆數與淨額;已關帳月份的報表數字不變。區塊 8 只有筆數與淨額(不逐筆列);逐筆的「前期更正,屬於 X 班」標在即時現金帳的流水上(`docs/modules/project/accounts.md`「即時現金帳」),班次結帳歷史則在原班那一列的「事後更正」列出。
- **關帳快照**:關帳快照的「沒有被日結涵蓋計算的班」是關帳當時的(那個月開的班、關帳那一刻還沒被涵蓋;`period-close.service.ts`),營運報表區塊 8 的同名列是期末那一刻的,兩者時間點不同、數字可能不同;銀行月底餘額與月報的期末餘額同一個時點。

### 工作表(預覽與 Excel 同一份)

使用者 10/26 定案「預覽改成和 Excel 同一份表格」:每張工作表是分段表格(`SheetData.sections`),一個區塊一段。

- 工作表:全部分店合計、每家分店一張;選兩家以上另加「分店比較」(項目 × 分店 + 合計;淨銷售金額、毛利、兌獎獎金、期末庫存張數 / 成本、各班結帳差額、待付(進貨款 + 調貨款)、待收調貨款;合計欄照「全部分店合計」那一份)。
- 前三列:報表名稱 · 分店;期間 · 日報 / 週報 / 月報 · 對齊日結的說明 · 已關帳 / 尚未關帳;產出時間 · 產出人 · 金額單位(預覽 = 查到資料的時間,匯出 = 取回資料的時間;產出人 = 登入者)。
- 區塊順序:1 銷售 → 1 銷售 · 依遊戲 → 2 毛利 → 3 兌獎 → 4 庫存異動 → 4 · 另外列的 → 5a → 5b → 6 銀行 → 7 未結清 → 8 註記;每段有自己的表頭(寫單位:張、金額、成本、筆數、單數…)與一句「怎麼讀」(預覽顯示在段標題下,Excel 不寫);− 的列直接是負數。
- 合計列(淨銷售、依遊戲合計、毛利、兌獎有效、期末庫存、核對、5b 合計、銀行期末餘額)粗體;毛利率是比率列(`0.0%`)。

正本:`apps/api/src/project/lottery/reports/operations-report.service.ts`、`operations-inventory.ts`、`report-stock.ts`、`report-pending.ts`、`post-close-corrections.ts`、`report-periods.ts`;`apps/admin/src/pages/project/lottery/reports/operations/`

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
| 事後更正               | 原班之後才記的更正(兌獎、補登售出、退貨退款、現金更正),**不加進原班的應有 / 差額**(結帳快照不變):同一天同類別合併一筆,例「+1,800(10/13 兌獎更正)」;記在那一班所在月份關帳之後的加註「前期更正」。api 回合計 `postClose` 與逐筆 `postCloseEntries`(類別、金額、記錄時間、`priorPeriod`) |
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

- api:`apps/api/src/project/reports/report-range.test.ts`(期間類型、分店數、起訖長度);`apps/api/src/project/lottery/reports/reports.test.ts`(權限、`RANGE_TOO_LARGE`、第 17 章第 5 題的事後更正 +1,800、對齊日結、8 個區塊各一組固定資料(期初 + 加減 = 期末、核對 0;5a / 5b;銀行同類型一列;未結清單號)、調出看出貨時間 / 期末在途 / 作廢兩邊反向 / 沒有 show-cost 隱藏調貨金額、真的進貨點收與帳本寫的 S1–S5(迄號 101、標準 100 張:進貨、拆本、賣出、撤銷、作廢、整本調貨、未拆整本待查與遺失,每步 100 張 / 18,400、核對 0)、重跑舊報表數字不變(之後撤銷兌獎、送兌、退回結帳、核准、補日結、調走期末的張)、班次結帳歷史的負責人 / 協同 / 條件、關帳後的前期更正);待標註的跳號另見 `transfer.test.ts`(可調張數、單上張數、收貨店單張成本、退回重送)、`stocktake.test.ts`(盤點頁張數、新增待查、確認遺失成本)、`inventory.test.ts` / `tickets.test.ts`(持有與總張數、待查·遺失的張數與成本);退回時間見 `checkout.test.ts`。
- seed:`apps/db-migrator/seeds/project/reports.test.ts`(模組、權限、開通角色配方)。
- admin:`lib/project/reports/report-period.test.ts`(台北與 UTC+0 的日 / 週 / 月起訖、跨月週、跨年週、閏年 2 月)、`report-conditions.test.ts`、`report-registry.test.ts`、`excel.test.ts`(寫出再讀回:工作表數、A4、fitToWidth、printTitlesRow;分段表格的標題列 / 表頭底色、合併、凍結、負數紅字格式、比率格式、合計粗體、換頁);`components/project/ReportPeriodPicker/ReportPeriodPicker.test.tsx`;`pages/project/lottery/reports/ReportsPage/ReportsPage.test.tsx`(以測試報表 `reports-fixtures.ts` 換掉登記清單:選單依權限、空選單說明、[匯出 Excel] 依 `reports.export`、預覽、匯出、`RANGE_TOO_LARGE`);`pages/project/lottery/reports/LotteryReports.test.tsx`(正式登記:對齊日結的提醒與逐店期間、分段表格預覽與分店比較頁籤、沒有 show-cost 沒有毛利、月份已關帳、班次結帳歷史的條件與盤點標示);`operations/operations-sheets.test.ts`、`shift-checkouts/shift-checkouts-sheets.test.ts`(工作表)。

正本:上列測試檔

## 使用者說明(help.md)

[reports.help.md](../../../apps/admin/src/md/module-help/project/additions/reports.help.md)

正本:`apps/admin/src/md/module-help/project/additions/reports.help.md`

## S2 升格待辦

回收前在 scratch-lot 開「升格」分支搬到底座(專案規格 18.2;同步流程 `docs/deployment.md`「底座首次接軌與版本升級」):

| 項目                  | 專案階段的位置                                                           | 升格時                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 模組 / 權限 seed      | `apps/db-migrator/seeds/project/reports.ts`                              | **seed 所有權轉移**:底座新增 seed 接手同一組 key(已發布的 seed 快照只能新增,不能改寫或刪除),專案 seed 以新增版本退場;驗證已部署環境的模組與權限不重複、不遺失                                                                                      |
| 登記介面、期間、Excel | `apps/admin/src/lib/project/reports/`                                    | 搬到 `lib/base/reports/`;報表登記清單改成底座來源 + 專案來源(同 `module-pages` 的合成方式)。Excel 產生器專案階段新增的能力一起回收:分段表格、段標題列 / 表頭底色與框線、合計 / 比率列、凍結說明列、每頁重複說明列、一段盡量不跨頁、`extras` 工作表 |
| 選擇器、預覽元件      | `apps/admin/src/components/project/ReportPeriodPicker/`、`SheetPreview/` | 搬到 `components/base/`                                                                                                                                                                                                                            |
| 頁面                  | `apps/admin/src/pages/project/lottery/reports/`                          | 外框搬到 `pages/base/`;刮刮樂的報表登記留在專案                                                                                                                                                                                                    |
| 範圍檢查              | `apps/api/src/project/reports/report-range.ts`                           | 搬到底座 api;期間類型常數考慮放 `@repo/domain`(admin 與 api 現在各有一份 `REPORT_PERIOD_KINDS`)                                                                                                                                                    |
| 文案                  | `packages/i18n/messages/<語系>/project/admin.json` 的 `lotteryReports`   | 外框的字串搬到底座 `admin.json`(不帶 lottery 的新 namespace);報表名稱留專案;動態 key 前綴跟著改(底座的在 `packages/i18n/src/dead-keys.test.ts`,專案的在 `packages/i18n/src/project/dynamic-keys.ts`)                                               |
| 說明                  | `apps/admin/src/md/module-help/project/additions/reports.help.md`        | 搬到 `base/`                                                                                                                                                                                                                                       |
| 開通角色配方          | `apps/db-migrator/seeds/project/onboarding/role-grants/reports.ts`       | 留專案(開通腳本是專案的)                                                                                                                                                                                                                           |
| 依賴                  | `apps/admin/package.json` 的 `exceljs`                                   | 隨程式進底座                                                                                                                                                                                                                                       |
| Figma                 | 專案報表頁 94:14                                                         | 依底座流程重建外框畫面                                                                                                                                                                                                                             |

升格後確認:`project/` 路徑不再有報表外框,只剩底座那一份;已部署環境的 `reports` 模組與權限資料不重複、不遺失。

## 平台視角備註

- 沒有任何一張報表的權限時,有 `reports` 模組的人看到的是「報表」選單的空狀態說明。
- 側欄順序:專案模組每隔 10 一號(見「模組 key 與畫面」),底座的總覽 0 在最前,申請中心 90、系統管理 95 排在業務模組之後(`docs/modules/module-manager.md`「側欄順序」)。

正本:`apps/db-migrator/seeds/project/reports.ts`
