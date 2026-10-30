# 專案待討論與待辦

只放**本專案自己**的討論與待辦(業務需求、專案外部資源等);底座的討論與待辦放 `docs/tmp/dis.md`,隨底座版本同步。只留**還開著**的,每項附現況;做完就從本檔刪掉(歷史查 git)。格式同 `docs/tmp/dis.md`:條目標題 + 說明 + 「現況:…」;引用時用條目標題的關鍵字,不用編號。

底座不帶本檔內容;新專案初始化時建立空檔(見 `docs/agents/project-bootstrap.md`)。

### 底座待辦在本專案設計稿的對照

`docs/tmp/dis.md` 隨底座 v0.4.0 中性化,拿掉了本專案的票號與設計稿位置。對應如下,處理該條底座待辦時照這裡找本專案的設計稿:

| `docs/tmp/dis.md` 條目                         | 本專案設計稿                                                   | 原票                         |
| ---------------------------------------------- | -------------------------------------------------------------- | ---------------------------- |
| Figma BS-09a / BS-09b 對齊通知設定頁現況       | 通知類型清單 BS-09a `289:86057`、編輯收件人 BS-09b `289:86572` | T40(#55)                     |
| Figma BS-03 對齊流程設計器現況                 | 流程設計器 BS-03 `289:84779`                                   | T46(#61)                     |
| 人員條件選項:root 看得到租戶客製表單的模組權限 | —                                                              | B12、T23(#38)、T06           |
| 人員條件的角色 / 使用者候選:一次 100 筆        | —                                                              | T23(#38)、T30(#45)、T40(#55) |
| 改派 / 新增審核者與使用者停用同時發生          | —                                                              | T21(#36)                     |

現況:Figma 待修清單處理時一併核對;兩張設計稿改完就刪掉對應列。

### Figma 待修清單

設計稿和現況不一致、要改設計稿的地方。以程式與模組文件為準(FIGMA-10)。節點 id 是 scratch-lot Screens(`sXOJkIX53eBMUyDE8yYUJm`)的,標「底座檔」的是 wowgo-base Design System / Screens Starter 的節點,要在 wowgo-base 改、release 後同步回來。改完一項刪一項。

**本專案 Screens 的底座參考畫面(BS)**

| #   | 畫面              | 設計稿 / 節點     | 要改什麼                                                                                                                                       |
| --- | ----------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A6  | 通知鈴            | BS-08 `289:85622` | 鈴目前以絕對定位疊在畫面上(圖層 `notification-bell(待 AppBar 加槽)`);底座檔的 `Draft/AdminAppBar` 加槽後改用屬性並刪掉疊加層(見 B4)            |
| A7  | 欄位管理:選項顏色 | BS-13 `289:87534` | 色票綁的是本機集合 `Draft/tagPalettes`;Library 有 `tagPalettes` 後改綁 Library 同名變數、刪除本機集合(`audit.js` 的 `draftTokenBindings` 要 0) |

**底座檔(在 wowgo-base 改)**

| #   | 畫面 / 元件      | 設計稿 / 節點                                                                                                    | 要改什麼                                                                                                                                                                                |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | 本輪草稿元件回收 | 本專案 `41:5914` 上的 `Draft/*`(清單見 `figma-base-round/nodes.md`)                                              | 依 `docs/tmp/figma-base-round/README.md`「搬回底座的方法」在底座檔重建、發布 Library,再把本專案的實例換成 Library 元件、刪掉本機草稿(`audit.js` 草稿元件數、指向本地草稿的實例數都要 0) |
| B2  | ActionIcon       | 本專案 `Draft/ActionIcon+` `43:66` → 底座 `Draft/ActionIcon` `2001:68`                                           | 17 個變體併進底座的 `Draft/ActionIcon`(含 `print`、`notifications`),刪掉 `ActionIcon+`                                                                                                  |
| B3  | 側欄             | 底座 `Draft/AdminSideNav` `2001:1214`;本專案 `Draft/AdminSideNav+` `272:7145`、`Draft/ScratchLotSideNav` `64:15` | 底座檔已加 spare-5 與頂層 spare-top-3~~8(展開、收合兩個側欄;2026-10-30);剩本專案改回底座側欄實例(Library 發布後)                                                                        |
| B4  | AppBar           | 底座 `Draft/AdminAppBar` `2001:1248`                                                                             | 加 BOOLEAN `Notifications`,右側放 `Draft/NotificationBell`(本專案 A6 跟著改)                                                                                                            |
| B5  | Snackbar         | 本專案 `Draft/Snackbar+` `286:7200` → 底座 `Draft/Snackbar` `2001:992`                                           | 改成右下角卡片樣式(底 `background.paper`、左側 4px 色條、圓角 12、陰影 z8、可有標題與動作),取代舊的 `Draft/Snackbar`                                                                    |
| B6  | 資料範圍參考畫面 | 底座「Screen / Admin 資料範圍」舊規則卡(本專案已換:`59:1847` / `59:2033`)                                        | 兩張舊規則卡換成 `Draft/DataScopeRuleCard`(上半套用對象、下半條件組合),旁邊的「合成規則與資料影響」註記卡依新卡改寫                                                                     |

現況:未開票;BS 畫面(A1–A8)在本專案改,底座檔(B1–B11)等 Figma 回收時在 wowgo-base 一起改。

### 本輪要回收到底座的項目

2026-10-29 這一輪在本專案的底座路徑做完、等 `base-sync contribute` 送進 wowgo-base 的改良(做法照 `docs/deployment.md`「底座首次接軌與版本升級」;回收前跑 verify:第 1 節只剩預期差異、第 5 節 0、第 6 節只剩值行)。清單以 `claude/project-thread-6tw0t5` 合併進 main 的 commit 為準,回收完成後刪掉本節。

- 名稱排序 `@repo/domain/collation`(STRUCT-10)、假 api 錯誤碼型別、`MonthCalendar` `size` / `maxCorners`、文件(`summary` 保留字、`TRUST_PROXY_HOPS`)。
- 殼層最小寬度 `md`(預設)與 Drawer `width`。
- 表單模組列表的組合欄(`TEMPLATE`)、表單列表組織 / 日期篩選、拖拉排序共用設定 `useSortableItem`。
- 欄位選項顏色 `fields.color` + `@repo/domain/tag-palette` + `@repo/ui` 色票(含 migration)。
- 表單事後動作 `decidedBy`;lookup 來源宣告的依操作者預設值(`{ kind: "provider" }`)。
- 升格:報表登記與外框、`useScanner`、閃爍提示、自動列印(`@repo/logger`)、作廢原因類別、`RootOrgNotice`、`useFormEntry`、`DateFilterPicker`。
- 表單引擎類別選項併進 `FieldOptionsService`;「預設不共用 + 清單固定」不再有 `shareOrgs`(附底座 migration `migrations/base/20261029140000_cleanup_form-submissions-share-orgs.js`),共用讀取分支拆兩支走得到索引。

### 暫不做

- org lookup「整個租戶」範圍:底座 `org` 來源只列可見範圍(`forms/lookup-providers.ts`),前端 `OrgTreeSelect` 已有 `scope="tenant"`。本專案目前沒有表單需要(調貨單的收貨分店照規格由總部開單,`docs/modules/project/purchasing.md`「收貨分店選不到時」)。要做的話是表單引擎的設計取捨:引用來源加範圍選項(定義型別、定義檢查、設計器、可攜性、送出重驗都要跟著改),並決定租戶內組織名稱給所有填寫者查。

現況:等有表單真的要選可見範圍外的組織再開票。
