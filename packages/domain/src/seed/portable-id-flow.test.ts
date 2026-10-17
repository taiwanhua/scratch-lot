import { describe, expect, it } from "@jest/globals";

import { column } from "../form/array-test-support";
import { definitionOf, field } from "../form/form-test-support";
import type {
  Expression,
  FieldDef,
  FormDefinition,
  Prefill,
} from "../form/types";
import { validateDefinition } from "../form/validate-definition";
import type { FormDefinitionSeedSet } from "./declaration";
import { validatePortableDefinition } from "./portable-definition";
import { catalogOf, formSeed, userReference } from "./seed-test-support";

/**
 * ID 沿帶入與公式傳播的正反例。每個夾具都先過**既有的**表單定義檢查器(`validateDefinition` 零錯誤),
 * 確認它是設計器真的做得出來、發得出去的定義,再看可攜性檢查的判斷。
 */

const SOURCE_FORM = "source_form";
const TARGET_FORM = "leave_request";

const idOf = (path: string): Expression => ({ var: path });

/** 文字計算欄:值就是填寫者的 id(型別是文字,語意是 ID)。 */
function actorIdField(key = "actor_id"): FieldDef {
  return field(key, "text", {
    valueSource: { kind: "computed", expr: idOf("ctx.user.id") },
  });
}

function submissionPrefill(
  formKey: string,
  sourceField: string,
  fieldKey: string,
): Prefill {
  return {
    label: "帶入",
    source: { provider: "form_submission", labelField: "title", formKey },
    mapping: [{ sourceField, fieldKey }],
  };
}

/** 條件掛在 `note` 上:拿某個欄位跟寫死的字串比。 */
function fixedComparison(fieldKey: string): FieldDef {
  return field("note", "text", {
    visibleWhen: { "==": [idOf(fieldKey), "source-user"] },
  });
}

function expectPublishable(definition: FormDefinition): void {
  expect(
    validateDefinition(definition, { regexSafety: () => true }).errors,
  ).toEqual([]);
}

function portableErrors(
  seed: FormDefinitionSeedSet,
  sharedForms: [string, FormDefinition][] = [],
): [string, string][] {
  expectPublishable(seed.definition);
  for (const [, definition] of sharedForms) {
    expectPublishable(definition);
  }
  return validatePortableDefinition(
    seed,
    catalogOf({ sharedForms: new Map(sharedForms) }),
  ).errors.map((issue) => [issue.code, issue.path]);
}

describe("帶入的 ID 傳播:摘要槽", () => {
  /** 目標表單:從來源表單提交的「標題」摘要槽帶入 `copied`,再拿 `copied` 跟寫死的值比。 */
  const target = formSeed(
    [
      field("subject", "text"),
      field("copied", "text"),
      fixedComparison("copied"),
    ],
    { key: TARGET_FORM },
    { prefills: [submissionPrefill(SOURCE_FORM, "title", "copied")] },
  );

  it("來源的標題槽對到「值是 ID」的欄位:帶入的目標也是 ID,與寫死的值比較拒絕", () => {
    const source = definitionOf([actorIdField(), field("memo", "text")], {
      summaryMap: { title: "actor_id" },
    });
    expect(portableErrors(target, [[SOURCE_FORM, source]])).toEqual([
      ["ID_COMPARISON", "definition.fields.2.visibleWhen.==.1"],
    ]);
  });

  it("槽優先於同名欄位:來源另有一個叫 title 的 ID 欄位,但標題槽對到一般文字欄 → 帶入的不是 ID", () => {
    const source = definitionOf(
      [field("memo", "text"), actorIdField("title")],
      {
        summaryMap: { title: "memo" },
      },
    );
    expect(portableErrors(target, [[SOURCE_FORM, source]])).toEqual([]);
  });

  it("帶入的是來源的一般欄位(不是槽):照那個欄位自己的語意", () => {
    const source = definitionOf([field("memo", "text"), actorIdField()]);
    const byField = (sourceField: string) =>
      formSeed(
        [
          field("subject", "text"),
          field("copied", "text"),
          fixedComparison("copied"),
        ],
        { key: TARGET_FORM },
        { prefills: [submissionPrefill(SOURCE_FORM, sourceField, "copied")] },
      );
    expect(portableErrors(byField("memo"), [[SOURCE_FORM, source]])).toEqual(
      [],
    );
    expect(
      portableErrors(byField("actor_id"), [[SOURCE_FORM, source]]),
    ).toEqual([["ID_COMPARISON", "definition.fields.2.visibleWhen.==.1"]]);
  });
});

/** 從自己的提交把 `sourceField` 帶入 `copied`,再拿 `copied` 跟寫死的值比。 */
function selfPrefill(sourceField: string): FormDefinitionSeedSet {
  return formSeed(
    [
      field("subject", "text"),
      actorIdField(),
      field("copied", "text"),
      fixedComparison("copied"),
    ],
    { key: TARGET_FORM },
    { prefills: [submissionPrefill(TARGET_FORM, sourceField, "copied")] },
  );
}

const USER_LOOKUP = {
  kind: "lookup" as const,
  source: { provider: "user", labelField: "name" },
};

/** lookup 多選 `watchers` + 另一個以公式產生值的 lookup 多選 `mirror`。 */
function mirrorOf(expr: Expression): FormDefinitionSeedSet {
  return formSeed([
    field("subject", "text"),
    field("watchers", "multiSelect", { options: USER_LOOKUP }),
    field("mirror", "multiSelect", {
      options: USER_LOOKUP,
      valueSource: { kind: "computed", expr },
    }),
  ]);
}

function referenceWithDefault(expr: Expression): FormDefinitionSeedSet {
  return formSeed([
    field("subject", "text"),
    userReference("applicant", { default: { kind: "expression", expr } }),
  ]);
}

describe("帶入的 ID 傳播:自己帶入自己、互相帶入", () => {
  it("從自己的提交帶入「由公式算出 ID」的欄位:目標也是 ID(不論目錄有沒有把自己列進去)", () => {
    const seed = selfPrefill("actor_id");
    const expected = [
      ["ID_COMPARISON", "definition.fields.3.visibleWhen.==.1"],
    ];
    expect(portableErrors(seed)).toEqual(expected);
    expect(portableErrors(seed, [[TARGET_FORM, seed.definition]])).toEqual(
      expected,
    );
  });

  it("自己帶入自己本身是允許的:帶入一般欄位不報錯", () => {
    expect(portableErrors(selfPrefill("subject"))).toEqual([]);
  });

  it("兩張表單互相帶入:ID 繞一圈回來仍然認得", () => {
    // 來源表單的 relay 從目標表單的 actor_id 帶入;目標表單的 copied 再從來源的 relay 帶入
    const source = definitionOf(
      [field("memo", "text"), field("relay", "text")],
      {
        prefills: [submissionPrefill(TARGET_FORM, "actor_id", "relay")],
      },
    );
    const seed = formSeed(
      [
        field("subject", "text"),
        actorIdField(),
        field("copied", "text"),
        fixedComparison("copied"),
      ],
      { key: TARGET_FORM },
      { prefills: [submissionPrefill(SOURCE_FORM, "relay", "copied")] },
    );
    expect(portableErrors(seed, [[SOURCE_FORM, source]])).toEqual([
      ["ID_COMPARISON", "definition.fields.3.visibleWhen.==.1"],
    ]);
  });
});

describe("值是 ID 的欄位不能帶寫死的預設", () => {
  const userPrefill: Prefill = {
    label: "帶入使用者",
    source: { provider: "user", labelField: "name" },
    mapping: [{ sourceField: "id", fieldKey: "copied_id" }],
  };

  it("由來源 id 帶入的文字欄:固定預設與寫死的預設公式都拒絕", () => {
    const constant = formSeed(
      [
        field("subject", "text"),
        field("copied_id", "text", {
          default: { kind: "constant", value: "source-user" },
        }),
      ],
      {},
      { prefills: [userPrefill] },
    );
    expect(portableErrors(constant)).toEqual([
      ["FIXED_ENVIRONMENT_VALUE", "definition.fields.1.default.value"],
    ]);

    const expression = formSeed(
      [
        field("subject", "text"),
        field("copied_id", "text", {
          default: { kind: "expression", expr: "source-user" },
        }),
      ],
      {},
      { prefills: [userPrefill] },
    );
    expect(portableErrors(expression)).toEqual([
      ["ID_FIXED_MIX", "definition.fields.1.default.expr"],
    ]);
  });

  it("同一個欄位的預設是動態 ID(填寫者)就可以;沒被帶入 id 的一般文字欄照樣能有固定預設", () => {
    const dynamicDefault = formSeed(
      [
        field("subject", "text"),
        field("copied_id", "text", {
          default: { kind: "expression", expr: idOf("ctx.user.id") },
        }),
      ],
      {},
      { prefills: [userPrefill] },
    );
    expect(portableErrors(dynamicDefault)).toEqual([]);

    const plain = formSeed(
      [
        field("subject", "text"),
        field("copied_name", "text", {
          default: { kind: "constant", value: "source-user" },
        }),
        field("greeting", "text", {
          default: { kind: "expression", expr: "source-user" },
        }),
      ],
      {},
      {
        prefills: [
          {
            ...userPrefill,
            mapping: [{ sourceField: "name", fieldKey: "copied_name" }],
          },
        ],
      },
    );
    expect(portableErrors(plain)).toEqual([]);
  });
});

describe("合法的空值不誤拒", () => {
  it("lookup 多選的公式是空陣列(沒有選)或原樣傳另一個 ID 集合:通過;寫死的清單拒絕", () => {
    expect(portableErrors(mirrorOf([]))).toEqual([]);
    expect(portableErrors(mirrorOf(idOf("watchers")))).toEqual([]);
    expect(
      validatePortableDefinition(mirrorOf(["amy"]), catalogOf()).errors.map(
        (issue) => [issue.code, issue.path],
      ),
    ).toEqual([["ID_FIXED_MIX", "definition.fields.2.valueSource.expr"]]);
  });

  it("引用欄預設值的 null fallback 等同只寫路徑:通過;非空的 fallback 是寫死的值,拒絕", () => {
    expect(
      portableErrors(referenceWithDefault({ var: ["ctx.user.id", null] })),
    ).toEqual([]);
    expect(
      portableErrors(referenceWithDefault({ var: ["ctx.user.orgId"] })),
    ).toEqual([]);
    expect(
      validatePortableDefinition(
        referenceWithDefault({ var: ["ctx.user.id", "source-user"] }),
        catalogOf(),
      ).errors.map((issue) => [issue.code, issue.path]),
    ).toEqual([
      ["FIXED_ENVIRONMENT_VALUE", "definition.fields.1.default.expr"],
    ]);
  });
});

/** 明細:引用子欄 who(可選帶入 id → copied)+ 列內公式拿 copied 比寫死的值。 */
function lines(prefill: boolean): FieldDef {
  return field("lines", "array", {
    widget: { kind: "table" },
    columns: [
      column("copied", "text"),
      column("who", "reference", {
        source: { provider: "user", labelField: "name" },
        ...(prefill && {
          prefill: { mapping: [{ sourceField: "id", fieldKey: "copied" }] },
        }),
      }),
      column("flag", "number", {
        valueSource: {
          kind: "computed",
          expr: { if: [{ "==": [idOf("row.copied"), "source-user"] }, 1, 0] },
        },
      }),
    ],
  });
}

describe("明細引用子欄的列內帶入(B2c)也納入 ID 流向", () => {
  it("由來源 id 帶進同一列的子欄,列內公式拿它比寫死的值 → ID_COMPARISON", () => {
    const errors = portableErrors(
      formSeed([field("subject", "text"), lines(true)]),
    );
    expect(errors.map(([code]) => code)).toContain("ID_COMPARISON");
  });

  it("沒有列內帶入時同一條公式不算 ID 比較", () => {
    expect(
      portableErrors(formSeed([field("subject", "text"), lines(false)])),
    ).toEqual([]);
  });
});
