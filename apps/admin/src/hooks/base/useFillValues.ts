import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import type {
  ExpressionContext,
  FieldDef,
  StoredValues,
} from "@repo/domain/form";

import { useSnackbar } from "@/hooks/base/useMutationFeedback";
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
   * 預設值要不要跟著依賴重算(Spec 6a §5「預設值」):新增、以及還沒送出過的草稿要;
   * 已送出過的單(已完成、被退回、撤回)不再動使用者的值
   */
  recomputeDefaults: boolean;
  /** 一打開就先填預設值(新增頁、設計器預覽);編輯既有草稿不用(api 建草稿時已填) */
  fillOnMount: boolean;
  systemLabels?: { user: string | null; org: string | null };
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

/**
 * 填寫表單的值與「碰過」旗標(新增 / 編輯頁、設計器預覽共用)。初始值在 `useState` 初始化器裡算(REACT-08)。
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
}: FillValuesOptions): FillValues => {
  const t = useTranslations("admin.formEngine.renderer");
  const showSnackbar = useSnackbar();
  const links = useMemo(() => linkedReferencesOf(fields), [fields]);
  const [state, setState] = useState(() => {
    const touched = new Set(initialTouched);
    return {
      touched,
      cleared: [] as ClearedLink[],
      values: fillOnMount
        ? withDefaults({
            fields,
            values: { ...initialValues },
            ctx,
            touched,
            permissions,
            ...(systemLabels !== undefined && { systemLabels }),
          })
        : { ...initialValues },
    };
  });

  const change = (next: StoredValues) => {
    setState((current) => {
      const touched = new Set(current.touched);
      for (const key of changedKeysOf(current.values, next)) {
        touched.add(key);
      }
      const settled = recomputeDefaults
        ? withDefaults({
            fields,
            values: next,
            ctx,
            touched,
            permissions,
            ...(systemLabels !== undefined && { systemLabels }),
          })
        : next;
      // 連動篩選(B2d):被引用欄位(含帶入、預設值、計算欄位)的篩選值變了 → 清空依賴它的引用欄
      const { values, cleared } = clearLinkedReferences(
        fields,
        links,
        current.values,
        settled,
        ctx,
      );
      return { touched, values, cleared };
    });
  };

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
