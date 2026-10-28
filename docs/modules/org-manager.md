# 組織管理(技術)

## 用途

管理組織樹:根組織(平台)在這裡開通 / 撤銷租戶、轉移擁有者;租戶內的人在自己的管理範圍內建子組織、編輯、停用、搬移、刪除組織,設定租戶頂層的可見範圍開關、設定組織的主管(審核流程的主管來源),以及查看 / 加入組織的直接成員。相關 ADR:[0005 多租戶隔離](../adr/0005-multi-tenant-isolation.md)、[0009 租戶開通](../adr/0009-tenant-provisioning.md)、[0010 儲存與寄信](../adr/0010-file-storage-and-email.md)、[0004 權限模型](../adr/0004-permission-model.md)。

正本:`apps/api/src/orgs/`、`apps/admin/src/pages/base/system/OrgManagerPage/`

## 模組 key 與畫面

| key                             | 名稱     | sidebarType                  | 自有權限 |
| ------------------------------- | -------- | ---------------------------- | -------- |
| `system.org-manager`            | 組織管理 | link(樹 + 表格頁)            | 見權限表 |
| `system.org-manager.tenant-ops` | 租戶作業 | hidden、`isRootOnly`、無路由 | 見權限表 |

- 路由:`/system/org-manager`(頁面元件登記在 `apps/admin/src/app/module-pages.tsx`)。
- Figma「Screen / Admin 組織管理」:根組織視角 87:3、租戶視角 92:694;彈窗:開通租戶 88:146(含開放模組勾選區 202:351)、新增子組織 202:404、編輯組織 88:167、停用確認 88:200;撤銷開通的按鈕與確認彈窗、詳情的「成員」頁籤與加入成員彈窗在 87:2(頁籤本身用 `Draft/Tabs`,登記見 `docs/branding.md` 的 Figma 表)。

**為什麼多一個「租戶作業」隱藏模組**:開通租戶、撤銷開通、轉移擁有者是根組織專屬的動作(ADR-0009),但 wildcard 是同層語意(ADR-0004),租戶管理員模板拿到 `system.org-manager.*` 就會連同這一層的全部權限一起拿到。把根組織專屬的動作放進一個 `isRootOnly` 的隱藏模組,模板複製時整個模組被扣除(ADR-0009 開通流程的「複製角色副本」一步),租戶永遠拿不到,也不用在 wildcard 規則上開特例。它沒有路由、不在側欄出現,只是權限的容器;彈窗仍然開在組織管理頁上。要讓某個動作 root-only,就把權限 key 掛在 `tenant-ops` 底下。

正本:`apps/db-migrator/seeds/base/modules/system.ts`、`apps/admin/src/app/module-pages.tsx`

## 權限表

綁定原則:綁「按鈕 / 欄位所在的那一頁」(ADR-0004)。每個模組固定有一筆 `<key>.*`(seed 自動產生,本表不列)。

| 權限 key                                         | 它是哪一頁的什麼                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `system.org-manager.view`                        | 看組織樹與組織資料(名稱、描述、商標、狀態、擁有者);沒有它整頁進不去內容                                                                                      |
| `system.org-manager.create-child`                | 「新增子組織」按鈕 + API:在選中的組織下建一個子組織(名稱 + 描述)                                                                                             |
| `system.org-manager.edit`                        | 「編輯」按鈕 + API:名稱、描述、商標                                                                                                                          |
| `system.org-manager.toggle-enabled`              | 「停用 / 啟用」按鈕 + API:連動整棵子樹                                                                                                                       |
| `system.org-manager.move`                        | 「搬移」動作 + API:改上層組織,限同一租戶(以 `ancestors` 驗證),跨租戶拒                                                                                       |
| `system.org-manager.delete`                      | 「刪除」按鈕 + API:前置檢查通過才可(見規則)                                                                                                                  |
| `system.org-manager.view-members`                | 組織詳情的「成員」頁籤 + API(`orgMembers`):看這個組織**自己**的成員                                                                                          |
| `system.org-manager.add-members`                 | 「加入成員」按鈕 + API(`orgMemberCandidates` / `addOrgMembers`):把管理範圍內的使用者加進這個組織;**移除不在這裡**                                            |
| `system.org-manager.set-visibility`              | 編輯**自己租戶的頂層**時的「使用者可見自身組織的下層組織資料」開關 + API(`settings.visibility`,ADR-0005);租戶管理員模板含此權限,根組織亦可                   |
| `system.org-manager.set-timezone`                | 編輯**自己租戶的頂層**或**根組織**時的「時區」欄 + API(`settings.timezone`);租戶管理員模板含此權限;沒有它時欄位唯讀                                          |
| `system.org-manager.tenant-ops.provision`        | 根組織:「開通租戶」按鈕 + API(ADR-0009 四步 + 擁有者 + 啟用信)                                                                                               |
| `system.org-manager.tenant-ops.revoke-provision` | 根組織:租戶頂層的「撤銷開通」按鈕 + API(反向抹掉開通建出的三樣;與開通分開兩筆權限,風險等級不同)                                                              |
| `system.org-manager.tenant-ops.purge-demo`       | 根組織:清空示範機構的 API(demo 指令 `purge` / `rebuild`;只接受標「示範」的租戶頂層,硬刪它的全部資料,見 `docs/deployment.md`「示範機構清空 / 重建」;沒有畫面) |
| `system.org-manager.tenant-ops.transfer-owner`   | 根組織:編輯租戶頂層時的「擁有者」欄位 + API(ADR-0009:v1 僅根組織可轉移)                                                                                      |

**為什麼 `set-visibility` / `set-timezone` 不在 `tenant-ops`**:可見範圍開關與時區都是**租戶自己的設定**,租戶管理員模板拿到 `system.org-manager.*` 就應該含它;能設哪些租戶頂層由管理範圍決定,不是靠「站在根組織」。

正本:`apps/db-migrator/seeds/base/modules/system.ts`、`apps/api/src/orgs/orgs.resolver.ts`、`apps/admin/src/pages/base/system/OrgManagerPage/org-manager-permissions.ts`

## 資料

- `orgs`:`ancestors` 物化路徑、`settings.visibility` 可見範圍、`settings.timezone` 時區(可見範圍只在租戶頂層有意義,時區在根組織與租戶頂層)、`logoPath` 商標、`ownerUserId` 租戶擁有者與 `slug` 租戶短碼(兩者只存在租戶頂層)。`orgs` 在 schema 上宣告成**治理類**(`tenantScopePlugin({ kind: "governance" })`),租戶過濾自動吃**管理範圍**(`managedOrgIds`);業務 collection 則吃可見範圍。個別 service 不自己選範圍,凡查組織就經 `OrgsRepository`,反查 `org_user` 得到的使用者清單自然也對。
- `core_relationships`:`org_user`(成員)、`org_role`(角色的擁有組織)、`org_manager`(組織的主管,依設定順序)。
- `audit_logs`:見「稽核」。
- seed:`orgs` 種子只有根組織一筆;名稱、描述與 settings 初值在 `apps/db-migrator/seeds/project/settings.ts` 的 `rootOrg` 設定。租戶由開通產生。

正本:`apps/api/src/database/schemas/org.schema.ts`、`apps/api/src/database/schemas/core-relationship.schema.ts`、`apps/db-migrator/seeds/base/orgs.ts`

## 規則

**組織樹的範圍**:根 = 操作者**管理範圍**(CONTEXT.md;持有角色的擁有組織)的各個頂點:根組織成員以根為根、看得到全部租戶;持租戶管理員副本者以租戶頂層為根;持「南港店管理員」者以南港店為根,可能有多個根。管理範圍外的組織**不出現**在樹上(沒有「顯示但不可選」的節點;可見性開關與此無關)。本頁與使用者管理、角色管理的範圍都是**管理範圍**,不是可見範圍。

**開通租戶**(根組織專屬):表單欄位 = 租戶名稱、租戶短碼(`slug`,必填、全站唯一)、首任管理員的帳號(預設帶入 Email、可改)與 Email、商標(選填)、**開放模組勾選**(清單 = 租戶管理員模板綁的模組扣除根組織專屬模組,預設全勾;勾群組連動下層、勾下層連動上層,規則同角色管理的矩陣)。送出後由 API 一次完成 ADR-0009 的四步(建租戶 Org → 複製「租戶管理員」角色副本、只綁勾選的模組 → 建首任管理員帳號並綁 `org_user` / `user_role` → 寄啟用信)並設 `ownerUserId`。首任管理員不設初始密碼,由啟用信自行設定(`docs/modules/user-manager.md` 規則的「密碼流程」);姓名暫用帳號字串(開通表單沒有姓名欄),本人啟用後可在使用者管理改。

- **勾選的模組會自動補上仍在選項內的上層模組**:模組樹就是側欄的樹,只綁下層不綁群組會讓側欄斷成孤兒(ADR-0004「勾下層模組必連動勾上層」)。前端矩陣本來就這樣送,API 這層不依賴前端做對。
- **選項清單的判準是「模板有沒有綁」**,不是重算 `isRootOnly` —— `isRootOnly` 只存在於 seed 宣告層、不落庫(ADR-0004),種子造模板綁定時已扣除根組織專屬模組。
- **副本的權限取自模板的 `role_permission`**(每模組一筆該模組的 `*`)再與勾選的模組取交集,不自己組 key —— 模板日後多綁 / 少綁什麼,副本自動跟著。副本要寫 `settings.templateKey = "tenant-admin"`,擁有者保護靠它認出那一筆。
- **開通是一個交易**(ADR-0013):組織、角色副本、使用者、關聯、`ownerUserId` 與稽核 `org.provision` 一起提交;任一步失敗全部回復,不留任何東西,同一組帳號可直接重新開通。啟用信排在交易成功之後(`afterCommit`),寄不出去只記 log、開通照樣成立,回傳 `activationMailSent: false`,畫面提示首任管理員走「忘記密碼」自助。撤銷開通的硬刪除與稽核同樣是一個交易(前置檢查在交易前)。

**根組織專屬是執行期的第二道門**:租戶作業的 mutation 與 `tenantModuleOptions` 都先過 `@RequirePermission`,再由 service 確認**操作者的當前組織是根組織**,否則 `FORBIDDEN`。權限可能經角色被帶到別的組織,「站在哪裡」才是判準;判斷點是 `OwnerProtectionService.isRootOperator`(與擁有者保護的根組織例外同一個)。

**新增子組織**:輕量入口,名稱 + 描述,掛在目前選中的組織下(限操作者管理範圍內);不觸發開通流程。

**編輯組織**:名稱、描述、商標(任何組織;既有商標要顯示預覽)、上層組織(搬移,見下;根組織與租戶頂層沒有這一欄)、主管(根組織以外的組織);租戶頂層另有「使用者可見自身組織的下層組織資料」開關(持 `set-visibility` 者可設,租戶管理員預設有)、租戶短碼與擁有者轉移(後兩者根組織專屬);根組織與租戶頂層都有時區(持 `set-timezone` 者可設,租戶管理員預設有;沒有權限時唯讀顯示)。`updateOrg` 動不到擁有者、可見範圍開關與時區 —— `UpdateOrgInput` 根本沒有這三個欄位(各自另開 mutation),不是靠執行期判斷;沒有任何欄位真的變動時不寫入、也不留稽核。

**擁有者只存在於租戶頂層**:`transferOrgOwner` 的 `orgId` 不是租戶頂層一律 `VALIDATION_FAILED`;新擁有者必須啟用中、且所屬組織落在該租戶(含下層)內。可見範圍開關同樣只掛租戶頂層,時區掛在根組織與租戶頂層,但守門的是管理範圍而不是「站在根組織」:範圍外的 `orgId` 查不到即 `NOT_FOUND`(根組織只有根組織的人管得到),對象不是它們掛的那一層 `VALIDATION_FAILED`。

**時區**:`setOrgTimezone` 寫根組織或租戶頂層的 `settings.timezone`,值要是 `Intl` 認得的 IANA 名稱(`@repo/domain/form` 的 `isValidTimezone`,不合法 `VALIDATION_FAILED`、`extensions.fields = ["timezone"]`);`timezone: null` 拿掉這個鍵、退回預設時區 `Asia/Taipei`。租戶頂層的時區套用整個租戶;根組織的時區套用根組織與它自己的資料,也是資料範圍規則的日期條件換算「哪一天」的依據。日期時間顯示與日期欄的「當天」都以它換算(讀取端 `tenantTimezoneOf`,`me.currentOrg.timezone` 回的就是它)。`Org.timezone` 回根組織 / 租戶頂層自己設的值,沒設為 null;其他組織恆為 null。

**停用 / 啟用**:連動整棵子樹;停用的組織不再出現在使用者的可切換組織清單,其成員登入後若沒有其他啟用中的所屬組織則無法進入後台(ADR-0005)。啟用只啟用自己這一節,下層各自處理。

**搬移**:在編輯彈窗的「上層組織」下拉改上層;候選 = **管理範圍內、同租戶、且不在自己這棵子樹裡**的全部組織(租戶內的人管理範圍本來就在租戶內;根組織要另外擋跨租戶,ADR-0009);不能搬進自己的子樹是防環。租戶頂層不可搬。搬移後整棵子樹的 `ancestors` 重算。

**刪除**:前置檢查全部通過才可:無子組織、無成員(`org_user`)、不是任何存活角色的擁有組織、無業務資料引用。任一不通過 → 提示改用停用。刪除 = 軟刪除(ADR-0007)。

- 「非角色擁有組織」**只算存活的角色**:角色被軟刪除時 `org_role` 關聯刻意不動(ADR-0007 / ADR-0001),只看關聯會把「角色都刪光了」的組織永遠判成不可刪,所以以 `roles` 文件為準(`ownsAliveRole()`)。
- 「無業務資料引用」數的是 `OrgBusinessDataReader.hasBusinessData()` 組裝的全部帶組織歸屬的業務 collection:以 `orgId` 指向本組織的 `customers`、`demo_items_one`、`demo_items_two`、`fields`(租戶自訂欄位選項)、`form_submissions`、`workflow_instances`;以租戶頂層為歸屬、沒有 `orgId` 的 `forms`(`ownerOrgId`)、`workflows` 與 `workflow_tasks`(`tenantId`)—— 這三張只有租戶頂層會命中,正是撤銷開通問的那一層。任一張有一筆就不可刪 / 不可撤銷開通。`audit_logs` 不算(只增不改的歷史紀錄)。新增專案租戶 collection 時,在 `project/database/registrations.ts` 一併登記 model、repository 與組織歸屬檢查,由固定入口驗證及 reader 執行;漏登記或錯綁 repository 會失敗,查詢錯誤不能當成沒有資料。底座七份 BaseRepository 檢查與兩份 workflow 專用 adapter 保留;專案登記契約見[資料層組裝](../concepts/data-layer-and-isolation.md#底座與專案資料的組裝)。

**子樹類動作不受可見範圍裁切**:停用連動、搬移的 `ancestors` 重算、刪除前置的「有沒有子組織」以整棵子樹為準(可見範圍決定「看得到誰的資料」,不該讓連動只做一半)。程式上是 `orgs.service.ts` 的 `subtreeContext()`,只准搭配把查詢釘在該子樹內的條件。

**前置檢查不受資料範圍規則收窄**:「無業務資料引用」問的是「有沒有」,不是「你看不看得到」。經 BaseRepository 的表一律以 `existsAny` 問(ADR-0005「例外出口」):條件釘在該組織的歸屬欄、略過資料範圍規則(ADR-0008),操作者被規則收窄到看不到某筆,照樣判成有資料、不可刪 / 不可撤銷開通。

**根組織保護**:不可停用、不可搬移、不可刪除(刪除的 reasons 多一項 `SYSTEM_ORG`)。

**租戶頂層保護**:租戶頂層本身的停用 / 刪除 / 搬移只有根組織能做(ADR-0009)。判斷點是 `OwnerProtectionService.assertTenantTopOperableBy(operator, org, action)`(`orgs/owner-protection.service.ts`):不是租戶頂層就放行,是的話只有根組織的操作者能做(`isRootOperator`),否則 `FORBIDDEN`。`setOrgEnabled` / `deleteOrg` / `moveOrg` 各呼叫一次,共用同一個函式;**排在 `CYCLIC_MOVE` / `CROSS_TENANT` 與刪除前置四項之前**,不透露租戶內部狀態。

**開錯的租戶走「撤銷開通」,不走刪除**:租戶頂層一定有成員(擁有者)、一定是租戶管理員副本的擁有組織,所以刪除的前置永遠過不了;而要先把擁有者移出去又卡在擁有者保護(ADR-0009)與「使用者至少要有一個所屬組織」(`docs/modules/user-manager.md` 規則的「所屬組織」)。兩條規則互相咬住的結果是「開錯只能停用、清不掉」,因此另開一個根組織專屬的反向動作。

**撤銷開通**(根組織專屬):把開通建出來的三樣**反向抹掉** —— 租戶頂層組織、擁有者(首任管理員)帳號、租戶管理員角色副本,以及三者身上的全部核心關聯。

- **前置檢查與刪除共用同一支函式**(`OrgsService.orgContentReasons(operator, org, exempt)`)、reasons 也是同一組語彙,差別只在**擁有者與副本角色不算數**(`exempt`:它們就是要被抹掉的東西):無子組織、除擁有者外無其他成員、除副本外不是其他角色的擁有組織、無業務資料引用。任一不通過 → `PROVISION_NOT_REVOKABLE` 附 reasons,提示「已經有自己的資料時請改用停用」。
- **抹除沿用開通回滾那一支**(`TenantOpsService.hardDeleteArtifacts`),`rollback` 只是它外面包一層吞錯的 try/catch(回滾不可蓋掉原始錯誤,撤銷則要把失敗丟出去)。是**硬刪除**,理由同開通的回滾:留殭屍會讓同一組帳號永遠再也開不了 —— 而「同一組帳號可以重新開通」正是撤銷存在的目的。
- **要抹的關聯以「被刪的三樣」為端點反查**,不是照開通時的清單重建 —— 開通之後可能又長出別的關聯(ADR-0001:關聯不隨實體連動),照清單重建會留下指向已刪文件的孤兒。副本角色不只一份時只抹第一份,其餘由前置的 `OWNS_ROLES` 擋下,不會被悄悄留成孤兒。

**成員**:組織的**直接成員**(`org_user` 直接關聯),不含下層組織的成員 —— 「加入成員」加的就是一筆 `org_user`,列表要跟它對得起來。使用者管理的 `users(input:{orgId})` 是**該組織子樹的成員**,兩邊的數字對不起來是對的,不是 bug。

- **加入等同於「對每個人的所屬組織加一筆」**,所以寫入沿用使用者管理的所屬組織那一支(`UsersService.addOrgs`):資格判斷(組織與使用者都必須在管理範圍內)與稽核同源,不另寫一套 —— 被改的是使用者的所屬組織,正本就該在那裡。
- **`setUserOrgs` 的三件事在加入時都不成立,因此不做**:最後一個所屬組織(`LAST_ORG`)、擁有者保護(擋的是「移出」,加入一直是允許的)、失去資格的角色 dry-run —— 只加不減,既有授予只會多拿到子樹支撐,不會失去(ADR-0003)。
- **已是成員的略過(冪等)**:不報錯、不重複稽核;`userIds` 裡有一個查不到(管理範圍外)就整批 `NOT_FOUND`、一個都不寫入。
- **沒有「移除成員」**:移除所屬組織會牽動失去資格的角色與 dry-run 三檔(ADR-0003),入口維持使用者管理的「選擇所屬組織」彈窗一處 —— 同一個行為只留一個入口。

**商標**(ADR-0010):前端向 API 要簽名上傳 URL → 直傳私有 bucket → 把物件路徑存進 `logoPath`;顯示時 API 發簽名讀取 URL。寫 `logoPath` 前必須以 `isOwnedUploadPath(path)`(`apps/api/src/storage/storage.service.ts`)驗歸屬,不讓呼叫端塞任意路徑進 DB。側欄商標:當前組織自己的,沒有就沿 `ancestors` 繼承最近有商標的上層(ADR-0010)。

**Nest 模組依賴方向 `users → orgs` 單向鎖死**:`UsersModule` import `OrgsModule`(擁有者保護、組織樹、管理範圍住 `orgs/`),**`OrgsModule` 不可以反過來 import `UsersModule`**,否則就是循環依賴。任何「組織這邊要用到使用者那邊的寫入」一律開一個**薄模組**掛在 `AppModule` 上,由它同時 import 兩邊(先例 `OrgMembersModule`,`apps/api/src/orgs/org-members.module.ts`)—— 不要為了省一個檔案把邊反過來接。判斷依據是**規則住在哪裡**。

**交易**(ADR-0013、TX-01):每個寫入動作是**一個交易** —— 讀取驗證與寫入(含稽核)都在 `TransactionService.withTransaction` 內,任一步失敗整個動作回復,不留半套組織、關聯或稽核:

| 動作                                                   | 交易內                                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 新增子組織(`createChildOrg`)                           | 建組織 → `org.create-child`                                                                         |
| 編輯(`updateOrg`)                                      | 欄位更新(短碼被搶先佔用 → `VALIDATION_FAILED`)→ `org.edit`                                          |
| 停用 / 啟用(`setOrgEnabled`)                           | 自己 → 停用時連動整棵子樹 → `org.toggle-enabled`                                                    |
| 搬移(`moveOrg`)                                        | 自己的上層與 `ancestors` → 子樹 `ancestors` 重算(一次 `bulkUpdateByIds`,與子樹大小無關)→ `org.move` |
| 刪除(`deleteOrg`)                                      | 前置檢查 → 軟刪除 → 移除主管關聯 → `org.delete`                                                     |
| 可見範圍 / 時區(`setOrgVisibility` / `setOrgTimezone`) | 設定 → `org.set-visibility` / `org.set-timezone`                                                    |
| 主管(`setOrgManagers`)                                 | 解除 → 新增主管關聯 → `org.set-managers`                                                            |
| 加入成員(`addOrgMembers`)                              | 見 `docs/modules/user-manager.md`「交易」的 `addOrgs`                                               |

搬移時子樹有一筆沒寫到(同時被別人改掉)→ `CONFLICT`,整個搬移回復,不留斷掉的路徑。交易外只有:回傳形狀的組裝,以及**換商標後刪舊物件**(`afterCommit`,提交後才刪;交易回復時舊圖不會先被刪掉)。開通與撤銷開通見上方「開通租戶」。

正本:`apps/api/src/orgs/orgs.service.ts`、`apps/api/src/orgs/tenant-ops.service.ts`、`apps/api/src/orgs/owner-protection.service.ts`、`apps/api/src/orgs/org-members.service.ts`、`apps/api/src/users/users.service.ts`、`apps/db-migrator/seeds/base/role-bindings.ts`

## api 介面

**組織本體**(`apps/api/src/orgs/orgs.resolver.ts`):

```graphql
orgTree: [OrgNode!]!              # 管理範圍的森林;根 = 管理範圍的各頂點(可多根),範圍外不回傳
tenantOrgTree: [TenantOrgNode!]! # 整棵租戶樹 + 可見 / 可管理旗標(組織選擇器的 visible / tenant 模式);只要登入,釘在當前組織的租戶
org(id: ID!): Org!                # 範圍外視為不存在(NOT_FOUND);logoUrl 為現簽的短效網址
createChildOrg(input: { parentId, name, description }): OrgPayload!
updateOrg(input: { id, name, description, logoPath, slug }): OrgPayload!
setOrgEnabled(input: { id, enabled }): OrgPayload!
moveOrg(input: { id, newParentId }): OrgPayload!
setOrgVisibility(input: { orgId, visibility: OWN | SUBTREE }): OrgPayload!
setOrgTimezone(input: { orgId, timezone: String }): OrgPayload!   # timezone = null 清除、退回預設時區
deleteOrg(input: { id }): DeletePayload!
```

- **讀取類的兩個端點(`orgTree` / `org(id)`)是多選一守門**:持 `system.org-manager.view` **或** `system.user-manager.view` 任一即可。組織樹不只組織管理頁在用 —— 使用者管理頁的左樹與「選擇所屬組織」彈窗也要它,那些人未必持有組織管理的檢視權;管理範圍照樣決定看得到誰,這一條只決定進不進得了端點。寫法同 `storage.resolver.ts` 的多選一判斷(`@RequirePermission` 只能守單一 key)。寫入類的端點維持單一 `@RequirePermission`。
- **`tenantOrgTree` 給組織選擇器的 `visible` / `tenant` 模式用**(用法表見 `docs/concepts/frontend-architecture.md`「組織選擇器」):列**當前組織所屬租戶的整棵樹**(租戶頂層與全部下層),每個節點只帶 `id`、`name`、`parentId`、`enabled` 與兩個旗標 `isVisible`(在操作者的可見範圍內)、`isManaged`(在管理範圍內),名稱以外不多給;前端依模式決定哪些能選。只要登入、不要求組織管理 / 使用者管理的權限。釘在當前組織的租戶:別的租戶不出現(所屬組織跨租戶時只列當前組織那個租戶)。根組織的成員(可見範圍 `"all"`)= 從根組織開始的整棵樹。例:店長只屬於中山店 → 整個租戶都列出來、只有中山店 `isVisible`;總部屬於最上層組織、開關「包含下層」→ 全部 `isVisible`;開關是預設 → 只有最上層組織 `isVisible`。正本 `OrgsService.tenantTree`,測試 `apps/api/src/orgs/tenant-org-tree.test.ts`。
- **`OrgNode.outOfScope` 恆為 false**:管理範圍外的組織根本不回傳;欄位保留是為了與使用者列的 `roles[].outOfScope` 命名一致、且不必同步改前端。`enabled` 是組織自己的停用狀態,兩者無關。
- **每棵樹的樹根對外一律回 `parentId: null`**(它的上層不在樹上,給了前端也查不到),多根時每個根都是。因此前端**不能**拿 `OrgNode.parentId` 判斷「樹根是不是平台根組織」—— 那件事由 `org(樹根).isSystem` 回答。
- **`OrgNode` 也帶 `ownerUserId`**(僅租戶頂層有值,其餘 null;同 `Org`):使用者管理頁靠它標出受擁有者保護的列,不必為了一個欄位再逐筆查 `org(id)`。
- `Org.visibility`、`Org.ownerUserId` 與 `Org.slug` 只有租戶頂層有值(`orgs/org-mapper.ts`)。
- `updateOrg` 的 `description`:**缺席 = 不動;`null`、空字串、純空白 = 清空**(GQL-06)。落庫分兩種:**根組織寫 `description: null`、欄位留著**(根組織的描述是初始 seed 值欄位,ADR-0002;欄位不存在的話 seed 會補回宣告值),其他組織是拿掉欄位(`$unset`)。兩種對外都回 `null`;已經是空的再清空不寫入、也不留稽核。唯一例外:根組織上欄位根本不存在(過去被拿掉的舊資料)時,明確清空會寫下 `null` 並留一筆稽核,之後再清空就不再寫。
- `updateOrg` 的 `logoPath`:**缺席 = 不動、`null` = 清空商標**(GQL-06);落庫是拿掉欄位(`$unset`),根組織也一樣。
- `updateOrg` 的 `slug`(租戶短碼):**缺席與 `null` 同義 = 不動**(短碼不可清空);只有根組織的操作者能改(其餘 `FORBIDDEN`),不是租戶頂層、格式不符(`^[a-z][a-z0-9_]{1,19}$`,正本 `@repo/domain/form` 的 `ORG_SLUG_PATTERN`)或已被別的租戶用 → `VALIDATION_FAILED`(`extensions.fields = ["slug"]`)。

**主管**(`apps/api/src/orgs/org-managers.service.ts`;`core_relationships` 的 `org_manager`):

```graphql
org(id: ID!).managers: [UserSummary!]!                          # 設定順序;含停用的主管
orgManagerCandidates(orgId: ID!, keyword: String): [UserSummary!]!   # 該組織所屬租戶裡啟用中的使用者(最多 50)
setOrgManagers(input: { orgId, userIds }): OrgPayload!           # 整組取代;稽核 org.set-managers
```

- **守門**:`managers` 跟著讀得到的 `org(id)` 走;`orgManagerCandidates` 與 `setOrgManagers` 沿用 `system.org-manager.edit`(主管是組織資料的一部分,不另開權限)。組織不在管理範圍 → `NOT_FOUND`。
- **`setOrgManagers` 整組取代**:名單就是之後的全部主管,空陣列 = 清空;名單沒變不寫也不留稽核。主管必須是**本租戶**的使用者(所屬組織在該組織的租戶子樹內;停用的可以留在名單上),否則 `VALIDATION_FAILED`(`fields = ["userIds"]`);根組織不屬於任何租戶,不能設主管(`fields = ["orgId"]`)。稽核 `org.set-managers` 的 `before` / `after` 是 `{ managerIds }`。
- **主管解析** `OrgManagersService.resolveManagers(applicantId, submissionOrgId, tenantId, level)`(審核流程用,沒有 GraphQL 端點):起點 = 提交的 `orgId`、往上到提交的 `tenantId` 為止;第一個「剔除申請人後仍有主管」的組織 = 第 1 層,`level = 2` 再往上一組;只算啟用中、仍在本租戶的使用者;找不到 → 空陣列。純規則在 `@repo/domain/workflow` 的 `resolveManagersFrom`。

**成員頁籤**(`apps/api/src/orgs/org-members.*.ts`,Nest 模組 `OrgMembersModule`):

```graphql
orgMembers(orgId: ID!, input: { page, pageSize, keyword }): OrgMembersPayload!          # 這個組織自己的成員
orgMemberCandidates(orgId: ID!, input: { page, pageSize, keyword }): OrgMembersPayload! # 尚未加入的可見使用者
addOrgMembers(input: { orgId, userIds }): AddOrgMembersPayload!                         # { addedUserIds, skippedUserIds }
```

- **`OrgMember.otherOrgs`** = 這位成員**在本組織以外**的所屬組織,只列操作者**管理範圍**內的(範圍外不露名稱也不露 id,同 `RoleUser.orgs`)。候選清單沿用同一個型別,候選本來就不在本組織裡,所以那裡等於他全部的所屬組織 —— 語意仍是「本組織以外的」。
- **兩個 query 共用 `OrgMembersInput` 與 `OrgMembersPayload`**:兩邊的列完全同形,差別只在「已在這個組織」還是「還沒在」。`orgId` 是**獨立參數不進 input**(GQL-03:清單掛在某個實體底下時,那個實體的 id 是獨立參數;先例 `roleUsers`)。
- **候選守在 `add-members` 底下,不借 `users`**:借了會讓「加入成員」彈窗連帶需要 `system.user-manager.view`,能管組織的人卻打不開它,而且排不掉已經是成員的人。
- `addOrgMembers` 只負責把「組織在不在管理範圍內」翻成 `NOT_FOUND`,實際寫入在 `UsersService.addOrgs`。`addedUserIds` 是這次真的加進去的,已是成員的回在 `skippedUserIds`。
- **`AddOrgMembersPayload` 不回清單**:分頁與關鍵字都在前端手上,加完本來就要把 `orgMembers` / `orgMemberCandidates` 失效重查,把一頁塞進 mutation 的回傳只會有兩份可能不一致的真相(`grantRoleUsers` 回整份清單是較早的寫法,不是標準)。

**租戶作業**(`apps/api/src/orgs/tenant-ops.*.ts`):

```graphql
tenantModuleOptions: [ModuleOption!]!                  # 開通彈窗的模組勾選清單
provisionTenant(input: { name, slug, adminAccount, adminEmail, logoPath, moduleKeys }): ProvisionTenantPayload!
revokeTenantProvision(input: { orgId }): RevokeTenantProvisionPayload!   # 撤銷開通
purgeDemoTenant(input: { slug }): PurgeDemoTenantPayload!               # 清空示範機構(demo 指令)
transferOrgOwner(input: { orgId, newOwnerUserId }): OrgPayload!
```

- 選項外的 `moduleKeys`(含根組織專屬模組)或一個都沒勾 → `VALIDATION_FAILED`(`extensions.fields` 指出欄位)。
- `slug`(租戶短碼,必填):格式不符或已被用 → `VALIDATION_FAILED`(`extensions.fields = ["slug"]`);落庫到租戶頂層的 `orgs.slug`,客製表單 key 的預設後綴。
- **`revokeTenantProvision` 回 `RevokeTenantProvisionPayload`**(`{ success, revokedOrgId, revokedOwnerUserId, revokedRoleId }`),不沿用 `DeletePayload` —— 後者是 orgs 較早留下的通用名,屬先例不是標準(GQL-02)。
- **`purgeDemoTenant`**(`apps/api/src/orgs/demo-tenant-purge.service.ts`):以短碼找根組織底下的租戶頂層;找不到回 `purged: false`,沒有「示範」標記 → `FORBIDDEN`、一筆都不刪;有 → 照刪除登記硬刪整個機構,回 `{ purged, orgId, deletedDocuments, deletedUsers, detachedUsers, deletedFiles, collections }`。範圍與登記見 `docs/deployment.md`「示範機構清空 / 重建」。
- **`OwnerProtectionService` 住在 `orgs/`**:判斷的主體是組織(`orgs.ownerUserId`、根組織例外),由 `OrgsModule` 匯出給 `UsersModule` 用,兩個模組不各寫一套。

**商標上傳**(`apps/api/src/storage/`):`createUploadUrl(input: { purpose: ORG_LOGO, contentType, size })` 回 `{ uploadUrl, objectPath, expiresAt }` —— 檔型限 png / jpg / webp、大小 ≤ 2MB(不合回 `UPLOAD_REJECTED`),上傳網址效期 10 分鐘,`objectPath` 為 `org-logos/<uuid>.<副檔名>`(簽票時組織可能還不存在,所以不含 orgId);持 `system.org-manager.edit` 或 `system.org-manager.tenant-ops.provision` 任一即可要票。讀取端:`me.currentOrg.logoUrl` 現簽短效網址(TTL `GCS_SIGNED_URL_TTL`,預設 1h),無商標或路徑不合為 null。

正本:`apps/api/src/orgs/orgs.resolver.ts`、`apps/api/src/orgs/org-members.resolver.ts`、`apps/api/src/orgs/tenant-ops.resolver.ts`、`apps/api/src/orgs/models/`、`apps/api/src/storage/upload-rules.ts`、`packages/graphql/src/documents/base/orgs.graphql`

## admin 頁面

左樹 + 右資料區,所有動作都是這一頁上的彈窗。

- **兩種視角不做兩套頁,全由資料決定**:`org(樹根).isSystem` 為真 = 操作者站在根組織(根組織視角),否則樹根就是租戶頂層(租戶視角)。加上手上有沒有 `tenant-ops` 那三筆權限,已足以決定畫面,不需要「我是不是超級管理員」這種旗標。Figma 87:3 / 92:694 只是同一支頁面的兩組資料。取 `org(樹根)` 時樹根沒被點掉就與選中的那一筆同一把 query key,不多發一次請求。
- **「是不是租戶頂層」讀 `org.visibility !== null`**:api 只讓租戶頂層有 `visibility` 與 `ownerUserId`,前端不必自己數 `ancestors` 或比對樹的層數。
- **「租戶」標籤只標父節點是平台根組織的節點**,不是「父節點是樹根」—— 租戶視角的樹根是租戶頂層,它的子組織不是租戶。實作上先以 `org(樹根).isSystem` 判斷「樹根就是平台根組織」,是的話它的直接子組織才掛標籤。停用的組織掛「停用」標籤。標籤走 `@repo/ui/tree` 的 `TreeNode.labelSuffix`(Figma Draft/OrgTreeItem 的 ShowTag 槽位),`label` 仍是純文字,搜尋與無障礙名稱不受影響;共用的 `OrgTreePicker` 以 `labelSuffixOf` 接出來。
- **樹的葉節點在 admin 歸一化成 `children: undefined`**(`lib/base/org-tree.ts` 的 `toTreeNodes`):api 對葉節點回 `children: []`,而 `TreeNode.children` 的語意是「有沒有下一層」—— 不把「能不能展開」交給樹元件自己解讀。
- **搬移是編輯彈窗裡的「上層組織」下拉,不是動作列上的按鈕**(Figma 88:182、help.md 沿用此說法);下拉文案用白話:「可以搬到你管理範圍內的任何組織底下,除了它自己和它底下的組織」。候選在前端先照三條規則濾過,api 仍會再驗一次。樹上有的就是管理範圍,所以「管理範圍內」= 在樹上走得到;「同租戶」的上限是**含自己的那一棵樹根**(管理範圍多根時 `orgTrail` 會找出是哪一棵),根組織視角要再往下一層取租戶頂層(`useMoveTargets.ts`)。租戶頂層自己的候選是空的 = 搬不動,與 api 的租戶頂層保護一致。
- **根組織與租戶頂層的編輯彈窗不顯示「上層組織」下拉**:兩者都搬不動,而它原本的上層不在候選裡,渲染出來只是空白的下拉。租戶內的人編輯租戶頂層時,在那個位置改放租戶頂層提示(與停用 / 刪除按鈕同一句,樣式同欄位說明);根組織視角編輯租戶頂層時不放提示(那句話是對租戶內的人說的)。儲存時不送 `moveOrg`。
- **編輯彈窗最多打六個 mutation**,依序 `updateOrg` → `moveOrg` → `transferOrgOwner` → `setOrgVisibility` → `setOrgTimezone` → `setOrgManagers`,**只送有變動的那幾個**(租戶短碼跟著 `updateOrg` 送)。任何一步失敗就停在那裡,前面已成功的不回滾 —— 它們各自是完整的動作、各自留了稽核;重新送出只會補上還沒做的那幾步。
- **`updateOrg` 沒碰商標欄就不送 `logoPath`**(`null` 在 api 是清空):前端以「使用者有沒有碰過商標欄」決定要不要送。既有商標的預覽走 `@repo/ui/upload-field` 的 `initialPreviewUrl`(選新檔即取代、按移除回空狀態)。開通與編輯兩個彈窗共用同一個上傳欄(Figma `Draft/UploadField`)。
- **擁有者欄位要靠 `users`**:`orgs` 只存 `ownerUserId`,顯示姓名與列出可轉移的候選人都得查使用者,而 `users` 掛在 `system.user-manager.view` 底下。沒有那個權限時,資料區的擁有者欄位仍然出現(那是組織的事實),只是顯示不出是誰;轉移欄位則不給。
- **租戶頂層與根組織的保護是「按鈕出現但停用」**:停用 / 刪除按鈕 `disabled` 加提示(根組織用 `isSystem` 的提示、租戶頂層用租戶頂層提示)。「我做不到這個動作」(無權限,不給按鈕)與「這個組織不准被這樣動」(給按鈕、停用並說明)是兩回事。
- **刪除不在前端預判**:前置四項全在 api,送出後收到 `ORG_NOT_DELETABLE` 才把 `extensions.reasons` 攤成清單並提示改用停用(撤銷開通同理,收到的是 `PROVISION_NOT_REVOKABLE`)。
- **「撤銷開通」的出現條件是三者同時成立**:持有 `tenant-ops.revoke-provision`、**根組織視角**、且選中的是**租戶頂層**。它與停用 / 刪除不同,**不做「出現但停用」**—— 對非租戶頂層的組織它根本不是一個可想像的動作。確認彈窗比刪除嚴格:列出會被抹掉的三樣(租戶名、擁有者帳號、副本角色名),並要**照打租戶名稱**才按得下去(刪除是軟刪除、撤銷是硬刪除,嚴格度跟著不可逆性走)。擁有者帳號與副本角色名取自 `users` 那一支查詢(`useTenantOwner`:擁有者持有的角色中,擁有組織就是這個租戶頂層的那一筆),沒有 `system.user-manager.view` 時兩處顯示「(顯示不出來)」,彈窗照樣可用。
- **資料區的頁籤**(`PageTabs`):「組織資料」與「成員」。「成員」分頁設了 `view-members` 權限,**沒有那筆權限時只剩一個分頁、整列不顯示**,直接看到組織資料 —— 頁籤不是一個動作,給了空頁籤只會讓人困惑。目前分頁記在網址 `?tab=`,選中的組織在 `?detail=<id>`,成員清單的頁碼在 `?members=`(連同組織 id 一起存,換組織就回第一頁);成員頁籤以 `key={org.id}` 換組織時整個重來,已選的人不跟著跑到別的組織。動作列(編輯 / 停用 / 刪除 / 撤銷開通)維持在頁籤**之上**,它們是對整個組織的動作。**這是頁內頁籤,不是路由頁籤**:「成員」沒有自己的網址,不進殼的路由頁籤列(判準見 ADR-0011「頁籤兩種」)。
- **成員列欄位**:姓名、帳號、狀態、其他所屬組織。「加入成員」彈窗是多選 `Autocomplete`,候選用 `orgMemberCandidates` 而不是 `users`;**關鍵字丟回 api 查**(候選有分頁上限,前端手上不會是全量),所以走 `onInputChange`,給了它就不再讓 Autocomplete 自己過濾一次,否則打第一個字就把「還沒換過來的那批 options」濾成空的。加完之後 `orgMembers` 與 `orgMemberCandidates` 兩把都要失效。成員頁籤沒有「移除」(見規則)。
- **時區欄**(`EditOrgDialog/TimezoneField.tsx`):單選 `Autocomplete`,選項是瀏覽器 `Intl.supportedValuesOf("timeZone")` 的完整 IANA 清單(不自己列表、不裝套件),顯示時區名、輸入即過濾;已存的值不在清單裡(別名)時放在最前面。沒設時說明文字寫「未設定(使用預設 Asia/Taipei)」。根組織與租戶頂層的編輯彈窗一律顯示這一欄(可見範圍開關仍只在租戶頂層),沒有 `set-timezone` 時停用(唯讀顯示目前值)。儲存後照「成功後失效三把」重取 —— 改的是自己當前組織所屬的租戶(或根組織)時,`me.currentOrg.timezone` 換掉,畫面上的日期時間跟著換算。
- **主管**:資料區有「主管」一列(`OrgManagersRow`,根組織不顯示);編輯彈窗的主管欄(`ManagerField`)是多選 `Autocomplete`,候選走 `orgManagerCandidates`、關鍵字丟回 api 查(同「加入成員」的做法);已選但不在這一批候選裡的人(停用的主管、換過關鍵字)仍留在值裡。
- **成功後失效三把**:`orgTree`、被改到的那一筆 `org(id)`、以及 `me` —— 側欄的租戶識別讀 `me.currentOrg.logoUrl`(有商標顯示商標圖、沒有才顯示組織名),改完商標不重取 `me` 就不會更新。
- **彈窗裡的第一個 `TextField`**:MUI 有一條 `.MuiDialogTitle-root + .MuiDialogContent-root { padding-top: 0 }`,特異度贏過 `sx` 的單一 class,浮動標籤會被標題壓住;`@repo/ui/dialog` 以 `&&` 拉高特異度處理掉。
- **與設計稿的差異**:Figma 的資料區有「建立時間」一列,`org(id)` 沒有這個欄位,故未做;可見範圍在 Figma 是核取方塊,依本檔與 ADR-0005 的說法改用開關(`Switch`)。

正本:`apps/admin/src/pages/base/system/OrgManagerPage/`(`useOrgManagerData.ts`、`useMoveTargets.ts`、`useTenantOwner.ts`、`OrgDetailPanel/`、`MembersTab/`、`EditOrgDialog/`、`ProvisionTenantDialog/`、`RevokeProvisionDialog.tsx`)、`apps/admin/src/lib/base/org-tree.ts`、`apps/admin/src/components/base/OrgTreePicker/OrgTreePicker.tsx`

## 錯誤碼

| code                      | 何時                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORG_NOT_DELETABLE`       | 刪除前置未過;`extensions.reasons`:`HAS_CHILDREN` / `HAS_MEMBERS` / `OWNS_ROLES` / `HAS_BUSINESS_DATA` / `SYSTEM_ORG`                               |
| `PROVISION_NOT_REVOKABLE` | 撤銷開通前置未過;`extensions.reasons` 同上那組語彙                                                                                                 |
| `CROSS_TENANT`            | 搬移跨租戶                                                                                                                                         |
| `CYCLIC_MOVE`             | 搬進自己的子樹                                                                                                                                     |
| `OWNER_PROTECTED`         | 擁有者保護(ADR-0009)                                                                                                                               |
| `NOT_FOUND`               | 組織或使用者不在管理範圍內(不透露差別)、id 不存在                                                                                                  |
| `VALIDATION_FAILED`       | 欄位不合、`orgId` 不是合法 id、非租戶頂層卻設可見範圍 / 轉移擁有者、既非根組織也非租戶頂層卻設時區、時區不是合法的 IANA 名稱、開通勾了選項外的模組 |
| `FORBIDDEN`               | 權限不足(`@RequirePermission`)、非根組織做租戶作業、租戶內的人動租戶頂層                                                                           |
| `UPLOAD_REJECTED`         | 商標檔型或大小不合                                                                                                                                 |

錯誤碼總表在 GQL-04。前端解讀集中在 `org-manager-error.ts`。

正本:`apps/api/src/orgs/org-error.ts`、`apps/admin/src/pages/base/system/OrgManagerPage/org-manager-error.ts`、`docs/standards/api/graphql-schema.md`

## 稽核

由模組層寫 `audit_logs`(ADR-0004)。本模組每個會改資料的動作寫一筆:`action` = 權限 key 的動作段前加模組簡稱(`org.provision`、`org.revoke-provision`、`org.purge-demo`、`org.create-child`、`org.edit`、`org.toggle-enabled`、`org.move`、`org.delete`、`org.transfer-owner`、`org.set-visibility`、`org.set-timezone`,以及主管的 `org.set-managers`),`targetType = "org"`,`targetId` = 被操作的組織,`before` / `after` 只放有變的欄位(時區是 `{ timezone }`,沒設記 null);`orgId` = 動作發生的組織脈絡(操作者的當前組織)。

**例外:「加入成員」寫的是 `user.add-org`**:被改的是**使用者的所屬組織**,所以稽核跟著使用者走(`targetType = "user"`、`targetId` = 被加入的那位,每人一筆),與使用者管理的「選擇所屬組織」同一個 action —— 不另開 `org.add-members`,否則同一件事在稽核裡有兩種名字。

正本:`apps/api/src/orgs/orgs.service.ts`、`apps/api/src/orgs/tenant-ops.service.ts`、`apps/api/src/users/users.service.ts`

## 測試

- api:`apps/api/src/orgs/orgs.test.ts`、`tenant-ops.test.ts`、`org-members.test.ts`、`org-managers.test.ts`、`org-slug.test.ts`
- admin:`apps/admin/src/pages/base/system/OrgManagerPage/` 的 `OrgManagerPage.test.tsx`、`OrgManagerGuards.test.tsx`、`OrgManagerScope.test.tsx`、`OrgManagers.test.tsx`、`OrgMembers.test.tsx`、`OrgProvisionSlug.test.tsx`、`OrgRevokeProvision.test.tsx`、`OrgTimezone.test.tsx`、`OrgTreeAfterMove.test.tsx`(共用 `org-manager-test-support.ts`)
- 劇本(`docs/testing/permission-scenarios.md`):劇本 12 可見性開關、劇本 14 管理範圍 vs 可見範圍、劇本 15 側欄商標繼承、劇本 16 租戶視角、劇本 17 擁有者保護;E2E 為 `apps/e2e/src/specs/scenario-12-visibility-toggle.spec.ts`、`scenario-14-management-scope.spec.ts`、`scenario-15-sidebar-logo.spec.ts`、`scenario-16-tenant-perspective.spec.ts`、`scenario-17-owner-protection.spec.ts`

正本:`apps/api/src/orgs/`、`apps/admin/src/pages/base/system/OrgManagerPage/`、`apps/e2e/src/specs/`、`docs/testing/permission-scenarios.md`

## 使用者說明(help.md)

[system.org-manager.help.md](../../apps/admin/src/md/module-help/base/system.org-manager.help.md)(build 時打包進說明彈窗)。讀者是租戶使用者:不得出現 根組織 / 租戶 / 開通 / 跨租戶 等平台視角詞彙;租戶眼中的根 = 自己的頂層組織。

正本:`apps/admin/src/md/module-help/base/system.org-manager.help.md`

## 平台視角備註

- 整體結構:平台(根組織)> 各租戶 > 部門 / 分店;開通流程與 token 規則見 ADR-0009。
- 開通租戶、轉移擁有者、**撤銷開通**整段都是平台視角(根組織專屬、對象是租戶頂層),租戶使用者既看不到按鈕也沒有對應的概念,因此不寫進 help.md。
- 搬移僅限同租戶,跨租戶禁止。
- 「使用者可見自身組織的下層組織資料」開關與時區實際掛在租戶頂層、套用整個租戶(時區另外也掛在根組織);help 對租戶只說「頂層組織」「整個組織」。

正本:`docs/adr/0009-tenant-provisioning.md`、`docs/adr/0005-multi-tenant-isolation.md`
