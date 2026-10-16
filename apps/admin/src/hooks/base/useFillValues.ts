import { useState } from "react";

import type {
  ExpressionContext,
  FieldDef,
  StoredValues,
} from "@repo/domain/form";

import type { FieldPermissionFacts } from "@/lib/base/form-engine/field-states";
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
  /** 使用者改了值(`FormRenderer` 的 onChange;帶入的 patch 也走這裡):改到的欄位記為碰過,再重算其餘預設值 */
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
  const [state, setState] = useState(() => {
    const touched = new Set(initialTouched);
    return {
      touched,
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
      return {
        touched,
        values: recomputeDefaults
          ? withDefaults({
              fields,
              values: next,
              ctx,
              touched,
              permissions,
              ...(systemLabels !== undefined && { systemLabels }),
            })
          : next,
      };
    });
  };

  return { values: state.values, touched: [...state.touched], change };
};
