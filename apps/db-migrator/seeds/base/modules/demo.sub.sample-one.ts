import {
  type ModuleSeedDeclaration,
  permissionKey,
} from "../module-declaration";

export const DEMO_GROUP_KEY = "demo";
export const DEMO_SUB_GROUP_KEY = "demo.sub";
export const SAMPLE_ONE_KEY = "demo.sub.sample-one";

const VIEW_PAGE_KEY = `${SAMPLE_ONE_KEY}.view-page`;
const CREATE_PAGE_KEY = `${SAMPLE_ONE_KEY}.create-page`;
const EDIT_PAGE_KEY = `${SAMPLE_ONE_KEY}.edit-page`;

/**
 * 示範模組1(正本:docs/modules/demo.sub.sample-one.md):底座模板、權限測試場、活教材。
 * 家族樹的 `demo` / `demo.sub` 群組在此宣告;示範模組2 掛 `demo` 直下(demo.sample-two.ts)。
 *
 * 全環境灌、seed 時 enabled=true;`enabled` 是「初始 seed 值的欄位」(建立後由人在系統內管理,
 * seed 重跑不覆寫),production 要關示範家族就在「模組與權限」頁停用。
 * 每個節點的 wildcard `<key>.*` 由 seeds/base/modules.ts 自動產生,此處只列個別權限。
 */
export const sampleOneModule: ModuleSeedDeclaration = {
  nodes: [
    {
      key: DEMO_GROUP_KEY,
      name: "示範群組",
      sidebarType: "group",
      parentKey: null,
      order: 2,
      route: "demo",
      icon: "extension",
    },
    {
      key: DEMO_SUB_GROUP_KEY,
      name: "示範次群組",
      sidebarType: "group",
      parentKey: DEMO_GROUP_KEY,
      order: 1,
      route: "sub",
      icon: "folder",
    },
    {
      key: SAMPLE_ONE_KEY,
      name: "示範模組1",
      sidebarType: "link",
      parentKey: DEMO_SUB_GROUP_KEY,
      order: 1,
      route: "sample-one",
      icon: "grid",
      description:
        "示範家族的完整示範:三層樹、隱藏頁、CRUD + wildcard、欄位級與頁面自有權限、資料範圍目標",
    },
    {
      key: VIEW_PAGE_KEY,
      name: "示範項目詳情",
      sidebarType: "hidden",
      parentKey: SAMPLE_ONE_KEY,
      order: 1,
      route: "view-page",
    },
    {
      key: CREATE_PAGE_KEY,
      name: "新增示範項目",
      sidebarType: "hidden",
      parentKey: SAMPLE_ONE_KEY,
      order: 2,
      route: "create-page",
    },
    {
      key: EDIT_PAGE_KEY,
      name: "編輯示範項目",
      sidebarType: "hidden",
      parentKey: SAMPLE_ONE_KEY,
      order: 3,
      route: "edit-page",
    },
  ],
  // 個別權限(綁「按鈕/欄位所在的那一頁」,ADR-0004);`delete` 無對應頁,權限與頁面不必一一對應
  permissions: [
    {
      key: permissionKey(SAMPLE_ONE_KEY, "view"),
      moduleKey: SAMPLE_ONE_KEY,
      name: "檢視",
      description: "看列表與單筆資料、進入檢視頁/打開檢視跳窗",
    },
    {
      key: permissionKey(SAMPLE_ONE_KEY, "create"),
      moduleKey: SAMPLE_ONE_KEY,
      name: "新增",
      description: "進入新增頁的按鈕 + 新增 API",
    },
    {
      key: permissionKey(SAMPLE_ONE_KEY, "edit"),
      moduleKey: SAMPLE_ONE_KEY,
      name: "編輯",
      description: "進入編輯頁的按鈕 + 編輯 API",
    },
    {
      key: permissionKey(SAMPLE_ONE_KEY, "delete"),
      moduleKey: SAMPLE_ONE_KEY,
      name: "刪除",
      description: "列表的刪除按鈕 + 刪除 API",
    },
    {
      key: permissionKey(SAMPLE_ONE_KEY, "show-internal-note"),
      moduleKey: SAMPLE_ONE_KEY,
      name: "內部備註可見",
      description: "跨頁共用欄位(詳情+編輯),綁父模組",
    },
    {
      key: permissionKey(SAMPLE_ONE_KEY, "edit-internal-note"),
      moduleKey: SAMPLE_ONE_KEY,
      name: "內部備註可改",
      description: "跨頁共用欄位(詳情+編輯),綁父模組;無此權限硬送寫入 → API 拒",
    },
    {
      key: permissionKey(CREATE_PAGE_KEY, "show-tips"),
      moduleKey: CREATE_PAGE_KEY,
      name: "填寫提示區塊",
      description: "新增頁自有權限示範",
    },
    {
      key: permissionKey(EDIT_PAGE_KEY, "show-history"),
      moduleKey: EDIT_PAGE_KEY,
      name: "變更歷程區塊",
      description: "編輯頁自有權限示範",
    },
  ],
  // 資料範圍目標(ADR-0008):業務欄位在此宣告,基礎欄位(組織 / 建立者 / …)由程式自動附加
  dataScopeTarget: {
    collection: "demo_items_one",
    name: "示範項目",
    description:
      "示範模組1 的資料(demo_items_one);規則示範與對照組(示範模組2 不宣告)",
    // `status` 是唯一的業務欄位:資料範圍的四種型別裡只有 enum 需要 seed 宣告固定選項,
    // 沒有它「enum 固定選項」在 dev 驗不到。value 對應
    // `apps/api/src/database/schemas/demo-item-one.schema.ts` 的 `status` 存的值。
    fields: [
      {
        name: "status",
        label: "狀態",
        type: "enum",
        options: [
          { value: "draft", label: "草稿" },
          { value: "published", label: "已發布" },
          { value: "archived", label: "已封存" },
        ],
      },
    ],
  },
};
