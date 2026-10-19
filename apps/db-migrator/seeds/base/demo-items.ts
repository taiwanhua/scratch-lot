import { ObjectId } from "mongodb";

import {
  type SeedDocument,
  type SeedDocumentSet,
  seedRef,
} from "../../src/seed/seed-declaration";
import { DEMO_CATEGORY_KEY } from "./field-categories";
import { SAMPLE_TWO_KEY } from "./modules/demo.sample-two";
import { SAMPLE_ONE_KEY } from "./modules/demo.sub.sample-one";
import { ROOT_ORG_KEY } from "./orgs";

/**
 * 示範家族的**示範資料**(模組定義見 docs/modules/demo.sub.sample-one.md、demo.sample-two.md)。
 * 兩個 collection 各 5 筆,全環境灌同一份(seed 不分環境,ADR-0002)—— 示範資料本來就是種子:
 * 新環境 bootstrap 完登入就看得到東西,劇本 2 / 3 / 4 / 12 在畫面上有資料可比對。
 *
 * **冪等以 `key` 識別**(ADR-0002):`key` 不是 schema 欄位,與 `isSystem` 一樣由 runner 寫在文件上
 * (`data_scope_targets` 的 `collection` 同理);Mongoose 讀回時忽略,不影響 api。
 *
 * **可以改、改了不會被翻回去的只有 `enabled`**(runner 預設的「初始 seed 值欄位」,ADR-0002):
 * 其餘欄位每次部署同步回本檔的宣告值 —— 示範資料被玩壞時,下一次部署自動復原,這是刻意的。
 * 軟刪除(`deletedAt`)不在宣告內,所以刪掉的示範項目不會被 seed 種回來。
 */

/**
 * **示範資料的建立者是假 id**(已知限制):seed 目前只種一個帳號(root 初始帳號,
 * `src/seed/root-admin.ts`),而它沒有 `key` 欄位 —— `seedRef` 只以 `key` 解析
 * (`seed-declaration.ts`),所以引用不到任何真的使用者。
 *
 * 用固定的假 id 而不是 `null`,是為了讓「不同建立者」在畫面上看得出差異,並讓劇本 2
 * (資料範圍規則「建立者 = 【操作者本人】」)有東西可以被濾掉 —— 示範資料一律屬於「別人」,
 * 規則一開,列表就只剩操作者自己新增的那幾筆。代價是詳情頁的建立者查無此人(顯示為空)。
 *
 * 真要在畫面上看到人名,就在該環境自己新增一筆(用示範模組的表單)。
 */
const DEMO_CREATOR_IDS = {
  /** 假建立者甲 */
  a: new ObjectId("00000000000000000000d001"),
  /** 假建立者乙 */
  b: new ObjectId("00000000000000000000d002"),
  /** 假建立者丙 */
  c: new ObjectId("00000000000000000000d003"),
} as const;

/**
 * **示範資料全部落在根組織**(已知限制):`orgs` 種子只有根組織一筆
 * (`orgs.ts`:「唯一以 key 種子的組織」,ADR-0005),租戶是由 root 在「開通租戶」建出來的,
 * 各環境 id 不同、seed 引用不到。因此要讓示範資料「分布兩個租戶」,在現有 seed 機制下做不到;
 * 跨租戶的差異(劇本 12 可見性開關)請在該環境用手動新增的資料驗。
 */
const DEMO_ORG = seedRef("orgs", ROOT_ORG_KEY);

/** 分類的 value 對照欄位管理「示範分類」的全域種子選項(`fields.ts`);label 由前端查選項取得。 */
const CATEGORY = {
  staple: "staple",
  sideDish: "side-dish",
  drink: "drink",
} as const;

/** 與 `apps/api/src/database/schemas/demo-item-one.schema.ts` 的 `DEMO_ITEM_ONE_STATUSES` 一一對應。 */
const STATUS = {
  draft: "draft",
  published: "published",
  archived: "archived",
} as const;

/**
 * 示範模組1 的示範資料:5 筆分散在三個(假)建立者、三個分類、三種狀態,其中一筆初始停用。
 * 欄位形狀對照 `demo-item-one.schema.ts`;`coverPath` / `attachmentPath` 不種
 * (物件要真的存在於 bucket 才有意義,ADR-0010),由使用者自己上傳示範。
 */
const demoItemsOneEntries: SeedDocument[] = [
  {
    key: "demo-item-one.spring-menu",
    data: {
      orgId: DEMO_ORG,
      name: "春季菜單",
      category: CATEGORY.staple,
      status: STATUS.published,
      note: "已發布的主食示範項目",
      internalNote: "內部備註示範:沒有 show-internal-note 權限的人看不到這一欄",
      enabled: true,
      createdBy: DEMO_CREATOR_IDS.a,
    },
  },
  {
    key: "demo-item-one.side-dish-prep",
    data: {
      orgId: DEMO_ORG,
      name: "小菜備料表",
      category: CATEGORY.sideDish,
      status: STATUS.draft,
      note: "草稿狀態的小菜示範項目",
      internalNote: "內部備註示範:與備註同一張表單、權限不同",
      enabled: true,
      createdBy: DEMO_CREATOR_IDS.b,
    },
  },
  {
    key: "demo-item-one.drink-list",
    data: {
      orgId: DEMO_ORG,
      name: "飲品清單",
      category: CATEGORY.drink,
      status: STATUS.published,
      note: "已發布的飲品示範項目",
      enabled: true,
      createdBy: DEMO_CREATOR_IDS.c,
    },
  },
  {
    key: "demo-item-one.archived-menu",
    data: {
      orgId: DEMO_ORG,
      name: "去年冬季菜單",
      category: CATEGORY.staple,
      status: STATUS.archived,
      note: "已封存:資料範圍規則以 status 篩選時的對照組",
      enabled: true,
      createdBy: DEMO_CREATOR_IDS.a,
    },
  },
  {
    key: "demo-item-one.disabled-sample",
    data: {
      orgId: DEMO_ORG,
      name: "已停用的示範項目",
      category: CATEGORY.drink,
      status: STATUS.draft,
      note: "初始即停用:列表的狀態欄與篩選有東西可看",
      enabled: false,
      createdBy: DEMO_CREATOR_IDS.b,
    },
  },
];

/** 示範模組2(對照組)的示範資料:只有 name / note / enabled + 基礎欄位,同樣一筆初始停用。 */
const demoItemsTwoEntries: SeedDocument[] = [
  {
    key: "demo-item-two.weekly-report",
    data: {
      orgId: DEMO_ORG,
      name: "每週營運週報",
      note: "對照組:未宣告資料範圍目標,查詢只受可見範圍保底",
      enabled: true,
      createdBy: DEMO_CREATOR_IDS.a,
    },
  },
  {
    key: "demo-item-two.supplier-contact",
    data: {
      orgId: DEMO_ORG,
      name: "supplier 聯絡窗口",
      note: "關鍵字搜尋示範:名稱含英文",
      enabled: true,
      createdBy: DEMO_CREATOR_IDS.b,
    },
  },
  {
    key: "demo-item-two.kitchen-checklist",
    data: {
      orgId: DEMO_ORG,
      name: "廚房檢查表",
      note: "沒有分類、沒有狀態 —— 這就是與示範模組1 的差別",
      enabled: true,
      createdBy: DEMO_CREATOR_IDS.c,
    },
  },
  {
    key: "demo-item-two.training-notes",
    data: {
      orgId: DEMO_ORG,
      name: "新人訓練筆記",
      enabled: true,
      createdBy: DEMO_CREATOR_IDS.a,
    },
  },
  {
    key: "demo-item-two.disabled-sample",
    data: {
      orgId: DEMO_ORG,
      name: "已停用的對照項目",
      note: "初始即停用:與示範模組1 的停用筆對照",
      enabled: false,
      createdBy: DEMO_CREATOR_IDS.c,
    },
  },
];

/** 示範分類的種子選項 key 前綴(本檔的 `category` 值必須是其中之一,`fields.ts` 正本)。 */
export const DEMO_ITEM_CATEGORY_KEYS = Object.values(CATEGORY).map(
  (value) => `${DEMO_CATEGORY_KEY}.${value}`,
);

/**
 * 模組資料的兩個欄位(api 的 `tenantScopePlugin({ moduleData: true })`):seed 直接寫 driver、
 * 不經 api 的 BaseRepository,所以要自己帶。`moduleKey` 寫死該表的模組 key;
 * 示範資料全在根組織,根組織不屬於任何租戶 → `tenantId: null`。
 */
function asModuleData(
  entries: SeedDocument[],
  moduleKey: string,
): SeedDocument[] {
  return entries.map((entry) => ({
    ...entry,
    data: { ...entry.data, moduleKey, tenantId: null },
  }));
}

export const demoItemsOne: SeedDocumentSet = {
  kind: "documents",
  collection: "demo_items_one",
  entries: asModuleData(demoItemsOneEntries, SAMPLE_ONE_KEY),
};

export const demoItemsTwo: SeedDocumentSet = {
  kind: "documents",
  collection: "demo_items_two",
  entries: asModuleData(demoItemsTwoEntries, SAMPLE_TWO_KEY),
};
