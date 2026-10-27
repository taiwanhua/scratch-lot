import type { GraphQLResponseBody, HttpResponse } from "msw";

import {
  type CreateAndSubmitFormSubmissionMutationVariables,
  type CreateFormDraftMutationVariables,
  FormSubmissionStatus,
} from "@repo/graphql";

import type { graphqlError } from "./auth-handlers";
import { type MockSubmission, submissionFragment } from "./form-fixtures";
import { api } from "./server";

export interface FormCreateContext {
  push: (submission: MockSubmission) => void;
  nextId: () => string;
  fail: (
    operation: "CreateFormDraft" | "CreateAndSubmitFormSubmission",
  ) => ReturnType<typeof graphqlError> | null;
  payload: (
    name: string,
    submission: MockSubmission,
  ) => HttpResponse<GraphQLResponseBody<Record<string, never>>>;
  inputs: {
    createFormDraft: CreateFormDraftMutationVariables["input"][];
    createAndSubmitFormSubmission: CreateAndSubmitFormSubmissionMutationVariables["input"][];
  };
  /** 送出後的狀態(undefined = 已完成;綁流程 = 審核中並連上實例) */
  submitAs: { status: FormSubmissionStatus; instanceId?: string } | undefined;
  /** 表單代號 → 綁定的模組 key 的對照(`moduleForms`;找不到 = 夾具預設) */
  moduleForms?: readonly { key: string; moduleKey: string }[];
}

/**
 * 新增頁的兩個寫入(docs/modules/forms.md「允許存草稿」),寫回表單執行端 world 的同一份清單:
 * [存草稿] = `createFormDraft`;[送出] = `createAndSubmitFormSubmission` 一次建立 + 送出,
 * 失敗時什麼都不留(與 api 同:整個交易回復)。
 */
export const formCreateHandlers = (ctx: FormCreateContext) => [
  api.mutation("CreateFormDraft", ({ variables }) => {
    const { input } = variables as CreateFormDraftMutationVariables;
    ctx.inputs.createFormDraft.push(input);
    const failure = ctx.fail("CreateFormDraft");
    if (failure !== null) {
      return failure;
    }
    const submission = submissionFragment({
      id: ctx.nextId(),
      formKey: input.formKey,
      status: FormSubmissionStatus.Draft,
      revision: 0,
      revisions: [],
      values: input.values ?? {},
      touched: input.touched ?? [],
      summary: null,
      submittedAt: null,
      editVersion: 1,
    });
    ctx.push(submission);
    return ctx.payload("createFormDraft", submission);
  }),
  api.mutation("CreateAndSubmitFormSubmission", ({ variables }) => {
    const { input } =
      variables as CreateAndSubmitFormSubmissionMutationVariables;
    ctx.inputs.createAndSubmitFormSubmission.push(input);
    const failure = ctx.fail("CreateAndSubmitFormSubmission");
    if (failure !== null) {
      return failure;
    }
    const values = input.values ?? {};
    const moduleKey = ctx.moduleForms?.find(
      (form) => form.key === input.formKey,
    )?.moduleKey;
    const submission = submissionFragment({
      id: ctx.nextId(),
      ...(moduleKey !== undefined && { moduleKey }),
      formKey: input.formKey,
      status: ctx.submitAs?.status ?? FormSubmissionStatus.Completed,
      currentInstanceId: ctx.submitAs?.instanceId ?? null,
      revision: 1,
      values,
      touched: input.touched ?? [],
      summary: {
        title: typeof values.item === "string" ? values.item : "",
        date: null,
        amount: null,
      },
      editVersion: 1,
    });
    ctx.push(submission);
    return ctx.payload("createAndSubmitFormSubmission", submission);
  }),
];
