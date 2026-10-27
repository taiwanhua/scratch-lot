/**
 * `onboard` 指令:以租戶管理員帳號跑開通腳本(開通 skill 請操作者在**自己的終端機**執行)。
 *
 * ```
 * pnpm --filter @repo/db-migrator onboard --api-url=<api 網址> --tenant=<租戶短碼> --account=<租戶管理員帳號> --plan=<開通資料 JSON 檔>
 * ```
 *
 * - 密碼只在終端機輸入(不回顯),不從參數、環境變數或檔案讀,不寫進任何輸出
 * - 開通資料檔(`plan.ts` 的形狀)不放任何密碼:檔案裡出現名稱含 password 的欄位就拒絕
 * - 新建的使用者寄啟用信,本人自己設定密碼
 * - `--tenant` 是要開通的租戶短碼:登入者所屬的租戶不是它就停下,一筆都不寫
 *
 * 本檔沒有載入時的副作用(入口檔 `run.ts` 才有)。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  type FetchLike,
  createGraphqlClient,
  graphqlEndpointOf,
  loginAs,
} from "../../../src/demo/graphql-client";
import {
  type SecretReader,
  createSecretReader,
} from "../../../src/demo/secret-input";
import { type OnboardingPlan, parseOnboardingPlan } from "./plan";
import { runOnboarding } from "./run-onboarding";

const USAGE =
  "用法:onboard --api-url=<api 網址> --tenant=<租戶短碼> --account=<租戶管理員帳號> --plan=<開通資料 JSON 檔>(密碼在終端機輸入)";

export const ONBOARD_PASSWORD_LABEL = "租戶管理員密碼";

interface OnboardArgs {
  apiUrl: string;
  tenant: string;
  account: string;
  planPath: string;
}

export interface OnboardCommandOptions {
  readSecret?: SecretReader;
  fetch?: FetchLike;
  print?: (line: string) => void;
}

export function parseOnboardArgs(argv: readonly string[]): OnboardArgs {
  const values = new Map<string, string>();
  for (const argument of argv) {
    const [flag = "", ...rest] = argument.split("=");
    if (!["--api-url", "--tenant", "--account", "--plan"].includes(flag)) {
      throw new Error(`無法辨識的參數(${USAGE});密碼不從參數讀`);
    }
    values.set(flag, rest.join("="));
  }
  const required = (flag: string): string => {
    const value = values.get(flag)?.trim() ?? "";
    if (value === "") {
      throw new Error(`${flag} 必填(${USAGE})`);
    }
    return value;
  };
  const apiUrl = required("--api-url");
  graphqlEndpointOf(apiUrl);
  return {
    apiUrl,
    tenant: required("--tenant"),
    account: required("--account"),
    planPath: path.resolve(required("--plan")),
  };
}

/** 任何一層出現名稱含 password 的欄位 → 拒絕(開通資料不放密碼)。 */
function assertNoPasswordKeys(value: unknown, at = ""): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoPasswordKeys(item, `${at}[${String(index)}]`);
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const keyPath = at === "" ? key : `${at}.${key}`;
    if (/password/i.test(key)) {
      throw new Error(
        `開通資料不放密碼(${keyPath}):密碼由本人經啟用信設定,租戶管理員密碼在終端機輸入`,
      );
    }
    assertNoPasswordKeys(item, keyPath);
  }
}

export async function loadOnboardingPlan(
  planPath: string,
): Promise<OnboardingPlan> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(planPath, "utf8"));
  } catch (error) {
    throw new Error(
      `讀不到開通資料檔 ${planPath}:${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  assertNoPasswordKeys(raw);
  return parseOnboardingPlan(raw);
}

export async function runOnboardCommand(
  argv: readonly string[],
  options: OnboardCommandOptions = {},
): Promise<void> {
  const output =
    options.print ??
    ((line: string): void => {
      process.stdout.write(`${line}\n`);
    });
  const args = parseOnboardArgs(argv);
  const plan = await loadOnboardingPlan(args.planPath);
  const password = await (options.readSecret ?? createSecretReader())(
    ONBOARD_PASSWORD_LABEL,
  );
  const api = createGraphqlClient({
    apiUrl: args.apiUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const admin = await loginAs(
    api,
    { account: args.account, password },
    "租戶管理員",
  );
  await runOnboarding({
    client: admin,
    plan,
    activation: { mode: "EMAIL" },
    tenantSlug: args.tenant,
    print: output,
  });
}

export async function runOnboardEntry(argv: readonly string[]): Promise<void> {
  try {
    await runOnboardCommand(argv);
  } catch (error: unknown) {
    process.stderr.write(
      `onboard 失敗:${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
