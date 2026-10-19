import { describe, expect, it } from "@jest/globals";

import {
  type DemoMode,
  demoConfirmationOf,
  findDemoSafetyViolation,
} from "./demo-safety";

const DATABASE = "scratch-lot-dev";

function check(
  overrides: Partial<{
    environment: string | undefined;
    mode: DemoMode;
    confirm: string | undefined;
    allowEnv: string | undefined;
  }> = {},
): string | null {
  const environment =
    "environment" in overrides ? overrides.environment : "dev";
  const mode = overrides.mode ?? "create";
  return findDemoSafetyViolation({
    databaseName: DATABASE,
    environment,
    mode,
    confirm:
      "confirm" in overrides
        ? overrides.confirm
        : `demo:${environment ?? ""}:${DATABASE}:${mode}`,
    allowEnv:
      "allowEnv" in overrides ? overrides.allowEnv : "dev,staging,production",
  });
}

describe("demo 的安全閥(規格 2.2:安全規則同 reset)", () => {
  it("確認字串 = demo:<環境>:<資料庫名>:<mode>,三個環境(含 production)都通過", () => {
    expect(
      demoConfirmationOf({
        environment: "dev",
        databaseName: DATABASE,
        mode: "create",
      }),
    ).toBe(`demo:dev:${DATABASE}:create`);
    for (const environment of ["dev", "staging", "production"]) {
      expect(check({ environment })).toBeNull();
    }
  });

  it("確認字串錯一個字、少一個字、環境或 mode 對不上:不執行,並指出哪一段", () => {
    expect(check({ confirm: `demo:dev:${DATABASE}:creat` })).toMatch(
      /模式段不符/,
    );
    expect(check({ confirm: `demo:dev:${DATABASE}x:create` })).toMatch(
      /資料庫名段不符/,
    );
    expect(check({ confirm: `demo:staging:${DATABASE}:create` })).toMatch(
      /環境段不符/,
    );
    expect(check({ confirm: `reset:dev:${DATABASE}:create` })).toMatch(
      /格式不是 demo:/,
    );
    expect(
      check({ mode: "purge", confirm: `demo:dev:${DATABASE}:create` }),
    ).toMatch(/模式段不符/);
    expect(check({ confirm: "" })).toMatch(/--confirm 必填/);
    expect(check({ confirm: undefined })).toMatch(/--confirm 必填/);
  });

  it("production 也一定要確認字串(沒有另外的放行)", () => {
    expect(check({ environment: "production", confirm: undefined })).toMatch(
      /--confirm 必填/,
    );
  });

  it("--environment 不在 DEMO_ALLOW_ENV:不執行(未設 = 全部拒絕)", () => {
    expect(check({ allowEnv: "staging" })).toMatch(
      /DEMO_ALLOW_ENV\(目前:staging\)不含目標環境 dev/,
    );
    expect(check({ allowEnv: undefined })).toMatch(
      /DEMO_ALLOW_ENV\(目前:\(未設\)\)/,
    );
    expect(check({ environment: "production", allowEnv: "dev" })).toMatch(
      /不含目標環境 production/,
    );
  });

  it("--environment 沒給或不是三個環境之一:不執行(不從資料庫名推測)", () => {
    expect(check({ environment: undefined })).toMatch(/--environment 必填/);
    expect(check({ environment: "prod" })).toMatch(/--environment 必填/);
  });

  it("拒絕訊息不回顯收到的確認字串", () => {
    const pasted = "mongodb://user:secret@host/db";
    expect(check({ confirm: pasted })).not.toContain("secret");
  });
});
