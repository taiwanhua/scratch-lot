import { HttpResponse } from "msw";

import type {
  FormLookupDefaultQueryVariables,
  FormLookupQuery,
  FormLookupQueryVariables,
} from "@repo/graphql";

import { api } from "./server";

export interface FormLookupHandlersOptions {
  /** `formLookup` 一律回這些(不分欄位、不篩關鍵字) */
  records: FormLookupQuery["formLookup"]["items"];
  /** `formLookupDefault`:依輸入回 `records` 裡的 id;沒給或找不到 → null */
  lookupDefault:
    | ((input: FormLookupDefaultQueryVariables["input"]) => string | null)
    | undefined;
  inputs: {
    formLookup: FormLookupQueryVariables["input"][];
    formLookupDefault: FormLookupDefaultQueryVariables["input"][];
  };
}

/** 表單執行端的 lookup 查詢(候選資料、引用欄「來源提供的預設」);由 `formRuntimeWorld` 組裝。 */
export const formLookupHandlers = ({
  records,
  lookupDefault,
  inputs,
}: FormLookupHandlersOptions) => [
  api.query("FormLookup", ({ variables }) => {
    const { input } = variables as FormLookupQueryVariables;
    inputs.formLookup.push(input);
    return HttpResponse.json({
      data: {
        formLookup: {
          items: records,
          totalCount: records.length,
          page: 1,
          pageSize: 20,
        },
      },
    });
  }),
  api.query("FormLookupDefault", ({ variables }) => {
    const { input } = variables as FormLookupDefaultQueryVariables;
    inputs.formLookupDefault.push(input);
    const id = lookupDefault?.(input) ?? null;
    const record = records.find((candidate) => candidate.id === id);
    return HttpResponse.json({
      data: { formLookupDefault: { record: record ?? null } },
    });
  }),
];
