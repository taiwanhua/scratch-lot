# scratch-lot 專案文件

本專案自己的文件入口。底座文件(`docs/**` 其餘、`CONTEXT.md`)照底座版本,不寫專案內容;專案內容放各目錄的 `project/` 子目錄,單檔的專案版放 `docs/project/<同名>.md`。這些路徑由 `scripts/base-sync/classify.mjs` 判為 project,升級不覆寫、回收不帶走。系統地圖與底座文件目錄見 [docs/README.md](../README.md)。

## 現有文件

| 文件                                             | 內容                                                           |
| ------------------------------------------------ | -------------------------------------------------------------- |
| [branding.md](branding.md)                       | 品牌註冊表各列的本專案值、設計檔                               |
| [figma-nodes.md](figma-nodes.md)                 | 底座模組在本專案 Screens 的節點                                |
| [CONTEXT-PROJECT.md](../../CONTEXT-PROJECT.md)   | 專案詞彙(只新增,不重新定義底座名詞)                            |
| [docs/tmp/project-dis.md](../tmp/project-dis.md) | 專案的進行中討論與待辦(`docs/tmp/` 的規格與工作檔同樣是專案的) |

## 新增專案文件放哪

| 內容                     | 位置                                                         | 備註                                                                               |
| ------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 專案模組的內部技術文件   | `docs/modules/project/<key>.md`                              | 寫法同底座模組文件;底座模組在本專案的補充(節點、刻意的差異)也寫在這裡,不改底座文件 |
| 專案 ADR                 | `docs/adr/project/NNNN-<主題>.md`                            | 獨立編號,從 0001 起                                                                |
| 專案資料表地圖           | `docs/project/data-model.md`                                 | 格式同 `docs/data-model.md`;有第一張專案資料表時建立                               |
| 專案環境變數             | `docs/project/env-registry.md`                               | 格式同 `docs/env-registry.md`;有第一個專案變數時建立,判準照底座那份                |
| 專案 E2E 劇本說明        | `docs/testing/project/scenarios.md`                          | 劇本編號用專案前綴,不接底座的序號(TEST-05)                                         |
| 品牌值、設計稿節點       | [branding.md](branding.md)、[figma-nodes.md](figma-nodes.md) | 完工的 Figma 工作檔節點表也搬進 figma-nodes.md                                     |
| 規格、交接、Figma 工作檔 | `docs/tmp/spec-<主題>.md`、`docs/tmp/figma-<主題>/`          | 只放未完成的工作,完工後內容寫進上面的正本再刪(STRUCT-11)                           |

新增文件後在「現有文件」補一列。程式、文案、seed、skill 的專案位置見[初始化索引](../project-initialization.md#功能與專案內容)。
