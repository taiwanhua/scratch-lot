import { type GraphQLResponseBody, HttpResponse } from "msw";

import {
  DEFAULT_LIST_BUILTIN_COLUMNS,
  type FormDefinition,
  type ListBuiltinColumns,
} from "@repo/domain/form";
import {
  type CreateAndSubmitFormSubmissionMutationVariables,
  type CreateFormDraftMutationVariables,
  type FormFieldOptionsQuery,
  type FormFieldOptionsQueryVariables,
  type FormLookupQuery,
  type FormLookupQueryVariables,
  type FormRuntimeVersionQueryVariables,
  type FormSubmissionQueryVariables,
  type FormSubmissionRevisionsQueryVariables,
  FormSubmissionStatus,
  type FormSubmissionsQueryVariables,
  FormVersionStatus,
  type ModuleFormsQuery,
  type ModuleListColumn,
  type ModuleListColumnsQueryVariables,
  type SaveFormDraftMutationVariables,
  type SubmitFormSubmissionMutationVariables,
  type UpdateFormSubmissionMutationVariables,
  type VoidSubmissionMutationVariables,
} from "@repo/graphql";

import { rawOf } from "@/lib/base/form-engine/definition";

import { type AuthErrorCode, graphqlError } from "./auth-handlers";
import { formCreateHandlers } from "./form-create-handlers";
import type { MockSubmission } from "./form-fixtures";
import { submissionActionHandlers } from "./form-submission-action-handlers";
import { fragmentOf, revisionsOf } from "./form-submission-revisions";
import { matchesSubmissionsInput } from "./form-submissions-filter";
import { api } from "./server";

export type FormRuntimeOperation =
  | "FormFieldOptions"
  | "CreateAndSubmitFormSubmission"
  | "CreateFormDraft"
  | "SaveFormDraft"
  | "SubmitFormSubmission"
  | "UpdateFormSubmission"
  | "DeleteFormSubmission"
  | "WithdrawSubmission"
  | "VoidSubmission"
  | "CopySubmissionToDraft";

export interface FormFailure {
  code: string;
  extensions?: Record<string, unknown>;
}

export interface FormRuntimeWorldOptions {
  moduleForms?: ModuleFormsQuery["moduleForms"];
  /** `<formKey>@<version>` → 定義 */
  versions?: Partial<Record<string, FormDefinition>>;
  /** 提交(可另帶 `revisions`:修訂紀錄跳窗的清單;沒給 = 修訂 1..`revision` 都綁提交的版本) */
  submissions?: MockSubmission[];
  /** 模組 key → 列表欄位配置(沒給 = 空陣列) */
  listColumns?: Record<string, ModuleListColumn[]>;
  /** 模組 key → 內建欄開關(沒給 = 全開) */
  listBuiltin?: Record<string, ListBuiltinColumns>;
  lookupRecords?: FormLookupQuery["formLookup"]["items"];
  /** 欄位 key → `formFieldOptions` 回的類別選項(沒給 = 空清單) */
  fieldOptions?: Record<
    string,
    FormFieldOptionsQuery["formFieldOptions"]["items"]
  >;
  /** 提交 id → 修訂號 → 那個修訂的完整快照(`formSubmission(id, revision)` 用;沒給就回目前的值) */
  snapshots?: Record<string, Record<number, Record<string, unknown>>>;
  failures?: Partial<Record<FormRuntimeOperation, FormFailure>>;
  /**
   * 送出後的狀態:不綁流程 = 已完成(預設);綁了流程 = 審核中,並連上 `currentInstanceId`
   * (送審不經過 completed)
   */
  submitAs?: { status: FormSubmissionStatus; instanceId?: string };
  /** `copySubmissionToDraft` 回報被清空的欄位(引用來源失效) */
  copyClearedFields?: string[];
  /** 表單 key → 作廢原因的類別與選項(`formVoidReasonOptions`;沒給 = 沒設類別、自由填寫) */
  voidReasonOptions?: Record<
    string,
    { categoryKey: string; items: { value: string; label: string }[] }
  >;
}

export interface FormRuntimeWorld {
  handlers: Parameters<typeof import("./server").server.use>;
  inputs: {
    createAndSubmitFormSubmission: CreateAndSubmitFormSubmissionMutationVariables["input"][];
    createFormDraft: CreateFormDraftMutationVariables["input"][];
    saveFormDraft: SaveFormDraftMutationVariables["input"][];
    submitFormSubmission: SubmitFormSubmissionMutationVariables["input"][];
    updateFormSubmission: UpdateFormSubmissionMutationVariables["input"][];
    withdrawSubmission: { id: string; expectedEditVersion: number }[];
    voidSubmission: VoidSubmissionMutationVariables["input"][];
    copySubmissionToDraft: { id: string; clientRequestId: string }[];
    formSubmissions: FormSubmissionsQueryVariables["input"][];
    formLookup: FormLookupQueryVariables["input"][];
    formFieldOptions: FormFieldOptionsQueryVariables["input"][];
  };
}

const notFound = () => graphqlError("NOT_FOUND" as AuthErrorCode);

/** 樂觀鎖沒搶到(與 api 同一個 code / reason)。 */
const conflict = () =>
  graphqlError("CONFLICT" as AuthErrorCode, "CONFLICT", {
    reason: "EDIT_VERSION_MISMATCH",
  });

/**
 * 表單執行端的假 api(docs/modules/forms.md「api 介面」執行端)。有狀態:建草稿 / 存 / 送 / 改寫回同一份清單,
 * 每次寫入 `editVersion + 1`、已完成修改 `revision + 1`;`expectedEditVersion` 不符 → `CONFLICT`(與 api 同)。
 * 不模擬欄位級投影與條件:那些由 api 測試覆蓋,這裡只給畫面需要的形狀。
 */
export const formRuntimeWorld = (
  options: FormRuntimeWorldOptions = {},
): FormRuntimeWorld => {
  const {
    moduleForms = [],
    versions = {},
    lookupRecords = [],
    failures = {},
  } = options;
  const listColumns = options.listColumns ?? {};
  const listBuiltin = options.listBuiltin ?? {};
  const state: MockSubmission[] = structuredClone(options.submissions ?? []);
  const inputs: FormRuntimeWorld["inputs"] = {
    createAndSubmitFormSubmission: [],
    createFormDraft: [],
    saveFormDraft: [],
    submitFormSubmission: [],
    updateFormSubmission: [],
    withdrawSubmission: [],
    voidSubmission: [],
    copySubmissionToDraft: [],
    formSubmissions: [],
    formLookup: [],
    formFieldOptions: [],
  };
  let created = 0;

  const fail = (operation: FormRuntimeOperation) => {
    const failure = failures[operation];
    return failure === undefined
      ? null
      : graphqlError(
          failure.code as AuthErrorCode,
          failure.code,
          failure.extensions ?? {},
        );
  };
  const find = (id: string) => state.find((item) => item.id === id);
  const push = (submission: MockSubmission) => {
    state.push(submission);
  };
  /** 新一筆的 id(`<prefix>-<流水號>`) */
  const nextId = (prefix: string) => () => {
    created += 1;
    return `${prefix}-${String(created)}`;
  };
  /** 單筆 payload(`{ <操作名>: { submission } }`);型別交給各 handler 的回傳推導。 */
  const payload = (name: string, submission: MockSubmission) =>
    HttpResponse.json<GraphQLResponseBody<Record<string, never>>>({
      data: { [name]: { submission: fragmentOf(submission) } } as Record<
        string,
        never
      >,
    });

  const handlers = [
    api.query("ModuleForms", () =>
      HttpResponse.json({ data: { moduleForms } }),
    ),
    api.query("ModuleListColumns", ({ variables }) => {
      const { moduleKey } = variables as ModuleListColumnsQueryVariables;
      return HttpResponse.json({
        data: {
          moduleListColumns: {
            moduleKey,
            columns: listColumns[moduleKey] ?? [],
            builtin: listBuiltin[moduleKey] ?? DEFAULT_LIST_BUILTIN_COLUMNS,
          },
        },
      });
    }),
    api.query("FormRuntimeVersion", ({ variables }) => {
      const { formKey, version } =
        variables as FormRuntimeVersionQueryVariables;
      const definition = versions[`${formKey}@${String(version)}`];
      return definition === undefined
        ? notFound()
        : HttpResponse.json({
            data: {
              formRuntimeVersion: {
                formVersion: {
                  id: `ver-${formKey}-${String(version)}`,
                  formKey,
                  version,
                  status: FormVersionStatus.Published,
                  ...rawOf(definition),
                },
              },
            },
          });
    }),
    api.query("FormSubmissions", ({ variables }) => {
      const { input } = variables as FormSubmissionsQueryVariables;
      inputs.formSubmissions.push(input);
      const items = state.filter((item) =>
        matchesSubmissionsInput(item, input),
      );
      return HttpResponse.json({
        data: {
          formSubmissions: {
            items: items.map((item) => fragmentOf(item)),
            totalCount: items.length,
            page: input.page ?? 1,
            pageSize: input.pageSize ?? 20,
          },
        },
      });
    }),
    api.query("FormSubmission", ({ variables }) => {
      const { id, revision } = variables as FormSubmissionQueryVariables;
      const item = find(id);
      if (item === undefined) {
        return notFound();
      }
      const snapshot =
        revision == null ? undefined : options.snapshots?.[id]?.[revision];
      return payload(
        "formSubmission",
        snapshot === undefined
          ? item
          : {
              ...item,
              values: snapshot,
              viewedRevision: revision ?? item.revision,
              viewedVersion:
                revisionsOf(item).find((entry) => entry.revision === revision)
                  ?.version ?? item.version,
            },
      );
    }),
    api.query("FormSubmissionRevisions", ({ variables }) => {
      const { id } = variables as FormSubmissionRevisionsQueryVariables;
      const item = find(id);
      if (item === undefined) {
        return notFound();
      }
      return HttpResponse.json({
        data: {
          formSubmission: {
            submission: {
              id: item.id,
              revision: item.revision,
              revisions: revisionsOf(item),
            },
          },
        },
      });
    }),
    api.query("FormLookup", ({ variables }) => {
      const { input } = variables as FormLookupQueryVariables;
      inputs.formLookup.push(input);
      return HttpResponse.json({
        data: {
          formLookup: {
            items: lookupRecords,
            totalCount: lookupRecords.length,
            page: 1,
            pageSize: 20,
          },
        },
      });
    }),
    api.query("FormFieldOptions", ({ variables }) => {
      const { input } = variables as FormFieldOptionsQueryVariables;
      inputs.formFieldOptions.push(input);
      const failure = fail("FormFieldOptions");
      if (failure !== null) {
        return failure;
      }
      // 與 api 同:keyword 比對 label / value(不分大小寫),再依 page / pageSize 切
      const keyword = input.keyword?.trim().toLowerCase() ?? "";
      const matched = (options.fieldOptions?.[input.fieldKey] ?? []).filter(
        (item) =>
          keyword === "" ||
          item.label.toLowerCase().includes(keyword) ||
          item.value.toLowerCase().includes(keyword),
      );
      const page = input.page ?? 1;
      const pageSize = input.pageSize ?? 100;
      return HttpResponse.json({
        data: {
          formFieldOptions: {
            items: matched.slice((page - 1) * pageSize, page * pageSize),
            totalCount: matched.length,
            page,
            pageSize,
          },
        },
      });
    }),
    ...formCreateHandlers({
      push,
      nextId: nextId("sub-new"),
      fail,
      payload,
      inputs,
      submitAs: options.submitAs,
      moduleForms,
    }),
    api.mutation("SaveFormDraft", ({ variables }) => {
      const { input } = variables as SaveFormDraftMutationVariables;
      inputs.saveFormDraft.push(input);
      const target = find(input.id);
      if (target === undefined) {
        return notFound();
      }
      const failure = fail("SaveFormDraft");
      if (failure !== null) {
        return failure;
      }
      if (target.editVersion !== input.expectedEditVersion) {
        return conflict();
      }
      Object.assign(target, {
        values: input.values,
        ...(input.touched != null && { touched: input.touched }),
        editVersion: target.editVersion + 1,
      });
      return payload("saveFormDraft", target);
    }),
    api.mutation("SubmitFormSubmission", ({ variables }) => {
      const { input } = variables as SubmitFormSubmissionMutationVariables;
      inputs.submitFormSubmission.push(input);
      const target = find(input.id);
      if (target === undefined) {
        return notFound();
      }
      const failure = fail("SubmitFormSubmission");
      if (failure !== null) {
        return failure;
      }
      Object.assign(target, {
        // `values` 有值 = 以畫面上的值送出(與送出同一次寫入)
        values: input.values ?? target.values,
        status: options.submitAs?.status ?? FormSubmissionStatus.Completed,
        currentInstanceId:
          options.submitAs?.instanceId ?? target.currentInstanceId,
        revision: target.revision + 1,
        editVersion: target.editVersion + 1,
        summary: {
          title:
            typeof target.values.item === "string" ? target.values.item : "",
          date: null,
          amount: null,
        },
      });
      return payload("submitFormSubmission", target);
    }),
    api.mutation("UpdateFormSubmission", ({ variables }) => {
      const { input } = variables as UpdateFormSubmissionMutationVariables;
      inputs.updateFormSubmission.push(input);
      const target = find(input.id);
      if (target === undefined) {
        return notFound();
      }
      const failure = fail("UpdateFormSubmission");
      if (failure !== null) {
        return failure;
      }
      if (target.editVersion !== input.expectedEditVersion) {
        return conflict();
      }
      Object.assign(target, {
        values: input.values,
        revision: target.revision + 1,
        editVersion: target.editVersion + 1,
      });
      return payload("updateFormSubmission", target);
    }),
    ...submissionActionHandlers({
      byId: find,
      push,
      nextId: nextId("sub-copy"),
      fail,
      payload,
      inputs,
      copyClearedFields: options.copyClearedFields ?? [],
      voidReasonLabelOf: (formKey, reasonKey) =>
        options.voidReasonOptions?.[formKey]?.items.find(
          (item) => item.value === reasonKey,
        )?.label ?? null,
    }),
    api.query("FormVoidReasonOptions", ({ variables }) => {
      const { formKey } = variables as { formKey: string };
      const configured = options.voidReasonOptions?.[formKey];
      return HttpResponse.json({
        data: {
          formVoidReasonOptions: configured ?? {
            categoryKey: null,
            items: [],
          },
        },
      });
    }),
    api.mutation("DeleteFormSubmission", ({ variables }) => {
      const { input } = variables as { input: { id: string } };
      const failure = fail("DeleteFormSubmission");
      if (failure !== null) {
        return failure;
      }
      const index = state.findIndex((item) => item.id === input.id);
      if (index !== -1) {
        state.splice(index, 1);
      }
      return HttpResponse.json({
        data: { deleteFormSubmission: { success: true, deletedId: input.id } },
      });
    }),
  ];

  return { handlers, inputs };
};
