# 程式碼規範索引

本資料夾是三層約束中的第二層「可審查的檢查清單」:放 **lint 管不到、但本底座已做出決定** 的規範。
通用最佳實踐不放這裡 — 那是 vercel-labs skills(`react-best-practices`、`web-design-guidelines`、`writing-guidelines`)的職責。

## 怎麼用(給 AI 與人)

- **產碼前**:依下表載入與改動範圍相關的檔案,只載需要的,不要全部吞。
- **review 時**:引用規則編號(例:「違反 REACT-02」),不要只說「不符規範」。
- **回饋循環**:review 中被採納的新決定,回寫到對應檔案成為新規則(沿用編號流水號);規則被推翻時直接改寫該條(不註記日期、票號,歷史查 git;STRUCT-11),不留殭屍規則。

## 索引

方案討論、規格與架構設計先讀 `general/structure.md` 的 STRUCT-13;這項核對在提出方案前執行,不等到寫程式時才做。

| 改動範圍                                                | 必讀                                                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 任何程式碼                                              | `general/naming.md`、`general/structure.md`                                                                                         |
| 前端檔名 / 資料夾分層 / 元件寫法(admin、front、ui)      | `general/naming.md` GEN-01、`general/structure.md` STRUCT-03、`react/components.md` REACT-01 / 02 / 07;決策見 ADR-0012              |
| React 元件(front / admin / ui)                          | `react/components.md`、`react/styling.md`、`general/figma.md`(設計稿對照)                                                           |
| admin 頁面的動作按鈕(列表 / 新增編輯 / 檢視 / 對話框)   | `react/components.md` REACT-16                                                                                                      |
| 選組織(組織選擇器)                                      | `react/components.md` REACT-15、`docs/concepts/frontend-architecture.md`「組織選擇器」用法表                                        |
| admin 主從頁(左清單 / 樹、右詳情)的手機版、設計器平板版 | `react/components.md` REACT-17                                                                                                      |
| 表單 / 對話框的欄位錯誤(標紅、原因、頁面提示)           | `react/components.md` REACT-18;api 的 `reason` 見 `api/graphql-schema.md` GQL-04                                                    |
| 新增 `@repo/ui` 元件 / 子路徑匯出                       | `general/structure.md` STRUCT-08 的四處清單、`general/naming.md` GEN-01、`react/styling.md` STYLE-05 / 07                           |
| 文字顏色(`Typography` 的 `color`)                       | `react/styling.md` STYLE-12                                                                                                         |
| 前端資料存取(query / mutation)                          | `react/data-fetching.md`                                                                                                            |
| api 的 GraphQL schema(resolver / model / input)         | `api/graphql-schema.md`                                                                                                             |
| api 的多步驟寫入 / 對外 adapter(寄信、GCS、HTTP)        | `api/transactions.md`(TX-01~06;交易內多筆讀寫整批做見 TX-06);決策見 ADR-0013                                                        |
| api 的資料層(Mongoose 連線、model、原生 collection)     | `api/data-layer.md`(DATA-01)                                                                                                        |
| 測試                                                    | `testing/testing.md`(api 整合測試 TEST-07、admin 元件測試與 mock 開發模式 TEST-08、ui 元件測試 TEST-09、劇本 E2E TEST-05 / TEST-11) |
| 新增 workspace 套件(`packages/<name>`)                  | `general/structure.md` STRUCT-07 / STRUCT-08                                                                                        |
| 新增 app workspace(`apps/<name>`)                       | `general/structure.md` STRUCT-08 的「新增一個 app workspace」與「build 時烘進產物的變數」兩節                                       |
| CLI 工具 / `apps/db-migrator`(seed、migrate、reset)     | `general/structure.md` STRUCT-06(輸出用 `process.stdout.write`)/ STRUCT-05 的已知誤判 / STRUCT-10;規則本體見 ADR-0002               |
| UI 文案 / 多語(i18n)                                    | `general/i18n.md`                                                                                                                   |
| Figma 設計稿                                            | `general/figma.md`                                                                                                                  |
| 即時通道(`apps/realtime`)                               | `realtime/realtime.md`                                                                                                              |
| Markdown 文件(docs/、help.md、README)                   | `general/structure.md` STRUCT-09(prettier)、STRUCT-11(正式文件寫現況,完成計畫歸回正本)                                              |

## 尚未定案(刻意不寫)

- 錯誤處理總策略、api 的 module 邊界細則 — 等 api 長出第二個 feature 再歸納。

空規範比沒規範糟;沒把握的決定不要先寫進來。
