import { HttpResponse } from "msw";

import { isTagPaletteKey } from "@repo/domain/project/tag-palette";
import type {
  FieldOptionColorsQuery,
  FieldOptionColorsQueryVariables,
  SetFieldOptionColorMutation,
  SetFieldOptionColorMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "../auth-handlers";
import { api } from "../server";

export type TestFieldOptionColor =
  FieldOptionColorsQuery["fieldOptionColors"]["items"][number];

export interface FieldOptionColorWorldOptions {
  /** 類別 key → 有顏色的選項 */
  colorsByCategory?: Record<string, TestFieldOptionColor[]>;
  /** 選項 id → (類別 key, 值):寫入時知道要寫到哪個類別、回傳的 `value` */
  options?: Record<string, { categoryKey: string; value: string }>;
}

export interface FieldOptionColorWorld {
  handlers: Parameters<typeof import("../server").server.use>;
  /** `setFieldOptionColor` 收到的輸入(依序) */
  inputs: SetFieldOptionColorMutationVariables["input"][];
  /** `fieldOptionColors` 被打到的次數(驗寫入後真的重查) */
  calls: { fieldOptionColors: number };
}

/**
 * 欄位選項顏色的假 api(規則照 `docs/modules/project/field-manager.md`「選項顏色」):
 * 有狀態 —— 寫入後重查看得到新值;代號不在色票清單 → `VALIDATION_FAILED`;`null` = 清掉。
 * 誰能設由每一列的 `canToggleEnabled` 決定(api 算好),這裡不重算組織關係。
 */
export const fieldOptionColorWorld = ({
  colorsByCategory = {},
  options = {},
}: FieldOptionColorWorldOptions = {}): FieldOptionColorWorld => {
  const state = new Map(
    Object.entries(colorsByCategory).map(([key, items]) => [key, [...items]]),
  );
  const inputs: FieldOptionColorWorld["inputs"] = [];
  const calls = { fieldOptionColors: 0 };

  const handlers: FieldOptionColorWorld["handlers"] = [
    api.query<FieldOptionColorsQuery, FieldOptionColorsQueryVariables>(
      "FieldOptionColors",
      ({ variables }) => {
        calls.fieldOptionColors += 1;
        const items = state.get(variables.categoryKey) ?? [];
        return HttpResponse.json({
          data: {
            fieldOptionColors: { items, totalCount: items.length },
          },
        });
      },
    ),
    api.mutation("SetFieldOptionColor", ({ variables }) => {
      const { input } = variables as SetFieldOptionColorMutationVariables;
      inputs.push(input);
      const paletteKey = input.paletteKey ?? null;
      if (paletteKey !== null && !isTagPaletteKey(paletteKey)) {
        return graphqlError("VALIDATION_FAILED");
      }
      const option = options[input.fieldId] ?? { categoryKey: "", value: "" };
      const others = (state.get(option.categoryKey) ?? []).filter(
        (item) => item.fieldId !== input.fieldId,
      );
      const color = { fieldId: input.fieldId, value: option.value, paletteKey };
      state.set(
        option.categoryKey,
        paletteKey === null ? others : [...others, color],
      );
      const payload: SetFieldOptionColorMutation = {
        setFieldOptionColor: { color },
      };
      return HttpResponse.json({ data: payload });
    }),
  ];

  return { handlers, inputs, calls };
};
