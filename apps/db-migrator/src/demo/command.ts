/**
 * demo 指令(`docs/deployment.md`「示範資料(demo)」;形狀照 reset):
 *
 * ```
 * pnpm --filter @repo/db-migrator demo --environment=<dev|staging|production> --mode=<create|purge|rebuild>  *   --confirm=demo:<environment>:<資料庫名>:<mode> --api-url=<該環境的 api 網址>
 * ```
 *
 * 1. 安全閥第一段(`demo-safety.ts`):環境、`DEMO_ALLOW_ENV` 允許清單、確認字串的格式與環境 / mode 兩段。
 *    不過即結束,此時還沒有呼叫 api;`purge` / `rebuild` 目前也在這裡拒絕(清空示範機構另行實作)
 * 2. 以平台管理員登入(`ROOT_ADMIN_ACCOUNT`;密碼取 `ROOT_ADMIN_PASSWORD`,沒設就從標準輸入讀),
 *    讀 api **自己回報**的資料庫名(`provisionTarget`),安全閥第二段比對確認字串的資料庫名段:
 *    確認字串因此綁到實際寫入的資料庫,`--api-url` 指到別的環境就不執行。到這裡還沒有任何寫入
 * 3. 示範密碼與基底信箱**只從標準輸入讀**(終端機不回顯;workflow 以管線送入),不從參數、環境變數或檔案讀
 * 4. 建立或找回標「示範」的機構與首任租戶管理員(`demo-tenant.ts`),同一個平台管理員 session 把 registry 登記的
 *    每張受管表單分派給示範機構(`assignFormToTenants`;已分派的略過)——分派只有站在根組織做得到,開通腳本做不到
 * 5. 以那位租戶管理員登入 → 交給專案登記的示範資料(`seeds/registry.ts` 的 `demoSource`)的 `populate`
 *
 * **全程走 api 的 GraphQL**:權限照常檢查、操作紀錄照常寫;本指令不連資料庫,也不需要 `MONGODB_URI`。
 * 冪等:重跑只補缺的。輸出只有環境、資料庫名、模式與各步驟的結果,不含密碼或真實信箱。
 * 本檔沒有載入時的副作用(入口檔才有)。
 */
import { pathToFileURL } from "node:url";

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
  type GraphqlClient,
  createGraphqlClient,
  graphqlEndpointOf,
  loginAs,
} from "./graphql-client";
import { type SecretReader, createSecretReader } from "./secret-input";

const USAGE = `用法:demo --environment=<${DEMO_ENVIRONMENTS.join("|")}> --mode=<${DEMO_MODES.join("|")}> --confirm=demo:<environment>:<資料庫名>:<mode> --api-url=<api 網址>`;

const MODE_RULE = `--mode 必須是 ${DEMO_MODES.join(" / ")}(${USAGE})`;

/**
 * 標準輸入要依序給的值:`ROOT_ADMIN_PASSWORD` 沒設時先給平台管理員密碼,
 * 再給示範帳號密碼與基底信箱(workflow 以環境變數給 root 密碼,管線只送後兩個)。
 */
export const DEMO_SECRET_LABELS = {
  rootPassword: "平台管理員密碼",
  password: "示範帳號密碼",
  emailBase: "基底信箱",
} as const;

/** 比這短的機密不在錯誤訊息裡逐字遮(太短會把一般文字也遮掉);真的密碼與信箱都比它長。 */
export const MIN_REDACTED_SECRET_LENGTH = 8;

const PROVISION_TARGET = /* GraphQL */ `
  query DemoProvisionTarget {
    provisionTarget {
      databaseName
    }
  }
`;

interface DemoArgs {
  mode: DemoMode;
  environment: string | undefined;
  confirm: string | undefined;
  apiUrl: string | undefined;
}

export interface DemoCommandOptions {
  env?: NodeJS.ProcessEnv;
  /** 讀機密(root 密碼沒在環境變數時、示範密碼、基底信箱;預設:標準輸入)。 */
  readSecret?: SecretReader;
  /** 專案登記的示範資料(入口檔給:`seeds/registry.ts` 的 `demoSource`,見 `loadRegisteredDemoSource`)。 */
  loadDemoSource: () => Promise<DemoSource | null>;
  /**
   * 要分派給示範機構的受管表單 key(入口檔給:`seeds/registry.ts` 的 `seedRegistry` 裡目標為發布的表單定義,
   * 見 `loadRegisteredManagedFormKeys`);不給 = 不分派。
   */
  loadManagedFormKeys?: () => Promise<readonly string[]>;
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

/** 固定入口 `seeds/registry.ts` 的 `seedRegistry` 裡,目標狀態為發布的受管表單 key(登記順序)。 */
export async function loadRegisteredManagedFormKeys(
  registryPath: string,
): Promise<string[]> {
  const loaded = (await import(pathToFileURL(registryPath).href)) as {
    seedRegistry?: readonly {
      kind: string;
      key?: unknown;
      desiredStatus?: unknown;
    }[];
  };
  return (loaded.seedRegistry ?? []).flatMap((set) =>
    set.kind === "form-definition" &&
    set.desiredStatus === "published" &&
    typeof set.key === "string"
      ? [set.key]
      : [],
  );
}

const ASSIGN_FORM = /* GraphQL */ `
  mutation DemoAssignForm($input: AssignFormToTenantsInput!) {
    assignFormToTenants(input: $input) {
      form {
        key
      }
    }
  }
`;

/** 平台管理員把受管表單分派給示範機構(api 端冪等:已分派的不重建、不留稽核)。 */
async function assignManagedForms(
  root: GraphqlClient,
  tenantOrgId: string,
  formKeys: readonly string[],
  output: (line: string) => void,
): Promise<void> {
  for (const formKey of formKeys) {
    await root.request(ASSIGN_FORM, {
      input: { formKey, tenantOrgIds: [tenantOrgId] },
    });
  }
  if (formKeys.length > 0) {
    output(`受管表單分派給示範機構:${formKeys.join("、")}`);
  }
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

/**
 * 訊息裡若帶到任何一個機密(root 密碼、示範密碼、基底信箱),一律遮掉。
 * 短於 `MIN_REDACTED_SECRET_LENGTH` 的不逐字遮,以免把訊息裡的一般文字也換掉。
 */
export function redactSecrets(
  message: string,
  secrets: readonly (string | undefined)[],
): string {
  let redacted = message;
  for (const secret of secrets) {
    if (
      secret !== undefined &&
      secret.trim().length >= MIN_REDACTED_SECRET_LENGTH
    ) {
      redacted = redacted.replaceAll(secret, "***");
    }
  }
  return redacted;
}

interface DemoTarget {
  environment: string;
  mode: DemoMode;
  apiUrl: string;
}

/** 安全閥第一段與參數:全部通過才回傳目標;任何一項不合就丟錯(此時還沒有呼叫 api)。 */
function resolveTarget(args: DemoArgs, env: NodeJS.ProcessEnv): DemoTarget {
  const violation = findDemoSafetyViolation({
    databaseName: null,
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
    mode: args.mode,
    apiUrl: args.apiUrl,
  };
}

/**
 * 安全閥第二段:以 api 回報的資料庫名完整比對確認字串(只讀,還沒有寫入)。回傳資料庫名。
 */
async function assertConfirmedTarget(
  root: GraphqlClient,
  args: DemoArgs,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const { provisionTarget } = await root.request<{
    provisionTarget: { databaseName: string };
  }>(PROVISION_TARGET);
  const violation = findDemoSafetyViolation({
    databaseName: provisionTarget.databaseName,
    environment: args.environment,
    mode: args.mode,
    confirm: args.confirm,
    allowEnv: env[DEMO_ALLOW_ENV_NAME],
  });
  if (violation !== null) {
    throw new Error(
      `${violation};資料庫名是 --api-url 那個 api 回報的,確認 --api-url 指的是 ${args.environment ?? ""} 環境`,
    );
  }
  return provisionTarget.databaseName;
}

/** 執行一次指令;失敗丟錯(訊息已遮掉機密,由入口檔印出並設定結束碼)。 */
export async function runDemoCommand(
  argv: readonly string[],
  options: DemoCommandOptions,
): Promise<void> {
  const env = options.env ?? process.env;
  const output = options.print ?? printLine;
  const secrets: (string | undefined)[] = [env.ROOT_ADMIN_PASSWORD];
  try {
    const args = parseDemoArgs(argv);
    const target = resolveTarget(args, env);
    const source = await options.loadDemoSource();
    if (source === null) {
      throw new Error(
        "這個專案沒有登記示範資料(seeds/project/registry.ts 的 projectDemoSource)",
      );
    }
    const rootAccount = requireValue(env, "ROOT_ADMIN_ACCOUNT");
    const readSecret = options.readSecret ?? createSecretReader();
    const rootPassword =
      env.ROOT_ADMIN_PASSWORD !== undefined &&
      env.ROOT_ADMIN_PASSWORD.trim() !== ""
        ? env.ROOT_ADMIN_PASSWORD
        : await readSecret(DEMO_SECRET_LABELS.rootPassword);
    secrets.push(rootPassword);

    const api = createGraphqlClient({
      apiUrl: target.apiUrl,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    const root = await loginAs(
      api,
      { account: rootAccount, password: rootPassword },
      "平台管理員(ROOT_ADMIN_ACCOUNT)",
    );
    const databaseName = await assertConfirmedTarget(root, args, env);
    output(
      `demo:環境 ${target.environment}、資料庫 ${databaseName}、模式 ${target.mode}、示範機構「${source.tenant.name}」`,
    );

    const password = await readSecret(DEMO_SECRET_LABELS.password);
    secrets.push(password);
    const enteredBase = await readSecret(DEMO_SECRET_LABELS.emailBase);
    const emailBase = enteredBase.trim();
    secrets.push(emailBase);

    const tenant = await ensureDemoTenant(
      root,
      source.tenant,
      { emailBase, password },
      output,
    );
    await assignManagedForms(
      root,
      tenant.orgId,
      (await options.loadManagedFormKeys?.()) ?? [],
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
      `demo(create)完成:環境 ${target.environment}、資料庫 ${databaseName}、示範機構「${source.tenant.name}」`,
    );
  } catch (error) {
    throw new Error(redactSecrets(messageOf(error), secrets), {
      cause: error,
    });
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
