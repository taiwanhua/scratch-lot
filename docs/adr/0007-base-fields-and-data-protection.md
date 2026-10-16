# 底座統一 base 欄位、軟刪除與個資保護

> 現況說明見 `docs/concepts/data-layer-and-isolation.md`「基礎欄位、軟刪除、更新保護」。

## 決策

- **基礎欄位**:底座與新增專案 collection 由共用 plugin 補上 `createdAt` / `updatedAt` / `createdBy` / `updatedBy` / `deletedAt`;schema class 不重複宣告。專案登記邊界見 ADR-0005「專案資料的登記邊界」。
- **安裝識別**:baseFields plugin 完成安裝後才以原 schema 物件記錄 WeakSet 標記,供專案資料登記驗證。自行補同名欄位不能取代 plugin 的查詢中介層,組裝器也不自動 clone schema 或再掛一次 plugin。
- 各表的偏好設定統一叫 `settings`,為受控 JSON:已知 key 在程式裡定義與驗證。
- **軟刪除**:刪除 = 寫 `deletedAt`;之後預設排除,要看已刪除的明講 `includeDeleted`。已刪除的不能再更新。
- **硬刪除只有四種**,其餘一律軟刪除:
  - **關聯的移除**:核心關聯(ADR-0001,`RelationService.unlinkMany`)與業務關聯(`BusinessRelationshipsRepository.deleteMany`:收回表單 / 流程分派、解除流程綁定)。關聯是「有 / 沒有」的事實,表只存現況,歷史在 `audit_logs`。
  - **撤銷開通的抹除**(`BaseRepository.hardDeleteById`):撤銷開通抹掉的租戶組織、角色副本、首任管理員帳號(ADR-0009)。開通租戶失敗由交易整個回復(ADR-0013),不再補償刪除;多步驟寫入的失敗回復一律由交易負責,新功能不再新增這種硬刪除的用途。
  - **從未對外生效的版本草稿**(`BaseRepository.hardDeleteDraft`):`form_versions` / `workflow_versions` 中 `status = draft`、`version` 為 null 的那一份;條件與刪除同一次寫入,刪前的整份內容寫進稽核的 `before`。
  - **退役的表單欄位級權限**(`permissions` 裡 `source = dynamic` 且已退役的那一筆):root 在「退役權限清理」確認後,權限列(經 `hardDeleteById`)與它的全部 `role_permission` 綁定一起抹掉,並寫稽核;還有草稿或審核中的提交用到就擋下。
- 其餘真正抹除(個資清除、清理測試資料)一律走 cleanup migration(ADR-0002),不給 API 硬刪按鈕。
- **更新保護**:更新不得變更 `orgId`、`createdBy`、`createdAt`(含子路徑),觸及即拋錯(ADR-0005)。
- **個資保護**:高敏個資(身分證 `nationalId`)欄位級加密(AES-256-GCM,金鑰走 Secret Manager),預設投影排除,明確要求才解密回傳。

## 理由

- 基礎欄位統一後,稽核、資料範圍的欄位目錄、排序都能假設受本規範管理的資料表有這五欄。安裝標記讓登記驗證能辨識實際安裝過的 plugin,避免只有欄位、缺少軟刪除或更新保護中介層的 schema 混入。
- 軟刪除讓誤刪可救;預設排除讓呼叫端不必每次記得過濾。
- 撤銷開通非硬刪不可:`users` 的 account / email 唯一索引含已軟刪除的文件,留一筆殭屍會讓同一組帳號永遠開不了。
- 版本草稿同理:「一份表單 / 流程至多一份草稿」是部分唯一索引,軟刪除的草稿會佔住它;把狀態改成別的值又會弄髒版本的語意(`retired` = 發布過)。草稿沒發布過,實例、任務、提交都不指向它,硬刪不會留下懸空引用。
- 退役權限同理:權限 key 全域唯一,軟刪除的那一筆會擋住「同一個欄位日後重新發布、建回同一個 key」。
- `nationalId` 目前沒有功能使用,保留作為加密機制的驗證載體。

## 取捨

- 加密金鑰建立後不可輪替或刪除,否則舊密文解不開。
- 軟刪除的資料仍佔唯一索引;需要「刪了可重建」的情境要另外處理(見上面的撤銷開通、版本草稿與退役權限)。

## 影響

- 一般新增專案 collection 掛共用 plugin 並完成資料登記,不必自己處理時間戳、建立者與軟刪除。驗收仍須測真正的寫入與查詢行為,不能只斷言安裝標記為 true。
- 密碼雜湊規範見 ADR-0003。
