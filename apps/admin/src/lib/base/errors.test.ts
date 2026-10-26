import { describe, expect, it } from "@jest/globals";

import { ClientError } from "@repo/graphql";

import { adminErrorText, parseAdminError } from "./errors";

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

/** 各頁 `<ns>ErrorOf` 共用的解讀器 —— 形狀 `{ code, reason?, reasons?, fields?, path?, message? }`。 */
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

const forbidden = (reason: unknown) =>
  clientErrorOf([
    { message: "blocked", extensions: { code: "FORBIDDEN", reason } },
  ]);

const translator = (dictionary: Record<string, string>) =>
  Object.assign((key: string) => dictionary[key] ?? key, {
    has: (key: string) => key in dictionary,
  });

const tErrors = (code: string) => `errors.${code}`;

/** 專案登記的守門擋下:`FORBIDDEN` + 專案錯誤碼(`docs/concepts/workflow-engine.md`「掛接點」)。 */
describe("專案錯誤碼(projectReason / adminErrorText)", () => {
  const FORBIDDEN_SPEC = {
    codes: ["FORBIDDEN", "NOT_FOUND"] as const,
    refine: (code: string, reason: unknown) =>
      code === "FORBIDDEN" && reason === "ROOT_ONLY"
        ? ("NOT_FOUND" as const)
        : undefined,
  };

  it("FORBIDDEN 帶本頁不認得、格式合格的 reason → projectReason", () => {
    expect(
      parseAdminError(forbidden("PURCHASE_UNRECEIVED_ROWS"), FORBIDDEN_SPEC),
    ).toEqual({
      code: "FORBIDDEN",
      projectReason: "PURCHASE_UNRECEIVED_ROWS",
      message: "blocked",
    });
  });

  it("被細分的 reason、格式不合的 reason、其他碼 → 沒有 projectReason", () => {
    expect(
      parseAdminError(forbidden("ROOT_ONLY"), FORBIDDEN_SPEC).projectReason,
    ).toBeUndefined();
    expect(
      parseAdminError(forbidden("not-a-code"), FORBIDDEN_SPEC).projectReason,
    ).toBeUndefined();
    const notFound = clientErrorOf([
      { extensions: { code: "NOT_FOUND", reason: "SOME_REASON" } },
    ]);
    expect(
      parseAdminError(notFound, FORBIDDEN_SPEC).projectReason,
    ).toBeUndefined();
  });

  it("專案字典有 admin.lifecycle.<碼> → 顯示專案文案", () => {
    const t = translator({
      "admin.lifecycle.PURCHASE_UNRECEIVED_ROWS": "還有明細沒有點收",
    });
    expect(
      adminErrorText(
        { code: "FORBIDDEN", projectReason: "PURCHASE_UNRECEIVED_ROWS" },
        tErrors,
        t,
      ),
    ).toBe("還有明細沒有點收");
  });

  it("專案字典沒有這個 key → 退回通用的 <ns>.errors.FORBIDDEN", () => {
    expect(
      adminErrorText(
        { code: "FORBIDDEN", projectReason: "PURCHASE_UNRECEIVED_ROWS" },
        tErrors,
        translator({}),
      ),
    ).toBe("errors.FORBIDDEN");
    expect(adminErrorText({ code: "NOT_FOUND" }, tErrors, translator({}))).toBe(
      "errors.NOT_FOUND",
    );
  });
});

describe("交易逾時(TRANSACTION_TIMEOUT)", () => {
  it("任何一頁都認得:code 照舊 UNEXPECTED、帶 timedOut(頁面的碼表不必登記)", () => {
    const error = clientErrorOf([
      {
        message: "transaction exceeded 60000ms and was rolled back",
        extensions: { code: "TRANSACTION_TIMEOUT", timeoutMs: 60_000 },
      },
    ]);
    expect(parseAdminError(error, SPEC)).toEqual({
      code: "UNEXPECTED",
      timedOut: true,
      message: "transaction exceeded 60000ms and was rolled back",
    });
  });

  it("adminErrorText 顯示共用的逾時文案(已取消、資料沒有變更);字典沒有就退回 <ns>.errors.UNEXPECTED", () => {
    const t = translator({
      "admin.app.errors.transactionTimeout": "處理時間過長,已取消",
    });
    expect(
      adminErrorText({ code: "UNEXPECTED", timedOut: true }, tErrors, t),
    ).toBe("處理時間過長,已取消");
    expect(
      adminErrorText(
        { code: "UNEXPECTED", timedOut: true },
        tErrors,
        translator({}),
      ),
    ).toBe("errors.UNEXPECTED");
  });
});
