# 單號:底座共用的計數器,格式由宣告決定

> 現況說明見 `docs/concepts/form-engine.md`「單號」與 `docs/modules/forms.md`「單號」;資料表見 `docs/data-model.md`「單號計數器」。

## 決策

- **一份底座機制**:單號(例 `PU-202610-0001`)由 `SerialService.next(operator, key, format, { at, orgId, session })` 給(`apps/api/src/serials/`)。表單與非表單資料都呼叫同一支,不在各模組自己數。
- **計數器**:`serial_counters` 每個 `(tenantId, key, period)` 一筆、唯一索引;取號以 `findOneAndUpdate` 的 `$inc` + upsert 原子完成 —— 同時取號不重複、連號。可在交易內取號:交易回復,這次取的號也回復,不跳號。只經 `SerialCountersStore` 讀寫(不是租戶業務資料:沒有組織歸屬與操作者,每個方法明給 `tenantId`)。
- **各租戶分開**:租戶 = 單據歸屬組織的租戶(預設操作者的當前組織,必須在可見範圍內);根組織自己的資料用 `tenantId = null` 那一組。
- **格式由宣告給**:`{ prefix, period, digits, separator? }`(`@repo/domain/form` 的 `SerialFormat`,前後端共用檢查、期間鍵與組字)。`period` = `none` / `year` / `month`,以**租戶時區**切(沿用 `tenantTimezoneOf`);`separator` 缺席 = `-`;流水號超過位數不截斷。
- **表單**:表單設定(`forms.serial`;表單設計頁或受管 seed 宣告)有格式才給號,key = `form:<formKey>`。**第一次送出時給號**,存草稿不給;給了不收回(退回修改、撤回、作廢都保留;複製為新單的草稿沒有號)。號碼存在提交的 `serialNo`,列表欄位配置可選它當欄、詳情頁顯示。
- **非表單資料**:在新增時直接呼叫 `SerialService.next`,`key` 自取(同一個租戶內唯一),存在自己的欄位。

## 理由

- 叫貨單、進貨單、調貨單與表單都要「各租戶分開、每月重新起算」的單號;每個模組各寫一份計數,時區與同時取號的處理一定不一致。
- `$inc` + upsert 是單一文件的原子操作,不必先查再寫,也不必鎖;唯一索引讓兩個請求同時建同一個計數器時只會有一筆。
- 送出才給號:草稿可能被刪掉,給了就會出現缺號;給了不收回,紙本與對外溝通的號碼才不會變。
- 期間用租戶時區:台北的 11/1 00:30 在 UTC 還是 10/31,用伺服器時區切會把它算進上個月。

## 已知限制

- 交易外撞唯一索引(兩個請求同時建第一個計數器)時重試一次;交易內則讓整個交易失敗、由交易入口重跑。
- 已給出的號碼不回收:清掉表單的單號格式後,舊提交保留原號,新送出的不再給號。
