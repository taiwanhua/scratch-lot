import { HttpResponse } from "msw";

import type {
  FormFieldsFragment,
  UpdateFormMutationVariables,
} from "@repo/graphql";

import { type AuthErrorCode, graphqlError } from "./auth-handlers";
import { api } from "./server";

type Failure = ReturnType<typeof graphqlError> | null;

export interface FormUpdateState {
  findForm: (formKey: string) => FormFieldsFragment | undefined;
  /** world 指定的失敗回應(沒有就回 null) */
  fail: (operation: "UpdateForm") => Failure;
  /** world 的 `inputs`:記下送來的 input(測試斷言用) */
  inputs: { updateForm: UpdateFormMutationVariables["input"][] };
}

/**
 * `updateForm` 的假 api(表單設計端 world 掛一支,狀態由 world 傳進來):名稱 / 頁籤模板 / 允許存草稿 / 單號格式,
 * 缺席或 null = 不動、`tabLabelTemplate` 空字串 = 清空(與 api 同)。寫回 world 的那張表單並回傳它。
 */
export const formUpdateHandler = (state: FormUpdateState) =>
  api.mutation("UpdateForm", ({ variables }) => {
    const { input } = variables as UpdateFormMutationVariables;
    state.inputs.updateForm.push(input);
    const failure = state.fail("UpdateForm");
    if (failure !== null) {
      return failure;
    }
    const form = state.findForm(input.key);
    if (form === undefined) {
      return graphqlError("NOT_FOUND" as AuthErrorCode);
    }
    if (input.name != null) {
      form.name = input.name;
    }
    if (input.tabLabelTemplate !== undefined) {
      form.tabLabelTemplate =
        input.tabLabelTemplate === "" ? null : input.tabLabelTemplate;
    }
    if (input.allowDraft != null) {
      form.allowDraft = input.allowDraft;
    }
    if (input.voidReasonCategoryKey !== undefined) {
      form.voidReasonCategoryKey =
        input.voidReasonCategoryKey === "" ? null : input.voidReasonCategoryKey;
    }
    if (input.sharedByFieldKeys !== undefined) {
      form.sharedByFieldKeys = [...(input.sharedByFieldKeys ?? [])];
    }
    if (input.serial !== undefined) {
      form.serial =
        input.serial === null
          ? null
          : { ...input.serial, separator: input.serial.separator ?? null };
    }
    return HttpResponse.json({ data: { updateForm: { form } } });
  });
