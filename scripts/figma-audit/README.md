# Figma 稽核腳本

在 Figma 檔裡唯讀檢查設計稿是否符合 [Figma 規範](../../docs/standards/general/figma.md) FIGMA-11~17 的自動檢查項目。腳本不改任何節點,只回傳數字與樣本;每項要是 0 才算畫完(例外另列)。

## 檔案與歸屬

| 檔案                 | 檢查                                                                                     | 歸屬                           |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------ |
| `audit-layout.js`    | 裁切、欄位對齊、外溢、蓋字、元件內文字溢出、容器列距、殘留底座主色(專案頁)               | 底座                           |
| `audit-sync.js`      | 三尺寸按鈕一致、共用區塊非元件、畫面寬度與 Section、篩選抽屜、遮罩有背景頁、遮罩蓋滿畫面 | 底座                           |
| `audit-legend.js`    | 沒綁色票、圖例和畫面標示對不上(以實際色值比對)                                           | 底座                           |
| `audit.js`           | 草稿元件與標記、草稿色票綁定、參考畫面以現有為底、畫面內開發文字、畫布重疊               | 底座                           |
| `audit-crossview.js` | 跨畫面資料比對框架(指定參考畫面與比對欄位)                                               | 底座框架;比對規則寫在專案設定  |
| `project/config.js`  | 頁面 id、元件名稱、例外清單、專案名詞、跨畫面比對規則                                    | 專案(`base-sync` 判為 project) |

共用腳本不寫死頁面 id、元件名稱、例外與專案名詞,全部從 `project/config.js` 的 `AUDIT_CONFIG` 讀。每個專案維護自己的 `project/config.js`;底座升級不覆蓋它,欄位有增減時依本 README 與 `figma-audit.test.mjs` 補齊。專案發現可共用的新檢查,改共用腳本後用 `base-sync contribute` 回收(見 [deployment](../../docs/deployment.md#底座首次接軌與版本升級))。

## 在 Figma MCP 執行

1. 先依 `figma-use` skill 的規定載入 skill,再呼叫 `use_figma`。
2. `code` 參數 = **`project/config.js` 全文 + 換行 + 稽核腳本全文**。整份貼上,不要貼精簡版或只貼片段:精簡版少掉的分支會讓數字變少,看起來像通過。
3. 改腳本檔頭參數(只改貼上的副本,不改檔案):
   - `audit-layout.js`、`audit-legend.js`、`audit.js`:`PAGE_ID` = 要查的頁 id。一次只查一頁(`use_figma` 一次只切一次頁);所有頁平行各跑一次,回報時逐頁列原始數字並加總。
   - `audit-layout.js`、`audit-legend.js`、`audit.js` 的 `SECTION_ID`(選填):頁太大、整頁一次跑不完(`use_figma` 逾時斷線)時,填這頁的尺寸 Section id,逐個 Section 分段跑,回報時逐段列原始數字並加總。空白 = 整頁。頁上直接放的畫面(不在 Section 裡)只有整頁跑會查到,分段時另外說明。
   - `audit-sync.js`:預設一次跑完 `sync.pages` 的全部頁,另查 `sync.overlayOnlyPages` 的遮罩。頁多跑不完時填 `ONLY_PAGES`(逗號分隔的頁 id,必須是設定裡的頁)分批跑,所有頁都要輪到,回報時加總。按鈕比對只比同一頁內,分批不影響結果。
   - `audit-crossview.js`:`RULE` = `crossView` 的規則名稱。
4. 沒貼設定、檔頭參數沒填或規則不存在時,腳本直接報錯,不會靜默跑空。
5. 回傳是 JSON:數字欄位是計數,`*Sample` / `*List` 是前幾筆樣本(節點 id、畫面名、原因),拿來定位;回報時附原始數字,做不到的明說。

## 每項數字的意思

### `audit-layout.js`(每頁)

| 欄位                     | 意思                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `screens`                | 這頁的畫面數(頁上或尺寸 Section 內的可見頂層節點,文字除外)                                                                         |
| `clippedText`            | 文字或元件實例被裁切:設了截斷、固定高度放不下一行,或超出任何一層 `clipsContent` 的祖先(容許 1px)。名稱含「可捲動」的框裡超出的不算 |
| `misalignedRows`         | 同一個水平 auto layout 列裡,欄位(`layout.field` 的實例,或以它開頭的包裝框)上緣或高度不一致;名為 `dialogs` 的並排彈窗列不算         |
| `overflowNodes`          | auto layout 的子節點左右超出父框                                                                                                   |
| `overlapText`            | 絕對定位或放在非 auto layout 框裡的實例,蓋到同父層較早節點的文字;名稱含「浮層」的節點本身不算,浮層裡面的照查                       |
| `overflowTextInInstance` | 元件實例(含主元件)內的文字超出最近一層有填色或框線的父框;直屬父框是 auto layout 時也要在內距內                                     |
| `rowGapInContainer`      | `layout.rowGap.container` 容器內上下堆疊的列距不等於 `gap`;設定為 `null` 時回報 `null`                                             |
| `basePrimaryBindings`    | 專案頁殘留底座 `primary/*` 綁定(含實例內部);底座草稿頁回報 `null`                                                                  |

### `audit-sync.js`(全部專案頁)

| 欄位                  | 意思                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `syncDiffs`           | 同一畫面編號在各尺寸 Section 的標題列按鈕文字不一致(`syncList` 寫哪個按鈕缺哪個尺寸,D / T / M = 電腦 / 平板 / 手機) |
| `exempted`            | 符合 `sync.exempt` 的差異與理由,不算錯,回報時照列                                                                   |
| `sharedHandDrawn`     | `sync.sharedBlocks` 列的共用區塊是手畫框、不是元件實例                                                              |
| `sectionMismatch`     | 畫面寬度不等於所在尺寸 Section 的寬度,或後綴(` · 平板` / ` · 手機`)放錯 Section                                     |
| `filterDrawerMissing` | 電腦以外的畫面有篩選按鈕,卻沒有同編號的篩選抽屜畫面,框外註解也沒寫照共用規則                                        |
| `overlayNoPage`       | 有遮罩的畫面沒有放打開它的頁面(`背景:<入口畫面>`、`main` 或側欄)                                                    |
| `overlayNotCovering`  | scrim、全螢幕對話框、背景沒有蓋滿畫面;抽屜沒有從頂到底;底部面板沒有貼齊底部                                         |
| `groupsPerPage`       | 每頁比對到的畫面編號數(核對有沒有漏頁)                                                                              |

### `audit-legend.js`(每頁)

| 欄位             | 意思                                                                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unboundColors`  | 畫面裡可見的 SOLID 填色 / 框線沒綁變數的節點數;白色、透明、`scrim`、實例內部、`背景:` 複本不算                                                                                                                                                  |
| `legendMismatch` | 有 `legend` 框的畫面:圖例樣本的顏色畫面沒用到,或畫面用到的標示色(`legend.mark`;非實例節點與 `legend.markers` 實例內部)在圖例找不到同色樣本。以解析後的實際色值比對,同名變數在不同 Library 不同色                                                |
| `legendExempted` | 頁列在 `legend.exempt`(值是理由,`exemptReason`)時,「圖例樣本畫面沒用到」改算在這裡、不算錯(圖例照程式清單固定列出可能出現的記號);「標示色圖例找不到」照算 `legendMismatch`,除非畫面與變數列在 `legend.exemptMarks`(也改算在這裡,樣本後面附理由) |

### `audit.js`(每頁)

| 欄位                          | 意思                                                                                                       | 何時要是 0 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------- |
| `baseDraftComponents`         | 本地的底座草稿元件(description 含 `draftMarker`)                                                           | 回收完成時 |
| `instancesOfBaseDrafts`       | 指向本地底座草稿的實例                                                                                     | 回收完成時 |
| `nodesWithDraftMarker`        | description 含 `draftMarker` 的元件節點                                                                    | 回收完成時 |
| `nonBaseBindingsInBaseDrafts` | 底座草稿裡綁到 `baseCollections` 以外變數的節點(草稿色票不算)                                              | 任何時候   |
| `draftTokenBindings`          | 綁到本機草稿變數集合(名稱以 `draftCollectionPrefix` 開頭)的節點                                            | 回收完成時 |
| `basePrimaryBindings`         | 專案頁殘留底座 `primary/*` 綁定;底座草稿頁回報 `null`                                                      | 任何時候   |
| `baseScreensNotFromRef`       | 底座草稿頁的參考畫面沒有「對應現有畫面」註解、頁首不是 Library 的 app bar,或左右兩欄沒有填滿畫面高度       | 任何時候   |
| `nonBaseInBaseScreens`        | 底座草稿頁的參考畫面綁到非底座變數                                                                         | 任何時候   |
| `devTextInScreens`            | 畫面框內出現 `audit.devText` 的開發用文字(設計稿編號、規格章節、錯誤碼、權限 key);名稱以「說明」開頭的不算 | 任何時候   |
| `canvasOverlap`               | 頁面頂層節點彼此、尺寸 Section 內的子節點彼此外框重疊;框外註解與隱藏節點不算                               | 任何時候   |

### `audit-crossview.js`(一條規則)

規則寫在 `crossView`:`page`(找比對對象的頁)、`ref`(參考畫面 id)、`target(node)`(哪些節點是比對對象)、`signature(node)`(轉成 `{ 欄位: 值 }`)、選填 `same(key, value, refValue, ctx)`(視為相同的例外,例:互動狀態不算資料差異)。只比兩邊都有的欄位。

| 欄位      | 意思                                                          |
| --------- | ------------------------------------------------------------- |
| `targets` | 頁上找到的比對對象數(含參考)                                  |
| `total`   | 與參考不一致的欄位數,要是 0                                   |
| `res`     | 每個有差異的對象:所在畫面、節點 id、前三筆「欄位: 值 ≠ 參考」 |

## 設定檔欄位

`project/config.js` 只宣告一個 `AUDIT_CONFIG`(貼上時接在腳本前面,不能和腳本變數同名)。欄位:

| 欄位                                        | 用在          | 內容                                                                           |
| ------------------------------------------- | ------------- | ------------------------------------------------------------------------------ |
| `projectTerms`                              | 測試          | 專案名詞;共用腳本與本 README 不得出現                                          |
| `baseDraftPagePrefix`                       | layout、audit | 底座草稿頁的頁名前綴                                                           |
| `draftMarker`、`draftCollectionPrefix`      | audit         | 底座草稿元件 description 的標記、本機草稿變數集合名稱前綴                      |
| `baseCollections`、`basePrimaryCollections` | layout、audit | 底座 Library 的變數集合 key;後者是放 `primary/*` 的集合                        |
| `layout`                                    | layout        | `field`(欄位元件名稱)、`rowGap`(容器、列、間距、最小寬度比;可為 `null`)        |
| `sync`                                      | sync          | 頁面、尺寸 Section、畫面編號、標題列、按鈕判斷、選單合併、例外、共用區塊、篩選 |
| `legend`                                    | legend        | 標示色、標示用元件、圖例項目元件與文字屬性、例外(`exempt` 頁、`exemptMarks`)   |
| `audit`                                     | audit         | 開發用文字樣式、參考畫面名稱與寬度、註解字、app bar 名稱                       |
| `crossView`                                 | crossview     | 跨畫面比對規則(名稱 → 規則)                                                    |

`legend.exempt` 是「頁 id → 理由」;`legend.exemptMarks` 是「畫面名稱開頭|變數名稱 → 理由」(例:圖例刻意不列的標示,文字本身就說明;用 `startsWith` 比對,畫面名稱開頭要寫到不會誤中別的畫面;key 必須含 `|`),兩者都可省略。`sync.sizes` 的代號固定用 `D` / `T` / `M`(電腦 / 平板 / 手機),`D` 是電腦尺寸。`sync.sharedBlocks` 依序比對框名,第一條符合(且頁面符合 `pages`)的規則生效:`why` 表示框本身就是手畫;`children` 表示框的每個非實例子節點都算;`contains` 是 `[元件名稱, 理由]`,框裡找不到該實例才算。

## 離線測試

```bash
node --test scripts/figma-audit/*.test.mjs
```

測試在 fake Figma 上跑每項檢查,另外確認共用腳本與本 README 沒有 `projectTerms` 的字、沒有寫死節點 id 與變數集合 key,以及「設定 + 腳本」能照 `use_figma` 的形狀解析。真正的 Figma 檔不在 CI 執行。
