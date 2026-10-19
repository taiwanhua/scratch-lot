# admin 的專案頁面

本目錄放本專案(scratch-lot)的後台頁面,由 `app/project/module-pages.ts` 登記(新頁面只追加自己的登記;替換底座頁走 `app/project/page-replacements.ts`)。專案與底座的分工見 `docs/project/README.md`、`docs/project-initialization.md`。

## 目錄約定

| 內容                | 位置                                                                                                   | 備註                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 刮刮樂的頁面        | `pages/project/lottery/<模組>/`(例 `lottery/store/`)                                                   | 模組 = 側欄的一個模組 key 的最後一段                             |
| 排班與出勤的頁面    | `pages/project/schedule/<模組>/`(例 `schedule/manage/`)                                                | **不得 import 任何刮刮樂路徑**(依賴方向:刮刮樂 → 排班)           |
| 專案元件            | `components/project/lottery/`、`components/project/schedule/`                                          | 排班的元件同樣不得 import 刮刮樂                                 |
| 專案 hooks          | `hooks/project/lottery/<名稱>/`、`hooks/project/schedule/<名稱>/`;兩邊共用的放 `hooks/project/<名稱>/` | 一個 hook 一個資料夾,升格到底座時整夾搬;排班的不得 import 刮刮樂 |
| GraphQL documents   | `packages/graphql/src/documents/project/{lottery,schedule}/`                                           | operation 名稱全域唯一                                           |
| mock 模式的專案資料 | `mock/project/lottery/`、`mock/project/schedule/`                                                      | 由 `mock/project/mock-world.ts` 併入;排班的不得 import 刮刮樂    |
| 文案                | `packages/i18n/messages/<語系>/project/admin.json`                                                     | 每個模組一個 namespace(`lotteryStore`、`schedule`…)              |

依賴方向由 `apps/api/src/project/project-lint.test.ts` 掃描排班的頁面、元件、hooks、mock、documents 與 domain 的 `schedule-` 主題守門。
