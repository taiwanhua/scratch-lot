# 輸出報表(技術)

## 用途

「輸出報表」模組:選報表 → 填條件(期間、組織、其他條件)→ [預覽] [匯出 Excel]。本模組是**報表登記的外框**:外框只認得一份報表宣告的形狀(`registerReport`),每張報表自己提供查詢與「查詢結果 → 工作表」;Excel 與預覽共用同一份工作表,畫面看到的就是匯出的內容。

底座目前沒有登記報表;專案在自己的登記清單加報表(見「報表登記介面」)。沒有任何報表時,有模組的人看到的是「報表」選單的空狀態說明。Excel 產生器也給模組自己的單純清單匯出用(沒有期間 / 組織,直接給一個工作表)。

正本:`apps/db-migrator/seeds/base/modules/reports.ts`、`apps/admin/src/lib/base/reports/`、`apps/admin/src/pages/base/reports/`

## 模組 key 與畫面

| key       | 名稱     | sidebarType | 路由       | 自有權限 |
| --------- | -------- | ----------- | ---------- | -------- |
| `reports` | 輸出報表 | link        | `/reports` | 見權限表 |

一頁,沒有隱藏頁;頂層、側欄排序 `order: 50`(總覽 0 在最前,申請中心 90、系統管理 95 在後;`docs/modules/module-manager.md`「側欄順序」)。畫面:左側「報表」選單(一張報表一個單選,名稱後註明組織上限),右側「<報表> · 條件」(期間 → 其他條件 → 組織 → [匯出 Excel](主要)在左、[預覽](外框)在右);按 [預覽] 換成預覽(標題「報表 · 期間」,旁邊列出選的組織,右上 [返回條件] [匯出 Excel])。

正本:`apps/admin/src/app/base/module-pages.ts`、`apps/admin/src/pages/base/reports/ReportsPage/`

## 權限表

| 權限 key             | moduleId 指向 | 它是哪一頁的什麼                                                                  |
| -------------------- | ------------- | --------------------------------------------------------------------------------- |
| `reports.*`          | 輸出報表      | wildcard(同層語意,ADR-0004);seed 自動產生                                         |
| `reports.export`     | 輸出報表      | [匯出 Excel](條件區與預覽都是);沒有就看不到按鈕,[預覽] 照常                       |
| `reports.show-cost`  | 輸出報表      | 報表的成本與毛利欄;外框把它交給報表的 `sheets`(`canShowCost`)決定放不放           |
| `reports.<報表 key>` | 輸出報表      | 報表選單出現那一張;**由登記那張報表的一方在自己的 seed 宣告**(同一個 `moduleKey`) |

- 每張報表一條頁內權限 `reports.<報表 key>`,沒有的報表不出現在選單;一張都沒有時選單是空的並顯示說明。
- 進不進得去整頁看 `me.modules` 有沒有 `reports`;報表的查詢端點由各報表以 `reports.<報表 key>` 守門(api)。
- 專案為底座模組加權限:專案 seed 的宣告 `nodes: []`、`permissions` 的 `moduleKey: "reports"`;`composeModuleSeeds` 合併兩方宣告,權限 key 重複會丟錯。

正本:`apps/db-migrator/seeds/base/modules/reports.ts`

## 資料

沒有自己的資料表;各報表讀自己功能的資料。

## 規則

### 期間

選擇器給的是**租戶時區**的當地日期,admin 用 `@repo/domain/form` 的日曆工具換成起訖時點(迄不含)再送 api;api 只收時點。沒有自訂區間。

| 類型 | 選擇器                                                         | 起               | 迄(不含)           |
| ---- | -------------------------------------------------------------- | ---------------- | ------------------ |
| 日   | 日期 + [今天] [昨天]                                           | 當日 00:00       | 隔日 00:00         |
| 週   | 月曆點任一天選整週,顯示「10/11(日)~ 10/17(六)」+ [本週] [上週] | **星期日** 00:00 | 下一個星期日 00:00 |
| 月   | 年份切換 + 12 個月格子 + [本月] [上月]                         | 1 日 00:00       | 下個月 1 日 00:00  |

- 一週固定從星期日開始(與 `MonthCalendar` 同一規則);週次不顯示。
- 「今天」是租戶時區的今天(頁面開啟時取一次),不用瀏覽器時區。
- 換期間類型時保留日期、整理成新類型的起點(日 10/14 → 週 10/11 → 月 10/1)。
- 報表只開一種期間類型時不顯示頁籤。

### 條件放網址

`report`(報表 key)、`conditions`(期間、組織、其他條件)、`preview`(預覽開著沒、第幾個工作表)都經 `useUrlState`(REACT-14)。網址的條件可能來自別張報表或被手改,畫面先整理成這張報表合法的值:期間類型不在清單 → 第一種;組織去重、超過上限只留前面的;其他條件留這張報表宣告的全部(只在別種期間類型出現的也留著),值不合用預設(勾選 = 不勾、下拉 = 第一個選項),送查詢時才依期間類型過濾。改條件會關掉預覽,上一次匯出失敗的提示也一併清掉(關掉預覽時同樣清掉)。

### 組織上限與範圍檢查

- admin:`OrgTreeSelect` 多選、`scope="visible"`(列整棵租戶樹 `tenantOrgTree`,只有可見範圍內的能選;預覽的組織名稱也取同一份)、`maxCount` = 報表的 `conditions.orgs.max`;沒選組織時 [匯出 Excel] [預覽] 都不能按。
- api:每張報表的查詢在讀資料前呼叫 `assertReportRange`,不合格丟 `GraphQLError`:

| 情況                                                                                     | 結果                                                      |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 期間類型不在 `allowed`(含不認得的字)                                                     | `VALIDATION_FAILED` + `reason: "RANGE_TOO_LARGE"`         |
| 組織數超過 `maxOrgs`                                                                     | `VALIDATION_FAILED` + `reason: "RANGE_TOO_LARGE"`         |
| 起訖長度超過該類型上限(日 25 小時、週 7 天 1 小時、月 31 天 1 小時;多的一小時給夏令時間) | `VALIDATION_FAILED` + `reason: "RANGE_TOO_LARGE"`         |
| 沒選組織                                                                                 | `VALIDATION_FAILED`(沒有 reason),`fields: ["orgIds"]`     |
| 起訖不是時點、或迄不晚於起                                                               | `VALIDATION_FAILED`(沒有 reason),`fields: ["from", "to"]` |

組織是否在操作者的可見範圍內由各報表的查詢自己處理。

### Excel 與預覽

- 報表的 `sheets` 回「全部組織合計」一張 + 每個組織一張(+ `extras` 其他工作表,排在最後);外框排成合計在前、各組織照選擇器順序,工作表名稱用組織名(合計的名稱是文案 `admin.reports.totalSheet`)。工作表建構拿得到產出時間 `generatedAt` 與產出人 `generatedBy`(登入者名稱)。
- Excel:每個工作表 A4、縮放成一頁寬(`fitToWidth: 1`、`fitToHeight: 0`)、每頁重複標題列(`printTitlesRow` = 第 1 列到表頭那一列;有表頭說明 `notes` 時說明列一起重複)。
- **分段表格**(`SheetData.sections`):一個工作表排好幾段小表,每段 = 標題列(深色底、合併到最寬那段的欄數)、表頭(淺色底、框線)、資料列(框線;列上 `_emphasis: "total"` = 合計列粗體、`_format: "percent"` = 比率列 `0.0%`)、補充說明(斜體);段與段之間空一列。表頭說明 `notes` 第一列粗體、凍結並每頁重複;一段放不進這一頁剩下的空間、但放得進一整頁 → 那一段前面換頁(估一頁 48 列,`sectionPageBreaksOf`);欄寬取各段同一欄最寬的。負數紅字由欄位的 `numFmt`(例 `#,##0;[Red]-#,##0`)決定。
- 工作表名稱依 Excel 限制整理:去掉 `\ / ? * : [ ]`、最多 31 字、重名加「 (2)」。
- exceljs 只在匯出時才載入(動態 import,獨立 chunk)。
- 匯出的資料:從預覽按 [匯出 Excel] 直接用預覽那一份(`fetchQuery` 帶 `staleTime: Infinity`,不重打 api);從條件區按(預覽沒開)時每次重查(`staleTime: 0`)。
- 檔名「報表名稱\_期間.xlsx」(文案 `admin.reports.fileName`)。
- 預覽 `SheetPreview`:工作表 → 表格,上方頁籤切工作表,預設顯示第一個(合計);表頭說明排在表格上方。分段表格逐段一張表(段標題 + 一句說明 + 表格 + 補充說明);手機(< sm)每列一張卡片(第一欄當標題、其他有值的欄「表頭 值」);負數紅字、合計列粗體、比率列「8.0%」,與 Excel 相同。報表給了 `SheetBody` 就換成它的畫法。

正本:`apps/admin/src/lib/base/reports/report-period.ts`、`report-conditions.ts`、`excel.ts`、`apps/admin/src/components/base/SheetPreview/`、`apps/api/src/reports/report-range.ts`

## 報表登記介面

一張報表 = 一筆 `registerReport({...})`(`apps/admin/src/lib/base/reports/report-registry.ts`),放進登記清單:

| 來源 | 檔案                                             |
| ---- | ------------------------------------------------ |
| 底座 | `apps/admin/src/app/base/reports.ts`(目前是空的) |
| 專案 | `apps/admin/src/app/project/reports.ts`          |

`app/module-pages.tsx` 以 `composeReports(baseReports, projectReports)` 合成一次(底座在前、專案在後,順序 = 選單順序;同一個 key 登記兩次載入就丟錯),`app/providers/RootProviders.tsx` 經 `ReportRegistrationsProvider` 注入,頁面以 `useReportRegistrations()` 讀(`hooks/base/useReportRegistrations.ts`)。宣告式清單,載入時不寫共享狀態。

```ts
registerReport({
  key: "monthly-summary", // 權限 reports.monthly-summary(登記的一方的 seed 要有同名一筆)
  name: "myReports.reports.monthly-summary", // 訊息 key(admin namespace)
  conditions: {
    period: ["day", "week", "month"],
    orgs: { max: 50 },
    extra: [
      {
        key: "onlyOverdue", // 也是查詢 input 的欄位名
        type: "boolean", // 或 "select"(帶 options)、"custom"(報表自己給欄位元件)
        label: "myReports.extra.onlyOverdue", // 訊息 key
        only: "day",
      },
    ],
  },
  query: useMonthlySummaryReportQuery, // codegen 的 query hook(取它的 getKey / fetcher)
  sheets: buildMonthlySummarySheets, // (data, context) => { total, branches }
});
```

| 欄位                                    | 說明                                                                                                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`                                   | kebab-case;權限 `reports.<key>`                                                                                                                                                                                                                                                  |
| `name`、`extra[].label`、選項的 `label` | **訊息 key**(`admin` namespace,I18N-01),不是文字;以 `t(report.name)` 取用的報表名稱要列進死鍵白名單                                                                                                                                                                              |
| `conditions.period`                     | 可選的期間類型,至少一種、不重複;頁籤順序照它,只有一種時不顯示頁籤                                                                                                                                                                                                                |
| `conditions.orgs.max`                   | 組織上限(正整數);選單上註明上限                                                                                                                                                                                                                                                  |
| `conditions.extra`                      | 其他條件:`boolean`(勾選)、`select`(下拉,至少一個選項)、`custom`(報表自己給欄位元件 `Field`,值是字串、預設 `defaultValue`;選項要查 api 的下拉用它,網址裡的值不檢查選項、交給 api);`only` 限定某種期間類型;key 不可重複,也不可用 `periodKind` / `from` / `to` / `orgIds`           |
| `query`                                 | `{ getKey, fetcher }`,直接給 codegen 的 query hook;變數一律 `{ input }`(GQL-02)                                                                                                                                                                                                  |
| `sheets`                                | 查詢結果 → `{ total, branches: [{ orgId, ... }] }`;每張是 `{ columns, rows, notes? }`;context 有 `t`、`timezone`、`input`、`orgs`、`canShowCost`。`t` 是 `admin` namespace;工作表裡的訊息 key 寫完整路徑(`admin.` 開頭,死鍵掃描才認得),用 `fullPathTranslator(context.t)` 包一層 |
| `ConditionsAddon`(選填)                 | 條件卡片裡、其他條件下方的報表專屬區塊(拿到 `input`、期間類型與起點、其他條件的值)                                                                                                                                                                                               |
| `MonthCaption`(選填)                    | 月份格子下方的註記(拿到 `month`、`input`)                                                                                                                                                                                                                                        |
| `SheetBody`(選填)                       | 預覽換成報表自己的畫法(拿到同一份 `SheetData`;頁籤、表頭說明照外框);Excel 一律是表格                                                                                                                                                                                             |

宣告寫錯在載入時就丟錯(`registerReport("<key>"): …`),不等到使用者點到。

**查詢 input**(admin 組好交給 `fetcher`):`{ periodKind, from, to, orgIds, ...其他條件 }`,其他條件依 key 攤平;只在該期間類型出現的條件,其他類型不送。`periodKind` 是字串 `day` / `week` / `month`,api 端照收字串、交給 `assertReportRange` 驗(不另宣告 GraphQL enum)。

**api 端**:報表的 resolver 用 `@RequirePermission("reports.<key>")` 守門,service 讀資料前 `assertReportRange({ periodKind, from, to, orgIds }, { allowed, maxOrgs })`,`allowed` / `maxOrgs` 與 admin 的 `conditions` 同一組值。

**Excel 的其他用途**:`buildWorkbook({ sheets: [{ name, columns, rows }] })` 回 exceljs 的 `Workbook`;`downloadWorkbook({ sheets, fileName })` 直接下載。

**新增一張報表**:seed 宣告 `reports.<key>` → api 端點(守門 + `assertReportRange`)與 codegen → admin 寫 `sheets`、`registerReport` 並加進自己那一方的登記清單 → 報表名稱的訊息 key 與死鍵白名單。

正本:`apps/admin/src/lib/base/reports/report-registry.ts`、`apps/admin/src/app/module-pages.tsx`、`apps/admin/src/hooks/base/useReportRegistrations.ts`、`apps/api/src/reports/report-range.ts`

## api 介面

外框本身沒有 GraphQL 端點;只提供共用函式 `assertReportRange`(`apps/api/src/reports/report-range.ts`)給各報表的 service 呼叫。

## admin 頁面

| 檔案                                                 | 內容                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pages/base/reports/ReportsPage/ReportsPage.tsx`     | 依權限過濾登記的報表、選報表(網址 `report`)                                                |
| `pages/base/reports/ReportsPage/ReportWorkspace.tsx` | 條件 ↔ 預覽、網址狀態 `conditions` / `preview`                                             |
| `pages/base/reports/ReportsPage/useReportRun.ts`     | 預覽查詢、匯出(同一個 query key;從預覽按匯出用預覽那份快取、不重查,從條件區按匯出每次重查) |
| `components/base/ReportPeriodPicker/`                | 期間選擇器(日 / 週 / 月 + 快捷;`monthCaption` 給月份格子加註記)                            |
| `components/base/SheetPreview/`                      | 工作表 → 表格的預覽                                                                        |
| `components/base/DateFilterPicker/`                  | 篩選用日期欄(打到一半不送出;期間選擇器與各模組的日期篩選共用)                              |

文案在 `admin.reports.*`(期間選擇器 `admin.reports.periodPicker.*`、錯誤 `admin.reports.errors.<code>`)。

正本:`apps/admin/src/pages/base/reports/`、`apps/admin/src/components/base/ReportPeriodPicker/`、`apps/admin/src/components/base/SheetPreview/`

## 錯誤碼

| code / reason                           | 什麼時候                       | 畫面                                                      |
| --------------------------------------- | ------------------------------ | --------------------------------------------------------- |
| `VALIDATION_FAILED` + `RANGE_TOO_LARGE` | 期間類型、組織數或起訖超過上限 | 「期間或組織數超過這張報表的上限,請縮小範圍後再試一次。」 |
| `VALIDATION_FAILED`                     | 條件不完整                     | 「條件不完整,請檢查期間與組織。」                         |
| `FORBIDDEN`                             | 沒有該報表的權限               | 「你沒有這張報表的權限。」                                |
| 其他                                    | —                              | 「報表產生失敗,請稍後再試。」                             |

錯誤顯示在頁面上方(`Alert`)。

正本:`apps/admin/src/pages/base/reports/ReportsPage/reports-error.ts`

## 稽核

外框不寫稽核(唯讀)。

## 測試

- api:`apps/api/src/reports/report-range.test.ts`(期間類型、組織數、起訖長度)。
- seed:`apps/db-migrator/src/seed/seed-key-convention.test.ts`(底座模組與權限)。
- admin:`lib/base/reports/report-period.test.ts`(台北與 UTC+0 的日 / 週 / 月起訖、跨月週、跨年週、閏年 2 月)、`report-conditions.test.ts`、`report-registry.test.ts`(宣告檢查、工作表排序、`composeReports` 重複 key)、`excel.test.ts`(寫出再讀回:工作表數、A4、fitToWidth、printTitlesRow;分段表格的標題列 / 表頭底色、合併、凍結、負數紅字格式、比率格式、合計粗體、換頁);`components/base/ReportPeriodPicker/ReportPeriodPicker.test.tsx`;`pages/base/reports/ReportsPage/ReportsPage.test.tsx`(以測試報表 `reports-fixtures.ts` 換掉底座登記清單:選單依權限、空選單說明、[匯出 Excel] 依 `reports.export`、預覽、匯出、`RANGE_TOO_LARGE`;渲染場景 `apps/admin/src/test/reports-page.ts`)。

正本:上列測試檔

## 使用者說明(help.md)

[reports.help.md](../../apps/admin/src/md/module-help/base/reports.help.md)

正本:`apps/admin/src/md/module-help/base/reports.help.md`
