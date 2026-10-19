import type { TestField, TestFieldCategory } from "./field-manager-handlers";

/**
 * 欄位管理頁的夾具。
 *
 * 形狀以 `docs/modules/field-manager.md`「api 介面」與 api 測試的斷言為準(TEST-08):
 * 類別全是**全域種子**(租戶不可自訂);選項是**合併清單** = 全域種子(`ownerOrg: null`)
 * + 上層組織自訂 + 本組織自訂 + 可見範圍內的下層自訂,每筆帶 api 算好的
 * `isOwn` / `canEdit` / `canToggleEnabled`。
 *
 * 組織樹與 api 的 `field-visibility.test.ts` 同一組(規則表的例子):
 * 好食公司(上層)─ 南港店(**當前組織**)─ 子南港店;信義店是看不到的旁支。
 */

/** 夾具裡的組織(來源欄的「<組織名稱> 自訂」)。 */
export const upperOrg = { id: "org-top", name: "好食公司" };
export const currentOrg = { id: "org-branch", name: "南港店" };
export const lowerOrg = { id: "org-sub-branch", name: "子南港店" };

/** 全域種子:沒有擁有組織,租戶視角下什麼都不能動。 */
const globalField = (
  id: string,
  categoryId: string,
  label: string,
  value: string,
  order: number,
  overrides: Partial<TestField> = {},
): TestField => ({
  id,
  categoryId,
  label,
  value,
  order,
  enabled: true,
  description: null,
  ownerOrg: null,
  isOwn: false,
  canEdit: false,
  canToggleEnabled: false,
  ...overrides,
});

/** 某個組織加的自訂選項;`isOwn` 為真時(= 當前組織這一層)才可編輯 / 可切。 */
const orgField = (
  owner: { id: string; name: string },
  id: string,
  categoryId: string,
  label: string,
  value: string,
  order: number,
  overrides: Partial<TestField> = {},
): TestField => {
  const isOwn = owner.id === currentOrg.id;
  return globalField(id, categoryId, label, value, order, {
    ownerOrg: owner,
    isOwn,
    canEdit: isOwn,
    canToggleEnabled: isOwn,
    ...overrides,
  });
};

/**
 * 左欄類別(依建立順序,不分頁):兩個 seed 宣告的系統類別,加一個 root 在畫面建、已停用的類別
 * (停用只影響表單設計器的類別清單;欄位管理頁照樣列出、灰掉)。
 */
export const fieldCategories: TestFieldCategory[] = [
  {
    id: "cat-gender",
    key: "gender",
    name: "性別",
    description: "使用者資料的性別選項",
    isSystem: true,
    enabled: true,
  },
  {
    id: "cat-demo",
    key: "demo-category",
    name: "示範分類",
    description: null,
    isSystem: true,
    enabled: true,
  },
  {
    id: "cat-cuisine",
    key: "cuisine",
    name: "料理類型",
    description: "營運上臨時需要的分類",
    isSystem: false,
    enabled: false,
  },
];

/**
 * 示範分類的合併清單:三筆全域種子 + 上層 / 本組織 / 下層各一筆自訂。
 * 「飲品」刻意是停用的,用來驗「停用只是狀態、選項不刪」與開關的初始值;
 * 同 order = 4 的三筆依組織深度排(api 已排好,夾具照抄那個順序)。
 */
export const demoCategoryFields: TestField[] = [
  globalField("f-staple", "cat-demo", "主食", "staple", 1),
  globalField("f-side-dish", "cat-demo", "小菜", "side-dish", 2),
  globalField("f-drink", "cat-demo", "飲品", "drink", 3, { enabled: false }),
  orgField(upperOrg, "f-dessert", "cat-demo", "甜點", "dessert", 4),
  orgField(currentOrg, "f-fried", "cat-demo", "炸物", "fried", 4, {
    description: "本組織自訂",
  }),
  orgField(lowerOrg, "f-soup", "cat-demo", "湯品", "soup", 4),
];

/** 性別:四筆全域種子(field-manager.md 種子表),沒有自訂選項。 */
export const genderFields: TestField[] = [
  globalField("f-male", "cat-gender", "男", "male", 1),
  globalField("f-female", "cat-gender", "女", "female", 2),
  globalField("f-other", "cat-gender", "其他", "other", 3),
  globalField("f-undisclosed", "cat-gender", "不透露", "undisclosed", 4),
];

/** 預設的 `fields(categoryId)` 回應表。 */
export const fieldsByCategory: Record<string, TestField[]> = {
  "cat-gender": genderFields,
  "cat-demo": demoCategoryFields,
};

/**
 * 「僅本組織」可見範圍的合併清單:下層(子南港店)加的那筆不見了,上層的還在
 * (可見性開關只管下層,上層繼承不受它影響 —— 規則表第 4 列)。
 */
export const demoCategoryFieldsOwnVisibility: TestField[] =
  demoCategoryFields.filter((field) => field.ownerOrg?.id !== lowerOrg.id);

/**
 * 根組織視角:種子選項的全域 `enabled` 開關切得動(api 算出 `canToggleEnabled: true`),
 * 但全部租戶的自訂選項一筆都不是自己的,所以都不可編輯。
 */
export const demoCategoryFieldsAsRoot: TestField[] = demoCategoryFields.map(
  (field) =>
    field.ownerOrg === null
      ? { ...field, canToggleEnabled: true }
      : { ...field, isOwn: false, canEdit: false, canToggleEnabled: false },
);
