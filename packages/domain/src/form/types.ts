/**
 * 表單定義的型別(`form_versions` 一版的內容;語意正本見 Spec 6a §4、§5 與 `docs/data-model.md`)。
 * 純型別,前後端共用:api 存取與驗證、admin 設計器與渲染器都吃同一份。
 */

/**
 * 欄位資料型別:決定**存什麼**(畫法由 `widget.kind` 決定;分區標題不是欄位,在 Layout 裡)。
 * `array` = 明細列:一個欄位裝多列同結構的子欄位(`columns`),存列的陣列。
 */
export const FIELD_TYPES = [
  "text",
  "multiline",
  "number",
  "date",
  "datetime",
  "select",
  "multiSelect",
  "boolean",
  "upload",
  "reference",
  "array",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** JSONLogic 樹(存 JSON;設計器用選單產生,不做文字輸入)。 */
export type Expression =
  | string
  | number
  | boolean
  | null
  | Expression[]
  | { [operator: string]: Expression };

/**
 * 表達式的上下文(`ctx.*`):草稿用真正的現在與填寫者;歷史檢視由 `revisions[r].ctx` 轉來,
 * 不拿讀者現在的身分或時間補值(Spec §5「歷史檢視的上下文」)。
 */
export interface ExpressionContext {
  /** ISO 8601 時間字串。 */
  now: string;
  /** IANA 時區(租戶時區),`dateDiff` 以它的日曆日計。 */
  timezone: string;
  user: { id: string | null; orgId: string | null };
}

/** lookup 來源描述(`options.source`、`prefills[].source`、`reference` 的 `source`)。 */
export interface LookupSourceDescriptor {
  /** 登錄表(`apps/api/src/forms/lookup-providers.ts`)的 key。 */
  provider: string;
  /** 顯示欄(必須在 provider 可回的欄位內);`labelTemplate` 有值時只當退路。 */
  labelField: string;
  /**
   * 顯示模板(選填):佔位符 = provider 可回的欄位(`{{name}}`、`{{email}}`;`form_submission` 為摘要槽
   * `{{title}}` / `{{date}}` / `{{amount}}` + `{{value.<欄位key>}}`),`formLookup` 在後端組好 label。
   * 沒填(缺席 / null / 空字串)= 用 `labelField`。
   */
  labelTemplate?: string | null;
  /** 值欄,`options` 用;預設 `id`。 */
  valueField?: string;
  /** 固定條件(provider 允許的欄位 = 值),後端套。 */
  filter?: Record<string, unknown>;
  /** 只有 `provider = "form_submission"` 要:查哪張表單的提交。 */
  formKey?: string;
  /** `form_submission` 用,預設 true:只列已完成。 */
  completedOnly?: boolean;
}

export interface StaticOptionItem {
  value: string;
  label: string;
  order: number;
  enabled: boolean;
}

/** select / multiSelect 的選項,三種來源擇一。 */
export type FieldOptions =
  | { kind: "static"; items: StaticOptionItem[] }
  | { kind: "fieldCategory"; key: string }
  | { kind: "lookup"; source: LookupSourceDescriptor };

export type ValueSource =
  | { kind: "input" }
  | { kind: "computed"; expr: Expression }
  | { kind: "constant"; value: unknown };

/** 免寫正則的內建格式(與 `pattern` 二擇一)。 */
export const TEXT_FORMATS = ["email", "phone", "url"] as const;

export type TextFormat = (typeof TEXT_FORMATS)[number];

export interface FieldRules {
  /** `array` 的必填 = 至少一列(空白列也算一列)。 */
  required?: boolean;
  /** 只有 `array`:列數下限(非負整數,預設 0)。 */
  minRows?: number;
  /** 只有 `array`:列數上限(非負整數,預設 `DEFAULT_ARRAY_MAX_ROWS`,不超過 `MAX_ARRAY_ROWS`)。 */
  maxRows?: number;
  /** number:數值(decimal 字串或數字);date / datetime:帶時區的 ISO 8601(date = 當地 00:00 的時點)。 */
  min?: number | string;
  max?: number | string;
  minLength?: number;
  maxLength?: number;
  /** JS `RegExp` 語法,固定 `u` flag,長度 ≤ 200,須搭 `patternMessage`。 */
  pattern?: string;
  patternMessage?: string;
  format?: TextFormat;
  /** 只有 `autocomplete` / `autocompleteMulti` 可開。 */
  allowCustom?: boolean;
  /** 表達式,成立才通過(回 false 即錯)。 */
  custom?: Expression;
  /** `custom` 不成立時顯示的錯誤訊息;沒填用預設文字「X 不符合規則」。 */
  customMessage?: string;
  /**
   * 只有 `upload`:允許的檔型(MIME,如 `application/pdf`、`image/png`);不設 = 平台允許的全部。
   * 必須是平台上傳政策允許的檔型之一(`FORM_UPLOAD_CONTENT_TYPES`),只能收窄。
   */
  accept?: readonly string[];
  /** 只有 `upload`:單檔大小上限(MB);不設 = 平台上限(`FORM_UPLOAD_MAX_SIZE_MB`),只能調小。 */
  maxSizeMb?: number;
}

export interface FieldWidget {
  /** admin 元件登錄表的 key。 */
  kind: string;
  /** 只管長相的設定(`unit`、`placeholder`、`rows`…)。 */
  [setting: string]: unknown;
}

export interface FieldPermission {
  /** true = 受保護欄位,發布時建 `show-<formKey>-<fieldKey>`。 */
  show: boolean;
  /** true = 發布時建 `edit-<formKey>-<fieldKey>`。 */
  edit: boolean;
}

/**
 * 欄位預設值(Spec §5「預設值」):只有 `valueSource.kind = "input"` 的欄位有。
 * - `constant`:固定值(存值形狀同該型別;單選 / 多選 = 選項值,靜態選項存 `value`、類別 / lookup 存 `{ value, label }`)
 * - `expression`:公式,根節點型別 = 欄位型別;`reference` 只能 `ctx.user.id` / `ctx.user.orgId`
 *
 * 新增草稿時算一次;使用者沒碰過(`touched[]` 沒有它)前,依賴的欄位變了前端會重算。
 */
export type FieldDefault =
  | { kind: "constant"; value: unknown }
  | { kind: "expression"; expr: Expression };

/** 明細列子欄可用的型別(白名單;不支援巢狀 `array`、多行、多選、上傳)。 */
export const ARRAY_COLUMN_TYPES = [
  "text",
  "number",
  "date",
  "datetime",
  "select",
  "boolean",
  "reference",
] as const;

export type ArrayColumnType = (typeof ARRAY_COLUMN_TYPES)[number];

/**
 * 明細列的一個子欄(簡化的 FieldDef;結構上可當 `FieldDef` 用,值的正規化與規則驗證共用同一套):
 * - `valueSource` 只有使用者填或列內公式(`{ "var": "row.<子欄 key>" }` 引用同一列的子欄)
 * - 沒有子欄級權限、顯示 / 鎖定條件、預設值(整欄的設定套在明細欄上)
 * - `reference`:存 `{ id, label }` 快照(同表單層引用欄),只能使用者填;`source` 必填
 * - `width`:表格欄的最小寬(px);手機卡片忽略
 */
export interface ArrayColumnDef {
  key: string;
  label: string;
  type: ArrayColumnType;
  /** 只有 number:小數位數 0–6。 */
  precision?: number;
  widget: FieldWidget;
  valueSource: { kind: "input" } | { kind: "computed"; expr: Expression };
  /** 只有 select:靜態清單或欄位管理類別(沒有 lookup)。 */
  options?: FieldOptions | null;
  /** 只有 reference:lookup 來源描述(同表單層引用欄的 `source`)。 */
  source?: LookupSourceDescriptor | null;
  rules?: FieldRules | null;
  help?: string | null;
  width?: number | null;
}

/** 明細列一列的存值:`rowId`(前端產生的穩定 id)+ 各子欄的存值。 */
export interface ArrayRowValue {
  rowId: string;
  [columnKey: string]: unknown;
}

/** `form_versions.fields[]` 的一筆。 */
export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** 只有 number:小數位數 0–6。 */
  precision?: number;
  widget: FieldWidget;
  valueSource: ValueSource;
  options?: FieldOptions | null;
  rules?: FieldRules | null;
  visibleWhen?: Expression;
  readonlyWhen?: Expression;
  /** 預設值(只有使用者填的欄位;`upload` 沒有)。 */
  default?: FieldDefault | null;
  permission?: FieldPermission | null;
  help?: string | null;
  /** 只有 `reference`:lookup 來源描述。 */
  source?: LookupSourceDescriptor | null;
  /** 只有 `array`:子欄定義(至少一個)。 */
  columns?: ArrayColumnDef[] | null;
  /**
   * 只出現在執行端讀到的定義(`formRuntimeVersion`):讀者讀不到這一欄時為 true,
   * 此時只剩骨架(key / label / type / `widget.kind` / `valueSource.kind` / `permission`),
   * 內容(固定值、公式、選項、規則、說明)已省略。設計端的定義沒有這個欄位。
   */
  redacted?: boolean;
}

export interface LayoutCol {
  fieldKey: string;
  /** 12 格制,桌機的寬度。 */
  span: number;
}

export interface LayoutRow {
  cols: LayoutCol[];
}

/**
 * 版面區塊(分區)。收合三個設定都是選填:舊定義沒有這三欄 = 不可收合、一律展開(照舊渲染);
 * 收合狀態的記憶不在定義裡,由 admin 依使用者存在瀏覽器(頁面 id `form:<formKey>`、區塊 key = `key`)。
 */
export interface LayoutSection {
  key: string;
  title: string;
  rows: LayoutRow[];
  /** 可以收合(標題列可點);不給 = false */
  collapsible?: boolean;
  /** 預設收合(使用者沒改過時的狀態;只在 `collapsible` 時生效);不給 = false */
  defaultCollapsed?: boolean;
  /** 收合時標題列顯示的欄位(依序,須是放在本分區的非明細欄位;只在 `collapsible` 時生效);不給 = 不顯示 */
  summaryFieldKeys?: string[];
}

export interface Layout {
  sections: LayoutSection[];
}

/** 摘要槽 → 欄位 key;`title` 必填,`date` 不對 = 用送出時間,`amount` 選填。 */
export interface SummaryMap {
  title?: string | null;
  date?: string | null;
  amount?: string | null;
}

export type SummarySlot = keyof SummaryMap;

export interface PrefillMapping {
  sourceField: string;
  fieldKey: string;
}

export interface Prefill {
  label: string;
  source: LookupSourceDescriptor;
  mapping: PrefillMapping[];
}

/** 一版表單定義(`form_versions` 裡檢查器與計算要的四塊)。 */
export interface FormDefinition {
  fields: FieldDef[];
  layout: Layout;
  summaryMap: SummaryMap;
  prefills: Prefill[];
}

/** `values` 的一格(存的值;形狀依型別,見 Spec §5「值的存法」)。 */
export type StoredValues = Record<string, unknown>;
