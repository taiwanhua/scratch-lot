import {
  type ExpressionContext,
  type FieldDef,
  type FormDefinition,
  type StoredValues,
  evaluateCondition,
  fieldProtections,
  isProtected,
  semanticValuesOf,
  settleHidden,
} from "@repo/domain/form";

import { isRedactedValue } from "./definition";

/**
 * `FormRenderer` 的五種模式(Spec 6a §8「設計模式 vs 預覽」):
 *
 * | mode              | 條件 / 計算                                            | 權限     | 值           |
 * | ----------------- | ------------------------------------------------------ | -------- | ------------ |
 * | `design`          | 不跑,只標示                                           | 不套     | 不輸入       |
 * | `preview`         | 前端即時算(`previewFormVersion` 另以後端為準)       | 不套     | 測試值       |
 * | `create` / `edit` | 條件與計算即時算                                       | 套       | 真實值       |
 * | `readonly`        | 只重算顯示 / 唯讀條件(用該修訂的 `ctx`),不重算存值 | 套(讀者)| 存值         |
 */
export const FORM_RENDERER_MODES = [
  "create",
  "edit",
  "readonly",
  "design",
  "preview",
] as const;

export type FormRendererMode = (typeof FORM_RENDERER_MODES)[number];

/**
 * 一欄在畫面上的狀態 —— 欄位級三態(看不到 / 唯讀 / 可填)再加上條件:
 * - `visible` false:不渲染(`visibleWhen` 算出 false,或讀者沒有 show)
 * - `readonly`:顯示但不能改(計算 / 固定值、沒有欄位級 edit、`readonlyWhen` 成立、唯讀模式)
 */
export interface FieldUiState {
  visible: boolean;
  readonly: boolean;
  /** 讀者沒有 show(受保護欄位,含只因依賴而受保護的計算欄位) */
  redacted: boolean;
  /** 為什麼唯讀(畫面附說明用);可填時為 null */
  readonlyReason: "computed" | "permission" | "condition" | "mode" | null;
}

export interface FieldPermissionFacts {
  /** 讀得到這欄嗎(受保護欄位要 show;依賴鏈上的每一個也要) */
  canShow: (fieldKey: string) => boolean;
  /** 權限層面改得動這欄嗎(api 的 `abilities.canEditField`,或新增前由權限推得) */
  canEdit: (fieldKey: string) => boolean;
}

/** 不套權限的模式(設計、預覽)用:全部看得到、改得動。 */
export const OPEN_PERMISSIONS: FieldPermissionFacts = {
  canShow: () => true,
  canEdit: () => true,
};

export interface ResolveFormStateInput {
  definition: Pick<FormDefinition, "fields">;
  values: StoredValues;
  ctx: ExpressionContext;
  mode: FormRendererMode;
  permissions: FieldPermissionFacts;
  /**
   * 後端算的結果(預覽的 `previewFormVersion`):有就**以後端為準** —— 計算 / 固定值欄位用它的值,
   * 顯示 / 唯讀條件用它的 `fieldStates`(Spec 6a §8「設計模式 vs 預覽」)。
   */
  serverState?: ServerFormState | null;
}

/** 後端回的值與欄位狀態(`previewFormVersion` 的 `values` / `fieldStates`)。 */
export interface ServerFormState {
  values: StoredValues;
  fieldStates: readonly { key: string; visible: boolean; readonly: boolean }[];
}

export interface ResolvedFormState {
  /** 畫面要顯示的值:`create` / `edit` / `preview` 已算好計算與固定值欄位;`readonly` 是存值原樣 */
  values: StoredValues;
  states: ReadonlyMap<string, FieldUiState>;
}

const safeCondition = (
  expr: FieldDef["visibleWhen"],
  input: Parameters<typeof evaluateCondition>[1],
  fallback: boolean,
): boolean => {
  if (expr === undefined || expr === null) {
    return fallback;
  }
  try {
    return evaluateCondition(expr, input);
  } catch {
    // 形狀錯誤由檢查器擋;執行期算不出來就當條件不成立(不隱藏、不鎖)
    return fallback;
  }
};

const isDerived = (field: FieldDef): boolean =>
  field.valueSource.kind === "computed" ||
  field.valueSource.kind === "constant";

/**
 * 依模式算出每一欄的狀態與要顯示的值(純函式;`FormRenderer` 與測試共用)。
 *
 * - `design`:不跑條件與計算,全部顯示、全部不可輸入
 * - `readonly`:**不重算、不清空**存值,只用傳進來的 `ctx`(該修訂的)重算顯示 / 唯讀條件
 * - 其餘:條件與計算一起收斂(`settleHidden`,與 api 寫入同一條):被顯示條件隱藏的欄位在計算輸入裡
 *   當 null(明細整欄 null、彙總視為空),隱藏的計算欄位也是 null;條件以收斂後的值算。
 *   只替換計算輸入,不清使用者的值:隱藏再顯示,原本填的值照舊回來(`onChange` 以傳入的 `values` 為底)
 */
export const resolveFormState = ({
  definition,
  values,
  ctx,
  mode,
  permissions,
  serverState = null,
}: ResolveFormStateInput): ResolvedFormState => {
  const { fields } = definition;
  const protections = fieldProtections(fields);
  const canShowField = (field: FieldDef): boolean => {
    // api 依讀者投影過的定義(`formRuntimeVersion` 的骨架)或值(`"[redacted]"`)為準
    if (field.redacted === true || isRedactedValue(values[field.key])) {
      return false;
    }
    return (
      !isProtected(protections.get(field.key)) || permissions.canShow(field.key)
    );
  };

  if (mode === "design") {
    return {
      values,
      states: new Map(
        fields.map((field) => [
          field.key,
          {
            visible: true,
            readonly: true,
            redacted: false,
            readonlyReason: "mode",
          },
        ]),
      ),
    };
  }

  const settled =
    mode === "readonly" ? values : settleHidden(fields, { values, ctx }).values;
  const fromServer = Object.fromEntries(
    fields
      .filter((field) => isDerived(field) && serverState !== null)
      .map((field) => [field.key, serverState?.values[field.key] ?? null]),
  );
  const shown: StoredValues = { ...settled, ...fromServer };
  const serverStates = new Map(
    (serverState?.fieldStates ?? []).map((state) => [state.key, state]),
  );
  const conditionInput = {
    values: semanticValuesOf(fields, shown),
    ctx,
    fields,
    stored: shown,
  };

  const states = new Map<string, FieldUiState>();
  for (const field of fields) {
    const redacted = !canShowField(field);
    const server = serverStates.get(field.key);
    const visible =
      !redacted &&
      (server?.visible ??
        safeCondition(field.visibleWhen, conditionInput, true));
    const byCondition =
      server?.readonly ??
      safeCondition(field.readonlyWhen, conditionInput, false);
    let readonlyReason: FieldUiState["readonlyReason"] = null;
    if (mode === "readonly") {
      readonlyReason = "mode";
    } else if (isDerived(field)) {
      readonlyReason = "computed";
    } else if (!permissions.canEdit(field.key)) {
      readonlyReason = "permission";
    } else if (byCondition) {
      readonlyReason = "condition";
    }
    states.set(field.key, {
      visible,
      readonly: readonlyReason !== null,
      redacted,
      readonlyReason,
    });
  }
  return { values: shown, states };
};
