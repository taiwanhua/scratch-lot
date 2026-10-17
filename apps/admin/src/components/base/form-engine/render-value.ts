import { type ReactNode, createElement } from "react";

import type { FormValueRenderContext } from "@/lib/base/form-engine/value-text";

import { FormValue } from "./FormValue";

/**
 * 語意型別 → 元件的統一渲染(Spec 6a §8 `renderValue(ctx)`)。簽章同 REACT-13 的 `render(ctx)`:
 * 一個參數物件,`DataTable` 的欄位 `render` 直接呼叫(`render: (cell) => renderValue({ field, value: cell.value, … })`)。
 */
export const renderValue = (ctx: FormValueRenderContext): ReactNode =>
  createElement(FormValue, ctx);
