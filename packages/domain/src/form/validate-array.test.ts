import { describe, expect, it } from "@jest/globals";

import { recheckRegexSafety } from "../form-regex-safety";
import {
  arrayField,
  column,
  computedColumn,
  computedNumber,
} from "./array-test-support";
import { definitionOf, field } from "./form-test-support";
import type { DefinitionIssue } from "./issues";
import type { FieldDef, FormDefinition } from "./types";
import { validateDefinition } from "./validate-definition";

const title = field("title", "text");
const qty = column("qty", "number");
const items = arrayField("items", [qty]);

function reportOf(definition: FormDefinition, listColumnFieldKeys?: string[]) {
  return validateDefinition(definition, {
    regexSafety: recheckRegexSafety,
    ...(listColumnFieldKeys && { listColumnFieldKeys }),
  });
}

/** 只看某個錯誤碼的錯誤(每個案例只關心自己那一類)。 */
function errorsOf(fields: FieldDef[], code: string): DefinitionIssue[] {
  return reportOf(definitionOf([title, ...fields])).errors.filter(
    (issue) => issue.code === code,
  );
}

describe("檢查器:明細列的定義", () => {
  it("明細欄 + 彙總計算欄位的乾淨定義沒有錯誤", () => {
    const subtotal = computedColumn("subtotal", {
      "*": [{ var: "row.qty" }, 2],
    });
    const report = reportOf(
      definitionOf([
        title,
        arrayField("items", [qty, subtotal]),
        computedNumber("total", { sumOf: ["items", "subtotal"] }),
      ]),
    );
    expect(report.errors).toEqual([]);
  });

  it("至少要一個子欄", () => {
    expect(
      errorsOf([arrayField("items", [])], "ARRAY_COLUMNS_MISSING"),
    ).toHaveLength(1);
  });

  it("子欄 key 格式不符", () => {
    const [issue] = errorsOf(
      [arrayField("items", [column("Bad-Key", "text")])],
      "ARRAY_COLUMN_KEY",
    );
    expect(issue?.location).toEqual({
      fieldKey: "items",
      columnKey: "Bad-Key",
    });
  });

  it("子欄 key 是保留字(row)", () => {
    const [issue] = errorsOf(
      [arrayField("items", [column("row", "text")])],
      "ARRAY_COLUMN_KEY",
    );
    expect(issue?.message).toContain("保留字");
  });

  it("明細欄的值來源不是使用者填", () => {
    const computedArray = arrayField("items", [qty], {
      valueSource: { kind: "computed", expr: null },
    });
    const [issue] = errorsOf([computedArray], "ARRAY_FIELD_SETTING");
    expect(issue?.location.property).toBe("valueSource");
  });

  it("子欄寬度不是正整數", () => {
    const [issue] = errorsOf(
      [arrayField("items", [column("note", "text", { width: 12.5 })])],
      "ARRAY_COLUMN_SETTING",
    );
    expect(issue?.location.property).toBe("width");
  });

  it("minRows 不是整數", () => {
    const [issue] = errorsOf(
      [arrayField("items", [qty], { rules: { minRows: 1.5 } })],
      "ARRAY_ROWS_INVALID",
    );
    expect(issue?.location.property).toBe("rules.minRows");
  });

  it("子欄 key 重複", () => {
    expect(
      errorsOf(
        [arrayField("items", [column("qty", "text"), qty])],
        "ARRAY_COLUMN_KEY_DUPLICATE",
      ),
    ).toHaveLength(1);
  });

  it("白名單外的子欄型別(多行文字)", () => {
    const multiline = {
      ...column("memo", "text"),
      type: "multiline",
    } as unknown as ReturnType<typeof column>;
    expect(
      errorsOf([arrayField("items", [multiline])], "ARRAY_COLUMN_TYPE"),
    ).toHaveLength(1);
  });

  it("白名單外的子欄元件(是否用開關)", () => {
    const toggle = column("done", "boolean", { widget: { kind: "switch" } });
    expect(
      errorsOf([arrayField("items", [toggle])], "ARRAY_COLUMN_WIDGET"),
    ).toHaveLength(1);
  });

  it("白名單外的子欄規則(自訂驗證)", () => {
    const custom = column("note", "text", { rules: { custom: true } });
    const [issue] = errorsOf(
      [arrayField("items", [custom])],
      "ARRAY_COLUMN_SETTING",
    );
    expect(issue?.location.property).toBe("rules.custom");
  });

  it("子欄不支援子欄級權限", () => {
    const guarded = {
      ...qty,
      permission: { show: true, edit: false },
    } as unknown as ReturnType<typeof column>;
    const [issue] = errorsOf(
      [arrayField("items", [guarded])],
      "ARRAY_COLUMN_SETTING",
    );
    expect(issue?.location.property).toBe("permission");
  });

  it("子欄的單選不能用 lookup 來源", () => {
    const lookup = column("who", "select", {
      options: {
        kind: "lookup",
        source: { provider: "user", labelField: "name" },
      },
    });
    const [issue] = errorsOf(
      [arrayField("items", [lookup])],
      "ARRAY_COLUMN_SETTING",
    );
    expect(issue?.location.property).toBe("options");
  });

  describe("引用子欄(B2b)", () => {
    const store = column("store", "reference", {
      source: { provider: "user", labelField: "name" },
    });

    it("有來源的引用子欄沒有錯誤;登錄表認得的來源也過", () => {
      expect(
        reportOf(definitionOf([title, arrayField("items", [qty, store])]))
          .errors,
      ).toEqual([]);
      const report = validateDefinition(
        definitionOf([title, arrayField("items", [store])]),
        {
          regexSafety: recheckRegexSafety,
          lookupProviders: { user: { fields: { name: "text" } } },
        },
      );
      expect(report.errors).toEqual([]);
    });

    it("沒設來源 → REFERENCE_SOURCE_MISSING,定位到明細欄 + 子欄", () => {
      const [issue] = errorsOf(
        [arrayField("items", [column("store", "reference")])],
        "REFERENCE_SOURCE_MISSING",
      );
      expect(issue?.location).toEqual({
        fieldKey: "items",
        columnKey: "store",
        property: "source",
      });
    });

    it("登錄表沒有的來源 → 錯誤定位到子欄", () => {
      const report = validateDefinition(
        definitionOf([
          title,
          arrayField("items", [
            column("store", "reference", {
              source: { provider: "nowhere", labelField: "name" },
            }),
          ]),
        ]),
        {
          regexSafety: recheckRegexSafety,
          lookupProviders: { user: { fields: { name: "text" } } },
        },
      );
      expect(report.errors).toContainEqual(
        expect.objectContaining({
          location: expect.objectContaining({
            fieldKey: "items",
            columnKey: "store",
          }) as unknown,
        }),
      );
    });

    it("引用子欄不能用列內公式", () => {
      const computedRef = column("store", "reference", {
        source: { provider: "user", labelField: "name" },
        valueSource: { kind: "computed", expr: { var: "row.qty" } },
      });
      const [issue] = errorsOf(
        [arrayField("items", [qty, computedRef])],
        "ARRAY_COLUMN_SETTING",
      );
      expect(issue?.location.property).toBe("valueSource");
    });

    it("不是引用的子欄不能設來源", () => {
      const withSource = column("note", "text", {
        source: { provider: "user", labelField: "name" },
      });
      const [issue] = errorsOf(
        [arrayField("items", [withSource])],
        "ARRAY_COLUMN_SETTING",
      );
      expect(issue?.location.property).toBe("source");
    });
  });

  it("每版明細欄上限 5", () => {
    const arrays = Array.from({ length: 6 }, (_, index) =>
      arrayField(`items_${String(index)}`, [qty]),
    );
    expect(errorsOf(arrays, "ARRAY_LIMIT")).toHaveLength(1);
  });

  it("每個明細子欄上限 20", () => {
    const columns = Array.from({ length: 21 }, (_, index) =>
      column(`c${String(index)}`, "text"),
    );
    expect(
      errorsOf([arrayField("items", columns)], "ARRAY_COLUMN_LIMIT"),
    ).toHaveLength(1);
  });

  it("maxRows 上限 200", () => {
    expect(
      errorsOf(
        [arrayField("items", [qty], { rules: { maxRows: 201 } })],
        "ARRAY_ROWS_INVALID",
      ),
    ).toHaveLength(1);
  });

  it("max(minRows, 必填 ? 1 : 0) 不能超過 maxRows", () => {
    expect(
      errorsOf(
        [arrayField("items", [qty], { rules: { required: true, maxRows: 0 } })],
        "ARRAY_ROWS_INVALID",
      ),
    ).toHaveLength(1);
  });

  it("明細欄不能設鎖定條件", () => {
    const locked = arrayField("items", [qty], { readonlyWhen: true });
    expect(errorsOf([locked], "ARRAY_FIELD_SETTING")).toHaveLength(1);
  });

  it("版面固定占 12 格", () => {
    const definition = definitionOf([title, items]);
    const section = definition.layout.sections[0];
    const itemsRow = section?.rows.find(
      (row) => row.cols[0]?.fieldKey === "items",
    );
    if (itemsRow?.cols[0]) {
      itemsRow.cols[0].span = 6;
    }
    expect(reportOf(definition).errors.map((issue) => issue.code)).toContain(
      "ARRAY_SPAN",
    );
  });
});

describe("檢查器:列內公式與彙總", () => {
  it("表單層公式不能用 row.*", () => {
    const [issue] = errorsOf(
      [items, computedNumber("total", { var: "row.qty" })],
      "EXPR_ROW_OUT_OF_SCOPE",
    );
    expect(issue?.location.fieldKey).toBe("total");
  });

  it("列內公式的 row.* 必須是同一個明細的子欄", () => {
    const wrong = computedColumn("subtotal", { var: "row.price" });
    const [issue] = errorsOf(
      [arrayField("items", [qty, wrong])],
      "EXPR_ROW_OUT_OF_SCOPE",
    );
    expect(issue?.location).toMatchObject({
      fieldKey: "items",
      columnKey: "subtotal",
    });
  });

  it("不能直接 var 整個明細欄", () => {
    expect(
      errorsOf(
        [
          items,
          field("flag", "boolean", { visibleWhen: { "!!": { var: "items" } } }),
        ],
        "EXPR_ARRAY_REF",
      ),
    ).toHaveLength(1);
  });

  it("彙總的第一個參數必須是明細欄", () => {
    expect(
      errorsOf(
        [
          field("price", "number"),
          computedNumber("total", { sumOf: ["price", "qty"] }),
        ],
        "EXPR_AGGREGATE_ARG",
      ),
    ).toHaveLength(1);
  });

  it("彙總的子欄必須存在", () => {
    expect(
      errorsOf(
        [items, computedNumber("total", { sumOf: ["items", "price"] })],
        "EXPR_AGGREGATE_ARG",
      ),
    ).toHaveLength(1);
  });

  it("彙總的子欄必須是數字", () => {
    const named = arrayField("items", [column("name", "text")]);
    expect(
      errorsOf(
        [named, computedNumber("total", { maxOf: ["items", "name"] })],
        "EXPR_AGGREGATE_ARG",
      ),
    ).toHaveLength(1);
  });

  it("countOf 只驗明細 key(沒有數字子欄也行)", () => {
    const named = arrayField("items", [column("name", "text")]);
    expect(
      errorsOf(
        [named, computedNumber("total", { countOf: ["items"] })],
        "EXPR_AGGREGATE_ARG",
      ),
    ).toEqual([]);
  });

  it("彙總參數不能運算出來", () => {
    expect(
      errorsOf(
        [items, computedNumber("total", { sumOf: [{ var: "title" }, "qty"] })],
        "EXPR_INVALID",
      ),
    ).toHaveLength(1);
  });

  it("循環:total = sumOf(items, subtotal) 且 subtotal = row.qty × total", () => {
    const cyclic = arrayField("items", [
      qty,
      computedColumn("subtotal", {
        "*": [{ var: "row.qty" }, { var: "total" }],
      }),
    ]);
    expect(
      errorsOf(
        [cyclic, computedNumber("total", { sumOf: ["items", "subtotal"] })],
        "EXPR_CYCLE",
      ),
    ).toHaveLength(1);
  });

  it("列內公式的根型別要等於子欄型別", () => {
    const text = column("label", "text", {
      valueSource: { kind: "computed", expr: { "*": [{ var: "row.qty" }, 2] } },
    });
    const [issue] = errorsOf(
      [arrayField("items", [qty, text])],
      "EXPR_TYPE_MISMATCH",
    );
    expect(issue?.location).toMatchObject({
      fieldKey: "items",
      columnKey: "label",
    });
  });

  it("條件引用受保護明細的彙總 → EXPR_PROTECTED_REF", () => {
    const guarded = arrayField("items", [qty], {
      permission: { show: true, edit: false },
    });
    const flag = field("flag", "boolean", {
      visibleWhen: { ">": [{ countOf: ["items"] }, 0] },
    });
    expect(errorsOf([guarded, flag], "EXPR_PROTECTED_REF")).toHaveLength(1);
  });
});

describe("檢查器:明細與子路徑不可用的地方", () => {
  it("不可當摘要槽", () => {
    const definition = definitionOf([title, items], {
      summaryMap: { title: "title", amount: "items" },
    });
    expect(reportOf(definition).errors.map((issue) => issue.code)).toContain(
      "ARRAY_NOT_ALLOWED",
    );
  });

  it("不可當帶入目標", () => {
    const definition = definitionOf([title, items], {
      prefills: [
        {
          label: "帶入",
          source: { provider: "user", labelField: "name" },
          mapping: [{ sourceField: "name", fieldKey: "items" }],
        },
      ],
    });
    expect(reportOf(definition).errors.map((issue) => issue.code)).toContain(
      "ARRAY_NOT_ALLOWED",
    );
  });

  it("不可當 optionLabel 的參數", () => {
    const label = field("label", "text", {
      valueSource: { kind: "computed", expr: { optionLabel: "items" } },
    });
    expect(errorsOf([items, label], "EXPR_TYPE_MISMATCH")).toHaveLength(1);
  });

  it("列表欄位配置引用明細欄 → 警告", () => {
    const report = reportOf(definitionOf([title, items]), ["items"]);
    expect(report.warnings.map((issue) => issue.code)).toContain(
      "LIST_COLUMN_ARRAY",
    );
  });
});

/** 列內帶入測試的引用子欄「遊戲」(來源 `project_game`)。 */
function game(mapping: { sourceField: string; fieldKey: string }[]) {
  return column("game", "reference", {
    source: { provider: "project_game", labelField: "title" },
    prefill: { mapping },
  });
}

describe("檢查器:明細引用子欄的列內帶入(B2c)", () => {
  const registry = {
    project_game: {
      fields: { title: "text" as const, bookAmount: "number" as const },
    },
  };
  const errorsWith = (fields: FieldDef[]): DefinitionIssue[] =>
    validateDefinition(definitionOf([title, ...fields]), {
      regexSafety: recheckRegexSafety,
      lookupProviders: registry,
    }).errors;

  it("帶入同一列型別相容的子欄 → 沒有錯誤", () => {
    const lines = arrayField("lines", [
      game([{ sourceField: "bookAmount", fieldKey: "amount" }]),
      column("amount", "number"),
    ]);
    expect(errorsWith([lines])).toEqual([]);
  });

  it("型別不符 → PREFILL_TYPE_INCOMPATIBLE,定位到子欄的對應表", () => {
    const lines = arrayField("lines", [
      game([{ sourceField: "title", fieldKey: "amount" }]),
      column("amount", "number"),
    ]);
    const issue = errorsWith([lines]).find(
      (candidate) => candidate.code === "PREFILL_TYPE_INCOMPATIBLE",
    );
    expect(issue?.location).toEqual({
      fieldKey: "lines",
      columnKey: "game",
      property: "prefill.mapping.0",
    });
  });

  it("目標不是同一列使用者填的子欄 / 來源沒有這個欄位 → 錯誤", () => {
    const lines = arrayField("lines", [
      game([
        { sourceField: "bookAmount", fieldKey: "game" },
        { sourceField: "nope", fieldKey: "amount" },
      ]),
      column("amount", "number"),
    ]);
    const codes = errorsWith([lines]).map((issue) => issue.code);
    expect(codes).toContain("PREFILL_TARGET_NOT_INPUT");
    expect(codes).toContain("PREFILL_UNKNOWN_SOURCE_FIELD");
  });

  it("不是引用的子欄不能設帶入規則", () => {
    const lines = arrayField("lines", [
      column("note", "text", { prefill: { mapping: [] } }),
    ]);
    const issue = errorsWith([lines]).find(
      (candidate) => candidate.code === "ARRAY_COLUMN_SETTING",
    );
    expect(issue?.location.property).toBe("prefill");
  });
});
