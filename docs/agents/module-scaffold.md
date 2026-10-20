# 新增一個 CRUD 模組(scaffold 藍本)

給**沒有對話 session** 的 agent 或新成員:從零長出一個後台 CRUD 模組要動哪些檔、照什麼順序動、每一步的正本在哪裡。

互動流程用 Claude Code skill `/module-scaffold`(`.claude/skills/module-scaffold/`):`plan` 模式問需求出規格卡,`build` 模式照本檔逐步實作;步驟內容仍以本檔為準。

藍本取自**示範家族**:[示範模組1](../modules/demo.sub.sample-one.md)(把所有選配都打開的完整示範)與 [示範模組2](../modules/demo.sample-two.md)(**對照組 —— 拿掉全部選配之後剩下的最小可行模組**)。要照抄就抄示範模組2,需要哪一項選配再回示範模組1 對照(選配清單見文末「示範模組 1 vs 2 差異對照表」)。

**欄位由使用者在後台設計的模組**(表單模組)不照本檔的步驟 1–5,改走文末的「表單模組路線」。

**這份文件不是規則的正本**,只是指路與順序:權限綁定看 ADR-0004、路由與判斷流程看 ADR-0011、資料範圍看 ADR-0008、基礎欄位看 ADR-0007、檔案儲存看 ADR-0010、前端分層看 ADR-0012(現況說明在 `docs/concepts/`)、程式碼規範看 `docs/standards/README.md` 的索引。每一步結尾的「正本」是照抄時要打開的檔。

## 檔案清單一覽

一個最小的 CRUD 模組(四頁、四筆權限、無選配)要新增或修改的檔案:

| 步驟        | 動的檔案                                                                                                                                                              | 正本 / 規則                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 0 規格      | `docs/modules/project/<模組key>.md`(新)                                                                                                                               | ADR-0004、本檔步驟 0                                                                           |
| 1 seed 宣告 | `apps/db-migrator/seeds/project/<模組key>.ts`(新)、`seeds/project/registry.ts`(登記 `moduleDeclarations`)                                                             | `seeds/base/module-declaration.ts`、ADR-0002                                                   |
| 1b 初始資料 | `apps/db-migrator/seeds/project/<feature>.ts`(新)、`seeds/project/registry.ts`(登記 `seeds`);示範資料另放 `seeds/project/demo/`                                       | `seeds/base/demo-items.ts`、ADR-0002                                                           |
| 2 schema    | `apps/api/src/project/database/<entity>.schema.ts`、repository(新)、`project/database/registrations.ts`                                                               | ADR-0007、ADR-0005、[資料層組裝](../concepts/data-layer-and-isolation.md#底座與專案資料的組裝) |
| 3 api 模組  | `apps/api/src/project/<feature>/`(新)、`project/api-modules.ts`                                                                                                       | `demo-items-two/`、STRUCT-01、GQL-02 / 03 / 04                                                 |
| 4 documents | `packages/graphql/src/documents/project/<feature>.graphql`(新)+ 兩份產物                                                                                              | GQL-05、[GraphQL 文件來源](../standards/api/graphql-schema.md)                                 |
| 5 admin     | `apps/admin/src/pages/project/<域>/` 的設定與薄頁面、`app/project/module-pages.ts`、`messages/<locale>/project/admin.json` 的 namespace、`mock/project/mock-world.ts` | `components/base/crud/demo-module-config.ts`、ADR-0012、I18N-02                                |
| 6 help      | `apps/admin/src/md/module-help/project/additions/<模組key>.help.md`(新)                                                                                               | FIGMA-04、CONTEXT.md + CONTEXT-PROJECT.md 詞彙表                                               |
| 7 測試      | `apps/api/src/project/<feature>/*.test.ts`、`apps/admin/src/pages/project/<域>/**/*.test.tsx`、`apps/admin/src/test/msw/project/` 的 MSW fixture                      | TEST-07、TEST-08                                                                               |
| 8 文件回寫  | `docs/modules/project/<模組key>.md` 補齊、`docs/project/data-model.md`、`CONTEXT-PROJECT.md`(有新詞才動)                                                              | CLAUDE.md「Domain docs」                                                                       |

**新 worktree 開工先**依 [toolbox.md](./toolbox.md) 的「pnpm / turbo:建置、測試、格式」準備依賴及共用套件產物。頁面登記與替換見[前端架構](../concepts/frontend-architecture.md),API 登記見[資料層組裝](../concepts/data-layer-and-isolation.md#底座與專案資料的組裝);本文指向新增專案功能的來源,不要求修改底座固定組裝入口。

## 步驟 0:先把規格寫進模組文件

`docs/modules/project/<模組key>.md`(專案模組;底座模組在 `docs/modules/<模組key>.md`)是這個模組的**單一真相**,程式照它寫、劇本照它驗。動程式前先定下三件事:

1. **模組樹**:哪些節點、`sidebarType`(group / link / hidden)、掛在誰底下。慣例是**四個 key = 四頁**:列表(link)+ 詳情 / 新增 / 編輯(hidden,key 一律以 `-page` 結尾,見 CONTEXT.md「隱藏頁」)。無路由、只用來歸屬一組權限的節點是**權限容器**,key 不以 `-page` 結尾。
2. **權限表**:每一筆權限「是哪一頁的什麼」。綁定原則(ADR-0004)是**綁按鈕 / 欄位所在的那一頁** —— 跨頁共用的欄位綁父模組,某一頁自己的區塊綁那一頁。權限與端點、權限與頁面都**不必一一對應**(示範模組2 六個端點只用四個 key;示範模組1 的 `delete` 沒有自己的頁)。
3. **資料欄位**:哪些欄位、哪些要進資料範圍目錄。

模組文件的章節順序固定(用途 → 模組 key 與畫面 → 權限表 → 資料 → 規則 → api 介面 → admin 頁面 → 錯誤碼 → 稽核 → 測試 → 使用者說明 → 平台視角備註),照示範模組2 的檔抄一份骨架;這一步先填前四節,其餘在步驟 8 補齊。

CLAUDE.md 規定:動到環境變數同步環境變數登記(專案變數在 `docs/project/env-registry.md`)、動到品牌元素同步品牌註冊表(專案值在 `docs/project/branding.md`)。

正本:`docs/modules/demo.sample-two.md`(章節骨架)、`docs/modules/demo.sub.sample-one.md`(選配全開的寫法)

## 步驟 1:seed 宣告(模組樹 / 權限 / dataScopeTarget)

正本型別:`apps/db-migrator/seeds/base/module-declaration.ts`(`ModuleSeedDeclaration`)。抄 `seeds/base/modules/demo.sample-two.ts`(最小)或 `demo.sub.sample-one.ts`(完整)。

新增 `apps/db-migrator/seeds/project/<模組key>.ts`,匯出一份 `ModuleSeedDeclaration`,加入 `seeds/project/registry.ts` 的 `projectSeedSource.moduleDeclarations`。固定入口 `seeds/registry.ts` 合併底座與專案來源,依父子引用排序,並一次推導模組、權限、資料範圍目標與租戶管理員模板;不用修改底座清單或手排父子順序。專案子模組可掛在底座父節點下;重複 key、缺少父節點與循環會在寫入前拒絕。

- **`nodes`**:`key` 是**累加父 key**(`<父key>.<自己那段>`,靜態測試 `seed-key-convention.test.ts` 會擋);`route` **只寫自己那一段**(完整路徑由 api 累加,ADR-0011 步驟 7);`icon` 吃白名單型別 `@repo/domain/module-icon`(打錯字 `check-types` 就紅),不宣告即落庫 `null` = 側欄預設圖示;根組織專屬的節點標 `isRootOnly`,其子孫一併從租戶管理員模板扣除(ADR-0009)。
- **`permissions`**:只列**個別權限**。每個節點固定一筆的 wildcard `<key>.\*` 由 `seeds/base/modules.ts` 的 `composeModuleSeeds` 自動產生,**不要自己宣告**(宣告了就是重複一筆)。`moduleKey` 指向「這個按鈕 / 欄位所在的那一頁」。
- **`dataScopeTarget`**(選配,ADR-0008):要讓這張表能被資料範圍規則篩才宣告。`fields` **只放業務欄位**,基礎欄位(組織 / 建立者 / 日期)由程式自動附加;`enum` 型別要在這裡列出固定 `options`,`value` 必須與 schema 存的值一一對應。不宣告 = 查詢只受可見範圍保底(示範模組2 就是這個對照)。
- **`enabled`、`icon`、`settings` 是「初始 seed 值的欄位」**(ADR-0002):專案可在 `seeds/project/settings.ts` 的 `moduleInitialValues` 依模組 key 指定初值。建立後由人在「模組與權限」頁管理(`settings` 放表單模組的列表欄位配置),重跑 seed 不會翻回宣告值。其餘欄位每次部署同步回宣告值。

**動到種子的數量或內容,連帶修 api 既有測試裡寫死的數字**(`apps/api/src/permission/permission.test.ts` 這類)—— 這屬於同一張票。

正本:`apps/db-migrator/seeds/project/registry.ts`、`apps/db-migrator/seeds/project/settings.ts`、`apps/db-migrator/seeds/base/module-declaration.ts`、`apps/db-migrator/seeds/base/modules.ts`、`apps/db-migrator/seeds/base/modules/demo.sample-two.ts`、`apps/db-migrator/src/seed/seed-key-convention.test.ts`

### 1b 初始資料與示範資料(選配)

以 `apps/db-migrator/seeds/base/demo-items.ts` 為藍本,新增 `seeds/project/<feature>.ts`,將宣告加入 `seeds/project/registry.ts` 的 `projectSeedSource.seeds`。組裝器依 `seedRef` 引用排序,缺少目標、重複識別鍵或循環會在寫入前拒絕,不用手排檔案順序。冪等以 `key` 識別(`key` 不是 schema 欄位,由 runner 寫在文件上);`seedRef` **只解析得到有 `key` 的種子文件**,所以引用不到 root 初始帳號這種沒有 `key` 的資料 —— 示範資料的建立者因此是固定的假 id。

**示範資料**(讓畫面有東西可看的業務資料,不是每個環境都要的初始資料)放 `apps/db-migrator/seeds/project/demo/`,不登記進 `projectSeedSource.seeds`:正式 seed 每次部署都會執行,示範資料屬業務資料(ADR-0002),不跟著部署寫進正式環境。

專案 migration 的測試放 `apps/db-migrator/src/project/`(底座的在 `apps/db-migrator/src/*.test.ts`)。

正本:`apps/db-migrator/seeds/base/demo-items.ts`、`apps/db-migrator/seeds/project/registry.ts`、`apps/db-migrator/src/seed/seed-composition.ts`

### 1c 欄位管理類別(選配)

模組的下拉要用欄位管理的類別(如示範模組1 的分類欄引用 `demo-category`)時,類別有兩種來法,並列存在、互不取代:

| 方法                        | 怎麼做                                                                                                        | 結果                                                                                   | 用在                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **開發者在 seed 宣告**      | 在 `apps/db-migrator/seeds/project/` 新增類別與選項宣告,加入 `project/registry.ts` 的 `seeds`,走 code + PR    | **系統類別**(`isSystem: true`):每次部署同步到三個環境,名稱 / 說明以 seed 為準,不可停用 | 模組固定要用的類別:程式碼以 key 引用它,每個環境都必須有 |
| **root 在欄位管理畫面新增** | 持 `system.field-manager.category-ops.manage-categories`、站在根組織(api 另驗根組織,權限被帶到別的組織也不行) | 只存在於那個環境,可停用;seed 不碰沒宣告的畫面類別                                      | 營運上臨時需要的類別,不需要發版                         |

畫面建的類別要固定下來,就在 seed 宣告**同一個 key**:下次 seed 以 key **認養**那一筆(`isSystem` 改 true、名稱 / 說明以 seed 為準、`_id` 不動,已經引用它的表單不受影響),根組織在它底下加的同 value 選項一併認養(選項的 `enabled` 保留人設的值),不必搬資料。那次部署的 seed 摘要會出現「認養 N」。

宣告形狀與認養條件沿用 `seeds/base/field-categories.ts`、`seeds/base/fields.ts` 的藍本;專案自行新增 key,不修改底座 entries。

正本:`apps/db-migrator/seeds/project/registry.ts`、`apps/db-migrator/seeds/base/field-categories.ts`、`apps/db-migrator/seeds/base/fields.ts`、`docs/modules/field-manager.md`「資料」、ADR-0002「seed 以 key 認養」

## 步驟 2:schema(基礎欄位 plugin、租戶過濾)

新增 `apps/api/src/project/database/<entity>.schema.ts`,以底座 `database/schemas/demo-item-two.schema.ts` 為藍本:

- `@Schema({ collection: "<collection>", timestamps: true })`;`orgId` 使用 `@Prop({ type: MongooseSchema.Types.ObjectId, required: true })`,其中 `MongooseSchema` 是從 `mongoose` 匯入的 `Schema` 別名,避免與 Nest 的 `@Schema` 混淆。屬性 TypeScript 型別仍可用 `Types.ObjectId`;不要把 bson 的 `Types.ObjectId` 放進 `@Prop.type`,Nest 會將它展開成 Mixed,失去 ObjectId 轉型。必填不可寫成條件函式,包括 `required: [函式, 訊息]` 的陣列形式。這是租戶資料的隔離邊界(ADR-0005);業務欄位逐欄寫 JSDoc(`docs/data-model.md` 指來這裡看細節);`enabled` 預設 `true`。
- 索引至少 `{ orgId: 1, createdAt: 1 }`。
- **兩個 plugin 一定要掛**:
  - `baseFieldsPlugin` —— 基礎欄位與軟刪除(ADR-0007)。
  - `tenantScopePlugin` —— 專案租戶資料使用 `business`(吃可見範圍)、`orgId`、`allowGlobal: false`;模組資料開 `moduleData: true`。判準寫在 schema 上,不在呼叫端切換。底座治理與全域資料的其他形狀見 ADR-0005,不是新增專案租戶模組的選項。
- **選一種資料共用宣告**(`tenantScopePlugin` 的 `sharing`,ADR-0014;規格要寫明是哪一種):
  - 不寫 = `private`(只照可見範圍)。
  - `shareable`(只給模組資料表):定 `defaultShareOrgs`(`none` / `wholeTenant` = 全部分店)與 `editable`(`true` 才在新增 / 編輯頁放「共用給」,input 收 `ShareOrgInput[]`、model 回 `ShareOrg[]`,沿用 `apps/api/src/sharing/share-org.model.ts`;藍本示範模組 2);要「也給某欄位指到的組織看」就加 `sharedByFields`,並在掛 plugin **之前**建 `{ tenantId: 1, <欄位>: 1 }` 索引。
  - `inheritDown`:下層看得到上層建的(上層訂、下層沿用的設定)。
  - 共用只放寬讀;寫入照可見範圍,`abilities` 對共用進來的資料要回 `false`。需要「整個租戶有沒有」或「引用的名稱」時用 `existsInTenant` / `findRefsInTenant`(`refFields` 宣告在 schema),不要自己把上下文提升成 `"all"`(提升上下文要登記,`database/elevated-contexts.ts`)。
- 在 `project/database/` 建 `XxxRepository extends BaseRepository<Entity, EntityDocument>`,型別別名與 repository 同居。到 `project/database/registrations.ts` 登記 model、repository 及組織資料檢查;repository 與 check 的 modelName 必須吻合。新增租戶資料沿用 business scope、orgId、allowGlobal=false,模組資料開 moduleData;collection 必須在掛 plugin 前設定。
- 固定 `database/database.module.ts` 組裝底座與專案來源,驗 model/collection/provider/key 碰撞、plugin 與檢查關聯並導出 repository。一般專案 model 漏檢查或錯綁 repository 會失敗,不能自行另外 forFeature 或匯出 raw Model 規避。刪組織與撤銷開通會共用這份資料檢查,不再逐一修改 OrgsService。

底座既有 users/roles 等特殊資料仍依自己的規則處理。專案業務登記預設為空,新增其他資料種類須先擴充並審查契約。

正本:`apps/api/src/database/schemas/demo-item-two.schema.ts`、`apps/api/src/project/database/registrations.ts`、`apps/api/src/database/registration.ts`、`apps/api/src/database/plugins/tenant-scope.plugin.ts`

## 步驟 3:api 模組(resolver / service / error / audit / abilities)

新增 `apps/api/src/project/<feature>/`,抄底座 `demo-items-two/`(最小)或 `demo-items-one/`(完整),再到 `project/api-modules.ts` 加入具名功能登記。ProjectModule 與 AppModule 負責固定組裝,不要改底座清單或核心 guards。

```
<feature>/
├── <feature>.module.ts          # imports: [DatabaseModule](AuditModule / PermissionModule 是 @Global,不必 import)
├── <feature>.resolver.ts        # 只做「守門 + 轉呼叫」(STRUCT-01)
├── <feature>.service.ts         # 規則全在這裡;查詢一律經 Repository,不自己寫範圍
├── <feature>-error.ts           # 錯誤的組裝;碼沿用 GQL-04 的通用碼
├── <entity>-mapper.ts           # document → model(有投影或衍生欄位才需要)
├── dto/                         # input(GQL-02:單一 input 物件)
├── models/                      # type 與 payload(GQL-02 / GQL-03)
└── test-support/fixtures.ts     # 測試夾具
```

- **守門**:resolver 每個端點一個 `@RequirePermission("<模組key>.<動作>")` + `@CurrentOperator()`;key 對應模組文件權限表的同一行。後端與前端吃的是同一個 `PermissionResolver`,兩邊永遠一致(ADR-0011)。
- **形狀**:mutation 一律回 payload(GQL-02);列表回 `{ items, totalCount }` 加全站現況的 `page` / `pageSize`(GQL-03)。型別名全 schema 唯一,撞名就加模組前綴(`DeleteDemoItemTwoPayload`)。
- **錯誤**:沿用 `FORBIDDEN` / `NOT_FOUND` / `VALIDATION_FAILED`(GQL-04),**不新增 code**;看不到的資料一律 `NOT_FOUND`,列表與單筆同一個答案(不透露存在與否)。可選輸入欄位的「缺席 vs `null`」語意逐欄寫進模組文件的「api 介面」節(GQL-06)。
- **`abilities`**:每筆資料回一組「這位操作者對這一筆能做什麼」,**由 api 依操作者的有效權限集算好、已含權限判斷**,前端只讀、不與 `usePermissions` 相乘(ADR-0011「abilities 的兩種語意」)。
- **稽核**:`AuditService.record`,動作 `<entity>.create` / `.edit` / `.delete` / `.toggle-enabled`,`targetType` 固定為該 collection 的單數名;`before` / `after` 只放有變的欄位。
- **自鎖**:`setXxxEnabled` 要不要套 `SELF_LOCK`,**拆票時就裁決並寫在票上**。判準:會讓操作者失去繼續操作能力(關掉就再也開不回來)的才套;業務資料的停用隨時開得回來,不套。

正本:`apps/api/src/demo-items-two/`(最小)、`apps/api/src/demo-items-one/`(完整)、`apps/api/src/app.module.ts`、`docs/standards/api/graphql-schema.md`

### 欄位級權限欄的四件事(選配)

某個欄位要另外一組權限才看得到 / 改得動時(示範模組1 的 `internalNote`),四件事缺一不可:

1. **投影**:沒有 `show-` 權限時,api **不把這個欄位放進回傳物件**(GraphQL 因此序列化成 `null`),列表與單筆一致。「沒權限」與「沒填」在值上長得一樣,所以前端**依自己的權限集**決定渲染與否,不拿值去猜。
2. **寫入守門**:欄位**一出現在 input 裡就要權限**(含送 `null` 清空),否則 `FORBIDDEN` + `extensions.reason = "FIELD_FORBIDDEN"`。
3. **稽核歷程一律 `[redacted]`**:`before` / `after` 只記「這個欄位變過」,不記內容 —— 否則沒有 `show-` 權限卻有「變更歷程」權限的人,可以從歷程把它讀出來,投影就白做了。
4. **keyword 不比對受權限欄**:清單搜尋只比對公開欄位(示範模組1 是 `name` / `note`)。比對了就等於提供一個「猜中即命中」的側信道,沒有權限的人照樣能問出內容。

歷程查詢(`xxxHistory(id)`)本身要**先驗這筆資料看不看得到**,否則歷程會變成繞過資料範圍規則的側門。

正本:`apps/api/src/demo-items-one/demo-items-one.service.ts`、`apps/api/src/demo-items-one/demo-item-one-mapper.ts`

### 上傳(選配,ADR-0010)

`apps/api/src/storage/upload-rules.ts` 是正本:加一個 `UploadPurpose`,並在 `UPLOAD_VISIBILITIES`(公開 / 私有 bucket)、`UPLOAD_PATH_PREFIXES`、`UPLOAD_RULES`(允許的 content type → 副檔名、大小上限)各補一行。可見性是**用途的衍生屬性**,不另給參數。寫入「由前端回傳路徑」的欄位前一律先過 `isOwnedUploadPath`,不然呼叫端可以把任意 bucket 物件塞進 DB。公開 bucket 回**穩定 URL**(可直接放 `<img src>`),私有 bucket 只回路徑與檔名、下載時另外現簽(讀取網址的 query 名帶模組前綴,如 `demoItemOneAttachmentUrl`,GQL-02)。**要顯示原始檔名 / 大小就在寫入 input 一起收**(前端 `useDemoUpload` 已回 `{ path, name, size, contentType }`,即 `File.name` / `size` / `type`),存成與路徑同生同滅的平行欄位 —— 物件路徑是 `<uuid>.<副檔名>`,本身不帶原始檔名(先例示範模組1 的 `attachment`)。

正本:`apps/api/src/storage/upload-rules.ts`、`apps/api/src/storage/storage.service.ts`(`isOwnedUploadPath`)

## 步驟 4:documents + codegen

新增 `packages/graphql/src/documents/project/<feature>.graphql`(query / mutation 文件),然後**依序**跑:

```
pnpm --filter @repo/api schema:generate
pnpm --filter @repo/graphql generate
```

`apps/api/schema.gql` 與 `packages/graphql/src/generated` 是同一條產線的前後兩段,**兩份產物要進同一個 commit**(GQL-05);CI 的「codegen 產物與 schema 一致」一步會擋。api-only 的票也一樣 —— 不補 document,下游的 admin 票撞不到 hook(GQL-07)。

新工作樹先依 [toolbox 的建置前置步驟](toolbox.md#pnpm--turbo建置測試格式)準備 workspace 產物。`generate` 寫入前會驗證兩區文件;operation 名稱與 fragment 名稱各自全域唯一,相同內容也不能撞名,不以專案檔覆蓋底座檔。

正本:`apps/api/package.json`(`schema:generate`)、`packages/graphql/package.json`(`generate`)、`packages/graphql/src/documents/base/demo-items-two.graphql`

## 步驟 5:admin(一份設定物件 + 三個薄頁面檔)

前端藍本正本:`apps/admin/src/components/base/crud/demo-module-config.ts` 的 **`DemoModuleConfig`**(逐項 JSDoc 就是規格)。分工是:

- **共用元件**(`components/base/crud/` 的 `DemoListPage` / `DemoDetailPage` / `DemoFormPage`)負責版型、兩層權限判斷、分頁、未儲存離開確認、刪除確認、錯誤擺放位置 —— **一行都不用改**。
- **詳情頁要設 itemLabel、刪除要關子頁籤**(ADR-0011「頁籤兩種」):路由頁籤列把詳情 / 編輯頁顯示成「模組名 — 檢視・項目名」/「模組名 — 編輯・項目名」,由頁面拿到資料後呼叫 `hooks/base/useRouteTabItemLabel(item.name, "view" | "edit")` 提供;刪除成功後呼叫 `hooks/base/useCloseItemTabs` 關掉那一筆的子頁籤。共用的 `DemoDetailPage` / `DemoFormPage` / `DemoListPage` 已接好;不用共用元件、自己寫頁面的模組要自己呼叫。
- **設定物件**負責「這個模組是什麼」:模組 key、權限 key、欄位定義、資料存取 hook、選配區塊。

共用元件**完全不認得任何模組的 GraphQL 型別**:資料存取一律由設定物件包成 `useRows` / `useItem` / `useSave` 三個 hook 交出來(只有刪除因為兩邊 input 同形 `{ id }` 才直接收 codegen 的 hook)。

要寫的檔案(對照示範模組2,全部加起來約 300 行,其中三個頁面檔各約 10 行):

| 檔案                                      | 內容                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `<feature>-config.ts`                     | 常數:`MODULE_KEY`、四個 `MODULE_KEYS`、整頁層級的 `PERMISSIONS`(view / create)、i18n namespace、`PAGE_SIZE`、`TABLE_MIN_WIDTH` |
| `<feature>-types.ts`                      | `Row` / `Detail` / `FormValues`(從 codegen 型別取,不手寫)                                                                      |
| `<Xxx>Module.tsx`                         | **一份 `DemoModuleConfig`** + 包好的 `useRows` / `useItem` / `useSave`                                                         |
| `<Xxx>Page.tsx` / `ViewPage` / `FormPage` | 各約 10 行:`<DemoListPage config={xxxModule} />` 之類                                                                          |

在 `app/project/module-pages.ts` 的 pages 清單登記四個 key:列表 / 詳情 / 新增 / 編輯,其中**新增與編輯登記到同一個共版型元件**,情境由 `module.key` 判斷。固定 `app/module-pages.tsx` 組裝底座與專案,新增不得撞既有 key。沒登記的模組由殼顯示佔位頁;網址與能否進入仍由 `me.modules` 決定,這裡只決定畫面。替換治理頁另存 `pages/project/`,在 `app/project/page-replacements.ts` 明列 target,保留底座原版。

**兩層判斷分開問**(ADR-0011):

- **進得去哪一頁** = `me.modules` 有沒有那個模組。路由字串也從模組陣列取,**前端不寫死路徑**。沒綁詳情頁 → 列上沒有「檢視」;沒綁新增頁 → 即使有 `create` 權限也沒有新增鈕。
- **頁內能做什麼**:整頁層級的(新增鈕、頁內區塊)問權限集;**逐列 / 逐筆的編輯 / 刪除一律讀 api 給的 `item.abilities`**,不與 `usePermissions` 相乘。

**i18n**(I18N-02、I18N-06):`packages/i18n/messages/zh-TW/project/admin.json` 與 `en/project/admin.json` 各加一個 namespace(併進 `admin`,與底座撞 key 會載入即丟錯),三頁共用;要換底座的字串寫 `project/admin.replacements.json`,不改底座的 `admin.json`。`columns.<key>` / `fields.<key>` / `form.<key>` 的 key 與設定物件的欄位 `key` 同名 —— 表單欄位的 `key` 同時是 `FormValues` 的鍵、i18n 的 key、**api 回報 `VALIDATION_FAILED` 時的欄位名**,三者同名,錯誤才標得回正確的欄位上。

專案頁直接使用 `components/base/crud/` 的共版型。不要引用 `pages/base/` 的頁面內部或複製共版型;通用修改依底座維護流程回收。

正本:`apps/admin/src/components/base/crud/demo-module-config.ts`、`apps/admin/src/pages/base/demo/SampleTwoModule.tsx`、`apps/admin/src/pages/base/demo/demo-sample-two-config.ts`、`apps/admin/src/pages/base/demo/SampleTwoPage/`、`apps/admin/src/app/module-pages.tsx`

## 步驟 6:help.md(租戶使用者看的說明)

新增 `apps/admin/src/md/module-help/project/additions/<模組key>.help.md`,**檔名必須等於模組 key**。要替換底座說明則放 `project/replacements/`,目標必須已存在於 base;不能以 additions 撞 key 覆蓋。`lib/base/help-registry.ts` 的三份 glob 在 build 時內嵌內容,`lib/base/module-help.ts` 驗證及選取。表單模組沒有專屬檔時退回底座 `form-module.help.md`;只替換畫面而未提供說明時仍使用底座說明。

- 結構沿用既有的說明檔:`# <模組名>` → `## 這個模組做什麼` → `## 常用操作` → `## 重要規則`。
- **讀者是租戶使用者**:守 `CONTEXT.md` 與 `CONTEXT-PROJECT.md` 詞彙表、**不得出現平台視角詞彙**(根組織 / 租戶 / 開通 / 跨租戶 / 平台);聯絡窗口一律寫「系統管理員」;「租戶管理員副本」在 UI 與 help 裡叫「預設角色」(FIGMA-04)。
- 對人的提示不用內部術語(「子樹」→「或其下層組織」)。
- 寫**使用者做得到的事與看得到的差異**,不寫實作(不出現 collection 名、權限 key、GraphQL 端點)。
- 交件前先 `pnpm --filter @repo/admin build` 再跑 `pnpm --filter @repo/admin check:help-bundle`(Dockerfile 也跑這一步):它驗每份 help.md 真的被打包進 `dist/assets`。理由:根目錄 `.dockerignore` 排除 `**/*.md`,help.md 靠一條例外才進得了 build context;例外一失效,本機 build 正常、image 裡的說明卻全是空的,沒有任何一步會失敗。

正本:`apps/admin/src/lib/base/module-help.ts`、`apps/admin/src/lib/base/help-registry.ts`、`apps/admin/src/md/module-help/base/demo.sample-two.help.md`、`apps/admin/scripts/check-help-bundle.mjs`

## 步驟 7:測試

專案登記的整合測試要經固定組裝入口:API fixture 只替換 `project/api-modules.ts` 與 `project/database/registrations.ts` 來源,啟動真 AppModule/DatabaseModule;後台 fixture 替換 project 登記來源,共用正式路由與 Provider。不要只測合成函式,也不要用額外 module 繞過要驗的登記。授權與資料由隔離測試建立,不把 fixture 加進正式 seed。

- **api(TEST-07)**:打真的 `/graphql`、對真 MongoDB。至少覆蓋:每個端點的權限守門(有 / 沒有該 key)、範圍(看不到的資料回 `NOT_FOUND`)、輸入驗證、稽核有沒有寫、`abilities` 的值。有欄位級權限的再加投影與寫入拒絕;有 `dataScopeTarget` 的加「規則命中 → 列表與單筆一致」;沒宣告的加「規則不介入」的對照。
- **admin(TEST-08)**:MSW 攔網路層 + RTL,`renderApp()` 渲染。至少覆蓋:權限驅動的渲染(按鈕出不出現、區塊顯不顯示)、路由防守(沒綁隱藏頁模組 → 無權限頁)、放棄變更、錯誤標回欄位。MSW handler **有連動 / 狀態語意就實作進 handler**,不要回固定資料。
- **不要把佔位夾具登記掉**:`apps/admin/src/test/msw/module-fixtures.ts` 的 **`placeholderModules`**(`demo.not-implemented`)是專門用來驗「殼對沒登記頁面的模組顯示佔位頁」的夾具模組,**永遠不會被實作**。新增真頁面時不要順手把它加進 `module-pages.tsx`。
- **mock 模式**:專案模組加進 `apps/admin/src/mock/project/mock-world.ts`(`modules` 給側欄的模組、`handlers` 用 `src/test/msw/project/` 的 world),不改 `mock/mock-world.ts`;GraphQL 操作名與底座重複時 `mock-world.test.ts` 會紅。
- **E2E**(只在需要權限劇本時,TEST-05):specs 放 `apps/e2e/src/specs/project/`,劇本說明寫 `docs/testing/project/scenarios.md`,編號用專案前綴。
- 跑法:`pnpm exec turbo run test --filter=@repo/api` / `--filter=@repo/admin`(turbo 會先 build 依賴)。只跑一個測試檔的寫法見 toolbox「pnpm / turbo」(旗標不能接在 `pnpm run test --` 後面)。

正本:`apps/api/src/demo-items-two/demo-items-two.test.ts`、`apps/admin/src/pages/base/demo/SampleTwoPage/`(`*.test.tsx`)、`apps/admin/src/test/msw/demo-sample-two-handlers.ts`、`docs/standards/testing/testing.md`

## 步驟 8:文件回寫

- `docs/modules/project/<模組key>.md` 照固定章節補齊,尤其「api 介面」(GQL-06 / GQL-07 的正本寫在這裡)、「admin 頁面」、「錯誤碼」、「稽核」、「測試」;每節結尾附「正本:`<路徑>`」。
- `docs/project/data-model.md`(專案資料表地圖,格式同 `docs/data-model.md`;還沒有就建立,並登記進 `docs/project/README.md`)加該 collection 一列(欄位細節指向 schema 檔,不在地圖裡重抄)。底座的 `docs/data-model.md` 不寫專案資料表。
- 專案模組的新詞寫進 `CONTEXT-PROJECT.md`,只在**真的長出新詞**時加;新詞要連 `_Avoid_` 一起寫,不重新定義 `CONTEXT.md` 的底座名詞。
- 模組文件與 help.md 是**實作票必然連動的兩處**;ADR、`docs/standards/`、底座 `CONTEXT.md` 這類規則本文由文件票寫,實作發現寫錯**寫進 PR 的「規則回饋」**,不要就地改。

正本:`docs/agents/issue-tracker.md`「文件的歸屬」、`docs/data-model.md`、`docs/agents/domain.md`(兩份詞彙表的分工)

## 示範模組 1 vs 2 差異對照表(哪些是選配)

示範模組2 = 最小可行模組。下表每一列都是**可以不做**的東西;要做時照「示範模組1 怎麼做」那一欄找正本。

| 選配項目               | 示範模組1                                                | 示範模組2 | 不做的代價 / 怎麼做                                                                                                        |
| ---------------------- | -------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| **資料範圍目標**       | seed 宣告 `dataScopeTarget`(`demo_items_one`)            | 不宣告    | 不宣告 = 查詢只受**可見範圍**保底,「資料範圍」頁左側列不到它,規則機制不介入(ADR-0008)                                      |
| **enum 可篩欄位**      | `status`(草稿 / 已發布 / 已封存)                         | 無        | `dataScopeTarget.fields` 裡列 `type: "enum"` + 固定 `options`;value 與 schema 的欄位一一對應                               |
| **欄位級權限**         | `internalNote` + `show-` / `edit-internal-note` 兩筆權限 | 無        | 要做就是上面「欄位級權限欄的四件事」全做(投影 / 寫入守門 / 歷程 redact / keyword 不比對);前端以 `isVisible` 與 `mode` 表達 |
| **頁面自有權限(slot)** | 新增頁 `show-tips`、編輯頁 `show-history`                | 無        | 權限綁在那一頁的模組上;前端用設定物件的 `form.slots`(回 `null` 即不顯示)                                                   |
| **變更歷程**           | `demoItemOneHistory(id)` 讀 `audit_logs`                 | 無        | 歷程查詢要先驗這筆看不看得到;受權限欄在歷程裡一律 `[redacted]`                                                             |
| **雙路檔案儲存**       | 封面(公開 bucket)+ 附件(私有 bucket)                     | 無        | `upload-rules.ts` 加 purpose;前端用設定物件的 `form.uploads`(空陣列 = 沒有上傳欄)                                          |
| **模組自有篩選器**     | 分類 `Autocomplete`(選項來自欄位管理)                    | 無        | 設定物件的 `list.Filters`;不給就只有搜尋框                                                                                 |
| **外部選項來源**       | 分類選項來自欄位管理「示範分類」                         | 無        | 選項端點掛在**別的模組的權限**底下(`system.field-manager.view`)—— 沒有它的人:列表無該篩選、表單該欄唯讀並說明原因          |
| **三層模組樹**         | `demo > demo.sub > sample-one`                           | 兩層      | 純粹是樹的深度;`route` 各寫自己那一段,完整路徑由 api 累加                                                                  |
| **多筆個別權限**       | 8 筆(含欄位級與頁面自有)                                 | 4 筆      | 最小就是 view / create / edit / delete;wildcard 每個節點自動一筆                                                           |

**兩邊一樣、沒得選的**:四個模組 key = 四頁、共用的三個頁面元件、兩層判斷分開問、`abilities` 由 api 算好、`tenantScopePlugin` + `baseFieldsPlugin`、軟刪除、payload 形狀、審計四個動作、help.md、i18n 兩份字典、錯誤解讀共用 `components/base/crud/demo-error.ts`(錯誤碼一律沿用 GQL-04 通用碼,不新增 code)。

### 選配、但兩支示範模組都做了的

下面這項也是選配,只是兩支示範模組都做了,所以不在上表;照抄示範模組2 時可以拿掉:

| 選配項目                                  | 兩支怎麼做                                                                    | 不做的代價 / 怎麼做                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **啟用 / 停用切換(選配:`useSetEnabled`)** | 各自有 `setDemoItemOneEnabled` / `setDemoItemTwoEnabled`,列表「啟用」欄是開關 | 設定物件不給 `useSetEnabled` = 這個模組沒有啟用 / 停用,列表維持唯讀 `Tag`;給了也只有 `abilities.canEdit` 為真的列才是開關 |

**選配的 hook 與 React 的 hook 規則相衝 —— 用「替身 hook」解,不要條件式呼叫**:設定物件裡的 `useSetEnabled` 是選配,直覺寫法是 `config.useSetEnabled?.(…)`,但那是**條件式呼叫 hook**,`rules-of-hooks` 會擋(REACT-06),而且模組之間切換時 hook 數量會變。做法是在共用層準備一支**同簽章、什麼都不做**的替身(先例 `components/base/crud/useDemoQuery.ts` 的 `noDemoSetEnabled`,回一個恆 `undefined` / no-op 的結果),呼叫端一律 `(config.useSetEnabled ?? noDemoSetEnabled)(…)` —— hook 一定被呼叫、呼叫順序固定,「有沒有這個選配」變成資料而不是控制流。日後新增別的選配 hook 照同一個形狀做。

正本:`apps/admin/src/components/base/crud/useDemoQuery.ts`、`apps/admin/src/components/base/crud/demo-module-config.ts`

## 表單模組路線

欄位、版面、版本由使用者在後台「表單管理」設計的模組(`engine: "form"`),沿用既有引擎,不另寫 schema 或 api。宣告骨架、登記預設組裝後,以設計器管理定義;需要跨環境交付時,將測試過的發布版登記為專案 seed。範例 [示範表單](../modules/demo-form.md)(三個表單模組,示範頂層 / 群組內 / 次群組內三種位置),規則正本 [forms](../modules/forms.md),概念見 `docs/concepts/form-engine.md`。

| 步驟 | 做什麼                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 正本                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | seed 宣告:新增 `apps/db-migrator/seeds/project/<模組 key>.ts`,呼叫 `formModuleDeclaration({ key, name, parentKey, order, route, icon, description, settings?, permissions? })`,加入 `seeds/project/registry.ts` 的 `moduleDeclarations`,由組裝器處理父子順序。函式產出整份骨架:列表節點(`engine: "form"`)、三個隱藏頁 `view-page` / `create-page` / `edit-page`、四筆權限 `view / create / edit / delete` + 宣告的頁內權限、`form_submissions` 的資料範圍目標(欄位目錄 = 基礎欄位 + 提交狀態七種;`moduleKey` 由組裝器填) | `apps/db-migrator/seeds/project/registry.ts`、`apps/db-migrator/seeds/base/form-module-declaration.ts`、`apps/db-migrator/seeds/base/modules/demo-form.ts` |
| 2    | 在 `app/project/module-pages.ts` 的 forms 清單加入 `{ moduleKey }`;可附 options/pageOverrides,固定入口展開四頁並驗撞 key                                                                                                                                                                                                                                                                                                                                                                                                 | `app/module-page-registry.ts`、[前端架構](../concepts/frontend-architecture.md)                                                                            |
| 3    | help.md:**不必另寫**。表單模組沒有專屬檔時,「?」自動用通用說明 `form-module.help.md`(彈窗標題是模組名);有特殊需求才加 `apps/admin/src/md/module-help/project/additions/<模組 key>.help.md` 專屬檔(專屬檔優先)                                                                                                                                                                                                                                                                                                            | `apps/admin/src/lib/base/module-help.ts`(`resolveModuleHelp`)、`apps/admin/src/md/module-help/base/form-module.help.md`                                    |
| 4    | 模組文件:`docs/modules/project/<模組 key>.md`,照示範表單的結構                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `docs/modules/demo-form.md`                                                                                                                                |
| 5    | 部署後:根組織在「表單管理」建共用表單 → 設計 → 發布 → 分派租戶;要綁審核流程就在「流程管理」建流程並綁定;列表欄位配置在「模組與權限」的右面板設定                                                                                                                                                                                                                                                                                                                                                                         | `docs/modules/forms.md`、`docs/modules/workflows.md`、`docs/modules/module-manager.md`                                                                     |

**跨環境交付定義**:共用表單與流程在開發用途環境發布並實際試填、測流程後,匯出同一套 `.seed.ts`,放入 `seeds/project/revisions/`,再由 `seeds/project/registry.ts` 匯入登記。必要的資料轉換與設定在同一分支交付,驗證空庫建立、既有資料升級及重跑不增版。租戶分派、人員與流程綁定仍由各環境維護;未登記的 UI 自建與租戶客製內容不會自動同步。發布與資料轉換規則見[種子資料與遷移](../concepts/data-layer-and-isolation.md#種子資料與遷移)。

**客製頁**:專案自有表單在 forms entry 明列 pageOverrides,表單相關部分使用引擎零件(`FormRenderer`、`FormSubmissionList`、`FormSubmissionDetail`、`useFormDraft`…):

```ts
{
  moduleKey: OTHER_KEY,
  options: { tabLabelTemplate: "{{title}}" },
  pageOverrides: { list: { Page: OtherListPage } },
}
```

- `formModuleDeclaration` 固定產出三個隱藏頁。新增 / 編輯改用跳窗、不要對應的頁時,不用這個函式,照它的形狀自己寫宣告並省略那幾頁。
- 模組層的頁籤 / 標題模板放 forms entry 的 options(預設 `{{title}}`),表單自己的 `tabLabelTemplate` 可覆寫。組裝先驗四頁 key 與 options,再由 Provider 注入,載入時不寫共享 Map。替換底座表單頁使用 page-replacements,只換畫面/寬度,不改底座 options。
- 不必新增 i18n、MSW handler、api 測試:引擎零件的文案在 `admin.json` 的 `formEngine` namespace,測試在 `components/base/form-engine/` 旁邊;新模組只需要在 seed 測試與 `module-pages` 的登記裡出現。

## 交件前檢查清單

- [ ] `pnpm exec turbo run check-types`、`lint`、`test` 全綠
- [ ] `pnpm format` 跑過(`format:check` 涵蓋 `.md` 與 `.ts` / `.tsx` / `.json` / `.yaml`)
- [ ] 動過 schema → `schema:generate` + `graphql generate` 兩份產物都在 commit 裡(GQL-05)
- [ ] `pnpm --filter @repo/admin build` 後 `check:help-bundle` 過
- [ ] `docs/modules/project/<模組key>.md` 與 help.md 同 PR 更新
- [ ] admin 票附 mock 模式截圖(`pnpm --filter @repo/admin dev:mock --port <自選埠> --strictPort`,網址以終端的 `Local:` 為準),逐張寫明哪一頁、什麼狀態
- [ ] 新增的環境變數 / 品牌元素同步 `docs/project/env-registry.md` / `docs/project/branding.md`(新的列另補進底座的註冊表)

正本:`docs/agents/issue-tracker.md`「實作一張票」
