/**
 * demo 指令(`docs/deployment.md`「示範資料(demo)」;形狀照 reset):
 *
 * ```
 * pnpm --filter @repo/db-migrator demo --environment=<dev|staging|production> --mode=<create|purge|rebuild> \
 *   --confirm=demo:<environment>:<資料庫名>:<mode> --api-url=<該環境的 api 網址>
 * ```
 *
 * 1. 安全閥(`demo-safety.ts`):環境允許清單 `DEMO_ALLOW_ENV` + 完整的確認字串(資料庫名取自 `MONGODB_URI`)。
 *    不過即結束,此時還沒有呼叫 api
 * 2. `purge` / `rebuild` 目前拒絕執行(清空示範機構另行實作),一筆都不寫也不刪
 * 3. 讀機密:root 沿用 `ROOT_ADMIN_ACCOUNT` / `ROOT_ADMIN_PASSWORD`(與 seed / reset 同一組環境變數);
 *    示範密碼與基底信箱**只從標準輸入讀**(終端機不回顯;workflow 以管線送入),不從參數、環境變數或檔案讀
 * 4. 以 root 登入 → 建立或找回標「示範」的機構與首任租戶管理員(`demo-tenant.ts`)
 * 5. 以那位租戶管理員登入 → 交給專案登記的示範資料(`seeds/registry.ts` 的 `demoSource`),由開通腳本建出其餘內容
 *
 * **全程走 api 的 GraphQL**:權限照常檢查、操作紀錄照常寫;本指令不連資料庫寫入(`MONGODB_URI` 只用來取資料庫名
 * 組確認字串)。`--api-url` 與 `MONGODB_URI` 要指向同一個環境,由操作者負責。冪等:重跑只補缺的。
 *
 * 輸出只有環境、資料庫名、模式與各步驟的結果,不含連線字串、密碼或真實信箱。
 * 本檔沒有載入時的副作用(入口檔才有)。
 */
import { pathToFileURL } from "node:url";

import { parseDatabaseName } from "../reset/reset-safety";
import {
  DEMO_ALLOW_ENV_NAME,
  DEMO_ENVIRONMENTS,
  DEMO_MODES,
  type DemoMode,
  findDemoSafetyViolation,
} from "./demo-safety";
import type { DemoSource } from "./demo-source";
import { ensureDemoTenant } from "./demo-tenant";
import {
  type FetchLike,
  createGraphqlClient,
  graphqlEndpointOf,
  loginAs,
} from "./graphql-client";
import { type SecretReader, createSecretReader } from "./secret-input";

const USAGE = `用法:demo --environment=<${DEMO_ENVIRONMENTS.join("|")}> --mode=<${DEMO_MODES.join("|")}> --confirm=demo:<environment>:<資料庫名>:<mode> --api-url=<api 網址>`;

const MODE_RULE = `--mode 必須是 ${DEMO_MODES.join(" / ")}(${USAGE})`;

/** 標準輸入要依序給的兩個值(workflow 以管線送入時也是這個順序)。 */
export const DEMO_SECRET_LABELS = {
  password: "示範帳號密碼",
  emailBase: "基底信箱",
} as const;

interface DemoArgs {
  mode: DemoMode;
  environment: string | undefined;
  confirm: string | undefined;
  apiUrl: string | undefined;
}

export interface DemoCommandOptions {
  env?: NodeJS.ProcessEnv;
  /** 讀示範密碼與基底信箱(預設:標準輸入)。 */
  readSecret?: SecretReader;
  /** 專案登記的示範資料(入口檔給:`seeds/registry.ts` 的 `demoSource`,見 `loadRegisteredDemoSource`)。 */
  loadDemoSource: () => Promise<DemoSource | null>;
  /** 呼叫 api 用的 fetch(預設:全域 fetch)。 */
  fetch?: FetchLike;
  print?: (line: string) => void;
}

function isMode(value: string): value is DemoMode {
  return (DEMO_MODES as readonly string[]).includes(value);
}

export function parseDemoArgs(argv: readonly string[]): DemoArgs {
  let mode: DemoMode | undefined;
  let environment: string | undefined;
  let confirm: string | undefined;
  let apiUrl: string | undefined;
  for (const argument of argv) {
    const [flag, ...rest] = argument.split("=");
    const value = rest.join("=");
    // 錯誤訊息不回顯參數值:--confirm 可能被誤貼成連線字串
    switch (flag) {
      case "--mode": {
        if (!isMode(value)) {
          throw new Error(MODE_RULE);
        }
        mode = value;
        break;
      }
      // 空值與沒給同義,由安全閥拒絕並說明
      case "--environment": {
        environment = value;
        break;
      }
      case "--confirm": {
        confirm = value;
        break;
      }
      case "--api-url": {
        apiUrl = value === "" ? undefined : value;
        break;
      }
      default: {
        throw new Error(`無法辨識的參數(${USAGE});密碼與信箱不從參數讀`);
      }
    }
  }
  if (!mode) {
    throw new Error(MODE_RULE);
  }
  return { mode, environment, confirm, apiUrl };
}

/** 固定入口 `seeds/registry.ts`(由入口檔給路徑)匯出的 `demoSource`(沒有登記為 null)。 */
export async function loadRegisteredDemoSource(
  registryPath: string,
): Promise<DemoSource | null> {
  const loaded = (await import(pathToFileURL(registryPath).href)) as {
    demoSource?: DemoSource | null;
  };
  return loaded.demoSource ?? null;
}

// 指令介面本身就是 stdout/stderr(STRUCT-06)
const printLine = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

function requireValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`缺少 ${name} 環境變數`);
  }
  return value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 訊息裡若帶到任何一個機密(連線字串、root 密碼、示範密碼、基底信箱),一律遮掉。 */
function redact(message: string, secrets: readonly (string | undefined)[]) {
  let redacted = message;
  for (const secret of secrets) {
    if (secret !== undefined && secret.trim() !== "") {
      redacted = redacted.replaceAll(secret, "***");
    }
  }
  return redacted;
}

interface DemoTarget {
  environment: string;
  databaseName: string;
  mode: DemoMode;
  apiUrl: string;
}

/** 安全閥與參數:全部通過才回傳目標;任何一項不合就丟錯(此時還沒有呼叫 api)。 */
function resolveTarget(args: DemoArgs, env: NodeJS.ProcessEnv): DemoTarget {
  const databaseName = parseDatabaseName(requireValue(env, "MONGODB_URI"));
  const violation = findDemoSafetyViolation({
    databaseName,
    environment: args.environment,
    mode: args.mode,
    confirm: args.confirm,
    allowEnv: env[DEMO_ALLOW_ENV_NAME],
  });
  if (violation !== null || args.environment === undefined) {
    throw new Error(violation ?? USAGE);
  }
  if (args.mode !== "create") {
    throw new Error(
      `--mode=${args.mode}(清空 / 重建示範機構)尚未提供;目前只能 create,一筆都沒有寫入也沒有刪除`,
    );
  }
  if (args.apiUrl === undefined) {
    throw new Error(
      `--api-url 必填:${args.environment} 環境的 api 網址(${USAGE})`,
    );
  }
  graphqlEndpointOf(args.apiUrl);
  return {
    environment: args.environment,
    databaseName,
    mode: args.mode,
    apiUrl: args.apiUrl,
  };
}

/** 執行一次指令;失敗丟錯(訊息已遮掉機密,由入口檔印出並設定結束碼)。 */
export async function runDemoCommand(
  argv: readonly string[],
  options: DemoCommandOptions,
): Promise<void> {
  const env = options.env ?? process.env;
  const output = options.print ?? printLine;
  const secrets: (string | undefined)[] = [
    env.MONGODB_URI,
    env.ROOT_ADMIN_PASSWORD,
  ];
  try {
    const target = resolveTarget(parseDemoArgs(argv), env);
    const source = await options.loadDemoSource();
    if (source === null) {
      throw new Error(
        "這個專案沒有登記示範資料(seeds/project/registry.ts 的 projectDemoSource)",
      );
    }
    const rootAccount = requireValue(env, "ROOT_ADMIN_ACCOUNT");
    const rootPassword = requireValue(env, "ROOT_ADMIN_PASSWORD");
    const readSecret = options.readSecret ?? createSecretReader();
    const password = await readSecret(DEMO_SECRET_LABELS.password);
    secrets.push(password);
    const enteredBase = await readSecret(DEMO_SECRET_LABELS.emailBase);
    const emailBase = enteredBase.trim();
    secrets.push(emailBase);

    output(
      `demo:環境 ${target.environment}、資料庫 ${target.databaseName}、模式 ${target.mode}、示範機構「${source.tenant.name}」`,
    );
    const api = createGraphqlClient({
      apiUrl: target.apiUrl,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    const root = await loginAs(
      api,
      { account: rootAccount, password: rootPassword },
      "平台管理員(ROOT_ADMIN_ACCOUNT)",
    );
    const tenant = await ensureDemoTenant(
      root,
      source.tenant,
      { emailBase, password },
      output,
    );
    const admin = await loginAs(
      api,
      { account: tenant.adminAccount, password },
      `示範機構的首任租戶管理員(+${source.tenant.adminAlias})`,
    ).catch((error: unknown) => {
      throw new Error(
        `${messageOf(error)}(密碼若已被改過,請由平台管理員重設成示範密碼後重跑)`,
        { cause: error },
      );
    });
    await source.populate({
      client: admin,
      emailBase,
      password,
      print: output,
    });
    output(
      `demo(create)完成:環境 ${target.environment}、資料庫 ${target.databaseName}、示範機構「${source.tenant.name}」`,
    );
  } catch (error) {
    throw new Error(redact(messageOf(error), secrets), { cause: error });
  }
}

/** 入口檔共用:執行並把失敗寫到 stderr、結束碼設為 1。 */
export async function runDemoEntry(
  argv: readonly string[],
  options: DemoCommandOptions,
): Promise<void> {
  try {
    await runDemoCommand(argv, options);
  } catch (error: unknown) {
    process.stderr.write(`demo 失敗:${messageOf(error)}\n`);
    process.exitCode = 1;
  }
}
