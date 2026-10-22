import { describe, expect, it } from "@jest/globals";

import {
  fieldErrorTextsOf,
  fieldErrorsByCodeOf,
  formErrorSummary,
  withoutFieldError,
} from "./field-errors";

/** REACT-18:欄位錯了就在欄位正下方寫原因;頁面提示只放通用句。 */
const formatText = (field: string) => `${field} 的格式要求`;
const codeText = (code: string) => `碼 ${code}`;

describe("欄位錯誤的原因(REACT-18)", () => {
  it("只收表單上有的欄位;每一欄寫呼叫端給的那一句", () => {
    expect(
      fieldErrorTextsOf(["code", "id"], ["code", "name"], formatText),
    ).toEqual({ code: "code 的格式要求" });
    expect(fieldErrorTextsOf(undefined, ["name"], formatText)).toEqual({});
  });

  it("改了那一欄就清掉那一欄,其他欄照留", () => {
    const texts = { name: "必填", note: "太長" };
    expect(withoutFieldError(texts, "name")).toEqual({ note: "太長" });
    expect(withoutFieldError(texts, "email" as "name")).toBe(texts);
  });

  it("有欄位錯誤 → 提示只放通用句;沒有對到欄位 → 提示寫原因", () => {
    expect(formErrorSummary({ name: "必填" }, "通用句", "原因")).toBe("通用句");
    expect(formErrorSummary({}, "通用句", "原因")).toBe("原因");
  });

  it("依 reason 細分過的碼:VALIDATION_FAILED 寫格式要求,細分過的碼寫原因", () => {
    expect(
      fieldErrorsByCodeOf(
        { code: "VALIDATION_FAILED", fields: ["group"] },
        ["group", "code"],
        { formatText, codeText },
      ),
    ).toEqual({
      texts: { group: "group 的格式要求" },
      summary: "碼 VALIDATION_FAILED",
    });
    expect(
      fieldErrorsByCodeOf(
        { code: "CODE_DUPLICATE", fields: ["code"] },
        ["group", "code"],
        { formatText, codeText },
      ),
    ).toEqual({
      texts: { code: "碼 CODE_DUPLICATE" },
      summary: "碼 VALIDATION_FAILED",
    });
  });

  it("指到多欄、各欄原因不同時由 codeOfField 指定;沒有對到欄位時提示寫原因", () => {
    expect(
      fieldErrorsByCodeOf(
        { code: "CODE_DUPLICATE", fields: ["code", "name"] },
        ["code", "name"],
        {
          formatText,
          codeText,
          codeOfField: (field, code) =>
            field === "name" ? "NAME_DUPLICATE" : code,
        },
      ).texts,
    ).toEqual({
      code: "碼 CODE_DUPLICATE",
      name: "碼 NAME_DUPLICATE",
    });
    expect(
      fieldErrorsByCodeOf({ code: "RECORD_IN_USE", fields: ["id"] }, ["code"], {
        formatText,
        codeText,
      }),
    ).toEqual({ texts: {}, summary: "碼 RECORD_IN_USE" });
  });
});
