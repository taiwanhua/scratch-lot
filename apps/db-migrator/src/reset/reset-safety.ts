/**
 * reset 指令的安全閥(`docs/deployment.md`「資料庫還原(reset)」)。
 *
 * 純函式、不碰資料庫:目標環境由操作者以 `--environment` 指定(**不從資料庫名推測**),
 * 必須在 `RESET_ALLOW_ENV` 的允許清單內,而且 `--confirm` 要與
 * `reset:<environment>:<實際資料庫名>:<mode>` 完全相同。缺任何一項或任何一段不符即回傳拒絕原因
 * (入口據此 exit 1,此時還沒有連線)。三個環境同一套規則,production 沒有另外的永久拒絕。
 *
 * 拒絕原因只帶資料庫名,不回顯收到的確認字串(操作者可能誤貼連線字串)。
 */

/** 三個環境(對照表正本:docs/deployment.md「環境對照(分支 ↔ 環境)」)。 */
export const RESET_ENVIRONMENTS = ["dev", "staging", "production"] as const;

export type ResetEnvironment = (typeof RESET_ENVIRONMENTS)[number];

export const RESET_MODES = ["data", "full"] as const;

export type ResetMode = (typeof RESET_MODES)[number];

/** 允許還原的環境名單(逗號分隔),正本:docs/env-registry.md。 */
export const RESET_ALLOW_ENV_NAME = "RESET_ALLOW_ENV";

const CONFIRM_PREFIX = "reset";
const CONFIRM_FORMAT = `${CONFIRM_PREFIX}:<environment>:<資料庫名>:<mode>`;

/** 連線字串的協定;其餘一律不當成連線字串解析。 */
const MONGODB_PROTOCOLS = new Set(["mongodb:", "mongodb+srv:"]);

/**
 * 從 `MONGODB_URI` 取出資料庫名(update 也以它決定寫哪個庫:`client.db()`)。
 * 錯誤訊息不帶出連線字串本身。
 */
export function parseDatabaseName(uri: string): string {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error("MONGODB_URI 不是合法的連線字串");
  }
  if (!MONGODB_PROTOCOLS.has(url.protocol)) {
    throw new Error(
      "MONGODB_URI 不是合法的連線字串(須為 mongodb:// 或 mongodb+srv://)",
    );
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (name === "") {
    throw new Error(
      "MONGODB_URI 未含資料庫名稱(例:mongodb://127.0.0.1:27017/wowgo-base-dev)",
    );
  }
  return name;
}

/** `RESET_ALLOW_ENV` 的值(逗號分隔;未設 = 空名單 = 全部拒絕)。 */
export function parseAllowedEnvironments(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
}

export function isResetEnvironment(value: string): value is ResetEnvironment {
  return (RESET_ENVIRONMENTS as readonly string[]).includes(value);
}

export interface ResetTarget {
  environment: string;
  databaseName: string;
  mode: string;
}

/** 操作者必須完整輸入的確認字串。 */
export function resetConfirmationOf({
  environment,
  databaseName,
  mode,
}: ResetTarget): string {
  return `${CONFIRM_PREFIX}:${environment}:${databaseName}:${mode}`;
}

export interface ResetSafetyInput {
  /** 連線字串裡的資料庫名。 */
  databaseName: string;
  /** `--environment` 的值(未給為 undefined)。 */
  environment: string | undefined;
  mode: ResetMode;
  /** `--confirm` 的值(未給為 undefined)。 */
  confirm: string | undefined;
  /** `RESET_ALLOW_ENV` 的原始值。 */
  allowEnv: string | undefined;
}

/**
 * 確認字串哪幾段與目標不同。資料庫名可能含 `:`,所以環境取第一段、模式取最後一段、其餘是資料庫名。
 * `demo` 指令的確認字串同一個形狀(只有開頭不同),共用這支(`src/demo/demo-safety.ts`)。
 */
export function mismatchedSegments(
  confirm: string,
  target: ResetTarget,
  confirmPrefix: string = CONFIRM_PREFIX,
): string[] {
  const segments = confirm.split(":");
  const [prefix, environment] = segments;
  if (segments.length < 4 || prefix !== confirmPrefix) {
    return [`格式不是 ${confirmPrefix}:<environment>:<資料庫名>:<mode>`];
  }
  const mismatched: string[] = [];
  if (environment !== target.environment) {
    mismatched.push("環境段不符");
  }
  if (segments.slice(2, -1).join(":") !== target.databaseName) {
    mismatched.push("資料庫名段不符");
  }
  if (segments.at(-1) !== target.mode) {
    mismatched.push("模式段不符");
  }
  return mismatched;
}

/** 回傳拒絕原因;`null` = 全部通過。 */
export function findSafetyViolation({
  databaseName,
  environment,
  mode,
  confirm,
  allowEnv,
}: ResetSafetyInput): string | null {
  if (environment === undefined || !isResetEnvironment(environment)) {
    return `--environment 必填,且必須是 ${RESET_ENVIRONMENTS.join(" / ")}(目標環境由操作者指定,不從資料庫名推測)`;
  }

  const allowed = parseAllowedEnvironments(allowEnv);
  if (!allowed.includes(environment)) {
    return `${RESET_ALLOW_ENV_NAME}(目前:${allowEnv ?? "(未設)"})不含目標環境 ${environment}`;
  }

  const target = { environment, databaseName, mode };
  const describe = `目標:環境 ${environment}、資料庫 ${databaseName}、模式 ${mode}`;
  if (confirm === undefined || confirm === "") {
    return `--confirm 必填:請完整輸入 ${CONFIRM_FORMAT}(${describe})`;
  }
  if (confirm !== resetConfirmationOf(target)) {
    const reasons = mismatchedSegments(confirm, target);
    return `--confirm 與目標不符(${reasons.length > 0 ? reasons.join("、") : "須完全相同,含大小寫與空白"});請完整輸入 ${CONFIRM_FORMAT}(${describe})`;
  }

  return null;
}
