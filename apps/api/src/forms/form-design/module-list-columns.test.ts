import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Connection, Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  FORM_SUBMISSIONS,
  FORM_TEST_TIMEOUT_MS,
  M,
  MODULE_KEY,
  type SubmissionRow,
  VALIDATE_VERSION,
  assignForm,
  call,
  codeOf,
  createOperator,
  createSubmitted,
  definitionOf,
  extensionsOf,
  field,
  ok,
  publishDefinition,
  publishNewForm,
  rootToken,
  showKey,
} from "../test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

const SET_COLUMNS = /* GraphQL */ `
  mutation SetModuleListColumns($input: SetModuleListColumnsInput!) {
    setModuleListColumns(input: $input) {
      columns {
        kind
        key
        formKey
        label
        width
        order
      }
    }
  }
`;

const GET_COLUMNS = /* GraphQL */ `
  query ModuleListColumns($moduleKey: String!) {
    moduleListColumns(moduleKey: $moduleKey) {
      columns {
        kind
        key
        formKey
        label
        width
        order
      }
    }
  }
`;

/** 一欄合格的組合欄,`overrides` 換掉其中幾個鍵。 */
function template(overrides: Record<string, unknown>) {
  return {
    kind: "TEMPLATE",
    key: "{{title}}",
    label: "標題",
    width: 200,
    order: 0,
    ...overrides,
  };
}

interface ColumnRow {
  kind: string;
  key: string;
  formKey: string | null;
  label: string | null;
  width: number;
  order: number;
}

/**
 * 列表欄位配置的組合欄(`kind: TEMPLATE`):存檔驗證、讀回、權限遮蔽、定義檢查器的引用警告。
 * 真 GraphQL + 真 MongoDB(TEST-07)。顯示字串由前端依每一筆的(已套欄位級權限的)值組,見 admin 的元件測試。
 */
describe("列表欄位配置:組合欄", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let root: string;
  let tenant: Types.ObjectId;

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-list-template-columns");
    connection = api.connection;
    root = await rootToken(api);
    tenant = await createOrg(connection, { name: "組合欄的租戶" });
    await publishNewForm(
      api,
      root,
      "tpl_shift",
      definitionOf([
        field("title", "text"),
        field("start_at", "datetime"),
        field("end_at", "datetime"),
        field("secret", "text", { permission: { show: true, edit: false } }),
        field("note", "text"),
      ]),
    );
    await assignForm(api, root, "tpl_shift", [tenant]);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  function setColumns(columns: Record<string, unknown>[]) {
    return call(api, root, SET_COLUMNS, {
      input: { moduleKey: MODULE_KEY, columns },
    });
  }

  it("存得住、讀得回:模板與欄名去頭尾空白,欄名只給組合欄", async () => {
    const saved = await ok<{
      setModuleListColumns: { columns: ColumnRow[] };
    }>(api, root, SET_COLUMNS, {
      input: {
        moduleKey: MODULE_KEY,
        columns: [
          { kind: "SLOT", key: "title", width: 200, order: 0, label: "忽略" },
          {
            kind: "TEMPLATE",
            key: "  {{value.start_at}}–{{value.end_at}} ",
            label: " 時段 ",
            width: 220,
            order: 1,
          },
          {
            kind: "TEMPLATE",
            key: "{{serialNo}} {{title}}",
            formKey: "tpl_shift",
            label: "單號與標題",
            width: 260,
            order: 2,
          },
        ],
      },
    });
    expect(saved.setModuleListColumns.columns).toEqual([
      {
        kind: "SLOT",
        key: "title",
        formKey: null,
        label: null,
        width: 200,
        order: 0,
      },
      {
        kind: "TEMPLATE",
        key: "{{value.start_at}}–{{value.end_at}}",
        formKey: null,
        label: "時段",
        width: 220,
        order: 1,
      },
      {
        kind: "TEMPLATE",
        key: "{{serialNo}} {{title}}",
        formKey: "tpl_shift",
        label: "單號與標題",
        width: 260,
        order: 2,
      },
    ]);
    const staff = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view],
    });
    const read = await ok<{ moduleListColumns: { columns: ColumnRow[] } }>(
      api,
      staff.token,
      GET_COLUMNS,
      { moduleKey: MODULE_KEY },
    );
    expect(read.moduleListColumns.columns).toEqual(
      saved.setModuleListColumns.columns,
    );
  });

  it("欄名 / 模板格式錯定位到 .label / .template(沒有 reason)", async () => {
    for (const [overrides, path] of [
      [{ label: "  " }, "columns.0.label"],
      [{ label: null }, "columns.0.label"],
      [{ label: "字".repeat(51) }, "columns.0.label"],
      [{ key: "沒有佔位符" }, "columns.0.template"],
      [{ key: "{{applicant}}" }, "columns.0.template"],
      [{ key: "{{value.Bad-Key}}" }, "columns.0.template"],
      [{ key: `{{title}}${"x".repeat(200)}` }, "columns.0.template"],
    ] as const) {
      const result = await setColumns([template(overrides)]);
      expect(codeOf(result)).toBe("VALIDATION_FAILED");
      expect(extensionsOf(result).fields).toEqual([path]);
      expect(extensionsOf(result).reason).toBeUndefined();
    }
  });

  it("佔位符的欄位照表單欄位欄的規則:不在目前版本 / 限定的表單不存在 → UNAVAILABLE,受保護 → PROTECTED,重複 → DUPLICATE", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ key: "{{value.no_such}}" }, "LIST_COLUMN_UNAVAILABLE"],
      [
        { key: "{{title}}", formKey: "no_such_form" },
        "LIST_COLUMN_UNAVAILABLE",
      ],
      [{ key: "{{value.note}} {{value.secret}}" }, "LIST_COLUMN_PROTECTED"],
    ];
    for (const [overrides, reason] of cases) {
      const result = await setColumns([
        {
          kind: "TEMPLATE",
          label: "組合",
          width: 200,
          order: 0,
          ...overrides,
        },
      ]);
      expect(codeOf(result)).toBe("VALIDATION_FAILED");
      expect(extensionsOf(result).fields).toEqual(["columns.0"]);
      expect(extensionsOf(result).reason).toBe(reason);
    }
    const duplicate = await setColumns([
      { kind: "TEMPLATE", key: "{{title}}", label: "A", width: 200, order: 0 },
      {
        kind: "TEMPLATE",
        key: " {{title}}",
        label: "B",
        width: 200,
        order: 1,
      },
    ]);
    expect(extensionsOf(duplicate).fields).toEqual(["columns.1"]);
    expect(extensionsOf(duplicate).reason).toBe("LIST_COLUMN_DUPLICATE");
  });

  it("模板引用的欄位改版後變受保護:沒有 show 權限的讀者在列表拿到的值是遮蔽的,組合欄組不出原值", async () => {
    await publishNewForm(
      api,
      root,
      "tpl_later",
      definitionOf([field("title", "text"), field("memo", "text")]),
    );
    await assignForm(api, root, "tpl_later", [tenant]);
    await ok(api, root, SET_COLUMNS, {
      input: {
        moduleKey: MODULE_KEY,
        columns: [
          {
            kind: "TEMPLATE",
            key: "{{title}}/{{value.memo}}",
            formKey: "tpl_later",
            label: "標題與備註",
            width: 240,
            order: 0,
          },
        ],
      },
    });
    // 改版:memo 變受保護(存好的配置不自動清)
    await publishDefinition(
      api,
      root,
      "tpl_later",
      definitionOf([
        field("title", "text"),
        field("memo", "text", { permission: { show: true, edit: false } }),
      ]),
      1,
    );
    const writer = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view, M.create, M.edit, showKey("tpl_later", "memo")],
    });
    await createSubmitted(api, writer.token, "tpl_later", {
      title: "改版後",
      memo: "機密備註",
    });
    const reader = await createOperator(api, connection, {
      orgId: tenant,
      permissionKeys: [M.view],
    });
    const listed = await ok<{
      formSubmissions: { items: SubmissionRow[] };
    }>(api, reader.token, FORM_SUBMISSIONS, {
      input: { moduleKey: MODULE_KEY, formKey: "tpl_later", page: 1 },
    });
    const [row] = listed.formSubmissions.items;
    expect(row?.values.title).toBe("改版後");
    expect(row?.values.memo).not.toBe("機密備註");
    expect(JSON.stringify(listed)).not.toContain("機密備註");
  });

  it("定義檢查器:組合欄引用了這一版沒有的欄位 → LIST_COLUMN_MISSING 警告", async () => {
    await ok(api, root, SET_COLUMNS, {
      input: {
        moduleKey: MODULE_KEY,
        columns: [
          {
            kind: "TEMPLATE",
            key: "{{value.start_at}}–{{value.end_at}}",
            formKey: "tpl_shift",
            label: "時段",
            width: 220,
            order: 0,
          },
        ],
      },
    });
    const report = await ok<{
      validateFormVersion: { warnings: { code: string }[] };
    }>(api, root, VALIDATE_VERSION, {
      input: {
        formKey: "tpl_shift",
        ...definitionOf([
          field("title", "text"),
          field("start_at", "datetime"),
        ]),
      },
    });
    expect(
      report.validateFormVersion.warnings.filter(
        (warning) => warning.code === "LIST_COLUMN_MISSING",
      ),
    ).toHaveLength(1);
  });
});
