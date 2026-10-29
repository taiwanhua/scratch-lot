import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import {
  type ExpressionContext,
  type FieldDef,
  type ProviderDefaultOf,
  type StoredValues,
  defaultDependenciesOf,
  filterVarValueOf,
  isProviderDefault,
  providerDefaultSourceOf,
} from "@repo/domain/form";
import { useFormLookupDefaultQuery } from "@repo/graphql";

import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import type { FieldPermissionFacts } from "@/lib/base/form-engine/field-states";
import {
  type ClearedLink,
  clearLinkedReferences,
  linkedReferencesOf,
} from "@/lib/base/form-engine/filter-links";
import {
  changedKeysOf,
  withDefaults,
} from "@/lib/base/form-engine/form-defaults";

export interface FillValuesOptions {
  fields: readonly FieldDef[];
  initialValues: StoredValues;
  /** 使用者碰過的欄位(草稿存下的 `touched[]`;新增為空) */
  initialTouched?: readonly string[];
  ctx: ExpressionContext;
  permissions: FieldPermissionFacts;
  /**
   * 預設值要不要跟著依賴重算:新增、以及還沒送出過的草稿要;
   * 已送出過的單(已完成、被退回、撤回)不再動使用者的值
   */
  recomputeDefaults: boolean;
  /** 一打開就先填預設值(新增頁、設計器預覽);編輯既有草稿不用(api 建草稿時已填) */
  fillOnMount: boolean;
  systemLabels?: { user: string | null; org: string | null };
  /**
   * 引用欄「來源提供的預設」查哪張表單的哪一版(`formLookupDefault`;`version` 為 null = 草稿,設計器預覽)。
   * 不給就不查(那些欄位沒有預設值)
   */
  lookup?: { formKey: string; version: number | null };
}

export interface FillValues {
  values: StoredValues;
  /** 使用者碰過的欄位 key(存草稿時一併送出) */
  touched: readonly string[];
  /**
   * 使用者改了值(`FormRenderer` 的 onChange;帶入的 patch 也走這裡):改到的欄位記為碰過,再重算其餘預設值;
   * 連動篩選被引用欄位的值變了就清空依賴它的引用欄並提示(值變動的共同入口)
   */
  change: (next: StoredValues) => void;
}

/** 一個「來源提供的預設」查回來的值:`key` = 當時的條件(條件變了就要重查)。 */
interface ProvidedDefault {
  key: string;
  value: unknown;
}

type ProvidedDefaults = Readonly<Partial<Record<string, ProvidedDefault>>>;

const NONE_PROVIDED: ProvidedDefaults = {};

/** 來源提供的預設此刻的條件:條件值(`filterValues`)與比對用的 key;條件沒填齊為 null。 */
const providerQueryOf = (
  field: FieldDef,
  byKey: ReadonlyMap<string, FieldDef>,
  values: StoredValues,
): { key: string; filterValues: Record<string, unknown> } | null => {
  const valueOf = (fieldKey: string) =>
    filterVarValueOf(byKey.get(fieldKey), values[fieldKey]);
  const source = providerDefaultSourceOf(field, valueOf);
  if (source === null) {
    return null;
  }
  const filterValues = Object.fromEntries(
    defaultDependenciesOf(field).map((fieldKey) => [
      fieldKey,
      valueOf(fieldKey),
    ]),
  );
  return { key: JSON.stringify(source.filter ?? {}), filterValues };
};

/** 已查回來、條件還相同的值;條件變了或還沒查到 → null(查到後再補上)。 */
const providedResolver =
  (
    provided: ProvidedDefaults,
    byKey: ReadonlyMap<string, FieldDef>,
  ): ProviderDefaultOf =>
  (field, values) => {
    const entry = provided[field.key];
    const query = providerQueryOf(field, byKey, values);
    return entry !== undefined && query !== null && entry.key === query.key
      ? entry.value
      : null;
  };

/**
 * 填寫表單的值與「碰過」旗標(新增 / 編輯頁、設計器預覽共用)。初始值在 `useState` 初始化器裡算(REACT-08)。
 *
 * 引用欄「來源提供的預設」要向 api 查(`formLookupDefault`,給了 `lookup` 才查):預設值生效時(新增一打開、
 * 或沒送出過的單改過值之後)沒碰過的那些欄位依目前的條件查,查回來再照重算規則填上;條件變了就重查。
 */
export const useFillValues = ({
  fields,
  initialValues,
  initialTouched = [],
  ctx,
  permissions,
  recomputeDefaults,
  fillOnMount,
  systemLabels,
  lookup,
}: FillValuesOptions): FillValues => {
  const t = useTranslations("admin.formEngine.renderer");
  const showSnackbar = useSnackbar();
  const { session } = useSession();
  const links = useMemo(() => linkedReferencesOf(fields), [fields]);
  const byKey = useMemo(
    () => new Map(fields.map((field) => [field.key, field])),
    [fields],
  );
  const settle = (
    values: StoredValues,
    touched: ReadonlySet<string>,
    provided: ProvidedDefaults,
  ): StoredValues =>
    withDefaults({
      fields,
      values,
      ctx,
      touched,
      permissions,
      ...(systemLabels !== undefined && { systemLabels }),
      providerDefault: providedResolver(provided, byKey),
    });
  const [state, setState] = useState(() => {
    const touched = new Set(initialTouched);
    return {
      touched,
      cleared: [] as ClearedLink[],
      values: fillOnMount
        ? settle({ ...initialValues }, touched, NONE_PROVIDED)
        : { ...initialValues },
      provided: NONE_PROVIDED,
      /** 預設值生效中(新增一打開;或改過值之後、還沒送出過的單):來源提供的預設才查 */
      isActive: fillOnMount,
    };
  });

  const change = (next: StoredValues) => {
    setState((current) => {
      const touched = new Set(current.touched);
      for (const key of changedKeysOf(current.values, next)) {
        touched.add(key);
      }
      const settled = recomputeDefaults
        ? settle(next, touched, current.provided)
        : next;
      // 連動篩選:被引用欄位(含帶入、預設值、計算欄位)的篩選值變了 → 清空依賴它的引用欄
      const { values, cleared } = clearLinkedReferences(
        fields,
        links,
        current.values,
        settled,
        ctx,
      );
      return {
        ...current,
        touched,
        values,
        cleared,
        isActive: current.isActive || recomputeDefaults,
      };
    });
  };

  // 來源提供的預設:沒碰過、改得動、條件讀得到的欄位,依目前的條件查(同一組條件只查一次)
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (lookup === undefined || !state.isActive) {
      return;
    }
    for (const field of fields) {
      if (
        !isProviderDefault(field) ||
        state.touched.has(field.key) ||
        !permissions.canEdit(field.key) ||
        defaultDependenciesOf(field).some((key) => !permissions.canShow(key))
      ) {
        continue;
      }
      const query = providerQueryOf(field, byKey, state.values);
      if (query === null || state.provided[field.key]?.key === query.key) {
        continue;
      }
      const requestKey = `${field.key}:${query.key}`;
      if (requested.current.has(requestKey)) {
        continue;
      }
      requested.current.add(requestKey);
      void useFormLookupDefaultQuery
        .fetcher(session.client, {
          input: {
            formKey: lookup.formKey,
            ...(lookup.version !== null && { version: lookup.version }),
            fieldKey: field.key,
            filterValues: query.filterValues,
          },
        })()
        .then(
          (payload) => {
            const record = payload.formLookupDefault.record;
            return record === null || record === undefined
              ? null
              : { id: record.id, label: record.label ?? record.id };
          },
          // 查不到預設值不擋填寫:當沒有預設
          () => null,
        )
        .then((value) => {
          setState((current) => {
            const provided = {
              ...current.provided,
              [field.key]: { key: query.key, value },
            };
            return {
              ...current,
              provided,
              values: settle(current.values, current.touched, provided),
            };
          });
        });
    }
  });

  // 清空的提示在 commit 之後才跳(更新函式要保持純粹)
  useEffect(() => {
    for (const notice of state.cleared) {
      showSnackbar(
        "info",
        notice.rows === undefined
          ? t("linkedCleared", { field: notice.label })
          : t("linkedClearedRows", { count: notice.rows, field: notice.label }),
      );
    }
  }, [state.cleared, showSnackbar, t]);

  return { values: state.values, touched: [...state.touched], change };
};
