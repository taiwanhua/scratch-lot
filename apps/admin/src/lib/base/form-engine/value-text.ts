import {
  DEFAULT_TENANT_TIMEZONE,
  type FieldDef,
  formatTemporal,
  optionLabelOf,
} from "@repo/domain/form";

import { isRedactedValue } from "./definition";

/**
 * 值 → 顯示文字(`renderValue(ctx)` 的純函式部分;元件在 `components/base/form-engine/FormValue.tsx`)。
 *
 * 顯示名(`docs/concepts/form-engine.md`「顯示名:labelTemplate 與頁籤模板」):
 * - 靜態選項 → 該筆綁的那一版定義裡的 label
 * - 類別 / lookup 選項、引用 → api 的 `displayValues`(來源還在且讀者有權 → 現名;
 *   否則快照 label + 「(來源不可用)」)
 * - `allowCustom` 自訂值 → 直接顯示存下的 label
 */
export interface FormDisplayItemLike {
  value: string;
  label?: string | null;
  available: boolean;
}

export interface FormValueRenderContext {
  field: FieldDef;
  value: unknown;
  /** 這一欄的 `displayValues[].items`(只有類別 / lookup 選項與引用欄有) */
  display?: readonly FormDisplayItemLike[];
  /** 「—」「是 / 否」「(來源不可用)」由呼叫端取好(REACT-13:ctx 不帶翻譯函式) */
  text: { empty: string; yes: string; no: string; unavailable: string };
  /** 上傳欄的下載(詳情頁給;列表不給就只顯示檔名) */
  onDownload?: (field: FieldDef) => void;
  /**
   * 日期 / 日期時間欄的顯示時區(讀者的租戶時區;列表這種逐列不同的由呼叫端給)。
   * 元件端(`FormValue`)沒給時由 `useTemporalText` 補讀者的租戶時區;本檔的純函式沒給時用預設時區。
   */
  timezone?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 純量轉字串;物件、陣列、空值一律空字串(不讓 `[object Object]` 上畫面)。 */
export const scalarText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** 選項 / 引用值的識別:引用比 id、選項比 value、靜態選項本身就是字串。 */
export const identityOf = (item: unknown): string =>
  isRecord(item) ? scalarText(item.id ?? item.value) : scalarText(item);

/** 上傳欄的檔名。 */
export const uploadNameOf = (value: unknown): string =>
  isRecord(value) ? scalarText(value.name) : "";

const definitionLabelOf = (field: FieldDef, item: unknown): string => {
  const label = optionLabelOf({ ...field, type: "select" }, item);
  return typeof label === "string" ? label : identityOf(item);
};

/** 一個選項 / 引用值的顯示文字(先看 `displayValues`,再看存值自己帶的 label,最後看靜態定義)。 */
const itemText = (ctx: FormValueRenderContext, item: unknown): string => {
  const id = identityOf(item);
  const shown = ctx.display?.find((entry) => entry.value === id);
  if (shown !== undefined) {
    const label = shown.label ?? id;
    return shown.available ? label : `${label}${ctx.text.unavailable}`;
  }
  const own = isRecord(item) ? scalarText(item.label) : "";
  return own === "" ? definitionLabelOf(ctx.field, item) : own;
};

export const isEmptyDisplay = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  value === "" ||
  (Array.isArray(value) && value.length === 0) ||
  isRedactedValue(value);

export const displayTextOf = (ctx: FormValueRenderContext): string => {
  const { field, value, text } = ctx;
  if (isEmptyDisplay(value)) {
    return text.empty;
  }
  let result = scalarText(value);
  switch (field.type) {
    case "boolean": {
      result = value === true ? text.yes : text.no;
      break;
    }
    case "number": {
      const unit = scalarText(field.widget.unit);
      result = unit === "" ? result : `${result} ${unit}`;
      break;
    }
    case "select":
    case "reference": {
      result = itemText(ctx, value);
      break;
    }
    case "multiSelect": {
      result = (Array.isArray(value) ? value : [value])
        .map((item) => itemText(ctx, item))
        .join("、");
      break;
    }
    case "upload": {
      result = uploadNameOf(value);
      break;
    }
    case "date":
    case "datetime": {
      // 時點(ISO)→ 那個時區的 `YYYY-MM-DD` / `YYYY-MM-DD HH:mm`
      result = formatTemporal(value, {
        type: field.type,
        timezone: ctx.timezone ?? DEFAULT_TENANT_TIMEZONE,
      });
      break;
    }
    default: {
      break;
    }
  }
  return result === "" ? text.empty : result;
};
