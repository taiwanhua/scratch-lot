import { type GraphQLResponseBody, HttpResponse } from "msw";

import {
  FormSubmissionStatus,
  type VoidSubmissionMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "./auth-handlers";
import { type MockSubmission, submissionFragment } from "./form-fixtures";
import { api } from "./server";

type FailureOperation =
  "WithdrawSubmission" | "VoidSubmission" | "CopySubmissionToDraft";

export interface SubmissionActionContext {
  byId: (id: string) => MockSubmission | undefined;
  push: (submission: MockSubmission) => void;
  nextId: () => string;
  fail: (operation: FailureOperation) => ReturnType<typeof graphqlError> | null;
  payload: (
    name: string,
    submission: MockSubmission,
  ) => HttpResponse<GraphQLResponseBody<Record<string, never>>>;
  inputs: {
    withdrawSubmission: { id: string; expectedEditVersion: number }[];
    voidSubmission: VoidSubmissionMutationVariables["input"][];
    copySubmissionToDraft: { id: string; clientRequestId: string }[];
  };
  /** `copySubmissionToDraft` 回報被清空的欄位(引用來源失效) */
  copyClearedFields: string[];
  /** 表單 key + 選項值 → 作廢原因的選項名稱(沒有 = null) */
  voidReasonLabelOf: (formKey: string, reasonKey: string) => string | null;
}

const notFound = () => graphqlError("NOT_FOUND");

/**
 * 申請人的撤回 / 作廢 / 複製為新單:寫回表單執行端 world 的同一份清單,
 * 回傳形狀同 api(`FormSubmissionFields`)。只做畫面需要的狀態變化,規則的正確性在 api 測試。
 */
export const submissionActionHandlers = (ctx: SubmissionActionContext) => [
  api.mutation("WithdrawSubmission", ({ variables }) => {
    const { input } = variables as {
      input: { id: string; expectedEditVersion: number };
    };
    ctx.inputs.withdrawSubmission.push(input);
    const target = ctx.byId(input.id);
    const failure = ctx.fail("WithdrawSubmission");
    if (target === undefined || failure !== null) {
      return failure ?? notFound();
    }
    Object.assign(target, {
      status: FormSubmissionStatus.Withdrawn,
      editVersion: target.editVersion + 1,
      abilities: { ...target.abilities, canWithdraw: false, canEdit: true },
    });
    return ctx.payload("withdrawSubmission", target);
  }),
  api.mutation("VoidSubmission", ({ variables }) => {
    const { input } = variables as VoidSubmissionMutationVariables;
    ctx.inputs.voidSubmission.push(input);
    const target = ctx.byId(input.id);
    const failure = ctx.fail("VoidSubmission");
    if (target === undefined || failure !== null) {
      return failure ?? notFound();
    }
    Object.assign(target, {
      status: FormSubmissionStatus.Voided,
      voidReason: input.reasonNote === "" ? null : input.reasonNote,
      voidReasonKey: input.reasonKey ?? null,
      voidReasonLabel:
        input.reasonKey === null || input.reasonKey === undefined
          ? null
          : ctx.voidReasonLabelOf(target.formKey, input.reasonKey),
      voidedAt: target.updatedAt,
      editVersion: target.editVersion + 1,
      abilities: {
        ...target.abilities,
        canVoid: false,
        canCopy: true,
        canEdit: false,
      },
    });
    return ctx.payload("voidSubmission", target);
  }),
  api.mutation("CopySubmissionToDraft", ({ variables }) => {
    const { input } = variables as {
      input: { id: string; clientRequestId: string };
    };
    ctx.inputs.copySubmissionToDraft.push(input);
    const source = ctx.byId(input.id);
    const failure = ctx.fail("CopySubmissionToDraft");
    if (source === undefined || failure !== null) {
      return failure ?? notFound();
    }
    const copy = submissionFragment({
      ...structuredClone(source),
      id: ctx.nextId(),
      status: FormSubmissionStatus.Draft,
      revision: 0,
      revisions: [],
      currentInstanceId: null,
      voidReason: null,
      voidReasonKey: null,
      voidReasonLabel: null,
      voidedAt: null,
      copiedFrom: source.id,
      editVersion: 1,
      abilities: {
        ...source.abilities,
        canEdit: true,
        canVoid: false,
        canCopy: false,
        canWithdraw: false,
      },
    });
    ctx.push(copy);
    Object.assign(source, {
      replacedById: copy.id,
      abilities: { ...source.abilities, canCopy: false },
    });
    // 形狀同 api:只有這支的回傳帶 `clearedFields`
    const data: Record<string, unknown> = {
      copySubmissionToDraft: {
        submission: { ...copy, clearedFields: ctx.copyClearedFields },
      },
    };
    return HttpResponse.json<GraphQLResponseBody<Record<string, never>>>({
      data: data as Record<string, never>,
    });
  }),
];
