# 表單引擎(現況說明)

回答「欄位由使用者在後台自己設計的模組怎麼運作」:骨架誰建、表單誰管、版本怎麼走、提交怎麼存、值怎麼算、欄位級權限怎麼套、前端怎麼組裝。api 的落地細節(四步發布、寫入規則、投影、lookup 登錄表、錯誤碼、稽核)在 `docs/modules/forms.md`;三個示範表單模組見 `docs/modules/demo-form.md`;資料表見 `docs/data-model.md`;送出後的審核見 `docs/concepts/workflow-engine.md`。與固定欄位模組(示範模組那種,`docs/agents/module-scaffold.md`)兩條路並存。

## 骨架 vs 表單

| 部分                                                   | 誰建 / 誰管            | 在哪                                                                                                                      |
| ------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 模組骨架:路由、三個 `-page` 隱藏頁、四筆權限、資料目標 | 開發者(seed)           | 專案宣告放 `apps/db-migrator/seeds/project/`,加入 `project/registry.ts` 的 `moduleDeclarations`;節點宣告 `engine: "form"` |
| 表單:欄位、版面、版本、摘要槽、帶入規則                | 平台(共用)/ 租戶(客製) | 「表單管理」頁(`system.forms`)                                                                                            |
| 分派 / 啟用                                            | 平台分派、租戶開關     | 業務關聯 `org_form`                                                                                                       |
| 提交(使用者填的資料)                                   | 使用者                 | `form_submissions`(所有表單模組共用,`moduleKey` 區分)                                                                     |

- 沒有模組節點,表單無處可掛、權限無處可綁,所以模組骨架由 seed 宣告。明確登記的共用表單可透過專案 seed 發布;未登記的共用表單與租戶客製表單仍由各環境獨立維護。受管範圍與衝突處理見[受管表單與流程](data-layer-and-isolation.md#受管表單與流程)。
- 租戶分派、啟用與流程綁定由人員維護,不隨定義交付搬到其他環境。
- 一張表單只屬一個模組;要在別的模組用,以它為基底建新表單。

正本:`apps/db-migrator/seeds/base/form-module-declaration.ts`(表單模組骨架的產生函式)、`apps/api/src/forms/`

## 表單的身分與可新增的交集

- **共用表單**(`ownerOrgId = null`):只有站在根組織的人能建、改、分派。
- **客製表單**:租戶以分派來的(或自己的)某一版為基底建的(`forkedFrom`),只有該租戶看得到(平台也看不到);建立時自動在本租戶啟用。
- 表單 key 全域唯一、**建立後不可改**(格式 `^[a-z][a-z0-9_]{0,39}$`,不准 `.` 與 `-`,欄位級權限 key 才能唯一拆回)。客製表單的 key 建議 `<來源 key>_<租戶短碼>`。

某租戶在模組 M **此刻能新增**的表單 = 本租戶 `org_form` 啟用中 ∩ 掛在 M ∩ 有發布版本(`moduleForms`)。一張 → 新增直接進;多張 → 先選。

| 停止新增的方式 | 誰         | 設計端            | 新增                    | 既有提交           |
| -------------- | ---------- | ----------------- | ----------------------- | ------------------ |
| 租戶停用       | 租戶管理員 | 仍列出,標停用     | 不可                    | 有模組 view 照常看 |
| 收回分派       | 平台       | 不再列            | 不可                    | 照常看             |
| 退役目前版本   | 表單擁有者 | 仍列出,無發布版本 | 所有租戶不可,直到再發布 | 照常看             |

沒有「刪除整張表單」:表單與已發布 / 已退役的版本一律保留(提交綁著它們顯示),只有未發布的草稿可刪。

正本:`apps/api/src/forms/form-access.service.ts`

## 版本生命週期

```
草稿 ──發布(changelog 必填)──▶ 發布中 ──▶ 已發布 ──(下一版發布 / 退役目前版本)──▶ 已退役
  ▲                                                                         │
  └──────────── 以任一版本為基底開新草稿(同時最多一份草稿) ◀─────────────┘
```

- 存草稿與發布都帶「讀到的草稿修訂號」,不符 → 「已被別人更新,請重新載入」。
- 發布四步:檢查器 → 搶鎖配版號 → 欄位級權限建 / 復活 / 退役 → 三筆切換;後三步是一個交易,任一步失敗全部回到發布前,沒有「發布中斷」與重試。退役目前版本同樣是一個交易。
- 檢查器(`validateDefinition`)前後端同一份;檢查器的錯草稿照存、發布擋;例外是正則不合法或有 ReDoS 風險的,連存草稿都不收。正則的 ReDoS 檢查在獨立子路徑 `@repo/domain/form-regex-safety`,由呼叫端注入(api 直接用,admin 設計器懶載入,不進首屏 bundle)。

正本:`apps/api/src/forms/form-design/form-publish.service.ts`、`packages/domain/src/form/validate-definition.ts`

## 提交

| 狀態   | 可做什麼                                                          |
| ------ | ----------------------------------------------------------------- |
| 草稿   | 只屬於建立者;可改可刪;只驗型別(守門照常)                          |
| 已完成 | 送出即完成;可再改(模組 edit + 這一筆的 canEdit),每改一次修訂號 +1 |

表單在本租戶綁了審核流程時,送出後進「審核中」、核准才「已完成」並鎖定(只能作廢),狀態共七個,見 `docs/concepts/workflow-engine.md`。

- 新增 = 先建草稿(頁面開啟時產生的 `clientRequestId`,重試回同一筆)再送出;畫面上一顆「送出」就是這兩步。
- 建草稿、存草稿、刪除、不走流程的送出、修改已完成單、複製為新單各是一個交易(連同稽核);複製為新單的附件在交易成功後才複製。
- 每次寫入帶 `expectedEditVersion`(已完成修改另帶 `expectedRevision`),不符 → 請重新載入。
- 每個修訂號留**完整值快照** + `ctx`(時間、時區、操作者、當時組織)+ 這一筆修訂綁的表單版本(`revisions[].version`);差異在讀取時由相鄰兩筆算,各修訂用自己的版本渲染。唯讀檢視以該修訂的 `ctx` 重算顯示 / 唯讀條件,**不重算、不清空存值**,不拿讀者現在的身分補值。
- 容量上限(整筆大小、修訂次數)見 `docs/modules/forms.md`「提交的寫入規則」。

## 值、計算與條件

- **值依型別存**:選項 `{ value, label }`、引用 `{ id, label }`、上傳 `{ path, name, size, contentType }`、數字十進位字串、日期與日期時間存 Mongo `Date`;表達式看到的是語意值(選項的 value、引用的 id、日期的 ISO 字串)。
- **日期與日期時間都是時點**:`date` 是時間固定在租戶時區當地 00:00 的時點,和 `datetime` 只差在顯示精度。輸入以租戶時區的當地日期(時間)換成時點;顯示一律換成**讀者現在的租戶時區**(填寫中與唯讀歷史都一樣;修訂的 `ctx.timezone` 只用於重算條件),`date` 印 `YYYY-MM-DD`、`datetime` 印 `YYYY-MM-DD HH:mm`,前後端共用 `formatTemporal`。日期與日期時間互比、`dateDiff` 的天數、`dateAdd` 的日曆加減、「今天」的邊界都換成租戶時區的當地日期再算。同一個時點在不同時區可能落在不同日期,這是預期行為;租戶改時區時,跨過午夜的既有日期會位移一天。正本:`packages/domain/src/form/temporal.ts`
- **明細列**(`array`)= 一個欄位裝多列同結構的子欄位(採購品項、出差行程),存 `[{ rowId, <子欄 key>: 值 }]`,每列有穩定的 `rowId`;子欄可用列內公式(`row.<子欄 key>`),表單層以彙總(`sumOf` / `countOf` / `minOf` / `maxOf` / `avgOf`)讀它;權限、顯示條件與「不能填的原因」都套在整個明細欄上,有列數與子欄數的硬上限。細節見 `docs/modules/forms.md`「明細列」。
- **被顯示條件隱藏的欄位當 null 算**(明細整欄 null、彙總視為空明細):下游公式讀到被隱藏的計算欄位也是 null;前端即時預覽與後端送出同一套語意(`packages/domain/src/form/visibility.ts` 的 `settleHidden`),預覽算出的值 = 存下的值。被隱藏的欄位每次寫入都清空(含存草稿)。
- **預設值**(只有使用者填的欄位;固定值或公式):建草稿時後端算一次、只填沒碰過的空欄;填寫時沒碰過的欄位依賴變了跟著重算,碰過(`touched[]`)就停。預設值計算不看顯示條件,前後端一致。
- 計算欄位送出時由後端重算、以後端為準;條件也一律以後端算的為準。

## 版面區塊

版面(`layout`)由分區(`LayoutSection { key, title, rows }`)組成,每列以 12 格排欄位。分區另有三個選填的收合設定,在設計器的「分區設定」調整:

| 設定                                       | 說明                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| 可以收合(`collapsible`)                    | 標題列可點,展開 / 收合;沒設 = 不可收合,舊定義照舊畫成有框卡片               |
| 預設收合(`defaultCollapsed`)               | 使用者沒改過時是收合的;只在可以收合時生效                                   |
| 收合時標題列顯示的欄位(`summaryFieldKeys`) | 收合時標題後接「標題:值」;只能挑本分區的非明細欄位,讀者看不到或沒值的不顯示 |

- 收合狀態**不寫進定義**,由 admin 依使用者記在瀏覽器:頁面 id `form:<formKey>`(新增、編輯、檢視共用一組,不分版本)、區塊 key = 分區 `key`;只記與預設不同的;打開表單**目前版本**時清掉已不存在的分區(看綁舊版本的單不清,免得清掉新版本分區的紀錄)。設計器預覽不記。儲存規則與一般頁面共用,見 `apps/admin/src/lib/base/section-collapse.ts`;key 登記於 `docs/branding.md`。
- 送出有錯 → 有錯的分區全部展開、捲到版面順序第一個錯誤;這是暫時的,不寫入記憶。
- 三個設定的形狀與欄位由檢查器驗(`SECTION_COLLAPSE_INVALID`、`SECTION_SUMMARY_FIELD_INVALID`);補預設值的正本是 `packages/domain/src/form/layout.ts` 的 `sectionCollapseOf`。

## 舊版資料升級

已發布的新版可以把「還綁在舊版的資料」改綁過來:版本面板的已發布版本按「將舊版資料升級到此版」。**升級 = 改綁版本 + 補值 + 重算,不驗證**:

- 只限本租戶**沒綁流程**的表單;範圍是操作者看得到的本租戶草稿與沒走過流程的已完成。
- 搬值只留同 key 同型別的欄位,缺的可以補值(只填沒有值的欄位);計算欄位與摘要以那筆資料自己的 `ctx` 重算。
- 已完成的多一筆修訂(`kind: "upgrade"`,記升級者 `upgradedBy` 與時間 `upgradedAt`),歷史修訂仍以各自的版本顯示。不符新版規則的資料,下次編輯送出時才要補。

細節(守門順序、補值欄位、跳過與冪等)見 `docs/modules/forms.md`「舊版資料升級」。

## 欄位級權限與受保護依賴鏈

- 欄位設 `permission.show`(受保護)/ `edit`(限定可改)→ 發布時在該模組下建動態權限 `<模組>.show-<formKey>-<fieldKey>` / `edit-…`(`permissions.source = "dynamic"`,`name` 隨表單名與欄位 label 更新);不再宣告的標 `retiredAt`,由「模組與權限」的退役權限清理刪除(三層檢查)。
- 看不到的欄位 api 回 `"[redacted]"`;畫面以欄位級三態呈現:看不到 → 不渲染,看得到改不了 → 唯讀附說明,都有 → 可填。
- 計算欄位沿依賴鏈繼承保護:讀得到 = 自己的 show(若設)且依賴鏈上每個受保護欄位的 show。明細欄的任一列內公式引用受保護欄位,整個明細欄受保護。
- 不能填的四種原因,後端依序判:顯示條件為假(清空)→ 計算 / 固定值(後端算)→ 沒有欄位級 edit(保留既有值,送不同值整筆 403)→ 唯讀條件(保留既有值)。

正本:`packages/domain/src/form/dependencies.ts`、`apps/api/src/forms/form-values/submission-values.service.ts`、`apps/api/src/forms/field-permission-gate.ts`

## lookup 來源

帶入、引用與 lookup 選項共用一張 lookup 登錄表:底座提供使用者、組織、其他表單提交三種來源,專案可以在固定入口登記自己的來源(key 一律加專案前綴,撞名時 api 起不來)。專案來源只交出宣告與一個專案資料登記裡的 `BaseRepository`,查詢由底座組,所以租戶隔離、可見範圍與資料範圍照常套用,專案放寬不了;設計器的來源清單與發布時的檢查器自動包含專案來源。登記方式、宣告欄位與權限規則見 `docs/modules/forms.md`「lookup 登錄表」。

## 掛接點

專案可以登記表單的守門(送出、修改已完成單、刪除、撤回、作廢、核准 / 駁回 / 退回之前,只能讀、可擋下)與事後動作(送出、關卡通過、完成、駁回、退回、撤回、作廢之後,同一個交易內寫入專案資料),固定入口 `apps/api/src/project/form-lifecycles.ts`。沒綁流程的表單送出依序觸發 `submitted`、`completed`;守門擋下時這個動作沒有任何寫入,事後動作失敗整個動作回復。時機、帶入的資料與系統身分見 `docs/concepts/workflow-engine.md`「掛接點:守門與事後動作」。

正本:`apps/api/src/workflows/workflow-engine/lifecycle/`

## 顯示名:labelTemplate 與頁籤模板

- **lookup 的顯示模板**(`labelTemplate`,來源描述的選填欄位):選資料、引用與 lookup 選項的顯示名由 api 以模板組好(`{{name}}({{email}})`);模板引用的欄位只要有一個讀者讀不到,整串退回顯示欄 `labelField`。佔位符見 `docs/modules/forms.md`「lookup 登錄表」。
- **頁籤 / 標題模板**:表單的 `tabLabelTemplate` 有值用它,否則用模組層模板(預設 `{{title}}`)。前端從那筆資料的值即時算(草稿也算得出來),可用摘要槽、欄位值 `{{value.<key>}}`、建立者、表單名、模組名與頁面種類;沒寫 `{{action}}` 時自動加在最前面(「檢視・病假申請」)。佔位符見 `docs/modules/forms.md`「頁籤 / 標題模板」。

## 前端:引擎零件與預設組裝

表單引擎是一組零件,可用預設頁或自行組裝。底座表單模組在 `app/base/module-pages.ts` 的 `baseModulePages.forms` 宣告;專案表單模組在 `app/project/module-pages.ts` 的 `projectModulePages.forms` 宣告,由固定入口 `app/module-pages.tsx` 一起組裝。每筆 `{ moduleKey, options?, pageOverrides? }` 同時提供四頁與模組設定,不用重複列 key。

例如,專案的 `RequestListPage` 放 `pages/project/`,只客製列表,其餘三頁沿用引擎:

```ts
export const projectModulePages: ModulePageSource = {
  pages: [],
  forms: [
    {
      moduleKey: "requests",
      options: { tabLabelTemplate: "{{form}}・{{title}}" },
      pageOverrides: { list: { Page: RequestListPage } },
    },
  ],
};
```

`ModulePageSource` 型別在 `app/module-page-registry.ts`。`pageOverrides` 的四個 slot 是 `list`、`viewPage`、`createPage`、`editPage`,每個收 `{ Page, minWidth? }`;省略就用預設頁。四頁都自行組裝也可在同一筆 `forms` 宣告四個 slot,仍保留 options 的單一來源。組裝器用純函式 `formModulePages(moduleKey)` 取得四個懶載入預設元件,不靠 spread 覆寫或載入時修改共享狀態。

要客製的是**底座既有表單頁**時,改在 `app/project/page-replacements.ts` 寫明目標,不把相同 moduleKey 再加進專案 `forms`。底座原版與 options 保留,移除替換即可還原頁面。登記或換 Page 都不改 `me.modules` 的路由與授權;碰撞與替換規則見[前端架構](frontend-architecture.md#頁面登記與客製替換)。

options 由 `lib/base/form-engine/form-module-options.ts` 的 `composeFormModuleOptions` 合成唯讀表,再由 `app/providers/RootProviders.tsx` 經 `FormModuleOptionsProvider` 注入。context 與 hook 在 `hooks/base/useFormModuleOptions.ts`,Provider 在 `app/providers/FormModuleOptionsProvider.tsx`;components 向下讀 hook,不 import app。`useTabLabelRenderer` 用這份設定,表單自身模板仍優先於模組模板,未設定時用 `{{title}}`;有 Provider 但未登記該 key 時亦用預設,缺 Provider 則報接線錯誤。不同組裝不會互相污染。

| 零件                                                    | 做什麼                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `FormRenderer`(`version` / `values` / `mode`)           | 依版本畫表單;`mode` = `create` / `edit` / `readonly` / `design` / `preview`     |
| `FormSubmissionList`                                    | 提交列表(`DataTable`),欄來自列表欄位配置;引用那一筆版本沒有的欄位顯示「—」      |
| `FormSubmissionDetail`                                  | 詳情:唯讀渲染、現名 / 快照、附件下載、修訂紀錄與差異                            |
| `FormPicker` / `LookupDialog` / `ReferenceField`        | 選表單 / 帶入資料跳窗 / 引用欄位的搜尋選擇器                                    |
| `useModuleForms` / `useFormDraft` / `useFormSubmission` | 可新增的表單 / 建草稿與送出 / 讀寫既有提交                                      |
| `renderValue(ctx)`                                      | 語意型別 → 畫面(REACT-13 簽章)                                                  |
| widget 登錄表                                           | `widget.kind` → 元件;擴充一個 widget = domain 型別登錄 + admin 元件登錄各加一筆 |

| `mode`            | 條件 / 計算                                  | 權限           | 值     |
| ----------------- | -------------------------------------------- | -------------- | ------ |
| `design`          | 不跑,只標示(顯示條件、計算、受保護…)         | 不套           | 不輸入 |
| `preview`         | 跑(前端即時,另可以後端 `previewFormVersion`) | 不套           | 測試值 |
| `create` / `edit` | 跑                                           | 套             | 真實值 |
| `readonly`        | 只重算顯示 / 唯讀條件(用該修訂的 `ctx`)      | 套(現在的讀者) | 存值   |

正本:`apps/admin/src/components/base/form-engine/`、`apps/admin/src/lib/base/form-engine/`、`apps/admin/src/hooks/base/useModuleForms.ts`、`useFormDraft.ts`、`useFormSubmission.ts`
