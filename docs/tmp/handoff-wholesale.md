# 交接:整本批售實作(11/26)

規格正本:`docs/project/spec.md` 第 21 章(= Claude Doc「整本批售規格」rev 18)。照規格做,有問題先回報、不自己改。

## 分支與進度

| 票                      | issue     | 分支                                  | 狀態                                                                                |
| ----------------------- | --------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| W1–W4                   | #267–#270 | `feat/wholesale`(整合分支)            | 已合併;CI 全綠(run 45836716400)                                                     |
| W5 列印                 | #271      | `feat/wholesale-w5`(最新 `e6254befa`) | 主程式與版面快照已 commit;最後一個 WIP commit(檢視頁列印的兩個畫面測試)**還沒跑過** |
| W6 營運報表             | #272      | `feat/wholesale-w6`(最新 `9509a4895`) | 2b 批售、區塊 4 淨批售與期末批售中已 commit;其餘未完成,完成度未核對                 |
| W7 文件、說明、示範資料 | #273      | 還沒開                                | 未開始                                                                              |

各票分支都從 `feat/wholesale` 切出;做完審查(引用規則編號)後合回 `feat/wholesale` 再 push,手動觸發 CI:
`gh workflow run CI -R taiwanhua/scratch-lot --ref feat/wholesale`(feat 分支 push 不會自動跑 CI)。

## 已定案(都已寫進規格或程式)

- 同名客戶提醒:看不到的那位只寫店名、不帶電話。
- 帳戶 / 現金流水清單不加連到單據的連結(規格 21.6)。
- 既有租戶的權限 migration 只補「總部管理」「店長」;租戶管理員副本由根組織逐一開放(ADR-0009)。
- 機器不穩時可提早 push,改由 CI 驗證;本機只做能跑的輕量檢查。

## 接手要做的事

1. **W5**:跑 `WholesaleViewPagePrint.test.tsx`、`WholesaleViewPagePaymentPrint.test.tsx` 與 receipts 測試,修到綠;admin lint、check-types;`docs/modules/project/purchasing.md` 補列印。
2. **W6**(驗收:驗算 #8、#17、#18、#24、#25 寫成測試,核對 0、重跑不變):
   - 還要做:MOVEMENT_ROWS、OUTSTANDING_KINDS(`wholesale|to_receive|payee`、`wholesale|to_refund|payee`)、admin 的 BANK_TYPE_KEYS / MOVEMENT_KEYS / OUTSTANDING_KEYS 與文案、期末已收未出貨、分店比較、`reports.md`。
   - 時點 T 的已收淨額:從 `settlement-ledger.ts` 的 outstandingAtMany / countsAt / outstandingWhere / evaluate 抽共用 private 方法,用 `snapshot.state.sides.shipper` + receivedNetOf;**不要用公開的 `snapshotsOf(…, before)`**(不還原過去的金額與狀態)。
   - 期末批售中:流程實例的 `history` 區間 + 期末當下或之前最後一版修訂。
   - 待標註的本(迄號 101):報表要用共用的待標註扣除(#17)。
3. **W7**:示範資料(一位批售客戶、一張已完成批售單)、`apps/admin/src/md/module-help/project/additions/purchasing.wholesale.help.md`、經銷商管理說明、spec 第 4、9、10、11、12 章加列。
4. **合 dev**:期初建檔(#275)已在 dev,與 `feat/wholesale` 有 12 個衝突檔(BookInfoCards、book-cells、useInventoryAccess、store-sales-handlers、schema.gql、inventory-view.service、docs inventory / store、ticket-events、graphql generated、i18n 兩語系)。**不要把 dev 合進 feat**:從 `origin/dev` 開解衝突分支、把 `feat/wholesale` 合進去、解衝突,PR 到 dev(body 寫 Closes #267–#273、專案歸屬兩行、assignee / reviewer taiwanhua);CI 綠合併後 `gh workflow run Deploy -R taiwanhua/scratch-lot --ref dev -f environment=dev`。
5. **staging**:同樣做法 PR 到 staging;同一輪另開 `claude/project-thread-po6gz9` → staging 的 PR(figma-nodes.md);CI 綠合併後部署 staging。
6. **不合 main、不部署 production**,之後問使用者。E2E 不自己觸發,交件寫「建議跑」:新增送審、收款、核准、作廢整段流程,並改到共用的 BookGroupList。

## 已知注意事項

- gh 一律加 `-R taiwanhua/scratch-lot`(預設 remote 會解析到底座 repo)。
- 型別檢查前先 `pnpm build` packages/domain 與 graphql。
- 舊電腦有隨機 segfault(疑似硬體,WHEA 處理器錯誤);新電腦若正常,上面標「沒跑過」的項目要重跑一次。
- W4 測試的已知缺口:admin 完整套件沒有在本機跑完(已由 CI 把關,全綠)。
