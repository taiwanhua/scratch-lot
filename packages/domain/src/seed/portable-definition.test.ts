import { describe, expect, it } from "@jest/globals";

import { field } from "../form/form-test-support";
import type { Expression, FieldDef } from "../form/types";
import { review } from "../workflow/workflow-test-support";
import type {
  FormDefinitionSeedSet,
  WorkflowDefinitionSeedSet,
} from "./declaration";
import {
  type PortableIssue,
  validatePortableDefinition,
} from "./portable-definition";
import {
  catalogOf,
  formSeed,
  userReference,
  workflowSeed,
} from "./seed-test-support";

/** 像 ObjectId 的 24 碼十六進位字串(可攜性檢查不該因為長相把它當 ID)。 */
const HEX_24 = "0123456789abcdef01234567";

const idOf = (path: string): Expression => ({ var: path });

function errorsOf(
  seed: Parameters<typeof validatePortableDefinition>[0],
  catalog = catalogOf(),
): PortableIssue[] {
  return validatePortableDefinition(seed, catalog).errors;
}

function codesAt(issues: readonly PortableIssue[]): [string, string][] {
  return issues.map((issue) => [issue.code, issue.path]);
}

/** lookup 選項來源(使用者);`valueField` 可改成 account 這類非 id 的值欄。 */
function userLookup(valueField?: string): NonNullable<FieldDef["options"]> {
  return {
    kind: "lookup",
    source: {
      provider: "user",
      labelField: "name",
      ...(valueField !== undefined && { valueField }),
    },
  };
}

function category(key: string): NonNullable<FieldDef["options"]> {
  return { kind: "fieldCategory", key };
}

function revisionErrors(revision: string): PortableIssue[] {
  return errorsOf(formSeed([field("title", "text")], { revision }));
}

function workflowWithSkip(
  skipWhen: Expression,
  checkFormKey: string | null,
): WorkflowDefinitionSeedSet {
  return workflowSeed(
    { steps: [review("boss", { skipWhen }), review("hr")] },
    { checkFormKey },
  );
}

/** 一張有引用欄(填寫者)、文字欄與是 / 否欄的表單,條件掛在文字欄的顯示條件上。 */
function formWithCondition(
  condition: Expression,
  extra: FieldDef[] = [],
): FormDefinitionSeedSet {
  return formSeed([
    field("title", "text", { visibleWhen: condition }),
    userReference("applicant"),
    field("flag", "boolean"),
    ...extra,
  ]);
}

describe("validatePortableDefinition:表達式的 ID 語意", () => {
  it("文字欄與 24 碼常數比較通過(不因為長得像 ObjectId 就當成 ID),固定值是 24 碼文字也通過", () => {
    const seed = formSeed([
      field("title", "text"),
      field("code", "text", {
        visibleWhen: { "==": [idOf("title"), HEX_24] },
        rules: { custom: { in: [idOf("title"), [HEX_24, "abc"]] } },
      }),
      field("fixed_code", "text", {
        valueSource: { kind: "constant", value: HEX_24 },
      }),
    ]);
    expect(errorsOf(seed)).toEqual([]);
  });

  it("ctx.user.id 與引用欄的動態比較通過;與 null 比較、判空、and 當條件也通過", () => {
    const conditions: Expression[] = [
      { "==": [idOf("applicant"), idOf("ctx.user.id")] },
      { "!=": [idOf("ctx.user.orgId"), idOf("applicant")] },
      { "==": [idOf("applicant"), null] },
      { "!!": [idOf("applicant")] },
      { and: [idOf("applicant"), idOf("flag")] },
      { if: [idOf("applicant"), true, false] },
    ];
    for (const condition of conditions) {
      expect(errorsOf(formWithCondition(condition))).toEqual([]);
    }
  });

  it("引用欄與寫死的短字串比較拒絕(不看字串像不像 id),指出是哪一邊", () => {
    expect(
      codesAt(
        errorsOf(formWithCondition({ "==": [idOf("applicant"), "abc"] })),
      ),
    ).toEqual([["ID_COMPARISON", "definition.fields.0.visibleWhen.==.1"]]);
    expect(
      codesAt(
        errorsOf(formWithCondition({ "!==": [HEX_24, idOf("ctx.user.id")] })),
      ),
    ).toEqual([["ID_COMPARISON", "definition.fields.0.visibleWhen.!==.0"]]);
  });

  it("新系統值:ctx.tenant.id 是動態 ID、ctx.user.orgIds 是動態 ID 集合", () => {
    expect(
      codesAt(
        errorsOf(formWithCondition({ "==": [idOf("ctx.tenant.id"), "abc"] })),
      ),
    ).toEqual([["ID_COMPARISON", "definition.fields.0.visibleWhen.==.1"]]);
    expect(
      codesAt(
        errorsOf(formWithCondition({ in: [HEX_24, idOf("ctx.user.orgIds")] })),
      ),
    ).toEqual([["ID_COMPARISON", "definition.fields.0.visibleWhen.in.0"]]);
    // 動態 ID 對動態 ID 集合 / 動態 ID 比較:通過
    expect(
      errorsOf(
        formWithCondition({
          in: [idOf("ctx.user.orgId"), idOf("ctx.user.orgIds")],
        }),
      ),
    ).toEqual([]);
    expect(
      errorsOf(
        formWithCondition({
          "==": [idOf("ctx.tenant.id"), idOf("ctx.user.orgId")],
        }),
      ),
    ).toEqual([]);
  });

  it("引用欄與一般文字欄比較拒絕(只允許另一個動態 ID 或 null)", () => {
    expect(
      codesAt(
        errorsOf(
          formWithCondition({ "==": [idOf("applicant"), idOf("title")] }),
        ),
      ),
    ).toEqual([["ID_COMPARISON", "definition.fields.0.visibleWhen.==.1"]]);
  });

  it("用 if / and / or 把寫死的值包起來再跟 ID 比較,一樣拒絕", () => {
    const wrappers: Expression[] = [
      { if: [idOf("flag"), HEX_24, "abc"] },
      { and: [idOf("flag"), HEX_24] },
      { or: [idOf("ctx.user.id"), HEX_24] },
    ];
    for (const wrapped of wrappers) {
      const errors = errorsOf(
        formWithCondition({ "==": [idOf("applicant"), wrapped] }),
      );
      expect(codesAt(errors)).toEqual([
        ["ID_COMPARISON", "definition.fields.0.visibleWhen.==.1"],
      ]);
    }
  });

  it("if 的分支會回傳 ID 時,另一個分支不能是寫死的非空值(null 可以)", () => {
    const mixed = formSeed([
      field("title", "text"),
      userReference("applicant"),
      field("owner", "text", {
        valueSource: {
          kind: "computed",
          expr: { if: [idOf("title"), idOf("applicant"), "nobody"] },
        },
      }),
    ]);
    expect(codesAt(errorsOf(mixed))).toEqual([
      ["ID_FIXED_MIX", "definition.fields.2.valueSource.expr.if.2"],
      ["ID_FIXED_MIX", "definition.fields.2.valueSource.expr"],
    ]);

    const withNull = formSeed([
      field("title", "text"),
      userReference("applicant"),
      field("owner", "text", {
        valueSource: {
          kind: "computed",
          expr: { if: [idOf("title"), idOf("applicant"), null] },
        },
      }),
    ]);
    expect(errorsOf(withNull)).toEqual([]);
  });

  it("in:ID 對寫死的清單拒絕;對動態 ID 集合或空陣列通過", () => {
    const approvers = field("approvers", "multiSelect", {
      options: {
        kind: "lookup",
        source: { provider: "user", labelField: "name" },
      },
    });
    expect(
      codesAt(
        errorsOf(
          formWithCondition({ in: [idOf("applicant"), [HEX_24, "abc"]] }),
        ),
      ),
    ).toEqual([["ID_COMPARISON", "definition.fields.0.visibleWhen.in.1"]]);
    expect(
      errorsOf(
        formWithCondition({ in: [idOf("ctx.user.id"), idOf("approvers")] }, [
          approvers,
        ]),
      ),
    ).toEqual([]);
    expect(
      errorsOf(formWithCondition({ in: [idOf("applicant"), []] })),
    ).toEqual([]);
    // 寫死的值去找動態 ID 集合:一樣不行
    expect(
      codesAt(
        errorsOf(
          formWithCondition({ in: ["abc", idOf("approvers")] }, [approvers]),
        ),
      ),
    ).toEqual([["ID_COMPARISON", "definition.fields.0.visibleWhen.in.0"]]);
  });

  it("其他運算子直接收 ID 拒絕(字串拼接、大小比較);optionLabel 是顯示文字,可以當文字用", () => {
    expect(
      codesAt(
        errorsOf(
          formWithCondition({
            "==": [{ concat: [idOf("applicant"), "-x"] }, "abc-x"],
          }),
        ),
      ),
    ).toEqual([
      ["ID_OPERATOR", "definition.fields.0.visibleWhen.==.0.concat.0"],
    ]);
    expect(
      codesAt(errorsOf(formWithCondition({ "<": [idOf("ctx.user.id"), "m"] }))),
    ).toEqual([["ID_OPERATOR", "definition.fields.0.visibleWhen.<.0"]]);

    const picker = field("reviewer", "select", {
      options: {
        kind: "lookup",
        source: { provider: "user", labelField: "name" },
      },
    });
    expect(
      errorsOf(
        formWithCondition({ "==": [{ optionLabel: "reviewer" }, "王小明"] }, [
          picker,
        ]),
      ),
    ).toEqual([]);
    // 同一欄直接拿值比寫死的字串就不行:lookup 選項的值是 ID
    expect(
      codesAt(
        errorsOf(
          formWithCondition({ "==": [idOf("reviewer"), "wang"] }, [picker]),
        ),
      ),
    ).toEqual([["ID_COMPARISON", "definition.fields.0.visibleWhen.==.1"]]);
  });

  it("帶入來源 id 的目標欄位帶 ID 語意,沿計算欄位的依賴鏈傳下去:間接的 ID 與寫死的值比較拒絕", () => {
    const seed = formSeed(
      [
        field("title", "text"),
        field("applicant_id", "text"),
        field("copy", "text", {
          valueSource: { kind: "computed", expr: idOf("applicant_id") },
        }),
        field("note", "text", {
          readonlyWhen: { "==": [idOf("copy"), HEX_24] },
        }),
      ],
      {},
      {
        prefills: [
          {
            label: "帶入申請人",
            source: { provider: "user", labelField: "name" },
            mapping: [
              { sourceField: "id", fieldKey: "applicant_id" },
              { sourceField: "name", fieldKey: "title" },
            ],
          },
        ],
      },
    );
    expect(codesAt(errorsOf(seed))).toEqual([
      ["ID_COMPARISON", "definition.fields.3.readonlyWhen.==.1"],
    ]);
    // 同一條依賴鏈上,帶入的是名稱(不是 id)就照一般文字比較
    const byName = formSeed([
      field("title", "text"),
      field("note", "text", {
        readonlyWhen: { "==": [idOf("title"), HEX_24] },
      }),
    ]);
    expect(errorsOf(byName)).toEqual([]);
  });

  it("預設值公式是 ctx.user.id 的文字欄同樣帶 ID 語意(間接的系統值)", () => {
    const seed = formSeed([
      field("title", "text"),
      field("creator", "text", {
        default: { kind: "expression", expr: idOf("ctx.user.id") },
      }),
      field("note", "text", {
        visibleWhen: { "==": [idOf("creator"), "root"] },
      }),
    ]);
    expect(codesAt(errorsOf(seed))).toEqual([
      ["ID_COMPARISON", "definition.fields.2.visibleWhen.==.1"],
    ]);
  });

  it("明細子欄的列內公式引用 ID:row.* 帶 ID 語意,與寫死的值比較、拿去彙總都拒絕", () => {
    const seed = formSeed([
      field("title", "text"),
      userReference("applicant"),
      field("items", "array", {
        columns: [
          {
            key: "who",
            label: "誰",
            type: "text",
            widget: { kind: "textField" },
            valueSource: { kind: "computed", expr: idOf("applicant") },
          },
          {
            key: "mine",
            label: "是我",
            type: "boolean",
            widget: { kind: "checkbox" },
            valueSource: {
              kind: "computed",
              expr: { "==": [idOf("row.who"), "abc"] },
            },
          },
          {
            key: "same",
            label: "同一人",
            type: "boolean",
            widget: { kind: "checkbox" },
            valueSource: {
              kind: "computed",
              expr: { "==": [idOf("row.who"), idOf("ctx.user.id")] },
            },
          },
        ],
      }),
      field("total", "number", {
        valueSource: { kind: "computed", expr: { sumOf: ["items", "who"] } },
      }),
    ]);
    expect(codesAt(errorsOf(seed))).toEqual([
      ["ID_COMPARISON", "definition.fields.2.columns.1.valueSource.expr.==.1"],
      ["ID_OPERATOR", "definition.fields.3.valueSource.expr.sumOf"],
    ]);
  });

  it("未知運算子與不存在的欄位:報出位置,不默默略過", () => {
    const unknownOperator = formWithCondition({
      regex: [idOf("title"), "^a"],
    });
    expect(codesAt(errorsOf(unknownOperator))).toEqual([
      ["EXPRESSION_UNSUPPORTED", "definition.fields.0.visibleWhen.regex"],
    ]);
    const unknownField = formWithCondition({
      "==": [idOf("ghost"), "abc"],
    });
    expect(codesAt(errorsOf(unknownField))).toEqual([
      ["EXPRESSION_UNSUPPORTED", "definition.fields.0.visibleWhen.==.0.var"],
    ]);
  });
});

describe("validatePortableDefinition:lookup 來源與固定值", () => {
  it("user / org 的 filter 只收 boolean 的 enabled;本地 id 條件與未知條件拒絕", () => {
    const allowed = formSeed([
      field("title", "text"),
      userReference("applicant", {
        source: {
          provider: "user",
          labelField: "name",
          filter: { enabled: true },
        },
      }),
      field("dept", "reference", {
        source: { provider: "org", labelField: "name", filter: {} },
      }),
    ]);
    expect(errorsOf(allowed)).toEqual([]);

    const rejected = formSeed([
      field("title", "text"),
      userReference("applicant", {
        source: {
          provider: "user",
          labelField: "name",
          filter: { orgId: HEX_24, enabled: "yes" },
        },
      }),
    ]);
    expect(codesAt(errorsOf(rejected))).toEqual([
      ["LOOKUP_FILTER_UNSUPPORTED", "definition.fields.1.source.filter.orgId"],
      [
        "LOOKUP_FILTER_UNSUPPORTED",
        "definition.fields.1.source.filter.enabled",
      ],
    ]);
  });

  it("未知 provider、未知的來源設定拒絕;選項與帶入的來源也一樣檢查", () => {
    const seed = formSeed(
      [
        field("title", "text"),
        field("vendor", "select", {
          options: {
            kind: "lookup",
            source: { provider: "vendor", labelField: "name" },
          },
        }),
        userReference("applicant", {
          source: {
            provider: "user",
            labelField: "name",
            tenantId: HEX_24,
          } as FieldDef["source"],
        }),
      ],
      {},
      {
        prefills: [
          {
            label: "帶入",
            source: {
              provider: "org",
              labelField: "name",
              filter: { parentId: HEX_24 },
            },
            mapping: [{ sourceField: "name", fieldKey: "title" }],
          },
        ],
      },
    );
    expect(codesAt(errorsOf(seed))).toEqual([
      [
        "LOOKUP_PROVIDER_UNSUPPORTED",
        "definition.fields.1.options.source.provider",
      ],
      ["LOOKUP_SOURCE_UNSUPPORTED", "definition.fields.2.source.tenantId"],
      [
        "LOOKUP_FILTER_UNSUPPORTED",
        "definition.prefills.0.source.filter.parentId",
      ],
    ]);
  });

  it("明細引用子欄的來源照表單層引用欄檢查;其他子欄帶 source 仍拒絕", () => {
    const seed = formSeed([
      field("title", "text"),
      field("items", "array", {
        columns: [
          {
            key: "store",
            label: "分店",
            type: "reference",
            widget: { kind: "referencePicker" },
            valueSource: { kind: "input" },
            source: { provider: "org", labelField: "name" },
          },
          {
            key: "vendor",
            label: "廠商",
            type: "reference",
            widget: { kind: "referencePicker" },
            valueSource: { kind: "input" },
            source: { provider: "vendor", labelField: "name" },
          },
          {
            key: "note",
            label: "備註",
            type: "text",
            widget: { kind: "textField" },
            valueSource: { kind: "input" },
            source: { provider: "org", labelField: "name" },
          },
        ],
      }),
    ]);
    expect(codesAt(errorsOf(seed))).toEqual([
      [
        "LOOKUP_PROVIDER_UNSUPPORTED",
        "definition.fields.1.columns.1.source.provider",
      ],
      ["FIELD_UNSUPPORTED", "definition.fields.1.columns.2.source"],
    ]);
  });

  it("專案宣告的可攜 lookup 來源:只收宣告過的固定條件與值;沒宣告的照舊拒絕", () => {
    const item = (filter?: Record<string, unknown>) =>
      field("item", "reference", {
        source: {
          provider: "catalog_item",
          labelField: "name",
          ...(filter && { filter }),
        },
      });
    const seed = formSeed([
      field("title", "text"),
      item({ status: "active" }),
      item(),
      item({ status: "retired" }),
      item({ orgId: HEX_24 }),
      field("supplier", "reference", {
        source: { provider: "vendor", labelField: "name" },
      }),
    ]);
    const catalog = catalogOf({
      lookupProviders: new Map([
        ["catalog_item", { filters: { status: ["active"] } }],
      ]),
    });
    expect(codesAt(errorsOf(seed, catalog))).toEqual([
      ["LOOKUP_FILTER_UNSUPPORTED", "definition.fields.3.source.filter.status"],
      ["LOOKUP_FILTER_UNSUPPORTED", "definition.fields.4.source.filter.orgId"],
      ["LOOKUP_PROVIDER_UNSUPPORTED", "definition.fields.5.source.provider"],
    ]);
    // 目錄沒宣告 → 專案來源一律不可攜
    expect(
      codesAt(errorsOf(formSeed([field("title", "text"), item()]))),
    ).toEqual([
      ["LOOKUP_PROVIDER_UNSUPPORTED", "definition.fields.1.source.provider"],
    ]);
  });

  it("form_submission:formKey 要指向同一計畫可解析的共用表單(可以是自己);有 filter 一律拒絕", () => {
    const source = (formKey: string, filter?: Record<string, unknown>) =>
      field("ref", "reference", {
        source: {
          provider: "form_submission",
          labelField: "title",
          formKey,
          ...(filter && { filter }),
        },
      });
    const other = formSeed([field("title", "text")], { key: "vendor_form" });
    const catalog = catalogOf({
      sharedForms: new Map([[other.key, other.definition]]),
      tenantFormKeys: new Set(["vendor_form_acme"]),
    });
    expect(
      errorsOf(
        formSeed([field("title", "text"), source("vendor_form")]),
        catalog,
      ),
    ).toEqual([]);
    expect(
      errorsOf(
        formSeed([field("title", "text"), source("leave_request")]),
        catalog,
      ),
    ).toEqual([]);

    const unresolved = errorsOf(
      formSeed([field("title", "text"), source("vendor_form_acme")]),
      catalog,
    );
    expect(codesAt(unresolved)).toEqual([
      ["DEPENDENCY_UNRESOLVED", "definition.fields.1.source.formKey"],
    ]);
    expect(unresolved[0]?.message).toContain("租戶客製表單");

    expect(
      codesAt(
        errorsOf(
          formSeed([
            field("title", "text"),
            source("leave_request", { status: "completed" }),
          ]),
          catalog,
        ),
      ),
    ).toEqual([
      ["LOOKUP_FILTER_UNSUPPORTED", "definition.fields.1.source.filter.status"],
    ]);
  });

  it("reference / upload 的固定值:缺席、null、空集合通過;非空拒絕(含帶 label 的引用物件與上傳路徑)", () => {
    const empty = formSeed([
      field("title", "text"),
      userReference("applicant", {
        valueSource: { kind: "constant", value: null },
        default: null,
      }),
      field("files", "upload", {
        valueSource: { kind: "constant", value: [] },
      }),
    ]);
    expect(errorsOf(empty)).toEqual([]);

    const fixed = formSeed([
      field("title", "text"),
      userReference("applicant", {
        valueSource: {
          kind: "constant",
          value: { id: HEX_24, label: "王小明" },
        },
      }),
      userReference("backup", {
        default: { kind: "constant", value: "abc" },
      }),
      field("files", "upload", {
        valueSource: {
          kind: "constant",
          value: { path: "forms/acme/a.pdf", name: "a.pdf" },
        },
      }),
    ]);
    expect(codesAt(errorsOf(fixed))).toEqual([
      ["FIXED_ENVIRONMENT_VALUE", "definition.fields.1.valueSource.value"],
      ["FIXED_ENVIRONMENT_VALUE", "definition.fields.2.default.value"],
      ["FIXED_ENVIRONMENT_VALUE", "definition.fields.3.valueSource.value"],
    ]);
  });

  it("引用欄的預設表達式只收 ctx.user.id / ctx.user.orgId", () => {
    const allowed = formSeed([
      field("title", "text"),
      userReference("applicant", {
        default: { kind: "expression", expr: idOf("ctx.user.id") },
      }),
      field("dept", "reference", {
        source: { provider: "org", labelField: "name" },
        default: { kind: "expression", expr: { var: ["ctx.user.orgId"] } },
      }),
    ]);
    expect(errorsOf(allowed)).toEqual([]);

    const rejected = formSeed([
      field("title", "text"),
      userReference("applicant", {
        default: {
          kind: "expression",
          expr: { if: [true, HEX_24, idOf("ctx.user.id")] },
        },
      }),
    ]);
    expect(codesAt(errorsOf(rejected))).toEqual([
      ["FIXED_ENVIRONMENT_VALUE", "definition.fields.1.default.expr"],
    ]);
  });

  it("lookup 選項的固定預設:任何非空值都拒絕(用 account / slug 當值也一樣),多選逐項報;空的通過", () => {
    const seed = formSeed([
      field("title", "text"),
      field("reviewer", "select", {
        options: userLookup("account"),
        default: { kind: "constant", value: { value: "amy", label: "Amy" } },
      }),
      field("watchers", "multiSelect", {
        options: userLookup(),
        default: {
          kind: "constant",
          value: [
            { value: HEX_24, label: "A" },
            { value: "b", label: "B" },
          ],
        },
      }),
      field("none", "multiSelect", {
        options: userLookup(),
        default: { kind: "constant", value: [] },
      }),
    ]);
    expect(codesAt(errorsOf(seed))).toEqual([
      ["FIXED_ENVIRONMENT_VALUE", "definition.fields.1.default.value"],
      ["FIXED_ENVIRONMENT_VALUE", "definition.fields.2.default.value.0"],
      ["FIXED_ENVIRONMENT_VALUE", "definition.fields.2.default.value.1"],
    ]);
  });

  it("靜態選項照收;欄位類別要是受管 key,固定值要是它的種子選項", () => {
    const allowed = formSeed([
      field("title", "text"),
      field("leave_type", "select", {
        default: { kind: "constant", value: "sick" },
      }),
      field("gender", "select", {
        options: category("gender"),
        default: { kind: "constant", value: { value: "male", label: "男" } },
      }),
    ]);
    expect(errorsOf(allowed)).toEqual([]);

    const rejected = formSeed([
      field("title", "text"),
      field("cuisine", "select", { options: category("cuisine") }),
      field("gender", "select", {
        options: category("gender"),
        default: {
          kind: "constant",
          value: { value: "custom", label: "自訂" },
        },
      }),
      field("items", "array", {
        columns: [
          {
            key: "kind",
            label: "種類",
            type: "select",
            widget: { kind: "dropdown" },
            valueSource: { kind: "input" },
            options: category("cuisine"),
          },
        ],
      }),
    ]);
    expect(codesAt(errorsOf(rejected))).toEqual([
      ["DEPENDENCY_UNRESOLVED", "definition.fields.1.options.key"],
      ["DEPENDENCY_UNRESOLVED", "definition.fields.2.default.value"],
      ["DEPENDENCY_UNRESOLVED", "definition.fields.3.columns.0.options.key"],
    ]);
  });

  it("模組不在同一計畫、欄位是執行端骨架或未知型別:指出位置", () => {
    const seed = formSeed(
      [
        field("title", "text"),
        { ...field("secret", "text"), redacted: true },
        { ...field("geo", "text"), type: "geo" as FieldDef["type"] },
      ],
      { moduleKey: "ghost-form" },
    );
    expect(codesAt(errorsOf(seed))).toEqual([
      ["DEPENDENCY_UNRESOLVED", "moduleKey"],
      ["FIELD_UNSUPPORTED", "definition.fields.1"],
      ["FIELD_UNSUPPORTED", "definition.fields.2.type"],
    ]);
  });
});

describe("validatePortableDefinition:宣告的形狀", () => {
  it("夾帶資料庫欄位、revision 格式不符、可清空欄位缺席:只回形狀問題", () => {
    const seed = {
      ...formSeed([field("title", "text")], { revision: "Release 1" }),
      _id: HEX_24,
      version: 3,
      tabLabelTemplate: undefined,
    } as unknown as FormDefinitionSeedSet;
    expect(codesAt(errorsOf(seed))).toEqual([
      ["SEED_SHAPE", "_id"],
      ["SEED_SHAPE", "version"],
      ["SEED_SHAPE", "revision"],
      ["SEED_SHAPE", "tabLabelTemplate"],
    ]);
  });

  it("revision:小寫英數開頭、後接小寫英數 / 底線 / 連字號、最長 64", () => {
    for (const revision of ["r1", "2026-10-release_2", "a".repeat(64)]) {
      expect(revisionErrors(revision)).toEqual([]);
    }
    for (const revision of ["", "-r1", "R1", "r 1", "a".repeat(65), "v1.0"]) {
      expect(codesAt(revisionErrors(revision))).toEqual([
        ["SEED_SHAPE", "revision"],
      ]);
    }
  });
});

/** 共用流程不能用的人員條件:指定使用者或角色的一列。 */
const audienceOf = (field: "user" | "role") => ({
  kind: "audience" as const,
  audience: {
    mode: "match" as const,
    filter: {
      op: "AND" as const,
      children: [
        {
          field,
          cond: "in" as const,
          value: { kind: "static" as const, values: [HEX_24] },
        },
      ],
    },
  },
});
describe("validatePortableDefinition:共用流程", () => {
  const requestForm = formSeed([
    field("title", "text"),
    userReference("approver"),
    field("amount", "number"),
  ]);
  const catalog = catalogOf({
    sharedForms: new Map([[requestForm.key, requestForm.definition]]),
    tenantFormKeys: new Set(["leave_request_acme"]),
  });

  it("主管、權限 + 單據所屬組織的人員條件、可解析表單的使用者引用欄:通過", () => {
    const seed = workflowSeed(
      {
        steps: [
          review("boss"),
          review("hr", {
            assignee: {
              kind: "audience",
              audience: {
                mode: "match",
                filter: {
                  op: "AND",
                  children: [
                    {
                      field: "permission",
                      cond: "in",
                      value: { kind: "static", values: ["hr.approve"] },
                    },
                    {
                      field: "org",
                      cond: "in",
                      value: { kind: "dynamic", ref: "submission-org" },
                      range: "self",
                    },
                  ],
                },
              },
            },
          }),
          review("picked", {
            assignee: {
              kind: "field",
              formKey: "leave_request",
              fieldKey: "approver",
            },
            skipWhen: { "==": [idOf("approver"), idOf("ctx.user.id")] },
          }),
        ],
      },
      { checkFormKey: "leave_request" },
    );
    expect(errorsOf(seed, catalog)).toEqual([]);
  });

  it("指定使用者、角色條件、指向租戶客製表單:拒絕並指出關卡", () => {
    const seed = workflowSeed({
      steps: [
        review("named", { assignee: audienceOf("user") }),
        review("role", { assignee: audienceOf("role") }),
        review("tenant", {
          assignee: {
            kind: "field",
            formKey: "leave_request_acme",
            fieldKey: "approver",
          },
        }),
      ],
    });
    const errors = errorsOf(seed, catalog);
    expect(codesAt(errors)).toEqual([
      [
        "ASSIGNEE_NOT_PORTABLE",
        "definition.steps.0.assignee.audience.filter.children[0]",
      ],
      [
        "ASSIGNEE_NOT_PORTABLE",
        "definition.steps.1.assignee.audience.filter.children[0]",
      ],
      ["ASSIGNEE_NOT_PORTABLE", "definition.steps.2.assignee.formKey"],
    ]);
    expect(errors[2]?.message).toContain("租戶客製表單");
  });

  it("知會對象(關卡與整個流程)指向租戶客製表單:同樣拒絕,訊息講得出是哪張表單", () => {
    const tenantField = {
      kind: "field",
      formKey: "leave_request_acme",
      fieldKey: "approver",
    } as const;
    const seed = workflowSeed({
      steps: [review("boss", { cc: tenantField })],
      cc: tenantField,
    });
    const errors = errorsOf(seed, catalog);
    expect(codesAt(errors)).toEqual([
      ["ASSIGNEE_NOT_PORTABLE", "definition.steps.0.cc.formKey"],
      ["ASSIGNEE_NOT_PORTABLE", "definition.cc.formKey"],
    ]);
    expect(errors[0]?.message).toContain("租戶客製表單");
    expect(errors[1]?.message).toContain("租戶客製表單");
  });

  it("跳過條件:ID 與寫死的值比較拒絕;一般數值條件照舊;檢查用表單解不開時指出 checkFormKey", () => {
    expect(
      codesAt(
        errorsOf(
          workflowWithSkip(
            { "==": [idOf("approver"), HEX_24] },
            "leave_request",
          ),
          catalog,
        ),
      ),
    ).toEqual([["ID_COMPARISON", "definition.steps.0.skipWhen.==.1"]]);
    expect(
      errorsOf(
        workflowWithSkip({ "<": [idOf("amount"), 1000] }, "leave_request"),
        catalog,
      ),
    ).toEqual([]);
    expect(
      codesAt(
        errorsOf(
          workflowWithSkip({ "<": [idOf("amount"), 1000] }, "ghost_form"),
          catalog,
        ),
      ),
    ).toEqual([
      ["DEPENDENCY_UNRESOLVED", "checkFormKey"],
      ["EXPRESSION_UNSUPPORTED", "definition.steps.0.skipWhen"],
    ]);
  });
});
