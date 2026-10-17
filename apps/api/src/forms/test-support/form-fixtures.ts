import { expect } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import {
  ARRAY_COLUMN_WIDGETS,
  type ArrayColumnDef,
  type ArrayColumnType,
  type FieldDef,
  type FieldType,
  type FormDefinition,
} from "@repo/domain/form";

import {
  type AuthTestApp,
  type GraphqlResult,
  ROOT_ADMIN,
} from "../../auth/test-support/auth-app";
import { createUser } from "../../auth/test-support/fixtures";
import { createRole } from "../../permission/test-support/fixtures";

/**
 * 表單引擎 api 測試的共用夾具:GraphQL 文件、定義產生器、建操作者、設計 → 發布 → 分派的捷徑。
 * 測試檔只寫行為(TEST-07;同示範模組的分檔方式)。
 */

/**
 * 表單測試的單一測試逾時。一個情境要走「建表單 → 發布 → 分派 → 填寫 → 送出 → 讀」十幾次 GraphQL 往返,
 * CI runner 在 turbo 並行跑全部套件時會超過 jest 預設的 5 秒(曾偶發紅燈),各測試檔以 `jest.setTimeout` 放寬。
 */
export const FORM_TEST_TIMEOUT_MS = 60_000;

export const PASSWORD = ["form", "pass", "word"].join("-");
export const MODULE_KEY = "demo-form";
/** 表單模組的四筆個別權限。 */
export const M = {
  view: `${MODULE_KEY}.view`,
  create: `${MODULE_KEY}.create`,
  edit: `${MODULE_KEY}.edit`,
  delete: `${MODULE_KEY}.delete`,
  all: `${MODULE_KEY}.*`,
} as const;
/** 表單管理(`system.forms`)。 */
export const F = {
  view: "system.forms.view",
  create: "system.forms.create",
  edit: "system.forms.edit",
  assign: "system.forms.assign",
  setEnabled: "system.forms.set-enabled",
  all: "system.forms.*",
} as const;
export const FORMS_MODULES = ["system", "system.forms"];

export function showKey(formKey: string, fieldKey: string): string {
  return `${MODULE_KEY}.show-${formKey}-${fieldKey}`;
}

export function editKey(formKey: string, fieldKey: string): string {
  return `${MODULE_KEY}.edit-${formKey}-${fieldKey}`;
}

// ---- 定義產生器 ----

const DEFAULT_WIDGET: Record<FieldType, string> = {
  text: "textField",
  multiline: "textArea",
  number: "number",
  date: "datePicker",
  datetime: "dateTimePicker",
  select: "dropdown",
  multiSelect: "checkboxGroup",
  boolean: "switch",
  upload: "upload",
  reference: "referencePicker",
  array: "table",
};

export function field(
  key: string,
  type: FieldType,
  overrides: Partial<FieldDef> = {},
): FieldDef {
  return {
    key,
    label: key,
    type,
    widget: { kind: DEFAULT_WIDGET[type] },
    valueSource: { kind: "input" },
    ...(type === "number" ? { precision: 0 } : {}),
    ...(type === "select" || type === "multiSelect"
      ? {
          options: {
            kind: "static" as const,
            items: [
              { value: "sick", label: "病假", order: 1, enabled: true },
              { value: "annual", label: "特休", order: 2, enabled: true },
            ],
          },
        }
      : {}),
    ...overrides,
  };
}

/** 明細列的一個子欄(元件用該型別白名單的第一個)。 */
export function column(
  key: string,
  type: ArrayColumnType,
  overrides: Partial<ArrayColumnDef> = {},
): ArrayColumnDef {
  return {
    key,
    label: key,
    type,
    widget: { kind: ARRAY_COLUMN_WIDGETS[type][0] ?? "textField" },
    valueSource: { kind: "input" },
    ...(type === "number" ? { precision: 0 } : {}),
    ...overrides,
  };
}

/** 每個非固定值欄位各一列 + 標題槽對 `title`(沒給就對第一個文字欄位)。 */
export function definitionOf(
  fields: FieldDef[],
  overrides: Partial<FormDefinition> = {},
): FormDefinition {
  const placed = fields.filter(
    (candidate) => candidate.valueSource.kind !== "constant",
  );
  return {
    fields,
    layout: {
      sections: [
        {
          key: "basic",
          title: "基本資料",
          rows: placed.map((candidate) => ({
            cols: [{ fieldKey: candidate.key, span: 12 }],
          })),
        },
      ],
    },
    summaryMap: {
      title: fields.find((candidate) => candidate.type === "text")?.key ?? null,
    },
    prefills: [],
    ...overrides,
  };
}

// ---- GraphQL 文件 ----

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const FORM_FIELDS = /* GraphQL */ `
  fragment FormFields on FormModel {
    id
    key
    moduleKey
    name
    isShared
    ownerOrgId
    forkedFrom {
      formKey
      version
    }
    currentVersion
    tabLabelTemplate
    hasDraft
    tenantEnabled
    assignments {
      tenantOrgId
      enabled
    }
    abilities {
      canEdit
      canAssign
      canSetEnabled
      canFork
    }
  }
`;

const VERSION_FIELDS = /* GraphQL */ `
  fragment VersionFields on FormVersionModel {
    id
    formKey
    version
    status
    draftRevision
    baseVersion
    fields
    layout
    summaryMap
    prefills
    changelog
    publishedAt
  }
`;

export const FORMS = /* GraphQL */ `
  ${FORM_FIELDS}
  query Forms($input: FormsInput!) {
    forms(input: $input) {
      items {
        ...FormFields
      }
      totalCount
    }
  }
`;

export const FORM = /* GraphQL */ `
  ${FORM_FIELDS}
  query Form($key: ID!) {
    form(key: $key) {
      form {
        ...FormFields
      }
    }
  }
`;

export const CREATE_FORM = /* GraphQL */ `
  ${FORM_FIELDS}
  mutation CreateForm($input: CreateFormInput!) {
    createForm(input: $input) {
      form {
        ...FormFields
      }
    }
  }
`;

export const UPDATE_FORM = /* GraphQL */ `
  ${FORM_FIELDS}
  mutation UpdateForm($input: UpdateFormInput!) {
    updateForm(input: $input) {
      form {
        ...FormFields
      }
    }
  }
`;

export const FORK_FORM = /* GraphQL */ `
  ${FORM_FIELDS}
  mutation ForkForm($input: ForkFormInput!) {
    forkForm(input: $input) {
      form {
        ...FormFields
      }
    }
  }
`;

export const FORM_VERSION = /* GraphQL */ `
  ${VERSION_FIELDS}
  query FormVersion($formKey: ID!, $version: Int) {
    formVersion(formKey: $formKey, version: $version) {
      formVersion {
        ...VersionFields
      }
      validation {
        errors {
          code
        }
        warnings {
          code
        }
      }
    }
  }
`;

export const FORM_VERSIONS = /* GraphQL */ `
  ${VERSION_FIELDS}
  query FormVersions($formKey: ID!) {
    formVersions(formKey: $formKey) {
      items {
        ...VersionFields
      }
      totalCount
    }
  }
`;

export const CREATE_DRAFT = /* GraphQL */ `
  ${VERSION_FIELDS}
  mutation CreateFormVersionDraft($input: CreateFormVersionDraftInput!) {
    createFormVersionDraft(input: $input) {
      formVersion {
        ...VersionFields
      }
    }
  }
`;

export const SAVE_DRAFT = /* GraphQL */ `
  ${VERSION_FIELDS}
  mutation SaveFormVersionDraft($input: SaveFormVersionDraftInput!) {
    saveFormVersionDraft(input: $input) {
      formVersion {
        ...VersionFields
      }
      validation {
        errors {
          code
        }
      }
    }
  }
`;

export const PUBLISH = /* GraphQL */ `
  ${VERSION_FIELDS}
  mutation PublishFormVersion($input: PublishFormVersionInput!) {
    publishFormVersion(input: $input) {
      formVersion {
        ...VersionFields
      }
    }
  }
`;

export const RETIRE_CURRENT = /* GraphQL */ `
  ${FORM_FIELDS}
  mutation RetireCurrentVersion($input: RetireCurrentVersionInput!) {
    retireCurrentVersion(input: $input) {
      form {
        ...FormFields
      }
    }
  }
`;

export const VALIDATE_VERSION = /* GraphQL */ `
  query ValidateFormVersion($input: ValidateFormVersionInput!) {
    validateFormVersion(input: $input) {
      errors {
        code
        location
      }
      warnings {
        code
      }
    }
  }
`;

export const PREVIEW_VERSION = /* GraphQL */ `
  query PreviewFormVersion($input: PreviewFormVersionInput!) {
    previewFormVersion(input: $input) {
      values
      fieldStates {
        key
        visible
        readonly
        redacted
      }
      summary {
        title
      }
      fieldErrors {
        fieldKey
        code
      }
    }
  }
`;

export const ASSIGN = /* GraphQL */ `
  ${FORM_FIELDS}
  mutation AssignFormToTenants($input: AssignFormToTenantsInput!) {
    assignFormToTenants(input: $input) {
      form {
        ...FormFields
      }
    }
  }
`;

export const REVOKE = /* GraphQL */ `
  ${FORM_FIELDS}
  mutation RevokeFormFromTenant($input: RevokeFormFromTenantInput!) {
    revokeFormFromTenant(input: $input) {
      form {
        ...FormFields
      }
    }
  }
`;

export const SET_TENANT_ENABLED = /* GraphQL */ `
  ${FORM_FIELDS}
  mutation SetTenantFormEnabled($input: SetTenantFormEnabledInput!) {
    setTenantFormEnabled(input: $input) {
      form {
        ...FormFields
      }
    }
  }
`;

export const RETIRED_PERMISSIONS = /* GraphQL */ `
  query RetiredFormPermissions {
    retiredFormPermissions {
      items {
        key
        name
        formKey
        fieldKey
        action
        usage {
          draftCount
          draftVersions
          completedCount
          completedVersions
        }
      }
      totalCount
    }
  }
`;

export const DELETE_RETIRED_PERMISSION = /* GraphQL */ `
  mutation DeleteRetiredPermission($input: DeleteRetiredPermissionInput!) {
    deleteRetiredPermission(input: $input) {
      success
      deletedKey
      usage {
        draftCount
        completedCount
      }
    }
  }
`;

export const MODULE_FORMS = /* GraphQL */ `
  query ModuleForms($moduleKey: ID!) {
    moduleForms(moduleKey: $moduleKey) {
      key
      name
      currentVersion
    }
  }
`;

const SUBMISSION_FIELDS = /* GraphQL */ `
  fragment SubmissionFields on FormSubmissionModel {
    id
    moduleKey
    formKey
    version
    status
    revision
    viewedRevision
    values
    fieldStates {
      key
      visible
      readonly
      redacted
    }
    displayValues {
      fieldKey
      items {
        value
        label
        available
      }
    }
    summary {
      title
      date
      amount
    }
    ctx {
      at
      timezone
      userId
      orgId
    }
    revisions {
      revision
      at
    }
    touched
    editVersion
    submittedAt
    abilities {
      canEdit
      canDelete
      canEditField
    }
  }
`;

export const FORM_SUBMISSIONS = /* GraphQL */ `
  ${SUBMISSION_FIELDS}
  query FormSubmissions($input: FormSubmissionsInput!) {
    formSubmissions(input: $input) {
      items {
        ...SubmissionFields
      }
      totalCount
    }
  }
`;

export const FORM_SUBMISSION = /* GraphQL */ `
  ${SUBMISSION_FIELDS}
  query FormSubmission($id: ID!, $revision: Int) {
    formSubmission(id: $id, revision: $revision) {
      submission {
        ...SubmissionFields
      }
    }
  }
`;

export const CREATE_FORM_DRAFT = /* GraphQL */ `
  ${SUBMISSION_FIELDS}
  mutation CreateFormDraft($input: CreateFormDraftInput!) {
    createFormDraft(input: $input) {
      submission {
        ...SubmissionFields
      }
    }
  }
`;

export const SAVE_FORM_DRAFT = /* GraphQL */ `
  ${SUBMISSION_FIELDS}
  mutation SaveFormDraft($input: SaveFormDraftInput!) {
    saveFormDraft(input: $input) {
      submission {
        ...SubmissionFields
      }
    }
  }
`;

export const SUBMIT = /* GraphQL */ `
  ${SUBMISSION_FIELDS}
  mutation SubmitFormSubmission($input: SubmitFormSubmissionInput!) {
    submitFormSubmission(input: $input) {
      submission {
        ...SubmissionFields
      }
    }
  }
`;

export const UPDATE_SUBMISSION = /* GraphQL */ `
  ${SUBMISSION_FIELDS}
  mutation UpdateFormSubmission($input: UpdateFormSubmissionInput!) {
    updateFormSubmission(input: $input) {
      submission {
        ...SubmissionFields
      }
    }
  }
`;

export const DELETE_SUBMISSION = /* GraphQL */ `
  mutation DeleteFormSubmission($input: DeleteFormSubmissionInput!) {
    deleteFormSubmission(input: $input) {
      success
      deletedId
    }
  }
`;

export const FORM_LOOKUP = /* GraphQL */ `
  query FormLookup($input: FormLookupInput!) {
    formLookup(input: $input) {
      items {
        id
        value
        label
        values
      }
      totalCount
    }
  }
`;

export const FORM_LOOKUP_RECORD = /* GraphQL */ `
  query FormLookupRecord($input: FormLookupRecordInput!) {
    formLookupRecord(input: $input) {
      record {
        id
        value
        label
        values
      }
    }
  }
`;

// ---- 形狀 ----

export interface FormRow {
  id: string;
  key: string;
  moduleKey: string;
  name: string;
  isShared: boolean;
  ownerOrgId: string | null;
  forkedFrom: { formKey: string; version: number } | null;
  currentVersion: number | null;
  hasDraft: boolean;
  tenantEnabled: boolean | null;
  assignments: { tenantOrgId: string; enabled: boolean }[];
  abilities: {
    canEdit: boolean;
    canAssign: boolean;
    canSetEnabled: boolean;
    canFork: boolean;
  };
}

export interface VersionRow {
  id: string;
  formKey: string;
  version: number | null;
  status: string;
  draftRevision: number;
  baseVersion: number | null;
  fields: FieldDef[];
  changelog: string | null;
}

export interface SubmissionRow {
  id: string;
  moduleKey: string;
  formKey: string;
  version: number;
  status: string;
  revision: number;
  viewedRevision: number;
  values: Record<string, unknown>;
  fieldStates: {
    key: string;
    visible: boolean;
    readonly: boolean;
    redacted: boolean;
  }[];
  displayValues: {
    fieldKey: string;
    items: { value: string; label: string | null; available: boolean }[];
  }[];
  summary: {
    title: string | null;
    date: string | null;
    amount: string | null;
  } | null;
  ctx: {
    at: string;
    timezone: string;
    userId: string | null;
    orgId: string | null;
  } | null;
  revisions: { revision: number; at: string }[];
  touched: string[];
  editVersion: number;
  submittedAt: string | null;
  abilities: { canEdit: boolean; canDelete: boolean; canEditField: string[] };
}

// ---- 呼叫 ----

export function codeOf(result: GraphqlResult<unknown>): string | undefined {
  return result.errors?.[0]?.extensions?.code;
}

export function extensionsOf(
  result: GraphqlResult<unknown>,
): Record<string, unknown> {
  return result.errors?.[0]?.extensions ?? {};
}

/** 呼叫並斷言沒有錯誤,回 data。 */
export async function ok<TData>(
  api: AuthTestApp,
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<TData> {
  const result = await api.graphql<TData>(query, variables, {
    accessToken: token,
  });
  if (result.errors) {
    throw new Error(`GraphQL 錯誤:${JSON.stringify(result.errors)}`);
  }
  if (!result.data) {
    throw new Error("GraphQL 沒有回資料");
  }
  return result.data;
}

export function call<TData = Record<string, unknown>>(
  api: AuthTestApp,
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<GraphqlResult<TData>> {
  return api.graphql<TData>(query, variables, { accessToken: token });
}

export async function login(
  api: AuthTestApp,
  account: string,
  password = PASSWORD,
): Promise<string> {
  const result = await api.graphql<{ login: { accessToken: string } }>(LOGIN, {
    input: { account, password },
  });
  expect(result.errors).toBeUndefined();
  const token = result.data?.login.accessToken;
  if (!token) {
    throw new Error(`登入失敗:${account}`);
  }
  return token;
}

export function rootToken(api: AuthTestApp): Promise<string> {
  return login(api, ROOT_ADMIN.account, ROOT_ADMIN.password);
}

let accountSequence = 0;

export interface FormOperator {
  userId: Types.ObjectId;
  roleId: Types.ObjectId;
  token: string;
}

/** 建一個操作者(所屬組織第一個 = 當前組織)並登入。 */
export async function createOperator(
  api: AuthTestApp,
  connection: Connection,
  options: {
    orgId: Types.ObjectId;
    permissionKeys: string[];
    moduleKeys?: string[];
    ownerOrgId?: Types.ObjectId;
  },
): Promise<FormOperator> {
  accountSequence += 1;
  const account = `form-user-${String(accountSequence)}`;
  const userId = await createUser(connection, {
    account,
    password: PASSWORD,
    orgIds: [options.orgId],
  });
  const roleId = await createRole(api.app, connection, {
    name: `表單測試角色 ${account}`,
    ownerOrgId: options.ownerOrgId ?? options.orgId,
    moduleKeys: options.moduleKeys ?? [MODULE_KEY],
    permissionKeys: options.permissionKeys,
    assignTo: [userId],
  });
  return { userId, roleId, token: await login(api, account) };
}

interface FormData {
  form: FormRow;
}

/** root 建共用表單 → 開草稿 → 存定義 → 發布,回發布後的版本。 */
export async function publishNewForm(
  api: AuthTestApp,
  token: string,
  key: string,
  definition: FormDefinition,
  name = `表單 ${key}`,
): Promise<VersionRow> {
  await ok(api, token, CREATE_FORM, {
    input: { key, moduleKey: MODULE_KEY, name },
  });
  return publishDefinition(api, token, key, definition, null);
}

/** 開草稿(以 `baseVersion` 為基底)→ 存定義 → 發布。 */
export async function publishDefinition(
  api: AuthTestApp,
  token: string,
  formKey: string,
  definition: FormDefinition,
  baseVersion: number | null,
): Promise<VersionRow> {
  const draft = await ok<{
    createFormVersionDraft: { formVersion: VersionRow };
  }>(api, token, CREATE_DRAFT, { input: { formKey, baseVersion } });
  return publishDraft(
    api,
    token,
    formKey,
    definition,
    draft.createFormVersionDraft.formVersion.draftRevision,
  );
}

/** 對已存在的草稿存定義 → 發布。 */
export async function publishDraft(
  api: AuthTestApp,
  token: string,
  formKey: string,
  definition: FormDefinition,
  draftRevision: number,
): Promise<VersionRow> {
  const saved = await saveDefinition(
    api,
    token,
    formKey,
    definition,
    draftRevision,
  );
  const published = await ok<{
    publishFormVersion: { formVersion: VersionRow };
  }>(api, token, PUBLISH, {
    input: {
      formKey,
      expectedDraftRevision: saved.draftRevision,
      changelog: "測試發布",
    },
  });
  return published.publishFormVersion.formVersion;
}

export async function saveDefinition(
  api: AuthTestApp,
  token: string,
  formKey: string,
  definition: FormDefinition,
  expectedDraftRevision: number,
): Promise<VersionRow> {
  const saved = await ok<{ saveFormVersionDraft: { formVersion: VersionRow } }>(
    api,
    token,
    SAVE_DRAFT,
    {
      input: {
        formKey,
        expectedDraftRevision,
        ...definition,
      },
    },
  );
  return saved.saveFormVersionDraft.formVersion;
}

export async function assignForm(
  api: AuthTestApp,
  token: string,
  formKey: string,
  tenantIds: Types.ObjectId[],
): Promise<FormRow> {
  const data = await ok<{ assignFormToTenants: FormRow }>(api, token, ASSIGN, {
    input: { formKey, tenantOrgIds: tenantIds.map(String) },
  });
  return data.assignFormToTenants;
}

export async function getForm(
  api: AuthTestApp,
  token: string,
  key: string,
): Promise<FormRow> {
  const data = await ok<{ form: FormData }>(api, token, FORM, { key });
  return data.form.form;
}

let requestSequence = 0;

export function nextRequestId(): string {
  requestSequence += 1;
  return `request-${String(requestSequence)}`;
}

export async function createDraft(
  api: AuthTestApp,
  token: string,
  formKey: string,
  values: Record<string, unknown> = {},
  clientRequestId = nextRequestId(),
): Promise<SubmissionRow> {
  const data = await ok<{ createFormDraft: { submission: SubmissionRow } }>(
    api,
    token,
    CREATE_FORM_DRAFT,
    { input: { formKey, clientRequestId, values } },
  );
  return data.createFormDraft.submission;
}

export async function submitDraft(
  api: AuthTestApp,
  token: string,
  draft: SubmissionRow,
): Promise<SubmissionRow> {
  const data = await ok<{
    submitFormSubmission: { submission: SubmissionRow };
  }>(api, token, SUBMIT, {
    input: { id: draft.id, expectedEditVersion: draft.editVersion },
  });
  return data.submitFormSubmission.submission;
}

/** 建草稿並直接送出(畫面上的一顆「送出」)。 */
export async function createSubmitted(
  api: AuthTestApp,
  token: string,
  formKey: string,
  values: Record<string, unknown>,
): Promise<SubmissionRow> {
  return submitDraft(
    api,
    token,
    await createDraft(api, token, formKey, values),
  );
}

export async function getSubmission(
  api: AuthTestApp,
  token: string,
  id: string,
  revision?: number,
): Promise<SubmissionRow> {
  const data = await ok<{ formSubmission: { submission: SubmissionRow } }>(
    api,
    token,
    FORM_SUBMISSION,
    { id, ...(revision === undefined ? {} : { revision }) },
  );
  return data.formSubmission.submission;
}

/** 讀原始提交(驗資料庫最終狀態)。 */
export function rawSubmission(
  connection: Connection,
  id: string,
): Promise<Record<string, unknown> | null> {
  return connection
    .collection("form_submissions")
    .findOne<Record<string, unknown>>({
      _id: new Types.ObjectId(id),
    });
}
