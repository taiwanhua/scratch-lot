import type { ComponentType, ReactNode } from "react";

import type { GraphQLClient, UploadPurpose } from "@repo/graphql";

/**
 * 設定驅動的示範模組三頁。**這一份是 module-scaffold 的前端藍本**
 * (`docs/agents/module-scaffold.md`,示範線 5 寫):新開一個 CRUD 模組時,
 * 要寫的就是一份 `DemoModuleConfig`,三頁本身(`DemoListPage` / `DemoDetailPage` /
 * `DemoFormPage`)一行都不用改。
 *
 * 分工:
 * - **共用元件**負責版型、兩層權限判斷(ADR-0011)、分頁、未儲存離開、刪除確認、錯誤擺放位置。
 * - **設定物件**負責「這個模組是什麼」:模組 key、權限 key、欄位定義、資料存取 hook、
 *   特有區塊(slot)與開關(內部備註 / 封面 / 附件 / 提示 / 歷程 / 狀態)。
 *
 * **共用元件完全不認得任何模組的 GraphQL 型別** —— 資料存取一律由設定物件包成
 * `useRows` / `useItem` / `useSave` 三個 hook 交出來(型別在模組那一側對齊),
 * 只有刪除因為兩邊的 input 同形(`{ id }`)才直接收 codegen 的 mutation hook。
 *
 * 兩個實例:`pages/base/demo/SampleOneModule.tsx`(完整示範:欄位級權限、雙路儲存、
 * 頁面自有權限區塊)與 `pages/base/demo/SampleTwoModule.tsx`(對照組:只有 name / note / enabled)。
 */

/** `use-intl` 的翻譯函式(共用元件只用到「取字串」這一個能力)。 */
export type DemoTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/**
 * 共用元件對「一筆資料」的最低要求。各模組的 fragment 只要有這四個欄位就套得上;
 * `abilities` 由 api 依操作者算好(已含權限判斷),前端只讀、**不與 `usePermissions` 相乘**。
 */
export interface DemoItemLike {
  id: string;
  name: string;
  enabled: boolean;
  abilities: { canEdit: boolean; canDelete: boolean };
}

/** 四個模組 key = 四個頁面(ADR-0011「模組 = 頁面」);沒綁該模組就進不去那一頁。 */
export interface DemoModuleKeys {
  list: string;
  viewPage: string;
  createPage: string;
  editPage: string;
}

/**
 * 整頁層級才問得到的權限 key。**逐列的 `canEdit` / `canDelete` 不在這裡** —— 那是
 * `item.abilities`。這裡只有「新增鈕出不出現」與各模組自己的頁內開關。
 */
export interface DemoModulePermissions {
  view: string;
  create: string;
}

/** 進得去哪一頁、做得了什麼(`useDemoAccess` 算出來,兩層判斷分開問)。 */
export interface DemoAccess {
  /** 列表頁路由(回列表、儲存後導回);沒綁列表模組時為 null */
  listRoute: string | null;
  /** 詳情頁的模組路由(實際網址再接 `/<id>`);沒綁 → 不顯示「檢視」 */
  viewRoute: string | null;
  createRoute: string | null;
  editRoute: string | null;
  /** 新增鈕 = 有 `create` 權限 **且** 綁了新增頁(兩件事都成立才進得去) */
  canCreate: boolean;
  /** 持有某個權限 key(模組自有的頁內開關由設定物件自己查) */
  has: (permissionKey: string) => boolean;
}

/* ------------------------------------------------------------------ 列表頁 */

/** 下拉篩選器 / 選項欄位共用的選項形狀。 */
export interface DemoFilterOption {
  value: string;
  label: string;
}

/** 列表頁的篩選條件(存在網址 `?list=`,`DemoListPage` 經 `useUrlState` 讀寫;REACT-14)。 */
export interface DemoListFilters {
  page: number;
  /** 搜尋框;空字串 = 不篩 */
  keyword: string;
  /** 模組自有下拉篩選器的值;沒有 `Filters` 時恆為 null */
  option: DemoFilterOption | null;
}

/** `useRows` 要回的東西(共用元件只看得到這些)。 */
export interface DemoRows<Row> {
  rows: readonly Row[];
  totalCount: number;
  isLoading: boolean;
  /** 寫入成功後重查這一頁(DATA-02 / 04:只失效當前這份清單) */
  invalidate: () => Promise<void>;
}

/** 工具列上模組自有的篩選器(示範模組1 的分類 `Autocomplete`)。 */
export interface DemoFiltersProps {
  value: DemoFilterOption | null;
  onChange: (value: DemoFilterOption | null) => void;
}

/**
 * 列表的一欄。`key` 同時是 i18n 的 `<ns>.columns.<key>` 與 `TableColumn.key`。
 *
 * 不給 `render` 時由共用表格按 key 處理:`name` 是文字、`enabled` 是啟用標籤、
 * `actions` 是列操作(檢視 / 編輯 / 刪除),其餘 key 顯示「—」。
 */
export interface DemoColumn<Row> {
  key: string;
  width?: number;
  /** 主要識別欄(`Table` 的 `isEmphasized`) */
  isEmphasized?: boolean;
  render?: (row: Row, t: DemoTranslator) => ReactNode;
}

export interface DemoListConfig<Row extends DemoItemLike> {
  /** 每頁筆數(api 的 `pageSize` 上限 100) */
  pageSize: number;
  /** 表格最小寬度(STYLE-11:欄位不折行的合理寬度) */
  tableMinWidth: number;
  columns: readonly DemoColumn<Row>[];
  /** 讀清單:設定物件把 codegen 的清單 hook 包成這一個(見 `useDemoRows`) */
  useRows: (filters: DemoListFilters) => DemoRows<Row>;
  /** 模組自有的篩選器;不給就只有搜尋框 */
  Filters?: ComponentType<DemoFiltersProps>;
}

/* ------------------------------------------------------------------ 詳情頁 */

/** `useItem` 要回的東西。 */
export interface DemoItemResult<Detail> {
  item: Detail | null;
  isLoading: boolean;
  error: unknown;
}

/**
 * 詳情頁的一列欄位。`key` 是 i18n 的 `<ns>.fields.<key>`。
 *
 * `isVisible` 就是**欄位級權限**的接縫:沒有 `show-internal-note` 時整列不渲染
 * (不是顯示空值 —— 值是 null 也可能只是沒填,拿值去猜權限是錯的)。
 */
export interface DemoDetailField<Detail> {
  key: string;
  isVisible?: (access: DemoAccess, item: Detail) => boolean;
  render: (item: Detail, t: DemoTranslator) => ReactNode;
}

export interface DemoDetailConfig<Detail extends DemoItemLike> {
  /** 讀單筆(詳情頁與編輯頁共用;見 `useDemoItem`) */
  useItem: (id: string, isEnabled: boolean) => DemoItemResult<Detail>;
  fields: readonly DemoDetailField<Detail>[];
}

/* ------------------------------------------------ 新增 / 編輯(共版型) */

/** 表單欄位在畫面上的三態(示範模組1 的內部備註就是這個的示範)。 */
export type DemoFieldMode = "hidden" | "readonly" | "editable";

/**
 * 上傳完成的一個檔案:物件路徑 + 選檔時就知道的原始檔名 / 大小 / 檔型
 * (`File.name` / `File.size` / `File.type`)。要不要把後三者送給 api 由設定物件決定。
 */
export interface DemoUploadedFile {
  path: string;
  name: string;
  size: number;
  contentType: string;
}

/**
 * 這次送出時各上傳欄的結果,以 `DemoUpload.key` 為鍵(GQL-06:input 只放使用者碰過的欄位):
 * 選了新檔 = 上傳完的 `DemoUploadedFile`、按了移除 = `null`(清空)、**沒動 = 鍵不存在**(不放進 input = 不動)。
 */
export type DemoUploadResults = Readonly<
  Partial<Record<string, DemoUploadedFile | null>>
>;

/** 判斷一個欄位的三態時看得到的東西。 */
export interface DemoFieldModeContext<Detail> {
  access: DemoAccess;
  /** 編輯情境(false = 新增) */
  isEdit: boolean;
  /**
   * 編輯的那一筆;新增為 null。**逐筆的「改不改得動」一律讀 `item.abilities`**
   * (api 已算好),只有新增情境才退回問操作者自己的權限集。
   */
  item: Detail | null;
}

/** 表單欄位 `render` 拿得到的東西(自訂欄位用)。 */
export interface DemoFormFieldContext<
  Detail,
  Values,
> extends DemoFieldModeContext<Detail> {
  values: Values;
  setValue: <Key extends keyof Values>(key: Key, value: Values[Key]) => void;
  /** 這個欄位上有沒有 api 回報的錯誤(`VALIDATION_FAILED` 的 `fields`) */
  hasError: (field: string) => boolean;
  /** 該欄位的錯誤說明;沒有錯誤時 undefined */
  helperText: (field: string) => string | undefined;
  /** `<ns>.form` */
  t: DemoTranslator;
  /** `<ns>.fields` */
  tFields: DemoTranslator;
  /** `<ns>`(狀態這類跨頁共用的字典在這一層) */
  tRoot: DemoTranslator;
  mode: DemoFieldMode;
}

/**
 * 表單的一個欄位。`key` 是 `Values` 的鍵,同時是 i18n 的 `<ns>.fields.<key>`
 * 與 api 回報錯誤時的欄位名 —— 三者同名,錯誤才標得回正確的欄位上。
 *
 * `mode` 是**欄位級權限的開關**:回 `hidden` 時整欄不渲染,而且設定物件的
 * `toCreateInput` 也不該把這個鍵放進 input(欄位一出現就要權限)。
 */
export interface DemoFormField<Detail, Values> {
  key: string & keyof Values;
  /** `text` 單行、`multiline` 多行、`custom` 由 `render` 自己畫 */
  kind: "text" | "multiline" | "custom";
  required?: boolean;
  width?: number;
  minRows?: number;
  /** 不給時一律 `editable` */
  mode?: (context: DemoFieldModeContext<Detail>) => DemoFieldMode;
  /** `readonly` 時欄位旁的說明(i18n 的 `<ns>.form.<key>`) */
  readonlyHintKey?: string;
  render?: (context: DemoFormFieldContext<Detail, Values>) => ReactNode;
}

/**
 * 一個上傳欄(ADR-0010 的雙路儲存)。封面走公開 bucket(有穩定網址可預覽),
 * 附件走私有 bucket(沒有可預覽的網址,既有檔案另起一行顯示檔名 + 移除)。
 */
export interface DemoUpload<Detail> {
  /** 欄位名(= `<ns>.fields.<key>`,也是 `DemoUploadResults` 的鍵) */
  key: string;
  purpose: UploadPurpose;
  accept: readonly string[];
  maxSize: number;
  /** i18n 的 `<ns>.form.<hintKey>` */
  hintKey: string;
  width?: number;
  /** 公開穩定網址(封面);私有檔案不給 */
  previewUrlOf?: (item: Detail) => string | null | undefined;
  previewLabelKey?: string;
  /** 私有檔案的既有檔名(附件);給了就多一行「目前的附件 + 移除」 */
  currentNameOf?: (item: Detail) => string | null;
  currentLabelKey?: string;
  removeLabelKey?: string;
}

/**
 * 表單上的特有區塊(slot)。**顯示與否由 slot 自己判斷**(回 null 即不顯示)——
 * 示範模組1 的填寫提示(新增頁 + `create-page.show-tips`)與變更歷程
 * (編輯頁 + `edit-page.show-history`)就是頁面自有權限的示範。
 */
export interface DemoFormSlots<Detail> {
  /** 標題下方 */
  top?: (context: DemoFieldModeContext<Detail>) => ReactNode;
  /** 表單底部、儲存 / 取消之上 */
  bottom?: (context: DemoFieldModeContext<Detail>) => ReactNode;
}

/** `useSave` 要回的東西。 */
export interface DemoSave<Values> {
  save: (values: Values, uploads: DemoUploadResults) => void;
  isPending: boolean;
}

export interface DemoSaveOptions<Detail> {
  /** 編輯的那一筆;新增為 null */
  item: Detail | null;
  onSuccess: () => void;
  onError: (error: unknown) => void;
}

export interface DemoFormConfig<Detail extends DemoItemLike, Values> {
  fields: readonly DemoFormField<Detail, Values>[];
  /** 沒有上傳欄就給空陣列(示範模組2) */
  uploads: readonly DemoUpload<Detail>[];
  /** 初始值;新增情境的 `item` 是 null */
  toValues: (item: Detail | null) => Values;
  /**
   * 送出:設定物件在這裡把表單值 + 各上傳欄的結果(`DemoUploadResults`)轉成該模組的 input 並呼叫 create / update。
   * 共用元件不認得任何模組的 input 型別。
   */
  useSave: (options: DemoSaveOptions<Detail>) => DemoSave<Values>;
  slots?: DemoFormSlots<Detail>;
}

/* ------------------------------------------------------------------ 刪除 */

/**
 * 刪除的 mutation hook。兩支示範模組的 input 同形(`{ id }`),所以這一個直接收
 * codegen 的 hook,不必再包一層。
 */
export type DemoDeleteHook = (
  client: GraphQLClient,
  options?: {
    onSuccess?: () => void;
    onError?: (error: unknown) => void;
  },
) => {
  mutate: (variables: { input: { id: string } }) => void;
  isPending: boolean;
};

/* ------------------------------------------------- 啟用 / 停用(選配) */

/**
 * 切換啟用 / 停用的 mutation hook(**選配**)。形狀比照 `useDelete`:兩支示範模組的 input
 * 同形(`{ id, enabled }`),所以直接收 codegen 的 hook,不必再包一層。
 *
 * **不給 = 這個模組沒有啟用 / 停用**,列表的 `enabled` 欄維持唯讀 Tag(理由:
 * 未來的模組不一定有這個欄位,共版型不強迫)。給了也不代表每一列都切得動 —— 開關只在
 * **那一列的 `abilities.canEdit` 為真**時出現,改不動的列仍然是 Tag(逐列的能力一律讀 api)。
 */
export type DemoSetEnabledHook = (
  client: GraphQLClient,
  options?: {
    onSuccess?: () => void;
    onError?: (error: unknown) => void;
  },
) => {
  mutate: (variables: { input: { id: string; enabled: boolean } }) => void;
  isPending: boolean;
};

/* ------------------------------------------------------------------ 總表 */

export interface DemoModuleConfig<
  Row extends DemoItemLike,
  Detail extends DemoItemLike,
  Values,
> {
  moduleKeys: DemoModuleKeys;
  permissions: DemoModulePermissions;
  /** i18n 的第二層 key(I18N-02);三頁共用同一個 namespace */
  i18nNamespace: string;
  list: DemoListConfig<Row>;
  detail: DemoDetailConfig<Detail>;
  form: DemoFormConfig<Detail, Values>;
  /** 刪除(列表與詳情共用同一個確認彈窗與端點) */
  useDelete: DemoDeleteHook;
  /**
   * 切換啟用 / 停用(**選配**)。不給 = 這個模組沒有啟用 / 停用,列表的 `enabled` 欄維持唯讀 Tag。
   */
  useSetEnabled?: DemoSetEnabledHook;
}
