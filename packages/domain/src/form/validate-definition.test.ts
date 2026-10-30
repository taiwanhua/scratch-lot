import { describe, expect, it } from "@jest/globals";

import { recheckRegexSafety } from "../form-regex-safety";
import { arrayField, column } from "./array-test-support";
import { fieldProtections } from "./dependencies";
import { definitionOf, field } from "./form-test-support";
import type { DefinitionIssueCode } from "./issues";
import type { Expression, FieldDef, FormDefinition } from "./types";
import {
  type ValidateDefinitionOptions,
  validateDefinition as validateDefinitionWith,
} from "./validate-definition";

const title = field("title", "text");

/** ReDoS 檢查由呼叫端注入(`regexSafety` 必填);案例沒指定時用正本的 recheck。 */
const validateDefinition = (
  definition: FormDefinition,
  options: Partial<ValidateDefinitionOptions> = {},
) =>
  validateDefinitionWith(definition, {
    regexSafety: recheckRegexSafety,
    ...options,
  });

/** 只看錯誤碼(與第一筆的定位),每個案例只關心自己那一類。 */
function errorsOf(
  definition: FormDefinition,
  options?: Partial<ValidateDefinitionOptions>,
) {
  return validateDefinition(definition, options).errors;
}

function codesOf(
  definition: FormDefinition,
  options?: Partial<ValidateDefinitionOptions>,
): DefinitionIssueCode[] {
  return errorsOf(definition, options).map((issue) => issue.code);
}

function warningCodesOf(
  definition: FormDefinition,
  options?: Partial<ValidateDefinitionOptions>,
): DefinitionIssueCode[] {
  return validateDefinition(definition, options).warnings.map(
    (issue) => issue.code,
  );
}

const computed = (
  key: string,
  expr: FieldDef["visibleWhen"],
  overrides: Partial<FieldDef> = {},
) =>
  field(key, "number", {
    valueSource: { kind: "computed", expr: expr ?? null },
    ...overrides,
  });

describe("validateDefinition:乾淨的定義沒有錯誤與警告", () => {
  it("一個文字欄 + 標題槽", () => {
    expect(validateDefinition(definitionOf([title]))).toEqual({
      errors: [],
      warnings: [],
    });
  });
});

describe("validateDefinition:key", () => {
  it("重複", () => {
    expect(codesOf(definitionOf([title, field("title", "text")]))).toContain(
      "KEY_DUPLICATE",
    );
  });

  it("格式不符(含 - 與 .)", () => {
    const errors = errorsOf(definitionOf([title, field("bad-key", "text")]));
    expect(errors[0]).toMatchObject({
      code: "KEY_FORMAT",
      location: { fieldKey: "bad-key" },
    });
  });

  it("保留字(ctx、row、status、summary、createdBy)", () => {
    const codes = codesOf(
      definitionOf([
        title,
        field("ctx", "text"),
        field("row", "text"),
        field("status", "text"),
        field("summary", "text"),
        field("createdBy", "text"),
      ]),
    );
    expect(codes.filter((code) => code === "KEY_RESERVED")).toHaveLength(5);
    expect(codes).not.toContain("KEY_FORMAT");
  });

  it("已發布版本存在的 key 改了型別", () => {
    expect(
      codesOf(definitionOf([title, field("qty", "text")]), {
        previousFields: [field("qty", "number")],
      }),
    ).toEqual(["KEY_TYPE_CHANGED"]);
  });
});

describe("validateDefinition:表達式", () => {
  const qty = field("qty", "number");

  it("引用不存在欄位,定位到表達式節點", () => {
    const errors = errorsOf(
      definitionOf([
        title,
        field("note", "text", { visibleWhen: { ">": [{ var: "nope" }, 0] } }),
      ]),
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code: "EXPR_UNKNOWN_FIELD",
        location: {
          fieldKey: "note",
          exprSlot: "visibleWhen",
          exprPath: ">.0.var",
        },
      }),
    ]);
  });

  it("var 路徑不在 values 或 ctx.*", () => {
    expect(
      codesOf(
        definitionOf([
          title,
          field("note", "text", { visibleWhen: { var: "ctx.secret" } }),
        ]),
      ),
    ).toEqual(["EXPR_INVALID_VAR"]);
  });

  it("未知運算子、深度與節點超限", () => {
    let deep: FieldDef["visibleWhen"] = true;
    for (let level = 0; level < 11; level += 1) {
      deep = { "!": [deep] };
    }
    const codes = codesOf(
      definitionOf([
        title,
        field("a", "text", { visibleWhen: { match: ["x", "y"] } }),
        field("b", "text", { visibleWhen: deep }),
        field("c", "text", {
          visibleWhen: { "+": Array.from({ length: 201 }, () => 1) },
        }),
      ]),
    );
    expect(codes).toEqual([
      "EXPR_UNKNOWN_OPERATOR",
      "EXPR_TOO_DEEP",
      "EXPR_TOO_MANY_NODES",
    ]);
  });

  it("跨類型循環:計算欄位引用 qty、qty 的顯示條件又引用計算欄位", () => {
    const errors = errorsOf(
      definitionOf([
        title,
        computed("total", { "*": [{ var: "qty" }, 2] }),
        field("qty", "number", { visibleWhen: { ">": [{ var: "total" }, 0] } }),
      ]),
    );
    expect(errors.map((issue) => issue.code)).toEqual(["EXPR_CYCLE"]);
  });

  it("唯讀條件 ↔ 計算欄位也成圈", () => {
    expect(
      codesOf(
        definitionOf([
          title,
          computed("total", { var: "qty" }),
          field("qty", "number", {
            readonlyWhen: { ">": [{ var: "total" }, 5] },
          }),
        ]),
      ),
    ).toEqual(["EXPR_CYCLE"]);
  });

  it("visibleWhen 引用自己", () => {
    expect(
      codesOf(
        definitionOf([
          title,
          field("qty", "number", {
            visibleWhen: { ">": [{ var: "qty" }, 0] },
          }),
        ]),
      ),
    ).toEqual(["EXPR_VISIBLE_SELF"]);
  });

  it("條件引用受保護欄位(含因依賴而受保護的計算欄位)", () => {
    const secret = field("unit_price", "number", {
      permission: { show: true, edit: false },
    });
    const total = computed("total", {
      "*": [{ var: "unit_price" }, { var: "qty" }],
    });
    const codes = codesOf(
      definitionOf([
        title,
        qty,
        secret,
        total,
        field("n1", "text", {
          visibleWhen: { ">": [{ var: "unit_price" }, 0] },
        }),
        field("n2", "text", { readonlyWhen: { ">": [{ var: "total" }, 0] } }),
        field("n3", "text", {
          rules: { custom: { ">": [{ var: "total" }, 0] } },
        }),
      ]),
    );
    expect(codes).toEqual([
      "EXPR_PROTECTED_REF",
      "EXPR_PROTECTED_REF",
      "EXPR_PROTECTED_REF",
    ]);
  });
});

describe("validateDefinition:選項、規則、widget、reference", () => {
  it("靜態選項 value 重複", () => {
    const select = field("kind", "select", {
      options: {
        kind: "static",
        items: [
          { value: "a", label: "A", order: 1, enabled: true },
          { value: "a", label: "A2", order: 2, enabled: true },
        ],
      },
    });
    expect(codesOf(definitionOf([title, select]))).toEqual([
      "OPTIONS_DUPLICATE_VALUE",
    ]);
  });

  it("類別 key 不存在(有注入類別清單時)", () => {
    const select = field("kind", "select", {
      options: { kind: "fieldCategory", key: "leave-type" },
    });
    expect(
      codesOf(definitionOf([title, select]), {
        fieldCategoryKeys: new Set(["other"]),
      }),
    ).toEqual(["OPTIONS_UNKNOWN_CATEGORY"]);
  });

  it("lookup provider 或欄位未登錄", () => {
    const select = field("who", "select", {
      options: {
        kind: "lookup",
        source: { provider: "user", labelField: "nickname" },
      },
    });
    const orgRef = field("org", "reference", {
      source: { provider: "robot", labelField: "name" },
    });
    expect(
      codesOf(definitionOf([title, select, orgRef]), {
        lookupProviders: { user: { fields: { name: "text" } } },
      }),
    ).toEqual(["LOOKUP_UNKNOWN_FIELD", "LOOKUP_UNKNOWN_PROVIDER"]);
  });

  it("lookup 顯示模板的佔位符要在 provider 可回的欄位內", () => {
    const providers = {
      user: { fields: { name: "text", email: "text" } },
      form_submission: {
        fields: {
          title: "text",
          date: "date",
          amount: "number",
          days: "number",
        },
      },
    } as const;
    const good = field("who", "reference", {
      source: {
        provider: "user",
        labelField: "name",
        labelTemplate: "{{name}}({{email}})",
      },
    });
    const bad = field("boss", "reference", {
      source: {
        provider: "user",
        labelField: "name",
        labelTemplate: "{{name}} {{value.name}} {{phone}}",
      },
    });
    const submission = field("absence", "reference", {
      source: {
        provider: "form_submission",
        formKey: "absence",
        labelField: "title",
        labelTemplate: "{{title}} {{date}} {{value.days}} {{days}} {{value.x}}",
      },
    });
    const issues = errorsOf(definitionOf([title, good, bad, submission]), {
      lookupProviders: providers,
    }).filter((issue) => issue.code === "LOOKUP_TEMPLATE_UNKNOWN_PLACEHOLDER");
    expect(
      issues.map((issue) => [issue.location.fieldKey, issue.message]),
    ).toEqual([
      ["boss", expect.stringContaining("{{value.name}}")],
      ["boss", expect.stringContaining("{{phone}}")],
      ["absence", expect.stringContaining("{{days}}")],
      ["absence", expect.stringContaining("{{value.x}}")],
    ]);
    expect(issues[0]?.location.property).toBe("source.labelTemplate");
  });

  it("allowCustom 配了不允許的 widget", () => {
    expect(
      codesOf(
        definitionOf([
          title,
          field("kind", "select", { rules: { allowCustom: true } }),
        ]),
      ),
    ).toEqual(["ALLOW_CUSTOM_WIDGET"]);
  });

  it("visibleWhen 恆為 false 卻必填", () => {
    expect(
      codesOf(
        definitionOf([
          title,
          field("note", "text", {
            visibleWhen: { "==": [1, 2] },
            rules: { required: true },
          }),
        ]),
      ),
    ).toEqual(["REQUIRED_ALWAYS_HIDDEN"]);
  });

  it("pattern 語法錯、沒配 patternMessage、與 format 同時設", () => {
    const codes = codesOf(
      definitionOf([
        title,
        field("a", "text", { rules: { pattern: "(", patternMessage: "x" } }),
        field("b", "text", { rules: { pattern: "^[a-z]+$" } }),
        field("c", "text", {
          rules: { pattern: "^[a-z]+$", patternMessage: "x", format: "email" },
        }),
      ]),
    );
    expect(codes).toEqual([
      "PATTERN_INVALID",
      "PATTERN_MESSAGE_MISSING",
      "PATTERN_WITH_FORMAT",
    ]);
  });

  it("ReDoS:^(a+)+$ 不安全,^[a-z]+$ 安全", () => {
    const errors = errorsOf(
      definitionOf([
        title,
        field("bad", "text", {
          rules: { pattern: "^(a+)+$", patternMessage: "x" },
        }),
        field("good", "text", {
          rules: { pattern: "^[a-z]+$", patternMessage: "x" },
        }),
      ]),
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code: "PATTERN_UNSAFE",
        location: { fieldKey: "bad", property: "rules.pattern" },
      }),
    ]);
  });

  it("widget 未登記或與 type 不配", () => {
    const codes = codesOf(
      definitionOf([
        title,
        field("a", "text", { widget: { kind: "slider" } }),
        field("b", "text", { widget: { kind: "switch" } }),
      ]),
    );
    expect(codes).toEqual(["WIDGET_UNKNOWN", "WIDGET_TYPE_MISMATCH"]);
  });

  it("reference 缺 source", () => {
    expect(codesOf(definitionOf([title, field("who", "reference")]))).toEqual([
      "REFERENCE_SOURCE_MISSING",
    ]);
  });
});

describe("validateDefinition:版面", () => {
  it("漏放、重複、不存在的欄位、span 超過 12、分區 key 重複", () => {
    const note = field("note", "text");
    const codes = codesOf(
      definitionOf([title, note], {
        layout: {
          sections: [
            {
              key: "s",
              title: "一",
              rows: [
                {
                  cols: [
                    { fieldKey: "title", span: 13 },
                    { fieldKey: "title", span: 6 },
                    { fieldKey: "ghost", span: 6 },
                  ],
                },
              ],
            },
            { key: "s", title: "二", rows: [] },
          ],
        },
      }),
    );
    expect(codes).toEqual([
      "LAYOUT_SPAN_INVALID",
      "LAYOUT_DUPLICATE_FIELD",
      "LAYOUT_UNKNOWN_FIELD",
      "LAYOUT_SECTION_DUPLICATE",
      "LAYOUT_MISSING_FIELD",
    ]);
  });

  it("分區收合設定:舊定義沒有這三欄、合法的設定都不報錯", () => {
    const note = field("note", "text");
    expect(codesOf(definitionOf([title, note]))).toEqual([]);
    const collapsible = definitionOf([title, note], {
      layout: {
        sections: [
          {
            key: "basic",
            title: "基本資料",
            rows: [
              { cols: [{ fieldKey: "title", span: 6 }] },
              { cols: [{ fieldKey: "note", span: 6 }] },
            ],
            collapsible: true,
            defaultCollapsed: true,
            summaryFieldKeys: ["title", "note"],
          },
        ],
      },
    });
    expect(codesOf(collapsible)).toEqual([]);
  });

  it("分區收合設定:型別不對、摘要欄位不在本分區 / 是明細欄 / 重複", () => {
    const items = arrayField("items", [column("name", "text")]);
    const note = field("note", "text");
    const errors = errorsOf(
      definitionOf([title, note, items], {
        layout: {
          sections: [
            {
              key: "basic",
              title: "基本資料",
              rows: [
                { cols: [{ fieldKey: "title", span: 12 }] },
                { cols: [{ fieldKey: "items", span: 12 }] },
              ],
              collapsible: "yes" as unknown as boolean,
              summaryFieldKeys: ["note", "items", "title", "title"],
            },
            {
              key: "more",
              title: "其他",
              rows: [{ cols: [{ fieldKey: "note", span: 12 }] }],
              defaultCollapsed: true,
              summaryFieldKeys: "note" as unknown as string[],
            },
          ],
        },
      }),
    );
    expect(
      errors
        .filter((issue) => issue.code.startsWith("SECTION_"))
        .map((issue) => [issue.code, issue.location.property]),
    ).toEqual([
      ["SECTION_COLLAPSE_INVALID", "collapsible"],
      ["SECTION_SUMMARY_FIELD_INVALID", "summaryFieldKeys.0"],
      ["SECTION_SUMMARY_FIELD_INVALID", "summaryFieldKeys.1"],
      ["SECTION_SUMMARY_FIELD_INVALID", "summaryFieldKeys.3"],
      ["SECTION_COLLAPSE_INVALID", "summaryFieldKeys"],
    ]);
  });

  it("constant 欄位可不放進版面", () => {
    const constant = field("source", "text", {
      valueSource: { kind: "constant", value: "web" },
    });
    expect(codesOf(definitionOf([title, constant]))).toEqual([]);
  });
});

describe("validateDefinition:摘要槽", () => {
  it("沒對到標題", () => {
    expect(
      codesOf(definitionOf([title], { summaryMap: { title: null } })),
    ).toEqual(["SUMMARY_UNMAPPED"]);
  });

  it("對到受保護欄位(含因依賴而受保護的計算欄位)", () => {
    const secret = field("price", "number", {
      permission: { show: true, edit: false },
    });
    const total = computed("total", { var: "price" });
    expect(
      codesOf(
        definitionOf([title, secret, total], {
          summaryMap: { title: "title", amount: "total" },
        }),
      ),
    ).toEqual(["SUMMARY_PROTECTED"]);
  });

  it("型別不合:title 對 number、date 對 text、amount 對 text;title 對 lookup 選項也不行", () => {
    const lookupSelect = field("who", "select", {
      options: {
        kind: "lookup",
        source: { provider: "user", labelField: "name" },
      },
    });
    const qty = field("qty", "number");
    const codes = codesOf(
      definitionOf([title, qty, lookupSelect], {
        summaryMap: { title: "qty", date: "title", amount: "title" },
      }),
    );
    expect(codes).toEqual(["SUMMARY_TYPE", "SUMMARY_TYPE", "SUMMARY_TYPE"]);
    expect(
      codesOf(
        definitionOf([title, lookupSelect], { summaryMap: { title: "who" } }),
      ),
    ).toEqual(["SUMMARY_TYPE"]);
  });

  it("title 對靜態選項欄、date 對日期、amount 對數字 → 通過", () => {
    expect(
      codesOf(
        definitionOf(
          [
            field("kind", "select"),
            field("day", "date"),
            field("qty", "number"),
          ],
          { summaryMap: { title: "kind", date: "day", amount: "qty" } },
        ),
      ),
    ).toEqual([]);
  });
});

describe("validateDefinition:帶入", () => {
  const providers = {
    user: { fields: { name: "text" as const, joined: "date" as const } },
  };

  it("來源欄位不存在、型別不相容、目標不是 input 欄位", () => {
    const qty = field("qty", "number");
    const total = computed("total", { var: "qty" });
    const codes = codesOf(
      definitionOf([title, qty, total], {
        prefills: [
          {
            label: "帶入使用者",
            source: { provider: "user", labelField: "name" },
            mapping: [
              { sourceField: "ghost", fieldKey: "title" },
              { sourceField: "joined", fieldKey: "qty" },
              { sourceField: "name", fieldKey: "total" },
            ],
          },
        ],
      }),
      { lookupProviders: providers },
    );
    expect(codes).toEqual([
      "PREFILL_UNKNOWN_SOURCE_FIELD",
      "PREFILL_TYPE_INCOMPATIBLE",
      "PREFILL_TARGET_NOT_INPUT",
      "PREFILL_TYPE_INCOMPATIBLE",
    ]);
  });
});

describe("validateDefinition:警告", () => {
  it("分區為空", () => {
    const definition = definitionOf([title]);
    definition.layout.sections.push({ key: "empty", title: "空", rows: [] });
    expect(warningCodesOf(definition)).toEqual(["SECTION_EMPTY"]);
  });

  it("受保護欄位設了必填", () => {
    expect(
      warningCodesOf(
        definitionOf([
          title,
          field("secret", "text", {
            permission: { show: true, edit: true },
            rules: { required: true },
          }),
        ]),
      ),
    ).toEqual(["PROTECTED_REQUIRED"]);
  });

  it("摘要槽或必填的 computed 欄位有 visibleWhen", () => {
    const qty = field("qty", "number");
    const hiddenTotal = computed(
      "total",
      { var: "qty" },
      {
        visibleWhen: { ">": [{ var: "qty" }, 0] },
        rules: { required: true },
      },
    );
    expect(warningCodesOf(definitionOf([title, qty, hiddenTotal]))).toEqual([
      "COMPUTED_HIDDEN",
    ]);
  });

  it("列表欄位配置引用了這版沒有的欄位", () => {
    expect(
      warningCodesOf(definitionOf([title]), {
        listColumnFieldKeys: ["title", "gone"],
      }),
    ).toEqual(["LIST_COLUMN_MISSING"]);
  });
});

/** `[[[…]]]` 純陣列巢狀 `levels` 層(不經遞迴建,建多深都不會爆堆疊)。 */
function nestedArrays(levels: number): Expression {
  let node: Expression = 1;
  for (let level = 0; level < levels; level += 1) {
    node = [node];
  }
  return node;
}

describe("validateDefinition:上限在走訪時就生效(惡意輸入只回錯誤、不 throw)", () => {
  it("純陣列巢狀也算深度:11 層陣列 → EXPR_TOO_DEEP", () => {
    expect(
      codesOf(
        definitionOf([
          title,
          field("a", "text", {
            visibleWhen: { in: ["x", nestedArrays(11)] },
          }),
        ]),
      ),
    ).toEqual(["EXPR_TOO_DEEP"]);
  });

  it("兩萬層巢狀陣列:不爆堆疊,檢查器與依賴鏈推導都正常回來", () => {
    const deep = field("a", "text", {
      visibleWhen: { in: ["x", nestedArrays(20_000)] },
    });
    const computedDeep = computed("b", { "+": [nestedArrays(20_000), 1] });
    const definition = definitionOf([title, deep, computedDeep]);
    expect(() => validateDefinition(definition)).not.toThrow();
    expect(codesOf(definition)).toEqual(["EXPR_TOO_DEEP", "EXPR_TOO_DEEP"]);
    expect(() => fieldProtections(definition.fields)).not.toThrow();
  });

  it("十萬個節點:一超過 200 就中止,回 EXPR_TOO_MANY_NODES 一筆", () => {
    const wide = field("a", "text", {
      visibleWhen: { "+": Array.from({ length: 100_000 }, () => 1) },
    });
    expect(codesOf(definitionOf([title, wide]))).toEqual([
      "EXPR_TOO_MANY_NODES",
    ]);
  });
});

describe("validateDefinition:欄位本身的錯誤碼", () => {
  it("PRECISION_INVALID:小數位數不在 0–6 或不是整數", () => {
    for (const precision of [7, -1, 1.5]) {
      expect(
        codesOf(definitionOf([title, field("qty", "number", { precision })])),
      ).toEqual(["PRECISION_INVALID"]);
    }
  });

  it("EXPR_MISSING:計算欄位沒有公式", () => {
    const noExpr = field("total", "number", {
      valueSource: { kind: "computed" } as FieldDef["valueSource"],
    });
    expect(codesOf(definitionOf([title, noExpr]))).toContain("EXPR_MISSING");
  });

  it("OPTIONS_MISSING:選項欄沒有選項來源", () => {
    const noOptions = field("kind", "select");
    delete noOptions.options;
    expect(codesOf(definitionOf([title, noOptions]))).toEqual([
      "OPTIONS_MISSING",
    ]);
  });

  it("EXPR_INVALID:運算子節點不是恰好一個鍵", () => {
    expect(
      codesOf(
        definitionOf([
          title,
          field("a", "text", {
            visibleWhen: {
              "==": [1, 1],
              "!=": [1, 2],
            } as FieldDef["visibleWhen"],
          }),
        ]),
      ),
    ).toEqual(["EXPR_INVALID"]);
  });

  it("FIELD_TYPE_UNKNOWN:型別不在清單內 → 回錯誤碼,不因查表而 throw", () => {
    const bogus = {
      ...field("weird", "text"),
      type: "color",
    } as unknown as FieldDef;
    expect(() =>
      validateDefinition(definitionOf([title, bogus])),
    ).not.toThrow();
    expect(codesOf(definitionOf([title, bogus]))).toContain(
      "FIELD_TYPE_UNKNOWN",
    );
  });

  it("lookup:原型鏈上的名稱不算可回欄位;form_submission 來源要帶 formKey", () => {
    const protoName = field("who", "select", {
      options: {
        kind: "lookup",
        source: { provider: "user", labelField: "toString" },
      },
    });
    const noFormKey = field("from", "reference", {
      source: { provider: "form_submission", labelField: "title" },
    });
    expect(
      codesOf(definitionOf([title, protoName, noFormKey]), {
        lookupProviders: {
          user: { fields: { name: "text" } },
          form_submission: { fields: { title: "text" } },
        },
      }),
    ).toEqual(["LOOKUP_UNKNOWN_FIELD", "LOOKUP_FORM_KEY_MISSING"]);
  });
});
