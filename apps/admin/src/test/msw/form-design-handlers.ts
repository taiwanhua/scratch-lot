import { HttpResponse } from "msw";

import { DEFAULT_LIST_BUILTIN_COLUMNS } from "@repo/domain/form";
import {
  type CreateFormVersionDraftMutationVariables,
  type DeleteFormVersionDraftMutationVariables,
  type DeleteRetiredPermissionMutationVariables,
  type ExportFormSeedQueryVariables,
  type FieldCategoriesQueryVariables,
  type FormFieldsFragment,
  type FormVersionFieldsFragment,
  type FormVersionQueryVariables,
  FormVersionStatus,
  type FormsQueryVariables,
  ModuleEngine,
  type PreviewFormVersionQuery,
  type PreviewFormVersionQueryVariables,
  type PublishFormVersionMutationVariables,
  type RetiredFormPermissionsQuery,
  type SaveFormVersionDraftMutationVariables,
  type SetModuleListColumnsMutationVariables,
} from "@repo/graphql";

import { type AuthErrorCode, graphqlError } from "./auth-handlers";
import { fieldCategories } from "./field-fixtures";
import type { FormFailure } from "./form-runtime-handlers";
import {
  BASE_LOOKUP_PROVIDERS,
  type LookupProviderFixture,
} from "./lookup-provider-fixtures";
import { formSeedExportHandler } from "./seed-export-handlers";
import { api } from "./server";

export type FormDesignOperation =
  | "SaveFormVersionDraft"
  | "PublishFormVersion"
  | "CreateForm"
  | "DeleteRetiredPermission"
  | "DeleteFormVersionDraft"
  | "SetModuleListColumns"
  | "ExportFormSeed"
  | "FormLookupProviders";

type RetiredPermission =
  RetiredFormPermissionsQuery["retiredFormPermissions"]["items"][number];

export interface FormDesignWorldOptions {
  /** 設計器的 lookup 來源清單(沒給 = 底座三種) */
  lookupProviders?: LookupProviderFixture[];
  forms?: FormFieldsFragment[];
  /** 表單 key → 全部版本(含草稿) */
  versions?: Record<string, FormVersionFieldsFragment[]>;
  retired?: RetiredPermission[];
  /** 依權限 key 決定 `deleteRetiredPermission` 的回應(沒列 = 直接刪) */
  retiredOutcomes?: Record<string, FormFailure>;
  failures?: Partial<Record<FormDesignOperation, FormFailure>>;
  /** `previewFormVersion` 的回應(沒給 = 回送來的值、全部顯示、沒有錯誤) */
  preview?: PreviewFormVersionQuery["previewFormVersion"];
}

export interface FormDesignWorld {
  handlers: Parameters<typeof import("./server").server.use>;
  inputs: {
    saveFormVersionDraft: SaveFormVersionDraftMutationVariables["input"][];
    publishFormVersion: PublishFormVersionMutationVariables["input"][];
    createFormVersionDraft: CreateFormVersionDraftMutationVariables["input"][];
    deleteFormVersionDraft: DeleteFormVersionDraftMutationVariables["input"][];
    deleteRetiredPermission: DeleteRetiredPermissionMutationVariables["input"][];
    setModuleListColumns: SetModuleListColumnsMutationVariables["input"][];
    previewFormVersion: PreviewFormVersionQueryVariables["input"][];
    exportFormSeed: ExportFormSeedQueryVariables["input"][];
  };
}

const notFound = () => graphqlError("NOT_FOUND" as AuthErrorCode);

/**
 * 表單設計端的假 api(docs/modules/forms.md「api 介面」設計端)。有狀態:存草稿 `draftRevision + 1`、
 * `expectedDraftRevision` 不符 → `CONFLICT`;發布把草稿變成新的已發布版、前一版退役。
 * 檢查器與權限的真正判斷在 api 測試;這裡只給畫面需要的形狀與分支。
 */
export const formDesignWorld = (
  options: FormDesignWorldOptions = {},
): FormDesignWorld => {
  const forms = structuredClone(options.forms ?? []);
  const versions = structuredClone(options.versions ?? {});
  const retired = structuredClone(options.retired ?? []);
  const failures = options.failures ?? {};
  const inputs: FormDesignWorld["inputs"] = {
    saveFormVersionDraft: [],
    publishFormVersion: [],
    createFormVersionDraft: [],
    deleteFormVersionDraft: [],
    deleteRetiredPermission: [],
    setModuleListColumns: [],
    previewFormVersion: [],
    exportFormSeed: [],
  };

  const fail = (operation: FormDesignOperation) => {
    const failure = failures[operation];
    return failure === undefined
      ? null
      : graphqlError(
          failure.code as AuthErrorCode,
          failure.code,
          failure.extensions ?? {},
        );
  };
  const versionsOf = (formKey: string) => versions[formKey] ?? [];
  const draftOf = (formKey: string) =>
    versionsOf(formKey).find((item) => item.status === FormVersionStatus.Draft);
  const noIssues = { errors: [], warnings: [] };

  const lookupProviders = options.lookupProviders ?? BASE_LOOKUP_PROVIDERS;

  const handlers = [
    api.query(
      "FormLookupProviders",
      () =>
        fail("FormLookupProviders") ??
        HttpResponse.json({
          data: {
            formLookupProviders: {
              items: lookupProviders,
              totalCount: lookupProviders.length,
            },
          },
        }),
    ),
    // 屬性面板「欄位管理類別」的下拉(與欄位管理頁同一支查詢;設計器帶 `enabledOnly`,停用的類別不列)
    api.query("FieldCategories", ({ variables }) => {
      const { input } = variables as FieldCategoriesQueryVariables;
      const items =
        input?.enabledOnly === true
          ? fieldCategories.filter((category) => category.enabled)
          : fieldCategories;
      return HttpResponse.json({
        data: { fieldCategories: { items, totalCount: items.length } },
      });
    }),
    api.query("Forms", ({ variables }) => {
      const { input } = variables as FormsQueryVariables;
      const items = forms.filter(
        (form) => input.moduleKey == null || form.moduleKey === input.moduleKey,
      );
      return HttpResponse.json({
        data: {
          forms: { items, totalCount: items.length, page: 1, pageSize: 100 },
        },
      });
    }),
    api.query("FormEngineModules", () =>
      HttpResponse.json({
        data: {
          me: {
            modules: [
              {
                id: "m-demo-form",
                key: "demo-form",
                name: "示範表單(頂層)",
                engine: ModuleEngine.Form,
              },
              {
                id: "m-overview",
                key: "overview",
                name: "總覽",
                engine: ModuleEngine.Fixed,
              },
            ],
          },
        },
      }),
    ),
    api.query("FormVersions", ({ variables }) => {
      const { formKey } = variables as { formKey: string };
      const items = versionsOf(formKey);
      return HttpResponse.json({
        data: { formVersions: { items, totalCount: items.length } },
      });
    }),
    api.query("FormVersion", ({ variables }) => {
      const { formKey, version } = variables as FormVersionQueryVariables;
      const found =
        version == null
          ? draftOf(formKey)
          : versionsOf(formKey).find((item) => item.version === version);
      return found === undefined
        ? notFound()
        : HttpResponse.json({
            data: { formVersion: { formVersion: found, validation: noIssues } },
          });
    }),
    api.mutation("SaveFormVersionDraft", ({ variables }) => {
      const { input } = variables as SaveFormVersionDraftMutationVariables;
      inputs.saveFormVersionDraft.push(input);
      const draft = draftOf(input.formKey);
      if (draft === undefined) {
        return notFound();
      }
      const failure = fail("SaveFormVersionDraft");
      if (failure !== null) {
        return failure;
      }
      if (draft.draftRevision !== input.expectedDraftRevision) {
        return graphqlError("CONFLICT" as AuthErrorCode, "CONFLICT", {
          reason: "DRAFT_REVISION_MISMATCH",
        });
      }
      Object.assign(draft, {
        fields: input.fields,
        layout: input.layout,
        summaryMap: input.summaryMap,
        prefills: input.prefills,
        draftRevision: draft.draftRevision + 1,
      });
      return HttpResponse.json({
        data: {
          saveFormVersionDraft: { formVersion: draft, validation: noIssues },
        },
      });
    }),
    api.mutation("CreateFormVersionDraft", ({ variables }) => {
      const { input } = variables as CreateFormVersionDraftMutationVariables;
      inputs.createFormVersionDraft.push(input);
      const form = forms.find((item) => item.key === input.formKey);
      const base = versionsOf(input.formKey).find(
        (item) => item.version === input.baseVersion,
      );
      if (form === undefined) {
        return notFound();
      }
      const draft: FormVersionFieldsFragment = {
        ...(base ?? {
          fields: [],
          layout: { sections: [] },
          summaryMap: {},
          prefills: [],
        }),
        id: `ver-${input.formKey}-draft`,
        formKey: input.formKey,
        version: null,
        status: FormVersionStatus.Draft,
        draftRevision: 1,
        baseVersion: input.baseVersion ?? null,
        changelog: null,
        publishedAt: null,
        publishedBy: null,
        createdAt: "2026-09-21T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
      };
      versions[input.formKey] = [draft, ...versionsOf(input.formKey)];
      form.hasDraft = true;
      return HttpResponse.json({
        data: {
          createFormVersionDraft: { formVersion: draft, validation: noIssues },
        },
      });
    }),
    api.mutation("DeleteFormVersionDraft", ({ variables }) => {
      const { input } = variables as DeleteFormVersionDraftMutationVariables;
      inputs.deleteFormVersionDraft.push(input);
      const failure = fail("DeleteFormVersionDraft");
      if (failure !== null) {
        return failure;
      }
      const draft = draftOf(input.formKey);
      const form = forms.find((item) => item.key === input.formKey);
      if (draft === undefined || form === undefined) {
        return graphqlError("CONFLICT" as AuthErrorCode, "CONFLICT", {
          reason: "DRAFT_MISSING",
        });
      }
      if (draft.draftRevision !== input.expectedDraftRevision) {
        return graphqlError("CONFLICT" as AuthErrorCode, "CONFLICT", {
          reason: "DRAFT_REVISION_MISMATCH",
        });
      }
      versions[input.formKey] = versionsOf(input.formKey).filter(
        (item) => item !== draft,
      );
      form.hasDraft = false;
      return HttpResponse.json({
        data: { deleteFormVersionDraft: { form } },
      });
    }),
    api.mutation("PublishFormVersion", ({ variables }) => {
      const { input } = variables as PublishFormVersionMutationVariables;
      inputs.publishFormVersion.push(input);
      const failure = fail("PublishFormVersion");
      if (failure !== null) {
        return failure;
      }
      const draft = draftOf(input.formKey);
      const form = forms.find((item) => item.key === input.formKey);
      if (draft === undefined || form === undefined) {
        return notFound();
      }
      const next =
        Math.max(
          0,
          ...versionsOf(input.formKey).map((item) => item.version ?? 0),
        ) + 1;
      for (const item of versionsOf(input.formKey)) {
        if (item.status === FormVersionStatus.Published) {
          item.status = FormVersionStatus.Retired;
        }
      }
      Object.assign(draft, {
        status: FormVersionStatus.Published,
        version: next,
        changelog: input.changelog,
        publishedAt: "2026-09-21T00:00:00.000Z",
      });
      Object.assign(form, { currentVersion: next, hasDraft: false });
      return HttpResponse.json({
        data: { publishFormVersion: { formVersion: draft } },
      });
    }),
    formSeedExportHandler({
      findForm: (formKey) => forms.find((item) => item.key === formKey),
      versionsOf,
      fail,
      inputs,
    }),
    api.query("PreviewFormVersion", ({ variables }) => {
      const { input } = variables as PreviewFormVersionQueryVariables;
      inputs.previewFormVersion.push(input);
      return HttpResponse.json({
        data: {
          previewFormVersion: options.preview ?? {
            values: input.values ?? {},
            fieldStates: [],
            summary: { title: null, date: null, amount: null },
            fieldErrors: [],
          },
        },
      });
    }),
    api.query("RetiredFormPermissions", () =>
      HttpResponse.json({
        data: {
          retiredFormPermissions: {
            items: retired,
            totalCount: retired.length,
          },
        },
      }),
    ),
    api.mutation("DeleteRetiredPermission", ({ variables }) => {
      const { input } = variables as DeleteRetiredPermissionMutationVariables;
      inputs.deleteRetiredPermission.push(input);
      const outcome = options.retiredOutcomes?.[input.permissionKey];
      const needsConfirm = outcome?.extensions?.reasons;
      const isConfirmOnly =
        Array.isArray(needsConfirm) &&
        needsConfirm.includes("CONFIRM_REQUIRED");
      if (
        outcome !== undefined &&
        !(isConfirmOnly && input.confirmCompletedUsage === true)
      ) {
        return graphqlError(
          outcome.code as AuthErrorCode,
          outcome.code,
          outcome.extensions ?? {},
        );
      }
      const index = retired.findIndex(
        (item) => item.key === input.permissionKey,
      );
      const removed = index === -1 ? undefined : retired.splice(index, 1).at(0);
      return HttpResponse.json({
        data: {
          deleteRetiredPermission: {
            success: true,
            deletedKey: input.permissionKey,
            usage: removed?.usage ?? {
              draftCount: 0,
              draftVersions: [],
              completedCount: 0,
              completedVersions: [],
            },
          },
        },
      });
    }),
    api.mutation("SetModuleListColumns", ({ variables }) => {
      const { input } = variables as SetModuleListColumnsMutationVariables;
      inputs.setModuleListColumns.push(input);
      const failure = fail("SetModuleListColumns");
      return (
        failure ??
        HttpResponse.json({
          data: {
            setModuleListColumns: {
              moduleKey: input.moduleKey,
              columns: input.columns.map((column) => ({
                ...column,
                formKey: column.formKey ?? null,
              })),
              builtin: input.builtin ?? DEFAULT_LIST_BUILTIN_COLUMNS,
            },
          },
        })
      );
    }),
  ];

  return { handlers, inputs };
};
