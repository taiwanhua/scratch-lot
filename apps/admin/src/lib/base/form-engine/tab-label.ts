import {
  DEFAULT_TENANT_TIMEZONE,
  type FieldDef,
  type FormDefinition,
  type StoredValues,
  type TemporalType,
  formatTemporal,
  renderTemplate,
  templatePlaceholdersOf,
  templateTextOf,
  valuePlaceholderKeyOf,
} from "@repo/domain/form";

/**
 * 頁籤 / 標題模板(Spec 6a §4 `forms.tabLabelTemplate`、§8「其他」):模組層模板,表單的 `tabLabelTemplate` 可覆寫。
 * **前端從那筆資料的欄位值即時算**(不讀後端存的 `summary`):摘要槽依那筆綁的版本 `summaryMap` 對到欄位取值,
 * 草稿與新增 / 編輯頁用正在輸入的值。所有頁(表單模組新增 / 編輯 / 檢視、申請中心詳情)走 `renderTabLabel`。
 *
 * 佔位符:摘要槽 `{{title}}` / `{{date}}` / `{{amount}}`、欄位 `{{value.<欄位key>}}`、系統 `{{applicant}}`(建立者現名)/
 * `{{form}}`(表單名)/ `{{module}}`(模組名)/ `{{action}}`(檢視 / 編輯 / 新增)。
 * 值的格式化同 `templateTextOf`:選項印 label、日期 / 日期時間依**讀者現在的租戶時區**(`formatTemporal`;
 * 修訂的 `ctx.timezone` 只用於重算條件,不用於顯示)、數字照 `precision`。
 * **`{{action}}` 沒寫時自動加在最前面**(「檢視・王小明的病假單」;組法在字典 `admin.formEngine.pages.tabLabelWithAction`,
 * 呼叫端以 `joinAction` 帶進來);有寫就照模板位置。
 */

/** 模組層的預設模板:登記表單模組時(`forms` 的 `options.tabLabelTemplate`)沒給就用它。 */
export const DEFAULT_TAB_LABEL_TEMPLATE = "{{title}}";

/** 模板可用的固定佔位符(依設定畫面列出的順序);欄位值另有 `{{value.<欄位key>}}`。 */
export const TAB_LABEL_PLACEHOLDERS = [
  "title",
  "date",
  "amount",
  "applicant",
  "form",
  "module",
  "action",
] as const;

export type TabLabelPlaceholder = (typeof TAB_LABEL_PLACEHOLDERS)[number];

/** 頁面種類(`{{action}}`)。 */
export type TabLabelAction = "view" | "edit" | "create";

/** 欄位值佔位符的寫法(設定畫面插入用)。 */
export const valuePlaceholderOf = (fieldKey: string): string =>
  `{{value.${fieldKey}}}`;

/** 表單有自己的模板就用它,否則用模組層的。 */
export const tabLabelTemplateOf = (
  moduleTemplate: string,
  formTemplate: string | null | undefined,
): string =>
  formTemplate !== null &&
  formTemplate !== undefined &&
  formTemplate.trim() !== ""
    ? formTemplate
    : moduleTemplate;

export interface ApplyTabLabelOptions {
  /** 頁面種類的顯示文字(「檢視」),`{{action}}` 用它,模板沒寫時自動加在最前面 */
  action: string;
  /** 模板沒寫 `{{action}}` 時把頁面種類接在最前面(字典的 ICU 訊息,I18N-03:分隔符不寫死在程式) */
  joinAction: (action: string, label: string) => string;
  /** 套出來是空的時改用它(表單名) */
  fallback?: string | null;
}

/**
 * 套模板的底層:`resolve(佔位符名稱)` 取值(不認得的回 null / undefined → 空字串)。
 * 套出來是空的 → `fallback`;都沒有 → null(呼叫端的頁籤先維持模組名)。
 */
export const applyTabLabelTemplate = (
  template: string,
  resolve: (name: string) => string | null | undefined,
  { action, joinAction, fallback }: ApplyTabLabelOptions,
): string | null => {
  const hasAction = templatePlaceholdersOf(template).includes("action");
  const rendered = renderTemplate(template, (name) =>
    name === "action" ? action : resolve(name),
  );
  const body = rendered === "" ? (fallback ?? "").trim() : rendered;
  if (body === "") {
    return null;
  }
  return hasAction || action === "" ? body : joinAction(action, body);
};

/** 算一筆頁籤要的資料。 */
export interface TabLabelContext {
  /** 那一筆的存值(草稿 / 新增 / 編輯頁 = 正在輸入的值) */
  values: StoredValues | null | undefined;
  /** 那一筆綁的版本定義(還沒載到 = 摘要槽與欄位值都空) */
  definition: Pick<FormDefinition, "fields" | "summaryMap"> | null | undefined;
  formName?: string | null;
  moduleName?: string | null;
  /** 建立者現名 */
  applicantName?: string | null;
  /** 頁面種類的顯示文字(「檢視」/「編輯」/「新增」;空字串 = 不加) */
  action: string;
  /** 模板沒寫 `{{action}}` 時把頁面種類接在最前面(字典的 ICU 訊息) */
  joinAction: (action: string, label: string) => string;
  /** 日期 / 日期時間的顯示時區 = 讀者現在的租戶時區(沒給 = 預設租戶時區) */
  timezone?: string | null;
  /** `summaryMap.date` 沒對欄位時 `{{date}}` 用的送出時間(ISO;草稿沒有) */
  submittedAt?: string | null;
  /** 是 / 否欄的文字 */
  booleanText?: { yes: string; no: string };
}

/**
 * 摘要槽「日期」的顯示型別:`summaryMap.date` 對到日期欄 → `date`(印 `YYYY-MM-DD`);
 * 對到日期時間欄、沒對(= 送出時間)或定義還沒載到 → `datetime`(印到分鐘)。
 */
export const summaryDateTypeOf = (
  definition: Pick<FormDefinition, "fields" | "summaryMap"> | null | undefined,
): TemporalType =>
  definition?.fields.find((field) => field.key === definition.summaryMap.date)
    ?.type === "date"
    ? "date"
    : "datetime";

const SUMMARY_SLOTS = new Set(["title", "date", "amount"]);

/** 以一筆的值算頁籤 / 標題(規則見檔頭);套出來是空的退回表單名。 */
export const renderTabLabel = (
  template: string,
  context: TabLabelContext,
): string | null => {
  const timezone = context.timezone ?? DEFAULT_TENANT_TIMEZONE;
  const byKey = new Map<string, FieldDef>(
    (context.definition?.fields ?? []).map((field) => [field.key, field]),
  );
  const fieldText = (fieldKey: string | null | undefined): string => {
    const field =
      fieldKey === null || fieldKey === undefined
        ? undefined
        : byKey.get(fieldKey);
    if (field === undefined) {
      return "";
    }
    return templateTextOf(field, context.values?.[field.key], {
      timezone,
      ...context.booleanText,
    });
  };
  const slotText = (slot: "title" | "date" | "amount"): string => {
    const fieldKey = context.definition?.summaryMap[slot];
    if (slot === "date" && !fieldKey && context.submittedAt) {
      return formatTemporal(context.submittedAt, {
        type: "datetime",
        timezone,
      });
    }
    return fieldText(fieldKey);
  };
  const system: Record<string, string | null | undefined> = {
    applicant: context.applicantName,
    form: context.formName,
    module: context.moduleName,
  };
  return applyTabLabelTemplate(
    template,
    (name) => {
      const valueKey = valuePlaceholderKeyOf(name);
      if (valueKey !== null) {
        return fieldText(valueKey);
      }
      if (SUMMARY_SLOTS.has(name)) {
        return slotText(name as "title" | "date" | "amount");
      }
      return system[name];
    },
    {
      action: context.action,
      joinAction: context.joinAction,
      fallback: context.formName,
    },
  );
};
