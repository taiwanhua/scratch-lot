import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Connection, Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg, createUser } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  CREATE_FORM,
  FORM_LOOKUP,
  FORM_TEST_TIMEOUT_MS,
  M,
  MODULE_KEY,
  PASSWORD,
  VALIDATE_VERSION,
  assignForm,
  call,
  createOperator,
  createSubmitted,
  definitionOf,
  field,
  getSubmission,
  ok,
  publishNewForm,
  rootToken,
} from "../test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

interface LookupRow {
  id: string;
  label: string | null;
}

const SET_COLUMNS = /* GraphQL */ `
  mutation SetModuleListColumns($input: SetModuleListColumnsInput!) {
    setModuleListColumns(input: $input) {
      builtin {
        form
        status
        createdBy
      }
    }
  }
`;

const GET_COLUMNS = /* GraphQL */ `
  query ModuleListColumns($moduleKey: String!) {
    moduleListColumns(moduleKey: $moduleKey) {
      builtin {
        form
        status
        createdBy
      }
    }
  }
`;

interface BuiltinData {
  form: boolean;
  status: boolean;
  createdBy: boolean;
}

/**
 * 顯示模板(`labelTemplate`)與列表內建欄開關:
 * 真 GraphQL + 真 MongoDB(TEST-07)。
 */
describe("lookup 顯示模板與列表內建欄", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let root: string;
  let tenant: Types.ObjectId;

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-form-templates");
    connection = api.connection;
    root = await rootToken(api);
    tenant = await createOrg(connection, { name: "模板的租戶" });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("user 來源的 labelTemplate `{{name}}({{email}})`:formLookup 在後端組好 label", async () => {
    const wang = await createUser(connection, {
      account: "wang_tpl",
      password: PASSWORD,
      orgIds: [tenant],
    });
    await connection
      .collection("users")
      .updateOne(
        { _id: wang },
        { $set: { name: "王小明", email: "wang@x.com" } },
      );
    await publishNewForm(
      api,
      root,
      "tpl_user",
      definitionOf([
        field("title", "text"),
        field("who", "reference", {
          widget: { kind: "referencePicker" },
          source: {
            provider: "user",
            labelField: "name",
            labelTemplate: "{{name}}({{email}})",
          },
        }),
      ]),
    );
    await assignForm(api, root, "tpl_user", [tenant]);
    const found = await ok<{ formLookup: { items: LookupRow[] } }>(
      api,
      root,
      FORM_LOOKUP,
      {
        input: {
          formKey: "tpl_user",
          version: 1,
          target: { fieldKey: "who" },
          keyword: "wang_tpl",
        },
      },
    );
    expect(found.formLookup.items).toEqual([
      expect.objectContaining({
        id: String(wang),
        label: "王小明(wang@x.com)",
      }),
    ]);
  });

  it("模板引用的欄位讀不到就整串退回顯示欄:formLookup / 快照 / 現名解析三處一致", async () => {
    const li = await createUser(connection, {
      account: "li_tpl",
      password: PASSWORD,
      orgIds: [tenant],
    });
    await connection
      .collection("users")
      .updateOne({ _id: li }, { $set: { name: "李小華", email: "li@x.com" } });
    await publishNewForm(
      api,
      root,
      "tpl_ref",
      definitionOf([
        field("title", "text"),
        field("who", "reference", {
          widget: { kind: "referencePicker" },
          source: {
            provider: "user",
            labelField: "name",
            labelTemplate: "{{name}}({{email}})",
          },
        }),
      ]),
    );
    await assignForm(api, root, "tpl_ref", [tenant]);
    // 沒有使用者管理權限:讀不到 Email
    const staff = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view, M.create, M.edit],
    });
    const lookup = (token: string) =>
      ok<{ formLookup: { items: LookupRow[] } }>(api, token, FORM_LOOKUP, {
        input: {
          formKey: "tpl_ref",
          version: 1,
          target: { fieldKey: "who" },
          keyword: "li_tpl",
        },
      });

    // (1) 有使用者管理權限的讀者:套模板;沒權限的讀者:只有顯示欄,不留括號
    const byRoot = await lookup(root);
    expect(byRoot.formLookup.items).toEqual([
      expect.objectContaining({ id: String(li), label: "李小華(li@x.com)" }),
    ]);
    const byStaff = await lookup(staff.token);
    expect(byStaff.formLookup.items).toEqual([
      expect.objectContaining({ id: String(li), label: "李小華" }),
    ]);

    // (3) 快照一律只讀公開欄位(publicOnly):存「李小華」
    const submitted = await createSubmitted(api, staff.token, "tpl_ref", {
      title: "找人",
      who: { id: String(li) },
    });
    expect(submitted.values.who).toEqual({ id: String(li), label: "李小華" });

    // (2) 現名解析依讀者權限:沒權限 → 顯示欄
    const shown = await getSubmission(api, staff.token, submitted.id);
    expect(shown.displayValues).toEqual([
      {
        fieldKey: "who",
        items: [{ value: String(li), label: "李小華", available: true }],
      },
    ]);

    // (4) 來源使用者被刪:沒權限的讀者看到快照「李小華」+ 來源不可用
    await connection
      .collection("users")
      .updateOne({ _id: li }, { $set: { deletedAt: new Date() } });
    const removed = await getSubmission(api, staff.token, submitted.id);
    expect(removed.displayValues).toEqual([
      {
        fieldKey: "who",
        items: [{ value: String(li), label: "李小華", available: false }],
      },
    ]);
  });

  it("form_submission 來源:摘要槽 + `{{value.<key>}}`,日期依讀者租戶時區、選項印 label", async () => {
    await publishNewForm(
      api,
      root,
      "tpl_src",
      definitionOf(
        [field("title", "text"), field("day", "date"), field("kind", "select")],
        { summaryMap: { title: "title", date: "day" } },
      ),
    );
    await assignForm(api, root, "tpl_src", [tenant]);
    const source = await createSubmitted(api, root, "tpl_src", {
      title: "病假單",
      day: "2026-09-25T16:00:00.000Z",
      kind: "sick",
    });
    await publishNewForm(
      api,
      root,
      "tpl_dst",
      definitionOf([
        field("title", "text"),
        field("ref", "reference", {
          widget: { kind: "referencePicker" },
          source: {
            provider: "form_submission",
            formKey: "tpl_src",
            labelField: "title",
            labelTemplate: "{{title}}・{{date}}・{{value.kind}}",
          },
        }),
      ]),
    );
    await assignForm(api, root, "tpl_dst", [tenant]);
    const found = await ok<{ formLookup: { items: LookupRow[] } }>(
      api,
      root,
      FORM_LOOKUP,
      {
        input: {
          formKey: "tpl_dst",
          version: 1,
          target: { fieldKey: "ref" },
        },
      },
    );
    expect(found.formLookup.items).toEqual([
      expect.objectContaining({
        id: source.id,
        label: "病假單・2026-09-26・病假",
      }),
    ]);
  });

  it("檢查器:顯示模板用了 provider 回不了的佔位符 → LOOKUP_TEMPLATE_UNKNOWN_PLACEHOLDER", async () => {
    await ok(api, root, CREATE_FORM, {
      input: { key: "tpl_check", moduleKey: MODULE_KEY, name: "模板檢查" },
    });
    const report = await ok<{
      validateFormVersion: {
        errors: { code: string; location: Record<string, unknown> }[];
      };
    }>(api, root, VALIDATE_VERSION, {
      input: {
        formKey: "tpl_check",
        ...definitionOf([
          field("title", "text"),
          field("who", "reference", {
            widget: { kind: "referencePicker" },
            source: {
              provider: "user",
              labelField: "name",
              labelTemplate: "{{name}} {{phone}}",
            },
          }),
          field("ref", "reference", {
            widget: { kind: "referencePicker" },
            source: {
              provider: "form_submission",
              formKey: "tpl_src",
              labelField: "title",
              labelTemplate: "{{title}} {{value.nope}}",
            },
          }),
        ]),
      },
    });
    const templateErrors = report.validateFormVersion.errors.filter(
      (issue) => issue.code === "LOOKUP_TEMPLATE_UNKNOWN_PLACEHOLDER",
    );
    expect(templateErrors.map((issue) => issue.location)).toEqual([
      expect.objectContaining({
        fieldKey: "who",
        property: "source.labelTemplate",
      }),
      expect.objectContaining({
        fieldKey: "ref",
        property: "source.labelTemplate",
      }),
    ]);
  });

  it("列表內建欄開關:預設全開;setModuleListColumns 存得住,缺席 = 保留", async () => {
    const initial = await ok<{ moduleListColumns: { builtin: BuiltinData } }>(
      api,
      root,
      GET_COLUMNS,
      { moduleKey: MODULE_KEY },
    );
    expect(initial.moduleListColumns.builtin).toEqual({
      form: true,
      status: true,
      createdBy: true,
    });
    const off = { form: false, status: true, createdBy: false };
    const saved = await ok<{ setModuleListColumns: { builtin: BuiltinData } }>(
      api,
      root,
      SET_COLUMNS,
      { input: { moduleKey: MODULE_KEY, columns: [], builtin: off } },
    );
    expect(saved.setModuleListColumns.builtin).toEqual(off);
    await ok(api, root, SET_COLUMNS, {
      input: { moduleKey: MODULE_KEY, columns: [] },
    });
    const read = await ok<{ moduleListColumns: { builtin: BuiltinData } }>(
      api,
      root,
      GET_COLUMNS,
      { moduleKey: MODULE_KEY },
    );
    expect(read.moduleListColumns.builtin).toEqual(off);
    // 少給一個鍵:GraphQL 型別擋下(三個開關一起送)
    const partial = await call(api, root, SET_COLUMNS, {
      input: { moduleKey: MODULE_KEY, columns: [], builtin: { form: true } },
    });
    expect(partial.errors).toBeDefined();
  });
});
