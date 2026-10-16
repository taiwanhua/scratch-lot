import { describe, expect, it } from "@jest/globals";

import { ClientError } from "@repo/graphql";

import { parseAdminError } from "./errors";

const clientErrorOf = (
  errors: { message?: string; extensions?: Record<string, unknown> }[],
): ClientError =>
  new ClientError({ errors, status: 200, headers: new Headers() } as never, {
    query: "mutation { x }",
  });

const SPEC = {
  codes: ["NOT_FOUND", "ORG_NOT_DELETABLE", "RULE_INVALID"] as const,
  reasons: ["HAS_CHILDREN", "HAS_MEMBERS", "VALUE_TYPE"] as const,
};

/** #430:各頁 `<ns>ErrorOf` 共用的解讀器 —— 形狀 `{ code, reason?, reasons?, fields?, path?, message? }`。 */
describe("parseAdminError", () => {
  it("不是 ClientError(網路錯誤等)→ 只有 code: UNEXPECTED", () => {
    expect(parseAdminError(new Error("boom"), SPEC)).toEqual({
      code: "UNEXPECTED",
    });
  });

  it("取第一個認得的碼;沒宣告的碼跳過", () => {
    const error = clientErrorOf([
      { message: "other", extensions: { code: "SOMETHING_ELSE" } },
      { message: "查無", extensions: { code: "NOT_FOUND" } },
    ]);

    expect(parseAdminError(error, SPEC)).toEqual({
      code: "NOT_FOUND",
      message: "查無",
    });
  });

  it("reasons / reason 只收白名單內的值,fields / path 原樣帶出", () => {
    const error = clientErrorOf([
      {
        extensions: {
          code: "ORG_NOT_DELETABLE",
          reasons: ["HAS_CHILDREN", "UNKNOWN", 3, "HAS_MEMBERS"],
          reason: "NOT_LISTED",
          fields: ["name", 1],
          path: "rules[0].filter",
        },
      },
    ]);

    expect(parseAdminError(error, SPEC)).toEqual({
      code: "ORG_NOT_DELETABLE",
      reasons: ["HAS_CHILDREN", "HAS_MEMBERS"],
      fields: ["name"],
      path: "rules[0].filter",
    });
  });

  it("單一 reason 在白名單內才出現", () => {
    const error = clientErrorOf([
      { extensions: { code: "RULE_INVALID", reason: "VALUE_TYPE" } },
    ]);

    expect(parseAdminError(error, SPEC)).toEqual({
      code: "RULE_INVALID",
      reason: "VALUE_TYPE",
    });
  });

  it("refine 可把通用碼依 reason 細分成本頁自己的碼", () => {
    const error = clientErrorOf([
      { extensions: { code: "FORBIDDEN", reason: "NOT_OWNER" } },
    ]);

    expect(
      parseAdminError<"FORBIDDEN" | "NOT_OWNER", never>(error, {
        codes: ["FORBIDDEN"],
        refine: (code, reason) =>
          code === "FORBIDDEN" && reason === "NOT_OWNER"
            ? "NOT_OWNER"
            : undefined,
      }),
    ).toEqual({ code: "NOT_OWNER" });
  });

  it("沒有認得的碼 → UNEXPECTED(不帶任何選填欄位)", () => {
    const error = clientErrorOf([
      { message: "x", extensions: { code: "WHO_KNOWS", fields: ["name"] } },
    ]);

    expect(parseAdminError(error, SPEC)).toEqual({ code: "UNEXPECTED" });
  });
});
